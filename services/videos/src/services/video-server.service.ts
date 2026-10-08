// melodyflix videos - video server management (Section 52)
//
// Multi-server origin/edge fleet: registry, health, replication,
// capacity, load-balancing, failover, config sync.

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export function ensureVideoServerSchema(): void {
  const db = getDb();
  db.exec(`
    -- 52.1 Server registry
    CREATE TABLE IF NOT EXISTS video_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,              -- 'origin' | 'edge' | 'worker' | 'backup'
      region TEXT,
      base_url TEXT NOT NULL,
      streaming_url TEXT,
      api_key_hash TEXT,
      headers_json TEXT NOT NULL DEFAULT '{}',
      priority INTEGER NOT NULL DEFAULT 100,
      weight INTEGER NOT NULL DEFAULT 1,
      max_bandwidth_mbps INTEGER NOT NULL DEFAULT 1000,
      max_storage_gb INTEGER NOT NULL DEFAULT 1000,
      enabled INTEGER NOT NULL DEFAULT 1,
      health_status TEXT NOT NULL DEFAULT 'unknown',  -- unknown|healthy|degraded|down
      last_heartbeat_at TEXT,
      last_latency_ms INTEGER,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      config_json TEXT NOT NULL DEFAULT '{}',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vs_role ON video_servers(role);
    CREATE INDEX IF NOT EXISTS idx_vs_region ON video_servers(region);
    CREATE INDEX IF NOT EXISTS idx_vs_health ON video_servers(health_status);
    CREATE INDEX IF NOT EXISTS idx_vs_priority ON video_servers(priority);

    -- 52.2 Health check log
    CREATE TABLE IF NOT EXISTS video_server_health_log (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      check_type TEXT NOT NULL DEFAULT 'heartbeat',
      status TEXT NOT NULL,
      latency_ms INTEGER,
      http_code INTEGER,
      error_text TEXT,
      cpu_pct REAL,
      memory_pct REAL,
      disk_pct REAL,
      bandwidth_mbps REAL,
      active_streams INTEGER,
      checked_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vshl_server ON video_server_health_log(server_id);
    CREATE INDEX IF NOT EXISTS idx_vshl_time ON video_server_health_log(checked_at);

    -- 52.3 Video replication
    CREATE TABLE IF NOT EXISTS video_server_replicas (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',  -- pending|syncing|ready|stale|failed
      file_path TEXT,
      file_size_bytes INTEGER NOT NULL DEFAULT 0,
      hls_path TEXT,
      checksum_sha256 TEXT,
      replicated_at TEXT,
      last_verified_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(video_id, server_id)
    );
    CREATE INDEX IF NOT EXISTS idx_vsr_video ON video_server_replicas(video_id);
    CREATE INDEX IF NOT EXISTS idx_vsr_server ON video_server_replicas(server_id);
    CREATE INDEX IF NOT EXISTS idx_vsr_status ON video_server_replicas(status);

    -- 52.5 Load balancing decisions
    CREATE TABLE IF NOT EXISTS video_server_routing_log (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      user_id TEXT,
      strategy TEXT NOT NULL,
      chosen_server_id TEXT,
      candidates_json TEXT NOT NULL DEFAULT '[]',
      client_ip TEXT,
      client_country TEXT,
      reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vsrl_video ON video_server_routing_log(video_id);
    CREATE INDEX IF NOT EXISTS idx_vsrl_server ON video_server_routing_log(chosen_server_id);

    -- 52.4 Capacity snapshots
    CREATE TABLE IF NOT EXISTS video_server_capacity (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      disk_used_gb REAL NOT NULL DEFAULT 0,
      disk_total_gb REAL NOT NULL DEFAULT 0,
      bandwidth_used_mbps REAL NOT NULL DEFAULT 0,
      active_streams INTEGER NOT NULL DEFAULT 0,
      snapshot_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vsc_server ON video_server_capacity(server_id);

    -- 52.6 Failover events
    CREATE TABLE IF NOT EXISTS video_server_failover_events (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      from_status TEXT NOT NULL,
      to_status TEXT NOT NULL,
      reason TEXT,
      affected_streams INTEGER NOT NULL DEFAULT 0,
      triggered_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vsfe_server ON video_server_failover_events(server_id);

    -- 52.7 Config sync
    CREATE TABLE IF NOT EXISTS video_server_config_sync (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      applied_at TEXT,
      error_text TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vscs_server ON video_server_config_sync(server_id);
  `);
}

