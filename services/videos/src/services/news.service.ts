// melodyflix videos — News Management (Section 72)
// 72.1 Breaking News Alerts  72.2 News Ticker
// 72.3 Reporter Portal       72.4 Fact-Checking Workflow
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type NewsPriority = 'low' | 'normal' | 'high' | 'breaking';
export type NewsStatus = 'draft' | 'pending_review' | 'approved' | 'published' | 'archived' | 'rejected';
export type FactCheckStatus = 'unchecked' | 'pending' | 'verified' | 'disputed' | 'unverifiable';
export type FactCheckVerdict = 'verified' | 'disputed' | 'unverifiable' | 'needs_more_sources';

export interface NewsSource {
  name: string;
  url: string | null;
  date: string | null;
}

export interface NewsItem {
  id: string;
  title: string;
  slug: string;
  summary: string;
  body: string;
  category: string;
  reporter_id: string | null;
  editor_id: string | null;
  status: NewsStatus;
  priority: NewsPriority;
  is_breaking: number;
  breaking_expires_at: string | null;
  is_ticker: number;
  ticker_order: number;
  fact_check_status: FactCheckStatus;
  sources_json: string | null;
  hero_image_url: string | null;
  tags: string | null;
  language: string;
  view_count: number;
  published_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FactCheckLog {
  id: string;
  news_id: string;
  checker_id: string;
  verdict: FactCheckVerdict;
  notes: string | null;
  checked_at: string;
}

const SLUG_RE = /^[a-z0-9-]+$/;
const BREAKING_TTL_MINUTES = 120;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120);
}

