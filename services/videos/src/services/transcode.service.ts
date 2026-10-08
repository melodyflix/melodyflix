// melodyflix videos - FFmpeg HLS transcoding (32.1-32.4, 32.8)
import { spawn } from 'node:child_process';
import { writeFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createLogger } from '@melodyflix/shared-logger';
import { getDb } from '@melodyflix/shared-db';
import { processedDir } from './storage.service.js';

const logger = createLogger('transcode');

// ---------- Codec profiles (32.4) ----------

export type VideoCodec = 'h264' | 'h265' | 'av1';

interface CodecProfile {
  id: VideoCodec;
  ffmpegEncoder: string;
  // CODECS string for HLS master playlist (per resolution)
  codecsString: Record<string, string>;
  audioCodec: string;
  // preset & CRF default; per-quality overrides allowed
  preset: string;
  crf: Record<string, number>;
}

const CODEC_PROFILES: Record<VideoCodec, CodecProfile> = {
  h264: {
    id: 'h264',
    ffmpegEncoder: 'libx264',
    codecsString: {
      '240p':  'avc1.42c00d,mp4a.40.2',
      '360p':  'avc1.42c01e,mp4a.40.2',
      '480p':  'avc1.4d401e,mp4a.40.2',
      '720p':  'avc1.4d401f,mp4a.40.2',
      '1080p': 'avc1.640028,mp4a.40.2',
      '1440p': 'avc1.640032,mp4a.40.2',
      '2160p': 'avc1.640033,mp4a.40.2',
      '4320p': 'avc1.640034,mp4a.40.2',
    },
    audioCodec: 'aac',
    preset: 'ultrafast',
    crf: { '240p': 28, '360p': 26, '480p': 24, '720p': 23, '1080p': 22, '1440p': 21, '2160p': 20, '4320p': 19 },
  },
  h265: {
    id: 'h265',
    ffmpegEncoder: 'libx265',
    codecsString: {
      '240p':  'hvc1.1.6.L63.90,mp4a.40.2',
      '360p':  'hvc1.1.6.L63.90,mp4a.40.2',
      '480p':  'hvc1.1.6.L93.90,mp4a.40.2',
      '720p':  'hvc1.1.6.L93.90,mp4a.40.2',
      '1080p': 'hvc1.1.6.L120.90,mp4a.40.2',
      '1440p': 'hvc1.1.6.L150.90,mp4a.40.2',
      '2160p': 'hvc1.1.6.L150.90,mp4a.40.2',
      '4320p': 'hvc1.1.6.L180.90,mp4a.40.2',
    },
    audioCodec: 'aac',
    preset: 'ultrafast',
    crf: { '240p': 30, '360p': 28, '480p': 26, '720p': 25, '1080p': 24, '1440p': 23, '2160p': 22, '4320p': 21 },
  },
  av1: {
    id: 'av1',
    ffmpegEncoder: 'libsvtav1',
    codecsString: {
      '240p':  'av01.0.00M.08,mp4a.40.2',
      '360p':  'av01.0.01M.08,mp4a.40.2',
      '480p':  'av01.0.04M.08,mp4a.40.2',
      '720p':  'av01.0.05M.08,mp4a.40.2',
      '1080p': 'av01.0.08M.08,mp4a.40.2',
      '1440p': 'av01.0.09M.08,mp4a.40.2',
      '2160p': 'av01.0.12M.08,mp4a.40.2',
      '4320p': 'av01.0.13M.08,mp4a.40.2',
    },
    audioCodec: 'aac',
    preset: '8',
    crf: { '240p': 40, '360p': 38, '480p': 36, '720p': 34, '1080p': 32, '1440p': 30, '2160p': 28, '4320p': 26 },
  },
};

// ---------- Quality ladder (32.2 — extended to 8K) ----------

export interface QualityLevel {
  name: string;
  height: number;
  bandwidth: number;
}

export const DEFAULT_QUALITY_LADDER: QualityLevel[] = [
  { name: '240p',  height: 240,  bandwidth: 400_000 },
  { name: '360p',  height: 360,  bandwidth: 800_000 },
  { name: '480p',  height: 480,  bandwidth: 1_400_000 },
  { name: '720p',  height: 720,  bandwidth: 2_800_000 },
  { name: '1080p', height: 1080, bandwidth: 5_000_000 },
  { name: '1440p', height: 1440, bandwidth: 10_000_000 },
  { name: '2160p', height: 2160, bandwidth: 20_000_000 },
  { name: '4320p', height: 4320, bandwidth: 50_000_000 },
];

