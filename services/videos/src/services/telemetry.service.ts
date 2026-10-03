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

// ============================================================
// 42.1 Pre-Buffering
// 42.2 Network-Adaptive Streaming
// 42.6 Buffering Alert
// 42.8 CDN Switching
// 42.10 MPEG-DASH
// ============================================================

export interface StreamingConfig {
  video_id: string;
  owner_id: string;
  // 42.1 Pre-Buffering
  prebuffer_segments: number;
  prebuffer_max_ms: number;
  // 42.2 Adaptive
  abr_enabled: number;
  abr_min_kbps: number;
  abr_max_kbps: number;
  abr_buffer_target_s: number;
  // 42.6 Alert
  alert_rebuffer_ms_threshold: number;
  alert_fatal_error_threshold: number;
  alert_webhook_url: string | null;
  // 42.8 CDN
  cdn_priority: string; // JSON array
  cdn_fallback_enabled: number;
  // 42.10 DASH
  dash_manifest_url: string | null;
  hls_manifest_url: string | null;
  preferred_protocol: 'hls' | 'dash' | 'auto';
  updated_at: string;
}

export function ensureStreamingConfigSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS streaming_configs (
      video_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      prebuffer_segments INTEGER NOT NULL DEFAULT 2,
      prebuffer_max_ms INTEGER NOT NULL DEFAULT 3000,
      abr_enabled INTEGER NOT NULL DEFAULT 1,
      abr_min_kbps INTEGER NOT NULL DEFAULT 300,
      abr_max_kbps INTEGER NOT NULL DEFAULT 20000,
      abr_buffer_target_s REAL NOT NULL DEFAULT 12,
      alert_rebuffer_ms_threshold INTEGER NOT NULL DEFAULT 30000,
      alert_fatal_error_threshold INTEGER NOT NULL DEFAULT 3,
      alert_webhook_url TEXT,
      cdn_priority TEXT NOT NULL DEFAULT '["primary","secondary"]',
      cdn_fallback_enabled INTEGER NOT NULL DEFAULT 1,
      dash_manifest_url TEXT,
      hls_manifest_url TEXT,
      preferred_protocol TEXT NOT NULL DEFAULT 'auto'
        CHECK (preferred_protocol IN ('hls','dash','auto')),
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stream_cfg_owner ON streaming_configs(owner_id);

    CREATE TABLE IF NOT EXISTS cdn_endpoints (
      id TEXT PRIMARY KEY,
      video_id TEXT,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 100,
      region TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_status TEXT,
      last_checked_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cdn_video_priority
      ON cdn_endpoints(video_id, priority, is_active);

    CREATE TABLE IF NOT EXISTS buffering_alerts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
      rebuffer_ms INTEGER NOT NULL DEFAULT 0,
      fatal_errors INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      acknowledged INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_video_time
      ON buffering_alerts(video_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alerts_unack
      ON buffering_alerts(acknowledged, created_at DESC);
  `);
}

// Defaults helper (used when a video has no explicit config)
const DEFAULTS: Omit<StreamingConfig, 'video_id' | 'owner_id' | 'dash_manifest_url' | 'hls_manifest_url' | 'alert_webhook_url' | 'updated_at'> = {
  prebuffer_segments: 2,
  prebuffer_max_ms: 3000,
  abr_enabled: 1,
  abr_min_kbps: 300,
  abr_max_kbps: 20000,
  abr_buffer_target_s: 12,
  alert_rebuffer_ms_threshold: 30000,
  alert_fatal_error_threshold: 3,
  cdn_priority: '["primary","secondary"]',
  cdn_fallback_enabled: 1,
  preferred_protocol: 'auto',
};

export function getStreamingConfig(videoId: string): StreamingConfig | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM streaming_configs WHERE video_id = ?')
    .get(videoId) as StreamingConfig | undefined;
  return row ?? null;
}

export function getEffectiveStreamingConfig(videoId: string): StreamingConfig {
  const db = getDb();
  const row = db.prepare('SELECT * FROM streaming_configs WHERE video_id = ?')
    .get(videoId) as StreamingConfig | undefined;
  if (row) return row;

  // Fallback: inherit from the video's HLS URL if present
  const v = db.prepare('SELECT owner_id, hls_master_url FROM videos WHERE id = ?')
    .get(videoId) as { owner_id: string; hls_master_url: string | null } | undefined;
  if (!v) throw new Error('Video not found');

  return {
    video_id: videoId,
    owner_id: v.owner_id,
    ...DEFAULTS,
    dash_manifest_url: null,
    hls_manifest_url: v.hls_master_url,
    alert_webhook_url: null,
    updated_at: new Date().toISOString(),
  };
}

export interface UpsertStreamingConfigInput {
  video_id: string;
  owner_id: string;
  prebuffer_segments?: number;
  prebuffer_max_ms?: number;
  abr_enabled?: boolean;
  abr_min_kbps?: number;
  abr_max_kbps?: number;
  abr_buffer_target_s?: number;
  alert_rebuffer_ms_threshold?: number;
  alert_fatal_error_threshold?: number;
  alert_webhook_url?: string | null;
  cdn_priority?: string[];
  cdn_fallback_enabled?: boolean;
  dash_manifest_url?: string | null;
  hls_manifest_url?: string | null;
  preferred_protocol?: 'hls' | 'dash' | 'auto';
}

export function upsertStreamingConfig(input: UpsertStreamingConfigInput): StreamingConfig {
  const db = getDb();
  const v = db.prepare('SELECT owner_id FROM videos WHERE id = ?')
    .get(input.video_id) as { owner_id: string } | undefined;
  if (!v) throw new Error('Video not found');
  if (v.owner_id !== input.owner_id) throw new Error('Not your video');

  if (input.abr_min_kbps !== undefined && input.abr_max_kbps !== undefined &&
      input.abr_min_kbps > input.abr_max_kbps) {
    throw new Error('abr_min_kbps must be <= abr_max_kbps');
  }

  const now = new Date().toISOString();
  const cur = getStreamingConfig(input.video_id);

  const merged = {
    prebuffer_segments: input.prebuffer_segments ?? cur?.prebuffer_segments ?? DEFAULTS.prebuffer_segments,
    prebuffer_max_ms: input.prebuffer_max_ms ?? cur?.prebuffer_max_ms ?? DEFAULTS.prebuffer_max_ms,
    abr_enabled: input.abr_enabled === undefined ? (cur?.abr_enabled ?? DEFAULTS.abr_enabled) : (input.abr_enabled ? 1 : 0),
    abr_min_kbps: input.abr_min_kbps ?? cur?.abr_min_kbps ?? DEFAULTS.abr_min_kbps,
    abr_max_kbps: input.abr_max_kbps ?? cur?.abr_max_kbps ?? DEFAULTS.abr_max_kbps,
    abr_buffer_target_s: input.abr_buffer_target_s ?? cur?.abr_buffer_target_s ?? DEFAULTS.abr_buffer_target_s,
    alert_rebuffer_ms_threshold: input.alert_rebuffer_ms_threshold ?? cur?.alert_rebuffer_ms_threshold ?? DEFAULTS.alert_rebuffer_ms_threshold,
    alert_fatal_error_threshold: input.alert_fatal_error_threshold ?? cur?.alert_fatal_error_threshold ?? DEFAULTS.alert_fatal_error_threshold,
    alert_webhook_url: input.alert_webhook_url === undefined ? (cur?.alert_webhook_url ?? null) : input.alert_webhook_url,
    cdn_priority: input.cdn_priority ? JSON.stringify(input.cdn_priority) : (cur?.cdn_priority ?? DEFAULTS.cdn_priority),
    cdn_fallback_enabled: input.cdn_fallback_enabled === undefined ? (cur?.cdn_fallback_enabled ?? DEFAULTS.cdn_fallback_enabled) : (input.cdn_fallback_enabled ? 1 : 0),
    dash_manifest_url: input.dash_manifest_url === undefined ? (cur?.dash_manifest_url ?? null) : input.dash_manifest_url,
    hls_manifest_url: input.hls_manifest_url === undefined ? (cur?.hls_manifest_url ?? null) : input.hls_manifest_url,
    preferred_protocol: input.preferred_protocol ?? cur?.preferred_protocol ?? DEFAULTS.preferred_protocol,
  };

  db.prepare(`
    INSERT INTO streaming_configs
      (video_id, owner_id, prebuffer_segments, prebuffer_max_ms,
       abr_enabled, abr_min_kbps, abr_max_kbps, abr_buffer_target_s,
       alert_rebuffer_ms_threshold, alert_fatal_error_threshold, alert_webhook_url,
       cdn_priority, cdn_fallback_enabled,
       dash_manifest_url, hls_manifest_url, preferred_protocol, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id) DO UPDATE SET
      prebuffer_segments = excluded.prebuffer_segments,
      prebuffer_max_ms = excluded.prebuffer_max_ms,
      abr_enabled = excluded.abr_enabled,
      abr_min_kbps = excluded.abr_min_kbps,
      abr_max_kbps = excluded.abr_max_kbps,
      abr_buffer_target_s = excluded.abr_buffer_target_s,
      alert_rebuffer_ms_threshold = excluded.alert_rebuffer_ms_threshold,
      alert_fatal_error_threshold = excluded.alert_fatal_error_threshold,
      alert_webhook_url = excluded.alert_webhook_url,
      cdn_priority = excluded.cdn_priority,
      cdn_fallback_enabled = excluded.cdn_fallback_enabled,
      dash_manifest_url = excluded.dash_manifest_url,
      hls_manifest_url = excluded.hls_manifest_url,
      preferred_protocol = excluded.preferred_protocol,
      updated_at = excluded.updated_at
  `).run(
    input.video_id, input.owner_id,
    merged.prebuffer_segments, merged.prebuffer_max_ms,
    merged.abr_enabled, merged.abr_min_kbps, merged.abr_max_kbps, merged.abr_buffer_target_s,
    merged.alert_rebuffer_ms_threshold, merged.alert_fatal_error_threshold, merged.alert_webhook_url,
    merged.cdn_priority, merged.cdn_fallback_enabled,
    merged.dash_manifest_url, merged.hls_manifest_url, merged.preferred_protocol,
    now
  );

  return getStreamingConfig(input.video_id)!;
}

// ---- CDN endpoints (42.8) ----

export interface CdnEndpoint {
  id: string;
  video_id: string | null;
  name: string;
  base_url: string;
  priority: number;
  region: string | null;
  is_active: number;
  last_status: string | null;
  last_checked_at: string | null;
  created_at: string;
}

export function ensureCdnEndpoint(input: {
  video_id?: string | null;
  name: string;
  base_url: string;
  priority?: number;
  region?: string | null;
}): CdnEndpoint {
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO cdn_endpoints
      (id, video_id, name, base_url, priority, region, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    id, input.video_id ?? null, input.name.slice(0, 80), input.base_url,
    input.priority ?? 100, input.region ?? null, now
  );
  return db.prepare('SELECT * FROM cdn_endpoints WHERE id = ?').get(id) as CdnEndpoint;
}

export function listCdnEndpoints(videoId: string | null, region?: string): CdnEndpoint[] {
  const db = getDb();
  const where: string[] = ['is_active = 1'];
  const params: any[] = [];
  if (videoId) { where.push('(video_id IS NULL OR video_id = ?)'); params.push(videoId); }
  else { where.push('video_id IS NULL'); }
  if (region) { where.push('(region IS NULL OR region = ?)'); params.push(region); }
  return db.prepare(`
    SELECT * FROM cdn_endpoints
    WHERE ${where.join(' AND ')}
    ORDER BY priority ASC, name ASC
  `).all(...params) as CdnEndpoint[];
}

export function markCdnStatus(id: string, status: string): void {
  getDb().prepare('UPDATE cdn_endpoints SET last_status = ?, last_checked_at = ? WHERE id = ?')
    .run(status, new Date().toISOString(), id);
}

// Given config + region, decide CDN and protocol
export interface PlaybackDirective {
  video_id: string;
  protocol: 'hls' | 'dash';
  manifest_url: string | null;
  cdn_name: string | null;
  cdn_base_url: string | null;
  fallback_cdns: string[];
  prebuffer_segments: number;
  prebuffer_max_ms: number;
  abr: { enabled: boolean; min_kbps: number; max_kbps: number; buffer_target_s: number };
}

export function getPlaybackDirective(videoId: string, region?: string): PlaybackDirective {
  const cfg = getEffectiveStreamingConfig(videoId);

  // Prefer DASH if explicitly preferred, else HLS when available, else DASH.
  let protocol: 'hls' | 'dash';
  let manifestUrl: string | null;
  if (cfg.preferred_protocol === 'dash') {
    protocol = 'dash'; manifestUrl = cfg.dash_manifest_url;
  } else if (cfg.preferred_protocol === 'hls') {
    protocol = 'hls'; manifestUrl = cfg.hls_manifest_url;
  } else {
    if (cfg.hls_manifest_url) { protocol = 'hls'; manifestUrl = cfg.hls_manifest_url; }
    else if (cfg.dash_manifest_url) { protocol = 'dash'; manifestUrl = cfg.dash_manifest_url; }
    else { protocol = 'hls'; manifestUrl = null; }
  }

  const cdns = listCdnEndpoints(videoId, region);
  const primary = cdns[0] ?? null;
  const fallback = cdns.slice(1).map((c) => c.name);

  return {
    video_id: videoId,
    protocol,
    manifest_url: manifestUrl,
    cdn_name: primary?.name ?? null,
    cdn_base_url: primary?.base_url ?? null,
    fallback_cdns: cfg.cdn_fallback_enabled ? fallback : [],
    prebuffer_segments: cfg.prebuffer_segments,
    prebuffer_max_ms: cfg.prebuffer_max_ms,
    abr: {
      enabled: cfg.abr_enabled === 1,
      min_kbps: cfg.abr_min_kbps,
      max_kbps: cfg.abr_max_kbps,
      buffer_target_s: cfg.abr_buffer_target_s,
    },
  };
}

// ---- Buffering alerts (42.6) ----

export interface BufferingAlert {
  id: string;
  session_id: string;
  video_id: string;
  severity: 'low' | 'medium' | 'high';
  rebuffer_ms: number;
  fatal_errors: number;
  message: string | null;
  acknowledged: number;
  created_at: string;
}

export function evaluateSessionForAlert(sessionId: string): BufferingAlert | null {
  const s = getSession(sessionId);
  if (!s) return null;
  const cfg = getEffectiveStreamingConfig(s.video_id);
  const errors = listErrors(sessionId);
  const fatal = errors.filter((e) => e.fatal === 1).length;

  const rebufferBreach = s.rebuffer_ms >= cfg.alert_rebuffer_ms_threshold;
  const errorBreach = fatal >= cfg.alert_fatal_error_threshold;
  if (!rebufferBreach && !errorBreach) return null;

  let severity: BufferingAlert['severity'] = 'low';
  if (errorBreach || s.rebuffer_ms >= cfg.alert_rebuffer_ms_threshold * 2) severity = 'high';
  else if (rebufferBreach) severity = 'medium';

  const message = [
    rebufferBreach ? `rebuffer_ms=${s.rebuffer_ms} >= ${cfg.alert_rebuffer_ms_threshold}` : null,
    errorBreach ? `fatal_errors=${fatal} >= ${cfg.alert_fatal_error_threshold}` : null,
  ].filter(Boolean).join('; ');

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO buffering_alerts
      (id, session_id, video_id, severity, rebuffer_ms, fatal_errors, message, acknowledged, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(id, sessionId, s.video_id, severity, s.rebuffer_ms, fatal, message, now);

  return db.prepare('SELECT * FROM buffering_alerts WHERE id = ?').get(id) as BufferingAlert;
}

export function listAlerts(opts: {
  video_id?: string;
  unacknowledged_only?: boolean;
  limit?: number;
} = {}): BufferingAlert[] {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];
  if (opts.video_id) { where.push('video_id = ?'); params.push(opts.video_id); }
  if (opts.unacknowledged_only) where.push('acknowledged = 0');
  const n = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  params.push(n);
  return db.prepare(`
    SELECT * FROM buffering_alerts
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT ?
  `).all(...params) as BufferingAlert[];
}

export function acknowledgeAlert(id: string): boolean {
  return getDb().prepare('UPDATE buffering_alerts SET acknowledged = 1 WHERE id = ?')
    .run(id).changes > 0;
}
