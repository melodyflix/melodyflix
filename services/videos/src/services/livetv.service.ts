// melodyflix videos - Live TV Broadcasting (Section 40: 40.1, 40.6, 40.15, 40.16)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export interface LiveTvChannel {
  id: string;
  owner_id: string;
  name: string;
  stream_url: string;
  logo_url: string | null;
  category: string | null;
  country: string | null;
  language: string | null;
  tvg_id: string | null;
  tvg_name: string | null;
  description: string | null;
  is_active: number;
  is_public: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface LiveTvHealth {
  id: string;
  channel_id: string;
  status: 'ok' | 'error' | 'timeout';
  http_code: number | null;
  response_ms: number;
  error_message: string | null;
  checked_at: string;
}

export function ensureLiveTvSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS live_tv_channels (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      stream_url TEXT NOT NULL,
      logo_url TEXT,
      category TEXT,
      country TEXT,
      language TEXT,
      tvg_id TEXT,
      tvg_name TEXT,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_public INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_livetv_owner ON live_tv_channels(owner_id);
    CREATE INDEX IF NOT EXISTS idx_livetv_category ON live_tv_channels(category);
    CREATE INDEX IF NOT EXISTS idx_livetv_country ON live_tv_channels(country);
    CREATE INDEX IF NOT EXISTS idx_livetv_active ON live_tv_channels(is_active, is_public);

    CREATE TABLE IF NOT EXISTS live_tv_health (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ok','error','timeout')),
      http_code INTEGER,
      response_ms INTEGER NOT NULL,
      error_message TEXT,
      checked_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_livetv_health_channel ON live_tv_health(channel_id, checked_at DESC);
  `);
}

// ---------- Channel CRUD (40.1, 40.6, 40.15) ----------

export interface ListFilters {
  category?: string;
  country?: string;
  language?: string;
  owner_id?: string;
  active_only?: boolean;
  public_only?: boolean;
  limit?: number;
}

export function listChannels(f: ListFilters = {}): LiveTvChannel[] {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];
  if (f.category) { where.push('category = ?'); params.push(f.category); }
  if (f.country) { where.push('country = ?'); params.push(f.country); }
  if (f.language) { where.push('language = ?'); params.push(f.language); }
  if (f.owner_id) { where.push('owner_id = ?'); params.push(f.owner_id); }
  if (f.active_only !== false) where.push('is_active = 1');
  if (f.public_only !== false) where.push('is_public = 1');
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
  const sql = `SELECT * FROM live_tv_channels ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY sort_order ASC, name ASC LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params) as LiveTvChannel[];
}

export function getChannel(id: string): LiveTvChannel | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM live_tv_channels WHERE id = ?').get(id) as LiveTvChannel | undefined;
  return row ?? null;
}

export interface CreateChannelInput {
  owner_id: string;
  name: string;
  stream_url: string;
  logo_url?: string | null;
  category?: string | null;
  country?: string | null;
  language?: string | null;
  tvg_id?: string | null;
  tvg_name?: string | null;
  description?: string | null;
  is_public?: boolean;
  sort_order?: number;
}

export function createChannel(input: CreateChannelInput): LiveTvChannel {
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO live_tv_channels
      (id, owner_id, name, stream_url, logo_url, category, country, language,
       tvg_id, tvg_name, description, is_active, is_public, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
  `).run(
    id, input.owner_id, input.name, input.stream_url,
    input.logo_url ?? null, input.category ?? null, input.country ?? null, input.language ?? null,
    input.tvg_id ?? null, input.tvg_name ?? null, input.description ?? null,
    input.is_public === false ? 0 : 1, input.sort_order ?? 0, now, now
  );
  return getChannel(id)!;
}

export interface UpdateChannelInput {
  name?: string;
  stream_url?: string;
  logo_url?: string | null;
  category?: string | null;
  country?: string | null;
  language?: string | null;
  tvg_id?: string | null;
  tvg_name?: string | null;
  description?: string | null;
  is_active?: boolean;
  is_public?: boolean;
  sort_order?: number;
}

export function updateChannel(id: string, patch: UpdateChannelInput): LiveTvChannel | null {
  const existing = getChannel(id);
  if (!existing) return null;
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];
  const map: Record<string, any> = {
    ...patch,
    is_active: patch.is_active === undefined ? undefined : (patch.is_active ? 1 : 0),
    is_public: patch.is_public === undefined ? undefined : (patch.is_public ? 1 : 0),
  };
  for (const [k, v] of Object.entries(map)) {
    if (v === undefined) continue;
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (fields.length === 0) return existing;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  db.prepare(`UPDATE live_tv_channels SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getChannel(id);
}

export function deleteChannel(id: string): boolean {
  const db = getDb();
  const r = db.prepare('DELETE FROM live_tv_channels WHERE id = ?').run(id);
  return r.changes > 0;
}

// ---------- Aggregates (40.6 Multi-Channel Support) ----------

export function listCategories(): { category: string; count: number }[] {
  const db = getDb();
  return db.prepare(
    `SELECT category, COUNT(*) as count FROM live_tv_channels
     WHERE is_active = 1 AND is_public = 1 AND category IS NOT NULL
     GROUP BY category ORDER BY count DESC`
  ).all() as { category: string; count: number }[];
}

export function countByOwner(ownerId: string): number {
  const db = getDb();
  const r = db.prepare('SELECT COUNT(*) as n FROM live_tv_channels WHERE owner_id = ?').get(ownerId) as { n: number };
  return r.n;
}

// ---------- Health Check (40.16) ----------

export async function checkStreamHealth(channelId: string, timeoutMs = 5000): Promise<LiveTvHealth> {
  const ch = getChannel(channelId);
  if (!ch) throw new Error('Channel not found');

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let status: 'ok' | 'error' | 'timeout' = 'error';
  let httpCode: number | null = null;
  let errorMessage: string | null = null;

  try {
    const res = await fetch(ch.stream_url, { method: 'HEAD', signal: controller.signal, redirect: 'follow' });
    httpCode = res.status;
    status = res.ok ? 'ok' : 'error';
    if (!res.ok) errorMessage = `HTTP ${res.status}`;
  } catch (e: any) {
    if (e?.name === 'AbortError') { status = 'timeout'; errorMessage = 'Request timed out'; }
    else errorMessage = e?.message ?? 'Unknown error';
  } finally {
    clearTimeout(timer);
  }

  const responseMs = Date.now() - started;
  const db = getDb();
  const record: LiveTvHealth = {
    id: randomUUID(),
    channel_id: channelId,
    status,
    http_code: httpCode,
    response_ms: responseMs,
    error_message: errorMessage,
    checked_at: new Date().toISOString(),
  };
  db.prepare(`
    INSERT INTO live_tv_health (id, channel_id, status, http_code, response_ms, error_message, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(record.id, record.channel_id, record.status, record.http_code, record.response_ms, record.error_message, record.checked_at);

  return record;
}

export function getLatestHealth(channelId: string): LiveTvHealth | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM live_tv_health WHERE channel_id = ? ORDER BY checked_at DESC LIMIT 1'
  ).get(channelId) as LiveTvHealth | undefined;
  return row ?? null;
}

export function listHealthHistory(channelId: string, limit = 20): LiveTvHealth[] {
  const db = getDb();
  const n = Math.min(Math.max(limit, 1), 100);
  return db.prepare(
    'SELECT * FROM live_tv_health WHERE channel_id = ? ORDER BY checked_at DESC LIMIT ?'
  ).all(channelId, n) as LiveTvHealth[];
}
