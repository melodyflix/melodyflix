// melodyflix videos — Merchandise Store (10.7) + Affiliate (10.8)

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export function ensureMerchSchema(): void {
  const db = getDb();
  db.exec(`
    -- 10.7 Merch shelf items (external store links)
    CREATE TABLE IF NOT EXISTS merch_items (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      image_url TEXT,
      product_url TEXT NOT NULL,
      price REAL,
      currency TEXT NOT NULL DEFAULT 'USD',
      category TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_merch_owner
      ON merch_items(owner_id, position);
    CREATE INDEX IF NOT EXISTS idx_merch_channel
      ON merch_items(channel_id, position);

    -- Click-through analytics for merch items
    CREATE TABLE IF NOT EXISTS merch_clicks (
      id TEXT PRIMARY KEY,
      merch_id TEXT NOT NULL,
      user_id TEXT,
      referrer_video_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_merch_clicks_item
      ON merch_clicks(merch_id, created_at DESC);

    -- 10.8 Affiliate links
    CREATE TABLE IF NOT EXISTS affiliate_links (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      label TEXT NOT NULL,
      target_url TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_affiliate_owner
      ON affiliate_links(owner_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_affiliate_slug ON affiliate_links(slug);

    -- Affiliate click events
    CREATE TABLE IF NOT EXISTS affiliate_clicks (
      id TEXT PRIMARY KEY,
      link_id TEXT NOT NULL,
      user_id TEXT,
      referrer_video_id TEXT,
      ip_hash TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_link
      ON affiliate_clicks(link_id, created_at DESC);
  `);
}

// ============================================================
// 10.7 Merch items
// ============================================================

