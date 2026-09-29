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
