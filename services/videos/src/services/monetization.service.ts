// melodyflix videos — Monetization: Donations + Coupons (10.3, 10.9)

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export function ensureMonetizationSchema(): void {
  const db = getDb();
  db.exec(`
    -- 10.3 Donation
    CREATE TABLE IF NOT EXISTS donations (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      channel_id TEXT,
      video_id TEXT,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      message TEXT,
      is_anonymous INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      transaction_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_donations_recipient
      ON donations(recipient_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_donations_channel
      ON donations(channel_id, created_at DESC);

    -- 10.9 Coupon / Promo code
    CREATE TABLE IF NOT EXISTS promo_codes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      owner_id TEXT NOT NULL,
      description TEXT,
      discount_type TEXT NOT NULL CHECK (discount_type IN ('percent','fixed')),
      discount_value REAL NOT NULL,
      max_uses INTEGER,
      per_user_limit INTEGER NOT NULL DEFAULT 1,
      used_count INTEGER NOT NULL DEFAULT 0,
      applicable_to TEXT NOT NULL DEFAULT 'all'
        CHECK (applicable_to IN ('all','membership','ppv','donation','merch')),
      target_channel_id TEXT,
      starts_at TEXT,
      ends_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_promo_code ON promo_codes(code);
    CREATE INDEX IF NOT EXISTS idx_promo_owner ON promo_codes(owner_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS promo_redemptions (
      id TEXT PRIMARY KEY,
      promo_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      context TEXT,
      reference_id TEXT,
      amount_saved REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_promo_redemption_user
      ON promo_redemptions(promo_id, user_id);
  `);
}

// ============================================================
// 10.3 Donation
// ============================================================

export interface Donation {
  id: string;
  sender_id: string;
  recipient_id: string;
  channel_id: string | null;
  video_id: string | null;
  amount: number;
  currency: string;
  message: string | null;
  is_anonymous: number;
  is_refunded: number;
  transaction_id: string | null;
  created_at: string;
}

export interface CreateDonationInput {
  sender_id: string;
  recipient_id: string;
  channel_id?: string | null;
  video_id?: string | null;
  amount: number;
  currency?: string;
  message?: string | null;
  is_anonymous?: boolean;
  transaction_id?: string | null;
}

const MIN_DONATION = 0.5;
const MAX_DONATION = 10_000;

