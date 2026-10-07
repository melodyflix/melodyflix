// melodyflix videos - Section 12.7 GDPR / Cookie Consent
// Cookie categories + definitions, immutable consent log, policy versions,
// GDPR region detection, and consent statistics.
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type CookieCategoryKind = 'necessary' | 'functional' | 'analytics' | 'marketing' | 'custom';

const EU_EEA = [
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU',
  'MT','NL','PL','PT','RO','SK','SI','ES','SE','IS','LI','NO','GB',
];

export function ensureCookieConsentSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS cookie_categories (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      required INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_cookie_cat_slug ON cookie_categories(slug);

    CREATE TABLE IF NOT EXISTS cookie_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category_id TEXT NOT NULL,
      provider TEXT,
      domain TEXT,
      duration TEXT,
      description TEXT,
      is_third_party INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cookie_def_cat ON cookie_definitions(category_id, name);

    CREATE TABLE IF NOT EXISTS consent_policy_versions (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      body_md TEXT NOT NULL,
      published_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_consent_version ON consent_policy_versions(version);

    CREATE TABLE IF NOT EXISTS consent_records (
      id TEXT PRIMARY KEY,
      visitor_id TEXT NOT NULL,
      user_id TEXT,
      policy_version TEXT NOT NULL,
      action TEXT NOT NULL,
      granted_categories TEXT NOT NULL DEFAULT '[]',
      revoked_categories TEXT NOT NULL DEFAULT '[]',
      region TEXT,
      gdpr INTEGER NOT NULL DEFAULT 0,
      ip_hash TEXT,
      ua_hash TEXT,
      source TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_consent_visitor ON consent_records(visitor_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_consent_user ON consent_records(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_consent_region ON consent_records(gdpr, region, created_at DESC);
  `);
}

// ---------- Types ----------
export interface CookieCategory {
  id: string;
  slug: string;
  kind: CookieCategoryKind;
  title: string;
  description: string | null;
  required: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface CookieDefinition {
  id: string;
  name: string;
  category_id: string;
  provider: string | null;
  domain: string | null;
  duration: string | null;
  description: string | null;
  is_third_party: number;
  created_at: string;
  updated_at: string;
}

export interface ConsentPolicyVersion {
  id: string;
  version: string;
  body_md: string;
  published_at: string;
  created_at: string;
}

export interface ConsentRecord {
  id: string;
  visitor_id: string;
  user_id: string | null;
  policy_version: string;
  action: 'grant' | 'update' | 'revoke' | 'withdraw';
  granted_categories: string;
  revoked_categories: string;
  region: string | null;
  gdpr: number;
  ip_hash: string | null;
  ua_hash: string | null;
  source: string | null;
  created_at: string;
}

// ---------- Helpers ----------
function hash(v: string | null | undefined): string | null {
  if (!v) return null;
  return createHash('sha256').update(v).digest('hex').slice(0, 32);
}

export function isGdprRegion(region: string | null | undefined): boolean {
  if (!region) return false;
  return EU_EEA.includes(region.toUpperCase());
}

// ---------- Categories ----------
export interface CategoryInput {
  slug: string;
  kind: CookieCategoryKind;
  title: string;
  description?: string | null;
  required?: boolean;
  enabled?: boolean;
}

export function upsertCategory(input: CategoryInput): CookieCategory {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM cookie_categories WHERE slug = ?')
    .get(input.slug) as CookieCategory | undefined;
  if (existing) {
    db.prepare(`
      UPDATE cookie_categories SET kind = ?, title = ?, description = ?, required = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(input.kind, input.title, input.description ?? null,
      input.required ? 1 : existing.required, input.enabled === false ? 0 : 1, now, existing.id);
    return getCategory(existing.id)!;
  }
  const id = randomUUID();
  db.prepare(`
    INSERT INTO cookie_categories (id, slug, kind, title, description, required, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.slug, input.kind, input.title, input.description ?? null,
    input.required ? 1 : 0, input.enabled === false ? 0 : 1, now, now);
  return getCategory(id)!;
}

export function getCategory(id: string): CookieCategory | null {
  return (getDb().prepare('SELECT * FROM cookie_categories WHERE id = ?').get(id) as CookieCategory | undefined) ?? null;
}

export function listCategories(enabledOnly = false): CookieCategory[] {
  const db = getDb();
  const sql = enabledOnly
    ? 'SELECT * FROM cookie_categories WHERE enabled = 1 ORDER BY required DESC, slug'
    : 'SELECT * FROM cookie_categories ORDER BY required DESC, slug';
  return db.prepare(sql).all() as CookieCategory[];
}

export function deleteCategory(id: string): boolean {
  const db = getDb();
  const c = db.prepare('SELECT COUNT(*) AS c FROM cookie_definitions WHERE category_id = ?')
    .get(id) as { c: number };
  if (c.c > 0) throw new Error('category_has_cookies');
  return db.prepare('DELETE FROM cookie_categories WHERE id = ?').run(id).changes > 0;
}

// ---------- Cookie definitions ----------
export interface CookieInput {
  name: string;
  category_id: string;
  provider?: string | null;
  domain?: string | null;
  duration?: string | null;
  description?: string | null;
  is_third_party?: boolean;
}

export function upsertCookie(input: CookieInput): CookieDefinition {
  if (!getCategory(input.category_id)) throw new Error('category_not_found');
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM cookie_definitions WHERE name = ? AND category_id = ?')
    .get(input.name, input.category_id) as CookieDefinition | undefined;
  if (existing) {
    db.prepare(`
      UPDATE cookie_definitions SET provider = ?, domain = ?, duration = ?, description = ?,
        is_third_party = ?, updated_at = ?
      WHERE id = ?
    `).run(input.provider ?? null, input.domain ?? null, input.duration ?? null,
      input.description ?? null, input.is_third_party ? 1 : 0, now, existing.id);
    return getCookie(existing.id)!;
  }
  const id = randomUUID();
  db.prepare(`
    INSERT INTO cookie_definitions
      (id, name, category_id, provider, domain, duration, description, is_third_party, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.name, input.category_id, input.provider ?? null, input.domain ?? null,
    input.duration ?? null, input.description ?? null, input.is_third_party ? 1 : 0, now, now);
  return getCookie(id)!;
}

export function getCookie(id: string): CookieDefinition | null {
  return (getDb().prepare('SELECT * FROM cookie_definitions WHERE id = ?').get(id) as CookieDefinition | undefined) ?? null;
}

export function listCookies(categoryId?: string): CookieDefinition[] {
  const db = getDb();
  if (categoryId) {
    return db.prepare('SELECT * FROM cookie_definitions WHERE category_id = ? ORDER BY name')
      .all(categoryId) as CookieDefinition[];
  }
  return db.prepare('SELECT * FROM cookie_definitions ORDER BY name').all() as CookieDefinition[];
}

export function deleteCookie(id: string): boolean {
  return getDb().prepare('DELETE FROM cookie_definitions WHERE id = ?').run(id).changes > 0;
}

// ---------- Policy versions ----------
export interface PolicyInput {
  version: string;
  body_md: string;
  published_at?: string;
}

export function publishPolicy(input: PolicyInput): ConsentPolicyVersion {
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO consent_policy_versions (id, version, body_md, published_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, input.version, input.body_md, input.published_at ?? now, now);
  return db.prepare('SELECT * FROM consent_policy_versions WHERE id = ?').get(id) as ConsentPolicyVersion;
}

export function getLatestPolicy(): ConsentPolicyVersion | null {
  return (getDb().prepare(
    'SELECT * FROM consent_policy_versions ORDER BY published_at DESC LIMIT 1'
  ).get() as ConsentPolicyVersion | undefined) ?? null;
}

export function listPolicies(limit = 50): ConsentPolicyVersion[] {
  return getDb().prepare(
    'SELECT * FROM consent_policy_versions ORDER BY published_at DESC LIMIT ?'
  ).all(limit) as ConsentPolicyVersion[];
}

// ---------- Consent records ----------
export interface ConsentInput {
  visitor_id: string;
  user_id?: string | null;
  policy_version: string;
  action?: 'grant' | 'update' | 'revoke' | 'withdraw';
  granted_categories: string[];
  revoked_categories?: string[];
  region?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  source?: string | null;
}

export function recordConsent(input: ConsentInput): ConsentRecord {
  if (!input.visitor_id) throw new Error('visitor_id_required');
  if (!input.policy_version) throw new Error('policy_version_required');
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const gdpr = isGdprRegion(input.region) ? 1 : 0;
  db.prepare(`
    INSERT INTO consent_records
      (id, visitor_id, user_id, policy_version, action, granted_categories, revoked_categories,
       region, gdpr, ip_hash, ua_hash, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.visitor_id, input.user_id ?? null, input.policy_version,
    input.action ?? 'grant', JSON.stringify(input.granted_categories),
    JSON.stringify(input.revoked_categories ?? []),
    input.region ?? null, gdpr, hash(input.ip), hash(input.user_agent),
    input.source ?? null, now);
  return db.prepare('SELECT * FROM consent_records WHERE id = ?').get(id) as ConsentRecord;
}

export function getLatestConsent(visitorId: string): ConsentRecord | null {
  return (getDb().prepare(
    'SELECT * FROM consent_records WHERE visitor_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(visitorId) as ConsentRecord | undefined) ?? null;
}

export function listConsents(filter?: {
  visitor_id?: string;
  user_id?: string;
  gdpr?: boolean;
  region?: string;
  limit?: number;
}): ConsentRecord[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter?.visitor_id) { where.push('visitor_id = ?'); args.push(filter.visitor_id); }
  if (filter?.user_id) { where.push('user_id = ?'); args.push(filter.user_id); }
  if (filter?.gdpr !== undefined) { where.push('gdpr = ?'); args.push(filter.gdpr ? 1 : 0); }
  if (filter?.region) { where.push('region = ?'); args.push(filter.region); }
  const sql = `SELECT * FROM consent_records ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args) as ConsentRecord[];
}

export function revokeConsent(input: {
  visitor_id: string;
  user_id?: string | null;
  policy_version: string;
  revoke_categories: string[];
  region?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  source?: string | null;
}): ConsentRecord {
  const latest = getLatestConsent(input.visitor_id);
  const current: string[] = latest ? JSON.parse(latest.granted_categories) : [];
  const remaining = current.filter(c => !input.revoke_categories.includes(c));
  return recordConsent({
    visitor_id: input.visitor_id,
    user_id: input.user_id ?? latest?.user_id ?? null,
    policy_version: input.policy_version,
    action: 'revoke',
    granted_categories: remaining,
    revoked_categories: input.revoke_categories,
    region: input.region ?? latest?.region ?? null,
    ip: input.ip,
    user_agent: input.user_agent,
    source: input.source,
  });
}

// ---------- Effective grants ----------
export interface EffectiveConsent {
  visitor_id: string;
  granted_categories: string[];
  policy_version: string | null;
  gdpr: boolean;
  region: string | null;
  updated_at: string | null;
}

export function getEffectiveConsent(visitorId: string): EffectiveConsent {
  const latest = getLatestConsent(visitorId);
  if (!latest) {
    return { visitor_id: visitorId, granted_categories: [], policy_version: null,
      gdpr: false, region: null, updated_at: null };
  }
  return {
    visitor_id: visitorId,
    granted_categories: JSON.parse(latest.granted_categories),
    policy_version: latest.policy_version,
    gdpr: latest.gdpr === 1,
    region: latest.region,
    updated_at: latest.created_at,
  };
}

// ---------- Stats ----------
export interface ConsentStats {
  total_records: number;
  unique_visitors: number;
  gdpr_records: number;
  non_gdpr_records: number;
  by_region: Record<string, number>;
  by_action: Record<string, number>;
  grant_rate_by_category: Record<string, number>;
  total_categories: number;
  total_cookies: number;
}

export function getConsentStats(): ConsentStats {
  const db = getDb();
  const rows = db.prepare('SELECT visitor_id, gdpr, region, action, granted_categories FROM consent_records').all() as
    { visitor_id: string; gdpr: number; region: string | null; action: string; granted_categories: string }[];
  const visitors = new Set<string>();
  const byRegion: Record<string, number> = {};
  const byAction: Record<string, number> = {};
  const grantCount: Record<string, number> = {};
  let gdpr = 0;
  for (const r of rows) {
    visitors.add(r.visitor_id);
    if (r.gdpr) gdpr++;
    if (r.region) byRegion[r.region] = (byRegion[r.region] ?? 0) + 1;
    byAction[r.action] = (byAction[r.action] ?? 0) + 1;
    const granted = JSON.parse(r.granted_categories) as string[];
    for (const c of granted) grantCount[c] = (grantCount[c] ?? 0) + 1;
  }
  const cats = db.prepare('SELECT COUNT(*) AS c FROM cookie_categories').get() as { c: number };
  const cookies = db.prepare('SELECT COUNT(*) AS c FROM cookie_definitions').get() as { c: number };
  const grantRate: Record<string, number> = {};
  const totalRecords = rows.length || 1;
  for (const [k, v] of Object.entries(grantCount)) grantRate[k] = v / totalRecords;
  return {
    total_records: rows.length,
    unique_visitors: visitors.size,
    gdpr_records: gdpr,
    non_gdpr_records: rows.length - gdpr,
    by_region: byRegion,
    by_action: byAction,
    grant_rate_by_category: grantRate,
    total_categories: cats.c,
    total_cookies: cookies.c,
  };
}
