// melodyflix live - RTMP ingest (for OBS/Larix/Streamlabs)
import NodeMediaServer from 'node-media-server';
import { createLogger } from '@melodyflix/shared-logger';
import { getStreamByKey, updateStreamStatus } from './live.service.js';
import { streamDir } from './pipeline.service.js';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const logger = createLogger('rtmp');

const RTMP_PORT = Number(process.env.RTMP_PORT ?? 1935);
const RTMP_CHUNK_SIZE = 60000;
const RTMP_GOP_CACHE = true;
const RTMP_PING = 60;
const RTMP_PING_TIMEOUT = 60;

// Transcode settings — matches pipeline.service.ts
const TRANS_ARGS = [
  '-c:v', 'libx264',
  '-preset', 'ultrafast',
  '-tune', 'zerolatency',
  '-profile:v', 'baseline',
  '-pix_fmt', 'yuv420p',
  '-g', '30',
  '-sc_threshold', '0',
  '-b:v', '800k',
  '-maxrate', '900k',
  '-bufsize', '1200k',
  '-c:a', 'aac',
  '-b:a', '96k',
  '-ar', '44100',
  '-ac', '1',
  '-f', 'hls',
  '-hls_time', '2',
  '-hls_list_size', '6',
  '-hls_flags', 'delete_segments+omit_endlist+independent_segments',
];

let nms: any = null;

export function startRtmpServer(): void {
  if (nms) return;

  nms = new NodeMediaServer({
    rtmp: {
      port: RTMP_PORT,
      chunk_size: RTMP_CHUNK_SIZE,
      gop_cache: RTMP_GOP_CACHE,
      ping: RTMP_PING,
      ping_timeout: RTMP_PING_TIMEOUT,
    },
    logType: 0, // disable default logging
  });

  // When an RTMP publisher connects: rtmp://host:1935/live/STREAM_KEY
  nms.on('prePublish', (id: string, streamPath: string, args: any) => {
    logger.info({ id, streamPath }, 'RTMP publish requested');

    // Extract stream key from path: /live/STREAM_KEY
    const parts = streamPath.split('/').filter(Boolean);
    const streamKey = parts[parts.length - 1];

    if (!streamKey) {
      logger.warn({ streamPath }, 'no stream key in path');
      const session = nms.getSession(id);
      if (session) session.reject();
      return;
    }

    const stream = getStreamByKey(streamKey);
    if (!stream) {
      logger.warn({ streamKey }, 'invalid stream key');
      const session = nms.getSession(id);
      if (session) session.reject();
      return;
    }

    // Check if already publishing
    if (stream.status === 'live' && stream.source === 'rtmp') {
      logger.warn({ streamKey }, 'stream already live');
      const session = nms.getSession(id);
      if (session) session.reject();
      return;
    }

    // Prepare HLS output directory
    const dir = streamDir(stream.id);
    if (existsSync(dir)) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
    mkdirSync(dir, { recursive: true });

    // Attach stream metadata for the trans task
    (global as any)[`rtmp_${id}`] = { streamId: stream.id, streamKey };

    logger.info({ streamId: stream.id, streamKey }, 'RTMP publisher accepted');

    // Mark stream as connecting
    updateStreamStatus(stream.id, 'connecting');
  });

  // When publishing actually starts — spawn FFmpeg to create HLS
  nms.on('postPublish', (id: string, streamPath: string, args: any) => {
    logger.info({ id, streamPath }, 'RTMP publish started');

    const meta = (global as any)[`rtmp_${id}`];
    if (!meta) {
      logger.warn({ id }, 'no metadata for RTMP session');
      return;
    }

    const { streamId, streamKey } = meta;
    const dir = streamDir(streamId);
    const playlistPath = join(dir, 'index.m3u8');
    const segmentPattern = join(dir, 'seg_%03d.ts');

    // Build FFmpeg command
    const rtmpUrl = `rtmp://127.0.0.1:${RTMP_PORT}/live/${streamKey}`;
    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel', 'warning',
      '-i', rtmpUrl,
      ...TRANS_ARGS,
      '-hls_segment_filename', segmentPattern,
      playlistPath,
    ];

    const { spawn } = require('node:child_process');
    const ff = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderrBuf = '';
    ff.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      if (stderrBuf.length > 2000) stderrBuf = stderrBuf.slice(-2000);
    });

    ff.on('spawn', () => {
      logger.info({ streamId }, 'ffmpeg RTMP-to-HLS started');
      updateStreamStatus(streamId, 'live', {
        hls_url: `/api/v1/live/${streamId}/hls/index.m3u8`,
        started_at: new Date().toISOString(),
      });
    });

    ff.on('error', (err: Error) => {
      logger.error({ streamId, err: err.message }, 'ffmpeg spawn failed');
    });

    ff.on('close', (code: number) => {
      logger.info({ streamId, code }, 'ffmpeg RTMP-to-HLS exited');
      updateStreamStatus(streamId, 'ended', { ended_at: new Date().toISOString() });
    });

    // Store ffmpeg process to kill on unpublish
    (global as any)[`rtmp_ff_${id}`] = ff;
  });

  // When publisher disconnects
  nms.on('donePublish', (id: string, streamPath: string, args: any) => {
    logger.info({ id, streamPath }, 'RTMP publish ended');

    const meta = (global as any)[`rtmp_${id}`];
    const ff = (global as any)[`rtmp_ff_${id}`];

    if (ff) {
      try { ff.kill('SIGTERM'); } catch {}
      setTimeout(() => {
        try { ff.kill('SIGKILL'); } catch {}
      }, 3000);
    }

    if (meta) {
      updateStreamStatus(meta.streamId, 'ended', { ended_at: new Date().toISOString() });
      delete (global as any)[`rtmp_${meta.streamId}`];
    }

    delete (global as any)[`rtmp_${id}`];
    delete (global as any)[`rtmp_ff_${id}`];
  });

  nms.run();
  logger.info({ port: RTMP_PORT }, 'RTMP server started');
}

export function stopRtmpServer(): void {
  if (nms) {
    try { nms.stop(); } catch {}
    nms = null;
    logger.info('RTMP server stopped');
  }
}

export function rtmpPublishUrl(streamKey: string): string {
  return `rtmp://127.0.0.1:${RTMP_PORT}/live/${streamKey}`;
}
