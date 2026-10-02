// melodyflix videos - Live TV Broadcasting (Section 40: 40.1, 40.6, 40.15, 40.16)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { join as pathJoin } from 'node:path';
import { promises as fsp } from 'node:fs';
import { spawn } from 'node:child_process';

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

// ============================================================
// 40.13 — M3U / M3U8 Playlist Import
// ============================================================

export interface ParsedM3UChannel {
  name: string | null;
  stream_url: string;
  logo_url: string | null;
  category: string | null;
  country: string | null;
  language: string | null;
  tvg_id: string | null;
  tvg_name: string | null;
}

function parseExtinf(line: string): Omit<ParsedM3UChannel, 'stream_url'> {
  const body = line.slice('#EXTINF:'.length);
  const commaIdx = body.lastIndexOf(',');
  const attrsPart = commaIdx >= 0 ? body.slice(0, commaIdx) : body;
  const displayName = commaIdx >= 0 ? body.slice(commaIdx + 1).trim() : '';
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrsPart)) !== null) attrs[m[1]] = m[2];
  return {
    name: displayName || attrs['tvg-name'] || null,
    logo_url: attrs['tvg-logo'] || null,
    category: attrs['group-title'] || null,
    country: attrs['tvg-country'] || null,
    language: attrs['tvg-language'] || null,
    tvg_id: attrs['tvg-id'] || null,
    tvg_name: attrs['tvg-name'] || null,
  };
}

export function parseM3U(text: string): ParsedM3UChannel[] {
  const lines = text.split(/\r?\n/);
  const out: ParsedM3UChannel[] = [];
  let pending: Omit<ParsedM3UChannel, 'stream_url'> | null = null;

  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    if (t.startsWith('#EXTM3U')) continue;
    if (t.startsWith('#EXTINF:')) { pending = parseExtinf(t); continue; }
    if (t.startsWith('#')) continue;
    if (/^https?:\/\//i.test(t) || t.startsWith('rtmp') || t.startsWith('rtsp')) {
      out.push({
        name: pending?.name ?? null,
        stream_url: t,
        logo_url: pending?.logo_url ?? null,
        category: pending?.category ?? null,
        country: pending?.country ?? null,
        language: pending?.language ?? null,
        tvg_id: pending?.tvg_id ?? null,
        tvg_name: pending?.tvg_name ?? null,
      });
      pending = null;
    }
  }
  return out;
}

export interface ImportM3UOptions {
  replace_existing?: boolean;
  skip_duplicates_by_url?: boolean;
  default_category?: string;
  is_public?: boolean;
}

export interface ImportM3UResult {
  parsed: number;
  inserted: number;
  skipped: number;
  errors: string[];
}

export function importM3U(ownerId: string, text: string, opts: ImportM3UOptions = {}): ImportM3UResult {
  const parsed = parseM3U(text);
  const result: ImportM3UResult = { parsed: parsed.length, inserted: 0, skipped: 0, errors: [] };
  if (parsed.length === 0) return result;

  const db = getDb();

  if (opts.replace_existing) {
    db.prepare('DELETE FROM live_tv_channels WHERE owner_id = ?').run(ownerId);
  }

  const existingUrls = new Set<string>();
  if (opts.skip_duplicates_by_url) {
    const rows = db.prepare('SELECT stream_url FROM live_tv_channels WHERE owner_id = ?')
      .all(ownerId) as { stream_url: string }[];
    for (const r of rows) existingUrls.add(r.stream_url);
  }

  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO live_tv_channels
      (id, owner_id, name, stream_url, logo_url, category, country, language,
       tvg_id, tvg_name, description, is_active, is_public, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, 0, ?, ?)
  `);

  const isPublic = opts.is_public === false ? 0 : 1;
  db.exec('BEGIN');
  try {
    for (const p of parsed) {
      if (opts.skip_duplicates_by_url && existingUrls.has(p.stream_url)) {
        result.skipped++;
        continue;
      }
      const name = p.name || p.tvg_name || p.tvg_id || p.stream_url;
      try {
        insert.run(
          randomUUID(), ownerId, name, p.stream_url,
          p.logo_url, p.category ?? opts.default_category ?? null,
          p.country, p.language, p.tvg_id, p.tvg_name,
          isPublic, now, now
        );
        existingUrls.add(p.stream_url);
        result.inserted++;
      } catch (e: any) {
        result.errors.push(`${name}: ${e?.message ?? 'insert failed'}`);
      }
    }
    db.exec('COMMIT');
  } catch (e: any) {
    db.exec('ROLLBACK');
    throw e;
  }
  return result;
}

// ============================================================
// 40.14 — XMLTV EPG Import
// 40.2  — EPG Query
// ============================================================

export interface XmltvProgram {
  channel_id: string;
  start: string;   // ISO
  stop: string;    // ISO
  title: string;
  description: string | null;
  category: string | null;
  episode_num: string | null;
}

export interface XmltvChannel {
  id: string;
  display_name: string | null;
  icon_url: string | null;
}

export function ensureXmltvSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS xmltv_channels (
      id TEXT PRIMARY KEY,
      display_name TEXT,
      icon_url TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS xmltv_programs (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      start_ts TEXT NOT NULL,
      stop_ts TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT,
      episode_num TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_xmltv_programs_channel_time
      ON xmltv_programs(channel_id, start_ts);
    CREATE INDEX IF NOT EXISTS idx_xmltv_programs_time
      ON xmltv_programs(start_ts, stop_ts);
  `);
}

// Parse XMLTV timestamp: "20261002180000 +0600" → ISO
function parseXmltvDate(raw: string): string | null {
  const s = raw.trim();
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se, tz] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${se ?? '00'}${tz ? tz.slice(0,3) + ':' + tz.slice(3) : 'Z'}`;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;
  return date.toISOString();
}

function extractAttr(tag: string, name: string): string | null {
  const re = new RegExp(`${name}="([^"]*)"`);
  const m = tag.match(re);
  return m ? m[1] : null;
}

