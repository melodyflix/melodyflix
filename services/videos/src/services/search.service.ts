// melodyflix videos — Search enhancements (Section 5.8, 5.9, 5.10, 5.11)
// Typo-tolerant search, suggestions, history, analytics.

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export function ensureSearchSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      query TEXT NOT NULL,
      filters_json TEXT,
      result_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_search_hist_user
      ON search_history(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS search_analytics (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      query TEXT NOT NULL,
      normalized TEXT NOT NULL,
      filters_json TEXT,
      result_count INTEGER NOT NULL DEFAULT 0,
      clicked_video_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_search_analytics_norm
      ON search_analytics(normalized, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_search_analytics_time
      ON search_analytics(created_at DESC);

    CREATE TABLE IF NOT EXISTS search_suggestions_cache (
      normalized TEXT PRIMARY KEY,
      display TEXT NOT NULL,
      usage_count INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_search_sugg_count
      ON search_suggestions_cache(usage_count DESC, last_seen_at DESC);
  `);
}

// ---------- Normalization + typo correction ----------

export function normalizeQuery(q: string): string {
  return (q ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Levenshtein distance — small strings, capped for perf
function levenshtein(a: string, b: string, maxDist = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + cost
      );
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > maxDist) return maxDist + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

// Returns edit distance when a candidate is a good match, else null.
// Tries (a) whole-string distance; (b) first-word distance for partial
// queries (so "javscript" matches "javascript tutorial"). Partial matches
// get a small penalty so exact whole-string matches win.
function matchScore(query: string, candidate: string, maxDistance: number): number | null {
  // (a) Whole-string
  const wholeDist = levenshtein(query, candidate, maxDistance);
  if (wholeDist <= maxDistance) return wholeDist;

  // (b) First-word partial match
  const qFirst = query.split(' ')[0] ?? query;
  const cFirst = candidate.split(' ')[0] ?? candidate;
  if (Math.abs(qFirst.length - cFirst.length) > maxDistance) return null;
  const firstDist = levenshtein(qFirst, cFirst, maxDistance);
  if (firstDist <= maxDistance) return firstDist + 0.5;
  return null;
}

export interface TypoCorrection {
  original: string;
  corrected: string | null;
  distance: number;
  source: 'suggestion_cache' | 'top_terms' | 'none';
}

// Return closest known term if edit distance is small
export function correctTypo(query: string, maxDistance = 2): TypoCorrection {
  const norm = normalizeQuery(query);
  if (norm.length < 3) {
    return { original: query, corrected: null, distance: 0, source: 'none' };
  }
  const db = getDb();

  // 1. Check suggestions cache first
  const cached = db.prepare(
    `SELECT display, normalized FROM search_suggestions_cache
     WHERE normalized != ? ORDER BY usage_count DESC LIMIT 200`
  ).all(norm) as { display: string; normalized: string }[];

  let best: { display: string; norm: string; dist: number; source: TypoCorrection['source'] } | null = null;
  for (const c of cached) {
    const score = matchScore(norm, c.normalized, maxDistance);
    if (score !== null && (!best || score < best.dist)) {
      best = { display: c.display, norm: c.normalized, dist: score, source: 'suggestion_cache' };
    }
  }

  // 2. Fallback — top query terms from analytics
  if (!best) {
    const top = db.prepare(
      `SELECT normalized, COUNT(*) as n FROM search_analytics
       WHERE normalized != ?
       GROUP BY normalized ORDER BY n DESC LIMIT 200`
    ).all(norm) as { normalized: string; n: number }[];

    for (const t of top) {
      const score = matchScore(norm, t.normalized, maxDistance);
      if (score !== null && (!best || score < best.dist)) {
        best = { display: t.normalized, norm: t.normalized, dist: score, source: 'top_terms' };
      }
    }
  }

  if (!best) return { original: query, corrected: null, distance: 0, source: 'none' };
  return {
    original: query,
    corrected: best.display,
    distance: best.dist,
    source: best.source,
  };
}

// ---------- Suggestions (5.9) ----------

export interface Suggestion {
  text: string;
  source: 'cache' | 'analytics' | 'history' | 'prefix_fallback';
  usage_count: number;
}

export function getSearchSuggestions(
  prefix: string,
  opts: { userId?: string | null; limit?: number } = {}
): Suggestion[] {
  const norm = normalizeQuery(prefix);
  if (!norm) return [];
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 20);

  const seen = new Set<string>();
  const results: Suggestion[] = [];

  // 1. Cache prefix match (highest quality)
  const cache = db.prepare(
    `SELECT display, usage_count FROM search_suggestions_cache
     WHERE normalized LIKE ? ORDER BY usage_count DESC, last_seen_at DESC LIMIT ?`
  ).all(`${norm}%`, limit) as { display: string; usage_count: number }[];
  for (const c of cache) {
    const key = c.display.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ text: c.display, source: 'cache', usage_count: c.usage_count });
    }
  }

  // 2. Analytics prefix match (in case cache is stale)
  if (results.length < limit) {
    const remaining = limit - results.length;
    const an = db.prepare(
      `SELECT normalized, COUNT(*) as n FROM search_analytics
       WHERE normalized LIKE ? GROUP BY normalized
       ORDER BY n DESC LIMIT ?`
    ).all(`${norm}%`, remaining * 2) as { normalized: string; n: number }[];
    for (const a of an) {
      const key = a.normalized;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ text: a.normalized, source: 'analytics', usage_count: a.n });
        if (results.length >= limit) break;
      }
    }
  }

  // 3. User's own history (per-user prefix)
  if (results.length < limit && opts.userId) {
    const remaining = limit - results.length;
    const hist = db.prepare(
      `SELECT query FROM search_history
       WHERE user_id = ? AND LOWER(query) LIKE ?
       ORDER BY created_at DESC LIMIT ?`
    ).all(opts.userId, `${norm}%`, remaining) as { query: string }[];
    for (const h of hist) {
      const key = h.query.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ text: h.query, source: 'history', usage_count: 0 });
        if (results.length >= limit) break;
      }
    }
  }

  return results.slice(0, limit);
}

// ---------- History (5.10) ----------

export interface SearchHistoryRow {
  id: string;
  user_id: string;
  query: string;
  filters_json: string | null;
  result_count: number;
  created_at: string;
}

export function recordSearchHistory(input: {
  user_id: string;
  query: string;
  filters?: Record<string, any> | null;
  result_count?: number;
}): SearchHistoryRow {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const q = (input.query ?? '').trim();
  if (!q) throw new Error('Query required');
  db.prepare(`
    INSERT INTO search_history (id, user_id, query, filters_json, result_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id, input.user_id, q.slice(0, 300),
    input.filters ? JSON.stringify(input.filters) : null,
    input.result_count ?? 0, now
  );
  return db.prepare('SELECT * FROM search_history WHERE id = ?').get(id) as SearchHistoryRow;
}

export function listSearchHistory(userId: string, limit = 50): SearchHistoryRow[] {
  const db = getDb();
  const n = Math.min(Math.max(limit, 1), 200);
  return db.prepare(
    'SELECT * FROM search_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(userId, n) as SearchHistoryRow[];
}

export function deleteSearchHistoryEntry(id: string, userId: string): boolean {
  const r = getDb().prepare(
    'DELETE FROM search_history WHERE id = ? AND user_id = ?'
  ).run(id, userId);
  return r.changes > 0;
}

export function clearSearchHistory(userId: string): number {
  const r = getDb().prepare('DELETE FROM search_history WHERE user_id = ?').run(userId);
  return r.changes;
}

// Distinct queries only, latest first
export function listDistinctHistory(userId: string, limit = 10): string[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT query, MAX(created_at) as last_seen
    FROM search_history WHERE user_id = ?
    GROUP BY LOWER(query)
    ORDER BY last_seen DESC LIMIT ?
  `).all(userId, Math.min(Math.max(limit, 1), 50)) as { query: string }[];
  return rows.map((r) => r.query);
}

// ---------- Analytics (5.11) ----------

export interface RecordAnalyticsInput {
  user_id?: string | null;
  query: string;
  filters?: Record<string, any> | null;
  result_count?: number;
}

export function recordSearchQuery(input: RecordAnalyticsInput): void {
  const db = getDb();
  const now = new Date().toISOString();
  const q = (input.query ?? '').trim();
  if (!q) return;
  const normalized = normalizeQuery(q);

  db.prepare(`
    INSERT INTO search_analytics
      (id, user_id, query, normalized, filters_json, result_count, clicked_video_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
  `).run(
    randomUUID(), input.user_id ?? null, q.slice(0, 300), normalized,
    input.filters ? JSON.stringify(input.filters) : null,
    input.result_count ?? 0, now
  );

  // Upsert suggestions cache
  db.prepare(`
    INSERT INTO search_suggestions_cache (normalized, display, usage_count, last_seen_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(normalized) DO UPDATE SET
      usage_count = search_suggestions_cache.usage_count + 1,
      last_seen_at = excluded.last_seen_at
  `).run(normalized, q.slice(0, 200), now);
}

export function recordSearchClick(query: string, videoId: string): void {
  const db = getDb();
  const normalized = normalizeQuery(query);
  // Attach click to the most recent unclicked entry with same normalized query
  const row = db.prepare(`
    SELECT id FROM search_analytics
    WHERE normalized = ? AND clicked_video_id IS NULL
    ORDER BY created_at DESC LIMIT 1
  `).get(normalized) as { id: string } | undefined;
  if (row) {
    db.prepare('UPDATE search_analytics SET clicked_video_id = ? WHERE id = ?')
      .run(videoId, row.id);
  }
}

export interface SearchAnalyticsSummary {
  window_start: string;
  window_end: string;
  total_queries: number;
  unique_queries: number;
  unique_users: number;
  zero_result_queries: number;
  ctr: number;
  top_queries: { query: string; count: number }[];
  recent_queries: { query: string; created_at: string }[];
}

export function getSearchAnalyticsSummary(opts: {
  from?: string;
  to?: string;
  topLimit?: number;
} = {}): SearchAnalyticsSummary {
  const db = getDb();
  const to = opts.to ?? new Date().toISOString();
  const from = opts.from ?? new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const topLimit = Math.min(Math.max(opts.topLimit ?? 20, 1), 100);

  const totals = db.prepare(`
    SELECT
      COUNT(*) as total_queries,
      COUNT(DISTINCT normalized) as unique_queries,
      COUNT(DISTINCT user_id) as unique_users,
      SUM(CASE WHEN result_count = 0 THEN 1 ELSE 0 END) as zero_result,
      SUM(CASE WHEN clicked_video_id IS NOT NULL THEN 1 ELSE 0 END) as clicks
    FROM search_analytics
    WHERE created_at >= ? AND created_at <= ?
  `).get(from, to) as any;

  const top = db.prepare(`
    SELECT query, COUNT(*) as count FROM search_analytics
    WHERE created_at >= ? AND created_at <= ?
    GROUP BY normalized
    ORDER BY count DESC LIMIT ?
  `).all(from, to, topLimit) as { query: string; count: number }[];

  const recent = db.prepare(`
    SELECT query, created_at FROM search_analytics
    WHERE created_at >= ? AND created_at <= ?
    ORDER BY created_at DESC LIMIT 20
  `).all(from, to) as { query: string; created_at: string }[];

  const total = totals.total_queries || 0;
  const clicks = totals.clicks || 0;

  return {
    window_start: from,
    window_end: to,
    total_queries: total,
    unique_queries: totals.unique_queries ?? 0,
    unique_users: totals.unique_users ?? 0,
    zero_result_queries: totals.zero_result ?? 0,
    ctr: total > 0 ? Number((clicks / total).toFixed(4)) : 0,
    top_queries: top,
    recent_queries: recent,
  };
}
