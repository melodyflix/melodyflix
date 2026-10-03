// melodyflix videos — Internet Radio (Section 124)
// Separate module from livetv.service.ts for clarity.

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export interface RadioStation {
  id: string;
  owner_id: string;
  name: string;
  stream_url: string;
  logo_url: string | null;
  genre: string | null;
  country: string | null;
  language: string | null;
  description: string | null;
  bitrate_kbps: number | null;
  sample_rate_hz: number | null;
  is_active: number;
  is_public: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface RadioHealth {
  id: string;
  station_id: string;
  status: 'ok' | 'error' | 'timeout';
  http_code: number | null;
  response_ms: number;
  error_message: string | null;
  checked_at: string;
}

export function ensureRadioSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS radio_stations (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      stream_url TEXT NOT NULL,
      logo_url TEXT,
      genre TEXT,
      country TEXT,
      language TEXT,
      description TEXT,
      bitrate_kbps INTEGER,
      sample_rate_hz INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_public INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_radio_owner   ON radio_stations(owner_id);
    CREATE INDEX IF NOT EXISTS idx_radio_genre   ON radio_stations(genre);
    CREATE INDEX IF NOT EXISTS idx_radio_country ON radio_stations(country);
    CREATE INDEX IF NOT EXISTS idx_radio_active  ON radio_stations(is_active, is_public);

    CREATE TABLE IF NOT EXISTS radio_health (
      id TEXT PRIMARY KEY,
      station_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ok','error','timeout')),
      http_code INTEGER,
      response_ms INTEGER NOT NULL,
      error_message TEXT,
      checked_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_radio_health_station
      ON radio_health(station_id, checked_at DESC);
  `);
}

// ---------- CRUD ----------

export interface CreateRadioStationInput {
  owner_id: string;
  name: string;
  stream_url: string;
  logo_url?: string | null;
  genre?: string | null;
  country?: string | null;
  language?: string | null;
  description?: string | null;
  bitrate_kbps?: number | null;
  sample_rate_hz?: number | null;
  is_public?: boolean;
  sort_order?: number;
}

export function createRadioStation(input: CreateRadioStationInput): RadioStation {
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO radio_stations
      (id, owner_id, name, stream_url, logo_url, genre, country, language,
       description, bitrate_kbps, sample_rate_hz, is_active, is_public,
       sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
  `).run(
    id, input.owner_id, input.name, input.stream_url,
    input.logo_url ?? null, input.genre ?? null, input.country ?? null,
    input.language ?? null, input.description ?? null,
    input.bitrate_kbps ?? null, input.sample_rate_hz ?? null,
    input.is_public === false ? 0 : 1, input.sort_order ?? 0, now, now
  );
  return getRadioStation(id)!;
}

export function getRadioStation(id: string): RadioStation | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM radio_stations WHERE id = ?').get(id) as RadioStation | undefined;
  return row ?? null;
}

export interface ListStationsFilters {
  genre?: string;
  country?: string;
  language?: string;
  owner_id?: string;
  search?: string;
  active_only?: boolean;
  public_only?: boolean;
  limit?: number;
}

export function listRadioStations(f: ListStationsFilters = {}): RadioStation[] {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];
  if (f.genre)    { where.push('genre = ?');    params.push(f.genre); }
  if (f.country)  { where.push('country = ?');  params.push(f.country); }
  if (f.language) { where.push('language = ?'); params.push(f.language); }
  if (f.owner_id) { where.push('owner_id = ?'); params.push(f.owner_id); }
  if (f.search)   { where.push('(name LIKE ? OR description LIKE ?)'); params.push(`%${f.search}%`, `%${f.search}%`); }
  if (f.active_only !== false) where.push('is_active = 1');
  if (f.public_only !== false) where.push('is_public = 1');
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
  const sql = `SELECT * FROM radio_stations
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY sort_order ASC, name ASC LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params) as RadioStation[];
}

export interface UpdateRadioStationInput {
  name?: string;
  stream_url?: string;
  logo_url?: string | null;
  genre?: string | null;
  country?: string | null;
  language?: string | null;
  description?: string | null;
  bitrate_kbps?: number | null;
  sample_rate_hz?: number | null;
  is_active?: boolean;
  is_public?: boolean;
  sort_order?: number;
}

export function updateRadioStation(id: string, patch: UpdateRadioStationInput): RadioStation | null {
  const existing = getRadioStation(id);
  if (!existing) return null;
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
  getDb().prepare(`UPDATE radio_stations SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getRadioStation(id);
}