function extractInner(xml: string, tagName: string): string | null {
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i');
  const m = xml.match(re);
  if (!m) return null;
  return m[1]
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export function parseXmltv(xml: string): { channels: XmltvChannel[]; programs: XmltvProgram[] } {
  const channels: XmltvChannel[] = [];
  const programs: XmltvProgram[] = [];

  // Channels: <channel id="..."><display-name>...</display-name><icon src="..."/></channel>
  const chRe = /<channel\s+([^>]*)>([\s\S]*?)<\/channel>/gi;
  let cm: RegExpExecArray | null;
  while ((cm = chRe.exec(xml)) !== null) {
    const id = extractAttr(cm[1], 'id');
    if (!id) continue;
    const inner = cm[2];
    const displayName = extractInner(inner, 'display-name');
    const iconMatch = inner.match(/<icon[^>]*src="([^"]*)"/i);
    channels.push({ id, display_name: displayName, icon_url: iconMatch ? iconMatch[1] : null });
  }

  // Programs: <programme start="..." stop="..." channel="..."> ... </programme>
  const prRe = /<programme\s+([^>]*)>([\s\S]*?)<\/programme>/gi;
  let pm: RegExpExecArray | null;
  while ((pm = prRe.exec(xml)) !== null) {
    const attrs = pm[1];
    const inner = pm[2];
    const start = extractAttr(attrs, 'start');
    const stop = extractAttr(attrs, 'stop');
    const channelId = extractAttr(attrs, 'channel');
    if (!start || !stop || !channelId) continue;
    const startIso = parseXmltvDate(start);
    const stopIso = parseXmltvDate(stop);
    if (!startIso || !stopIso) continue;

    const title = extractInner(inner, 'title');
    if (!title) continue;

    const description = extractInner(inner, 'desc');
    const category = extractInner(inner, 'category');

    const epMatch = inner.match(/<episode-num[^>]*>([^<]*)<\/episode-num>/i);
    const episodeNum = epMatch ? epMatch[1].trim() : null;

    programs.push({
      channel_id: channelId,
      start: startIso,
      stop: stopIso,
      title,
      description,
      category,
      episode_num: episodeNum,
    });
  }

  return { channels, programs };
}

export interface ImportXmltvResult {
  channels_parsed: number;
  programs_parsed: number;
  channels_upserted: number;
  programs_inserted: number;
  programs_skipped: number;
  errors: string[];
}

