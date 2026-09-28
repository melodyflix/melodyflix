// melodyflix videos - FFmpeg HLS transcoding
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createLogger } from '@melodyflix/shared-logger';
import { processedDir } from './storage.service.js';

const logger = createLogger('transcode');

const QUALITY_LADDER = [
  { name: '360p', height: 360, bandwidth: 800_000 },
];

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}\n${stderr.slice(-800)}`));
    });
  });
}

export interface TranscodeResult {
  masterPlaylist: string;
  thumbnailPath: string;
  durationSeconds: number;
}

export async function transcodeToHls(inputPath: string, videoId: string): Promise<TranscodeResult> {
  const outDir = processedDir(videoId);
  logger.info({ videoId, outDir }, 'transcoding start');

  const durationSeconds = await probeDuration(inputPath);

  const thumbTime = Math.min(2, Math.max(0.1, durationSeconds * 0.1));
  const thumbnailPath = `${outDir}/thumbnail.jpg`;
  await runFfmpeg([
    '-y', '-i', inputPath,
    '-ss', thumbTime.toString(),
    '-vframes', '1',
    '-vf', 'scale=-2:360',
    '-q:v', '3',
    thumbnailPath,
  ]);

  for (const q of QUALITY_LADDER) {
    const playlistPath = `${outDir}/${q.name}.m3u8`;
    const segmentPattern = `${outDir}/${q.name}_%03d.ts`;
    await runFfmpeg([
      '-y', '-i', inputPath,
      '-vf', `scale=-2:${q.height}`,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-c:a', 'aac',
      '-hls_time', '6',
      '-hls_playlist_type', 'vod',
      '-hls_segment_filename', segmentPattern,
      playlistPath,
    ]);
    logger.info({ videoId, quality: q.name }, 'quality done');
  }

  // Master playlist with CODECS (hls.js needs this)
  const masterPath = `${outDir}/master.m3u8`;
  const masterContent = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    ...QUALITY_LADDER.flatMap((q) => [
      `#EXT-X-STREAM-INF:BANDWIDTH=${q.bandwidth},CODECS="avc1.42c01e,mp4a.40.2"`,
      `${q.name}.m3u8`,
    ]),
  ].join('\n');
  writeFileSync(masterPath, masterContent);

  logger.info({ videoId }, 'transcode complete');
  return { masterPlaylist: masterPath, thumbnailPath, durationSeconds };
}

function probeDuration(inputPath: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      inputPath,
    ]);
    let out = '';
    proc.stdout.on('data', (c) => { out += c.toString(); });
    proc.on('close', () => {
      const n = parseFloat(out.trim());
      resolve(isNaN(n) ? 0 : n);
    });
    proc.on('error', () => resolve(0));
  });
}
