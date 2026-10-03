// melodyflix live — Low-Latency (7.7) + DVR/Rewind (7.4)

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export function ensureStreamingConfigSchema(): void {
  const db = getDb();
  db.exec(`
    -- 7.7 Low-Latency Streaming config
    CREATE TABLE IF NOT EXISTS stream_latency_config (
      stream_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'standard'
        CHECK (mode IN ('standard','low','ultra_low')),
      target_latency_seconds REAL NOT NULL DEFAULT 6,
      hls_part_duration_ms INTEGER NOT NULL DEFAULT 0,
      hls_segment_duration_s REAL NOT NULL DEFAULT 6,
      force_abr_low_start INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    -- 7.4 DVR/Rewind config + bookmarks
    CREATE TABLE IF NOT EXISTS stream_dvr_config (
      stream_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      window_minutes INTEGER NOT NULL DEFAULT 120,
      allow_live_rewind INTEGER NOT NULL DEFAULT 1,
      keep_recordings_days INTEGER NOT NULL DEFAULT 7,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stream_dvr_bookmarks (
      id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      label TEXT NOT NULL,
      offset_seconds REAL NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dvr_bookmarks_stream
      ON stream_dvr_bookmarks(stream_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS stream_dvr_segments (
      id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL,
      segment_path TEXT NOT NULL,
      start_offset_s REAL NOT NULL,
      duration_s REAL NOT NULL,
      bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dvr_segments_stream
      ON stream_dvr_segments(stream_id, start_offset_s DESC);
  `);
}

// ============================================================
// 7.7 Low-Latency Streaming
// ============================================================

export type LatencyMode = 'standard' | 'low' | 'ultra_low';

export interface LatencyConfig {
  stream_id: string;
  mode: LatencyMode;
  target_latency_seconds: number;
  hls_part_duration_ms: number;
  hls_segment_duration_s: number;
  force_abr_low_start: number;
  updated_at: string;
}

interface ModeDefaults {
  target_latency_seconds: number;
  hls_part_duration_ms: number;
  hls_segment_duration_s: number;
  force_abr_low_start: number;
}

export const LATENCY_PRESETS: Record<LatencyMode, ModeDefaults> = {
  standard: {
    target_latency_seconds: 6,
    hls_part_duration_ms: 0,
    hls_segment_duration_s: 6,
    force_abr_low_start: 0,
  },
  low: {
    target_latency_seconds: 3,
    hls_part_duration_ms: 500,
    hls_segment_duration_s: 2,
    force_abr_low_start: 1,
  },
  ultra_low: {
    target_latency_seconds: 1.5,
    hls_part_duration_ms: 200,
    hls_segment_duration_s: 1,
    force_abr_low_start: 1,
  },
};

export function getLatencyConfig(streamId: string): LatencyConfig {
  const row = getDb().prepare(
    'SELECT * FROM stream_latency_config WHERE stream_id = ?'
  ).get(streamId) as LatencyConfig | undefined;
  if (row) return row;
  return {
    stream_id: streamId,
    mode: 'standard',
    ...LATENCY_PRESETS.standard,
    updated_at: new Date(0).toISOString(),
  };
}

export interface SetLatencyInput {
  mode?: LatencyMode;
  // Overrides (optional) — clamped to safe bounds
  target_latency_seconds?: number;
  hls_part_duration_ms?: number;
  hls_segment_duration_s?: number;
  force_abr_low_start?: boolean;
}

