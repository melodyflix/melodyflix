// melodyflix videos - Section 12.1 CDN (Content Delivery Network)
// Multi-CDN registry, region-aware routing, health tracking, and
// fallback resolution.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type CdnProviderKind = 'cloudflare' | 'fastly' | 'cloudfront' | 'bunny' | 'akamai' | 'custom';
export type CdnTier = 'primary' | 'secondary' | 'fallback';

const PROVIDER_KINDS: CdnProviderKind[] = ['cloudflare','fastly','cloudfront','bunny','akamai','custom'];
const TIERS: CdnTier[] = ['primary','secondary','fallback'];

export function ensureCdnSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS cdn_providers (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'secondary',
      regions TEXT NOT NULL DEFAULT '[]',
      api_key_ref TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cdn_prov_kind ON cdn_providers(kind, enabled);
    CREATE INDEX IF NOT EXISTS idx_cdn_prov_tier ON cdn_providers(tier, enabled);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_cdn_prov_name ON cdn_providers(name);

    CREATE TABLE IF NOT EXISTS cdn_routes (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      video_id TEXT,
      region TEXT,
      path_prefix TEXT,
      priority INTEGER NOT NULL DEFAULT 100,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cdn_route_video
      ON cdn_routes(video_id, priority, enabled);
    CREATE INDEX IF NOT EXISTS idx_cdn_route_region
      ON cdn_routes(region, priority, enabled);

    CREATE TABLE IF NOT EXISTS cdn_health (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      status TEXT NOT NULL,
      latency_ms INTEGER,
      error_rate REAL,
      checked_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cdn_health_prov_time
      ON cdn_health(provider_id, checked_at DESC);
  `);
}

// ---------- Types ----------
export interface CdnProvider {
  id: string;
  kind: CdnProviderKind;
  name: string;
  base_url: string;
  tier: CdnTier;
  regions: string; // JSON array
  api_key_ref: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface CdnRoute {
  id: string;
  provider_id: string;
  video_id: string | null;
  region: string | null;
  path_prefix: string | null;
  priority: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface CdnHealth {
  id: string;
  provider_id: string;
  status: string;
  latency_ms: number | null;
  error_rate: number | null;
  checked_at: string;
}

// ---------- Providers ----------
export interface CreateProviderInput {
  kind: CdnProviderKind;
  name: string;
  base_url: string;
  tier?: CdnTier;
  regions?: string[];
  api_key_ref?: string | null;
}

export function createProvider(input: CreateProviderInput): CdnProvider {
  if (!PROVIDER_KINDS.includes(input.kind)) throw new Error('invalid_provider_kind');
  const tier = input.tier ?? 'secondary';
  if (!TIERS.includes(tier)) throw new Error('invalid_tier');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO cdn_providers (id, kind, name, base_url, tier, regions, api_key_ref, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, input.kind, input.name, input.base_url, tier, JSON.stringify(input.regions ?? []), input.api_key_ref ?? null, now, now);
  return getProvider(id)!;
}

export function getProvider(id: string): CdnProvider | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM cdn_providers WHERE id = ?').get(id) as CdnProvider | undefined) ?? null;
}

export function listProviders(filter?: { kind?: CdnProviderKind; tier?: CdnTier; enabledOnly?: boolean }): CdnProvider[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter?.kind) { where.push('kind = ?'); args.push(filter.kind); }
  if (filter?.tier) { where.push('tier = ?'); args.push(filter.tier); }
  if (filter?.enabledOnly) where.push('enabled = 1');
  const sql = `SELECT * FROM cdn_providers ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY tier, name`;
  return db.prepare(sql).all(...args) as CdnProvider[];
}

export function updateProvider(id: string, patch: Partial<CreateProviderInput> & { enabled?: boolean }): CdnProvider | null {
  const existing = getProvider(id);
  if (!existing) return null;
  const fields: string[] = [];
  const args: any[] = [];
  if (patch.kind !== undefined) { fields.push('kind = ?'); args.push(patch.kind); }
  if (patch.name !== undefined) { fields.push('name = ?'); args.push(patch.name); }
  if (patch.base_url !== undefined) { fields.push('base_url = ?'); args.push(patch.base_url); }
  if (patch.tier !== undefined) { if (!TIERS.includes(patch.tier)) throw new Error('invalid_tier'); fields.push('tier = ?'); args.push(patch.tier); }
  if (patch.regions !== undefined) { fields.push('regions = ?'); args.push(JSON.stringify(patch.regions)); }
  if (patch.api_key_ref !== undefined) { fields.push('api_key_ref = ?'); args.push(patch.api_key_ref); }
  if (patch.enabled !== undefined) { fields.push('enabled = ?'); args.push(patch.enabled ? 1 : 0); }
  if (!fields.length) return existing;
  fields.push('updated_at = ?'); args.push(new Date().toISOString());
  args.push(id);
  getDb().prepare(`UPDATE cdn_providers SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  return getProvider(id);
}

export function deleteProvider(id: string): boolean {
  const db = getDb();
  const routes = db.prepare('SELECT COUNT(*) AS c FROM cdn_routes WHERE provider_id = ?').get(id) as { c: number };
  if (routes.c > 0) throw new Error('provider_has_routes');
  const r = db.prepare('DELETE FROM cdn_providers WHERE id = ?').run(id);
  return r.changes > 0;
}

// ---------- Routes ----------
export interface CreateRouteInput {
  provider_id: string;
  video_id?: string | null;
  region?: string | null;
  path_prefix?: string | null;
  priority?: number;
  enabled?: boolean;
}

export function createRoute(input: CreateRouteInput): CdnRoute {
  if (!getProvider(input.provider_id)) throw new Error('provider_not_found');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO cdn_routes (id, provider_id, video_id, region, path_prefix, priority, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.provider_id, input.video_id ?? null, input.region ?? null, input.path_prefix ?? null,
    input.priority ?? 100, input.enabled === false ? 0 : 1, now, now);
  return getRoute(id)!;
}

export function getRoute(id: string): CdnRoute | null {
  return (getDb().prepare('SELECT * FROM cdn_routes WHERE id = ?').get(id) as CdnRoute | undefined) ?? null;
}

export function listRoutes(filter?: { provider_id?: string; video_id?: string; region?: string; enabledOnly?: boolean }): CdnRoute[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter?.provider_id) { where.push('provider_id = ?'); args.push(filter.provider_id); }
  if (filter?.video_id) { where.push('video_id = ?'); args.push(filter.video_id); }
  if (filter?.region) { where.push('region = ?'); args.push(filter.region); }
  if (filter?.enabledOnly) where.push('enabled = 1');
  const sql = `SELECT * FROM cdn_routes ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY priority, created_at`;
  return db.prepare(sql).all(...args) as CdnRoute[];
}

export function deleteRoute(id: string): boolean {
  return getDb().prepare('DELETE FROM cdn_routes WHERE id = ?').run(id).changes > 0;
}

// ---------- Health ----------
export function recordHealth(provider_id: string, status: string, latency_ms?: number, error_rate?: number): CdnHealth {
  if (!getProvider(provider_id)) throw new Error('provider_not_found');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO cdn_health (id, provider_id, status, latency_ms, error_rate, checked_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, provider_id, status, latency_ms ?? null, error_rate ?? null, now);
  return db.prepare('SELECT * FROM cdn_health WHERE id = ?').get(id) as CdnHealth;
}

export function getLatestHealth(provider_id: string): CdnHealth | null {
  return (getDb().prepare(
    'SELECT * FROM cdn_health WHERE provider_id = ? ORDER BY checked_at DESC LIMIT 1'
  ).get(provider_id) as CdnHealth | undefined) ?? null;
}

export function listHealth(provider_id: string, limit = 100): CdnHealth[] {
  return getDb().prepare(
    'SELECT * FROM cdn_health WHERE provider_id = ? ORDER BY checked_at DESC LIMIT ?'
  ).all(provider_id, limit) as CdnHealth[];
}

// ---------- Resolution (region + video aware) ----------
export interface ResolvedCdn {
  provider: CdnProvider;
  route: CdnRoute;
  url: string;
}

export function resolveCdn(videoId: string, region?: string): ResolvedCdn | null {
  const db = getDb();
  // Best route wins: video-specific > region-specific > global, by lowest priority
  const rows = db.prepare(`
    SELECT r.*, p.id AS p_id, p.kind AS p_kind, p.name AS p_name, p.base_url AS p_base_url,
           p.tier AS p_tier, p.regions AS p_regions, p.api_key_ref AS p_api_key_ref,
           p.enabled AS p_enabled, p.created_at AS p_created_at, p.updated_at AS p_updated_at,
           r.id AS r_id, r.provider_id AS r_provider_id, r.video_id AS r_video_id,
           r.region AS r_region, r.path_prefix AS r_path_prefix, r.priority AS r_priority,
           r.enabled AS r_enabled, r.created_at AS r_created_at, r.updated_at AS r_updated_at
    FROM cdn_routes r
    JOIN cdn_providers p ON p.id = r.provider_id
    WHERE r.enabled = 1 AND p.enabled = 1
      AND (r.video_id IS NULL OR r.video_id = ?)
      AND (r.region IS NULL OR r.region = ?)
    ORDER BY
      CASE WHEN r.video_id = ? THEN 0 ELSE 1 END,
      CASE WHEN r.region = ? THEN 0 ELSE 1 END,
      r.priority ASC
    LIMIT 1
  `).all(videoId, region ?? '', videoId, region ?? '') as any[];
  if (!rows.length) return null;
  const row = rows[0];
  const provider: CdnProvider = {
    id: row.p_id, kind: row.p_kind, name: row.p_name, base_url: row.p_base_url,
    tier: row.p_tier, regions: row.p_regions, api_key_ref: row.p_api_key_ref,
    enabled: row.p_enabled, created_at: row.p_created_at, updated_at: row.p_updated_at,
  };
  const route: CdnRoute = {
    id: row.r_id, provider_id: row.r_provider_id, video_id: row.r_video_id,
    region: row.r_region, path_prefix: row.r_path_prefix, priority: row.r_priority,
    enabled: row.r_enabled, created_at: row.r_created_at, updated_at: row.r_updated_at,
  };
  const prefix = route.path_prefix ?? '';
  const url = `${provider.base_url.replace(/\/$/, '')}${prefix}/${videoId}`;
  return { provider, route, url };
}

export function resolveAllCdns(videoId: string, region?: string): ResolvedCdn[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT r.*, p.id AS p_id, p.kind AS p_kind, p.name AS p_name, p.base_url AS p_base_url,
           p.tier AS p_tier, p.regions AS p_regions, p.api_key_ref AS p_api_key_ref,
           p.enabled AS p_enabled, p.created_at AS p_created_at, p.updated_at AS p_updated_at,
           r.id AS r_id, r.provider_id AS r_provider_id, r.video_id AS r_video_id,
           r.region AS r_region, r.path_prefix AS r_path_prefix, r.priority AS r_priority,
           r.enabled AS r_enabled, r.created_at AS r_created_at, r.updated_at AS r_updated_at
    FROM cdn_routes r
    JOIN cdn_providers p ON p.id = r.provider_id
    WHERE r.enabled = 1 AND p.enabled = 1
      AND (r.video_id IS NULL OR r.video_id = ?)
      AND (r.region IS NULL OR r.region = ?)
    ORDER BY r.priority ASC
  `).all(videoId, region ?? '') as any[];
  return rows.map(row => {
    const provider: CdnProvider = {
      id: row.p_id, kind: row.p_kind, name: row.p_name, base_url: row.p_base_url,
      tier: row.p_tier, regions: row.p_regions, api_key_ref: row.p_api_key_ref,
      enabled: row.p_enabled, created_at: row.p_created_at, updated_at: row.p_updated_at,
    };
    const route: CdnRoute = {
      id: row.r_id, provider_id: row.r_provider_id, video_id: row.r_video_id,
      region: row.r_region, path_prefix: row.r_path_prefix, priority: row.r_priority,
      enabled: row.r_enabled, created_at: row.r_created_at, updated_at: row.r_updated_at,
    };
    const prefix = route.path_prefix ?? '';
    const url = `${provider.base_url.replace(/\/$/, '')}${prefix}/${videoId}`;
    return { provider, route, url };
  });
}

// ---------- Stats ----------
export interface CdnStats {
  total_providers: number;
  enabled_providers: number;
  by_tier: Record<string, number>;
  by_kind: Record<string, number>;
  total_routes: number;
  healthy_providers: number;
  unhealthy_providers: number;
}

export function getCdnStats(): CdnStats {
  const db = getDb();
  const prov = db.prepare('SELECT * FROM cdn_providers').all() as CdnProvider[];
  const byTier: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  let healthy = 0, unhealthy = 0;
  for (const p of prov) {
    byTier[p.tier] = (byTier[p.tier] ?? 0) + 1;
    byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
    const h = getLatestHealth(p.id);
    if (!h) continue;
    if (h.status === 'ok' || h.status === 'healthy') healthy++;
    else if (h.status === 'down' || h.status === 'error') unhealthy++;
  }
  const routes = db.prepare('SELECT COUNT(*) AS c FROM cdn_routes').get() as { c: number };
  return {
    total_providers: prov.length,
    enabled_providers: prov.filter(p => p.enabled === 1).length,
    by_tier: byTier,
    by_kind: byKind,
    total_routes: routes.c,
    healthy_providers: healthy,
    unhealthy_providers: unhealthy,
  };
}