export function importXmltv(xml: string, opts: { replace_programs?: boolean } = {}): ImportXmltvResult {
  const result: ImportXmltvResult = {
    channels_parsed: 0, programs_parsed: 0,
    channels_upserted: 0, programs_inserted: 0, programs_skipped: 0,
    errors: [],
  };

  const { channels, programs } = parseXmltv(xml);
  result.channels_parsed = channels.length;
  result.programs_parsed = programs.length;

  const db = getDb();
  ensureXmltvSchema();

  const now = new Date().toISOString();

  // Upsert channels
  const upsertCh = db.prepare(`
    INSERT INTO xmltv_channels (id, display_name, icon_url, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      icon_url = excluded.icon_url,
      updated_at = excluded.updated_at
  `);

  db.exec('BEGIN');
  try {
    for (const c of channels) {
      try {
        upsertCh.run(c.id, c.display_name, c.icon_url, now);
        result.channels_upserted++;
      } catch (e: any) {
        result.errors.push(`channel ${c.id}: ${e?.message ?? 'upsert failed'}`);
      }
    }

    if (opts.replace_programs && programs.length > 0) {
      const chIds = Array.from(new Set(programs.map(p => p.channel_id)));
      const del = db.prepare('DELETE FROM xmltv_programs WHERE channel_id = ?');
      for (const cid of chIds) del.run(cid);
    }

    const insertPr = db.prepare(`
      INSERT INTO xmltv_programs
        (id, channel_id, start_ts, stop_ts, title, description, category, episode_num, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Dedup by (channel_id, start_ts) — skip if same slot exists
    const existsStmt = db.prepare(
      'SELECT 1 FROM xmltv_programs WHERE channel_id = ? AND start_ts = ? LIMIT 1'
    );

    for (const p of programs) {
      try {
        if (!opts.replace_programs && existsStmt.get(p.channel_id, p.start)) {
          result.programs_skipped++;
          continue;
        }
        insertPr.run(
          randomUUID(), p.channel_id, p.start, p.stop,
          p.title, p.description, p.category, p.episode_num, now
        );
        result.programs_inserted++;
      } catch (e: any) {
        result.errors.push(`program ${p.channel_id}@${p.start}: ${e?.message ?? 'insert failed'}`);
      }
    }

    db.exec('COMMIT');
  } catch (e: any) {
    db.exec('ROLLBACK');
    throw e;
  }

  return result;
}

// ---- 40.2 EPG Query ----

export interface EpgEntry {
  id: string;
  channel_id: string;
  start_ts: string;
  stop_ts: string;
  title: string;
  description: string | null;
  category: string | null;
  episode_num: string | null;
}

export function getEpgForChannel(channelId: string, fromIso?: string, toIso?: string): EpgEntry[] {
  const db = getDb();
  const where: string[] = ['channel_id = ?'];
  const params: any[] = [channelId];
  if (fromIso) { where.push('stop_ts >= ?'); params.push(fromIso); }
  if (toIso)   { where.push('start_ts <= ?'); params.push(toIso); }
  return db.prepare(
    `SELECT * FROM xmltv_programs WHERE ${where.join(' AND ')} ORDER BY start_ts ASC LIMIT 500`
  ).all(...params) as EpgEntry[];
}

export function getNowPlaying(channelId: string, nowIso?: string): EpgEntry | null {
  const db = getDb();
  const now = nowIso ?? new Date().toISOString();
  const row = db.prepare(
    `SELECT * FROM xmltv_programs
     WHERE channel_id = ? AND start_ts <= ? AND stop_ts > ?
     ORDER BY start_ts DESC LIMIT 1`
  ).get(channelId, now, now) as EpgEntry | undefined;
  return row ?? null;
}

export function getUpNext(channelId: string, nowIso?: string, limit = 5): EpgEntry[] {
  const db = getDb();
  const now = nowIso ?? new Date().toISOString();
  const n = Math.min(Math.max(limit, 1), 50);
  return db.prepare(
    `SELECT * FROM xmltv_programs
     WHERE channel_id = ? AND start_ts > ?
     ORDER BY start_ts ASC LIMIT ?`
  ).all(channelId, now, n) as EpgEntry[];
}

// ============================================================
// 40.7 — TV Schedule (aggregate EPG across channels)
// ============================================================

export interface ScheduleSlot {
  channel_id: string;
  channel_name: string;
  channel_logo: string | null;
  category: string | null;
  now: EpgEntry | null;
  up_next: EpgEntry[];
}

export interface ScheduleResult {
  at: string;
  count: number;
  slots: ScheduleSlot[];
}

export function getSchedule(opts: {
  at?: string;
  owner_id?: string;
  category?: string;
  limit_channels?: number;
  up_next_limit?: number;
} = {}): ScheduleResult {
  const at = opts.at ?? new Date().toISOString();
  const upNextLimit = Math.min(Math.max(opts.up_next_limit ?? 3, 0), 20);

  const channels = listChannels({
    owner_id: opts.owner_id,
    category: opts.category,
    active_only: true,
    public_only: opts.owner_id ? false : true,
    limit: opts.limit_channels ?? 100,
  });

  const slots: ScheduleSlot[] = channels.map((ch) => ({
    channel_id: ch.id,
    channel_name: ch.name,
    channel_logo: ch.logo_url,
    category: ch.category,
    now: getNowPlaying(ch.tvg_id ?? ch.id, at) ?? getNowPlaying(ch.id, at),
    up_next: upNextLimit > 0
      ? (getUpNext(ch.tvg_id ?? ch.id, at, upNextLimit).length > 0
          ? getUpNext(ch.tvg_id ?? ch.id, at, upNextLimit)
          : getUpNext(ch.id, at, upNextLimit))
      : [],
  }));

  return { at, count: slots.length, slots };
}

export function getScheduleForChannel(channelId: string, opts: {
  from?: string;
  to?: string;
} = {}): { channel: LiveTvChannel; entries: EpgEntry[] } | null {
  const ch = getChannel(channelId);
  if (!ch) return null;
  const key = ch.tvg_id ?? ch.id;
  const entries = getEpgForChannel(key, opts.from, opts.to);
  return { channel: ch, entries };
}

// ============================================================
// 40.3 — Channel Switching (state save/restore)
// ============================================================

export interface LiveTvWatchState {
  user_id: string;
  channel_id: string;
  position_seconds: number;
  device: string | null;
  updated_at: string;
}

export function ensureLiveTvStateSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS live_tv_watch_state (
      user_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      position_seconds REAL NOT NULL DEFAULT 0,
      device TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_livetv_state_channel ON live_tv_watch_state(channel_id);

    CREATE TABLE IF NOT EXISTS live_tv_recent (
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      last_watched_at TEXT NOT NULL,
      watch_count INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, channel_id)
    );
    CREATE INDEX IF NOT EXISTS idx_livetv_recent_user ON live_tv_recent(user_id, last_watched_at DESC);
  `);
}

export interface SwitchResult {
  channel: LiveTvChannel;
  resumed_at_seconds: number;
  previous_channel_id: string | null;
}

export function switchChannel(
  userId: string,
  channelId: string,
  opts: { device?: string; resume?: boolean } = {}
): SwitchResult {
  const ch = getChannel(channelId);
  if (!ch) throw new Error('Channel not found');

  const db = getDb();
  const now = new Date().toISOString();

  // Save previous state (for audit / "back to previous" feature)
  const prev = db.prepare(
    'SELECT channel_id FROM live_tv_watch_state WHERE user_id = ?'
  ).get(userId) as { channel_id: string } | undefined;

  // Resume position from the existing watch state ONLY IF same channel
  let resumeAt = 0;
  if (opts.resume && prev?.channel_id === channelId) {
    const state = db.prepare(
      'SELECT position_seconds FROM live_tv_watch_state WHERE user_id = ?'
    ).get(userId) as { position_seconds: number } | undefined;
    if (state) resumeAt = state.position_seconds;
  }

  db.exec('BEGIN');
  try {
    // Upsert current state
    db.prepare(`
      INSERT INTO live_tv_watch_state (user_id, channel_id, position_seconds, device, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        channel_id = excluded.channel_id,
        position_seconds = excluded.position_seconds,
        device = excluded.device,
        updated_at = excluded.updated_at
    `).run(userId, channelId, resumeAt, opts.device ?? null, now);

    // Upsert recents
    db.prepare(`
      INSERT INTO live_tv_recent (user_id, channel_id, last_watched_at, watch_count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(user_id, channel_id) DO UPDATE SET
        last_watched_at = excluded.last_watched_at,
        watch_count = live_tv_recent.watch_count + 1
    `).run(userId, channelId, now);

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return {
    channel: ch,
    resumed_at_seconds: resumeAt,
    previous_channel_id: prev?.channel_id ?? null,
  };
}

export function getWatchState(userId: string): (LiveTvWatchState & { channel: LiveTvChannel | null }) | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM live_tv_watch_state WHERE user_id = ?'
  ).get(userId) as LiveTvWatchState | undefined;
  if (!row) return null;
  return { ...row, channel: getChannel(row.channel_id) };
}

