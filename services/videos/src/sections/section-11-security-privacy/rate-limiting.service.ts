// melodyflix videos - Section 11.15 Rate Limiting
// Admin-configurable sliding-window rate limiter.
// In-memory store (Map) — single-instance safe; Redis adapter can be
// swapped in by replacing the `Store` implementation.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type RateScope = 'global' | 'auth' | 'api' | 'upload' | 'comment' | 'search' | 'admin';
export type RateAction = 'allow' | 'throttle' | 'deny';

export interface RateLimitRule {
  id: string;
  name: string;
  route_pattern: string;         // e.g. "/api/v1/auth/*" or "*"
  method: string | null;         // GET/POST/... or NULL for any
  scope: RateScope;
  window_seconds: number;
  max_requests: number;
  apply_to: string;              // 'ip' | 'user' | 'ip+user' | 'global'
  burst_multiplier: number;      // allow small burst multiplier on top
  is_active: number;
  priority: number;              // lower = evaluated first
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RateLimitEvent {
  id: string;
  rule_id: string | null;
  key: string;                  // composite key: ip / user / etc.
  route: string | null;
  method: string | null;
  decision: RateAction;
  count: number;
  max_requests: number;
  window_seconds: number;
  retry_after: number;
  created_at: string;
}

export interface RuleInput {
  name: string;
  route_pattern: string;
  method?: string | null;
  scope?: RateScope;
  window_seconds: number;
  max_requests: number;
  apply_to?: string;
  burst_multiplier?: number;
  is_active?: boolean;
  priority?: number;
  created_by?: string | null;
}

const VALID_SCOPES: RateScope[] = ['global', 'auth', 'api', 'upload', 'comment', 'search', 'admin'];
const VALID_APPLY = ['ip', 'user', 'ip+user', 'global'];

// ============================================================
// Schema
// ============================================================

export function ensureRateLimitSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS rate_limit_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      route_pattern TEXT NOT NULL,
      method TEXT,
      scope TEXT NOT NULL DEFAULT 'api',
      window_seconds INTEGER NOT NULL,
      max_requests INTEGER NOT NULL,
      apply_to TEXT NOT NULL DEFAULT 'ip',
      burst_multiplier REAL NOT NULL DEFAULT 1.0,
      is_active INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 100,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rl_active ON rate_limit_rules(is_active, priority);
    CREATE INDEX IF NOT EXISTS idx_rl_scope ON rate_limit_rules(scope);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rl_name ON rate_limit_rules(name);

