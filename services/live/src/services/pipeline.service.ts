// melodyflix live - WebSocket to FFmpeg to HLS pipeline
import { spawn, ChildProcess } from 'node:child_process';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '@melodyflix/shared-logger';

const logger = createLogger('pipeline');

const HLS_ROOT = process.env.LIVE_HLS_ROOT ?? '/root/melodyflix/data/live';
const SEGMENT_TIME = 2;   // 2-second segments (low latency)
const PLAYLIST_SIZE = 6;  // keep last 6 segments

export function ensureHlsStorage(): void {
  mkdirSync(HLS_ROOT, { recursive: true });
}

export function streamDir(streamId: string): string {
  return join(HLS_ROOT, streamId);
}

export function streamPlaylistPath(streamId: string): string {
  return join(streamDir(streamId), 'index.m3u8');
}

interface ActivePipeline {
  ffmpeg: ChildProcess;
  streamId: string;
  startedAt: number;
  bytesReceived: number;
}

const pipelines = new Map<string, ActivePipeline>();

export interface PipelineCallbacks {
  onReady?: () => void;
  onError?: (err: string) => void;
  onEnded?: () => void;
}

// ---------- Camera (WebSocket) → FFmpeg → HLS ----------
export function startCameraPipeline(streamId: string, callbacks: PipelineCallbacks = {}): {
  write: (chunk: Buffer) => void;
  stop: () => void;
  info: () => { bytes: number; durationMs: number };
} | null {
  if (pipelines.has(streamId)) {
    logger.warn({ streamId }, 'pipeline already active');
    return null;
  }

  const dir = streamDir(streamId);
  if (existsSync(dir)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  mkdirSync(dir, { recursive: true });

  const playlistPath = join(dir, 'index.m3u8');
  const segmentPattern = join(dir, 'seg_%03d.ts');

  // Input: WebM/Matroska stream from MediaRecorder via WebSocket
  // We use 'matroska' since MediaRecorder produces WebM with both audio+video in a single stream
  const args = [
    '-hide_banner',
    '-loglevel', 'warning',
    // Input from stdin: fragmented WebM
    '-f', 'webm',
    '-i', 'pipe:0',
    // Video encode
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-profile:v', 'baseline',
    '-pix_fmt', 'yuv420p',
    '-g', '30',             // keyframe every 30 frames (approx 1s at 30fps)
    '-sc_threshold', '0',
    '-b:v', '800k',
    '-maxrate', '900k',
    '-bufsize', '1200k',
    // Audio encode
    '-c:a', 'aac',
    '-b:a', '96k',
    '-ar', '44100',
    '-ac', '1',
    // HLS output
    '-f', 'hls',
    '-hls_time', String(SEGMENT_TIME),
    '-hls_list_size', String(PLAYLIST_SIZE),
    '-hls_flags', 'delete_segments+omit_endlist+independent_segments',
    '-hls_segment_filename', segmentPattern,
    playlistPath,
  ];

  const ffmpeg = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });

  const state: ActivePipeline = {
    ffmpeg,
    streamId,
    startedAt: Date.now(),
    bytesReceived: 0,
  };
  pipelines.set(streamId, state);

  let stderrBuf = '';
  ffmpeg.stderr.on('data', (chunk) => {
    const s = chunk.toString();
    stderrBuf += s;
    if (stderrBuf.length > 2000) stderrBuf = stderrBuf.slice(-2000);
  });

  ffmpeg.on('spawn', () => {
    logger.info({ streamId }, 'ffmpeg started');
    callbacks.onReady?.();
  });

  ffmpeg.on('error', (err) => {
    logger.error({ streamId, err: err.message }, 'ffmpeg spawn error');
    callbacks.onError?.(err.message);
    pipelines.delete(streamId);
  });

  ffmpeg.on('close', (code) => {
    logger.info({ streamId, code }, 'ffmpeg exited');
    pipelines.delete(streamId);
    callbacks.onEnded?.();
  });

  return {
    write: (chunk: Buffer) => {
      if (state.ffmpeg.stdin && !state.ffmpeg.stdin.destroyed) {
        try {
          state.ffmpeg.stdin.write(chunk);
          state.bytesReceived += chunk.length;
        } catch (err) {
          logger.warn({ streamId, err: (err as Error).message }, 'write failed');
        }
      }
    },
    stop: () => {
      if (state.ffmpeg.stdin && !state.ffmpeg.stdin.destroyed) {
        try { state.ffmpeg.stdin.end(); } catch {}
      }
      setTimeout(() => {
        try { state.ffmpeg.kill('SIGTERM'); } catch {}
        setTimeout(() => {
          try { state.ffmpeg.kill('SIGKILL'); } catch {}
        }, 3000);
      }, 500);
    },
    info: () => ({
      bytes: state.bytesReceived,
      durationMs: Date.now() - state.startedAt,
    }),
  };
}

export function isPipelineActive(streamId: string): boolean {
  return pipelines.has(streamId);
}

export function stopAllPipelines(): void {
  for (const [id, state] of pipelines) {
    try { state.ffmpeg.stdin?.end(); } catch {}
    try { state.ffmpeg.kill('SIGKILL'); } catch {}
    pipelines.delete(id);
  }
}

export function hlsRootPath(): string {
  return HLS_ROOT;
}
