// melodyflix videos - external multi-server playback
// Content streams from third-party servers; each video maps 1..N sources.

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export function ensureExternalServerSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS external_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 100,
      enabled INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0,
      headers_json TEXT,
      health_status TEXT NOT NULL DEFAULT 'unknown',
      last_health_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_es_enabled ON external_servers(enabled);
    CREATE INDEX IF NOT EXISTS idx_es_priority ON external_servers(priority);

    CREATE TABLE IF NOT EXISTS video_external_sources (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      external_url TEXT NOT NULL,
      quality TEXT,
      is_available INTEGER NOT NULL DEFAULT 1,
      last_check_at TEXT,
      missing_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(video_id, server_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ves_video ON video_external_sources(video_id);
    CREATE INDEX IF NOT EXISTS idx_ves_server ON video_external_sources(server_id);
    CREATE INDEX IF NOT EXISTS idx_ves_available ON video_external_sources(is_available);

    CREATE TABLE IF NOT EXISTS video_source_health_log (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      check_type TEXT NOT NULL DEFAULT 'probe',
      status TEXT NOT NULL,
      http_code INTEGER,
      response_ms INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vshl_video ON video_source_health_log(video_id);
    CREATE INDEX IF NOT EXISTS idx_vshl_created ON video_source_health_log(created_at);
  `);
}

export interface ExternalServer {
  id: string;
  name: string;
  base_url: string;
  priority: number;
  enabled: boolean;
  is_default: boolean;
  headers_json: Record<string, string> | null;
  health_status: 'unknown' | 'healthy' | 'degraded' | 'down';
  last_health_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface ExternalServerRow {
  id: string; name: string; base_url: string; priority: number;
  enabled: number; is_default: number; headers_json: string | null;
  health_status: string; last_health_at: string | null; notes: string | null;
  created_at: string; updated_at: string;
}

function serverRowToObj(row: ExternalServerRow): ExternalServer {
  let headers: Record<string, string> | null = null;
  if (row.headers_json) {
    try { headers = JSON.parse(row.headers_json) as Record<string, string>; } catch {}
  }
  return {
    id: row.id,
    name: row.name,
    base_url: row.base_url,
    priority: row.priority,
    enabled: row.enabled === 1,
    is_default: row.is_default === 1,
    headers_json: headers,
    health_status: row.health_status as ExternalServer['health_status'],
    last_health_at: row.last_health_at,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ---------- Server CRUD ----------

export interface CreateServerInput {
  name: string;
  base_url: string;
  priority?: number;
  enabled?: boolean;
  is_default?: boolean;
  headers?: Record<string, string> | null;
  notes?: string | null;
}

export function createExternalServer(input: CreateServerInput): ExternalServer {
  const db = getDb();
  const name = input.name.trim();
  const baseUrl = input.base_url.trim().replace(/\/+$/, '');
  if (!name) throw new Error('name required');
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error('base_url must start with http(s)://');

  const now = new Date().toISOString();
  const id = randomUUID();
  const isDefault = input.is_default ? 1 : 0;
  if (isDefault) db.prepare('UPDATE external_servers SET is_default = 0').run();

  db.prepare(`
    INSERT INTO external_servers (id, name, base_url, priority, enabled, is_default,
      headers_json, health_status, last_health_at, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'unknown', NULL, ?, ?, ?)
  `).run(
    id, name, baseUrl, input.priority ?? 100,
    input.enabled === false ? 0 : 1, isDefault,
    input.headers ? JSON.stringify(input.headers) : null,
    input.notes ?? null, now, now
  );
  return getExternalServer(id)!;
}

export function getExternalServer(id: string): ExternalServer | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM external_servers WHERE id = ?').get(id) as ExternalServerRow | undefined;
  return row ? serverRowToObj(row) : null;
}

export function listExternalServers(opts: { enabledOnly?: boolean } = {}): ExternalServer[] {
  const db = getDb();
  const where = opts.enabledOnly ? 'WHERE enabled = 1' : '';
  const rows = db.prepare(
    `SELECT * FROM external_servers ${where} ORDER BY priority ASC, name ASC`
  ).all() as ExternalServerRow[];
  return rows.map(serverRowToObj);
}

export interface UpdateServerInput {
  name?: string;
  base_url?: string;
  priority?: number;
  enabled?: boolean;
  is_default?: boolean;
  headers?: Record<string, string> | null;
  notes?: string | null;
  health_status?: ExternalServer['health_status'];
}

export function updateExternalServer(id: string, patch: UpdateServerInput): ExternalServer | null {
  const db = getDb();
  const cur = getExternalServer(id);
  if (!cur) return null;

  const now = new Date().toISOString();
  const baseUrl = patch.base_url !== undefined
    ? patch.base_url.trim().replace(/\/+$/, '')
    : cur.base_url;
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error('base_url must start with http(s)://');

  const isDefault = patch.is_default !== undefined ? (patch.is_default ? 1 : 0) : (cur.is_default ? 1 : 0);
  if (isDefault) db.prepare('UPDATE external_servers SET is_default = 0 WHERE id != ?').run(id);

  db.prepare(`
    UPDATE external_servers SET
      name = ?, base_url = ?, priority = ?, enabled = ?, is_default = ?,
      headers_json = ?, notes = ?, health_status = ?, updated_at = ?
    WHERE id = ?
  `).run(
    patch.name !== undefined ? patch.name.trim() : cur.name,
    baseUrl,
    patch.priority !== undefined ? patch.priority : cur.priority,
    patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : (cur.enabled ? 1 : 0),
    isDefault,
    patch.headers !== undefined
      ? (patch.headers ? JSON.stringify(patch.headers) : null)
      : (cur.headers_json ? JSON.stringify(cur.headers_json) : null),
    patch.notes !== undefined ? patch.notes : cur.notes,
    patch.health_status ?? cur.health_status,
    now, id
  );
  return getExternalServer(id);
}

export function deleteExternalServer(id: string): boolean {
  const db = getDb();
  const r = db.prepare('DELETE FROM external_servers WHERE id = ?').run(id);
  db.prepare('DELETE FROM video_external_sources WHERE server_id = ?').run(id);
  return r.changes > 0;
}

// ---------- Video ↔ Server links ----------

export interface VideoExternalSource {
  id: string;
  video_id: string;
  server_id: string;
  external_url: string;
  quality: string | null;
  is_available: boolean;
  last_check_at: string | null;
  missing_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface VesRow {
  id: string; video_id: string; server_id: string; external_url: string;
  quality: string | null; is_available: number; last_check_at: string | null;
  missing_reason: string | null; created_at: string; updated_at: string;
}

function vesRowToObj(row: VesRow): VideoExternalSource {
  return {
    id: row.id,
    video_id: row.video_id,
    server_id: row.server_id,
    external_url: row.external_url,
    quality: row.quality,
    is_available: row.is_available === 1,
    last_check_at: row.last_check_at,
    missing_reason: row.missing_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function setVideoExternalSource(input: {
  video_id: string;
  server_id: string;
  external_url: string;
  quality?: string | null;
  is_available?: boolean;
}): VideoExternalSource {
  const db = getDb();
  if (!getExternalServer(input.server_id)) throw new Error('Server not found');
  if (!input.external_url?.trim()) throw new Error('external_url required');

  const now = new Date().toISOString();
  const existing = db.prepare(
    'SELECT * FROM video_external_sources WHERE video_id = ? AND server_id = ?'
  ).get(input.video_id, input.server_id) as VesRow | undefined;

  if (existing) {
    db.prepare(`
      UPDATE video_external_sources
      SET external_url = ?, quality = ?, is_available = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.external_url.trim(), input.quality ?? null,
      input.is_available === false ? 0 : 1, now, existing.id
    );
    return vesRowToObj(db.prepare('SELECT * FROM video_external_sources WHERE id = ?').get(existing.id) as VesRow);
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO video_external_sources (id, video_id, server_id, external_url, quality,
      is_available, last_check_at, missing_reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
  `).run(
    id, input.video_id, input.server_id, input.external_url.trim(),
    input.quality ?? null, input.is_available === false ? 0 : 1, now, now
  );
  return vesRowToObj(db.prepare('SELECT * FROM video_external_sources WHERE id = ?').get(id) as VesRow);
}

export function removeVideoExternalSource(videoId: string, serverId: string): boolean {
  const db = getDb();
  const r = db.prepare('DELETE FROM video_external_sources WHERE video_id = ? AND server_id = ?')
    .run(videoId, serverId);
  return r.changes > 0;
}

export function listVideoExternalSources(videoId: string): Array<VideoExternalSource & { server: ExternalServer | null }> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT ves.* FROM video_external_sources ves
    INNER JOIN external_servers s ON s.id = ves.server_id
    WHERE ves.video_id = ?
    ORDER BY s.priority ASC, s.name ASC
  `).all(videoId) as VesRow[];
  return rows.map((r) => ({ ...vesRowToObj(r), server: getExternalServer(r.server_id) }));
}

export function resolvePlaybackUrl(videoId: string, opts: { server_id?: string } = {}): {
  url: string;
  server_id: string;
  server_name: string;
  is_fallback: boolean;
} | null {
  const sources = listVideoExternalSources(videoId).filter((s) => s.is_available && s.server?.enabled);
  if (!sources.length) return null;

  if (opts.server_id) {
    const exact = sources.find((s) => s.server_id === opts.server_id);
    if (exact) {
      return {
        url: exact.external_url, server_id: exact.server_id,
        server_name: exact.server?.name ?? '', is_fallback: false,
      };
    }
  }
  const top = sources[0];
  return {
    url: top.external_url, server_id: top.server_id,
    server_name: top.server?.name ?? '', is_fallback: !!opts.server_id,
  };
}

export function markVideoSourceUnavailable(
  videoId: string, serverId: string, reason: string, httpCode?: number, responseMs?: number,
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE video_external_sources
    SET is_available = 0, missing_reason = ?, last_check_at = ?, updated_at = ?
    WHERE video_id = ? AND server_id = ?
  `).run(reason, now, now, videoId, serverId);
  db.prepare(`
    INSERT INTO video_source_health_log (id, video_id, server_id, check_type, status, http_code, response_ms, notes, created_at)
    VALUES (?, ?, ?, 'probe', 'unavailable', ?, ?, ?, ?)
  `).run(randomUUID(), videoId, serverId, httpCode ?? null, responseMs ?? null, reason, now);
}

export function markVideoSourceAvailable(
  videoId: string, serverId: string, httpCode?: number, responseMs?: number,
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE video_external_sources
    SET is_available = 1, missing_reason = NULL, last_check_at = ?, updated_at = ?
    WHERE video_id = ? AND server_id = ?
  `).run(now, now, videoId, serverId);
  db.prepare(`
    INSERT INTO video_source_health_log (id, video_id, server_id, check_type, status, http_code, response_ms, notes, created_at)
    VALUES (?, ?, ?, 'probe', 'available', ?, ?, NULL, ?)
  `).run(randomUUID(), videoId, serverId, httpCode ?? null, responseMs ?? null, now);
}