// ---------- 52.1 Server registry ----------

export type ServerRole = 'origin' | 'edge' | 'worker' | 'backup';
export type ServerHealth = 'unknown' | 'healthy' | 'degraded' | 'down';

export interface VideoServer {
  id: string;
  name: string;
  role: ServerRole;
  region: string | null;
  base_url: string;
  streaming_url: string | null;
  api_key_hash: string | null;
  headers: Record<string, string>;
  priority: number;
  weight: number;
  max_bandwidth_mbps: number;
  max_storage_gb: number;
  enabled: boolean;
  health_status: ServerHealth;
  last_heartbeat_at: string | null;
  last_latency_ms: number | null;
  consecutive_failures: number;
  config: Record<string, unknown>;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface VsRow {
  id: string; name: string; role: string; region: string | null;
  base_url: string; streaming_url: string | null; api_key_hash: string | null;
  headers_json: string; priority: number; weight: number;
  max_bandwidth_mbps: number; max_storage_gb: number; enabled: number;
  health_status: string; last_heartbeat_at: string | null;
  last_latency_ms: number | null; consecutive_failures: number;
  config_json: string; notes: string | null;
  created_at: string; updated_at: string;
}

function safeParse<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function vsRowToObj(row: VsRow): VideoServer {
  return {
    id: row.id, name: row.name, role: row.role as ServerRole,
    region: row.region, base_url: row.base_url, streaming_url: row.streaming_url,
    api_key_hash: row.api_key_hash,
    headers: safeParse<Record<string, string>>(row.headers_json, {}),
    priority: row.priority, weight: row.weight,
    max_bandwidth_mbps: row.max_bandwidth_mbps, max_storage_gb: row.max_storage_gb,
    enabled: row.enabled === 1,
    health_status: row.health_status as ServerHealth,
    last_heartbeat_at: row.last_heartbeat_at,
    last_latency_ms: row.last_latency_ms,
    consecutive_failures: row.consecutive_failures,
    config: safeParse<Record<string, unknown>>(row.config_json, {}),
    notes: row.notes,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

const VALID_ROLES: ServerRole[] = ['origin', 'edge', 'worker', 'backup'];

export interface CreateServerInput {
  name: string;
  role: ServerRole;
  base_url: string;
  streaming_url?: string;
  region?: string | null;
  api_key_hash?: string | null;
  headers?: Record<string, string>;
  priority?: number;
  weight?: number;
  max_bandwidth_mbps?: number;
  max_storage_gb?: number;
  enabled?: boolean;
  config?: Record<string, unknown>;
  notes?: string;
}

export function createVideoServer(input: CreateServerInput): VideoServer {
  const db = getDb();
  const name = input.name?.trim();
  if (!name) throw new Error('name required');
  if (!VALID_ROLES.includes(input.role)) throw new Error(`invalid role: ${input.role}`);
  const baseUrl = input.base_url?.trim().replace(/\/+$/, '');
  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) throw new Error('base_url must start with http(s)://');

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO video_servers (id, name, role, region, base_url, streaming_url, api_key_hash,
      headers_json, priority, weight, max_bandwidth_mbps, max_storage_gb, enabled,
      config_json, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, name, input.role, input.region ?? null, baseUrl,
    input.streaming_url ?? null, input.api_key_hash ?? null,
    JSON.stringify(input.headers ?? {}),
    input.priority ?? 100, input.weight ?? 1,
    input.max_bandwidth_mbps ?? 1000, input.max_storage_gb ?? 1000,
    input.enabled === false ? 0 : 1,
    JSON.stringify(input.config ?? {}), input.notes ?? null, now, now,
  );
  return getVideoServer(id)!;
}

export function getVideoServer(id: string): VideoServer | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM video_servers WHERE id = ?').get(id) as VsRow | undefined;
  return row ? vsRowToObj(row) : null;
}

export function listVideoServers(opts: { role?: ServerRole; region?: string; enabledOnly?: boolean; health?: ServerHealth } = {}): VideoServer[] {
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.role) { where.push('role = ?'); params.push(opts.role); }
  if (opts.region) { where.push('region = ?'); params.push(opts.region); }
  if (opts.enabledOnly) where.push('enabled = 1');
  if (opts.health) { where.push('health_status = ?'); params.push(opts.health); }
  const sql = `SELECT * FROM video_servers${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY priority ASC, weight DESC, name ASC`;
  const rows = db.prepare(sql).all(...params) as VsRow[];
  return rows.map(vsRowToObj);
}

