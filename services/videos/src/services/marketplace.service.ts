// melodyflix videos - Section 15.4 Creator Marketplace
// Service listings (editing/thumbnail/music/etc), order workflow,
// delivery + revision loop, reviews, and per-order messaging.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type ListingCategory = 'thumbnail' | 'editing' | 'music' | 'voiceover' | 'animation' | 'subtitle' | 'promo' | 'other';
export type ListingStatus = 'draft' | 'active' | 'paused' | 'archived';
export type OrderStatus = 'pending' | 'in_progress' | 'delivered' | 'revision' | 'completed' | 'cancelled' | 'disputed';

const CATEGORIES: ListingCategory[] = ['thumbnail','editing','music','voiceover','animation','subtitle','promo','other'];
const L_STATUSES: ListingStatus[] = ['draft','active','paused','archived'];
const O_STATUSES: OrderStatus[] = ['pending','in_progress','delivered','revision','completed','cancelled','disputed'];

export function ensureMarketplaceSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS marketplace_listings (
      id TEXT PRIMARY KEY,
      creator_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL DEFAULT 'other',
      price_cents INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      delivery_days INTEGER NOT NULL DEFAULT 3,
      revisions INTEGER NOT NULL DEFAULT 1,
      tags TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft',
      rating_avg REAL NOT NULL DEFAULT 0,
      rating_count INTEGER NOT NULL DEFAULT 0,
      orders_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mkt_listing_creator ON marketplace_listings(creator_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mkt_listing_cat ON marketplace_listings(category, status, price_cents);

    CREATE TABLE IF NOT EXISTS marketplace_orders (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL,
      buyer_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      requirements TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      revision_count INTEGER NOT NULL DEFAULT 0,
      deadline_at TEXT,
      delivered_at TEXT,
      completed_at TEXT,
      cancelled_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mkt_order_buyer ON marketplace_orders(buyer_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mkt_order_seller ON marketplace_orders(seller_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mkt_order_listing ON marketplace_orders(listing_id, status);

    CREATE TABLE IF NOT EXISTS marketplace_reviews (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      reviewer_id TEXT NOT NULL,
      reviewee_id TEXT NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (order_id, reviewer_id)
    );
    CREATE INDEX IF NOT EXISTS idx_mkt_review_reviewee ON marketplace_reviews(reviewee_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS marketplace_messages (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mkt_msg_order ON marketplace_messages(order_id, created_at DESC);
  `);
}

export interface MarketplaceListing {
  id: string;
  creator_id: string;
  title: string;
  description: string | null;
  category: ListingCategory;
  price_cents: number;
  currency: string;
  delivery_days: number;
  revisions: number;
  tags: string;
  status: ListingStatus;
  rating_avg: number;
  rating_count: number;
  orders_count: number;
  created_at: string;
  updated_at: string;
}

export interface MarketplaceOrder {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  price_cents: number;
  currency: string;
  requirements: string | null;
  status: OrderStatus;
  revision_count: number;
  deadline_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MarketplaceReview {
  id: string;
  order_id: string;
  reviewer_id: string;
  reviewee_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export interface MarketplaceMessage {
  id: string;
  order_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

// ---------- listings ----------
export interface CreateListingInput {
  creator_id: string;
  title: string;
  description?: string | null;
  category?: ListingCategory;
  price_cents?: number;
  currency?: string;
  delivery_days?: number;
  revisions?: number;
  tags?: string[];
  status?: ListingStatus;
}

export function createListing(input: CreateListingInput): MarketplaceListing {
  if (!input.title || input.title.length > 200) throw new Error('invalid_title');
  if (!input.creator_id) throw new Error('creator_required');
  const cat = input.category ?? 'other';
  if (!CATEGORIES.includes(cat)) throw new Error('invalid_category');
  const status = input.status ?? 'draft';
  if (!L_STATUSES.includes(status)) throw new Error('invalid_status');
  if (input.price_cents !== undefined && (input.price_cents < 0 || input.price_cents > 100_000_000)) {
    throw new Error('invalid_price');
  }
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO marketplace_listings
      (id, creator_id, title, description, category, price_cents, currency, delivery_days, revisions,
       tags, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.creator_id, input.title, input.description ?? null, cat,
    input.price_cents ?? 0, input.currency ?? 'USD', input.delivery_days ?? 3,
    input.revisions ?? 1, JSON.stringify(input.tags ?? []), status, now, now);
  return getListing(id)!;
}

export function getListing(id: string): MarketplaceListing | null {
  return (getDb().prepare('SELECT * FROM marketplace_listings WHERE id = ?').get(id) as MarketplaceListing | undefined) ?? null;
}

export function listListings(filter?: {
  creator_id?: string;
  category?: ListingCategory;
  status?: ListingStatus;
  min_price?: number;
  max_price?: number;
  limit?: number;
}): MarketplaceListing[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter?.creator_id) { where.push('creator_id = ?'); args.push(filter.creator_id); }
  if (filter?.category) { where.push('category = ?'); args.push(filter.category); }
  if (filter?.status) { where.push('status = ?'); args.push(filter.status); }
  if (filter?.min_price !== undefined) { where.push('price_cents >= ?'); args.push(filter.min_price); }
  if (filter?.max_price !== undefined) { where.push('price_cents <= ?'); args.push(filter.max_price); }
  const sql = `SELECT * FROM marketplace_listings ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY updated_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args) as MarketplaceListing[];
}

export interface UpdateListingInput {
  title?: string;
  description?: string | null;
  category?: ListingCategory;
  price_cents?: number;
  currency?: string;
  delivery_days?: number;
  revisions?: number;
  tags?: string[];
  status?: ListingStatus;
}

export function updateListing(id: string, actorId: string, patch: UpdateListingInput): MarketplaceListing | null {
  const l = getListing(id);
  if (!l) return null;
  if (l.creator_id !== actorId) throw new Error('creator_only');
  const fields: string[] = [];
  const args: any[] = [];
  if (patch.title !== undefined) { fields.push('title = ?'); args.push(patch.title); }
  if (patch.description !== undefined) { fields.push('description = ?'); args.push(patch.description); }
  if (patch.category !== undefined) { if (!CATEGORIES.includes(patch.category)) throw new Error('invalid_category'); fields.push('category = ?'); args.push(patch.category); }
  if (patch.price_cents !== undefined) { if (patch.price_cents < 0) throw new Error('invalid_price'); fields.push('price_cents = ?'); args.push(patch.price_cents); }
  if (patch.currency !== undefined) { fields.push('currency = ?'); args.push(patch.currency); }
  if (patch.delivery_days !== undefined) { fields.push('delivery_days = ?'); args.push(patch.delivery_days); }
  if (patch.revisions !== undefined) { fields.push('revisions = ?'); args.push(patch.revisions); }
  if (patch.tags !== undefined) { fields.push('tags = ?'); args.push(JSON.stringify(patch.tags)); }
  if (patch.status !== undefined) { if (!L_STATUSES.includes(patch.status)) throw new Error('invalid_status'); fields.push('status = ?'); args.push(patch.status); }
  if (!fields.length) return l;
  fields.push('updated_at = ?'); args.push(new Date().toISOString());
  args.push(id);
  getDb().prepare(`UPDATE marketplace_listings SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  return getListing(id);
}

export function deleteListing(id: string, actorId: string): boolean {
  const l = getListing(id);
  if (!l) return false;
  if (l.creator_id !== actorId) throw new Error('creator_only');
  const db = getDb();
  const orders = db.prepare("SELECT COUNT(*) AS c FROM marketplace_orders WHERE listing_id = ? AND status NOT IN ('completed','cancelled')")
    .get(id) as { c: number };
  if (orders.c > 0) throw new Error('has_open_orders');
  // archive instead of hard delete
  db.prepare("UPDATE marketplace_listings SET status = 'archived', updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
  return true;
}

// ---------- orders ----------
export interface CreateOrderInput {
  listing_id: string;
  buyer_id: string;
  requirements?: string | null;
  deadline_days?: number;
}

export function createOrder(input: CreateOrderInput): MarketplaceOrder {
  const l = getListing(input.listing_id);
  if (!l) throw new Error('listing_not_found');
  if (l.status !== 'active') throw new Error('listing_not_active');
  if (l.creator_id === input.buyer_id) throw new Error('cannot_buy_own_listing');
  const db = getDb();
  const now = new Date();
  const deadline = new Date(now.getTime() + (input.deadline_days ?? l.delivery_days) * 86400_000).toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO marketplace_orders
      (id, listing_id, buyer_id, seller_id, price_cents, currency, requirements, status,
       revision_count, deadline_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
  `).run(id, l.id, input.buyer_id, l.creator_id, l.price_cents, l.currency,
    input.requirements ?? null, deadline, now.toISOString(), now.toISOString());
  db.prepare('UPDATE marketplace_listings SET orders_count = orders_count + 1, updated_at = ? WHERE id = ?')
    .run(now.toISOString(), l.id);
  return getOrder(id)!;
}

export function getOrder(id: string): MarketplaceOrder | null {
  return (getDb().prepare('SELECT * FROM marketplace_orders WHERE id = ?').get(id) as MarketplaceOrder | undefined) ?? null;
}

export function listOrders(filter?: { buyer_id?: string; seller_id?: string; listing_id?: string; status?: OrderStatus; limit?: number }): MarketplaceOrder[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter?.buyer_id) { where.push('buyer_id = ?'); args.push(filter.buyer_id); }
  if (filter?.seller_id) { where.push('seller_id = ?'); args.push(filter.seller_id); }
  if (filter?.listing_id) { where.push('listing_id = ?'); args.push(filter.listing_id); }
  if (filter?.status) { where.push('status = ?'); args.push(filter.status); }
  const sql = `SELECT * FROM marketplace_orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args) as MarketplaceOrder[];
}

function assertParticipant(order: MarketplaceOrder, actorId: string) {
  if (order.buyer_id !== actorId && order.seller_id !== actorId) throw new Error('not_participant');
}

export function updateOrderStatus(orderId: string, actorId: string, next: OrderStatus): MarketplaceOrder {
  const o = getOrder(orderId);
  if (!o) throw new Error('order_not_found');
  assertParticipant(o, actorId);
  if (!O_STATUSES.includes(next)) throw new Error('invalid_status');
  if (o.status === 'completed' || o.status === 'cancelled') throw new Error('terminal_state');
  const now = new Date().toISOString();
  const db = getDb();
  const patch: any = { status: next };
  if (next === 'delivered') patch.delivered_at = now;
  if (next === 'completed') patch.completed_at = now;
  if (next === 'cancelled') patch.cancelled_at = now;
  if (next === 'revision') patch.revision_count = o.revision_count + 1;
  const fields = Object.keys(patch).map(k => `${k} = ?`);
  const values = Object.values(patch);
  fields.push('updated_at = ?'); values.push(now);
  values.push(orderId);
  db.prepare(`UPDATE marketplace_orders SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getOrder(orderId)!;
}

export function deliverOrder(orderId: string, actorId: string): MarketplaceOrder {
  const o = getOrder(orderId);
  if (!o) throw new Error('order_not_found');
  if (o.seller_id !== actorId) throw new Error('seller_only');
  return updateOrderStatus(orderId, actorId, 'delivered');
}

export function completeOrder(orderId: string, actorId: string): MarketplaceOrder {
  const o = getOrder(orderId);
  if (!o) throw new Error('order_not_found');
  if (o.buyer_id !== actorId) throw new Error('buyer_only');
  return updateOrderStatus(orderId, actorId, 'completed');
}

export function cancelOrder(orderId: string, actorId: string): MarketplaceOrder {
  return updateOrderStatus(orderId, actorId, 'cancelled');
}

export function openDispute(orderId: string, actorId: string): MarketplaceOrder {
  return updateOrderStatus(orderId, actorId, 'disputed');
}

// ---------- reviews ----------
export interface ReviewInput {
  order_id: string;
  reviewer_id: string;
  rating: number;
  comment?: string | null;
}

export function addReview(input: ReviewInput): MarketplaceReview {
  if (input.rating < 1 || input.rating > 5) throw new Error('invalid_rating');
  const o = getOrder(input.order_id);
  if (!o) throw new Error('order_not_found');
  if (o.status !== 'completed') throw new Error('order_not_completed');
  if (o.buyer_id !== input.reviewer_id && o.seller_id !== input.reviewer_id) throw new Error('not_participant');
  const reviewee = o.buyer_id === input.reviewer_id ? o.seller_id : o.buyer_id;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM marketplace_reviews WHERE order_id = ? AND reviewer_id = ?')
    .get(input.order_id, input.reviewer_id) as MarketplaceReview | undefined;
  if (existing) throw new Error('already_reviewed');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO marketplace_reviews (id, order_id, reviewer_id, reviewee_id, rating, comment, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.order_id, input.reviewer_id, reviewee, input.rating, input.comment ?? null, now);
  // update listing rating
  const agg = db.prepare(`
    SELECT AVG(r.rating) AS a, COUNT(*) AS c
    FROM marketplace_reviews r
    JOIN marketplace_orders o ON o.id = r.order_id
    WHERE o.listing_id = ? AND r.reviewee_id = ?
  `).get(o.listing_id, reviewee) as { a: number | null; c: number };
  db.prepare('UPDATE marketplace_listings SET rating_avg = ?, rating_count = ? WHERE id = ?')
    .run(agg.a ?? 0, agg.c, o.listing_id);
  return db.prepare('SELECT * FROM marketplace_reviews WHERE id = ?').get(id) as MarketplaceReview;
}

export function listReviews(filter?: { reviewee_id?: string; order_id?: string; limit?: number }): MarketplaceReview[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter?.reviewee_id) { where.push('reviewee_id = ?'); args.push(filter.reviewee_id); }
  if (filter?.order_id) { where.push('order_id = ?'); args.push(filter.order_id); }
  const sql = `SELECT * FROM marketplace_reviews ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args) as MarketplaceReview[];
}

// ---------- messages ----------
export function sendMessage(orderId: string, senderId: string, body: string): MarketplaceMessage {
  if (!body || body.length > 4000) throw new Error('invalid_body');
  const o = getOrder(orderId);
  if (!o) throw new Error('order_not_found');
  if (o.buyer_id !== senderId && o.seller_id !== senderId) throw new Error('not_participant');
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO marketplace_messages (id, order_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, orderId, senderId, body, now);
  return db.prepare('SELECT * FROM marketplace_messages WHERE id = ?').get(id) as MarketplaceMessage;
}

export function listMessages(orderId: string, limit = 200): MarketplaceMessage[] {
  return getDb().prepare('SELECT * FROM marketplace_messages WHERE order_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(orderId, Math.min(Math.max(limit, 1), 1000)) as MarketplaceMessage[];
}

// ---------- summary + stats ----------
export interface ListingSummary {
  listing: MarketplaceListing;
  open_orders: number;
  completed_orders: number;
  reviews: MarketplaceReview[];
}

export function getListingSummary(listingId: string): ListingSummary | null {
  const l = getListing(listingId);
  if (!l) return null;
  const db = getDb();
  const open = db.prepare(`SELECT COUNT(*) AS c FROM marketplace_orders
    WHERE listing_id = ? AND status NOT IN ('completed','cancelled')`).get(listingId) as { c: number };
  const done = db.prepare("SELECT COUNT(*) AS c FROM marketplace_orders WHERE listing_id = ? AND status = 'completed'")
    .get(listingId) as { c: number };
  return {
    listing: l,
    open_orders: open.c,
    completed_orders: done.c,
    reviews: listReviews({ limit: 20 }),
  };
}

export interface MarketplaceStats {
  total_listings: number;
  active_listings: number;
  by_category: Record<string, number>;
  total_orders: number;
  orders_by_status: Record<string, number>;
  total_reviews: number;
  avg_rating: number;
  gmv_cents: number;
}

export function getMarketplaceStats(): MarketplaceStats {
  const db = getDb();
  const listings = db.prepare('SELECT category, status FROM marketplace_listings').all() as
    { category: string; status: string }[];
  const byCat: Record<string, number> = {};
  let active = 0;
  for (const l of listings) {
    byCat[l.category] = (byCat[l.category] ?? 0) + 1;
    if (l.status === 'active') active++;
  }
  const orders = db.prepare('SELECT status, price_cents FROM marketplace_orders').all() as
    { status: string; price_cents: number }[];
  const byStatus: Record<string, number> = {};
  let gmv = 0;
  for (const o of orders) {
    byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    if (o.status === 'completed') gmv += o.price_cents;
  }
  const revs = db.prepare('SELECT rating FROM marketplace_reviews').all() as { rating: number }[];
  const avg = revs.length ? revs.reduce((s, r) => s + r.rating, 0) / revs.length : 0;
  return {
    total_listings: listings.length,
    active_listings: active,
    by_category: byCat,
    total_orders: orders.length,
    orders_by_status: byStatus,
    total_reviews: revs.length,
    avg_rating: avg,
    gmv_cents: gmv,
  };
}
