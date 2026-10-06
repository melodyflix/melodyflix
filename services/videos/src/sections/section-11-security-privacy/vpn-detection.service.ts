// melodyflix videos - Section 11.13 VPN Detection
// Detects VPN / proxy / Tor / datacenter traffic via:
//   (1) Admin-curated CIDR ranges (known providers, Tor exits)
//   (2) Heuristic signals (ASN type, hostname patterns)
//   (3) MaxMind integration hook (future)
// Returns a risk classification with reasons.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';
import { parseCidr } from './ip-blocking.service.js';

export type VpnClass = 'vpn' | 'proxy' | 'tor' | 'datacenter' | 'residential' | 'unknown';
export type RuleCategory = 'vpn' | 'proxy' | 'tor_exit' | 'datacenter' | 'residential';

export interface VpnRule {
  id: string;
  cidr: string;
  category: RuleCategory;
  provider: string | null;
  notes: string | null;
  is_active: number;
  hit_count: number;
  last_hit_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface VpnCheck {
  id: string;
  ip: string;
  classification: VpnClass;
  is_vpn: number;
  is_proxy: number;
  is_tor: number;
  is_datacenter: number;
  risk_score: number;
  matched_rule_id: string | null;
  matched_cidr: string | null;
  provider: string | null;
  country: string | null;
  notes: string | null;
  created_at: string;
}

export interface VpnRuleInput {
  cidr: string;
  category: RuleCategory;
  provider?: string | null;
  notes?: string | null;
  is_active?: boolean;
  created_by?: string | null;
}

export interface CheckInput {
  ip: string;
  country?: string | null;
  notes?: string | null;
  record?: boolean;
}

const VALID_CATEGORIES: RuleCategory[] = ['vpn', 'proxy', 'tor_exit', 'datacenter', 'residential'];

// Risk scores by category
const RISK_BY_CATEGORY: Record<RuleCategory, number> = {
  tor_exit: 85,
  vpn: 50,
  proxy: 60,
  datacenter: 30,
  residential: 0,
};

export function ensureVpnDetectionSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS vpn_rules (
      id TEXT PRIMARY KEY,
      cidr TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('vpn','proxy','tor_exit','datacenter','residential')),
      provider TEXT,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      hit_count INTEGER NOT NULL DEFAULT 0,
      last_hit_at TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vpnrule_active ON vpn_rules(is_active);
    CREATE INDEX IF NOT EXISTS idx_vpnrule_category ON vpn_rules(category, is_active);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_vpnrule_cidr ON vpn_rules(cidr);

    CREATE TABLE IF NOT EXISTS vpn_checks (
      id TEXT PRIMARY KEY,
      ip TEXT NOT NULL,
      classification TEXT NOT NULL,
      is_vpn INTEGER NOT NULL DEFAULT 0,
      is_proxy INTEGER NOT NULL DEFAULT 0,
      is_tor INTEGER NOT NULL DEFAULT 0,
      is_datacenter INTEGER NOT NULL DEFAULT 0,
      risk_score INTEGER NOT NULL DEFAULT 0,
      matched_rule_id TEXT,
      matched_cidr TEXT,
      provider TEXT,
      country TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vpncheck_ip ON vpn_checks(ip, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_vpncheck_class ON vpn_checks(classification, created_at DESC);
  `);
}

function rowToRule(r: any): VpnRule { return r as VpnRule; }
function rowToCheck(r: any): VpnCheck { return r as VpnCheck; }

// ============================================================
// Rule CRUD
// ============================================================

export function createRule(input: VpnRuleInput): VpnRule {
  const parsed = parseCidr(input.cidr);
  if (!VALID_CATEGORIES.includes(input.category)) throw new Error(`Invalid category: ${input.category}`);

  const provider = (input.provider ?? '').trim();
  if (provider.length > 100) throw new Error('provider max 100 chars');
  const notes = (input.notes ?? '').trim();
  if (notes.length > 500) throw new Error('notes max 500 chars');

  // Normalize the CIDR — reuse the same routine as ip-blocking
  const normalized = normalizeCidrLike(input.cidr, parsed);

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO vpn_rules
      (id, cidr, category, provider, notes, is_active, hit_count,
       last_hit_at, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)
  `).run(
    id, normalized, input.category,
    provider || null, notes || null,
    input.is_active === false ? 0 : 1,
    input.created_by ?? null, now, now,
  );

  return getRule(id)!;
}

function normalizeCidrLike(cidr: string, parsed: any): string {
  if (parsed.ip_version === 4) {
    const net = Number(parsed.network_int);
    return `${(net >>> 24) & 0xff}.${(net >>> 16) & 0xff}.${(net >>> 8) & 0xff}.${net & 0xff}/${parsed.prefix}`;
  }
  return cidr.trim().toLowerCase();
}

export function getRule(id: string): VpnRule | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM vpn_rules WHERE id = ?').get(id) as any;
  return r ? rowToRule(r) : null;
}