export interface UpdateServerInput {
  name?: string;
  role?: ServerRole;
  region?: string | null;
  base_url?: string;
  streaming_url?: string | null;
  api_key_hash?: string | null;
  headers?: Record<string, string>;
  priority?: number;
  weight?: number;
  max_bandwidth_mbps?: number;
  max_storage_gb?: number;
  enabled?: boolean;
  config?: Record<string, unknown>;
  notes?: string | null;
}

export function updateVideoServer(id: string, patch: UpdateServerInput): VideoServer | null {
  const db = getDb();
  const cur = getVideoServer(id);
  if (!cur) return null;
  if (patch.role && !VALID_ROLES.includes(patch.role)) throw new Error('invalid role');
  const baseUrl = patch.base_url !== undefined ? patch.base_url.trim().replace(/\/+$/, '') : cur.base_url;
  if (patch.base_url !== undefined && !/^https?:\/\//i.test(baseUrl)) {
    throw new Error('base_url must start with http(s)://');
  }
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE video_servers SET name = ?, role = ?, region = ?, base_url = ?, streaming_url = ?,
      api_key_hash = ?, headers_json = ?, priority = ?, weight = ?,
      max_bandwidth_mbps = ?, max_storage_gb = ?, enabled = ?, config_json = ?, notes = ?, updated_at = ?
    WHERE id = ?
  `).run(
    patch.name?.trim() || cur.name,
    patch.role ?? cur.role,
    patch.region !== undefined ? patch.region : cur.region,
    baseUrl,
    patch.streaming_url !== undefined ? patch.streaming_url : cur.streaming_url,
    patch.api_key_hash !== undefined ? patch.api_key_hash : cur.api_key_hash,
    JSON.stringify(patch.headers ?? cur.headers),
    patch.priority ?? cur.priority, patch.weight ?? cur.weight,
    patch.max_bandwidth_mbps ?? cur.max_bandwidth_mbps,
    patch.max_storage_gb ?? cur.max_storage_gb,
    patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : (cur.enabled ? 1 : 0),
    JSON.stringify(patch.config ?? cur.config),
    patch.notes !== undefined ? patch.notes : cur.notes,
    now, id,
  );
  return getVideoServer(id);
}

export function deleteVideoServer(id: string): boolean {
  const db = getDb();
  // cascades
  db.prepare('DELETE FROM video_server_replicas WHERE server_id = ?').run(id);
  db.prepare('DELETE FROM video_server_health_log WHERE server_id = ?').run(id);
  db.prepare('DELETE FROM video_server_capacity WHERE server_id = ?').run(id);
  return db.prepare('DELETE FROM video_servers WHERE id = ?').run(id).changes > 0;
}

// ---------- 52.2 Health monitoring ----------

export interface HealthLog {
  id: string;
  server_id: string;
  check_type: string;
  status: string;
  latency_ms: number | null;
  http_code: number | null;
  error_text: string | null;
  cpu_pct: number | null;
  memory_pct: number | null;
  disk_pct: number | null;
  bandwidth_mbps: number | null;
  active_streams: number | null;
  checked_at: string;
}

interface HlRow {
  id: string; server_id: string; check_type: string; status: string;
  latency_ms: number | null; http_code: number | null; error_text: string | null;
  cpu_pct: number | null; memory_pct: number | null; disk_pct: number | null;
  bandwidth_mbps: number | null; active_streams: number | null; checked_at: string;
}

function hlRowToObj(row: HlRow): HealthLog {
  return { ...row };
}

export interface RecordHealthInput {
  server_id: string;
  status: 'healthy' | 'degraded' | 'down' | 'unknown';
  check_type?: string;
  latency_ms?: number;
  http_code?: number;
  error_text?: string;
  cpu_pct?: number;
  memory_pct?: number;
  disk_pct?: number;
  bandwidth_mbps?: number;
  active_streams?: number;
}

/**
 * Record a health check result and update server record.
 * Auto-transitions health_status. Fires failover event on down.
 */
export function recordHealthCheck(input: RecordHealthInput): { log: HealthLog; server: VideoServer; failover_triggered: boolean } {
  const db = getDb();
  const server = getVideoServer(input.server_id);
  if (!server) throw new Error('server not found');

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO video_server_health_log (id, server_id, check_type, status, latency_ms, http_code,
      error_text, cpu_pct, memory_pct, disk_pct, bandwidth_mbps, active_streams, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.server_id, input.check_type ?? 'heartbeat',
    input.status, input.latency_ms ?? null, input.http_code ?? null,
    input.error_text ?? null, input.cpu_pct ?? null, input.memory_pct ?? null,
    input.disk_pct ?? null, input.bandwidth_mbps ?? null,
    input.active_streams ?? null, now,
  );

  const prevStatus = server.health_status;
  const isHealthy = input.status === 'healthy';
  const newFailures = isHealthy ? 0 : server.consecutive_failures + 1;

  let newHealth: ServerHealth = server.health_status;
  if (input.status === 'healthy') newHealth = 'healthy';
  else if (input.status === 'degraded') newHealth = 'degraded';
  else if (input.status === 'down') newHealth = 'down';

  db.prepare(`
    UPDATE video_servers SET health_status = ?, last_heartbeat_at = ?,
      last_latency_ms = ?, consecutive_failures = ?, updated_at = ?
    WHERE id = ?
  `).run(newHealth, now, input.latency_ms ?? server.last_latency_ms, newFailures, now, input.server_id);

  // failover event if transitioning to 'down'
  let failoverTriggered = false;
  if (newHealth === 'down' && prevStatus !== 'down') {
    failoverTriggered = true;
    db.prepare(`
      INSERT INTO video_server_failover_events (id, server_id, from_status, to_status, reason, affected_streams, triggered_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), input.server_id, prevStatus, 'down',
      input.error_text ?? 'health check failed',
      input.active_streams ?? 0, 'auto', now,
    );
  }

  return {
    log: hlRowToObj(db.prepare('SELECT * FROM video_server_health_log WHERE id = ?').get(id) as HlRow),
    server: getVideoServer(input.server_id)!,
    failover_triggered: failoverTriggered,
  };
}