/**
 * Filter quality ladder to levels <= source height.
 * Always include at least the lowest level.
 */
export function filterLadderForSource(sourceHeight: number, ladder = DEFAULT_QUALITY_LADDER): QualityLevel[] {
  const filtered = ladder.filter((q) => q.height <= sourceHeight);
  return filtered.length ? filtered : [ladder[0]];
}

export interface TranscodeOptions {
  codec?: VideoCodec;
  qualities?: string[];      // subset by name, e.g. ['720p','1080p']
  segmentDuration?: number;  // default 6
  maxSourceHeight?: number;  // skip encoding above this (bandwidth opt 32.6)
}

export interface TranscodeResult {
  masterPlaylist: string;
  thumbnailPath: string;
  durationSeconds: number;
  sourceHeight: number;
  sourceWidth: number;
  codec: VideoCodec;
  qualities: QualityLevel[];
  cached: boolean;
}

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

function ffmpegAvailable(): boolean {
  return existsSync('/usr/bin/ffmpeg');
}

export interface ProbeInfo {
  durationSeconds: number;
  width: number;
  height: number;
}

export function probeMedia(inputPath: string): Promise<ProbeInfo> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:format=duration',
      '-of', 'json',
      inputPath,
    ]);
    let out = '';
    proc.stdout.on('data', (c) => { out += c.toString(); });
    proc.on('close', () => {
      try {
        const parsed = JSON.parse(out) as {
          format?: { duration?: string };
          streams?: Array<{ width?: number; height?: number }>;
        };
        const s = parsed.streams?.[0] ?? {};
        const duration = parseFloat(parsed.format?.duration ?? '0') || 0;
        resolve({
          durationSeconds: duration,
          width: s.width ?? 0,
          height: s.height ?? 0,
        });
      } catch {
        resolve({ durationSeconds: 0, width: 0, height: 0 });
      }
    });
    proc.on('error', () => resolve({ durationSeconds: 0, width: 0, height: 0 }));
  });
}

// ---------- Smart caching (32.8) ----------