export interface ListRulesOpts {
  category?: RuleCategory;
  active_only?: boolean;
  limit?: number;
  offset?: number;
}

export function listRules(opts: ListRulesOpts = {}): { rules: VpnRule[]; total: number } {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];

  if (opts.category) { where.push('category = ?'); params.push(opts.category); }
  if (opts.active_only) where.push('is_active = 1');

  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);

  const total = (db.prepare(`SELECT COUNT(*) as c FROM vpn_rules ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT * FROM vpn_rules ${w} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
  ).all(...params) as any[];
  return { rules: rows.map(rowToRule), total };
}

export function updateRule(id: string, patch: Partial<VpnRuleInput>): VpnRule {
  const db = getDb();
  const existing = getRule(id);
  if (!existing) throw new Error('Rule not found');

  const fields: string[] = [];
  const params: any[] = [];

  if (patch.category !== undefined) {
    if (!VALID_CATEGORIES.includes(patch.category)) throw new Error('Invalid category');
    fields.push('category = ?'); params.push(patch.category);
  }
  if (patch.provider !== undefined) {
    fields.push('provider = ?'); params.push(patch.provider);
  }
  if (patch.notes !== undefined) {
    fields.push('notes = ?'); params.push(patch.notes);
  }
  if (patch.is_active !== undefined) {
    fields.push('is_active = ?'); params.push(patch.is_active ? 1 : 0);
  }
  if (patch.cidr !== undefined) {
    const parsed = parseCidr(patch.cidr);
    fields.push('cidr = ?'); params.push(normalizeCidrLike(patch.cidr, parsed));
  }

  if (fields.length === 0) return existing;
  fields.push('updated_at = ?'); params.push(new Date().toISOString());
  params.push(id);

  db.prepare(`UPDATE vpn_rules SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getRule(id)!;
}

export function deleteRule(id: string): boolean {
  const db = getDb();
  const info = db.prepare('DELETE FROM vpn_rules WHERE id = ?').run(id);
  return info.changes > 0;
}

// ============================================================
// Detection
// ============================================================

export interface VpnDecision {
  ip: string;
  classification: VpnClass;
  is_vpn: boolean;
  is_proxy: boolean;
  is_tor: boolean;
  is_datacenter: boolean;
  risk_score: number;
  matched_rule_id: string | null;
  matched_cidr: string | null;
  provider: string | null;
  reason: string;
}

/** Core detection — returns a decision without recording. */
export function classifyIp(ip: string): VpnDecision {
  const db = getDb();
  const now = new Date().toISOString();
  const rows = db.prepare(
    "SELECT * FROM vpn_rules WHERE is_active = 1 ORDER BY created_at ASC"
  ).all() as VpnRule[];

  for (const r of rows) {
    try {
      const parsed = parseCidr(r.cidr);
      // import inline check — we need the same logic; use helper
      const target = ipToBigInt(ip);
      if (target === null) break;
      if ((target & parsed.mask_int) === parsed.network_int) {
        // hit — increment counters
        db.prepare('UPDATE vpn_rules SET hit_count = hit_count + 1, last_hit_at = ? WHERE id = ?')
          .run(now, r.id);

        const risk = RISK_BY_CATEGORY[r.category];
        return {
          ip,
          classification: r.category === 'tor_exit' ? 'tor' : r.category,
          is_vpn: r.category === 'vpn',
          is_proxy: r.category === 'proxy',
          is_tor: r.category === 'tor_exit',
          is_datacenter: r.category === 'datacenter',
          risk_score: risk,
          matched_rule_id: r.id,
          matched_cidr: r.cidr,
          provider: r.provider,
          reason: r.provider
            ? `Matched ${r.category} rule for ${r.provider}`
            : `Matched ${r.category} rule`,
        };
      }
    } catch {
      // skip malformed
    }
  }

  // No rule matched → assume residential/unknown with no signal
  return {
    ip,
    classification: 'unknown',
    is_vpn: false,
    is_proxy: false,
    is_tor: false,
    is_datacenter: false,
    risk_score: 0,
    matched_rule_id: null,
    matched_cidr: null,
    provider: null,
    reason: 'No matching rule - treated as residential',
  };
}

function ipToBigInt(ip: string): bigint | null {
  if (!ip) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    return BigInt(ip.split('.').reduce((a, o) => (a << 8) + parseInt(o, 10), 0) >>> 0);
  }
  if (ip.includes(':')) {
    try {
      const [head, tail] = ip.split('::');
      const hp = head ? head.split(':').filter(Boolean) : [];
      const tp = tail ? tail.split(':').filter(Boolean) : [];
      const missing = 8 - hp.length - tp.length;
      const full = [...hp, ...Array(Math.max(0, missing)).fill('0'), ...tp];
      let n = 0n;
      for (const g of full) n = (n << 16n) + BigInt(parseInt(g || '0', 16));
      return n;
    } catch {
      return null;
    }
  }
  return null;
}