export function listHealthLog(serverId: string, limit = 50): HealthLog[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM video_server_health_log WHERE server_id = ? ORDER BY checked_at DESC LIMIT ?'
  ).all(serverId, limit) as HlRow[];
  return rows.map(hlRowToObj);
}

export function listFailoverEvents(opts: { server_id?: string; limit?: number } = {}): Array<{
  id: string; server_id: string; from_status: string; to_status: string;
  reason: string | null; affected_streams: number; triggered_by: string | null; created_at: string;
}> {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 100, 500);
  if (opts.server_id) {
    return db.prepare(
      'SELECT * FROM video_server_failover_events WHERE server_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(opts.server_id, limit) as any[];
  }
  return db.prepare(
    'SELECT * FROM video_server_failover_events ORDER BY created_at DESC LIMIT ?'
  ).all(limit) as any[];
}

// ---------- 52.3 Video replication ----------

export type ReplicaStatus = 'pending' | 'syncing' | 'ready' | 'stale' | 'failed';

export interface VideoReplica {
  id: string;
  video_id: string;
  server_id: string;
  status: ReplicaStatus;
  file_path: string | null;
  file_size_bytes: number;
  hls_path: string | null;
  checksum_sha256: string | null;
  replicated_at: string | null;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

interface VrRow {
  id: string; video_id: string; server_id: string; status: string;
  file_path: string | null; file_size_bytes: number; hls_path: string | null;
  checksum_sha256: string | null; replicated_at: string | null;
  last_verified_at: string | null; created_at: string; updated_at: string;
}

function vrRowToObj(row: VrRow): VideoReplica {
  return {
    id: row.id, video_id: row.video_id, server_id: row.server_id,
    status: row.status as ReplicaStatus,
    file_path: row.file_path, file_size_bytes: row.file_size_bytes,
    hls_path: row.hls_path, checksum_sha256: row.checksum_sha256,
    replicated_at: row.replicated_at, last_verified_at: row.last_verified_at,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

export function createReplica(input: {
  video_id: string;
  server_id: string;
  status?: ReplicaStatus;
  file_path?: string;
  file_size_bytes?: number;
  hls_path?: string;
  checksum_sha256?: string;
}): VideoReplica {
  const db = getDb();
  if (!getVideoServer(input.server_id)) throw new Error('server not found');
  const now = new Date().toISOString();
  const existing = db.prepare(
    'SELECT * FROM video_server_replicas WHERE video_id = ? AND server_id = ?'
  ).get(input.video_id, input.server_id) as VrRow | undefined;
  if (existing) {
    db.prepare(`
      UPDATE video_server_replicas SET status = ?, file_path = ?, file_size_bytes = ?,
        hls_path = ?, checksum_sha256 = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.status ?? existing.status,
      input.file_path ?? existing.file_path,
      input.file_size_bytes ?? existing.file_size_bytes,
      input.hls_path ?? existing.hls_path,
      input.checksum_sha256 ?? existing.checksum_sha256,
      now, existing.id,
    );
    return vrRowToObj(db.prepare('SELECT * FROM video_server_replicas WHERE id = ?').get(existing.id) as VrRow);
  }
  const id = randomUUID();
  db.prepare(`
    INSERT INTO video_server_replicas (id, video_id, server_id, status, file_path, file_size_bytes,
      hls_path, checksum_sha256, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.video_id, input.server_id,
    input.status ?? 'pending', input.file_path ?? null,
    input.file_size_bytes ?? 0, input.hls_path ?? null,
    input.checksum_sha256 ?? null, now, now,
  );
  return vrRowToObj(db.prepare('SELECT * FROM video_server_replicas WHERE id = ?').get(id) as VrRow);
}

export function updateReplicaStatus(id: string, status: ReplicaStatus, extras?: {
  checksum_sha256?: string; hls_path?: string; file_size_bytes?: number;
}): VideoReplica | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM video_server_replicas WHERE id = ?').get(id) as VrRow | undefined;
  if (!row) return null;
  const now = new Date().toISOString();
  const replicatedAt = status === 'ready' ? now : row.replicated_at;
  const verifiedAt = status === 'ready' ? now : row.last_verified_at;
  db.prepare(`
    UPDATE video_server_replicas SET status = ?, replicated_at = ?, last_verified_at = ?,
      checksum_sha256 = COALESCE(?, checksum_sha256), hls_path = COALESCE(?, hls_path),
      file_size_bytes = COALESCE(?, file_size_bytes), updated_at = ?
    WHERE id = ?
  `).run(
    status, replicatedAt, verifiedAt,
    extras?.checksum_sha256 ?? null, extras?.hls_path ?? null,
    extras?.file_size_bytes ?? null, now, id,
  );
  return vrRowToObj(db.prepare('SELECT * FROM video_server_replicas WHERE id = ?').get(id) as VrRow);
}

export function getReplica(id: string): VideoReplica | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM video_server_replicas WHERE id = ?').get(id) as VrRow | undefined;
  return row ? vrRowToObj(row) : null;
}

export function listReplicasForVideo(videoId: string): Array<VideoReplica & { server: VideoServer | null }> {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM video_server_replicas WHERE video_id = ?').all(videoId) as VrRow[];
  return rows.map((r) => ({ ...vrRowToObj(r), server: getVideoServer(r.server_id) }));
}

export function listReplicasForServer(serverId: string, status?: ReplicaStatus): VideoReplica[] {
  const db = getDb();
  const rows = status
    ? db.prepare('SELECT * FROM video_server_replicas WHERE server_id = ? AND status = ? ORDER BY updated_at DESC').all(serverId, status) as VrRow[]
    : db.prepare('SELECT * FROM video_server_replicas WHERE server_id = ? ORDER BY updated_at DESC').all(serverId) as VrRow[];
  return rows.map(vrRowToObj);
}

export function deleteReplica(id: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM video_server_replicas WHERE id = ?').run(id).changes > 0;
}

/** Count ready replicas per video (for replication factor checks). */
export function replicaCoverage(videoId: string): { ready: number; pending: number; failed: number; servers: string[] } {
  const replicas = listReplicasForVideo(videoId);
  const ready = replicas.filter((r) => r.status === 'ready').length;
  const pending = replicas.filter((r) => r.status === 'pending' || r.status === 'syncing').length;
  const failed = replicas.filter((r) => r.status === 'failed' || r.status === 'stale').length;
  return { ready, pending, failed, servers: replicas.filter((r) => r.status === 'ready').map((r) => r.server_id) };
}

// ---------- 52.4 Capacity ----------

export interface CapacitySnapshot {
  id: string;
  server_id: string;
  disk_used_gb: number;
  disk_total_gb: number;
  bandwidth_used_mbps: number;
  active_streams: number;
  snapshot_at: string;
}

export function recordCapacity(input: {
  server_id: string;
  disk_used_gb?: number; disk_total_gb?: number;
  bandwidth_used_mbps?: number; active_streams?: number;
}): CapacitySnapshot {
  const db = getDb();
  if (!getVideoServer(input.server_id)) throw new Error('server not found');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO video_server_capacity (id, server_id, disk_used_gb, disk_total_gb, bandwidth_used_mbps, active_streams, snapshot_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.server_id,
    input.disk_used_gb ?? 0, input.disk_total_gb ?? 0,
    input.bandwidth_used_mbps ?? 0, input.active_streams ?? 0, now,
  );
  return db.prepare('SELECT * FROM video_server_capacity WHERE id = ?').get(id) as CapacitySnapshot;
}

export function latestCapacity(serverId: string): CapacitySnapshot | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM video_server_capacity WHERE server_id = ? ORDER BY snapshot_at DESC LIMIT 1'
  ).get(serverId) as CapacitySnapshot | undefined;
  return row ?? null;
}

export function listCapacityHistory(serverId: string, limit = 50): CapacitySnapshot[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM video_server_capacity WHERE server_id = ? ORDER BY snapshot_at DESC LIMIT ?'
  ).all(serverId, limit) as CapacitySnapshot[];
}