export function updatePosition(userId: string, positionSeconds: number): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE live_tv_watch_state
    SET position_seconds = ?, updated_at = ?
    WHERE user_id = ?
  `).run(Math.max(0, positionSeconds), now, userId);
}

export interface RecentChannel {
  channel_id: string;
  last_watched_at: string;
  watch_count: number;
  channel: LiveTvChannel | null;
}

export function listRecentChannels(userId: string, limit = 10): RecentChannel[] {
  const db = getDb();
  const n = Math.min(Math.max(limit, 1), 50);
  const rows = db.prepare(
    'SELECT channel_id, last_watched_at, watch_count FROM live_tv_recent WHERE user_id = ? ORDER BY last_watched_at DESC LIMIT ?'
  ).all(userId, n) as { channel_id: string; last_watched_at: string; watch_count: number }[];
  return rows.map(r => ({
    channel_id: r.channel_id,
    last_watched_at: r.last_watched_at,
    watch_count: r.watch_count,
    channel: getChannel(r.channel_id),
  }));
}

export function clearWatchState(userId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM live_tv_watch_state WHERE user_id = ?').run(userId);
}

// ============================================================
// 40.11 — Channel Favorites
// ============================================================

export interface FavoriteRow {
  user_id: string;
  channel_id: string;
  created_at: string;
  sort_order: number;
}

export interface FavoriteWithChannel extends FavoriteRow {
  channel: LiveTvChannel | null;
}

export function ensureLiveTvFavoritesSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS live_tv_favorites (
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, channel_id)
    );
    CREATE INDEX IF NOT EXISTS idx_livetv_fav_user ON live_tv_favorites(user_id, sort_order, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_livetv_fav_channel ON live_tv_favorites(channel_id);
  `);
}

export function addFavorite(userId: string, channelId: string, sortOrder = 0): FavoriteRow {
  const ch = getChannel(channelId);
  if (!ch) throw new Error('Channel not found');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO live_tv_favorites (user_id, channel_id, sort_order, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, channel_id) DO NOTHING
  `).run(userId, channelId, sortOrder, now);
  const row = db.prepare(
    'SELECT * FROM live_tv_favorites WHERE user_id = ? AND channel_id = ?'
  ).get(userId, channelId) as FavoriteRow;
  return row;
}

export function removeFavorite(userId: string, channelId: string): boolean {
  const db = getDb();
  const r = db.prepare(
    'DELETE FROM live_tv_favorites WHERE user_id = ? AND channel_id = ?'
  ).run(userId, channelId);
  return r.changes > 0;
}

export function isFavorite(userId: string, channelId: string): boolean {
  const db = getDb();
  const row = db.prepare(
    'SELECT 1 FROM live_tv_favorites WHERE user_id = ? AND channel_id = ? LIMIT 1'
  ).get(userId, channelId);
  return !!row;
}

export function toggleFavorite(userId: string, channelId: string): { favorited: boolean } {
  const db = getDb();
  const exists = isFavorite(userId, channelId);
  if (exists) {
    removeFavorite(userId, channelId);
    return { favorited: false };
  }
  addFavorite(userId, channelId);
  return { favorited: true };
}

export function listFavorites(userId: string, limit = 200): FavoriteWithChannel[] {
  const db = getDb();
  const n = Math.min(Math.max(limit, 1), 500);
  const rows = db.prepare(
    'SELECT * FROM live_tv_favorites WHERE user_id = ? ORDER BY sort_order ASC, created_at DESC LIMIT ?'
  ).all(userId, n) as FavoriteRow[];
  return rows.map(r => ({ ...r, channel: getChannel(r.channel_id) }));
}

export function countFavorites(userId: string): number {
  const db = getDb();
  const r = db.prepare(
    'SELECT COUNT(*) as n FROM live_tv_favorites WHERE user_id = ?'
  ).get(userId) as { n: number };
  return r.n;
}

export function setFavoriteOrder(userId: string, channelIds: string[]): void {
  const db = getDb();
  const upd = db.prepare(
    'UPDATE live_tv_favorites SET sort_order = ? WHERE user_id = ? AND channel_id = ?'
  );
  db.exec('BEGIN');
  try {
    channelIds.forEach((cid, idx) => upd.run(idx, userId, cid));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ============================================================
// 40.12 — Channel Parental Control
// ============================================================

export interface ParentalSettings {
  user_id: string;
  pin_hash: string;
  salt: string;
  max_age_rating: number;
  created_at: string;
  updated_at: string;
}

export interface BlockedChannel {
  user_id: string;
  channel_id: string;
  created_at: string;
}

export interface UnlockSession {
  user_id: string;
  unlocked_until: string;
}

export function ensureLiveTvParentalSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS live_tv_parental (
      user_id TEXT PRIMARY KEY,
      pin_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      max_age_rating INTEGER NOT NULL DEFAULT 18,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS live_tv_blocked_channels (
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, channel_id)
    );
    CREATE INDEX IF NOT EXISTS idx_livetv_blocked_channel ON live_tv_blocked_channels(channel_id);

    CREATE TABLE IF NOT EXISTS live_tv_unlock_sessions (
      user_id TEXT PRIMARY KEY,
      unlocked_until TEXT NOT NULL
    );

    -- age_rating column on live_tv_channels (idempotent)
  `);

  // Idempotent column add
  try { db.exec('ALTER TABLE live_tv_channels ADD COLUMN age_rating INTEGER NOT NULL DEFAULT 0'); } catch {}
}

// ---- PIN helpers ----

