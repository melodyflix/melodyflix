// melodyflix videos - Page Builder monetization (Section 43 Phase 4)
//
// Design/edit is free; downloading/publishing a built page requires
// payment. Price is dynamic based on page complexity + premium widgets.

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export function ensureBuilderBillingSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS builder_pricing_config (
      id TEXT PRIMARY KEY,
      base_price REAL NOT NULL DEFAULT 500,
      per_page REAL NOT NULL DEFAULT 200,
      per_element REAL NOT NULL DEFAULT 10,
      per_premium_widget REAL NOT NULL DEFAULT 50,
      complexity_multiplier REAL NOT NULL DEFAULT 1.0,
      currency TEXT NOT NULL DEFAULT 'BDT',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS builder_orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'BDT',
      breakdown_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      payment_transaction_id TEXT,
      download_token TEXT,
      download_expires_at TEXT,
      downloaded_at TEXT,
      download_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bo_user ON builder_orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_bo_page ON builder_orders(page_id);
    CREATE INDEX IF NOT EXISTS idx_bo_status ON builder_orders(status);
    CREATE INDEX IF NOT EXISTS idx_bo_token ON builder_orders(download_token);

    CREATE TABLE IF NOT EXISTS builder_marketplace (
      id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL,
      template_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'BDT',
      category TEXT,
      thumbnail_url TEXT,
      sales_count INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bm_seller ON builder_marketplace(seller_id);
    CREATE INDEX IF NOT EXISTS idx_bm_category ON builder_marketplace(category);
    CREATE INDEX IF NOT EXISTS idx_bm_active ON builder_marketplace(is_active);

    CREATE TABLE IF NOT EXISTS builder_marketplace_purchases (
      id TEXT PRIMARY KEY,
      buyer_id TEXT NOT NULL,
      listing_id TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'BDT',
      status TEXT NOT NULL DEFAULT 'pending',
      transaction_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bmp_buyer ON builder_marketplace_purchases(buyer_id);
    CREATE INDEX IF NOT EXISTS idx_bmp_listing ON builder_marketplace_purchases(listing_id);
  `);
}

// ---------- 43.17 Pricing config ----------

export interface BuilderPricingConfig {
  id: string;
  base_price: number;
  per_page: number;
  per_element: number;
  per_premium_widget: number;
  complexity_multiplier: number;
  currency: string;
  updated_at: string;
}

const PRICING_ID = 'default';

export function getPricingConfig(): BuilderPricingConfig {
  const db = getDb();
  const row = db.prepare('SELECT * FROM builder_pricing_config WHERE id = ?').get(PRICING_ID) as
    | { id: string; base_price: number; per_page: number; per_element: number;
        per_premium_widget: number; complexity_multiplier: number; currency: string; updated_at: string }
    | undefined;
  if (row) return row;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO builder_pricing_config (id, base_price, per_page, per_element, per_premium_widget, complexity_multiplier, currency, updated_at)
    VALUES (?, 500, 200, 10, 50, 1.0, 'BDT', ?)
  `).run(PRICING_ID, now);
  return getPricingConfig();
}

export interface SetPricingInput {
  base_price?: number;
  per_page?: number;
  per_element?: number;
  per_premium_widget?: number;
  complexity_multiplier?: number;
  currency?: string;
}

export function setPricingConfig(input: SetPricingInput): BuilderPricingConfig {
  const db = getDb();
  const cur = getPricingConfig();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE builder_pricing_config SET
      base_price = ?, per_page = ?, per_element = ?, per_premium_widget = ?,
      complexity_multiplier = ?, currency = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.base_price ?? cur.base_price,
    input.per_page ?? cur.per_page,
    input.per_element ?? cur.per_element,
    input.per_premium_widget ?? cur.per_premium_widget,
    input.complexity_multiplier ?? cur.complexity_multiplier,
    input.currency ?? cur.currency,
    now, PRICING_ID,
  );
  return getPricingConfig();
}

// ---------- Complexity scoring ----------

const PREMIUM_WIDGETS = new Set([
  'form', 'gallery', 'video', 'audio', 'tabs', 'accordion', 'toggle',
  'counter', 'progress', 'testimonial', 'social_icons', 'dyn_trending_grid',
  'dyn_content_type_grid',
]);