export function createDonation(input: CreateDonationInput): Donation {
  if (input.sender_id === input.recipient_id) throw new Error('Cannot donate to yourself');
  const amt = input.amount;
  if (!Number.isFinite(amt)) throw new Error('Invalid amount');
  if (amt < MIN_DONATION) throw new Error(`Minimum donation is $${MIN_DONATION}`);
  if (amt > MAX_DONATION) throw new Error(`Maximum donation is $${MAX_DONATION}`);

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const cur = (input.currency ?? 'USD').toUpperCase().slice(0, 3);
  db.prepare(`
    INSERT INTO donations
      (id, sender_id, recipient_id, channel_id, video_id, amount, currency,
       message, is_anonymous, is_refunded, transaction_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    id, input.sender_id, input.recipient_id,
    input.channel_id ?? null, input.video_id ?? null,
    amt, cur,
    input.message ? input.message.slice(0, 200) : null,
    input.is_anonymous ? 1 : 0,
    input.transaction_id ?? null,
    now
  );
  return getDonation(id)!;
}

export function getDonation(id: string): Donation | null {
  return (getDb().prepare('SELECT * FROM donations WHERE id = ?').get(id) as Donation | undefined) ?? null;
}

export function listDonationsForRecipient(recipientId: string, limit = 100): Donation[] {
  const n = Math.min(Math.max(limit, 1), 500);
  return getDb().prepare(`
    SELECT * FROM donations WHERE recipient_id = ? AND is_refunded = 0
    ORDER BY created_at DESC LIMIT ?
  `).all(recipientId, n) as Donation[];
}

export function listDonationsForChannel(channelId: string, limit = 100): Donation[] {
  const n = Math.min(Math.max(limit, 1), 500);
  return getDb().prepare(`
    SELECT * FROM donations WHERE channel_id = ? AND is_refunded = 0
    ORDER BY created_at DESC LIMIT ?
  `).all(channelId, n) as Donation[];
}

export function refundDonation(id: string, requesterId: string): boolean {
  const db = getDb();
  const d = getDonation(id);
  if (!d) return false;
  // Only sender or recipient can refund
  if (d.sender_id !== requesterId && d.recipient_id !== requesterId) {
    throw new Error('Not your donation');
  }
  const r = db.prepare('UPDATE donations SET is_refunded = 1 WHERE id = ? AND is_refunded = 0').run(id);
  return r.changes > 0;
}

export interface DonationStats {
  recipient_id: string;
  total_count: number;
  total_amount: number;
  top_amount: number;
  last_30d_count: number;
  last_30d_amount: number;
  top_supporters: { sender_id: string; total: number; count: number }[];
}

export function getDonationStats(recipientId: string): DonationStats {
  const db = getDb();
  const totals = db.prepare(`
    SELECT COUNT(*) as n, COALESCE(SUM(amount),0) as total,
           COALESCE(MAX(amount),0) as top
    FROM donations WHERE recipient_id = ? AND is_refunded = 0
  `).get(recipientId) as any;
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
  const last30 = db.prepare(`
    SELECT COUNT(*) as n, COALESCE(SUM(amount),0) as total
    FROM donations WHERE recipient_id = ? AND is_refunded = 0 AND created_at >= ?
  `).get(recipientId, cutoff) as any;
  const top = db.prepare(`
    SELECT sender_id, SUM(amount) as total, COUNT(*) as count
    FROM donations WHERE recipient_id = ? AND is_refunded = 0
    GROUP BY sender_id ORDER BY total DESC LIMIT 10
  `).all(recipientId) as { sender_id: string; total: number; count: number }[];
  return {
    recipient_id: recipientId,
    total_count: totals.n ?? 0,
    total_amount: totals.total ?? 0,
    top_amount: totals.top ?? 0,
    last_30d_count: last30.n ?? 0,
    last_30d_amount: last30.total ?? 0,
    top_supporters: top,
  };
}

// ============================================================
// 10.9 Coupon / Promo codes
// ============================================================

export type DiscountType = 'percent' | 'fixed';
export type PromoScope = 'all' | 'membership' | 'ppv' | 'donation' | 'merch';

export interface PromoCode {
  id: string;
  code: string;
  owner_id: string;
  description: string | null;
  discount_type: DiscountType;
  discount_value: number;
  max_uses: number | null;
  per_user_limit: number;
  used_count: number;
  applicable_to: PromoScope;
  target_channel_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CreatePromoInput {
  owner_id: string;
  code?: string;
  description?: string | null;
  discount_type: DiscountType;
  discount_value: number;
  max_uses?: number | null;
  per_user_limit?: number;
  applicable_to?: PromoScope;
  target_channel_id?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
}

const CODE_RE = /^[A-Z0-9_-]{4,32}$/;

function randomCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function createPromoCode(input: CreatePromoInput): PromoCode {
  const code = (input.code ?? randomCode()).toUpperCase();
  if (!CODE_RE.test(code)) throw new Error('Code must be 4-32 chars A-Z, 0-9, -, _');

  if (input.discount_type === 'percent') {
    if (input.discount_value <= 0 || input.discount_value > 100) throw new Error('Percent must be 1-100');
  } else {
    if (input.discount_value <= 0 || input.discount_value > 100_000) throw new Error('Fixed must be > 0');
  }
  if (input.max_uses !== undefined && input.max_uses !== null) {
    if (input.max_uses < 1 || input.max_uses > 1_000_000) throw new Error('max_uses out of range');
  }
  const perUser = input.per_user_limit ?? 1;
  if (perUser < 1 || perUser > 100) throw new Error('per_user_limit out of range');
  if (input.ends_at && input.starts_at && new Date(input.ends_at) <= new Date(input.starts_at)) {
    throw new Error('ends_at must be after starts_at');
  }

  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  try {
    db.prepare(`
      INSERT INTO promo_codes
        (id, code, owner_id, description, discount_type, discount_value,
         max_uses, per_user_limit, used_count, applicable_to,
         target_channel_id, starts_at, ends_at, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      id, code, input.owner_id, input.description ?? null,
      input.discount_type, input.discount_value,
      input.max_uses ?? null, perUser,
      input.applicable_to ?? 'all',
      input.target_channel_id ?? null,
      input.starts_at ?? null, input.ends_at ?? null,
      now, now
    );
  } catch (e: any) {
    if (String(e?.message ?? '').includes('UNIQUE')) throw new Error('Code already exists');
    throw e;
  }
  return getPromoCode(id)!;
}

export function getPromoCode(id: string): PromoCode | null {
  return (getDb().prepare('SELECT * FROM promo_codes WHERE id = ?').get(id) as PromoCode | undefined) ?? null;
}

export function getPromoCodeByCode(code: string): PromoCode | null {
  return (getDb().prepare('SELECT * FROM promo_codes WHERE code = ? COLLATE NOCASE').get(code) as PromoCode | undefined) ?? null;
}