function hashPin(pin: string, salt: string): string {
  return scryptSync(pin, salt, 64).toString('hex');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export function setPin(userId: string, pin: string, maxAgeRating = 18): ParentalSettings {
  if (!/^\d{4,6}$/.test(pin)) throw new Error('PIN must be 4–6 digits');
  const db = getDb();
  const now = new Date().toISOString();
  const salt = randomBytes(16).toString('hex');
  const pin_hash = hashPin(pin, salt);

  db.prepare(`
    INSERT INTO live_tv_parental (user_id, pin_hash, salt, max_age_rating, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      pin_hash = excluded.pin_hash,
      salt = excluded.salt,
      max_age_rating = excluded.max_age_rating,
      updated_at = excluded.updated_at
  `).run(userId, pin_hash, salt, maxAgeRating, now, now);

  return getParentalSettings(userId)!;
}

export function getParentalSettings(userId: string): ParentalSettings | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM live_tv_parental WHERE user_id = ?'
  ).get(userId) as ParentalSettings | undefined;
  return row ?? null;
}

export function hasPin(userId: string): boolean {
  return !!getParentalSettings(userId);
}

export function removePin(userId: string, currentPin: string): boolean {
  const settings = getParentalSettings(userId);
  if (!settings) return false;
  const hash = hashPin(currentPin, settings.salt);
  if (!safeEqual(hash, settings.pin_hash)) return false;
  const db = getDb();
  db.prepare('DELETE FROM live_tv_parental WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM live_tv_unlock_sessions WHERE user_id = ?').run(userId);
  return true;
}

export function changePin(userId: string, currentPin: string, newPin: string): boolean {
  const settings = getParentalSettings(userId);
  if (!settings) return false;
  const hash = hashPin(currentPin, settings.salt);
  if (!safeEqual(hash, settings.pin_hash)) return false;
  setPin(userId, newPin, settings.max_age_rating);
  return true;
}

export function updateMaxAgeRating(userId: string, maxAgeRating: number): ParentalSettings | null {
  const db = getDb();
  const now = new Date().toISOString();
  const r = db.prepare(
    'UPDATE live_tv_parental SET max_age_rating = ?, updated_at = ? WHERE user_id = ?'
  ).run(Math.max(0, Math.min(21, maxAgeRating)), now, userId);
  if (r.changes === 0) return null;
  return getParentalSettings(userId);
}

// ---- Unlock sessions ----

export const UNLOCK_DURATION_MS = 60 * 60 * 1000; // 1 hour

export function verifyPin(userId: string, pin: string): boolean {
  const settings = getParentalSettings(userId);
  if (!settings) return false;
  const hash = hashPin(pin, settings.salt);
  return safeEqual(hash, settings.pin_hash);
}

export function unlockSession(userId: string, pin: string): { unlocked_until: string } | null {
  if (!verifyPin(userId, pin)) return null;
  const db = getDb();
  const until = new Date(Date.now() + UNLOCK_DURATION_MS).toISOString();
  db.prepare(`
    INSERT INTO live_tv_unlock_sessions (user_id, unlocked_until)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET unlocked_until = excluded.unlocked_until
  `).run(userId, until);
  return { unlocked_until: until };
}

export function isUnlocked(userId: string): boolean {
  const db = getDb();
  const row = db.prepare(
    'SELECT unlocked_until FROM live_tv_unlock_sessions WHERE user_id = ?'
  ).get(userId) as UnlockSession | undefined;
  if (!row) return false;
  return new Date(row.unlocked_until).getTime() > Date.now();
}

export function lockSession(userId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM live_tv_unlock_sessions WHERE user_id = ?').run(userId);
}

// ---- Blocked channels ----

export function blockChannel(userId: string, channelId: string): BlockedChannel {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO live_tv_blocked_channels (user_id, channel_id, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, channel_id) DO NOTHING
  `).run(userId, channelId, now);
  return db.prepare(
    'SELECT * FROM live_tv_blocked_channels WHERE user_id = ? AND channel_id = ?'
  ).get(userId, channelId) as BlockedChannel;
}

export function unblockChannel(userId: string, channelId: string): boolean {
  const db = getDb();
  const r = db.prepare(
    'DELETE FROM live_tv_blocked_channels WHERE user_id = ? AND channel_id = ?'
  ).run(userId, channelId);
  return r.changes > 0;
}

export function listBlockedChannels(userId: string): { channel_id: string; channel: LiveTvChannel | null; created_at: string }[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM live_tv_blocked_channels WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId) as BlockedChannel[];
  return rows.map(r => ({ channel_id: r.channel_id, channel: getChannel(r.channel_id), created_at: r.created_at }));
}

export function isChannelBlocked(userId: string, channelId: string): boolean {
  const db = getDb();
  const row = db.prepare(
    'SELECT 1 FROM live_tv_blocked_channels WHERE user_id = ? AND channel_id = ? LIMIT 1'
  ).get(userId, channelId);
  return !!row;
}

// ---- Access control ----

export interface AccessCheck {
  allowed: boolean;
  reason: 'ok' | 'blocked' | 'age' | 'unlocked';
  channel_age_rating: number;
  max_age_rating: number;
  requires_pin: boolean;
}

export function checkAccess(userId: string | null, channelId: string): AccessCheck {
  const ch = getChannel(channelId);
  if (!ch) throw new Error('Channel not found');

  const ageRating = (ch as any).age_rating ?? 0;

  // No user or no PIN set → no parental gate
  if (!userId || !hasPin(userId)) {
    return {
      allowed: true,
      reason: 'ok',
      channel_age_rating: ageRating,
      max_age_rating: 21,
      requires_pin: false,
    };
  }

  // Explicitly blocked channel
  if (isChannelBlocked(userId, channelId)) {
    if (isUnlocked(userId)) {
      return {
        allowed: true,
        reason: 'unlocked',
        channel_age_rating: ageRating,
        max_age_rating: getParentalSettings(userId)!.max_age_rating,
        requires_pin: false,
      };
    }
    return {
      allowed: false,
      reason: 'blocked',
      channel_age_rating: ageRating,
      max_age_rating: getParentalSettings(userId)!.max_age_rating,
      requires_pin: true,
    };
  }

  // Age gate
  const settings = getParentalSettings(userId)!;
  if (ageRating > settings.max_age_rating) {
    if (isUnlocked(userId)) {
      return {
        allowed: true,
        reason: 'unlocked',
        channel_age_rating: ageRating,
        max_age_rating: settings.max_age_rating,
        requires_pin: false,
      };
    }
    return {
      allowed: false,
      reason: 'age',
      channel_age_rating: ageRating,
      max_age_rating: settings.max_age_rating,
      requires_pin: true,
    };
  }

  return {
    allowed: true,
    reason: 'ok',
    channel_age_rating: ageRating,
    max_age_rating: settings.max_age_rating,
    requires_pin: false,
  };
}

export function setChannelAgeRating(channelId: string, ageRating: number): LiveTvChannel | null {
  const db = getDb();
  const now = new Date().toISOString();
  const r = db.prepare(
    'UPDATE live_tv_channels SET age_rating = ?, updated_at = ? WHERE id = ?'
  ).run(Math.max(0, Math.min(21, ageRating)), now, channelId);
  if (r.changes === 0) return null;
  return getChannel(channelId);
}

// ============================================================
// 40.9 — Live TV Chat (polling-based, channel-scoped)
// ============================================================

export interface LiveTvChatMessage {
  id: string;
  channel_id: string;
  user_id: string;
  content: string;
  is_hidden: number;
  created_at: string;
}

export function ensureLiveTvChatSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS livetv_chat_messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_livetv_chat_channel_time
      ON livetv_chat_messages(channel_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_livetv_chat_user_time
      ON livetv_chat_messages(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS livetv_chat_reports (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      reporter_id TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (message_id, reporter_id)
    );
    CREATE INDEX IF NOT EXISTS idx_livetv_chat_reports_msg
      ON livetv_chat_reports(message_id);
  `);
}

