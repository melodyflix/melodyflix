// melodyflix videos — Paid Content: PPV + Rent/Buy (10.5, 10.6)

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type PaidContentType = 'ppv' | 'rent' | 'buy';
export type PurchaseState = 'active' | 'expired' | 'revoked' | 'refunded';

export function ensurePaidContentSchema(): void {
  const db = getDb();
  db.exec(`
    -- 10.5 / 10.6 pricing per video
    CREATE TABLE IF NOT EXISTS paid_content (
      video_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('ppv','rent','buy')),
      price REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      rental_hours INTEGER,             -- required for 'rent'
      purchase_window_hours INTEGER,    -- optional: for limited buy windows
      is_active INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_paid_content_owner
      ON paid_content(owner_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_paid_content_active
      ON paid_content(is_active, type);

    -- Purchase / rental records
    CREATE TABLE IF NOT EXISTS content_purchases (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('ppv','rent','buy')),
      amount_paid REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      transaction_id TEXT,
      state TEXT NOT NULL DEFAULT 'active'
        CHECK (state IN ('active','expired','revoked','refunded')),
      starts_at TEXT NOT NULL,
      expires_at TEXT,                  -- null = permanent (ppv/buy without window)
      first_played_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (video_id, user_id, type)
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_user
      ON content_purchases(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_purchase_video
      ON content_purchases(video_id, state);
  `);
}

// ============================================================
// Pricing configuration (owner side)
// ============================================================