// ---------- 52.5 Load balancing ----------

export type LbStrategy = 'priority' | 'least_load' | 'geo' | 'round_robin' | 'weighted';

export interface RoutingDecision {
  server: VideoServer | null;
  strategy: LbStrategy;
  candidates: Array<{ server_id: string; name: string; score: number; reason: string }>;
  reason: string;
}

/**
 * Choose best server for a video playback request.
 * Filters: enabled, has ready replica, healthy.
 */
export function resolveServer(opts: {
  video_id: string;
  strategy?: LbStrategy;
  client_country?: string;
  client_ip?: string;
}): RoutingDecision {
  const strategy: LbStrategy = opts.strategy ?? 'priority';
  const allServers = listVideoServers({ enabledOnly: true }).filter((s) => s.role !== 'worker');
  const replicas = listReplicasForVideo(opts.video_id);
  const readyOnServer = new Set(replicas.filter((r) => r.status === 'ready').map((r) => r.server_id));

  const candidates: RoutingDecision['candidates'] = [];
  for (const s of allServers) {
    if (!readyOnServer.has(s.id)) continue;
    if (s.health_status === 'down') continue;

    let score = 0;
    let reason = '';
    switch (strategy) {
      case 'priority':
        score = 1000 - s.priority;
        reason = `priority ${s.priority}`;
        break;
      case 'weighted':
        score = s.weight * 100;
        reason = `weight ${s.weight}`;
        break;
      case 'least_load': {
        const cap = latestCapacity(s.id);
        const load = cap ? cap.active_streams / Math.max(1, s.max_bandwidth_mbps) : 0;
        score = 1000 - Math.round(load * 100);
        reason = `load ${load.toFixed(3)}`;
        break;
      }
      case 'geo':
        score = (s.region && opts.client_country && s.region.toUpperCase() === opts.client_country.toUpperCase()) ? 1000 : 500;
        reason = s.region ?? 'no-region';
        break;
      case 'round_robin':
        score = Math.random() * 1000;
        reason = 'random';
        break;
    }
    // Health penalty
    if (s.health_status === 'degraded') { score -= 300; reason += ' (degraded)'; }
    candidates.push({ server_id: s.id, name: s.name, score, reason });
  }

  candidates.sort((a, b) => b.score - a.score);

  const db = getDb();
  const chosenId = candidates[0]?.server_id ?? null;
  const chosen = chosenId ? getVideoServer(chosenId) : null;

  db.prepare(`
    INSERT INTO video_server_routing_log (id, video_id, user_id, strategy, chosen_server_id,
      candidates_json, client_ip, client_country, reason, created_at)
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), opts.video_id, strategy, chosenId,
    JSON.stringify(candidates), opts.client_ip ?? null,
    opts.client_country ?? null,
    chosen ? `chose ${chosen.name} via ${strategy}` : 'no available server', new Date().toISOString(),
  );

  return {
    server: chosen,
    strategy,
    candidates,
    reason: chosen ? `chose ${chosen.name} via ${strategy}` : 'no available server',
  };
}

export function listRoutingLog(videoId?: string, limit = 100): Array<{
  id: string; video_id: string; strategy: string;
  chosen_server_id: string | null; client_country: string | null;
  reason: string | null; created_at: string;
}> {
  const db = getDb();
  if (videoId) {
    return db.prepare(
      'SELECT id, video_id, strategy, chosen_server_id, client_country, reason, created_at FROM video_server_routing_log WHERE video_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(videoId, limit) as any[];
  }
  return db.prepare(
    'SELECT id, video_id, strategy, chosen_server_id, client_country, reason, created_at FROM video_server_routing_log ORDER BY created_at DESC LIMIT ?'
  ).all(limit) as any[];
}

// ---------- 52.6 Failover ----------

/**
 * Get current failover candidates for a server (backups in same region,
 * or any healthy edge).
 */
export function failoverCandidates(serverId: string): VideoServer[] {
  const server = getVideoServer(serverId);
  if (!server) return [];
  const all = listVideoServers({ enabledOnly: true });
  return all.filter((s) => s.id !== serverId && s.role !== 'worker' && s.health_status !== 'down')
    .sort((a, b) => {
      // same region preferred
      const ra = (a.region === server.region) ? 1 : 0;
      const rb = (b.region === server.region) ? 1 : 0;
      if (ra !== rb) return rb - ra;
      return a.priority - b.priority;
    });
}

export function recordManualFailover(input: {
  server_id: string;
  reason: string;
  triggered_by: string;
  affected_streams?: number;
}): { event_id: string } {
  const db = getDb();
  const s = getVideoServer(input.server_id);
  if (!s) throw new Error('server not found');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO video_server_failover_events (id, server_id, from_status, to_status, reason, affected_streams, triggered_by, created_at)
    VALUES (?, ?, ?, 'down', ?, ?, ?, ?)
  `).run(id, input.server_id, s.health_status, input.reason, input.affected_streams ?? 0, input.triggered_by, now);
  db.prepare("UPDATE video_servers SET health_status = 'down', updated_at = ? WHERE id = ?").run(now, input.server_id);
  return { event_id: id };
}