export function ensureNewsSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS news_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
      summary TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'general',
      reporter_id TEXT,
      editor_id TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      priority TEXT NOT NULL DEFAULT 'normal',
      is_breaking INTEGER NOT NULL DEFAULT 0,
      breaking_expires_at TEXT,
      is_ticker INTEGER NOT NULL DEFAULT 0,
      ticker_order INTEGER NOT NULL DEFAULT 0,
      fact_check_status TEXT NOT NULL DEFAULT 'unchecked',
      sources_json TEXT,
      hero_image_url TEXT,
      tags TEXT,
      language TEXT NOT NULL DEFAULT 'en',
      view_count INTEGER NOT NULL DEFAULT 0,
      published_at TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_news_status ON news_items(status, published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_news_breaking ON news_items(is_breaking, breaking_expires_at);
    CREATE INDEX IF NOT EXISTS idx_news_ticker ON news_items(is_ticker, ticker_order);
    CREATE INDEX IF NOT EXISTS idx_news_reporter ON news_items(reporter_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_news_category ON news_items(category, published_at DESC);

    CREATE TABLE IF NOT EXISTS news_fact_check_log (
      id TEXT PRIMARY KEY,
      news_id TEXT NOT NULL,
      checker_id TEXT NOT NULL,
      verdict TEXT NOT NULL,
      notes TEXT,
      checked_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_factcheck_news ON news_fact_check_log(news_id, checked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_factcheck_checker ON news_fact_check_log(checker_id, checked_at DESC);
  `);
}

// ============================================================
// 72.3 — Reporter Portal (create + submit)
// ============================================================

export function createNewsItem(input: {
  title: string;
  summary?: string;
  body?: string;
  category?: string;
  reporter_id: string;
  priority?: NewsPriority;
  sources?: NewsSource[];
  hero_image_url?: string | null;
  tags?: string[];
  language?: string;
  submit_for_review?: boolean;
}): NewsItem {
  const title = (input.title ?? '').trim();
  if (title.length < 5 || title.length > 250) throw new Error('title must be 5-250 chars');
  const summary = (input.summary ?? '').trim();
  if (summary.length > 500) throw new Error('summary too long (max 500)');
  const body = (input.body ?? '').trim();
  if (body.length > 50_000) throw new Error('body too long (max 50K)');

  const db = getDb();
  const id = randomUUID();
  const baseSlug = slugify(title) || 'news';
  let slug = baseSlug;
  let attempts = 0;
  while (db.prepare('SELECT 1 FROM news_items WHERE slug = ?').get(slug)) {
    attempts += 1;
    slug = `${baseSlug}-${attempts}`;
    if (attempts > 100) throw new Error('Cannot generate unique slug');
  }

  const now = new Date().toISOString();
  const status: NewsStatus = input.submit_for_review ? 'pending_review' : 'draft';

  db.prepare(`
    INSERT INTO news_items
      (id, title, slug, summary, body, category, reporter_id, editor_id, status, priority,
       is_breaking, breaking_expires_at, is_ticker, ticker_order, fact_check_status,
       sources_json, hero_image_url, tags, language, view_count, published_at, archived_at,
       created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, NULL, 0, 0, 'unchecked', ?, ?, ?, ?, 0, NULL, NULL, ?, ?)
  `).run(
    id, title, slug, summary, body, input.category ?? 'general',
    input.reporter_id, status, input.priority ?? 'normal',
    input.sources ? JSON.stringify(input.sources) : null,
    input.hero_image_url ?? null,
    input.tags ? JSON.stringify(input.tags.slice(0, 20)) : null,
    input.language ?? 'en',
    now, now,
  );
  return getNewsItem(id)!;
}

export function getNewsItem(id: string): NewsItem | null {
  return (getDb().prepare('SELECT * FROM news_items WHERE id = ?').get(id) as NewsItem | undefined) ?? null;
}

export function getNewsItemBySlug(slug: string): NewsItem | null {
  return (getDb().prepare('SELECT * FROM news_items WHERE slug = ?').get(slug) as NewsItem | undefined) ?? null;
}

export function updateNewsItem(id: string, reporterId: string, patch: {
  title?: string;
  summary?: string;
  body?: string;
  category?: string;
  priority?: NewsPriority;
  sources?: NewsSource[];
  hero_image_url?: string | null;
  tags?: string[];
  submit_for_review?: boolean;
}): NewsItem {
  const existing = getNewsItem(id);
  if (!existing) throw new Error('News item not found');
  if (existing.reporter_id !== reporterId) throw new Error('Not your article');
  if (['published', 'archived'].includes(existing.status)) {
    throw new Error(`Cannot edit ${existing.status} article`);
  }

  const fields: string[] = [];
  const params: any[] = [];
  if (patch.title !== undefined) {
    const t = patch.title.trim();
    if (t.length < 5 || t.length > 250) throw new Error('title must be 5-250 chars');
    fields.push('title = ?'); params.push(t);
  }
  if (patch.summary !== undefined) { fields.push('summary = ?'); params.push(patch.summary.trim()); }
  if (patch.body !== undefined) { fields.push('body = ?'); params.push(patch.body.trim()); }
  if (patch.category !== undefined) { fields.push('category = ?'); params.push(patch.category); }
  if (patch.priority !== undefined) { fields.push('priority = ?'); params.push(patch.priority); }
  if (patch.sources !== undefined) {
    fields.push('sources_json = ?'); params.push(JSON.stringify(patch.sources));
  }
  if (patch.hero_image_url !== undefined) { fields.push('hero_image_url = ?'); params.push(patch.hero_image_url); }
  if (patch.tags !== undefined) {
    fields.push('tags = ?'); params.push(JSON.stringify(patch.tags.slice(0, 20)));
  }
  if (patch.submit_for_review && existing.status === 'draft') {
    fields.push('status = ?'); params.push('pending_review');
  }
  if (fields.length === 0) return existing;
  fields.push('updated_at = ?'); params.push(new Date().toISOString());
  params.push(id);
  getDb().prepare(`UPDATE news_items SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getNewsItem(id)!;
}

// ============================================================
// Editorial workflow
// ============================================================

export function approveNewsItem(id: string, editorId: string): NewsItem {
  const existing = getNewsItem(id);
  if (!existing) throw new Error('News item not found');
  if (!['pending_review', 'draft'].includes(existing.status)) {
    throw new Error(`Cannot approve from status ${existing.status}`);
  }
  if (existing.fact_check_status === 'disputed') {
    throw new Error('Cannot approve a disputed article');
  }
  const now = new Date().toISOString();
  getDb().prepare(
    "UPDATE news_items SET status = 'approved', editor_id = ?, updated_at = ? WHERE id = ?"
  ).run(editorId, now, id);
  return getNewsItem(id)!;
}

export function rejectNewsItem(id: string, editorId: string, _reason: string): NewsItem {
  const existing = getNewsItem(id);
  if (!existing) throw new Error('News item not found');
  const now = new Date().toISOString();
  getDb().prepare(
    "UPDATE news_items SET status = 'rejected', editor_id = ?, updated_at = ? WHERE id = ?"
  ).run(editorId, now, id);
  return getNewsItem(id)!;
}

export function publishNewsItem(id: string, editorId: string, opts: {
  breaking?: boolean;
  breaking_ttl_minutes?: number;
  ticker?: boolean;
  ticker_order?: number;
} = {}): NewsItem {
  const existing = getNewsItem(id);
  if (!existing) throw new Error('News item not found');
  if (existing.status !== 'approved' && existing.status !== 'pending_review') {
    throw new Error(`Cannot publish from status ${existing.status}`);
  }

  const db = getDb();
  const now = new Date().toISOString();
  const isBreaking = opts.breaking === true ? 1 : existing.is_breaking;
  const ttl = opts.breaking_ttl_minutes ?? BREAKING_TTL_MINUTES;
  const breakingExpires = isBreaking === 1
    ? new Date(Date.now() + ttl * 60_000).toISOString()
    : existing.breaking_expires_at;
  const isTicker = opts.ticker !== undefined ? (opts.ticker ? 1 : 0) : existing.is_ticker;
  const tickerOrder = opts.ticker_order !== undefined ? opts.ticker_order : existing.ticker_order;

  db.prepare(`
    UPDATE news_items SET status = 'published', editor_id = ?, published_at = ?,
      is_breaking = ?, breaking_expires_at = ?, is_ticker = ?, ticker_order = ?,
      updated_at = ? WHERE id = ?
  `).run(editorId, now, isBreaking, breakingExpires, isTicker, tickerOrder, now, id);

  return getNewsItem(id)!;
}

export function archiveNewsItem(id: string, editorId: string): NewsItem {
  const existing = getNewsItem(id);
  if (!existing) throw new Error('News item not found');
  const now = new Date().toISOString();
  getDb().prepare(
    "UPDATE news_items SET status = 'archived', archived_at = ?, is_breaking = 0, is_ticker = 0, updated_at = ? WHERE id = ?"
  ).run(now, now, id);
  return getNewsItem(id)!;
}

// ============================================================
// 72.4 — Fact-checking
// ============================================================

export function submitForFactCheck(id: string, reporterId: string): NewsItem {
  const existing = getNewsItem(id);
  if (!existing) throw new Error('News item not found');
  if (existing.reporter_id !== reporterId) throw new Error('Not your article');
  const now = new Date().toISOString();
  getDb().prepare(
    "UPDATE news_items SET fact_check_status = 'pending', updated_at = ? WHERE id = ?"
  ).run(now, id);
  return getNewsItem(id)!;
}

export function logFactCheck(input: {
  news_id: string;
  checker_id: string;
  verdict: FactCheckVerdict;
  notes?: string | null;
}): FactCheckLog {
  const news = getNewsItem(input.news_id);
  if (!news) throw new Error('News item not found');

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  const newStatus: FactCheckStatus =
    input.verdict === 'verified' ? 'verified' :
    input.verdict === 'disputed' ? 'disputed' :
    input.verdict === 'unverifiable' ? 'unverifiable' : 'pending';

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO news_fact_check_log (id, news_id, checker_id, verdict, notes, checked_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, input.news_id, input.checker_id, input.verdict, input.notes ?? null, now);
    db.prepare('UPDATE news_items SET fact_check_status = ?, updated_at = ? WHERE id = ?')
      .run(newStatus, now, input.news_id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  return db.prepare('SELECT * FROM news_fact_check_log WHERE id = ?').get(id) as FactCheckLog;
}

export function listFactCheckLog(newsId: string): FactCheckLog[] {
  return getDb().prepare(
    'SELECT * FROM news_fact_check_log WHERE news_id = ? ORDER BY checked_at DESC'
  ).all(newsId) as FactCheckLog[];
}

// ============================================================
// 72.2 — News Ticker
// ============================================================

export function getTickerItems(limit = 20): Array<Pick<NewsItem, 'id' | 'title' | 'slug' | 'priority' | 'published_at'>> {
  return getDb().prepare(`
    SELECT id, title, slug, priority, published_at FROM news_items
    WHERE status = 'published' AND is_ticker = 1
    ORDER BY ticker_order ASC, published_at DESC
    LIMIT ?
  `).all(Math.min(Math.max(limit, 1), 100)) as any[];
}

export function setTickerVisibility(id: string, editorId: string, visible: boolean, order = 0): NewsItem {
  const existing = getNewsItem(id);
  if (!existing) throw new Error('News item not found');
  const now = new Date().toISOString();
  getDb().prepare(
    'UPDATE news_items SET is_ticker = ?, ticker_order = ?, editor_id = ?, updated_at = ? WHERE id = ?'
  ).run(visible ? 1 : 0, order, editorId, now, id);
  return getNewsItem(id)!;
}

// ============================================================
// 72.1 — Breaking news
// ============================================================

export interface BreakingNewsItem extends NewsItem {
  minutes_left: number;
}

export function getActiveBreaking(limit = 10): BreakingNewsItem[] {
  const db = getDb();
  const now = new Date().toISOString();
  const rows = db.prepare(`
    SELECT * FROM news_items
    WHERE status = 'published' AND is_breaking = 1
      AND breaking_expires_at IS NOT NULL AND breaking_expires_at > ?
    ORDER BY priority DESC, published_at DESC
    LIMIT ?
  `).all(now, Math.min(Math.max(limit, 1), 50)) as NewsItem[];

  const nowMs = Date.now();
  return rows.map((r) => ({
    ...r,
    minutes_left: Math.max(0, Math.round((new Date(r.breaking_expires_at!).getTime() - nowMs) / 60_000)),
  }));
}

export function expireBreakingNews(): number {
  const now = new Date().toISOString();
  const info = getDb().prepare(`
    UPDATE news_items SET is_breaking = 0, updated_at = ?
    WHERE is_breaking = 1 AND breaking_expires_at IS NOT NULL AND breaking_expires_at <= ?
  `).run(now, now);
  return Number(info.changes ?? 0);
}

export function promoteToBreaking(id: string, editorId: string, ttlMinutes = BREAKING_TTL_MINUTES): NewsItem {
  const existing = getNewsItem(id);
  if (!existing) throw new Error('News item not found');
  if (existing.status !== 'published') throw new Error('Only published articles can be promoted to breaking');
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  getDb().prepare(`
    UPDATE news_items SET is_breaking = 1, breaking_expires_at = ?,
      priority = 'breaking', editor_id = ?, updated_at = ? WHERE id = ?
  `).run(expires, editorId, now, id);
  return getNewsItem(id)!;
}

// ============================================================
// Public listing
// ============================================================

export function listPublishedNews(opts: {
  category?: string;
  language?: string;
  limit?: number;
  offset?: number;
} = {}): NewsItem[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const filters: string[] = ["status = 'published'"];
  const params: any[] = [];
  if (opts.category) { filters.push('category = ?'); params.push(opts.category); }
  if (opts.language) { filters.push('language = ?'); params.push(opts.language); }
  params.push(limit, offset);
  return db.prepare(
    `SELECT * FROM news_items WHERE ${filters.join(' AND ')} ORDER BY published_at DESC LIMIT ? OFFSET ?`
  ).all(...params) as NewsItem[];
}

export function listReporterArticles(reporterId: string, opts: { status?: NewsStatus; limit?: number } = {}): NewsItem[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const filters: string[] = ['reporter_id = ?'];
  const params: any[] = [reporterId];
  if (opts.status) { filters.push('status = ?'); params.push(opts.status); }
  params.push(limit);
  return db.prepare(
    `SELECT * FROM news_items WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT ?`
  ).all(...params) as NewsItem[];
}

export function listPendingReview(limit = 50): NewsItem[] {
  return getDb().prepare(
    "SELECT * FROM news_items WHERE status = 'pending_review' ORDER BY priority DESC, created_at ASC LIMIT ?"
  ).all(Math.min(Math.max(limit, 1), 200)) as NewsItem[];
}

export function listPendingFactCheck(limit = 50): NewsItem[] {
  return getDb().prepare(
    "SELECT * FROM news_items WHERE fact_check_status = 'pending' ORDER BY created_at ASC LIMIT ?"
  ).all(Math.min(Math.max(limit, 1), 200)) as NewsItem[];
}

export function incrementNewsView(id: string): void {
  getDb().prepare('UPDATE news_items SET view_count = view_count + 1 WHERE id = ?').run(id);
}

export function deleteNewsItem(id: string, requesterId: string, isAdmin: boolean): boolean {
  const existing = getNewsItem(id);
  if (!existing) return false;
  if (!isAdmin && existing.reporter_id !== requesterId) throw new Error('Not authorized');
  // Reporters can only delete drafts / pending / rejected — not approved, published or archived
  const NON_DELETABLE: NewsStatus[] = ['approved', 'published', 'archived'];
  if (!isAdmin && NON_DELETABLE.includes(existing.status)) {
    throw new Error(`Cannot delete ${existing.status} article (admin only)`);
  }
  const info = getDb().prepare('DELETE FROM news_items WHERE id = ?').run(id);
  return Number(info.changes ?? 0) > 0;
}
