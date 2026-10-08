// melodyflix - payment gateway management + transactions
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type GatewayProvider =
  | 'bkash' | 'nagad' | 'rocket' | 'sslcommerz'
  | 'stripe' | 'paypal' | 'razorpay';

export interface PaymentGateway {
  id: string;
  provider: GatewayProvider;
  display_name: string;
  api_key: string | null;
  api_secret: string | null;
  merchant_id: string | null;
  base_url: string | null;
  sandbox: number;
  active: number;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export function ensurePaymentSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_gateways (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      display_name TEXT NOT NULL,
      api_key TEXT,
      api_secret TEXT,
      merchant_id TEXT,
      base_url TEXT,
      sandbox INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pg_provider ON payment_gateways(provider);
    CREATE INDEX IF NOT EXISTS idx_pg_active ON payment_gateways(active);

    CREATE TABLE IF NOT EXISTS payment_transactions (
      id TEXT PRIMARY KEY,
      gateway_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      purpose TEXT NOT NULL,
      reference_id TEXT,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'BDT',
      status TEXT NOT NULL DEFAULT 'pending',
      external_id TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pt_user ON payment_transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_pt_status ON payment_transactions(status);
    CREATE INDEX IF NOT EXISTS idx_pt_purpose ON payment_transactions(purpose);

    CREATE TABLE IF NOT EXISTS payment_refunds (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'BDT',
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      refunded_by TEXT,
      external_refund_id TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pr_tx ON payment_refunds(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_pr_user ON payment_refunds(user_id);
    CREATE INDEX IF NOT EXISTS idx_pr_status ON payment_refunds(status);

    CREATE TABLE IF NOT EXISTS currency_rates (
      base_currency TEXT NOT NULL,
      quote_currency TEXT NOT NULL,
      rate REAL NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (base_currency, quote_currency)
    );
    CREATE INDEX IF NOT EXISTS idx_cr_base ON currency_rates(base_currency);

    CREATE TABLE IF NOT EXISTS cross_border_config (
      id TEXT PRIMARY KEY,
      home_country TEXT NOT NULL DEFAULT 'BD',
      fee_percent REAL NOT NULL DEFAULT 0,
      blocked_countries TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cross_border_log (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL,
      origin_country TEXT NOT NULL,
      target_country TEXT NOT NULL,
      fee_amount REAL NOT NULL,
      fee_percent REAL NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cbl_tx ON cross_border_log(transaction_id);

    CREATE TABLE IF NOT EXISTS three_ds_sessions (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'BDT',
      challenge_url TEXT,
      return_url TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      expires_at TEXT NOT NULL,
      completed_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_3ds_tx ON three_ds_sessions(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_3ds_user ON three_ds_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_3ds_status ON three_ds_sessions(status);

    CREATE TABLE IF NOT EXISTS three_ds_config (
      id TEXT PRIMARY KEY,
      threshold_amount REAL NOT NULL DEFAULT 5000,
      supported_providers TEXT NOT NULL DEFAULT '["stripe","razorpay"]',
      session_ttl_minutes INTEGER NOT NULL DEFAULT 15,
      updated_at TEXT NOT NULL
    );
  `);

  // Lightweight column migrations for existing databases
  try { db.exec(`ALTER TABLE payment_transactions ADD COLUMN origin_country TEXT`); } catch {}
  try { db.exec(`ALTER TABLE payment_transactions ADD COLUMN target_country TEXT`); } catch {}
  try { db.exec(`ALTER TABLE payment_transactions ADD COLUMN is_cross_border INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE payment_transactions ADD COLUMN cross_border_fee REAL NOT NULL DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE payment_transactions ADD COLUMN requires_3ds INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE payment_transactions ADD COLUMN three_ds_session_id TEXT`); } catch {}
}

export interface CreateGatewayInput {
  provider: GatewayProvider;
  display_name: string;
  api_key?: string;
  api_secret?: string;
  merchant_id?: string;
  base_url?: string;
  sandbox?: boolean;
  active?: boolean;
  is_default?: boolean;
}

export function createGateway(input: CreateGatewayInput): PaymentGateway {
  const db = getDb();
  const now = new Date().toISOString();
  if (input.is_default) {
    db.prepare('UPDATE payment_gateways SET is_default = 0').run();
  }
  const gw: PaymentGateway = {
    id: randomUUID(),
    provider: input.provider,
    display_name: input.display_name.trim(),
    api_key: input.api_key?.trim() || null,
    api_secret: input.api_secret?.trim() || null,
    merchant_id: input.merchant_id?.trim() || null,
    base_url: input.base_url?.trim() || null,
    sandbox: input.sandbox === false ? 0 : 1,
    active: input.active ? 1 : 0,
    is_default: input.is_default ? 1 : 0,
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO payment_gateways (id, provider, display_name, api_key, api_secret, merchant_id,
      base_url, sandbox, active, is_default, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    gw.id, gw.provider, gw.display_name, gw.api_key, gw.api_secret, gw.merchant_id,
    gw.base_url, gw.sandbox, gw.active, gw.is_default, gw.created_at, gw.updated_at
  );
  return gw;
}

export function getGatewayById(id: string): PaymentGateway | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM payment_gateways WHERE id = ?').get(id) as PaymentGateway | undefined) ?? null;
}

export function listGateways(): PaymentGateway[] {
  const db = getDb();
  return db.prepare('SELECT * FROM payment_gateways ORDER BY is_default DESC, created_at DESC')
    .all() as PaymentGateway[];
}

export function getDefaultGateway(): PaymentGateway | null {
  const db = getDb();
  const def = db.prepare('SELECT * FROM payment_gateways WHERE active = 1 AND is_default = 1 LIMIT 1')
    .get() as PaymentGateway | undefined;
  if (def) return def;
  const any = db.prepare('SELECT * FROM payment_gateways WHERE active = 1 LIMIT 1')
    .get() as PaymentGateway | undefined;
  return any ?? null;
}

export function updateGateway(id: string, updates: Partial<CreateGatewayInput>): PaymentGateway {
  const db = getDb();
  const existing = getGatewayById(id);
  if (!existing) throw new Error('Gateway not found');
  const now = new Date().toISOString();
  if (updates.is_default) {
    db.prepare('UPDATE payment_gateways SET is_default = 0 WHERE id != ?').run(id);
  }
  db.prepare(`
    UPDATE payment_gateways SET
      display_name = ?, api_key = ?, api_secret = ?, merchant_id = ?, base_url = ?,
      sandbox = ?, active = ?, is_default = ?, updated_at = ?
    WHERE id = ?
  `).run(
    updates.display_name?.trim() || existing.display_name,
    updates.api_key !== undefined ? (updates.api_key.trim() || null) : existing.api_key,
    updates.api_secret !== undefined ? (updates.api_secret.trim() || null) : existing.api_secret,
    updates.merchant_id !== undefined ? (updates.merchant_id.trim() || null) : existing.merchant_id,
    updates.base_url !== undefined ? (updates.base_url.trim() || null) : existing.base_url,
    updates.sandbox !== undefined ? (updates.sandbox ? 1 : 0) : existing.sandbox,
    updates.active !== undefined ? (updates.active ? 1 : 0) : existing.active,
    updates.is_default !== undefined ? (updates.is_default ? 1 : 0) : existing.is_default,
    now, id
  );
  return getGatewayById(id)!;
}

export function deleteGateway(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM payment_gateways WHERE id = ?').run(id);
}

export interface CreateTransactionInput {
  gateway_id: string;
  user_id: string;
  purpose: 'super_chat' | 'membership' | 'donation' | 'ppv' | 'message_pack';
  reference_id?: string;
  amount: number;
  currency?: string;
  status?: 'pending' | 'completed' | 'failed' | 'refunded';
  external_id?: string;
  metadata?: Record<string, any>;
}

export interface PaymentTransaction {
  id: string;
  gateway_id: string;
  user_id: string;
  purpose: string;
  reference_id: string | null;
  amount: number;
  currency: string;
  status: string;
  external_id: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export function createTransaction(input: CreateTransactionInput): PaymentTransaction {
  const db = getDb();
  const now = new Date().toISOString();
  const tx: PaymentTransaction = {
    id: randomUUID(),
    gateway_id: input.gateway_id,
    user_id: input.user_id,
    purpose: input.purpose,
    reference_id: input.reference_id ?? null,
    amount: input.amount,
    currency: input.currency ?? 'BDT',
    status: input.status ?? 'pending',
    external_id: input.external_id ?? null,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO payment_transactions (id, gateway_id, user_id, purpose, reference_id, amount,
      currency, status, external_id, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tx.id, tx.gateway_id, tx.user_id, tx.purpose, tx.reference_id, tx.amount,
    tx.currency, tx.status, tx.external_id, tx.metadata, tx.created_at, tx.updated_at
  );
  return tx;
}

export function updateTransactionStatus(id: string, status: string, externalId?: string): PaymentTransaction | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare('UPDATE payment_transactions SET status = ?, external_id = COALESCE(?, external_id), updated_at = ? WHERE id = ?')
    .run(status, externalId ?? null, now, id);
  return (db.prepare('SELECT * FROM payment_transactions WHERE id = ?').get(id) as PaymentTransaction | undefined) ?? null;
}

export function getTransactionById(id: string): PaymentTransaction | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM payment_transactions WHERE id = ?').get(id) as PaymentTransaction | undefined) ?? null;
}

export function listTransactions(limit = 100, offset = 0): PaymentTransaction[] {
  const db = getDb();
  return db.prepare('SELECT * FROM payment_transactions ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as PaymentTransaction[];
}

export interface PaymentStats {
  total_transactions: number;
  completed_transactions: number;
  total_revenue: number;
  revenue_last_30d: number;
}

export function getPaymentStats(): PaymentStats {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as n FROM payment_transactions').get() as { n: number }).n;
  const completed = (db.prepare("SELECT COUNT(*) as n FROM payment_transactions WHERE status = 'completed'").get() as { n: number }).n;
  const totalRev = (db.prepare("SELECT COALESCE(SUM(amount), 0) as s FROM payment_transactions WHERE status = 'completed'").get() as { s: number }).s;
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rev30 = (db.prepare("SELECT COALESCE(SUM(amount), 0) as s FROM payment_transactions WHERE status = 'completed' AND created_at >= ?").get(cutoff) as { s: number }).s;
  return {
    total_transactions: total,
    completed_transactions: completed,
    total_revenue: totalRev,
    revenue_last_30d: rev30,
  };
}

// ============ Refund System (29.5) ============

export interface PaymentRefund {
  id: string;
  transaction_id: string;
  user_id: string;
  amount: number;
  currency: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  refunded_by: string | null;
  external_refund_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateRefundInput {
  transaction_id: string;
  user_id: string;
  amount: number;
  currency?: string;
  reason?: string;
}

export function createRefund(input: CreateRefundInput): PaymentRefund {
  const db = getDb();
  const tx = getTransactionById(input.transaction_id);
  if (!tx) throw new Error('Transaction not found');
  if (tx.status !== 'completed') throw new Error('Only completed transactions can be refunded');

  // Count pending + approved + completed refunds to prevent double-booking.
  // Rejected refunds free up their reserved amount.
  const alreadyRefunded = (db.prepare(
    "SELECT COALESCE(SUM(amount), 0) as s FROM payment_refunds WHERE transaction_id = ? AND status IN ('pending','approved','completed')"
  ).get(input.transaction_id) as { s: number }).s;

  const remaining = tx.amount - alreadyRefunded;
  if (remaining <= 0) throw new Error('Transaction already fully refunded');
  if (input.amount <= 0) throw new Error('Refund amount must be positive');
  if (input.amount > remaining + 1e-9) {
    throw new Error(`Refund amount exceeds remaining refundable amount (${remaining.toFixed(2)})`);
  }

  const now = new Date().toISOString();
  const refund: PaymentRefund = {
    id: randomUUID(),
    transaction_id: input.transaction_id,
    user_id: input.user_id,
    amount: input.amount,
    currency: input.currency ?? tx.currency,
    reason: input.reason ?? null,
    status: 'pending',
    refunded_by: null,
    external_refund_id: null,
    notes: null,
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO payment_refunds (id, transaction_id, user_id, amount, currency, reason,
      status, refunded_by, external_refund_id, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    refund.id, refund.transaction_id, refund.user_id, refund.amount, refund.currency,
    refund.reason, refund.status, refund.refunded_by, refund.external_refund_id,
    refund.notes, refund.created_at, refund.updated_at
  );
  return refund;
}

export function getRefundById(id: string): PaymentRefund | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM payment_refunds WHERE id = ?').get(id) as PaymentRefund | undefined) ?? null;
}

export function listRefundsByTransaction(transactionId: string): PaymentRefund[] {
  const db = getDb();
  return db.prepare('SELECT * FROM payment_refunds WHERE transaction_id = ? ORDER BY created_at DESC')
    .all(transactionId) as PaymentRefund[];
}

export function listRefundsByUser(userId: string, limit = 100): PaymentRefund[] {
  const db = getDb();
  return db.prepare('SELECT * FROM payment_refunds WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit) as PaymentRefund[];
}

export function listAllRefunds(limit = 100, offset = 0, status?: string): PaymentRefund[] {
  const db = getDb();
  if (status) {
    return db.prepare('SELECT * FROM payment_refunds WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(status, limit, offset) as PaymentRefund[];
  }
  return db.prepare('SELECT * FROM payment_refunds ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as PaymentRefund[];
}

export function updateRefundStatus(
  id: string,
  status: PaymentRefund['status'],
  reviewerId?: string,
  notes?: string,
  externalRefundId?: string,
): PaymentRefund | null {
  const db = getDb();
  const existing = getRefundById(id);
  if (!existing) return null;
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE payment_refunds
    SET status = ?, refunded_by = COALESCE(?, refunded_by),
        notes = COALESCE(?, notes),
        external_refund_id = COALESCE(?, external_refund_id),
        updated_at = ?
    WHERE id = ?
  `).run(status, reviewerId ?? null, notes ?? null, externalRefundId ?? null, now, id);

  // If refund completed, mark transaction status as 'refunded' when fully refunded
  if (status === 'completed') {
    const tx = getTransactionById(existing.transaction_id);
    if (tx) {
      const totalRefunded = (db.prepare(
        "SELECT COALESCE(SUM(amount), 0) as s FROM payment_refunds WHERE transaction_id = ? AND status = 'completed'"
      ).get(tx.id) as { s: number }).s;
      if (totalRefunded >= tx.amount - 1e-9) {
        db.prepare('UPDATE payment_transactions SET status = ?, updated_at = ? WHERE id = ?')
          .run('refunded', now, tx.id);
      }
    }
  }
  return getRefundById(id);
}

export interface RefundStats {
  total_refunds: number;
  pending_refunds: number;
  approved_refunds: number;
  completed_refunds: number;
  rejected_refunds: number;
  total_refunded_amount: number;
}

export function getRefundStats(): RefundStats {
  const db = getDb();
  const rows = db.prepare(
    "SELECT status, COUNT(*) as n, COALESCE(SUM(amount), 0) as amt FROM payment_refunds GROUP BY status"
  ).all() as Array<{ status: string; n: number; amt: number }>;
  const stats: RefundStats = {
    total_refunds: 0, pending_refunds: 0, approved_refunds: 0,
    completed_refunds: 0, rejected_refunds: 0, total_refunded_amount: 0,
  };
  for (const r of rows) {
    stats.total_refunds += r.n;
    if (r.status === 'pending') stats.pending_refunds = r.n;
    else if (r.status === 'approved') stats.approved_refunds = r.n;
    else if (r.status === 'completed') stats.completed_refunds = r.n;
    else if (r.status === 'rejected') stats.rejected_refunds = r.n;
    if (r.status === 'completed') stats.total_refunded_amount += r.amt;
  }
  return stats;
}

// ============ Currency Conversion (29.8) ============

export const SUPPORTED_CURRENCIES = [
  'BDT', 'USD', 'EUR', 'GBP', 'INR', 'PKR', 'JPY', 'AUD', 'CAD', 'CNY',
  'SGD', 'MYR', 'AED', 'SAR', 'CHF', 'HKD', 'KRW', 'THB', 'IDR', 'PHP',
] as const;

export interface CurrencyRate {
  base_currency: string;
  quote_currency: string;
  rate: number;
  source: string;
  updated_at: string;
}

export function setCurrencyRate(
  base: string,
  quote: string,
  rate: number,
  source = 'manual',
): CurrencyRate {
  const db = getDb();
  const b = base.toUpperCase().trim();
  const q = quote.toUpperCase().trim();
  if (!b || !q) throw new Error('base and quote required');
  if (b === q) throw new Error('base and quote must differ');
  if (!(rate > 0) || !Number.isFinite(rate)) throw new Error('rate must be positive number');

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO currency_rates (base_currency, quote_currency, rate, source, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(base_currency, quote_currency)
    DO UPDATE SET rate = excluded.rate, source = excluded.source, updated_at = excluded.updated_at
  `).run(b, q, rate, source, now);

  return { base_currency: b, quote_currency: q, rate, source, updated_at: now };
}

export function getCurrencyRate(base: string, quote: string): number | null {
  const db = getDb();
  const b = base.toUpperCase().trim();
  const q = quote.toUpperCase().trim();
  if (b === q) return 1;

  const direct = db.prepare(
    'SELECT rate FROM currency_rates WHERE base_currency = ? AND quote_currency = ?'
  ).get(b, q) as { rate: number } | undefined;
  if (direct) return direct.rate;

  const inverse = db.prepare(
    'SELECT rate FROM currency_rates WHERE base_currency = ? AND quote_currency = ?'
  ).get(q, b) as { rate: number } | undefined;
  if (inverse && inverse.rate > 0) return 1 / inverse.rate;

  return null;
}

export function listCurrencyRates(base?: string): CurrencyRate[] {
  const db = getDb();
  if (base) {
    return db.prepare(
      'SELECT * FROM currency_rates WHERE base_currency = ? ORDER BY quote_currency'
    ).all(base.toUpperCase()) as CurrencyRate[];
  }
  return db.prepare('SELECT * FROM currency_rates ORDER BY base_currency, quote_currency')
    .all() as CurrencyRate[];
}

export function deleteCurrencyRate(base: string, quote: string): boolean {
  const db = getDb();
  const r = db.prepare(
    'DELETE FROM currency_rates WHERE base_currency = ? AND quote_currency = ?'
  ).run(base.toUpperCase(), quote.toUpperCase());
  return r.changes > 0;
}

export interface ConversionResult {
  amount: number;
  from: string;
  to: string;
  rate: number;
  converted: number;
  bridged: boolean;
}

/**
 * Convert an amount from one currency to another.
 * Strategy:
 *  1. direct rate
 *  2. inverse rate
 *  3. bridge via USD (from -> USD -> to)
 * Throws if no path exists.
 */
export function convertCurrency(amount: number, from: string, to: string): ConversionResult {
  const f = from.toUpperCase().trim();
  const t = to.toUpperCase().trim();
  if (!(amount >= 0) || !Number.isFinite(amount)) throw new Error('amount must be non-negative number');
  if (f === t) {
    return { amount, from: f, to: t, rate: 1, converted: amount, bridged: false };
  }

  const direct = getCurrencyRate(f, t);
  if (direct !== null) {
    return {
      amount, from: f, to: t,
      rate: direct,
      converted: round2(amount * direct),
      bridged: false,
    };
  }

  // Bridge via USD
  const BRIDGE = 'USD';
  if (f !== BRIDGE && t !== BRIDGE) {
    const r1 = getCurrencyRate(f, BRIDGE);
    const r2 = getCurrencyRate(BRIDGE, t);
    if (r1 !== null && r2 !== null) {
      const rate = r1 * r2;
      return {
        amount, from: f, to: t,
        rate,
        converted: round2(amount * rate),
        bridged: true,
      };
    }
  }

  throw new Error(`No conversion path from ${f} to ${t}`);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ============ Cross-Border Support (29.12) ============

export interface CrossBorderConfig {
  id: string;
  home_country: string;
  fee_percent: number;
  blocked_countries: string[];
  updated_at: string;
}

const CROSS_BORDER_CONFIG_ID = 'default';

export function getCrossBorderConfig(): CrossBorderConfig {
  const db = getDb();
  const row = db.prepare('SELECT * FROM cross_border_config WHERE id = ?').get(CROSS_BORDER_CONFIG_ID) as
    | { id: string; home_country: string; fee_percent: number; blocked_countries: string; updated_at: string }
    | undefined;

  if (!row) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO cross_border_config (id, home_country, fee_percent, blocked_countries, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(CROSS_BORDER_CONFIG_ID, 'BD', 0, '[]', now);
    return {
      id: CROSS_BORDER_CONFIG_ID,
      home_country: 'BD',
      fee_percent: 0,
      blocked_countries: [],
      updated_at: now,
    };
  }

  let blocked: string[] = [];
  try { blocked = JSON.parse(row.blocked_countries) as string[]; } catch { blocked = []; }

  return {
    id: row.id,
    home_country: row.home_country,
    fee_percent: row.fee_percent,
    blocked_countries: blocked,
    updated_at: row.updated_at,
  };
}

export interface SetCrossBorderConfigInput {
  home_country?: string;
  fee_percent?: number;
  blocked_countries?: string[];
}

export function setCrossBorderConfig(input: SetCrossBorderConfigInput): CrossBorderConfig {
  const db = getDb();
  const current = getCrossBorderConfig();
  const now = new Date().toISOString();

  const home = input.home_country ? input.home_country.toUpperCase().trim() : current.home_country;
  const fee = input.fee_percent !== undefined ? input.fee_percent : current.fee_percent;
  if (fee < 0 || fee > 100) throw new Error('fee_percent must be between 0 and 100');

  const blocked = input.blocked_countries
    ? input.blocked_countries.map((c) => c.toUpperCase().trim()).filter(Boolean)
    : current.blocked_countries;

  db.prepare(`
    UPDATE cross_border_config
    SET home_country = ?, fee_percent = ?, blocked_countries = ?, updated_at = ?
    WHERE id = ?
  `).run(home, fee, JSON.stringify(blocked), now, CROSS_BORDER_CONFIG_ID);

  return getCrossBorderConfig();
}

export function isCountryBlocked(country: string): boolean {
  const c = country.toUpperCase().trim();
  const cfg = getCrossBorderConfig();
  return cfg.blocked_countries.includes(c);
}

export interface CrossBorderFeeResult {
  is_cross_border: boolean;
  origin_country: string;
  target_country: string;
  home_country: string;
  fee_percent: number;
  fee_amount: number;
  total: number;
}

/**
 * Compute cross-border fee for a transaction.
 * Cross-border when origin_country !== home_country.
 * Throws if origin country is blocked.
 */
export function computeCrossBorderFee(
  amount: number,
  originCountry: string,
): CrossBorderFeeResult {
  const origin = originCountry.toUpperCase().trim();
  if (isCountryBlocked(origin)) {
    throw new Error(`Transactions from ${origin} are not permitted`);
  }

  const cfg = getCrossBorderConfig();
  const isCrossBorder = origin !== cfg.home_country;
  const feePercent = isCrossBorder ? cfg.fee_percent : 0;
  const feeAmount = round2(amount * (feePercent / 100));

  return {
    is_cross_border: isCrossBorder,
    origin_country: origin,
    target_country: cfg.home_country,
    home_country: cfg.home_country,
    fee_percent: feePercent,
    fee_amount: feeAmount,
    total: round2(amount + feeAmount),
  };
}

export interface CrossBorderLog {
  id: string;
  transaction_id: string;
  origin_country: string;
  target_country: string;
  fee_amount: number;
  fee_percent: number;
  created_at: string;
}

export function logCrossBorder(input: {
  transaction_id: string;
  origin_country: string;
  target_country: string;
  fee_amount: number;
  fee_percent: number;
}): CrossBorderLog {
  const db = getDb();
  const now = new Date().toISOString();
  const row: CrossBorderLog = {
    id: randomUUID(),
    transaction_id: input.transaction_id,
    origin_country: input.origin_country,
    target_country: input.target_country,
    fee_amount: input.fee_amount,
    fee_percent: input.fee_percent,
    created_at: now,
  };
  db.prepare(`
    INSERT INTO cross_border_log (id, transaction_id, origin_country, target_country,
      fee_amount, fee_percent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.transaction_id, row.origin_country, row.target_country,
    row.fee_amount, row.fee_percent, row.created_at
  );
  return row;
}

export function listCrossBorderLog(limit = 100, offset = 0): CrossBorderLog[] {
  const db = getDb();
  return db.prepare('SELECT * FROM cross_border_log ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as CrossBorderLog[];
}

export interface CrossBorderStats {
  total_cross_border: number;
  total_fees_collected: number;
  by_origin_country: Array<{ country: string; count: number; fees: number }>;
}

export function getCrossBorderStats(): CrossBorderStats {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as n FROM cross_border_log').get() as { n: number }).n;
  const fees = (db.prepare('SELECT COALESCE(SUM(fee_amount), 0) as s FROM cross_border_log').get() as { s: number }).s;
  const byCountry = db.prepare(`
    SELECT origin_country as country, COUNT(*) as count, COALESCE(SUM(fee_amount), 0) as fees
    FROM cross_border_log
    GROUP BY origin_country
    ORDER BY count DESC
  `).all() as Array<{ country: string; count: number; fees: number }>;

  return {
    total_cross_border: total,
    total_fees_collected: fees,
    by_origin_country: byCountry,
  };
}

// ============ 3D Secure (29.14) ============

export interface ThreeDSConfig {
  id: string;
  threshold_amount: number;
  supported_providers: string[];
  session_ttl_minutes: number;
  updated_at: string;
}

const THREE_DS_CONFIG_ID = 'default';

export function getThreeDSConfig(): ThreeDSConfig {
  const db = getDb();
  const row = db.prepare('SELECT * FROM three_ds_config WHERE id = ?').get(THREE_DS_CONFIG_ID) as
    | { id: string; threshold_amount: number; supported_providers: string; session_ttl_minutes: number; updated_at: string }
    | undefined;

  if (!row) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO three_ds_config (id, threshold_amount, supported_providers, session_ttl_minutes, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(THREE_DS_CONFIG_ID, 5000, JSON.stringify(['stripe', 'razorpay']), 15, now);
    return {
      id: THREE_DS_CONFIG_ID,
      threshold_amount: 5000,
      supported_providers: ['stripe', 'razorpay'],
      session_ttl_minutes: 15,
      updated_at: now,
    };
  }

  let providers: string[] = [];
  try { providers = JSON.parse(row.supported_providers) as string[]; } catch { providers = []; }

  return {
    id: row.id,
    threshold_amount: row.threshold_amount,
    supported_providers: providers,
    session_ttl_minutes: row.session_ttl_minutes,
    updated_at: row.updated_at,
  };
}

export interface SetThreeDSConfigInput {
  threshold_amount?: number;
  supported_providers?: string[];
  session_ttl_minutes?: number;
}

export function setThreeDSConfig(input: SetThreeDSConfigInput): ThreeDSConfig {
  const db = getDb();
  const current = getThreeDSConfig();
  const now = new Date().toISOString();

  const threshold = input.threshold_amount !== undefined ? input.threshold_amount : current.threshold_amount;
  if (threshold < 0) throw new Error('threshold_amount must be non-negative');

  const ttl = input.session_ttl_minutes !== undefined ? input.session_ttl_minutes : current.session_ttl_minutes;
  if (ttl < 1 || ttl > 1440) throw new Error('session_ttl_minutes must be between 1 and 1440');

  const providers = input.supported_providers !== undefined
    ? input.supported_providers.map((p) => p.toLowerCase().trim()).filter(Boolean)
    : current.supported_providers;

  db.prepare(`
    UPDATE three_ds_config
    SET threshold_amount = ?, supported_providers = ?, session_ttl_minutes = ?, updated_at = ?
    WHERE id = ?
  `).run(threshold, JSON.stringify(providers), ttl, now, THREE_DS_CONFIG_ID);

  return getThreeDSConfig();
}

export interface ThreeDSSession {
  id: string;
  transaction_id: string;
  user_id: string;
  status: 'pending' | 'challenged' | 'passed' | 'failed' | 'expired';
  amount: number;
  currency: string;
  challenge_url: string | null;
  return_url: string | null;
  attempt_count: number;
  max_attempts: number;
  expires_at: string;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Decide if a transaction requires 3DS based on:
 *  - gateway provider is in supported_providers
 *  - amount >= threshold_amount
 */
export function requiresThreeDS(gatewayProvider: string, amount: number): boolean {
  const cfg = getThreeDSConfig();
  const provider = gatewayProvider.toLowerCase().trim();
  if (!cfg.supported_providers.includes(provider)) return false;
  return amount >= cfg.threshold_amount;
}

export interface CreateThreeDSSessionInput {
  transaction_id: string;
  user_id: string;
  amount: number;
  currency?: string;
  gateway_provider: string;
  return_url?: string;
}

export function createThreeDSSession(input: CreateThreeDSSessionInput): ThreeDSSession {
  const db = getDb();
  const tx = getTransactionById(input.transaction_id);
  if (!tx) throw new Error('Transaction not found');

  const cfg = getThreeDSConfig();
  const now = new Date();
  const expires = new Date(now.getTime() + cfg.session_ttl_minutes * 60 * 1000);
  const sessionId = randomUUID();
  // Challenge URL — real gateway would provide a URL; here we produce a
  // deterministic placeholder that a frontend or gateway adapter can consume.
  const challengeUrl = `https://3ds.melodyflix.local/challenge/${sessionId}?provider=${input.gateway_provider}`;

  const session: ThreeDSSession = {
    id: sessionId,
    transaction_id: input.transaction_id,
    user_id: input.user_id,
    status: 'challenged',
    amount: input.amount,
    currency: input.currency ?? tx.currency,
    challenge_url: challengeUrl,
    return_url: input.return_url ?? null,
    attempt_count: 0,
    max_attempts: 3,
    expires_at: expires.toISOString(),
    completed_at: null,
    notes: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  db.prepare(`
    INSERT INTO three_ds_sessions (id, transaction_id, user_id, status, amount, currency,
      challenge_url, return_url, attempt_count, max_attempts, expires_at, completed_at,
      notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.id, session.transaction_id, session.user_id, session.status,
    session.amount, session.currency, session.challenge_url, session.return_url,
    session.attempt_count, session.max_attempts, session.expires_at, session.completed_at,
    session.notes, session.created_at, session.updated_at
  );

  // Mark transaction as requiring 3DS
  db.prepare(`
    UPDATE payment_transactions
    SET requires_3ds = 1, three_ds_session_id = ?, updated_at = ?
    WHERE id = ?
  `).run(session.id, session.updated_at, session.transaction_id);

  return session;
}

export function getThreeDSSession(id: string): ThreeDSSession | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM three_ds_sessions WHERE id = ?').get(id) as ThreeDSSession | undefined) ?? null;
}

export function listThreeDSSessionsByTransaction(txId: string): ThreeDSSession[] {
  const db = getDb();
  return db.prepare('SELECT * FROM three_ds_sessions WHERE transaction_id = ? ORDER BY created_at DESC')
    .all(txId) as ThreeDSSession[];
}

export function listThreeDSSessions(limit = 100, offset = 0, status?: string): ThreeDSSession[] {
  const db = getDb();
  if (status) {
    return db.prepare('SELECT * FROM three_ds_sessions WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(status, limit, offset) as ThreeDSSession[];
  }
  return db.prepare('SELECT * FROM three_ds_sessions ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as ThreeDSSession[];
}

/**
 * Complete 3DS session.
 * outcome = 'passed' → mark tx completed (if not already)
 * outcome = 'failed' → increment attempt; if attempts >= max → fail session
 */
export function completeThreeDSSession(
  sessionId: string,
  outcome: 'passed' | 'failed',
  notes?: string,
): ThreeDSSession | null {
  const db = getDb();
  const s = getThreeDSSession(sessionId);
  if (!s) return null;

  const now = new Date().toISOString();

  // Expiry check
  if (s.status !== 'passed' && s.status !== 'failed' && new Date(s.expires_at) < new Date()) {
    db.prepare(`UPDATE three_ds_sessions SET status = 'expired', updated_at = ? WHERE id = ?`)
      .run(now, sessionId);
    return getThreeDSSession(sessionId);
  }

  if (outcome === 'passed') {
    db.prepare(`
      UPDATE three_ds_sessions
      SET status = 'passed', completed_at = ?, notes = COALESCE(?, notes), updated_at = ?
      WHERE id = ?
    `).run(now, notes ?? null, now, sessionId);

    // Mark transaction completed (3DS success == payment success for our flow)
    updateTransactionStatus(s.transaction_id, 'completed');

    return getThreeDSSession(sessionId);
  }

  // Failed attempt — increment; if at max, mark failed, else keep challenged
  const attempts = s.attempt_count + 1;
  const finalStatus = attempts >= s.max_attempts ? 'failed' : 'challenged';
  db.prepare(`
    UPDATE three_ds_sessions
    SET status = ?, attempt_count = ?, notes = COALESCE(?, notes), updated_at = ?
    WHERE id = ?
  `).run(finalStatus, attempts, notes ?? null, now, sessionId);

  return getThreeDSSession(sessionId);
}

export interface ThreeDSStats {
  total_sessions: number;
  passed_sessions: number;
  failed_sessions: number;
  challenged_sessions: number;
  expired_sessions: number;
  pass_rate: number;
}

export function getThreeDSStats(): ThreeDSStats {
  const db = getDb();
  const rows = db.prepare('SELECT status, COUNT(*) as n FROM three_ds_sessions GROUP BY status')
    .all() as Array<{ status: string; n: number }>;
  const stats: ThreeDSStats = {
    total_sessions: 0, passed_sessions: 0, failed_sessions: 0,
    challenged_sessions: 0, expired_sessions: 0, pass_rate: 0,
  };
  for (const r of rows) {
    stats.total_sessions += r.n;
    if (r.status === 'passed') stats.passed_sessions = r.n;
    else if (r.status === 'failed') stats.failed_sessions = r.n;
    else if (r.status === 'challenged' || r.status === 'pending') stats.challenged_sessions += r.n;
    else if (r.status === 'expired') stats.expired_sessions = r.n;
  }
  const completed = stats.passed_sessions + stats.failed_sessions;
  stats.pass_rate = completed > 0 ? Math.round((stats.passed_sessions / completed) * 10000) / 100 : 0;
  return stats;
}