export interface PaidContent {
  video_id: string;
  owner_id: string;
  type: PaidContentType;
  price: number;
  currency: string;
  rental_hours: number | null;
  purchase_window_hours: number | null;
  is_active: number;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface SetPricingInput {
  video_id: string;
  owner_id: string;
  type: PaidContentType;
  price: number;
  currency?: string;
  rental_hours?: number | null;
  purchase_window_hours?: number | null;
  description?: string | null;
}

const MIN_PRICE = 0.5;
const MAX_PRICE = 10_000;

export function setPricing(input: SetPricingInput): PaidContent {
  // Video ownership check
  const db = getDb();
  const v = db.prepare('SELECT owner_id FROM videos WHERE id = ?')
    .get(input.video_id) as { owner_id: string } | undefined;
  if (!v) throw new Error('Video not found');
  if (v.owner_id !== input.owner_id) throw new Error('Not your video');

  if (!Number.isFinite(input.price) || input.price < MIN_PRICE || input.price > MAX_PRICE) {
    throw new Error(`Price must be $${MIN_PRICE} - $${MAX_PRICE}`);
  }
  if (input.type === 'rent') {
    const rh = input.rental_hours ?? 48;
    if (rh < 1 || rh > 720) throw new Error('rental_hours must be 1-720 (30 days max)');
  }
  if (input.purchase_window_hours !== undefined && input.purchase_window_hours !== null) {
    if (input.purchase_window_hours < 1 || input.purchase_window_hours > 24 * 365) {
      throw new Error('purchase_window_hours out of range');
    }
  }

  const currency = (input.currency ?? 'USD').toUpperCase().slice(0, 3);
  const rentalHours = input.type === 'rent' ? (input.rental_hours ?? 48) : null;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO paid_content
      (video_id, owner_id, type, price, currency, rental_hours,
       purchase_window_hours, is_active, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(video_id) DO UPDATE SET
      type = excluded.type,
      price = excluded.price,
      currency = excluded.currency,
      rental_hours = excluded.rental_hours,
      purchase_window_hours = excluded.purchase_window_hours,
      is_active = 1,
      description = excluded.description,
      updated_at = excluded.updated_at
  `).run(
    input.video_id, input.owner_id, input.type, input.price, currency,
    rentalHours, input.purchase_window_hours ?? null,
    input.description ?? null, now, now
  );
  return getPricing(input.video_id)!;
}

export function getPricing(videoId: string): PaidContent | null {
  return (getDb().prepare('SELECT * FROM paid_content WHERE video_id = ?')
    .get(videoId) as PaidContent | undefined) ?? null;
}

export function clearPricing(videoId: string, ownerId: string): boolean {
  const cur = getPricing(videoId);
  if (!cur) return false;
  if (cur.owner_id !== ownerId) throw new Error('Not your video');
  return getDb().prepare('DELETE FROM paid_content WHERE video_id = ?').run(videoId).changes > 0;
}

export function listPaidContentByOwner(ownerId: string, limit = 100): PaidContent[] {
  const n = Math.min(Math.max(limit, 1), 500);
  return getDb().prepare(
    'SELECT * FROM paid_content WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(ownerId, n) as PaidContent[];
}

export function listPaidContent(limit = 100, type?: PaidContentType): PaidContent[] {
  const n = Math.min(Math.max(limit, 1), 500);
  if (type) {
    return getDb().prepare(
      'SELECT * FROM paid_content WHERE is_active = 1 AND type = ? ORDER BY created_at DESC LIMIT ?'
    ).all(type, n) as PaidContent[];
  }
  return getDb().prepare(
    'SELECT * FROM paid_content WHERE is_active = 1 ORDER BY created_at DESC LIMIT ?'
  ).all(n) as PaidContent[];
}

// ============================================================
// Purchase (user side)
// ============================================================

export interface Purchase {
  id: string;
  video_id: string;
  user_id: string;
  type: PaidContentType;
  amount_paid: number;
  currency: string;
  transaction_id: string | null;
  state: PurchaseState;
  starts_at: string;
  expires_at: string | null;
  first_played_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseInput {
  video_id: string;
  user_id: string;
  transaction_id?: string | null;
}

export function purchase(input: PurchaseInput): Purchase {
  const db = getDb();
  const pricing = getPricing(input.video_id);
  if (!pricing) throw new Error('Content is not pay-per-view');
  if (pricing.is_active !== 1) throw new Error('Content is not currently for sale');
  if (pricing.owner_id === input.user_id) throw new Error('Cannot purchase your own content');

  // Buy-window (if any) still open?
  if (pricing.purchase_window_hours !== null && pricing.created_at) {
    const windowMs = pricing.purchase_window_hours * 3600_000;
    const createdMs = new Date(pricing.created_at).getTime();
    if (Date.now() > createdMs + windowMs) {
      throw new Error('Purchase window for this content has closed');
    }
  }

  // Existing purchase?
  const existing = db.prepare(
    'SELECT * FROM content_purchases WHERE video_id = ? AND user_id = ? AND type = ?'
  ).get(input.video_id, input.user_id, pricing.type) as Purchase | undefined;
  if (existing && existing.state === 'active') throw new Error('Already purchased');

  const now = new Date().toISOString();
  const id = randomUUID();

  let expiresAt: string | null = null;
  if (pricing.type === 'rent' && pricing.rental_hours) {
    expiresAt = new Date(Date.now() + pricing.rental_hours * 3600_000).toISOString();
  }

  db.prepare(`
    INSERT INTO content_purchases
      (id, video_id, user_id, type, amount_paid, currency, transaction_id,
       state, starts_at, expires_at, first_played_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, ?, ?)
    ON CONFLICT(video_id, user_id, type) DO UPDATE SET
      amount_paid = excluded.amount_paid,
      transaction_id = excluded.transaction_id,
      state = 'active',
      starts_at = excluded.starts_at,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).run(
    id, input.video_id, input.user_id, pricing.type,
    pricing.price, pricing.currency,
    input.transaction_id ?? null,
    now, expiresAt, now, now,
  );
  // After upsert the row may have retained its original id (conflict path).
  // Fetch by the natural key so the returned object matches the row on disk.
  return (db.prepare(
    'SELECT * FROM content_purchases WHERE video_id = ? AND user_id = ? AND type = ?'
  ).get(input.video_id, input.user_id, pricing.type) as Purchase) ?? null as any;
}

export function getPurchaseById(id: string): Purchase | null {
  return (getDb().prepare('SELECT * FROM content_purchases WHERE id = ?')
    .get(id) as Purchase | undefined) ?? null;
}

export function getActivePurchase(userId: string, videoId: string): Purchase | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM content_purchases
    WHERE user_id = ? AND video_id = ? AND state = 'active'
    ORDER BY created_at DESC LIMIT 1
  `).get(userId, videoId) as Purchase | undefined;
  if (!row) return null;
  // Check expiry
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare(`UPDATE content_purchases SET state = 'expired', updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), row.id);
    return null;
  }
  return row;
}

