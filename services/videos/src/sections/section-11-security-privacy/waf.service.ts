// melodyflix videos - Section 11.18 Web Application Firewall
// App-layer WAF: admin-configurable pattern rules matching against
// request path/query/body/header. Complements Nginx ModSecurity.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type WafTarget = 'path' | 'query' | 'body' | 'header' | 'user_agent' | 'referer';
export type WafAction = 'log' | 'block' | 'challenge' | 'redirect';
export type WafSeverity = 'low' | 'medium' | 'high' | 'critical';
export type WafCategory =
  | 'sqli'
  | 'xss'
  | 'lfi'
  | 'rfi'
  | 'rce'
  | 'scanner'
  | 'bot'
  | 'protocol'
  | 'custom';

export interface WafRule {
  id: string;
  name: string;
  category: WafCategory;
  target: WafTarget;
  pattern: string;               // regex source
  action: WafAction;
  severity: WafSeverity;
  redirect_url: string | null;
  is_active: number;
  priority: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WafMatch {
  id: string;
  rule_id: string;
  rule_name: string;
  category: WafCategory;
  target: WafTarget;
  matched_value: string;          // truncated to 500 chars
  path: string | null;
  method: string | null;
  ip_address: string | null;
  user_id: string | null;
  user_agent: string | null;
  action: WafAction;
  severity: WafSeverity;
  created_at: string;
}

const VALID_TARGETS: WafTarget[] = ['path', 'query', 'body', 'header', 'user_agent', 'referer'];
const VALID_ACTIONS: WafAction[] = ['log', 'block', 'challenge', 'redirect'];
const VALID_SEVERITIES: WafSeverity[] = ['low', 'medium', 'high', 'critical'];
const VALID_CATEGORIES: WafCategory[] = ['sqli', 'xss', 'lfi', 'rfi', 'rce', 'scanner', 'bot', 'protocol', 'custom'];

// Default seed rules — common attack patterns
interface SeedRule {
  name: string;
  category: WafCategory;
  target: WafTarget;
  pattern: string;
  action: WafAction;
  severity: WafSeverity;
  priority: number;
  notes: string;
}

const DEFAULT_RULES: SeedRule[] = [
  // SQL Injection
  { name: 'SQLi UNION SELECT', category: 'sqli', target: 'query', pattern: '(?i)(union\\s+.*?select|select\\s+.*?from)', action: 'block', severity: 'critical', priority: 10, notes: 'Detect SQL UNION SELECT' },
  { name: 'SQLi boolean', category: 'sqli', target: 'query', pattern: "(?i)(\\bor\\b\\s+['\"]?1['\"]?\\s*=\\s*['\"]?1|\\band\\b\\s+['\"]?1['\"]?\\s*=\\s*['\"]?1)", action: 'block', severity: 'critical', priority: 10, notes: '1=1 / AND 1=1' },
  { name: 'SQLi comment', category: 'sqli', target: 'query', pattern: '(--|#|/\\*.*?\\*/)\\s*$', action: 'block', severity: 'high', priority: 15, notes: 'SQL comment injection' },
  { name: 'SQLi sleep/waitfor', category: 'sqli', target: 'query', pattern: '(?i)\\b(sleep\\(|waitfor\\s+delay|benchmark\\()', action: 'block', severity: 'critical', priority: 10, notes: 'Time-based SQLi' },
  { name: 'SQLi stacked', category: 'sqli', target: 'query', pattern: ';\\s*(drop|delete|update|insert|truncate)\\s+', action: 'block', severity: 'critical', priority: 5, notes: 'Stacked queries' },

  // XSS
  { name: 'XSS script tag', category: 'xss', target: 'query', pattern: '(?i)<\\s*script[^>]*>', action: 'block', severity: 'high', priority: 20, notes: '<script>' },
  { name: 'XSS event handler', category: 'xss', target: 'query', pattern: '(?i)\\bon(error|load|click|mouseover|focus)\\s*=', action: 'block', severity: 'high', priority: 25, notes: 'on* handlers' },
  { name: 'XSS javascript: URI', category: 'xss', target: 'query', pattern: '(?i)javascript\\s*:', action: 'block', severity: 'high', priority: 25, notes: 'javascript: URIs' },
  { name: 'XSS img onerror', category: 'xss', target: 'query', pattern: '(?i)<\\s*img[^>]+onerror', action: 'block', severity: 'high', priority: 20, notes: 'img onerror' },

  // Path traversal / LFI
  { name: 'Path traversal', category: 'lfi', target: 'path', pattern: '(\\.\\./|\\.\\.\\\\|%2e%2e|%252e%252e)', action: 'block', severity: 'critical', priority: 10, notes: '../' },
  { name: 'LFI /etc/passwd', category: 'lfi', target: 'query', pattern: '(?i)/etc/(passwd|shadow|hosts|group)', action: 'block', severity: 'critical', priority: 5, notes: 'Unix file read' },
  { name: 'LFI proc', category: 'lfi', target: 'query', pattern: '(?i)/proc/(self|version|cmdline|environ)', action: 'block', severity: 'critical', priority: 5, notes: '/proc access' },

  // RCE
  { name: 'RCE eval', category: 'rce', target: 'query', pattern: '(?i)\\b(eval|system|exec|shell_exec|passthru|popen)\\(', action: 'block', severity: 'critical', priority: 5, notes: 'PHP exec functions' },
  { name: 'RCE base64 decode', category: 'rce', target: 'query', pattern: '(?i)\\b(base64_decode|gzinflate|str_rot13)\\s*\\(', action: 'block', severity: 'critical', priority: 5, notes: 'Obfuscation funcs' },

  // Scanner detection
  { name: 'Scanner UA - sqlmap', category: 'scanner', target: 'user_agent', pattern: '(?i)sqlmap', action: 'block', severity: 'high', priority: 15, notes: 'sqlmap scanner' },
  { name: 'Scanner UA - nikto', category: 'scanner', target: 'user_agent', pattern: '(?i)nikto', action: 'block', severity: 'high', priority: 15, notes: 'nikto scanner' },
  { name: 'Scanner UA - nmap', category: 'scanner', target: 'user_agent', pattern: '(?i)(nmap|masscan|zgrab)', action: 'block', severity: 'high', priority: 15, notes: 'nmap/masscan' },
  { name: 'Scanner UA - acunetix', category: 'scanner', target: 'user_agent', pattern: '(?i)(acunetix|nessus|appscan)', action: 'block', severity: 'high', priority: 15, notes: 'Commercial scanners' },
  { name: 'Scanner UA - wpscan', category: 'scanner', target: 'user_agent', pattern: '(?i)wpscan', action: 'block', severity: 'medium', priority: 20, notes: 'WPScan' },

  // Protocol anomalies
  { name: 'Null byte injection', category: 'protocol', target: 'path', pattern: '%00|\\x00', action: 'block', severity: 'high', priority: 10, notes: 'Null byte' },
  { name: 'HTTP header injection', category: 'protocol', target: 'header', pattern: '(%0d%0a|%0a%0d|\\r\\n\\r\\n)', action: 'block', severity: 'high', priority: 10, notes: 'CRLF injection' },
];

export function ensureWafSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS waf_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      target TEXT NOT NULL CHECK (target IN ('path','query','body','header','user_agent','referer')),
      pattern TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('log','block','challenge','redirect')),
      severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
      redirect_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 100,
      notes TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_waf_active ON waf_rules(is_active, priority);
    CREATE INDEX IF NOT EXISTS idx_waf_category ON waf_rules(category);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_waf_name ON waf_rules(name);

    CREATE TABLE IF NOT EXISTS waf_matches (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL,
      rule_name TEXT NOT NULL,
      category TEXT NOT NULL,
      target TEXT NOT NULL,
      matched_value TEXT NOT NULL,
      path TEXT,
      method TEXT,
      ip_address TEXT,
      user_id TEXT,
      user_agent TEXT,
      action TEXT NOT NULL,
      severity TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wafmatch_created ON waf_matches(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wafmatch_rule ON waf_matches(rule_id);
    CREATE INDEX IF NOT EXISTS idx_wafmatch_ip ON waf_matches(ip_address);
  `);

  // Seed defaults only if table empty
  const count = (db.prepare('SELECT COUNT(*) as c FROM waf_rules').get() as { c: number }).c;
  if (count === 0) {
    const now = new Date().toISOString();
    const ins = db.prepare(`
      INSERT INTO waf_rules
        (id, name, category, target, pattern, action, severity,
         redirect_url, is_active, priority, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?, NULL, ?, ?)
    `);
    for (const s of DEFAULT_RULES) {
      ins.run(randomUUID(), s.name, s.category, s.target, s.pattern, s.action, s.severity, s.priority, s.notes, now, now);
    }
  }
}

function rowToRule(r: any): WafRule { return r as WafRule; }
function rowToMatch(r: any): WafMatch { return r as WafMatch; }

/** Compile a pattern with PCRE-style (?i) prefix support. */
function compileRegex(src: string): RegExp {
  try {
    if (src.startsWith('(?i)')) {
      return new RegExp(src.slice(4), 'i');
    }
    return new RegExp(src);
  } catch (e) {
    throw new Error(`Invalid regex: ${(e as Error).message}`);
  }
}

// ============================================================
// Rule CRUD
// ============================================================

export interface RuleInput {
  name: string;
  category: WafCategory;
  target: WafTarget;
  pattern: string;
  action: WafAction;
  severity: WafSeverity;
  redirect_url?: string | null;
  is_active?: boolean;
  priority?: number;
  notes?: string | null;
  created_by?: string | null;
}

export function createRule(input: RuleInput): WafRule {
  const name = (input.name || '').trim();
  if (name.length < 1 || name.length > 120) throw new Error('name must be 1-120 chars');

  if (!VALID_CATEGORIES.includes(input.category)) throw new Error(`Invalid category: ${input.category}`);
  if (!VALID_TARGETS.includes(input.target)) throw new Error(`Invalid target: ${input.target}`);
  if (!VALID_ACTIONS.includes(input.action)) throw new Error(`Invalid action: ${input.action}`);
  if (!VALID_SEVERITIES.includes(input.severity)) throw new Error(`Invalid severity: ${input.severity}`);

  const pattern = String(input.pattern || '').trim();
  if (pattern.length < 1 || pattern.length > 1000) throw new Error('pattern must be 1-1000 chars');
  compileRegex(pattern);

  if (input.action === 'redirect') {
    if (!input.redirect_url) throw new Error('redirect_url required when action=redirect');
    try { new URL(input.redirect_url); } catch { throw new Error('redirect_url must be a valid URL'); }
  }

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO waf_rules
      (id, name, category, target, pattern, action, severity, redirect_url,
       is_active, priority, notes, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, name, input.category, input.target, pattern,
    input.action, input.severity, input.redirect_url ?? null,
    input.is_active === false ? 0 : 1,
    input.priority ?? 100,
    input.notes ?? null,
    input.created_by ?? null,
    now, now,
  );

  return getRule(id)!;
}

export function getRule(id: string): WafRule | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM waf_rules WHERE id = ?').get(id) as any;
  return r ? rowToRule(r) : null;
}

export interface ListRulesOpts {
  category?: WafCategory;
  target?: WafTarget;
  active_only?: boolean;
  limit?: number;
  offset?: number;
}

export function listRules(opts: ListRulesOpts = {}): { rules: WafRule[]; total: number } {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];

  if (opts.category) { where.push('category = ?'); params.push(opts.category); }
  if (opts.target) { where.push('target = ?'); params.push(opts.target); }
  if (opts.active_only) where.push('is_active = 1');

  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);

  const total = (db.prepare(`SELECT COUNT(*) as c FROM waf_rules ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT * FROM waf_rules ${w} ORDER BY priority ASC, created_at ASC LIMIT ${limit} OFFSET ${offset}`
  ).all(...params) as any[];

  return { rules: rows.map(rowToRule), total };
}

export function updateRule(id: string, patch: Partial<RuleInput>): WafRule {
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
  if (patch.category !== undefined) {
    if (!VALID_CATEGORIES.includes(patch.category)) throw new Error('Invalid category');
    fields.push('category = ?'); params.push(patch.category);
  }
  if (patch.target !== undefined) {
    if (!VALID_TARGETS.includes(patch.target)) throw new Error('Invalid target');
    fields.push('target = ?'); params.push(patch.target);
  }
  if (patch.pattern !== undefined) {
    const p = patch.pattern.trim();
    if (p.length < 1 || p.length > 1000) throw new Error('pattern must be 1-1000 chars');
    compileRegex(p);
    fields.push('pattern = ?'); params.push(p);
  }
  if (patch.action !== undefined) {
    if (!VALID_ACTIONS.includes(patch.action)) throw new Error('Invalid action');
    fields.push('action = ?'); params.push(patch.action);
  }
  if (patch.severity !== undefined) {
    if (!VALID_SEVERITIES.includes(patch.severity)) throw new Error('Invalid severity');
    fields.push('severity = ?'); params.push(patch.severity);
  }
  if (patch.redirect_url !== undefined) {
    if (patch.redirect_url !== null) {
      try { new URL(patch.redirect_url); } catch { throw new Error('redirect_url must be a valid URL'); }
    }
    fields.push('redirect_url = ?'); params.push(patch.redirect_url);
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

  db.prepare(`UPDATE waf_rules SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getRule(id)!;
}

export function deleteRule(id: string): boolean {
  const db = getDb();
  const info = db.prepare('DELETE FROM waf_rules WHERE id = ?').run(id);
  return info.changes > 0;
}

// ============================================================
// Matching
// ============================================================

export interface InspectInput {
  path?: string | null;
  query?: string | null;
  body?: string | null;
  method?: string | null;
  user_agent?: string | null;
  referer?: string | null;
  headers?: Record<string, string> | null;
  ip_address?: string | null;
  user_id?: string | null;
  /** Skip recording matched values to DB (dry-run). */
  dry_run?: boolean;
}

export interface WafFinding {
  rule_id: string;
  rule_name: string;
  category: WafCategory;
  target: WafTarget;
  matched_value: string;
  action: WafAction;
  severity: WafSeverity;
  redirect_url: string | null;
}

export interface InspectResult {
  action: WafAction;             // final action across all findings
  findings: WafFinding[];
  blocked: boolean;
  redirect_url: string | null;
}

function getTargetValue(target: WafTarget, input: InspectInput): string | null {
  switch (target) {
    case 'path': return input.path ?? null;
    case 'query': return input.query ?? null;
    case 'body': return input.body ?? null;
    case 'header':
      if (!input.headers) return null;
      // Concatenate all header values into a single string for matching
      return Object.entries(input.headers).map(([k, v]) => `${k}: ${v}`).join('\n');
    case 'user_agent': return input.user_agent ?? null;
    case 'referer': return input.referer ?? null;
    default: return null;
  }
}

const ACTION_RANK: Record<WafAction, number> = {
  log: 1,
  challenge: 2,
  redirect: 3,
  block: 4,
};

function mergeAction(a: WafAction, b: WafAction): WafAction {
  return ACTION_RANK[a] >= ACTION_RANK[b] ? a : b;
}

/** Inspect an incoming request against all active WAF rules. */
export function inspect(input: InspectInput): InspectResult {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM waf_rules WHERE is_active = 1 ORDER BY priority ASC, created_at ASC'
  ).all() as WafRule[];

  const findings: WafFinding[] = [];
  let finalAction: WafAction = 'log';
  let redirectUrl: string | null = null;

  for (const r of rows) {
    const value = getTargetValue(r.target, input);
    if (!value) continue;

    try {
      const re = compileRegex(r.pattern);
      const m = re.exec(value);
      if (!m) continue;

      const matched = String(m[0]).slice(0, 500);
      findings.push({
        rule_id: r.id,
        rule_name: r.name,
        category: r.category,
        target: r.target,
        matched_value: matched,
        action: r.action,
        severity: r.severity,
        redirect_url: r.redirect_url,
      });

      finalAction = mergeAction(finalAction, r.action);
      if (r.action === 'redirect' && r.redirect_url) redirectUrl = r.redirect_url;

      if (!input.dry_run) {
        db.prepare(`
          INSERT INTO waf_matches
            (id, rule_id, rule_name, category, target, matched_value, path,
             method, ip_address, user_id, user_agent, action, severity, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          randomUUID(), r.id, r.name, r.category, r.target, matched,
          input.path ?? null, input.method ?? null,
          input.ip_address ?? null, input.user_id ?? null,
          input.user_agent ?? null, r.action, r.severity,
          new Date().toISOString(),
        );
      }
    } catch {
      // skip malformed regex (shouldn't happen since we validate on create)
    }
  }

  // If no findings at all, action defaults to log (pass-through)
  if (findings.length === 0) finalAction = 'log';

  return {
    action: finalAction,
    findings,
    blocked: finalAction === 'block',
    redirect_url: redirectUrl,
  };
}

// ============================================================
// Match history
// ============================================================

export interface ListMatchesOpts {
  rule_id?: string;
  category?: WafCategory;
  ip_address?: string;
  severity?: WafSeverity;
  limit?: number;
  offset?: number;
}

export function listMatches(opts: ListMatchesOpts = {}): { matches: WafMatch[]; total: number } {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];

  if (opts.rule_id) { where.push('rule_id = ?'); params.push(opts.rule_id); }
  if (opts.category) { where.push('category = ?'); params.push(opts.category); }
  if (opts.ip_address) { where.push('ip_address = ?'); params.push(opts.ip_address); }
  if (opts.severity) { where.push('severity = ?'); params.push(opts.severity); }

  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);

  const total = (db.prepare(`SELECT COUNT(*) as c FROM waf_matches ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT * FROM waf_matches ${w} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
  ).all(...params) as any[];

  return { matches: rows.map(rowToMatch), total };
}

// ============================================================
// Stats & Maintenance
// ============================================================

export interface WafStats {
  total_rules: number;
  active_rules: number;
  by_category: Record<string, number>;
  by_severity: Record<string, number>;
  matches_24h: number;
  blocks_24h: number;
  top_rules: Array<{ rule_name: string; count: number }>;
  top_ips: Array<{ ip_address: string; count: number }>;
  window_hours: number;
}

export function getWafStats(windowHours = 24): WafStats {
  const db = getDb();
  const since = new Date(Date.now() - windowHours * 3600_000).toISOString();

  const totalRules = (db.prepare('SELECT COUNT(*) as c FROM waf_rules').get() as { c: number }).c;
  const activeRules = (db.prepare('SELECT COUNT(*) as c FROM waf_rules WHERE is_active = 1').get() as { c: number }).c;

  const byCategory: Record<string, number> = {};
  for (const r of db.prepare(
    'SELECT category, COUNT(*) as c FROM waf_rules WHERE is_active = 1 GROUP BY category'
  ).all() as Array<{ category: string; c: number }>) byCategory[r.category] = r.c;

  const bySeverity: Record<string, number> = {};
  for (const r of db.prepare(
    'SELECT severity, COUNT(*) as c FROM waf_rules WHERE is_active = 1 GROUP BY severity'
  ).all() as Array<{ severity: string; c: number }>) bySeverity[r.severity] = r.c;

  const matches24h = (db.prepare(
    'SELECT COUNT(*) as c FROM waf_matches WHERE created_at >= ?'
  ).get(since) as { c: number }).c;

  const blocks24h = (db.prepare(
    "SELECT COUNT(*) as c FROM waf_matches WHERE action = 'block' AND created_at >= ?"
  ).get(since) as { c: number }).c;

  const topRules = db.prepare(`
    SELECT rule_name, COUNT(*) as count FROM waf_matches
    WHERE created_at >= ? GROUP BY rule_name
    ORDER BY count DESC LIMIT 10
  `).all(since) as Array<{ rule_name: string; count: number }>;

  const topIps = db.prepare(`
    SELECT ip_address, COUNT(*) as count FROM waf_matches
    WHERE created_at >= ? AND ip_address IS NOT NULL
    GROUP BY ip_address ORDER BY count DESC LIMIT 10
  `).all(since) as Array<{ ip_address: string; count: number }>;

  return {
    total_rules: totalRules,
    active_rules: activeRules,
    by_category: byCategory,
    by_severity: bySeverity,
    matches_24h: matches24h,
    blocks_24h: blocks24h,
    top_rules: topRules,
    top_ips: topIps,
    window_hours: windowHours,
  };
}

export function pruneOldMatches(olderThanDays = 90): { pruned: number } {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000).toISOString();
  const info = db.prepare('DELETE FROM waf_matches WHERE created_at < ?').run(cutoff);
  return { pruned: info.changes };
}