    CREATE TABLE IF NOT EXISTS rate_limit_events (
      id TEXT PRIMARY KEY,
      rule_id TEXT,
      key TEXT NOT NULL,
      route TEXT,
      method TEXT,
      decision TEXT NOT NULL,
      count INTEGER NOT NULL,
      max_requests INTEGER NOT NULL,
      window_seconds INTEGER NOT NULL,
      retry_after INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rle_created ON rate_limit_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_rle_rule ON rate_limit_events(rule_id);
  `);
}

function rowToRule(r: any): RateLimitRule { return r as RateLimitRule; }

// ============================================================
// In-memory sliding window store
// ============================================================

type Bucket = number[];   // list of timestamps (ms)
const store = new Map<string, Bucket>();

// Periodic cleanup so memory doesn't grow forever
let lastSweep = 0;
const SWEEP_INTERVAL_MS = 60_000;
const MAX_BUCKET_AGE_MS = 3600_000; // 1h max window

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  const cutoff = now - MAX_BUCKET_AGE_MS;
  for (const [key, arr] of store.entries()) {
    while (arr.length > 0 && arr[0] < cutoff) arr.shift();
    if (arr.length === 0) store.delete(key);
  }
}

/** Sliding window: counts events within the last window and appends current. */
function tryConsume(key: string, windowSeconds: number, maxRequests: number, now: number): { count: number; allowed: boolean; retryAfter: number } {
  sweep(now);
  const windowMs = windowSeconds * 1000;
  const cutoff = now - windowMs;
  let arr = store.get(key);
  if (!arr) {
    arr = [];
    store.set(key, arr);
  }
  // Remove expired timestamps
  while (arr.length > 0 && arr[0] < cutoff) arr.shift();

  if (arr.length >= maxRequests) {
    const oldest = arr[0];
    const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { count: arr.length, allowed: false, retryAfter };
  }
  arr.push(now);
  return { count: arr.length, allowed: true, retryAfter: 0 };
}

/** For tests / dev: reset in-memory store. */
export function resetRateLimitStore(): void {
  store.clear();
}

export function _storeSize(): number {
  return store.size;
}

// ============================================================
// Rule CRUD
// ============================================================

export function createRule(input: RuleInput): RateLimitRule {
  const name = (input.name || '').trim();
  if (name.length < 1 || name.length > 120) throw new Error('name must be 1-120 chars');
  const pattern = (input.route_pattern || '').trim();
  if (pattern.length < 1 || pattern.length > 200) throw new Error('route_pattern must be 1-200 chars');

  if (input.method !== undefined && input.method !== null) {
    if (!/^[A-Z]{3,7}$/.test(input.method)) throw new Error('method must be uppercase (GET, POST, ...)');
  }
  const scope = input.scope ?? 'api';
  if (!VALID_SCOPES.includes(scope)) throw new Error(`Invalid scope: ${scope}`);

  if (!Number.isInteger(input.window_seconds) || input.window_seconds < 1 || input.window_seconds > 86400) {
    throw new Error('window_seconds must be 1-86400');
  }
  if (!Number.isInteger(input.max_requests) || input.max_requests < 1 || input.max_requests > 1_000_000) {
    throw new Error('max_requests must be 1-1,000,000');
  }

  const applyTo = input.apply_to ?? 'ip';
  if (!VALID_APPLY.includes(applyTo)) throw new Error(`Invalid apply_to: ${applyTo}`);

  const burst = input.burst_multiplier ?? 1.0;
  if (typeof burst !== 'number' || burst < 1 || burst > 10) {
    throw new Error('burst_multiplier must be 1.0-10.0');
  }

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO rate_limit_rules
      (id, name, route_pattern, method, scope, window_seconds, max_requests,
       apply_to, burst_multiplier, is_active, priority, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, name, pattern, input.method ?? null, scope,
    input.window_seconds, input.max_requests, applyTo, burst,
    input.is_active === false ? 0 : 1,
    input.priority ?? 100,
    input.created_by ?? null, now, now,
  );

  return getRule(id)!;
}

export function getRule(id: string): RateLimitRule | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM rate_limit_rules WHERE id = ?').get(id) as any;
  return r ? rowToRule(r) : null;
}

export interface ListRulesOpts {
  scope?: RateScope;
  active_only?: boolean;
  limit?: number;
  offset?: number;
}

export function listRules(opts: ListRulesOpts = {}): { rules: RateLimitRule[]; total: number } {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];
  if (opts.scope) { where.push('scope = ?'); params.push(opts.scope); }
  if (opts.active_only) where.push('is_active = 1');
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);

  const total = (db.prepare(`SELECT COUNT(*) as c FROM rate_limit_rules ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT * FROM rate_limit_rules ${w} ORDER BY priority ASC, created_at ASC LIMIT ${limit} OFFSET ${offset}`
  ).all(...params) as any[];
  return { rules: rows.map(rowToRule), total };
}

export function updateRule(id: string, patch: Partial<RuleInput>): RateLimitRule {
  const db = getDb();
  const existing = getRule(id);
  if (!existing) throw new Error('Rule not found');

  const fields: string[] = [];
  const params: any[] = [];

  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (n.length < 1 || n.length > 120) throw new Error('name must be 1-120 chars');
    fields.push('name = ?'); params.push(n);
  }
  if (patch.route_pattern !== undefined) {
    fields.push('route_pattern = ?'); params.push(patch.route_pattern.trim());
  }
  if (patch.method !== undefined) {
    if (patch.method !== null && !/^[A-Z]{3,7}$/.test(patch.method)) throw new Error('Invalid method');
    fields.push('method = ?'); params.push(patch.method);
  }
  if (patch.scope !== undefined) {
    if (!VALID_SCOPES.includes(patch.scope)) throw new Error('Invalid scope');
    fields.push('scope = ?'); params.push(patch.scope);
  }
  if (patch.window_seconds !== undefined) {
    if (!Number.isInteger(patch.window_seconds) || patch.window_seconds < 1) throw new Error('Invalid window_seconds');
    fields.push('window_seconds = ?'); params.push(patch.window_seconds);
  }
  if (patch.max_requests !== undefined) {
    if (!Number.isInteger(patch.max_requests) || patch.max_requests < 1) throw new Error('Invalid max_requests');
    fields.push('max_requests = ?'); params.push(patch.max_requests);
  }
  if (patch.apply_to !== undefined) {
    if (!VALID_APPLY.includes(patch.apply_to)) throw new Error('Invalid apply_to');
    fields.push('apply_to = ?'); params.push(patch.apply_to);
  }
  if (patch.burst_multiplier !== undefined) {
    fields.push('burst_multiplier = ?'); params.push(patch.burst_multiplier);
  }
  if (patch.is_active !== undefined) {
    fields.push('is_active = ?'); params.push(patch.is_active ? 1 : 0);
  }
  if (patch.priority !== undefined) {
    fields.push('priority = ?'); params.push(patch.priority);
  }

  if (fields.length === 0) return existing;
  fields.push('updated_at = ?'); params.push(new Date().toISOString());
  params.push(id);

  db.prepare(`UPDATE rate_limit_rules SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getRule(id)!;
}

export function deleteRule(id: string): boolean {
  const db = getDb();
  const info = db.prepare('DELETE FROM rate_limit_rules WHERE id = ?').run(id);
  return info.changes > 0;
}

// ============================================================
// Rule matching
// ============================================================

/** Glob-style matcher: "*" → anything, "/api/v1/*" → prefix, "exact" → exact. */
function patternMatches(pattern: string, route: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return route.startsWith(prefix);
  }
  return pattern === route;
}

