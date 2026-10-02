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