export interface ComplexityBreakdown {
  total_pages: number;
  total_elements: number;
  widget_count: number;
  container_count: number;
  premium_widget_count: number;
  unique_widget_types: number;
  complexity_score: number;    // 0-100
  base_price: number;
  page_component: number;
  element_component: number;
  premium_component: number;
  subtotal: number;
  total: number;
  currency: string;
}

export function computeComplexity(pageIds: string[]): ComplexityBreakdown {
  const db = getDb();
  const cfg = getPricingConfig();

  if (!pageIds.length) {
    return {
      total_pages: 0, total_elements: 0, widget_count: 0, container_count: 0,
      premium_widget_count: 0, unique_widget_types: 0, complexity_score: 0,
      base_price: cfg.base_price, page_component: 0, element_component: 0,
      premium_component: 0, subtotal: cfg.base_price, total: cfg.base_price,
      currency: cfg.currency,
    };
  }

  const placeholders = pageIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT element_type, widget_type FROM page_elements WHERE page_id IN (${placeholders})`
  ).all(...pageIds) as Array<{ element_type: string; widget_type: string | null }>;

  let widgetCount = 0;
  let containerCount = 0;
  let premiumCount = 0;
  const uniqueTypes = new Set<string>();
  for (const r of rows) {
    if (r.element_type === 'widget') {
      widgetCount++;
      if (r.widget_type) {
        uniqueTypes.add(r.widget_type);
        if (PREMIUM_WIDGETS.has(r.widget_type)) premiumCount++;
      }
    } else {
      containerCount++;
    }
  }

  const totalElements = rows.length;
  const uniqueWidgetTypes = uniqueTypes.size;

  // Complexity score: 0-100 — rough formula
  const score = Math.min(100, Math.round(
    (widgetCount * 2) +
    (premiumCount * 5) +
    (uniqueWidgetTypes * 3) +
    (pageIds.length * 5)
  ));

  const pageComponent = cfg.per_page * pageIds.length;
  const elementComponent = cfg.per_element * totalElements;
  const premiumComponent = cfg.per_premium_widget * premiumCount;
  const subtotal = cfg.base_price + pageComponent + elementComponent + premiumComponent;
  const total = Math.round(subtotal * cfg.complexity_multiplier * 100) / 100;

  return {
    total_pages: pageIds.length,
    total_elements: totalElements,
    widget_count: widgetCount,
    container_count: containerCount,
    premium_widget_count: premiumCount,
    unique_widget_types: uniqueWidgetTypes,
    complexity_score: score,
    base_price: cfg.base_price,
    page_component: pageComponent,
    element_component: elementComponent,
    premium_component: premiumComponent,
    subtotal,
    total,
    currency: cfg.currency,
  };
}

// ---------- 43.18 / 43.19 Orders ----------

export interface BuilderOrder {
  id: string;
  user_id: string;
  page_id: string;
  amount: number;
  currency: string;
  breakdown: ComplexityBreakdown;
  status: 'pending' | 'paid' | 'cancelled' | 'refunded';
  payment_transaction_id: string | null;
  download_token: string | null;
  download_expires_at: string | null;
  downloaded_at: string | null;
  download_count: number;
  created_at: string;
  updated_at: string;
}

interface BoRow {
  id: string; user_id: string; page_id: string; amount: number; currency: string;
  breakdown_json: string; status: string; payment_transaction_id: string | null;
  download_token: string | null; download_expires_at: string | null;
  downloaded_at: string | null; download_count: number;
  created_at: string; updated_at: string;
}

function boRowToObj(row: BoRow): BuilderOrder {
  let breakdown: ComplexityBreakdown;
  try { breakdown = JSON.parse(row.breakdown_json) as ComplexityBreakdown; }
  catch {
    breakdown = {
      total_pages: 0, total_elements: 0, widget_count: 0, container_count: 0,
      premium_widget_count: 0, unique_widget_types: 0, complexity_score: 0,
      base_price: 0, page_component: 0, element_component: 0, premium_component: 0,
      subtotal: 0, total: 0, currency: 'BDT',
    };
  }
  return {
    id: row.id, user_id: row.user_id, page_id: row.page_id,
    amount: row.amount, currency: row.currency, breakdown,
    status: row.status as BuilderOrder['status'],
    payment_transaction_id: row.payment_transaction_id,
    download_token: row.download_token,
    download_expires_at: row.download_expires_at,
    downloaded_at: row.downloaded_at,
    download_count: row.download_count,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

export function createBuilderOrder(userId: string, pageId: string): BuilderOrder {
  const db = getDb();
  const calc = computeComplexity([pageId]);
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO builder_orders (id, user_id, page_id, amount, currency, breakdown_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, userId, pageId, calc.total, calc.currency, JSON.stringify(calc), now, now);
  return getBuilderOrder(id)!;
}

export function getBuilderOrder(id: string): BuilderOrder | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM builder_orders WHERE id = ?').get(id) as BoRow | undefined;
  return row ? boRowToObj(row) : null;
}

export function listBuilderOrdersByUser(userId: string, limit = 100): BuilderOrder[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM builder_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit) as BoRow[];
  return rows.map(boRowToObj);
}

export function listAllBuilderOrders(limit = 100, offset = 0): BuilderOrder[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM builder_orders ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as BoRow[];
  return rows.map(boRowToObj);
}

/**
 * Mark an order as paid. Generates a single-use download token valid
 * for 24 hours (configurable). Idempotent.
 */
export function markOrderPaid(orderId: string, paymentTxId?: string): BuilderOrder | null {
  const db = getDb();
  const order = getBuilderOrder(orderId);
  if (!order) return null;
  if (order.status === 'paid') return order;
  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const token = randomUUID().replace(/-/g, '');
  db.prepare(`
    UPDATE builder_orders SET status = 'paid', payment_transaction_id = ?,
      download_token = ?, download_expires_at = ?, updated_at = ?
    WHERE id = ?
  `).run(paymentTxId ?? null, token, expires.toISOString(), now.toISOString(), orderId);
  return getBuilderOrder(orderId);
}

export function cancelOrder(orderId: string): BuilderOrder | null {
  const db = getDb();
  const order = getBuilderOrder(orderId);
  if (!order) return null;
  if (order.status !== 'pending') throw new Error('Can only cancel pending orders');
  db.prepare("UPDATE builder_orders SET status = 'cancelled', updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), orderId);
  return getBuilderOrder(orderId);
}

/** Check download token validity without consuming. */
export function verifyDownloadToken(token: string): { order: BuilderOrder | null; valid: boolean; reason?: string } {
  const db = getDb();
  const row = db.prepare('SELECT * FROM builder_orders WHERE download_token = ?').get(token) as BoRow | undefined;
  if (!row) return { order: null, valid: false, reason: 'token not found' };
  const order = boRowToObj(row);
  if (order.status !== 'paid') return { order, valid: false, reason: 'order not paid' };
  if (order.download_expires_at && new Date(order.download_expires_at) < new Date()) {
    return { order, valid: false, reason: 'token expired' };
  }
  return { order, valid: true };
}

export function recordDownload(orderId: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE builder_orders SET downloaded_at = COALESCE(downloaded_at, ?),
      download_count = download_count + 1, updated_at = ?
    WHERE id = ?
  `).run(now, now, orderId);
}