export function listMyPurchases(userId: string, limit = 100): Purchase[] {
  const n = Math.min(Math.max(limit, 1), 500);
  // Lazy-expire stale rentals
  const now = new Date().toISOString();
  getDb().prepare(`UPDATE content_purchases SET state = 'expired', updated_at = ?
    WHERE user_id = ? AND state = 'active' AND expires_at IS NOT NULL AND expires_at < ?`)
    .run(now, userId, now);
  return getDb().prepare(`
    SELECT * FROM content_purchases WHERE user_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(userId, n) as Purchase[];
}

export function markFirstPlayed(purchaseId: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`UPDATE content_purchases SET first_played_at = ?, updated_at = ?
    WHERE id = ? AND first_played_at IS NULL`).run(now, now, purchaseId);
}

export function revokePurchase(id: string, requesterId: string): boolean {
  const db = getDb();
  const p = getPurchaseById(id);
  if (!p) return false;
  // Owner of the content or the buyer can revoke
  const pricing = getPricing(p.video_id);
  if (p.user_id !== requesterId && pricing?.owner_id !== requesterId) {
    throw new Error('Not allowed');
  }
  const now = new Date().toISOString();
  return db.prepare(`UPDATE content_purchases SET state = 'revoked', updated_at = ? WHERE id = ?`)
    .run(now, id).changes > 0;
}

export function refundPurchase(id: string, requesterId: string): boolean {
  const db = getDb();
  const p = getPurchaseById(id);
  if (!p) return false;
  const pricing = getPricing(p.video_id);
  if (p.user_id !== requesterId && pricing?.owner_id !== requesterId) {
    throw new Error('Not allowed');
  }
  const now = new Date().toISOString();
  return db.prepare(`UPDATE content_purchases SET state = 'refunded', updated_at = ? WHERE id = ?`)
    .run(now, id).changes > 0;
}

// ============================================================
// Access check
// ============================================================

export interface AccessCheckInput {
  user_id: string | null;
  video_id: string;
}

export interface AccessCheckResult {
  can_watch: boolean;
  reason: 'free' | 'owner' | 'purchased' | 'purchase_required' | 'rental_expired' | 'not_for_sale';
  pricing: PaidContent | null;
  purchase: Purchase | null;
}

export function checkAccess(input: AccessCheckInput): AccessCheckResult {
  const pricing = getPricing(input.video_id);
  const db = getDb();
  const v = db.prepare('SELECT owner_id FROM videos WHERE id = ?')
    .get(input.video_id) as { owner_id: string } | undefined;
  if (!v) throw new Error('Video not found');

  // Free content
  if (!pricing || pricing.is_active !== 1) {
    return {
      can_watch: true, reason: 'free',
      pricing: pricing ?? null, purchase: null,
    };
  }

  // Owner always has access
  if (input.user_id && input.user_id === v.owner_id) {
    return {
      can_watch: true, reason: 'owner',
      pricing, purchase: null,
    };
  }

  // Anonymous
  if (!input.user_id) {
    return {
      can_watch: false, reason: 'purchase_required',
      pricing, purchase: null,
    };
  }

  const purchase = getActivePurchase(input.user_id, input.video_id);
  if (purchase) {
    return {
      can_watch: true, reason: 'purchased',
      pricing, purchase,
    };
  }

  // Was there an expired rental?
  const last = db.prepare(`
    SELECT * FROM content_purchases WHERE user_id = ? AND video_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(input.user_id, input.video_id) as Purchase | undefined;
  if (last && last.state === 'expired') {
    return {
      can_watch: false, reason: 'rental_expired',
      pricing, purchase: last,
    };
  }

  return {
    can_watch: false, reason: 'purchase_required',
    pricing, purchase: null,
  };
}

// ============================================================
// Stats
// ============================================================

export interface PaidContentStats {
  video_id: string;
  total_purchases: number;
  active_purchases: number;
  expired_purchases: number;
  total_revenue: number;
  type_breakdown: { type: string; count: number }[];
  last_30d_purchases: number;
  last_30d_revenue: number;
}

export function getPaidContentStats(videoId: string): PaidContentStats {
  const db = getDb();
  const totals = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN state='active'   THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN state='expired'  THEN 1 ELSE 0 END) as expired,
      COALESCE(SUM(CASE WHEN state IN ('active','expired') THEN amount_paid ELSE 0 END), 0) as revenue
    FROM content_purchases WHERE video_id = ?
  `).get(videoId) as any;
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
  const r30 = db.prepare(`
    SELECT COUNT(*) as n, COALESCE(SUM(amount_paid),0) as total
    FROM content_purchases WHERE video_id = ? AND created_at >= ?
      AND state IN ('active','expired')
  `).get(videoId, cutoff) as any;
  const byType = db.prepare(`
    SELECT type, COUNT(*) as count FROM content_purchases
    WHERE video_id = ? GROUP BY type
  `).all(videoId) as { type: string; count: number }[];
  return {
    video_id: videoId,
    total_purchases: totals.total ?? 0,
    active_purchases: totals.active ?? 0,
    expired_purchases: totals.expired ?? 0,
    total_revenue: totals.revenue ?? 0,
    type_breakdown: byType,
    last_30d_purchases: r30.n ?? 0,
    last_30d_revenue: r30.total ?? 0,
  };
}

// Expire rentals whose window passed — worker helper
export function expireRentals(nowIso = new Date().toISOString()): number {
  const r = getDb().prepare(`
    UPDATE content_purchases
    SET state = 'expired', updated_at = ?
    WHERE state = 'active' AND expires_at IS NOT NULL AND expires_at < ?
  `).run(nowIso, nowIso);
  return r.changes;
}