export interface MatchRuleCtx {
  route: string;
  method: string;
  scope?: RateScope;
}

export function findMatchingRule(ctx: MatchRuleCtx): RateLimitRule | null {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM rate_limit_rules WHERE is_active = 1 ORDER BY priority ASC, created_at ASC'
  ).all() as RateLimitRule[];

  for (const r of rows) {
    if (!patternMatches(r.route_pattern, ctx.route)) continue;
    if (r.method && r.method !== ctx.method) continue;
    if (ctx.scope && r.scope !== ctx.scope && r.scope !== 'global') continue;
    return r;
  }
  return null;
}

// ============================================================
// Check
// ============================================================

export interface CheckInput {
  ip?: string | null;
  user_id?: string | null;
  route?: string | null;
  method?: string | null;
  scope?: RateScope;
  rule_id?: string;      // override: force a specific rule
  record?: boolean;
}

export interface CheckResult {
  allowed: boolean;
  decision: RateAction;
  rule_id: string | null;
  rule_name: string | null;
  key: string | null;
  count: number;
  max_requests: number;
  window_seconds: number;
  retry_after: number;
  reason: string;
}

function buildKey(rule: RateLimitRule, input: CheckInput): string {
  const parts: string[] = [rule.id];
  switch (rule.apply_to) {
    case 'global':
      parts.push('global');
      break;
    case 'user':
      parts.push(`u:${input.user_id ?? 'anon'}`);
      break;
    case 'ip+user':
      parts.push(`ip:${input.ip ?? '0.0.0.0'}`);
      parts.push(`u:${input.user_id ?? 'anon'}`);
      break;
    case 'ip':
    default:
      parts.push(`ip:${input.ip ?? '0.0.0.0'}`);
  }
  return parts.join('|');
}

