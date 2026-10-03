// melodyflix videos — Playback Telemetry (Section 42.3, 42.5, 42.7)
// Foundation for Streaming Performance monitoring.

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type PlaybackEndReason = 'completed' | 'abandoned' | 'error' | 'unknown';

export interface PlaybackSession {
  id: string;
  user_id: string | null;
  video_id: string;
  quality: string | null;
  started_at: string;
  ended_at: string | null;
  end_reason: PlaybackEndReason | null;
  duration_ms: number;
  rebuffer_ms: number;
  rebuffer_count: number;
  startup_ms: number;
  avg_bitrate_kbps: number;
  bitrate_switches: number;
  bytes_streamed: number;
  cdn: string | null;
  player_version: string | null;
  platform: string | null;
  created_at: string;
}

export type PlaybackErrorType =
  | 'network' | 'decode' | 'drm' | 'manifest' | 'segment' | 'timeout' | 'media' | 'unknown';

export interface PlaybackError {
  id: string;
  session_id: string;
  error_type: PlaybackErrorType;
  error_code: string | null;
  message: string | null;
  fatal: number;
  at_position_ms: number;
  occurred_at: string;
}

export interface BandwidthSample {
  id: string;
  session_id: string;
  throughput_kbps: number;
  latency_ms: number | null;
  sampled_at: string;
}