// ---------- 43.21 Marketplace ----------

export interface MarketplaceListing {
  id: string;
  seller_id: string;
  template_id: string;
  title: string;
  description: string | null;
  price: number;
  currency: string;
  category: string | null;
  thumbnail_url: string | null;
  sales_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface BmRow {
  id: string; seller_id: string; template_id: string; title: string;
  description: string | null; price: number; currency: string;
  category: string | null; thumbnail_url: string | null;
  sales_count: number; is_active: number;
  created_at: string; updated_at: string;
}

function bmRowToObj(row: BmRow): MarketplaceListing {
  return {
    id: row.id, seller_id: row.seller_id, template_id: row.template_id,
    title: row.title, description: row.description, price: row.price,
    currency: row.currency, category: row.category, thumbnail_url: row.thumbnail_url,
    sales_count: row.sales_count, is_active: row.is_active === 1,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

export function createListing(input: {
  seller_id: string;
  template_id: string;
  title: string;
  description?: string;
  price: number;
  currency?: string;
  category?: string;
  thumbnail_url?: string;
}): MarketplaceListing {
  const db = getDb();
  if (!input.title?.trim()) throw new Error('title required');
  if (input.price < 0) throw new Error('price must be >= 0');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO builder_marketplace (id, seller_id, template_id, title, description,
      price, currency, category, thumbnail_url, sales_count, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
  `).run(
    id, input.seller_id, input.template_id, input.title.trim(),
    input.description ?? null, input.price, input.currency ?? 'BDT',
    input.category ?? null, input.thumbnail_url ?? null, now, now,
  );
  return getListing(id)!;
}

export function getListing(id: string): MarketplaceListing | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM builder_marketplace WHERE id = ?').get(id) as BmRow | undefined;
  return row ? bmRowToObj(row) : null;
}

export function listListings(opts: { category?: string; seller_id?: string; activeOnly?: boolean; limit?: number; offset?: number } = {}): MarketplaceListing[] {
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.category) { where.push('category = ?'); params.push(opts.category); }
  if (opts.seller_id) { where.push('seller_id = ?'); params.push(opts.seller_id); }
  if (opts.activeOnly !== false) where.push('is_active = 1');
  const full = `SELECT * FROM builder_marketplace${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY sales_count DESC, created_at DESC LIMIT ? OFFSET ?`;
  const rows = db.prepare(full).all(...params, opts.limit ?? 50, opts.offset ?? 0) as BmRow[];
  return rows.map(bmRowToObj);
}

export function updateListing(id: string, patch: {
  title?: string; description?: string | null; price?: number;
  category?: string | null; thumbnail_url?: string | null; is_active?: boolean;
}): MarketplaceListing | null {
  const db = getDb();
  const cur = getListing(id);
  if (!cur) return null;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE builder_marketplace SET title = ?, description = ?, price = ?, category = ?,
      thumbnail_url = ?, is_active = ?, updated_at = ? WHERE id = ?
  `).run(
    patch.title?.trim() || cur.title,
    patch.description !== undefined ? patch.description : cur.description,
    patch.price !== undefined ? patch.price : cur.price,
    patch.category !== undefined ? patch.category : cur.category,
    patch.thumbnail_url !== undefined ? patch.thumbnail_url : cur.thumbnail_url,
    patch.is_active !== undefined ? (patch.is_active ? 1 : 0) : (cur.is_active ? 1 : 0),
    now, id,
  );
  return getListing(id);
}

export function deleteListing(id: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM builder_marketplace WHERE id = ?').run(id).changes > 0;
}

export interface MarketplacePurchase {
  id: string;
  buyer_id: string;
  listing_id: string;
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'refunded' | 'cancelled';
  transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

interface MpRow {
  id: string; buyer_id: string; listing_id: string; amount: number; currency: string;
  status: string; transaction_id: string | null; created_at: string; updated_at: string;
}

function mpRowToObj(row: MpRow): MarketplacePurchase {
  return {
    id: row.id, buyer_id: row.buyer_id, listing_id: row.listing_id,
    amount: row.amount, currency: row.currency,
    status: row.status as MarketplacePurchase['status'],
    transaction_id: row.transaction_id,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

export function createMarketplacePurchase(buyerId: string, listingId: string): MarketplacePurchase {
  const db = getDb();
  const listing = getListing(listingId);
  if (!listing) throw new Error('listing not found');
  if (!listing.is_active) throw new Error('listing not available');
  if (listing.seller_id === buyerId) throw new Error('cannot buy your own listing');
  // prevent re-buy
  const existing = db.prepare(
    "SELECT id FROM builder_marketplace_purchases WHERE buyer_id = ? AND listing_id = ? AND status = 'paid'"
  ).get(buyerId, listingId);
  if (existing) throw new Error('already purchased');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO builder_marketplace_purchases (id, buyer_id, listing_id, amount, currency, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, buyerId, listingId, listing.price, listing.currency, now, now);
  return mpRowToObj(db.prepare('SELECT * FROM builder_marketplace_purchases WHERE id = ?').get(id) as MpRow);
}

export function markMarketplacePurchasePaid(purchaseId: string, transactionId?: string): MarketplacePurchase | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM builder_marketplace_purchases WHERE id = ?').get(purchaseId) as MpRow | undefined;
  if (!row) return null;
  if (row.status === 'paid') return mpRowToObj(row);
  const now = new Date().toISOString();
  db.prepare("UPDATE builder_marketplace_purchases SET status = 'paid', transaction_id = ?, updated_at = ? WHERE id = ?")
    .run(transactionId ?? null, now, purchaseId);
  db.prepare('UPDATE builder_marketplace SET sales_count = sales_count + 1, updated_at = ? WHERE id = ?')
    .run(now, row.listing_id);
  return mpRowToObj(db.prepare('SELECT * FROM builder_marketplace_purchases WHERE id = ?').get(purchaseId) as MpRow);
}

export function listMyPurchases(buyerId: string): MarketplacePurchase[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM builder_marketplace_purchases WHERE buyer_id = ? ORDER BY created_at DESC')
    .all(buyerId) as MpRow[];
  return rows.map(mpRowToObj);
}

export function hasPurchased(buyerId: string, listingId: string): boolean {
  const db = getDb();
  const row = db.prepare(
    "SELECT id FROM builder_marketplace_purchases WHERE buyer_id = ? AND listing_id = ? AND status = 'paid'"
  ).get(buyerId, listingId);
  return !!row;
}

// ---------- 43.20 Download export ----------

export interface PageExport {
  page_id: string;
  title: string;
  slug: string;
  exported_at: string;
  format: 'json' | 'html';
  payload: unknown;
}

/** Export the page's tree as JSON (or a minimal HTML preview). */
export function exportPage(pageId: string, format: 'json' | 'html' = 'json'): PageExport {
  const db = getDb();
  const page = db.prepare('SELECT id, title, slug FROM custom_pages WHERE id = ?').get(pageId) as
    { id: string; title: string; slug: string } | undefined;
  if (!page) throw new Error('page not found');
  const elements = db.prepare('SELECT * FROM page_elements WHERE page_id = ? ORDER BY sort_order').all(pageId) as any[];
  const tree = buildTree(elements);
  if (format === 'json') {
    return {
      page_id: page.id, title: page.title, slug: page.slug,
      exported_at: new Date().toISOString(), format: 'json',
      payload: { page, tree, version: '43.20-v1' },
    };
  }
  // html — wrap tree in minimal html with scoped css
  const html = renderHtml(page.title, tree, pageId);
  return {
    page_id: page.id, title: page.title, slug: page.slug,
    exported_at: new Date().toISOString(), format: 'html',
    payload: { html },
  };
}

function buildTree(rows: any[]): any[] {
  const nodes = new Map<string, any>();
  for (const r of rows) {
    const settings = safeParse(r.settings_json);
    const style = safeParse(r.style_json);
    const responsive = safeParse(r.responsive_json);
    const advanced = safeParse(r.advanced_json);
    nodes.set(r.id, {
      id: r.id, parent_id: r.parent_id, element_type: r.element_type,
      widget_type: r.widget_type, settings, style, responsive, advanced,
      sort_order: r.sort_order, is_hidden: r.is_hidden === 1, children: [],
    });
  }
  const roots: any[] = [];
  for (const r of rows) {
    const node = nodes.get(r.id);
    if (r.parent_id && nodes.has(r.parent_id)) nodes.get(r.parent_id).children.push(node);
    else roots.push(node);
  }
  return roots;
}

function safeParse(s: string): Record<string, unknown> {
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; }
}

function renderHtml(title: string, tree: any[], _pageId: string): string {
  const renderNode = (n: any): string => {
    if (n.is_hidden) return '';
    const style = Object.entries(n.style ?? {}).map(([k, v]) => `${k.replace(/_/g, '-')}: ${v};`).join('');
    const kids = (n.children ?? []).map(renderNode).join('');
    const cls = `mf-el-${n.id}`;
    if (n.element_type === 'widget') {
      const s = n.settings ?? {};
      if (n.widget_type === 'heading') return `<${s.tag ?? 'h2'} class="${cls}" style="${style}">${escapeHtml(s.text ?? '')}</${s.tag ?? 'h2'}>`;
      if (n.widget_type === 'text') return `<div class="${cls}" style="${style}">${s.html ?? ''}</div>`;
      if (n.widget_type === 'button') return `<a class="${cls}" href="${s.url ?? '#'}" style="${style}">${escapeHtml(s.text ?? 'Button')}</a>`;
      if (n.widget_type === 'image') return `<img class="${cls}" src="${s.src ?? ''}" alt="${s.alt ?? ''}" style="${style}"/>`;
      return `<div class="${cls}" style="${style}">[${n.widget_type}]</div>`;
    }
    return `<div class="${cls}" style="${style}">${kids}</div>`;
  };
  const body = tree.map(renderNode).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${body}</body></html>`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