export function listPromoCodesByOwner(ownerId: string, limit = 100): PromoCode[] {
  const n = Math.min(Math.max(limit, 1), 500);
  return getDb().prepare(
    'SELECT * FROM promo_codes WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(ownerId, n) as PromoCode[];
}

export interface UpdatePromoInput {
  description?: string | null;
  max_uses?: number | null;
  per_user_limit?: number;
  applicable_to?: PromoScope;
  starts_at?: string | null;
  ends_at?: string | null;
  is_active?: boolean;
}

export function updatePromoCode(id: string, ownerId: string, patch: UpdatePromoInput): PromoCode | null {
  const cur = getPromoCode(id);
  if (!cur) return null;
  if (cur.owner_id !== ownerId) throw new Error('Not your promo code');

  const fields: string[] = [];
  const values: any[] = [];
  const map: Record<string, any> = {
    description: patch.description,
    max_uses: patch.max_uses,
    per_user_limit: patch.per_user_limit,
    applicable_to: patch.applicable_to,
    starts_at: patch.starts_at,
    ends_at: patch.ends_at,
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
  getDb().prepare(`UPDATE promo_codes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getPromoCode(id);
}

export function deletePromoCode(id: string, ownerId: string): boolean {
  const cur = getPromoCode(id);
  if (!cur) return false;
  if (cur.owner_id !== ownerId) throw new Error('Not your promo code');
  return getDb().prepare('DELETE FROM promo_codes WHERE id = ?').run(id).changes > 0;
}

// ---------- Redemption ----------

export interface ValidatePromoInput {
  code: string;
  user_id: string;
  context?: PromoScope;
  amount?: number;             // original amount, for discount computation
  reference_id?: string | null;
}

export interface ValidatePromoResult {
  valid: boolean;
  reason: 'ok' | 'not_found' | 'inactive' | 'not_started' | 'expired'
        | 'exhausted' | 'user_limit' | 'not_applicable';
  promo: PromoCode | null;
  original_amount: number;
  discount_amount: number;
  final_amount: number;
}

export function validatePromo(input: ValidatePromoInput): ValidatePromoResult {
  const promo = getPromoCodeByCode(input.code);
  const base: ValidatePromoResult = {
    valid: false, reason: 'not_found', promo: null,
    original_amount: input.amount ?? 0,
    discount_amount: 0,
    final_amount: input.amount ?? 0,
  };
  if (!promo) return base;
  base.promo = promo;

  if (promo.is_active !== 1) return { ...base, reason: 'inactive' };
  const now = Date.now();
  if (promo.starts_at && new Date(promo.starts_at).getTime() > now) return { ...base, reason: 'not_started' };
  if (promo.ends_at && new Date(promo.ends_at).getTime() < now) return { ...base, reason: 'expired' };
  if (promo.max_uses !== null && promo.used_count >= promo.max_uses) return { ...base, reason: 'exhausted' };
  if (input.context && promo.applicable_to !== 'all' && promo.applicable_to !== input.context) {
    return { ...base, reason: 'not_applicable' };
  }

  const db = getDb();
  const used = (db.prepare(
    'SELECT COUNT(*) as n FROM promo_redemptions WHERE promo_id = ? AND user_id = ?'
  ).get(promo.id, input.user_id) as { n: number }).n;
  if (used >= promo.per_user_limit) return { ...base, reason: 'user_limit' };

  // Compute discount
  const amount = input.amount ?? 0;
  let discount = 0;
  if (amount > 0) {
    if (promo.discount_type === 'percent') discount = amount * (promo.discount_value / 100);
    else discount = Math.min(promo.discount_value, amount);
  }
  return {
    valid: true,
    reason: 'ok',
    promo,
    original_amount: amount,
    discount_amount: Number(discount.toFixed(2)),
    final_amount: Number((amount - discount).toFixed(2)),
  };
}

export function redeemPromo(input: ValidatePromoInput & { amount_saved: number }): { ok: boolean; reason?: string } {
  const v = validatePromo(input);
  if (!v.valid) return { ok: false, reason: v.reason };

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO promo_redemptions
        (id, promo_id, user_id, context, reference_id, amount_saved, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, v.promo!.id, input.user_id,
      input.context ?? null, input.reference_id ?? null,
      input.amount_saved, now,
    );
    db.prepare('UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?')
      .run(v.promo!.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { ok: true };
}

export function listRedemptions(promoId: string, limit = 100): any[] {
  const n = Math.min(Math.max(limit, 1), 500);
  return getDb().prepare(
    'SELECT * FROM promo_redemptions WHERE promo_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(promoId, n);
}

export interface PromoStats {
  promo_id: string;
  used_count: number;
  total_saved: number;
  unique_users: number;
}

export function getPromoStats(promoId: string): PromoStats {
  const db = getDb();
  const r = db.prepare(`
    SELECT COUNT(*) as n, COALESCE(SUM(amount_saved),0) as total,
           COUNT(DISTINCT user_id) as users
    FROM promo_redemptions WHERE promo_id = ?
  `).get(promoId) as any;
  return {
    promo_id: promoId,
    used_count: r.n ?? 0,
    total_saved: r.total ?? 0,
    unique_users: r.users ?? 0,
  };
}