const MAX_CHAT_LEN = 500;
const RATE_WINDOW_MS = 3000; // 1 message per 3s per user per channel

export interface PostChatResult {
  message: LiveTvChatMessage;
  rate_limited?: false;
}

export function postLiveTvChat(
  channelId: string,
  userId: string,
  content: string
): LiveTvChatMessage {
  const trimmed = (content ?? '').trim();
  if (!trimmed) throw new Error('Empty message');
  if (trimmed.length > MAX_CHAT_LEN) throw new Error('Message too long (max ' + MAX_CHAT_LEN + ')');

  const ch = getChannel(channelId);
  if (!ch) throw new Error('Channel not found');

  const db = getDb();

  // Rate limit: check last message by this user on this channel
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const recent = db.prepare(
    'SELECT 1 FROM livetv_chat_messages WHERE channel_id = ? AND user_id = ? AND created_at > ? LIMIT 1'
  ).get(channelId, userId, since);
  if (recent) throw new Error('Rate limited — wait a few seconds');

  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO livetv_chat_messages (id, channel_id, user_id, content, is_hidden, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(id, channelId, userId, trimmed, now);

  return db.prepare(
    'SELECT * FROM livetv_chat_messages WHERE id = ?'
  ).get(id) as LiveTvChatMessage;
}

export function listLiveTvChat(
  channelId: string,
  opts: { limit?: number; since?: string; include_hidden?: boolean } = {}
): LiveTvChatMessage[] {
  const db = getDb();
  const where: string[] = ['channel_id = ?'];
  const params: any[] = [channelId];
  if (!opts.include_hidden) where.push('is_hidden = 0');
  if (opts.since) { where.push('created_at > ?'); params.push(opts.since); }
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  params.push(limit);
  return db.prepare(
    `SELECT * FROM livetv_chat_messages WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`
  ).all(...params).reverse() as LiveTvChatMessage[];
}

export function deleteLiveTvChat(messageId: string, requesterId: string): boolean {
  const db = getDb();
  const msg = db.prepare(
    'SELECT user_id FROM livetv_chat_messages WHERE id = ?'
  ).get(messageId) as { user_id: string } | undefined;
  if (!msg) return false;
  if (msg.user_id !== requesterId) throw new Error('Not your message');
  const r = db.prepare('DELETE FROM livetv_chat_messages WHERE id = ?').run(messageId);
  return r.changes > 0;
}

export function hideLiveTvChat(messageId: string): boolean {
  const db = getDb();
  const r = db.prepare(
    'UPDATE livetv_chat_messages SET is_hidden = 1 WHERE id = ?'
  ).run(messageId);
  return r.changes > 0;
}

export function reportLiveTvChat(messageId: string, reporterId: string, reason?: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO livetv_chat_reports (id, message_id, reporter_id, reason, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(message_id, reporter_id) DO NOTHING
  `).run(randomUUID(), messageId, reporterId, reason ?? null, now);
}

export function countRecentChat(channelId: string, windowMs = 60_000): number {
  const db = getDb();
  const since = new Date(Date.now() - windowMs).toISOString();
  const r = db.prepare(
    'SELECT COUNT(*) as n FROM livetv_chat_messages WHERE channel_id = ? AND created_at > ? AND is_hidden = 0'
  ).get(channelId, since) as { n: number };
  return r.n;
}

// Helper for moderation: get channel ownership by chat message id
export function getChatMessageChannelOwner(messageId: string): { channel_id: string; owner_id: string } | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT m.channel_id as channel_id, c.owner_id as owner_id
    FROM livetv_chat_messages m
    JOIN live_tv_channels c ON c.id = m.channel_id
    WHERE m.id = ?
  `).get(messageId) as { channel_id: string; owner_id: string } | undefined;
  return row ?? null;
}

// ============================================================
// 40.4 — Live TV Recording (DVR)
// Layer 1: schema + scheduling + lifecycle metadata (no FFmpeg)
// Layer 3: real FFmpeg spawn in separate functions below
// ============================================================

export type RecordingStatus =
  | 'scheduled'
  | 'recording'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface LiveTvRecording {
  id: string;
  channel_id: string;
  user_id: string;
  title: string;
  start_ts: string;
  stop_ts: string;
  status: RecordingStatus;
  file_path: string | null;
  file_size_bytes: number;
  duration_seconds: number;
  pid: number | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export function ensureLiveTvDvrSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS live_tv_recordings (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      start_ts TEXT NOT NULL,
      stop_ts TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('scheduled','recording','completed','failed','cancelled')),
      file_path TEXT,
      file_size_bytes INTEGER NOT NULL DEFAULT 0,
      duration_seconds REAL NOT NULL DEFAULT 0,
      pid INTEGER,
      error_message TEXT,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_livetv_rec_user ON live_tv_recordings(user_id, start_ts DESC);
    CREATE INDEX IF NOT EXISTS idx_livetv_rec_channel ON live_tv_recordings(channel_id, start_ts DESC);
    CREATE INDEX IF NOT EXISTS idx_livetv_rec_status ON live_tv_recordings(status, start_ts);
    CREATE INDEX IF NOT EXISTS idx_livetv_rec_window ON live_tv_recordings(channel_id, start_ts, stop_ts);
  `);
}

export interface ScheduleRecordingInput {
  channel_id: string;
  user_id: string;
  title?: string;
  start_ts: string;
  stop_ts: string;
}

export function scheduleRecording(input: ScheduleRecordingInput): LiveTvRecording {
  const ch = getChannel(input.channel_id);
  if (!ch) throw new Error('Channel not found');

  const start = new Date(input.start_ts).getTime();
  const stop = new Date(input.stop_ts).getTime();
  if (isNaN(start) || isNaN(stop)) throw new Error('Invalid start/stop');
  if (stop <= start) throw new Error('stop must be after start');
  const durationMin = (stop - start) / 60000;
  if (durationMin > 240) throw new Error('Max recording duration is 4 hours');
  if (durationMin < 0.5) throw new Error('Min recording duration is 30 seconds');

  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  const title = (input.title ?? ch.name + ' recording').slice(0, 200);

  db.prepare(`
    INSERT INTO live_tv_recordings
      (id, channel_id, user_id, title, start_ts, stop_ts, status, file_path,
       file_size_bytes, duration_seconds, pid, error_message, started_at,
       finished_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'scheduled', NULL, 0, 0, NULL, NULL, NULL, NULL, ?, ?)
  `).run(id, input.channel_id, input.user_id, title, input.start_ts, input.stop_ts, now, now);

  return getRecording(id)!;
}

export function getRecording(id: string): LiveTvRecording | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM live_tv_recordings WHERE id = ?')
    .get(id) as LiveTvRecording | undefined;
  return row ?? null;
}

export interface ListRecordingsFilters {
  user_id?: string;
  channel_id?: string;
  status?: RecordingStatus;
  from?: string;
  to?: string;
  limit?: number;
}

export function listRecordings(f: ListRecordingsFilters = {}): LiveTvRecording[] {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];
  if (f.user_id)    { where.push('user_id = ?');    params.push(f.user_id); }
  if (f.channel_id) { where.push('channel_id = ?'); params.push(f.channel_id); }
  if (f.status)     { where.push('status = ?');     params.push(f.status); }
  if (f.from)       { where.push('stop_ts >= ?');   params.push(f.from); }
  if (f.to)         { where.push('start_ts <= ?');  params.push(f.to); }
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
  const sql = `SELECT * FROM live_tv_recordings
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY start_ts DESC LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params) as LiveTvRecording[];
}