export function recordRestore(serverId: string, triggeredBy: string): { ok: boolean } {
  const db = getDb();
  const s = getVideoServer(serverId);
  if (!s) throw new Error('server not found');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO video_server_failover_events (id, server_id, from_status, to_status, reason, affected_streams, triggered_by, created_at)
    VALUES (?, ?, ?, 'healthy', ?, 0, ?, ?)
  `).run(randomUUID(), serverId, s.health_status, 'manual restore', triggeredBy, now);
  db.prepare("UPDATE video_servers SET health_status = 'healthy', consecutive_failures = 0, updated_at = ? WHERE id = ?").run(now, serverId);
  return { ok: true };
}

// ---------- 52.7 Config sync ----------

export interface ConfigSyncRecord {
  id: string;
  server_id: string;
  config: Record<string, unknown>;
  status: 'pending' | 'applied' | 'failed';
  applied_at: string | null;
  error_text: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface CsRow {
  id: string; server_id: string; config_json: string; status: string;
  applied_at: string | null; error_text: string | null;
  created_by: string | null; created_at: string; updated_at: string;
}

function csRowToObj(row: CsRow): ConfigSyncRecord {
  return {
    id: row.id, server_id: row.server_id,
    config: safeParse<Record<string, unknown>>(row.config_json, {}),
    status: row.status as ConfigSyncRecord['status'],
    applied_at: row.applied_at, error_text: row.error_text,
    created_by: row.created_by,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

export function pushConfigSync(input: {
  server_id: string;
  config: Record<string, unknown>;
  created_by?: string;
}): ConfigSyncRecord {
  const db = getDb();
  if (!getVideoServer(input.server_id)) throw new Error('server not found');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO video_server_config_sync (id, server_id, config_json, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?, ?)
  `).run(id, input.server_id, JSON.stringify(input.config), input.created_by ?? null, now, now);
  return csRowToObj(db.prepare('SELECT * FROM video_server_config_sync WHERE id = ?').get(id) as CsRow);
}