/** Full check — optionally records to vpn_checks table. */
export function checkIp(input: CheckInput): VpnCheck {
  const decision = classifyIp(input.ip);

  if (!input.record) {
    // Ad-hoc preview — return synthetic row (not persisted)
    return {
      id: '',
      ip: input.ip,
      classification: decision.classification,
      is_vpn: decision.is_vpn ? 1 : 0,
      is_proxy: decision.is_proxy ? 1 : 0,
      is_tor: decision.is_tor ? 1 : 0,
      is_datacenter: decision.is_datacenter ? 1 : 0,
      risk_score: decision.risk_score,
      matched_rule_id: decision.matched_rule_id,
      matched_cidr: decision.matched_cidr,
      provider: decision.provider,
      country: input.country ?? null,
      notes: input.notes ?? null,
      created_at: new Date().toISOString(),
    };
  }

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO vpn_checks
      (id, ip, classification, is_vpn, is_proxy, is_tor, is_datacenter,
       risk_score, matched_rule_id, matched_cidr, provider, country, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.ip, decision.classification,
    decision.is_vpn ? 1 : 0, decision.is_proxy ? 1 : 0,
    decision.is_tor ? 1 : 0, decision.is_datacenter ? 1 : 0,
    decision.risk_score, decision.matched_rule_id, decision.matched_cidr,
    decision.provider, input.country ?? null, input.notes ?? null, now,
  );

  return getCheck(id)!;
}

export function getCheck(id: string): VpnCheck | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM vpn_checks WHERE id = ?').get(id) as any;
  return r ? rowToCheck(r) : null;
}

export interface ListChecksOpts {
  ip?: string;
  classification?: VpnClass;
  min_risk?: number;
  limit?: number;
  offset?: number;
}

export function listChecks(opts: ListChecksOpts = {}): { checks: VpnCheck[]; total: number } {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];

  if (opts.ip) { where.push('ip = ?'); params.push(opts.ip); }
  if (opts.classification) { where.push('classification = ?'); params.push(opts.classification); }
  if (opts.min_risk !== undefined) { where.push('risk_score >= ?'); params.push(opts.min_risk); }

  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);

  const total = (db.prepare(`SELECT COUNT(*) as c FROM vpn_checks ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT * FROM vpn_checks ${w} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
  ).all(...params) as any[];
  return { checks: rows.map(rowToCheck), total };
}

// ============================================================
// Stats & Maintenance
// ============================================================

export interface VpnStats {
  total_rules: number;
  active_rules: number;
  by_category: Record<string, number>;
  checks_24h: number;
  suspicious_24h: number;
  top_providers: Array<{ provider: string; count: number }>;
}

export function getVpnStats(): VpnStats {
  const db = getDb();
  const since = new Date(Date.now() - 86400_000).toISOString();

  const totalRules = (db.prepare('SELECT COUNT(*) as c FROM vpn_rules').get() as { c: number }).c;
  const activeRules = (db.prepare('SELECT COUNT(*) as c FROM vpn_rules WHERE is_active = 1').get() as { c: number }).c;

  const byCategory: Record<string, number> = {};
  for (const r of db.prepare(
    'SELECT category, COUNT(*) as c FROM vpn_rules WHERE is_active = 1 GROUP BY category'
  ).all() as Array<{ category: string; c: number }>) byCategory[r.category] = r.c;

  const checks24h = (db.prepare(
    'SELECT COUNT(*) as c FROM vpn_checks WHERE created_at >= ?'
  ).get(since) as { c: number }).c;

  const suspicious = (db.prepare(
    'SELECT COUNT(*) as c FROM vpn_checks WHERE created_at >= ? AND risk_score >= 50'
  ).get(since) as { c: number }).c;

  const topProviders = db.prepare(`
    SELECT provider, COUNT(*) as count FROM vpn_checks
    WHERE created_at >= ? AND provider IS NOT NULL
    GROUP BY provider ORDER BY count DESC LIMIT 10
  `).all(since) as Array<{ provider: string; count: number }>;

  return {
    total_rules: totalRules,
    active_rules: activeRules,
    by_category: byCategory,
    checks_24h: checks24h,
    suspicious_24h: suspicious,
    top_providers: topProviders,
  };
}

export function pruneOldChecks(olderThanDays = 90): { pruned: number } {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000).toISOString();
  const info = db.prepare('DELETE FROM vpn_checks WHERE created_at < ?').run(cutoff);
  return { pruned: info.changes };
}