export function cancelRecording(id: string, requesterId: string): boolean {
  const rec = getRecording(id);
  if (!rec) return false;
  if (rec.user_id !== requesterId) throw new Error('Not your recording');
  if (rec.status !== 'scheduled') throw new Error('Only scheduled recordings can be cancelled');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE live_tv_recordings SET status = 'cancelled', updated_at = ? WHERE id = ?"
  ).run(now, id);
  return true;
}

export function deleteRecording(id: string, requesterId: string): boolean {
  const rec = getRecording(id);
  if (!rec) return false;
  if (rec.user_id !== requesterId) throw new Error('Not your recording');
  // Note: actual file deletion is handled by higher layer (filesystem access)
  const db = getDb();
  const r = db.prepare('DELETE FROM live_tv_recordings WHERE id = ?').run(id);
  return r.changes > 0;
}

// Poller helper: what should be recording right now?
export function getDueRecordings(nowIso = new Date().toISOString()): LiveTvRecording[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM live_tv_recordings
    WHERE status = 'scheduled'
      AND start_ts <= ?
      AND stop_ts > ?
    ORDER BY start_ts ASC
  `).all(nowIso, nowIso) as LiveTvRecording[];
}

// Poller helper: what's currently recording but should have stopped?
export function getExpiredRecordings(nowIso = new Date().toISOString()): LiveTvRecording[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM live_tv_recordings
    WHERE status = 'recording'
      AND stop_ts <= ?
    ORDER BY start_ts ASC
  `).all(nowIso) as LiveTvRecording[];
}

export function markRecordingStarted(id: string, pid: number): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE live_tv_recordings
    SET status = 'recording', pid = ?, started_at = ?, updated_at = ?
    WHERE id = ?
  `).run(pid, now, now, id);
}

export function markRecordingCompleted(id: string, fileSize: number, durationS: number): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE live_tv_recordings
    SET status = 'completed', file_size_bytes = ?, duration_seconds = ?,
        finished_at = ?, pid = NULL, updated_at = ?
    WHERE id = ?
  `).run(fileSize, durationS, now, now, id);
}

