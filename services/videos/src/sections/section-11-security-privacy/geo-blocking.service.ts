// melodyflix videos - Section 11.5 Geo-blocking
// Country-based allow/deny rules for global, video, channel, series scope.
// Uses MaxMind GeoIP2 integration when available; otherwise trusts CDN country header.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';
import { getIntegrationConfigRaw, isIntegrationReady } from '../../services/integration-settings.service.js';

export type RuleType = 'allow' | 'deny';
export type AppliesTo = 'global' | 'video' | 'channel' | 'series';

export interface GeoBlockRule {
  id: string;
  name: string;
  rule_type: RuleType;
  countries: string[];
  applies_to: AppliesTo;
  target_id: string | null;
  is_active: number;
  priority: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface GeoRuleInput {
  name: string;
  rule_type: RuleType;
  countries: string[];
  applies_to?: AppliesTo;
  target_id?: string | null;
  is_active?: boolean;
  priority?: number;
  created_by?: string | null;
}

const ISO_RE = /^[A-Z]{2}$/;
const VALID_APPLIES: AppliesTo[] = ['global', 'video', 'channel', 'series'];

function normalizeCountry(c: string): string {
  return String(c || '').trim().toUpperCase();
}

function validateCountries(list: string[]): string[] {
  const out: string[] = [];
  for (const raw of list || []) {
    const c = normalizeCountry(raw);
    if (!ISO_RE.test(c)) throw new Error(`Invalid ISO country code: ${raw}`);
    out.push(c);
  }
  if (out.length === 0) throw new Error('At least one country is required');
  return Array.from(new Set(out));
}

export function ensureGeoBlockSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS geo_block_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      rule_type TEXT NOT NULL CHECK (rule_type IN ('allow','deny')),
      countries TEXT NOT NULL,
      applies_to TEXT NOT NULL DEFAULT 'global' CHECK (applies_to IN ('global','video','channel','series')),
      target_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 100,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_geoblock_active ON geo_block_rules(is_active);
    CREATE INDEX IF NOT EXISTS idx_geoblock_target ON geo_block_rules(applies_to, target_id);
  `);
}

function rowToRule(r: any): GeoBlockRule {
  return {
    ...r,
    countries: JSON.parse(r.countries),
  };
}

export function listRules(filters: { applies_to?: AppliesTo; target_id?: string; active_only?: boolean } = {}): GeoBlockRule[] {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];
  if (filters.applies_to) { where.push('applies_to = ?'); params.push(filters.applies_to); }
  if (filters.target_id) { where.push('target_id = ?'); params.push(filters.target_id); }
  if (filters.active_only) { where.push('is_active = 1'); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.prepare(
    `SELECT * FROM geo_block_rules ${w} ORDER BY priority ASC, created_at ASC`
  ).all(...params) as any[];
  return rows.map(rowToRule);
}

export function getRule(id: string): GeoBlockRule | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM geo_block_rules WHERE id = ?').get(id) as any;
  return r ? rowToRule(r) : null;
}

export function createRule(input: GeoRuleInput): GeoBlockRule {
  const db = getDb();
  const name = String(input.name || '').trim();
  if (name.length < 1 || name.length > 120) throw new Error('name must be 1-120 chars');

  if (!['allow', 'deny'].includes(input.rule_type)) throw new Error('rule_type must be allow or deny');

  const applies_to = input.applies_to || 'global';
  if (!VALID_APPLIES.includes(applies_to)) throw new Error('Invalid applies_to');

  if (applies_to !== 'global' && !input.target_id) {
    throw new Error('target_id required when applies_to is not global');
  }
  if (applies_to === 'global' && input.target_id) {
    throw new Error('target_id must be null for global rules');
  }

  const countries = validateCountries(input.countries);
  const now = new Date().toISOString();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO geo_block_rules
      (id, name, rule_type, countries, applies_to, target_id, is_active, priority, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, name, input.rule_type, JSON.stringify(countries),
    applies_to, input.target_id ?? null,
    input.is_active === false ? 0 : 1,
    input.priority ?? 100,
    input.created_by ?? null, now, now
  );
  return getRule(id)!;
}

export function updateRule(id: string, patch: Partial<GeoRuleInput>): GeoBlockRule {
  const db = getDb();
  const existing = getRule(id);
  if (!existing) throw new Error('Rule not found');

  const fields: string[] = [];
  const params: any[] = [];

  if (patch.name !== undefined) {
    const n = String(patch.name).trim();
    if (n.length < 1 || n.length > 120) throw new Error('name must be 1-120 chars');
    fields.push('name = ?'); params.push(n);
  }
  if (patch.rule_type !== undefined) {
    if (!['allow', 'deny'].includes(patch.rule_type)) throw new Error('Invalid rule_type');
    fields.push('rule_type = ?'); params.push(patch.rule_type);
  }
  if (patch.countries !== undefined) {
    const c = validateCountries(patch.countries);
    fields.push('countries = ?'); params.push(JSON.stringify(c));
  }
  if (patch.applies_to !== undefined) {
    if (!VALID_APPLIES.includes(patch.applies_to)) throw new Error('Invalid applies_to');
    fields.push('applies_to = ?'); params.push(patch.applies_to);
  }
  if (patch.target_id !== undefined) {
    fields.push('target_id = ?'); params.push(patch.target_id);
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

  db.prepare(`UPDATE geo_block_rules SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getRule(id)!;
}

