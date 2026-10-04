// melodyflix videos — Ads (creative) service
// Manages individual ad creatives associated with ad networks.
// Distinct from vast.service.ts (VAST tags + network definitions).
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type AdType = 'pre-roll' | 'mid-roll' | 'post-roll' | 'overlay' | 'banner';
export type AdStatus = 'active' | 'paused' | 'archived';

export interface Ad {
  id: string;
  network_id: string | null;
  name: string;
  type: AdType;
  media_url: string;
  click_url: string | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  status: AdStatus;
  weight: number;
  priority: number;
  impressions: number;
  clicks: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export function ensureAdsSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ads_creatives (
      id TEXT PRIMARY KEY,
      network_id TEXT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'pre-roll',
      media_url TEXT NOT NULL,
      click_url TEXT,
      duration_seconds INTEGER,
      width INTEGER,
      height INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      weight INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ads_network ON ads_creatives(network_id);
    CREATE INDEX IF NOT EXISTS idx_ads_type ON ads_creatives(type, status);
    CREATE INDEX IF NOT EXISTS idx_ads_status ON ads_creatives(status);
  `);
}

// ============================================================
// CRUD
// ============================================================

export function createAd(input: {
  name: string;
  type: AdType;
  media_url: string;
  network_id?: string | null;
  click_url?: string | null;
  duration_seconds?: number | null;
  width?: number | null;
  height?: number | null;
  weight?: number;
  priority?: number;
  created_by: string;
}): Ad {
  const name = (input.name ?? '').trim();
  if (name.length < 2 || name.length > 200) throw new Error('name must be 2-200 chars');
  if (!/^https?:\/\//i.test(input.media_url)) throw new Error('media_url must be http(s)');

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO ads_creatives (id, network_id, name, type, media_url, click_url,
      duration_seconds, width, height, status, weight, priority, impressions, clicks,
      created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 0, 0, ?, ?, ?)
  `).run(id, input.network_id ?? null, name, input.type, input.media_url,
    input.click_url ?? null, input.duration_seconds ?? null,
    input.width ?? null, input.height ?? null,
    Math.min(Math.max(input.weight ?? 1, 1), 100),
    Math.min(Math.max(input.priority ?? 0, 0), 100),
    input.created_by, now, now);
  return getAdById(id)!;
}

export function getAdById(id: string): Ad | null {
  return (getDb().prepare('SELECT * FROM ads_creatives WHERE id = ?').get(id) as Ad | undefined) ?? null;
}

export function listAds(opts: { network_id?: string; type?: AdType; status?: AdStatus; limit?: number; offset?: number } = {}): Ad[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const filters: string[] = [];
  const params: any[] = [];
  if (opts.network_id) { filters.push('network_id = ?'); params.push(opts.network_id); }
  if (opts.type) { filters.push('type = ?'); params.push(opts.type); }
  if (opts.status) { filters.push('status = ?'); params.push(opts.status); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  params.push(limit, offset);
  return db.prepare(
    `SELECT * FROM ads_creatives ${where} ORDER BY priority DESC, created_at DESC LIMIT ? OFFSET ?`
  ).all(...params) as Ad[];
}

export function updateAd(id: string, patch: {
  name?: string;
  type?: AdType;
  media_url?: string;
  click_url?: string | null;
  duration_seconds?: number | null;
  width?: number | null;
  height?: number | null;
  status?: AdStatus;
  weight?: number;
  priority?: number;
}): Ad {
  const db = getDb();
  const existing = getAdById(id);
  if (!existing) throw new Error('Ad not found');
  const fields: string[] = [];
  const params: any[] = [];
  const cols: Array<keyof typeof patch> = ['name', 'type', 'media_url', 'click_url',
    'duration_seconds', 'width', 'height', 'status', 'weight', 'priority'];
  for (const c of cols) {
    if (patch[c] !== undefined) {
      fields.push(`${c} = ?`);
      params.push(patch[c]);
    }
  }
  if (fields.length === 0) return existing;
  fields.push('updated_at = ?');
  params.push(new Date().toISOString(), id);
  db.prepare(`UPDATE ads_creatives SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getAdById(id)!;
}

export function deleteAd(id: string): boolean {
  return Number(getDb().prepare('DELETE FROM ads_creatives WHERE id = ?').run(id).changes ?? 0) > 0;
}

// ============================================================
// Stats
// ============================================================

export interface AdStats {
  ad_id: string;
  impressions: number;
  clicks: number;
  ctr: number;
}

export function getAdStats(adId: string): AdStats | null {
  const ad = getAdById(adId);
  if (!ad) return null;
  const ctr = ad.impressions > 0 ? (ad.clicks / ad.impressions) * 100 : 0;
  return { ad_id: ad.id, impressions: ad.impressions, clicks: ad.clicks, ctr: Number(ctr.toFixed(2)) };
}

export function recordImpression(adId: string): void {
  getDb().prepare('UPDATE ads_creatives SET impressions = impressions + 1, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), adId);
}

export function recordClick(adId: string): void {
  getDb().prepare('UPDATE ads_creatives SET clicks = clicks + 1, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), adId);
}

// ============================================================
// Selection — weighted random picker
// ============================================================

export function pickAdForType(type: AdType): Ad | null {
  const db = getDb();
  const candidates = db.prepare(`
    SELECT * FROM ads_creatives WHERE status = 'active' AND type = ?
    ORDER BY priority DESC LIMIT 20
  `).all(type) as Ad[];
  if (candidates.length === 0) return null;
  const totalWeight = candidates.reduce((s, a) => s + Math.max(a.weight, 1), 0);
  let roll = Math.random() * totalWeight;
  for (const ad of candidates) {
    roll -= Math.max(ad.weight, 1);
    if (roll <= 0) return ad;
  }
  return candidates[0];
}