export interface MerchItem {
  id: string;
  owner_id: string;
  channel_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  product_url: string;
  price: number | null;
  currency: string;
  category: string | null;
  position: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CreateMerchInput {
  owner_id: string;
  channel_id: string;
  name: string;
  description?: string | null;
  image_url?: string | null;
  product_url: string;
  price?: number | null;
  currency?: string;
  category?: string | null;
  position?: number;
}

const MAX_ITEMS_PER_CHANNEL = 12;

export function createMerchItem(input: CreateMerchInput): MerchItem {
  const name = (input.name ?? '').trim();
  if (name.length < 1 || name.length > 120) throw new Error('Name must be 1-120 chars');
  if (!/^https?:\/\//i.test(input.product_url)) throw new Error('product_url must be http(s)');
  if (input.price !== undefined && input.price !== null) {
    if (input.price < 0 || input.price > 1_000_000) throw new Error('price out of range');
  }

  const db = getDb();
  const count = (db.prepare(
    'SELECT COUNT(*) as n FROM merch_items WHERE channel_id = ? AND is_active = 1'
  ).get(input.channel_id) as { n: number }).n;
  if (count >= MAX_ITEMS_PER_CHANNEL) throw new Error(`Max ${MAX_ITEMS_PER_CHANNEL} merch items per channel`);

  const id = randomUUID();
  const now = new Date().toISOString();
  const pos = input.position ?? count;
  db.prepare(`
    INSERT INTO merch_items
      (id, owner_id, channel_id, name, description, image_url, product_url,
       price, currency, category, position, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id, input.owner_id, input.channel_id, name,
    input.description ?? null, input.image_url ?? null, input.product_url,
    input.price ?? null, (input.currency ?? 'USD').toUpperCase().slice(0,3),
    input.category ?? null, pos, now, now,
  );
  return getMerchItem(id)!;
}

export function getMerchItem(id: string): MerchItem | null {
  return (getDb().prepare('SELECT * FROM merch_items WHERE id = ?').get(id) as MerchItem | undefined) ?? null;
}

export function listMerchByChannel(channelId: string, includeInactive = false): MerchItem[] {
  const where = includeInactive ? 'channel_id = ?' : 'channel_id = ? AND is_active = 1';
  return getDb().prepare(
    `SELECT * FROM merch_items WHERE ${where} ORDER BY position ASC, created_at ASC`
  ).all(channelId) as MerchItem[];
}

export function listMerchByOwner(ownerId: string, limit = 100): MerchItem[] {
  const n = Math.min(Math.max(limit, 1), 500);
  return getDb().prepare(
    'SELECT * FROM merch_items WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(ownerId, n) as MerchItem[];
}

export interface UpdateMerchInput {
  name?: string;
  description?: string | null;
  image_url?: string | null;
  product_url?: string;
  price?: number | null;
  currency?: string;
  category?: string | null;
  position?: number;
  is_active?: boolean;
}

export function updateMerchItem(id: string, ownerId: string, patch: UpdateMerchInput): MerchItem | null {
  const cur = getMerchItem(id);
  if (!cur) return null;
  if (cur.owner_id !== ownerId) throw new Error('Not your item');
  if (patch.product_url && !/^https?:\/\//i.test(patch.product_url)) {
    throw new Error('product_url must be http(s)');
  }

  const fields: string[] = [];
  const values: any[] = [];
  const map: Record<string, any> = {
    name: patch.name,
    description: patch.description,
    image_url: patch.image_url,
    product_url: patch.product_url,
    price: patch.price,
    currency: patch.currency ? patch.currency.toUpperCase().slice(0,3) : undefined,
    category: patch.category,
    position: patch.position,
    is_active: patch.is_active === undefined ? undefined : (patch.is_active ? 1 : 0),
  };
  for (const [k, v] of Object.entries(map)) {
    if (v === undefined) continue;
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (fields.length === 0) return cur;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  getDb().prepare(`UPDATE merch_items SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getMerchItem(id);
}

export function deleteMerchItem(id: string, ownerId: string): boolean {
  const cur = getMerchItem(id);
  if (!cur) return false;
  if (cur.owner_id !== ownerId) throw new Error('Not your item');
  return getDb().prepare('DELETE FROM merch_items WHERE id = ?').run(id).changes > 0;
}

export function reorderMerch(channelId: string, ownerId: string, orderedIds: string[]): MerchItem[] {
  const db = getDb();
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    const upd = db.prepare('UPDATE merch_items SET position = ?, updated_at = ? WHERE id = ? AND channel_id = ? AND owner_id = ?');
    orderedIds.forEach((id, idx) => upd.run(idx, now, id, channelId, ownerId));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return listMerchByChannel(channelId, true);
}

export function recordMerchClick(input: {
  merch_id: string;
  user_id?: string | null;
  referrer_video_id?: string | null;
}): void {
  const item = getMerchItem(input.merch_id);
  if (!item) throw new Error('Merch item not found');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO merch_clicks (id, merch_id, user_id, referrer_video_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    randomUUID(), input.merch_id,
    input.user_id ?? null, input.referrer_video_id ?? null, now,
  );
}

export interface MerchItemStats {
  merch_id: string;
  total_clicks: number;
  unique_users: number;
  clicks_30d: number;
}

export function getMerchItemStats(id: string): MerchItemStats {
  const db = getDb();
  const totals = db.prepare(`
    SELECT COUNT(*) as n, COUNT(DISTINCT user_id) as users FROM merch_clicks WHERE merch_id = ?
  `).get(id) as any;
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
  const r30 = db.prepare(
    'SELECT COUNT(*) as n FROM merch_clicks WHERE merch_id = ? AND created_at >= ?'
  ).get(id, cutoff) as { n: number };
  return {
    merch_id: id,
    total_clicks: totals.n ?? 0,
    unique_users: totals.users ?? 0,
    clicks_30d: r30.n ?? 0,
  };
}

// ============================================================
// 10.8 Affiliate links
// ============================================================

export interface AffiliateLink {
  id: string;
  owner_id: string;
  label: string;
  target_url: string;
  slug: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CreateAffiliateInput {
  owner_id: string;
  label: string;
  target_url: string;
  slug?: string;
}

const SLUG_RE = /^[a-zA-Z0-9_-]{3,40}$/;

function randomSlug(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function createAffiliateLink(input: CreateAffiliateInput): AffiliateLink {
  const label = (input.label ?? '').trim();
  if (label.length < 1 || label.length > 80) throw new Error('Label must be 1-80 chars');
  if (!/^https?:\/\//i.test(input.target_url)) throw new Error('target_url must be http(s)');

  const slug = input.slug ?? randomSlug();
  if (!SLUG_RE.test(slug)) throw new Error('slug must be 3-40 chars A-Z, 0-9, -, _');

  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  try {
    db.prepare(`
      INSERT INTO affiliate_links
        (id, owner_id, label, target_url, slug, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, input.owner_id, label, input.target_url, slug, now, now);
  } catch (e: any) {
    if (String(e?.message ?? '').includes('UNIQUE')) throw new Error('Slug already taken');
    throw e;
  }
  return getAffiliateLink(id)!;
}

export function getAffiliateLink(id: string): AffiliateLink | null {
  return (getDb().prepare('SELECT * FROM affiliate_links WHERE id = ?').get(id) as AffiliateLink | undefined) ?? null;
}

export function getAffiliateBySlug(slug: string): AffiliateLink | null {
  return (getDb().prepare('SELECT * FROM affiliate_links WHERE slug = ? COLLATE NOCASE').get(slug) as AffiliateLink | undefined) ?? null;
}

export function listAffiliateLinks(ownerId: string, limit = 100): AffiliateLink[] {
  const n = Math.min(Math.max(limit, 1), 500);
  return getDb().prepare(
    'SELECT * FROM affiliate_links WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(ownerId, n) as AffiliateLink[];
}

export interface UpdateAffiliateInput {
  label?: string;
  target_url?: string;
  is_active?: boolean;
}

export function updateAffiliateLink(id: string, ownerId: string, patch: UpdateAffiliateInput): AffiliateLink | null {
  const cur = getAffiliateLink(id);
  if (!cur) return null;
  if (cur.owner_id !== ownerId) throw new Error('Not your link');
  if (patch.target_url && !/^https?:\/\//i.test(patch.target_url)) {
    throw new Error('target_url must be http(s)');
  }
  const fields: string[] = [];
  const values: any[] = [];
  const map: Record<string, any> = {
    label: patch.label,
    target_url: patch.target_url,
    is_active: patch.is_active === undefined ? undefined : (patch.is_active ? 1 : 0),
  };
  for (const [k, v] of Object.entries(map)) {
    if (v === undefined) continue;
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (fields.length === 0) return cur;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  getDb().prepare(`UPDATE affiliate_links SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getAffiliateLink(id);
}

export function deleteAffiliateLink(id: string, ownerId: string): boolean {
  const cur = getAffiliateLink(id);
  if (!cur) return false;
  if (cur.owner_id !== ownerId) throw new Error('Not your link');
  return getDb().prepare('DELETE FROM affiliate_links WHERE id = ?').run(id).changes > 0;
}

// Redirect resolver (records a click and returns the target URL)
export interface AffiliateRedirect {
  ok: boolean;
  target_url: string | null;
  reason?: 'not_found' | 'inactive';
}

export function resolveAffiliateRedirect(slug: string, ctx: {
  user_id?: string | null;
  referrer_video_id?: string | null;
  ip_hash?: string | null;
  user_agent?: string | null;
}): AffiliateRedirect {
  const link = getAffiliateBySlug(slug);
  if (!link) return { ok: false, target_url: null, reason: 'not_found' };
  if (link.is_active !== 1) return { ok: false, target_url: null, reason: 'inactive' };
  const db = getDb();
  db.prepare(`
    INSERT INTO affiliate_clicks
      (id, link_id, user_id, referrer_video_id, ip_hash, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), link.id,
    ctx.user_id ?? null, ctx.referrer_video_id ?? null,
    ctx.ip_hash ?? null, ctx.user_agent ? ctx.user_agent.slice(0, 200) : null,
    new Date().toISOString(),
  );
  return { ok: true, target_url: link.target_url };
}

export interface AffiliateStats {
  link_id: string;
  total_clicks: number;
  unique_users: number;
  clicks_30d: number;
  top_referrers: { video_id: string; count: number }[];
}

export function getAffiliateStats(id: string): AffiliateStats {
  const db = getDb();
  const totals = db.prepare(`
    SELECT COUNT(*) as n, COUNT(DISTINCT user_id) as users
    FROM affiliate_clicks WHERE link_id = ?
  `).get(id) as any;
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
  const r30 = db.prepare(
    'SELECT COUNT(*) as n FROM affiliate_clicks WHERE link_id = ? AND created_at >= ?'
  ).get(id, cutoff) as { n: number };
  const topRefs = db.prepare(`
    SELECT referrer_video_id as video_id, COUNT(*) as count
    FROM affiliate_clicks WHERE link_id = ? AND referrer_video_id IS NOT NULL
    GROUP BY referrer_video_id ORDER BY count DESC LIMIT 10
  `).all(id) as { video_id: string; count: number }[];
  return {
    link_id: id,
    total_clicks: totals.n ?? 0,
    unique_users: totals.users ?? 0,
    clicks_30d: r30.n ?? 0,
    top_referrers: topRefs,
  };
}
