// melodyflix videos - Section 11.6 Bot Detection
// User-agent signature matching + lightweight behavioral classification.
// Admins manage signatures; edge/middleware calls classify() to decide
// allow / challenge / deny. Events are logged for analytics.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type BotAction = 'allow' | 'challenge' | 'deny';
export type BotCategory = 'search_engine' | 'social_preview' | 'scraper' | 'headless' | 'cli_tool' | 'unknown' | 'custom';

export interface BotSignature {
  id: string;
  name: string;
  pattern: string;             // regex source
  category: BotCategory;
  action: BotAction;
  is_active: number;
  priority: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BotSignatureInput {
  name: string;
  pattern: string;
  category?: BotCategory;
  action: BotAction;
  is_active?: boolean;
  priority?: number;
  notes?: string | null;
  created_by?: string | null;
}

export interface BotEvent {
  id: string;
  user_agent: string;
  ip: string | null;
  path: string | null;
  method: string | null;
  signature_id: string | null;
  signature_name: string | null;
  action: BotAction;
  category: BotCategory;
  created_at: string;
}

export interface ClassifyResult {
  action: BotAction;
  is_bot: boolean;
  category: BotCategory;
  matched_signature_id: string | null;
  matched_signature_name: string | null;
  reason: string;
}

const VALID_ACTIONS: BotAction[] = ['allow', 'challenge', 'deny'];
const VALID_CATEGORIES: BotCategory[] = [
  'search_engine', 'social_preview', 'scraper', 'headless', 'cli_tool', 'unknown', 'custom',
];

// Seed signatures applied on first boot (only if table empty)
const DEFAULT_SIGNATURES: Array<{ name: string; pattern: string; category: BotCategory; action: BotAction; priority: number; notes: string }> = [
  // Allowed crawlers (SEO-critical)
  { name: 'Googlebot', pattern: 'Googlebot', category: 'search_engine', action: 'allow', priority: 10, notes: 'Google Search' },
  { name: 'Bingbot', pattern: 'bingbot', category: 'search_engine', action: 'allow', priority: 10, notes: 'Microsoft Bing' },
  { name: 'DuckDuckBot', pattern: 'DuckDuckBot', category: 'search_engine', action: 'allow', priority: 10, notes: 'DuckDuckGo' },
  { name: 'YandexBot', pattern: 'YandexBot', category: 'search_engine', action: 'allow', priority: 10, notes: 'Yandex' },
  { name: 'Applebot', pattern: 'Applebot', category: 'search_engine', action: 'allow', priority: 10, notes: 'Apple Search' },
  // Social preview (allowed)
  { name: 'Twitterbot', pattern: 'Twitterbot', category: 'social_preview', action: 'allow', priority: 20, notes: 'Twitter/X card preview' },
  { name: 'facebookexternalhit', pattern: 'facebookexternalhit', category: 'social_preview', action: 'allow', priority: 20, notes: 'Facebook link preview' },
  { name: 'WhatsApp', pattern: 'WhatsApp', category: 'social_preview', action: 'allow', priority: 20, notes: 'WhatsApp preview' },
  { name: 'TelegramBot', pattern: 'TelegramBot', category: 'social_preview', action: 'allow', priority: 20, notes: 'Telegram preview' },
  // Scrapers (denied)
  { name: 'AhrefsBot', pattern: 'AhrefsBot', category: 'scraper', action: 'deny', priority: 40, notes: 'SEO scraper' },
  { name: 'SemrushBot', pattern: 'SemrushBot', category: 'scraper', action: 'deny', priority: 40, notes: 'SEO scraper' },
  { name: 'MJ12bot', pattern: 'MJ12bot', category: 'scraper', action: 'deny', priority: 40, notes: 'Majestic scraper' },
  { name: 'DotBot', pattern: 'DotBot', category: 'scraper', action: 'deny', priority: 40, notes: 'Moz scraper' },
  { name: 'PetalBot', pattern: 'PetalBot', category: 'scraper', action: 'deny', priority: 40, notes: 'Huawei scraper' },
  // Headless / automation (challenged)
  { name: 'HeadlessChrome', pattern: 'HeadlessChrome', category: 'headless', action: 'challenge', priority: 50, notes: 'Headless browser' },
  { name: 'PhantomJS', pattern: 'PhantomJS', category: 'headless', action: 'challenge', priority: 50, notes: 'Headless browser' },
  { name: 'Selenium', pattern: 'Selenium', category: 'headless', action: 'challenge', priority: 50, notes: 'WebDriver automation' },
  { name: 'Puppeteer', pattern: 'Puppeteer', category: 'headless', action: 'challenge', priority: 50, notes: 'Automation' },
  { name: 'Playwright', pattern: 'Playwright', category: 'headless', action: 'challenge', priority: 50, notes: 'Automation' },
  // CLI tools (challenged)
  { name: 'curl', pattern: 'curl/', category: 'cli_tool', action: 'challenge', priority: 60, notes: 'curl' },
  { name: 'wget', pattern: 'Wget/', category: 'cli_tool', action: 'challenge', priority: 60, notes: 'wget' },
  { name: 'python-requests', pattern: 'python-requests', category: 'cli_tool', action: 'challenge', priority: 60, notes: 'Python requests' },
  { name: 'Go-http-client', pattern: 'Go-http-client', category: 'cli_tool', action: 'challenge', priority: 60, notes: 'Go net/http' },
  { name: 'PostmanRuntime', pattern: 'PostmanRuntime', category: 'cli_tool', action: 'challenge', priority: 60, notes: 'Postman' },
  { name: 'insomnia', pattern: 'insomnia', category: 'cli_tool', action: 'challenge', priority: 60, notes: 'Insomnia' },
];

export function ensureBotDetectionSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_signatures (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      pattern TEXT NOT NULL,
      category TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('allow','challenge','deny')),
      is_active INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 100,
      notes TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_botsig_active ON bot_signatures(is_active);
    CREATE INDEX IF NOT EXISTS idx_botsig_priority ON bot_signatures(priority);

