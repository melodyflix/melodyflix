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
  `);
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