export function listVideoSourceHealthLog(videoId: string, limit = 50): Array<{
  id: string; video_id: string; server_id: string; check_type: string;
  status: string; http_code: number | null; response_ms: number | null;
  notes: string | null; created_at: string;
}> {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM video_source_health_log WHERE video_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(videoId, limit) as Array<{
    id: string; video_id: string; server_id: string; check_type: string;
    status: string; http_code: number | null; response_ms: number | null;
    notes: string | null; created_at: string;
  }>;
}

export interface ExternalServerStats {
  total_servers: number;
  enabled_servers: number;
  total_links: number;
  available_links: number;
  unavailable_links: number;
  by_server: Array<{ server_id: string; name: string; links: number; available: number; health: string }>;
}

export function getExternalServerStats(): ExternalServerStats {
  const db = getDb();
  const totalServers = (db.prepare('SELECT COUNT(*) as n FROM external_servers').get() as { n: number }).n;
  const enabled = (db.prepare('SELECT COUNT(*) as n FROM external_servers WHERE enabled = 1').get() as { n: number }).n;
  const totalLinks = (db.prepare('SELECT COUNT(*) as n FROM video_external_sources').get() as { n: number }).n;
  const available = (db.prepare('SELECT COUNT(*) as n FROM video_external_sources WHERE is_available = 1').get() as { n: number }).n;

  const byServer = db.prepare(`
    SELECT s.id as server_id, s.name, s.health_status as health,
           COUNT(ves.id) as links,
           SUM(CASE WHEN ves.is_available = 1 THEN 1 ELSE 0 END) as available
    FROM external_servers s
    LEFT JOIN video_external_sources ves ON ves.server_id = s.id
    GROUP BY s.id
    ORDER BY s.priority ASC
  `).all() as Array<{ server_id: string; name: string; health: string; links: number; available: number }>;

  return {
    total_servers: totalServers,
    enabled_servers: enabled,
    total_links: totalLinks,
    available_links: available,
    unavailable_links: totalLinks - available,
    by_server: byServer,
  };
}