export function setLatencyConfig(streamId: string, input: SetLatencyInput): LatencyConfig {
  const db = getDb();
  const cur = getLatencyConfig(streamId);
  const nextMode: LatencyMode = input.mode ?? cur.mode;
  const preset = LATENCY_PRESETS[nextMode];

  const target = input.target_latency_seconds === undefined
    ? (input.mode ? preset.target_latency_seconds : cur.target_latency_seconds)
    : Math.max(0.5, Math.min(input.target_latency_seconds, 30));

  const part = input.hls_part_duration_ms === undefined
    ? (input.mode ? preset.hls_part_duration_ms : cur.hls_part_duration_ms)
    : Math.max(0, Math.min(input.hls_part_duration_ms, 2000));

  const seg = input.hls_segment_duration_s === undefined
    ? (input.mode ? preset.hls_segment_duration_s : cur.hls_segment_duration_s)
    : Math.max(0.5, Math.min(input.hls_segment_duration_s, 12));

  const abr = input.force_abr_low_start === undefined
    ? (input.mode ? preset.force_abr_low_start : cur.force_abr_low_start)
    : (input.force_abr_low_start ? 1 : 0);

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO stream_latency_config
      (stream_id, mode, target_latency_seconds, hls_part_duration_ms,
       hls_segment_duration_s, force_abr_low_start, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(stream_id) DO UPDATE SET
      mode = excluded.mode,
      target_latency_seconds = excluded.target_latency_seconds,
      hls_part_duration_ms = excluded.hls_part_duration_ms,
      hls_segment_duration_s = excluded.hls_segment_duration_s,
      force_abr_low_start = excluded.force_abr_low_start,
      updated_at = excluded.updated_at
  `).run(streamId, nextMode, target, part, seg, abr, now);
  return getLatencyConfig(streamId);
}

// FFmpeg hint derived from the config
export interface FfmpegLatencyHints {
  hls_time: number;
  hls_list_size: number;
  hls_flags: string;
  force_low_start_bandwidth: boolean;
}

export function getFfmpegLatencyHints(streamId: string): FfmpegLatencyHints {
  const cfg = getLatencyConfig(streamId);
  const flags = ['delete_segments', 'independent_segments'];
  if (cfg.mode !== 'standard') flags.push('program_date_time');
  return {
    hls_time: cfg.hls_segment_duration_s,
    // Keep more segments for DVR window; low-latency also wants a longer list
    hls_list_size: cfg.mode === 'standard' ? 6 : 10,
    hls_flags: flags.join('+'),
    force_low_start_bandwidth: cfg.force_abr_low_start === 1,
  };
}

// ============================================================
// 7.4 DVR / Rewind
// ============================================================

export interface DvrConfig {
  stream_id: string;
  enabled: number;
  window_minutes: number;
  allow_live_rewind: number;
  keep_recordings_days: number;
  updated_at: string;
}

export function getDvrConfig(streamId: string): DvrConfig {
  const row = getDb().prepare(
    'SELECT * FROM stream_dvr_config WHERE stream_id = ?'
  ).get(streamId) as DvrConfig | undefined;
  if (row) return row;
  return {
    stream_id: streamId,
    enabled: 0,
    window_minutes: 120,
    allow_live_rewind: 1,
    keep_recordings_days: 7,
    updated_at: new Date(0).toISOString(),
  };
}

export interface SetDvrInput {
  enabled?: boolean;
  window_minutes?: number;
  allow_live_rewind?: boolean;
  keep_recordings_days?: number;
}

export function setDvrConfig(streamId: string, input: SetDvrInput): DvrConfig {
  const db = getDb();
  const cur = getDvrConfig(streamId);
  const now = new Date().toISOString();

  const win = input.window_minutes === undefined
    ? cur.window_minutes
    : Math.max(5, Math.min(input.window_minutes, 24 * 60));

  const keep = input.keep_recordings_days === undefined
    ? cur.keep_recordings_days
    : Math.max(1, Math.min(input.keep_recordings_days, 90));

  db.prepare(`
    INSERT INTO stream_dvr_config
      (stream_id, enabled, window_minutes, allow_live_rewind,
       keep_recordings_days, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(stream_id) DO UPDATE SET
      enabled = excluded.enabled,
      window_minutes = excluded.window_minutes,
      allow_live_rewind = excluded.allow_live_rewind,
      keep_recordings_days = excluded.keep_recordings_days,
      updated_at = excluded.updated_at
  `).run(
    streamId,
    input.enabled === undefined ? cur.enabled : (input.enabled ? 1 : 0),
    win,
    input.allow_live_rewind === undefined ? cur.allow_live_rewind : (input.allow_live_rewind ? 1 : 0),
    keep,
    now
  );
  return getDvrConfig(streamId);
}

// ---- DVR segment index (worker registers each segment) ----

export interface DvrSegment {
  id: string;
  stream_id: string;
  segment_path: string;
  start_offset_s: number;
  duration_s: number;
  bytes: number;
  created_at: string;
}

export interface RecordSegmentInput {
  streamId: string;
  segmentPath: string;
  startOffsetS: number;
  durationS: number;
  bytes?: number;
}

export function recordDvrSegment(input: RecordSegmentInput): DvrSegment {
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO stream_dvr_segments
      (id, stream_id, segment_path, start_offset_s, duration_s, bytes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.streamId, input.segmentPath, input.startOffsetS, input.durationS, input.bytes ?? 0, now);
  return db.prepare('SELECT * FROM stream_dvr_segments WHERE id = ?').get(id) as DvrSegment;
}

export interface DvrWindowInfo {
  enabled: boolean;
  window_minutes: number;
  allow_live_rewind: boolean;
  earliest_offset_s: number | null;
  latest_offset_s: number | null;
  segment_count: number;
  total_bytes: number;
}

// Compute the current DVR window given the config + stored segments
export function getDvrWindow(streamId: string): DvrWindowInfo {
  const cfg = getDvrConfig(streamId);
  const db = getDb();
  const row = db.prepare(`
    SELECT MIN(start_offset_s) as earliest, MAX(start_offset_s + duration_s) as latest,
           COUNT(*) as n, COALESCE(SUM(bytes), 0) as bytes
    FROM stream_dvr_segments WHERE stream_id = ?
  `).get(streamId) as any;
  return {
    enabled: cfg.enabled === 1,
    window_minutes: cfg.window_minutes,
    allow_live_rewind: cfg.allow_live_rewind === 1,
    earliest_offset_s: row?.earliest ?? null,
    latest_offset_s: row?.latest ?? null,
    segment_count: row?.n ?? 0,
    total_bytes: row?.bytes ?? 0,
  };
}

export interface SeekQuery {
  offsetSeconds: number; // offset from live (positive = go back)
}

export interface SeekResult {
  allowed: boolean;
  reason: 'ok' | 'dvr_disabled' | 'rewind_not_allowed' | 'before_window' | 'invalid';
  seek_to_offset_s: number;
  earliest_offset_s: number | null;
  latest_offset_s: number | null;
  segments: DvrSegment[];
}

export function seekInDvr(streamId: string, query: SeekQuery): SeekResult {
  const cfg = getDvrConfig(streamId);
  if (cfg.enabled !== 1) {
    return { allowed: false, reason: 'dvr_disabled', seek_to_offset_s: 0, earliest_offset_s: null, latest_offset_s: null, segments: [] };
  }
  if (cfg.allow_live_rewind !== 1 && query.offsetSeconds > 0) {
    return { allowed: false, reason: 'rewind_not_allowed', seek_to_offset_s: 0, earliest_offset_s: null, latest_offset_s: null, segments: [] };
  }
  if (!Number.isFinite(query.offsetSeconds) || query.offsetSeconds < 0) {
    return { allowed: false, reason: 'invalid', seek_to_offset_s: 0, earliest_offset_s: null, latest_offset_s: null, segments: [] };
  }

  const win = getDvrWindow(streamId);
  const maxOffset = cfg.window_minutes * 60;
  const offset = Math.min(query.offsetSeconds, maxOffset);

  if (win.latest_offset_s === null) {
    return { allowed: false, reason: 'before_window', seek_to_offset_s: 0, earliest_offset_s: null, latest_offset_s: null, segments: [] };
  }
  const earliest = Math.max(win.earliest_offset_s ?? 0, (win.latest_offset_s ?? 0) - maxOffset);
  if (offset > (win.latest_offset_s ?? 0) - earliest) {
    return {
      allowed: false, reason: 'before_window',
      seek_to_offset_s: 0,
      earliest_offset_s: earliest, latest_offset_s: win.latest_offset_s,
      segments: [],
    };
  }

  // Segments covering [latest-offset-30s .. latest-offset]
  const target = (win.latest_offset_s ?? 0) - offset;
  const db = getDb();
  const segments = db.prepare(`
    SELECT * FROM stream_dvr_segments
    WHERE stream_id = ? AND start_offset_s <= ? AND (start_offset_s + duration_s) >= ?
    ORDER BY start_offset_s ASC LIMIT 10
  `).all(streamId, target, target - 30) as DvrSegment[];

  return {
    allowed: true,
    reason: 'ok',
    seek_to_offset_s: target,
    earliest_offset_s: earliest,
    latest_offset_s: win.latest_offset_s,
    segments,
  };
}

// ---- Bookmarks ----

export interface DvrBookmark {
  id: string;
  stream_id: string;
  user_id: string;
  label: string;
  offset_seconds: number;
  created_at: string;
}

export function createBookmark(input: {
  streamId: string;
  userId: string;
  label: string;
  offsetSeconds: number;
}): DvrBookmark {
  const label = (input.label ?? '').trim();
  if (label.length < 1 || label.length > 100) throw new Error('Label must be 1-100 chars');
  if (input.offsetSeconds < 0) throw new Error('offsetSeconds must be >= 0');
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO stream_dvr_bookmarks (id, stream_id, user_id, label, offset_seconds, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, input.streamId, input.userId, label, input.offsetSeconds, now);
  return db.prepare('SELECT * FROM stream_dvr_bookmarks WHERE id = ?').get(id) as DvrBookmark;
}

export function listBookmarks(streamId: string, userId?: string | null): DvrBookmark[] {
  const db = getDb();
  if (userId) {
    return db.prepare(
      'SELECT * FROM stream_dvr_bookmarks WHERE stream_id = ? AND user_id = ? ORDER BY created_at DESC'
    ).all(streamId, userId) as DvrBookmark[];
  }
  return db.prepare(
    'SELECT * FROM stream_dvr_bookmarks WHERE stream_id = ? ORDER BY created_at DESC LIMIT 100'
  ).all(streamId) as DvrBookmark[];
}

export function deleteBookmark(id: string, userId: string): boolean {
  return getDb().prepare(
    'DELETE FROM stream_dvr_bookmarks WHERE id = ? AND user_id = ?'
  ).run(id, userId).changes > 0;
}

// Prune stale segments beyond the window
export function pruneDvrSegments(streamId: string): number {
  const cfg = getDvrConfig(streamId);
  const db = getDb();
  const win = db.prepare(
    'SELECT MAX(start_offset_s + duration_s) as latest FROM stream_dvr_segments WHERE stream_id = ?'
  ).get(streamId) as { latest: number | null };
  const cutoff = (win.latest ?? 0) - cfg.window_minutes * 60;
  if (cutoff <= 0) return 0;
  const r = db.prepare(
    'DELETE FROM stream_dvr_segments WHERE stream_id = ? AND (start_offset_s + duration_s) < ?'
  ).run(streamId, cutoff);
  return r.changes;
}