    CREATE TABLE IF NOT EXISTS bot_events (
      id TEXT PRIMARY KEY,
      user_agent TEXT NOT NULL,
      ip TEXT,
      path TEXT,
      method TEXT,
      signature_id TEXT,
      signature_name TEXT,
      action TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_botevent_created ON bot_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_botevent_action ON bot_events(action);
  `);

  // Seed defaults only if table empty
  const count = (db.prepare('SELECT COUNT(*) as c FROM bot_signatures').get() as { c: number }).c;
  if (count === 0) {
    const now = new Date().toISOString();
    const ins = db.prepare(`
      INSERT INTO bot_signatures
        (id, name, pattern, category, action, is_active, priority, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, NULL, ?, ?)
    `);
    for (const s of DEFAULT_SIGNATURES) {
      ins.run(randomUUID(), s.name, s.pattern, s.category, s.action, s.priority, s.notes, now, now);
    }
  }
}

function rowToSignature(r: any): BotSignature {
  return r as BotSignature;
}

export function listSignatures(opts: { category?: BotCategory; action?: BotAction; active_only?: boolean } = {}): BotSignature[] {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];
  if (opts.category) { where.push('category = ?'); params.push(opts.category); }
  if (opts.action) { where.push('action = ?'); params.push(opts.action); }
  if (opts.active_only) { where.push('is_active = 1'); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.prepare(
    `SELECT * FROM bot_signatures ${w} ORDER BY priority ASC, name ASC`
  ).all(...params) as any[];
  return rows.map(rowToSignature);
}

export function getSignature(id: string): BotSignature | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM bot_signatures WHERE id = ?').get(id) as any;
  return r ? rowToSignature(r) : null;
}

function compilePattern(src: string): RegExp {
  try {
    // case-insensitive by default (UA strings vary in case)
    return new RegExp(src, 'i');
  } catch (e) {
    throw new Error(`Invalid regex pattern: ${(e as Error).message}`);
  }
}

export function createSignature(input: BotSignatureInput): BotSignature {
  const db = getDb();
  const name = String(input.name || '').trim();
  if (name.length < 1 || name.length > 120) throw new Error('name must be 1-120 chars');

  const pattern = String(input.pattern || '').trim();
  if (pattern.length < 1 || pattern.length > 500) throw new Error('pattern must be 1-500 chars');
  compilePattern(pattern); // validate

  const action = input.action;
  if (!VALID_ACTIONS.includes(action)) throw new Error('Invalid action');

  const category = input.category ?? 'custom';
  if (!VALID_CATEGORIES.includes(category)) throw new Error('Invalid category');

  const now = new Date().toISOString();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO bot_signatures
      (id, name, pattern, category, action, is_active, priority, notes, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, name, pattern, category, action,
    input.is_active === false ? 0 : 1,
    input.priority ?? 100,
    input.notes ?? null,
    input.created_by ?? null,
    now, now,
  );
  return getSignature(id)!;
}

export function updateSignature(id: string, patch: Partial<BotSignatureInput>): BotSignature {
  const db = getDb();
  const existing = getSignature(id);
  if (!existing) throw new Error('Signature not found');

  const fields: string[] = [];
  const params: any[] = [];

  if (patch.name !== undefined) {
    const n = String(patch.name).trim();
    if (n.length < 1 || n.length > 120) throw new Error('name must be 1-120 chars');
    fields.push('name = ?'); params.push(n);
  }
  if (patch.pattern !== undefined) {
    const p = String(patch.pattern).trim();
    if (p.length < 1 || p.length > 500) throw new Error('pattern must be 1-500 chars');
    compilePattern(p);
    fields.push('pattern = ?'); params.push(p);
  }
  if (patch.category !== undefined) {
    if (!VALID_CATEGORIES.includes(patch.category)) throw new Error('Invalid category');
    fields.push('category = ?'); params.push(patch.category);
  }
  if (patch.action !== undefined) {
    if (!VALID_ACTIONS.includes(patch.action)) throw new Error('Invalid action');
    fields.push('action = ?'); params.push(patch.action);
  }
  if (patch.is_active !== undefined) {
    fields.push('is_active = ?'); params.push(patch.is_active ? 1 : 0);
  }
  if (patch.priority !== undefined) {
    fields.push('priority = ?'); params.push(patch.priority);
  }
  if (patch.notes !== undefined) {
    fields.push('notes = ?'); params.push(patch.notes);
  }

  if (fields.length === 0) return existing;
  fields.push('updated_at = ?'); params.push(new Date().toISOString());
  params.push(id);

  db.prepare(`UPDATE bot_signatures SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getSignature(id)!;
}

export function deleteSignature(id: string): boolean {
  const db = getDb();
  const info = db.prepare('DELETE FROM bot_signatures WHERE id = ?').run(id);
  return info.changes > 0;
}

// ============================================================
// Classification
// ============================================================

export function classifyUserAgent(ua: string): ClassifyResult {
  if (!ua || typeof ua !== 'string') {
    return {
      action: 'challenge',
      is_bot: true,
      category: 'unknown',
      matched_signature_id: null,
      matched_signature_name: null,
      reason: 'Missing User-Agent',
    };
  }

  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM bot_signatures WHERE is_active = 1 ORDER BY priority ASC, name ASC`
  ).all() as BotSignature[];

  for (const sig of rows) {
    try {
      const re = new RegExp(sig.pattern, 'i');
      if (re.test(ua)) {
        return {
          action: sig.action,
          is_bot: true,
          category: sig.category,
          matched_signature_id: sig.id,
          matched_signature_name: sig.name,
          reason: `Matched signature "${sig.name}"`,
        };
      }
    } catch {
      // skip broken regex
    }
  }

  // Heuristic: empty or "unknown" UA → treat as bot
  return {
    action: 'allow',
    is_bot: false,
    category: 'unknown',
    matched_signature_id: null,
    matched_signature_name: null,
    reason: 'No matching signature - treated as human',
  };
}

export interface RecordEventInput {
  user_agent: string;
  ip?: string | null;
  path?: string | null;
  method?: string | null;
  result?: ClassifyResult;    // optionally pass in to avoid double classify
}

export function recordEvent(input: RecordEventInput): BotEvent {
  const db = getDb();
  const result = input.result ?? classifyUserAgent(input.user_agent);
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO bot_events
      (id, user_agent, ip, path, method, signature_id, signature_name, action, category, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.user_agent.slice(0, 1000),
    input.ip ?? null,
    input.path ?? null,
    input.method ?? null,
    result.matched_signature_id,
    result.matched_signature_name,
    result.action,
    result.category,
    now,
  );
  return getEvent(id)!;
}

export function getEvent(id: string): BotEvent | null {
  const db = getDb();
  return db.prepare('SELECT * FROM bot_events WHERE id = ?').get(id) as BotEvent | null;
}

export function listEvents(opts: { action?: BotAction; category?: BotCategory; limit?: number } = {}): BotEvent[] {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];
  if (opts.action) { where.push('action = ?'); params.push(opts.action); }
  if (opts.category) { where.push('category = ?'); params.push(opts.category); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  return db.prepare(
    `SELECT * FROM bot_events ${w} ORDER BY created_at DESC LIMIT ${limit}`
  ).all(...params) as BotEvent[];
}

export interface BotStats {
  total_events: number;
  by_action: Record<string, number>;
  by_category: Record<string, number>;
  top_signatures: Array<{ signature_name: string; count: number }>;
  window_hours: number;
}

export function getStats(windowHours = 24): BotStats {
  const db = getDb();
  const since = new Date(Date.now() - windowHours * 3600_000).toISOString();

  const total = (db.prepare(
    'SELECT COUNT(*) as c FROM bot_events WHERE created_at >= ?'
  ).get(since) as { c: number }).c;

  const byAction: Record<string, number> = {};
  for (const r of db.prepare(
    'SELECT action, COUNT(*) as c FROM bot_events WHERE created_at >= ? GROUP BY action'
  ).all(since) as Array<{ action: string; c: number }>) {
    byAction[r.action] = r.c;
  }

  const byCategory: Record<string, number> = {};
  for (const r of db.prepare(
    'SELECT category, COUNT(*) as c FROM bot_events WHERE created_at >= ? GROUP BY category'
  ).all(since) as Array<{ category: string; c: number }>) {
    byCategory[r.category] = r.c;
  }

  const topSignatures = db.prepare(`
    SELECT signature_name, COUNT(*) as count
    FROM bot_events
    WHERE created_at >= ? AND signature_name IS NOT NULL
    GROUP BY signature_name
    ORDER BY count DESC
    LIMIT 10
  `).all(since) as Array<{ signature_name: string; count: number }>;

  return {
    total_events: total,
    by_action: byAction,
    by_category: byCategory,
    top_signatures: topSignatures,
    window_hours: windowHours,
  };
}

export function pruneOldEvents(olderThanDays = 30): { pruned: number } {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000).toISOString();
  const info = db.prepare('DELETE FROM bot_events WHERE created_at < ?').run(cutoff);
  return { pruned: info.changes };
}