export function deleteRadioStation(id: string): boolean {
  const r = getDb().prepare('DELETE FROM radio_stations WHERE id = ?').run(id);
  return r.changes > 0;
}

export function listRadioGenres(): { genre: string; count: number }[] {
  return getDb().prepare(
    `SELECT genre, COUNT(*) as count FROM radio_stations
     WHERE is_active = 1 AND is_public = 1 AND genre IS NOT NULL
     GROUP BY genre ORDER BY count DESC`
  ).all() as { genre: string; count: number }[];
}

export function countStationsByOwner(ownerId: string): number {
  const r = getDb().prepare(
    'SELECT COUNT(*) as n FROM radio_stations WHERE owner_id = ?'
  ).get(ownerId) as { n: number };
  return r.n;
}

// ---------- Health ----------

export async function checkRadioHealth(stationId: string, timeoutMs = 5000): Promise<RadioHealth> {
  const st = getRadioStation(stationId);
  if (!st) throw new Error('Station not found');

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let status: 'ok' | 'error' | 'timeout' = 'error';
  let httpCode: number | null = null;
  let errorMessage: string | null = null;

  try {
    const res = await fetch(st.stream_url, { method: 'HEAD', signal: controller.signal, redirect: 'follow' });
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
  const record: RadioHealth = {
    id: randomUUID(),
    station_id: stationId,
    status,
    http_code: httpCode,
    response_ms: responseMs,
    error_message: errorMessage,
    checked_at: new Date().toISOString(),
  };
  db.prepare(`
    INSERT INTO radio_health
      (id, station_id, status, http_code, response_ms, error_message, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(record.id, record.station_id, record.status, record.http_code, record.response_ms, record.error_message, record.checked_at);

  return record;
}

export function getLatestRadioHealth(stationId: string): RadioHealth | null {
  const row = getDb().prepare(
    'SELECT * FROM radio_health WHERE station_id = ? ORDER BY checked_at DESC LIMIT 1'
  ).get(stationId) as RadioHealth | undefined;
  return row ?? null;
}

// ============================================================
// 124.3 — Radio Jingles
// Short audio stings inserted between tracks / ad-breaks.
// ============================================================

export type JingleType = 'intro' | 'outro' | 'transition' | 'ad_break' | 'station_id' | 'news';

export interface RadioJingle {
  id: string;
  station_id: string;
  owner_id: string;
  name: string;
  audio_url: string;
  duration_seconds: number;
  jingle_type: JingleType;
  weight: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export function ensureRadioJinglesSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS radio_jingles (
      id TEXT PRIMARY KEY,
      station_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      audio_url TEXT NOT NULL,
      duration_seconds REAL NOT NULL DEFAULT 0,
      jingle_type TEXT NOT NULL DEFAULT 'transition'
        CHECK (jingle_type IN ('intro','outro','transition','ad_break','station_id','news')),
      weight INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_radio_jingles_station
      ON radio_jingles(station_id, jingle_type, is_active);
    CREATE INDEX IF NOT EXISTS idx_radio_jingles_owner
      ON radio_jingles(owner_id);
  `);
}

export interface CreateJingleInput {
  station_id: string;
  owner_id: string;
  name: string;
  audio_url: string;
  duration_seconds?: number;
  jingle_type?: JingleType;
  weight?: number;
}

export function createJingle(input: CreateJingleInput): RadioJingle {
  const st = getRadioStation(input.station_id);
  if (!st) throw new Error('Station not found');
  if (st.owner_id !== input.owner_id) throw new Error('Not your station');
  if (!input.name?.trim()) throw new Error('Name required');
  if (!input.audio_url?.trim()) throw new Error('Audio URL required');

  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  const dur = Math.max(0, Math.min(input.duration_seconds ?? 0, 300));
  const weight = Math.max(1, Math.min(input.weight ?? 1, 100));

  db.prepare(`
    INSERT INTO radio_jingles
      (id, station_id, owner_id, name, audio_url, duration_seconds,
       jingle_type, weight, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id, input.station_id, input.owner_id, input.name.slice(0, 200),
    input.audio_url, dur, input.jingle_type ?? 'transition',
    weight, now, now
  );
  return getJingle(id)!;
}

export function getJingle(id: string): RadioJingle | null {
  const row = getDb().prepare('SELECT * FROM radio_jingles WHERE id = ?')
    .get(id) as RadioJingle | undefined;
  return row ?? null;
}

export function listJingles(stationId: string, f: {
  jingle_type?: JingleType;
  active_only?: boolean;
  limit?: number;
} = {}): RadioJingle[] {
  const db = getDb();
  const where: string[] = ['station_id = ?'];
  const params: any[] = [stationId];
  if (f.jingle_type) { where.push('jingle_type = ?'); params.push(f.jingle_type); }
  if (f.active_only !== false) where.push('is_active = 1');
  const n = Math.min(Math.max(f.limit ?? 200, 1), 500);
  params.push(n);
  return db.prepare(`
    SELECT * FROM radio_jingles
    WHERE ${where.join(' AND ')}
    ORDER BY jingle_type ASC, name ASC LIMIT ?
  `).all(...params) as RadioJingle[];
}

export interface UpdateJingleInput {
  name?: string;
  audio_url?: string;
  duration_seconds?: number;
  jingle_type?: JingleType;
  weight?: number;
  is_active?: boolean;
}

export function updateJingle(id: string, ownerId: string, patch: UpdateJingleInput): RadioJingle | null {
  const j = getJingle(id);
  if (!j) return null;
  if (j.owner_id !== ownerId) throw new Error('Not your jingle');
  const fields: string[] = [];
  const values: any[] = [];
  const map: Record<string, any> = {
    name: patch.name,
    audio_url: patch.audio_url,
    duration_seconds: patch.duration_seconds === undefined ? undefined : Math.max(0, Math.min(patch.duration_seconds, 300)),
    jingle_type: patch.jingle_type,
    weight: patch.weight === undefined ? undefined : Math.max(1, Math.min(patch.weight, 100)),
    is_active: patch.is_active === undefined ? undefined : (patch.is_active ? 1 : 0),
  };
  for (const [k, v] of Object.entries(map)) {
    if (v === undefined) continue;
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (fields.length === 0) return j;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  getDb().prepare(`UPDATE radio_jingles SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getJingle(id);
}

export function deleteJingle(id: string, ownerId: string): boolean {
  const j = getJingle(id);
  if (!j) return false;
  if (j.owner_id !== ownerId) throw new Error('Not your jingle');
  return getDb().prepare('DELETE FROM radio_jingles WHERE id = ?').run(id).changes > 0;
}

// Weighted picker — deterministic round-robin based on selection count
export function pickJingle(
  stationId: string,
  jingleType: JingleType,
  seed: number
): RadioJingle | null {
  const pool = listJingles(stationId, { jingle_type: jingleType, active_only: true });
  if (pool.length === 0) return null;
  // Expand by weight, pick using seed
  const expanded: RadioJingle[] = [];
  for (const j of pool) {
    for (let i = 0; i < j.weight; i++) expanded.push(j);
  }
  const idx = Math.abs(Math.floor(seed)) % expanded.length;
  return expanded[idx];
}

export function countJingles(stationId: string): number {
  const r = getDb().prepare(
    'SELECT COUNT(*) as n FROM radio_jingles WHERE station_id = ? AND is_active = 1'
  ).get(stationId) as { n: number };
  return r.n;
}

export function jinglesByType(stationId: string): { jingle_type: string; count: number }[] {
  return getDb().prepare(`
    SELECT jingle_type, COUNT(*) as count
    FROM radio_jingles
    WHERE station_id = ? AND is_active = 1
    GROUP BY jingle_type
    ORDER BY count DESC
  `).all(stationId) as { jingle_type: string; count: number }[];
}