export function markRecordingFailed(id: string, errorMessage: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE live_tv_recordings
    SET status = 'failed', error_message = ?, finished_at = ?,
        pid = NULL, updated_at = ?
    WHERE id = ?
  `).run(errorMessage.slice(0, 500), now, now, id);
}

export function setRecordingFilePath(id: string, filePath: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE live_tv_recordings SET file_path = ?, updated_at = ? WHERE id = ?'
  ).run(filePath, now, id);
}

// Stats
export function recordingStats(userId: string): {
  total: number;
  scheduled: number;
  recording: number;
  completed: number;
  failed: number;
  total_bytes: number;
} {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status='scheduled'  THEN 1 ELSE 0 END) as scheduled,
      SUM(CASE WHEN status='recording'  THEN 1 ELSE 0 END) as recording,
      SUM(CASE WHEN status='completed'  THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status='failed'     THEN 1 ELSE 0 END) as failed,
      COALESCE(SUM(file_size_bytes), 0) as total_bytes
    FROM live_tv_recordings WHERE user_id = ?
  `).get(userId) as any;
  return {
    total: row.total ?? 0,
    scheduled: row.scheduled ?? 0,
    recording: row.recording ?? 0,
    completed: row.completed ?? 0,
    failed: row.failed ?? 0,
    total_bytes: row.total_bytes ?? 0,
  };
}

// ============================================================
// 40.4 DVR — Layer 3: FFmpeg capture (opt-in)
// ============================================================
// IMPORTANT: This spawns a real subprocess that uses CPU/RAM.
// Disabled by default; enable with MELODYFLIX_FFMPEG_ENABLED=1.
// On low-RAM devices (Termux phone) this may trigger OOM kills.

export interface FfmpegCaptureOptions {
  recording_id: string;
  channel_id: string;
  stream_url: string;
  start_ts: string;
  stop_ts: string;
  outputDir?: string;
}

export interface FfmpegCaptureResult {
  ok: boolean;
  pid?: number;
  file_path?: string;
  error?: string;
  mock?: boolean;
}

function isFfmpegEnabled(): boolean {
  return process.env.MELODYFLIX_FFMPEG_ENABLED === '1';
}

function recordingsDir(): string {
  return process.env.MELODYFLIX_RECORDINGS_DIR
    ?? pathJoin(process.cwd(), 'data', 'recordings');
}

function calcDurationSeconds(start_ts: string, stop_ts: string): number {
  const s = new Date(start_ts).getTime();
  const e = new Date(stop_ts).getTime();
  if (isNaN(s) || isNaN(e)) return 0;
  return Math.max(0, (e - s) / 1000);
}

export async function startFfmpegCapture(opts: FfmpegCaptureOptions): Promise<FfmpegCaptureResult> {
  const durationS = calcDurationSeconds(opts.start_ts, opts.stop_ts);
  const outDir = opts.outputDir ?? recordingsDir();
  const outPath = pathJoin(outDir, `${opts.recording_id}.mp4`);

  // --- MOCK MODE (default) ---
  if (!isFfmpegEnabled()) {
    await fsp.mkdir(outDir, { recursive: true });
    await fsp.writeFile(outPath, '');
    markRecordingStarted(opts.recording_id, -1);
    setRecordingFilePath(opts.recording_id, outPath);
    return { ok: true, pid: -1, file_path: outPath, mock: true };
  }

  // --- REAL MODE ---
  await fsp.mkdir(outDir, { recursive: true });

  const args = [
    '-y',
    '-loglevel', 'warning',
    '-i', opts.stream_url,
    '-t', String(Math.ceil(durationS)),
    '-c', 'copy',
    '-bsf:a', 'aac_adtstoasc',
    outPath,
  ];

  try {
    const child = spawn('ffmpeg', args, {
      detached: true,
      stdio: 'ignore',
    });

    if (!child.pid) {
      markRecordingFailed(opts.recording_id, 'ffmpeg spawn returned no pid');
      return { ok: false, error: 'no pid' };
    }

    markRecordingStarted(opts.recording_id, child.pid);
    setRecordingFilePath(opts.recording_id, outPath);

    child.on('exit', (code) => {
      // This listener only fires if the process is still attached (rare in detached mode).
      // The worker/poller is responsible for marking completion.
      if (code !== 0) {
        try { markRecordingFailed(opts.recording_id, `ffmpeg exit ${code}`); } catch {}
      }
    });

    child.unref();
    return { ok: true, pid: child.pid, file_path: outPath };
  } catch (e: any) {
    markRecordingFailed(opts.recording_id, e?.message ?? 'spawn failed');
    return { ok: false, error: e?.message ?? 'spawn failed' };
  }
}

// Called by worker when the recording window has passed.
export async function finalizeCapture(recording_id: string): Promise<void> {
  const rec = getRecording(recording_id);
  if (!rec) return;
  if (rec.status !== 'recording') return;

  let size = 0;
  let duration = calcDurationSeconds(rec.start_ts, rec.stop_ts);

  if (rec.file_path) {
    try {
      const st = await fsp.stat(rec.file_path);
      size = st.size;
    } catch {
      // file might have been written by a mock — treat as 0 size
    }
  }

  markRecordingCompleted(recording_id, size, duration);
}

// Utility: clean up an mp4 file after DB row is deleted.
export async function deleteRecordingFile(filePath: string | null): Promise<boolean> {
  if (!filePath) return false;
  try {
    await fsp.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

// Ensure dir exists (called from worker startup).
export async function ensureRecordingsDir(): Promise<string> {
  const dir = recordingsDir();
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}