export function ensureTranscodeCacheSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS transcode_cache (
      cache_key TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      codec TEXT NOT NULL,
      qualities TEXT NOT NULL,
      master_playlist TEXT NOT NULL,
      thumbnail_path TEXT,
      duration_seconds REAL NOT NULL DEFAULT 0,
      source_width INTEGER NOT NULL DEFAULT 0,
      source_height INTEGER NOT NULL DEFAULT 0,
      file_size_bytes INTEGER NOT NULL DEFAULT 0,
      hits INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tc_video ON transcode_cache(video_id);
    CREATE INDEX IF NOT EXISTS idx_tc_key ON transcode_cache(cache_key);
  `);
}

function makeCacheKey(sourcePath: string, videoId: string, codec: VideoCodec, qualities: string[]): { key: string; hash: string } {
  const hash = createHash('sha256').update(`${sourcePath}:${videoId}`).digest('hex').slice(0, 32);
  const key = `${hash}:${codec}:${qualities.join(',')}`;
  return { key, hash };
}

interface TranscodeCacheRow {
  cache_key: string; video_id: string; source_hash: string; codec: string;
  qualities: string; master_playlist: string; thumbnail_path: string | null;
  duration_seconds: number; source_width: number; source_height: number;
  file_size_bytes: number; hits: number; last_used_at: string; created_at: string;
}

export interface TranscodeCacheEntry {
  cache_key: string;
  video_id: string;
  source_hash: string;
  codec: VideoCodec;
  qualities: string[];
  master_playlist: string;
  thumbnail_path: string | null;
  duration_seconds: number;
  source_width: number;
  source_height: number;
  file_size_bytes: number;
  hits: number;
  last_used_at: string;
  created_at: string;
}

function cacheRowToObj(row: TranscodeCacheRow): TranscodeCacheEntry {
  return {
    cache_key: row.cache_key,
    video_id: row.video_id,
    source_hash: row.source_hash,
    codec: row.codec as VideoCodec,
    qualities: JSON.parse(row.qualities) as string[],
    master_playlist: row.master_playlist,
    thumbnail_path: row.thumbnail_path,
    duration_seconds: row.duration_seconds,
    source_width: row.source_width,
    source_height: row.source_height,
    file_size_bytes: row.file_size_bytes,
    hits: row.hits,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
  };
}

export function getCachedTranscode(cacheKey: string): TranscodeCacheEntry | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM transcode_cache WHERE cache_key = ?').get(cacheKey) as TranscodeCacheRow | undefined;
  if (!row) return null;
  // Verify master playlist still exists on disk
  if (!existsSync(row.master_playlist)) {
    db.prepare('DELETE FROM transcode_cache WHERE cache_key = ?').run(cacheKey);
    return null;
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE transcode_cache SET hits = hits + 1, last_used_at = ? WHERE cache_key = ?').run(now, cacheKey);
  return cacheRowToObj({ ...row, hits: row.hits + 1, last_used_at: now });
}

export function setCachedTranscode(input: {
  cache_key: string;
  video_id: string;
  source_hash: string;
  codec: VideoCodec;
  qualities: string[];
  master_playlist: string;
  thumbnail_path?: string | null;
  duration_seconds: number;
  source_width: number;
  source_height: number;
  file_size_bytes?: number;
}): TranscodeCacheEntry {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO transcode_cache (cache_key, video_id, source_hash, codec, qualities,
      master_playlist, thumbnail_path, duration_seconds, source_width, source_height,
      file_size_bytes, hits, last_used_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      master_playlist = excluded.master_playlist,
      thumbnail_path = excluded.thumbnail_path,
      duration_seconds = excluded.duration_seconds,
      source_width = excluded.source_width,
      source_height = excluded.source_height,
      file_size_bytes = excluded.file_size_bytes,
      last_used_at = excluded.last_used_at
  `).run(
    input.cache_key, input.video_id, input.source_hash, input.codec,
    JSON.stringify(input.qualities), input.master_playlist, input.thumbnail_path ?? null,
    input.duration_seconds, input.source_width, input.source_height,
    input.file_size_bytes ?? 0, now, now
  );
  return cacheRowToObj(db.prepare('SELECT * FROM transcode_cache WHERE cache_key = ?').get(input.cache_key) as TranscodeCacheRow);
}

export function listTranscodeCache(limit = 100, offset = 0): TranscodeCacheEntry[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM transcode_cache ORDER BY last_used_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as TranscodeCacheRow[];
  return rows.map(cacheRowToObj);
}

export interface CacheStats {
  total_entries: number;
  total_size_bytes: number;
  total_hits: number;
  hit_rate: number;
  by_codec: Array<{ codec: string; count: number }>;
}

export function getTranscodeCacheStats(): CacheStats {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as n FROM transcode_cache').get() as { n: number }).n;
  const size = (db.prepare('SELECT COALESCE(SUM(file_size_bytes), 0) as s FROM transcode_cache').get() as { s: number }).s;
  const hits = (db.prepare('SELECT COALESCE(SUM(hits), 0) as s FROM transcode_cache').get() as { s: number }).s;
  const byCodec = db.prepare('SELECT codec, COUNT(*) as count FROM transcode_cache GROUP BY codec')
    .all() as Array<{ codec: string; count: number }>;
  return {
    total_entries: total,
    total_size_bytes: size,
    total_hits: hits,
    hit_rate: total > 0 ? Math.round((hits / (hits + total)) * 10000) / 100 : 0,
    by_codec: byCodec,
  };
}

export function clearTranscodeCache(cacheKey?: string): number {
  const db = getDb();
  if (cacheKey) {
    return db.prepare('DELETE FROM transcode_cache WHERE cache_key = ?').run(cacheKey).changes;
  }
  return db.prepare('DELETE FROM transcode_cache').run().changes;
}

// ---------- Main transcode entry ----------