export function markConfigSyncApplied(id: string, error?: string): ConfigSyncRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM video_server_config_sync WHERE id = ?').get(id) as CsRow | undefined;
  if (!row) return null;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE video_server_config_sync SET status = ?, applied_at = ?, error_text = ?, updated_at = ?
    WHERE id = ?
  `).run(error ? 'failed' : 'applied', error ? null : now, error ?? null, now, id);
  return csRowToObj(db.prepare('SELECT * FROM video_server_config_sync WHERE id = ?').get(id) as CsRow);
}

export function listConfigSync(serverId: string, limit = 20): ConfigSyncRecord[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM video_server_config_sync WHERE server_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(serverId, limit) as CsRow[];
  return rows.map(csRowToObj);
}

// ---------- Fleet stats / dashboard ----------

export interface FleetStats {
  total_servers: number;
  enabled: number;
  by_role: Record<string, number>;
  by_region: Record<string, number>;
  by_health: Record<string, number>;
  total_capacity_gb: number;
  total_used_gb: number;
  total_bandwidth_mbps: number;
  active_streams: number;
  total_replicas: number;
  ready_replicas: number;
  stale_replicas: number;
  recent_failovers_24h: number;
}

export function getFleetStats(): FleetStats {
  const db = getDb();
  const servers = listVideoServers();
  const total = servers.length;
  const enabled = servers.filter((s) => s.enabled).length;
  const byRole: Record<string, number> = {};
  const byRegion: Record<string, number> = {};
  const byHealth: Record<string, number> = {};
  let totalCapacityGb = 0;
  let totalUsedGb = 0;
  let totalBandwidthMbps = 0;
  let activeStreams = 0;
  for (const s of servers) {
    byRole[s.role] = (byRole[s.role] ?? 0) + 1;
    if (s.region) byRegion[s.region] = (byRegion[s.region] ?? 0) + 1;
    byHealth[s.health_status] = (byHealth[s.health_status] ?? 0) + 1;
    totalCapacityGb += s.max_storage_gb;
    totalBandwidthMbps += s.max_bandwidth_mbps;
    const cap = latestCapacity(s.id);
    if (cap) {
      totalUsedGb += cap.disk_used_gb;
      activeStreams += cap.active_streams;
    }
  }
  const totalReplicas = (db.prepare('SELECT COUNT(*) as n FROM video_server_replicas').get() as { n: number }).n;
  const ready = (db.prepare("SELECT COUNT(*) as n FROM video_server_replicas WHERE status = 'ready'").get() as { n: number }).n;
  const stale = (db.prepare("SELECT COUNT(*) as n FROM video_server_replicas WHERE status IN ('stale','failed')").get() as { n: number }).n;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const failovers = (db.prepare(
    "SELECT COUNT(*) as n FROM video_server_failover_events WHERE to_status = 'down' AND created_at >= ?"
  ).get(cutoff) as { n: number }).n;

  return {
    total_servers: total,
    enabled,
    by_role: byRole,
    by_region: byRegion,
    by_health: byHealth,
    total_capacity_gb: Math.round(totalCapacityGb * 100) / 100,
    total_used_gb: Math.round(totalUsedGb * 100) / 100,
    total_bandwidth_mbps: totalBandwidthMbps,
    active_streams: activeStreams,
    total_replicas: totalReplicas,
    ready_replicas: ready,
    stale_replicas: stale,
    recent_failovers_24h: failovers,
  };
}
