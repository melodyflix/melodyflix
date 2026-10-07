// melodyflix videos - user preferences (autoplay, quality, theme, etc.)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export interface Preferences {
  user_id: string;
  autoplay_next: number;
  autoplay_playlist: number;
  default_quality: string;
  default_speed: number;
  theme: string;
  language: string;
  reduced_motion: number;
  captions_on: number;
  updated_at: string;
}

export function ensurePreferencesSchema(): void {
  const db = getDb();
  db.exec(
    'CREATE TABLE IF NOT EXISTS user_preferences (' +
    '  user_id TEXT PRIMARY KEY,' +
    '  autoplay_next INTEGER NOT NULL DEFAULT 1,' +
    '  autoplay_playlist INTEGER NOT NULL DEFAULT 1,' +
    '  default_quality TEXT NOT NULL DEFAULT "auto",' +
    '  default_speed REAL NOT NULL DEFAULT 1.0,' +
    '  theme TEXT NOT NULL DEFAULT "system",' +
    '  language TEXT NOT NULL DEFAULT "en",' +
    '  reduced_motion INTEGER NOT NULL DEFAULT 0,' +
    '  captions_on INTEGER NOT NULL DEFAULT 0,' +
    '  updated_at TEXT NOT NULL' +
    ');'
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_interest_profile (
      user_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'view',
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, topic)
    );
    CREATE INDEX IF NOT EXISTS idx_interest_user_score ON user_interest_profile(user_id, score DESC);
    CREATE INDEX IF NOT EXISTS idx_interest_topic ON user_interest_profile(topic, score DESC);

    CREATE TABLE IF NOT EXISTS user_blocked_keywords (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (user_id, keyword)
    );
    CREATE INDEX IF NOT EXISTS idx_blocked_kw_user ON user_blocked_keywords(user_id);

    CREATE TABLE IF NOT EXISTS user_blocked_channels (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (user_id, channel_id)
    );
    CREATE INDEX IF NOT EXISTS idx_blocked_chan_user ON user_blocked_channels(user_id);
  `);
}

const DEFAULT_PREFS = {
  autoplay_next: 1,
  autoplay_playlist: 1,
  default_quality: 'auto',
  default_speed: 1.0,
  theme: 'system',
  language: 'en',
  reduced_motion: 0,
  captions_on: 0,
};

export function getPreferences(userId: string): Preferences {
  const db = getDb();
  const row = db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId) as Preferences | undefined;
  if (row) return row;
  // Return defaults without inserting
  return {
    user_id: userId,
    ...DEFAULT_PREFS,
    updated_at: new Date().toISOString(),
  } as Preferences;
}

export function updatePreferences(userId: string, patch: Partial<Omit<Preferences, 'user_id' | 'updated_at'>>): Preferences {
  const db = getDb();
  const current = getPreferences(userId);
  const merged = { ...current, ...patch };
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT user_id FROM user_preferences WHERE user_id = ?').get(userId);
  if (existing) {
    db.prepare(
      'UPDATE user_preferences SET autoplay_next = ?, autoplay_playlist = ?, default_quality = ?, default_speed = ?, theme = ?, language = ?, reduced_motion = ?, captions_on = ?, updated_at = ? WHERE user_id = ?'
    ).run(
      merged.autoplay_next, merged.autoplay_playlist, merged.default_quality, merged.default_speed,
      merged.theme, merged.language, merged.reduced_motion, merged.captions_on, now, userId
    );
  } else {
    db.prepare(
      'INSERT INTO user_preferences (user_id, autoplay_next, autoplay_playlist, default_quality, default_speed, theme, language, reduced_motion, captions_on, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      userId, merged.autoplay_next, merged.autoplay_playlist, merged.default_quality, merged.default_speed,
      merged.theme, merged.language, merged.reduced_motion, merged.captions_on, now
    );
  }
  return getPreferences(userId);
}

export function resetPreferences(userId: string): Preferences {
  const db = getDb();
  db.prepare('DELETE FROM user_preferences WHERE user_id = ?').run(userId);
  return getPreferences(userId);
}

// ============================================================
// 14.2 Interest Profile
// Simple weighted-topic profile built from views/likes/searches.
// Decay applied on read to prefer recent signals.
// ============================================================

export interface InterestRow {
  topic: string;
  score: number;
  source: string;
  last_seen_at: string;
}

export interface InterestProfile {
  user_id: string;
  topics: InterestRow[];
  updated_at: string;
}

export interface RecordInterestInput {
  topic: string;
  weight?: number;
  source?: 'view' | 'like' | 'search' | 'share' | 'purchase' | 'manual';
}

const HALF_LIFE_DAYS = 30;

export function recordInterest(userId: string, input: RecordInterestInput): InterestRow {
  const db = getDb();
  const topic = input.topic.trim().toLowerCase();
  if (!topic) throw new Error('topic_required');
  const weight = Math.max(0.1, Math.min(input.weight ?? 1, 10));
  const source = input.source ?? 'view';
  const now = new Date().toISOString();
  const existing = db.prepare(
    'SELECT * FROM user_interest_profile WHERE user_id = ? AND topic = ?'
  ).get(userId, topic) as (InterestRow & { created_at: string; updated_at: string }) | undefined;
  if (existing) {
    db.prepare(
      'UPDATE user_interest_profile SET score = score + ?, source = ?, last_seen_at = ?, updated_at = ? WHERE user_id = ? AND topic = ?'
    ).run(weight, source, now, now, userId, topic);
  } else {
    db.prepare(
      'INSERT INTO user_interest_profile (user_id, topic, score, source, last_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(userId, topic, weight, source, now, now, now);
  }
  return db.prepare(
    'SELECT topic, score, source, last_seen_at FROM user_interest_profile WHERE user_id = ? AND topic = ?'
  ).get(userId, topic) as InterestRow;
}

export function recordInterestsBulk(userId: string, items: RecordInterestInput[]): { recorded: number } {
  let n = 0;
  for (const it of items) {
    try { recordInterest(userId, it); n++; } catch { /* skip */ }
  }
  return { recorded: n };
}

function decayScore(score: number, lastSeenAt: string): number {
  const days = (Date.now() - new Date(lastSeenAt).getTime()) / 86_400_000;
  if (days <= 0) return score;
  const factor = Math.pow(0.5, days / HALF_LIFE_DAYS);
  return Math.round(score * factor * 1000) / 1000;
}

export function getUserInterestProfile(userId: string, limit = 50): InterestProfile {
  const db = getDb();
  const rows = db.prepare(
    'SELECT topic, score, source, last_seen_at FROM user_interest_profile WHERE user_id = ? ORDER BY score DESC LIMIT ?'
  ).all(userId, limit) as InterestRow[];
  const decayed = rows
    .map(r => ({ ...r, score: decayScore(r.score, r.last_seen_at) }))
    .sort((a, b) => b.score - a.score);
  return {
    user_id: userId,
    topics: decayed,
    updated_at: new Date().toISOString(),
  };
}

export function clearInterestProfile(userId: string): { cleared: number } {
  const db = getDb();
  const r = db.prepare('DELETE FROM user_interest_profile WHERE user_id = ?').run(userId);
  return { cleared: r.changes };
}

export function removeInterestTopic(userId: string, topic: string): boolean {
  const db = getDb();
  const r = db.prepare('DELETE FROM user_interest_profile WHERE user_id = ? AND topic = ?')
    .run(userId, topic.trim().toLowerCase());
  return r.changes > 0;
}

// Rebuild the interest profile from recent video views (aggregated per genre/tag).
export function rebuildInterestsFromViews(userId: string, opts: { days?: number } = {}): { topics: number } {
  const db = getDb();
  const days = Math.min(Math.max(opts.days ?? 90, 1), 730);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  clearInterestProfile(userId);
  let topics = 0;
  try {
    // Genres via video_genres join (if present)
    const genres = db.prepare(`
      SELECT g.name AS topic, COUNT(*) AS c
      FROM video_views vv
      JOIN video_genres vg ON vg.video_id = vv.video_id
      JOIN genres g ON g.id = vg.genre_id
      WHERE vv.user_id = ? AND vv.created_at >= ?
      GROUP BY g.name
      ORDER BY c DESC
      LIMIT 30
    `).all(userId, since) as Array<{ topic: string; c: number }>;
    for (const g of genres) {
      recordInterest(userId, { topic: g.topic, weight: 1 + Math.min(g.c, 9), source: 'view' });
      topics++;
    }
  } catch { /* no genres table or no data */ }
  return { topics };
}

// ============================================================
// 14.3 Keyword/Channel Block
// ============================================================

export interface BlockedKeyword {
  id: string;
  user_id: string;
  keyword: string;
  created_at: string;
}

export interface BlockedChannel {
  id: string;
  user_id: string;
  channel_id: string;
  reason: string | null;
  created_at: string;
}

export function addBlockedKeyword(userId: string, keyword: string): BlockedKeyword {
  const db = getDb();
  const kw = keyword.trim().toLowerCase();
  if (!kw || kw.length > 100) throw new Error('invalid_keyword');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT OR IGNORE INTO user_blocked_keywords (id, user_id, keyword, created_at) VALUES (?, ?, ?, ?)'
  ).run(id, userId, kw, now);
  const row = db.prepare(
    'SELECT * FROM user_blocked_keywords WHERE user_id = ? AND keyword = ?'
  ).get(userId, kw) as BlockedKeyword;
  return row;
}

export function removeBlockedKeyword(userId: string, keyword: string): boolean {
  const db = getDb();
  const r = db.prepare('DELETE FROM user_blocked_keywords WHERE user_id = ? AND keyword = ?')
    .run(userId, keyword.trim().toLowerCase());
  return r.changes > 0;
}

export function listBlockedKeywords(userId: string): BlockedKeyword[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM user_blocked_keywords WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId) as BlockedKeyword[];
}

export function addBlockedChannel(userId: string, channelId: string, reason?: string): BlockedChannel {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT OR IGNORE INTO user_blocked_channels (id, user_id, channel_id, reason, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, userId, channelId, reason ?? null, now);
  const row = db.prepare(
    'SELECT * FROM user_blocked_channels WHERE user_id = ? AND channel_id = ?'
  ).get(userId, channelId) as BlockedChannel;
  return row;
}

export function removeBlockedChannel(userId: string, channelId: string): boolean {
  const db = getDb();
  const r = db.prepare('DELETE FROM user_blocked_channels WHERE user_id = ? AND channel_id = ?')
    .run(userId, channelId);
  return r.changes > 0;
}

export function listBlockedChannels(userId: string): BlockedChannel[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM user_blocked_channels WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId) as BlockedChannel[];
}

export interface BlockCheckInput {
  channel_id?: string | null;
  title?: string | null;
  description?: string | null;
  tags?: string[] | null;
}

export interface BlockCheckResult {
  blocked: boolean;
  reason: 'channel' | 'keyword' | null;
  matched_keyword?: string;
}

export function isContentBlocked(userId: string, input: BlockCheckInput): BlockCheckResult {
  const db = getDb();
  if (input.channel_id) {
    const ch = db.prepare(
      'SELECT id FROM user_blocked_channels WHERE user_id = ? AND channel_id = ?'
    ).get(userId, input.channel_id);
    if (ch) return { blocked: true, reason: 'channel' };
  }
  const kws = db.prepare(
    'SELECT keyword FROM user_blocked_keywords WHERE user_id = ?'
  ).all(userId) as { keyword: string }[];
  if (kws.length === 0) return { blocked: false, reason: null };
  const haystack = [
    input.title ?? '',
    input.description ?? '',
    ...(input.tags ?? []),
  ].join(' ').toLowerCase();
  if (!haystack.trim()) return { blocked: false, reason: null };
  for (const { keyword } of kws) {
    if (haystack.includes(keyword)) {
      return { blocked: true, reason: 'keyword', matched_keyword: keyword };
    }
  }
  return { blocked: false, reason: null };
}

export interface BlockFilterResult<T> {
  kept: T[];
  filtered: number;
}

export function filterBlockedContent<T extends BlockCheckInput>(
  userId: string, items: T[]
): BlockFilterResult<T> {
  if (!userId || items.length === 0) return { kept: items, filtered: 0 };
  const kept: T[] = [];
  let filtered = 0;
  for (const item of items) {
    if (isContentBlocked(userId, item).blocked) filtered++;
    else kept.push(item);
  }
  return { kept, filtered };
}