export function checkRateLimit(input: CheckInput): CheckResult {
  const route = input.route ?? '';
  const method = (input.method ?? 'GET').toUpperCase();

  const rule = input.rule_id
    ? getRule(input.rule_id)
    : findMatchingRule({ route, method, scope: input.scope });

  if (!rule) {
    return {
      allowed: true,
      decision: 'allow',
      rule_id: null,
      rule_name: null,
      key: null,
      count: 0,
      max_requests: 0,
      window_seconds: 0,
      retry_after: 0,
      reason: 'No matching rule',
    };
  }

  const key = buildKey(rule, input);
  const effectiveMax = Math.floor(rule.max_requests * (rule.burst_multiplier || 1));
  const now = Date.now();
  const { count, allowed, retryAfter } = tryConsume(key, rule.window_seconds, effectiveMax, now);

  const decision: RateAction = allowed ? 'allow' : 'deny';

  if (input.record !== false) {
    const db = getDb();
    db.prepare(`
      INSERT INTO rate_limit_events
        (id, rule_id, key, route, method, decision, count, max_requests,
         window_seconds, retry_after, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), rule.id, key, route, method, decision,
      count, effectiveMax, rule.window_seconds, retryAfter,
      new Date().toISOString(),
    );
  }

  return {
    allowed,
    decision,
    rule_id: rule.id,
    rule_name: rule.name,
    key,
    count,
    max_requests: effectiveMax,
    window_seconds: rule.window_seconds,
    retry_after: retryAfter,
    reason: allowed
      ? `Within limit (${count}/${effectiveMax})`
      : `Rate limit exceeded (${count}/${effectiveMax})`,
  };
}

// ============================================================
// Stats
// ============================================================

export interface RateLimitStats {
  total_rules: number;
  active_rules: number;
  by_scope: Record<string, number>;
  events_24h: number;
  denied_24h: number;
  top_denied: Array<{ key: string; count: number }>;
}

export function getRateLimitStats(): RateLimitStats {
  const db = getDb();
  const since = new Date(Date.now() - 86400_000).toISOString();

  const total = (db.prepare('SELECT COUNT(*) as c FROM rate_limit_rules').get() as { c: number }).c;
  const active = (db.prepare('SELECT COUNT(*) as c FROM rate_limit_rules WHERE is_active = 1').get() as { c: number }).c;

  const byScope: Record<string, number> = {};
  for (const r of db.prepare(
    'SELECT scope, COUNT(*) as c FROM rate_limit_rules WHERE is_active = 1 GROUP BY scope'
  ).all() as Array<{ scope: string; c: number }>) byScope[r.scope] = r.c;

  const events24h = (db.prepare(
    'SELECT COUNT(*) as c FROM rate_limit_events WHERE created_at >= ?'
  ).get(since) as { c: number }).c;

  const denied24h = (db.prepare(
    "SELECT COUNT(*) as c FROM rate_limit_events WHERE decision = 'deny' AND created_at >= ?"
  ).get(since) as { c: number }).c;

  const topDenied = db.prepare(`
    SELECT key, COUNT(*) as count FROM rate_limit_events
    WHERE decision = 'deny' AND created_at >= ?
    GROUP BY key ORDER BY count DESC LIMIT 10
  `).all(since) as Array<{ key: string; count: number }>;

  return {
    total_rules: total,
    active_rules: active,
    by_scope: byScope,
    events_24h: events24h,
    denied_24h: denied24h,
    top_denied: topDenied,
  };
}

export function pruneOldEvents(olderThanDays = 30): { pruned: number } {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000).toISOString();
  const info = db.prepare('DELETE FROM rate_limit_events WHERE created_at < ?').run(cutoff);
  return { pruned: info.changes };
}