export function deleteRule(id: string): boolean {
  const db = getDb();
  const info = db.prepare('DELETE FROM geo_block_rules WHERE id = ?').run(id);
  return info.changes > 0;
}

// ============================================================
// Access check
// ============================================================

export interface GeoContext {
  ip?: string;
  country?: string;          // explicit ISO code (preferred, e.g. from CF-IPCountry)
  video_id?: string;
  channel_id?: string;
  series_id?: string;
}

export interface GeoDecision {
  allowed: boolean;
  country: string | null;
  reason: string;
  matched_rule_id: string | null;
  matched_rule_name: string | null;
  source: 'explicit' | 'maxmind' | 'none';
}

/** Resolve ISO country code from IP using MaxMind integration (if ready). */
export function resolveCountryFromIp(ip: string): string | null {
  if (!ip) return null;
  if (!isIntegrationReady('maxmind')) return null;
  const cfg = getIntegrationConfigRaw('maxmind');
  if (!cfg) return null;
  // Future: use mmdb lookup via maxmind module. For now, config-only readiness.
  // Placeholder: real lookup will be wired when module is installed.
  return null;
}

/** Pick the highest-priority (lowest number) matching rule. */
function pickRule(rules: GeoBlockRule[], country: string, ctx: GeoContext): GeoBlockRule | null {
  for (const r of rules) {
    if (!r.is_active) continue;
    if (!r.countries.includes(country)) continue;
    // target match
    if (r.applies_to === 'global') return r;
    if (r.applies_to === 'video' && r.target_id && r.target_id === ctx.video_id) return r;
    if (r.applies_to === 'channel' && r.target_id && r.target_id === ctx.channel_id) return r;
    if (r.applies_to === 'series' && r.target_id && r.target_id === ctx.series_id) return r;
  }
  return null;
}

export function checkAccess(ctx: GeoContext): GeoDecision {
  let country: string | null = null;
  let source: GeoDecision['source'] = 'none';

  if (ctx.country) {
    country = normalizeCountry(ctx.country);
    source = 'explicit';
  } else if (ctx.ip) {
    country = resolveCountryFromIp(ctx.ip);
    if (country) source = 'maxmind';
  }

  if (!country || !ISO_RE.test(country)) {
    return {
      allowed: true,
      country: null,
      reason: 'No country detected - defaulting to allow',
      matched_rule_id: null,
      matched_rule_name: null,
      source,
    };
  }

  // Gather candidate rules: global + matching target
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM geo_block_rules
    WHERE is_active = 1
      AND (
        applies_to = 'global'
        OR (applies_to = 'video'   AND target_id = ?)
        OR (applies_to = 'channel' AND target_id = ?)
        OR (applies_to = 'series'  AND target_id = ?)
      )
    ORDER BY priority ASC, created_at ASC
  `).all(ctx.video_id ?? '', ctx.channel_id ?? '', ctx.series_id ?? '') as any[];

  const rules = rows.map(rowToRule);
  const match = pickRule(rules, country, ctx);

  if (!match) {
    return {
      allowed: true,
      country,
      reason: 'No matching rule - default allow',
      matched_rule_id: null,
      matched_rule_name: null,
      source,
    };
  }

  return {
    allowed: match.rule_type === 'allow',
    country,
    reason: match.rule_type === 'allow'
      ? `Country ${country} explicitly allowed by rule "${match.name}"`
      : `Country ${country} blocked by rule "${match.name}"`,
    matched_rule_id: match.id,
    matched_rule_name: match.name,
    source,
  };
}