export function ensureTelemetrySchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS playback_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      video_id TEXT NOT NULL,
      quality TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      end_reason TEXT CHECK (end_reason IN ('completed','abandoned','error','unknown')),
      duration_ms INTEGER NOT NULL DEFAULT 0,
      rebuffer_ms INTEGER NOT NULL DEFAULT 0,
      rebuffer_count INTEGER NOT NULL DEFAULT 0,
      startup_ms INTEGER NOT NULL DEFAULT 0,
      avg_bitrate_kbps INTEGER NOT NULL DEFAULT 0,
      bitrate_switches INTEGER NOT NULL DEFAULT 0,
      bytes_streamed INTEGER NOT NULL DEFAULT 0,
      cdn TEXT,
      player_version TEXT,
      platform TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_video_time
      ON playback_sessions(video_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_time
      ON playback_sessions(user_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_started
      ON playback_sessions(started_at);

    CREATE TABLE IF NOT EXISTS playback_errors (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      error_type TEXT NOT NULL DEFAULT 'unknown'
        CHECK (error_type IN ('network','decode','drm','manifest','segment','timeout','media','unknown')),
      error_code TEXT,
      message TEXT,
      fatal INTEGER NOT NULL DEFAULT 0,
      at_position_ms INTEGER NOT NULL DEFAULT 0,
      occurred_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_errors_session ON playback_errors(session_id);
    CREATE INDEX IF NOT EXISTS idx_errors_type_time ON playback_errors(error_type, occurred_at DESC);

    CREATE TABLE IF NOT EXISTS bandwidth_samples (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      throughput_kbps INTEGER NOT NULL,
      latency_ms INTEGER,
      sampled_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bw_session_time
      ON bandwidth_samples(session_id, sampled_at DESC);
  `);
}

// ---- Sessions ----

export interface StartSessionInput {
  user_id?: string | null;
  video_id: string;
  quality?: string | null;
  cdn?: string | null;
  player_version?: string | null;
  platform?: string | null;
}

export function startSession(input: StartSessionInput): PlaybackSession {
  if (!input.video_id?.trim()) throw new Error('video_id required');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO playback_sessions
      (id, user_id, video_id, quality, started_at, created_at,
       cdn, player_version, platform)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.user_id ?? null, input.video_id, input.quality ?? null,
    now, now, input.cdn ?? null, input.player_version ?? null, input.platform ?? null
  );
  return getSession(id)!;
}

export function getSession(id: string): PlaybackSession | null {
  const row = getDb().prepare('SELECT * FROM playback_sessions WHERE id = ?')
    .get(id) as PlaybackSession | undefined;
  return row ?? null;
}

export interface EndSessionInput {
  duration_ms?: number;
  rebuffer_ms?: number;
  rebuffer_count?: number;
  startup_ms?: number;
  avg_bitrate_kbps?: number;
  bitrate_switches?: number;
  bytes_streamed?: number;
  end_reason?: PlaybackEndReason;
}

export function endSession(id: string, patch: EndSessionInput): PlaybackSession | null {
  const s = getSession(id);
  if (!s) return null;
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE playback_sessions SET
      ended_at = ?,
      end_reason = ?,
      duration_ms = ?,
      rebuffer_ms = ?,
      rebuffer_count = ?,
      startup_ms = ?,
      avg_bitrate_kbps = ?,
      bitrate_switches = ?,
      bytes_streamed = ?
    WHERE id = ?
  `).run(
    now,
    patch.end_reason ?? s.end_reason ?? 'unknown',
    Math.max(0, patch.duration_ms ?? s.duration_ms),
    Math.max(0, patch.rebuffer_ms ?? s.rebuffer_ms),
    Math.max(0, patch.rebuffer_count ?? s.rebuffer_count),
    Math.max(0, patch.startup_ms ?? s.startup_ms),
    Math.max(0, patch.avg_bitrate_kbps ?? s.avg_bitrate_kbps),
    Math.max(0, patch.bitrate_switches ?? s.bitrate_switches),
    Math.max(0, patch.bytes_streamed ?? s.bytes_streamed),
    id
  );
  return getSession(id);
}

// ---- Errors ----

export interface RecordErrorInput {
  session_id: string;
  error_type?: PlaybackErrorType;
  error_code?: string | null;
  message?: string | null;
  fatal?: boolean;
  at_position_ms?: number;
}

export function recordError(input: RecordErrorInput): PlaybackError {
  const s = getSession(input.session_id);
  if (!s) throw new Error('Session not found');
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO playback_errors
      (id, session_id, error_type, error_code, message, fatal,
       at_position_ms, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.session_id, input.error_type ?? 'unknown',
    input.error_code ?? null, input.message?.slice(0, 1000) ?? null,
    input.fatal ? 1 : 0, Math.max(0, input.at_position_ms ?? 0), now
  );
  return db.prepare('SELECT * FROM playback_errors WHERE id = ?')
    .get(id) as PlaybackError;
}

export function listErrors(sessionId: string): PlaybackError[] {
  return getDb().prepare(
    'SELECT * FROM playback_errors WHERE session_id = ? ORDER BY occurred_at ASC'
  ).all(sessionId) as PlaybackError[];
}

// ---- Bandwidth ----

export interface RecordBandwidthInput {
  session_id: string;
  throughput_kbps: number;
  latency_ms?: number | null;
}

export function recordBandwidth(input: RecordBandwidthInput): BandwidthSample {
  const s = getSession(input.session_id);
  if (!s) throw new Error('Session not found');
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO bandwidth_samples
      (id, session_id, throughput_kbps, latency_ms, sampled_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, input.session_id, Math.max(0, input.throughput_kbps), input.latency_ms ?? null, now);
  return db.prepare('SELECT * FROM bandwidth_samples WHERE id = ?')
    .get(id) as BandwidthSample;
}

export function recentBandwidth(sessionId: string, limit = 20): BandwidthSample[] {
  return getDb().prepare(`
    SELECT * FROM bandwidth_samples
    WHERE session_id = ?
    ORDER BY sampled_at DESC LIMIT ?
  `).all(sessionId, Math.max(1, Math.min(limit, 500))) as BandwidthSample[];
}

// ---- QoE metrics (42.5) ----

export interface QoeMetrics {
  window_start: string;
  window_end: string;
  session_count: number;
  avg_startup_ms: number;
  avg_rebuffer_ratio: number;
  avg_bitrate_kbps: number;
  avg_switches_per_session: number;
  fatal_error_rate: number;
  total_errors: number;
  sessions_with_errors: number;
}

export interface QoeQuery {
  video_id?: string;
  user_id?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export function getQoeMetrics(q: QoeQuery = {}): QoeMetrics {
  const db = getDb();
  const to = q.to ?? new Date().toISOString();
  const from = q.from ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const where: string[] = ['started_at >= ?', 'started_at <= ?'];
  const params: any[] = [from, to];
  if (q.video_id) { where.push('video_id = ?'); params.push(q.video_id); }
  if (q.user_id)  { where.push('user_id = ?');  params.push(q.user_id); }

  const row = db.prepare(`
    SELECT
      COUNT(*) as session_count,
      COALESCE(AVG(startup_ms), 0) as avg_startup_ms,
      COALESCE(AVG(CASE WHEN duration_ms > 0
        THEN 1.0 * rebuffer_ms / duration_ms ELSE 0 END), 0) as avg_rebuffer_ratio,
      COALESCE(AVG(avg_bitrate_kbps), 0) as avg_bitrate_kbps,
      COALESCE(AVG(bitrate_switches), 0) as avg_switches,
      COALESCE(SUM(CASE WHEN end_reason = 'error' THEN 1 ELSE 0 END), 0) as error_sessions,
      COALESCE(SUM(rebuffer_count), 0) as total_rebuffers
    FROM playback_sessions
    WHERE ${where.join(' AND ')}
  `).get(...params) as any;

  const errRow = db.prepare(`
    SELECT
      COUNT(*) as total_errors,
      COUNT(DISTINCT session_id) as sessions_with_errors,
      SUM(CASE WHEN fatal = 1 THEN 1 ELSE 0 END) as fatal_count
    FROM playback_errors
    WHERE occurred_at >= ? AND occurred_at <= ?
      ${q.video_id ? "AND session_id IN (SELECT id FROM playback_sessions WHERE video_id = ?)" : ""}
  `).get(...[from, to, ...(q.video_id ? [q.video_id] : [])]) as any;

  const sessions = row.session_count || 0;
  return {
    window_start: from,
    window_end: to,
    session_count: sessions,
    avg_startup_ms: Math.round(row.avg_startup_ms ?? 0),
    avg_rebuffer_ratio: Number((row.avg_rebuffer_ratio ?? 0).toFixed(4)),
    avg_bitrate_kbps: Math.round(row.avg_bitrate_kbps ?? 0),
    avg_switches_per_session: Number((row.avg_switches ?? 0).toFixed(2)),
    fatal_error_rate: sessions > 0 ? Number(((errRow.fatal_count ?? 0) / sessions).toFixed(4)) : 0,
    total_errors: errRow.total_errors ?? 0,
    sessions_with_errors: errRow.sessions_with_errors ?? 0,
  };
}

// ---- Per-video breakdown ----

export function topProblemsByVideo(opts: {
  from?: string;
  to?: string;
  limit?: number;
} = {}): {
  video_id: string;
  sessions: number;
  avg_rebuffer_ratio: number;
  fatal_errors: number;
  avg_startup_ms: number;
}[] {
  const db = getDb();
  const from = opts.from ?? new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const to = opts.to ?? new Date().toISOString();
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200);
  return db.prepare(`
    SELECT
      video_id,
      COUNT(*) as sessions,
      COALESCE(AVG(CASE WHEN duration_ms > 0
        THEN 1.0 * rebuffer_ms / duration_ms ELSE 0 END), 0) as avg_rebuffer_ratio,
      COALESCE(SUM(CASE WHEN end_reason = 'error' THEN 1 ELSE 0 END), 0) as fatal_errors,
      COALESCE(AVG(startup_ms), 0) as avg_startup_ms
    FROM playback_sessions
    WHERE started_at >= ? AND started_at <= ?
    GROUP BY video_id
    HAVING sessions >= 3
    ORDER BY avg_rebuffer_ratio DESC, fatal_errors DESC
    LIMIT ?
  `).all(from, to, limit) as any[];
}