export async function transcodeToHls(
  inputPath: string,
  videoId: string,
  options: TranscodeOptions = {},
): Promise<TranscodeResult> {
  ensureTranscodeCacheSchema();

  const codec: VideoCodec = options.codec ?? 'h264';
  const profile = CODEC_PROFILES[codec];
  const segmentDuration = options.segmentDuration ?? 6;

  // Probe source to filter ladder for its actual resolution (32.2)
  const probe = await probeMedia(inputPath);
  const sourceHeight = probe.height || 1080;
  const sourceWidth = probe.width || 1920;

  let ladder = filterLadderForSource(sourceHeight);
  if (options.maxSourceHeight) ladder = ladder.filter((q) => q.height <= options.maxSourceHeight!);
  if (options.qualities?.length) {
    const set = new Set(options.qualities);
    ladder = ladder.filter((q) => set.has(q.name));
  }
  if (!ladder.length) ladder = [DEFAULT_QUALITY_LADDER[0]];

  const qualityNames = ladder.map((q) => q.name);

  // Smart cache lookup (32.8)
  const { key: cacheKey, hash: sourceHash } = makeCacheKey(inputPath, videoId, codec, qualityNames);
  const cached = getCachedTranscode(cacheKey);
  if (cached) {
    logger.info({ videoId, cacheKey, codec }, 'transcode cache hit');
    return {
      masterPlaylist: cached.master_playlist,
      thumbnailPath: cached.thumbnail_path ?? `${processedDir(videoId)}/thumbnail.jpg`,
      durationSeconds: cached.duration_seconds,
      sourceHeight: cached.source_height,
      sourceWidth: cached.source_width,
      codec,
      qualities: ladder,
      cached: true,
    };
  }

  if (!ffmpegAvailable()) {
    throw new Error('ffmpeg binary not found at /usr/bin/ffmpeg');
  }

  const outDir = processedDir(videoId);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  logger.info({ videoId, outDir, codec, qualities: qualityNames }, 'transcoding start');

  const durationSeconds = probe.durationSeconds;

  // Thumbnail
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

  // Encode each quality
  for (const q of ladder) {
    const playlistPath = `${outDir}/${codec}_${q.name}.m3u8`;
    const segmentPattern = `${outDir}/${codec}_${q.name}_%03d.ts`;
    const crf = profile.crf[q.name] ?? 23;
    const args = [
      '-y', '-i', inputPath,
      '-vf', `scale=-2:${q.height}`,
      '-c:v', profile.ffmpegEncoder,
      '-preset', profile.preset,
      '-crf', String(crf),
      '-c:a', profile.audioCodec,
      '-b:a', '128k',
      '-hls_time', String(segmentDuration),
      '-hls_playlist_type', 'vod',
      '-hls_segment_filename', segmentPattern,
      playlistPath,
    ];
    // h265 container tagging for Apple compatibility
    if (codec === 'h265') args.splice(args.indexOf('-c:a'), 0, '-tag:v', 'hvc1');
    await runFfmpeg(args);
    logger.info({ videoId, codec, quality: q.name }, 'quality done');
  }

  // Master playlist
  const masterPath = `${outDir}/master.m3u8`;
  const masterContent = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    ...ladder.flatMap((q) => [
      `#EXT-X-STREAM-INF:BANDWIDTH=${q.bandwidth},RESOLUTION=${Math.round((sourceWidth / sourceHeight) * q.height)}x${q.height},CODECS="${profile.codecsString[q.name] ?? 'avc1.42c01e,mp4a.40.2'}"`,
      `${codec}_${q.name}.m3u8`,
    ]),
  ].join('\n');
  writeFileSync(masterPath, masterContent);

  // Compute size for cache stats
  let totalSize = 0;
  try {
    for (const q of ladder) {
      const master = masterPath;
      void master;
      const segBase = `${outDir}/${codec}_${q.name}_000.ts`;
      if (existsSync(segBase)) totalSize += statSync(segBase).size;
    }
  } catch { /* ignore */ }

  setCachedTranscode({
    cache_key: cacheKey,
    video_id: videoId,
    source_hash: sourceHash,
    codec,
    qualities: qualityNames,
    master_playlist: masterPath,
    thumbnail_path: thumbnailPath,
    duration_seconds: durationSeconds,
    source_width: sourceWidth,
    source_height: sourceHeight,
    file_size_bytes: totalSize,
  });

  logger.info({ videoId, codec, cacheKey }, 'transcode complete');
  return {
    masterPlaylist: masterPath,
    thumbnailPath,
    durationSeconds,
    sourceHeight,
    sourceWidth,
    codec,
    qualities: ladder,
    cached: false,
  };
}
