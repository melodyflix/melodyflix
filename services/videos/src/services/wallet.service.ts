// melodyflix videos — Wallet & Credits (Section 83)
// 83.1 User Wallet  83.2 Gift Cards  83.3 Promotional Credits  83.4 Transaction History
import { randomUUID, createHash } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type WalletCurrency = 'BDT' | 'USD' | 'INR';
export type TransactionKind =
  | 'topup' | 'spend' | 'refund' | 'promo_credit' | 'gift_card_redeem'
  | 'payout' | 'transfer_in' | 'transfer_out' | 'adjustment';
export type TransactionStatus = 'pending' | 'completed' | 'failed' | 'reversed';
export type GiftCardStatus = 'active' | 'redeemed' | 'expired' | 'cancelled';

export interface Wallet {
  user_id: string;
  currency: WalletCurrency;
  balance_cents: number;       // stored in minor units (paisa/cents)
  lifetime_topup_cents: number;
  lifetime_spend_cents: number;
  is_frozen: number;
  created_at: string;
  updated_at: string;
}

export interface WalletTransaction {
  id: string;
  user_id: string;
  kind: TransactionKind;
  status: TransactionStatus;
  amount_cents: number;        // positive for credit, negative for debit
  balance_after_cents: number;
  currency: WalletCurrency;
  reference_id: string | null;
  description: string;
  metadata_json: string | null;
  created_at: string;
}

export interface GiftCard {
  id: string;
  code_hash: string;           // SHA-256 of the raw code (never store raw)
  code_prefix: string;         // first 4 chars for lookup display
  initial_amount_cents: number;
  remaining_amount_cents: number;
  currency: WalletCurrency;
  status: GiftCardStatus;
  issued_by: string | null;
  redeemed_by: string | null;
  redeemed_at: string | null;
  expires_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface PromoCredit {
  id: string;
  user_id: string;
  amount_cents: number;
  currency: WalletCurrency;
  reason: string;
  source: string | null;
  expires_at: string | null;
  consumed_at: string | null;
  created_by: string | null;
  created_at: string;
}

const MAX_TRANSFER_CENTS = 5_000_00; // 5000 BDT

export function ensureWalletSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      user_id TEXT PRIMARY KEY,
      currency TEXT NOT NULL DEFAULT 'BDT',
      balance_cents INTEGER NOT NULL DEFAULT 0,
      lifetime_topup_cents INTEGER NOT NULL DEFAULT 0,
      lifetime_spend_cents INTEGER NOT NULL DEFAULT 0,
      is_frozen INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wallets_balance ON wallets(balance_cents DESC);

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      amount_cents INTEGER NOT NULL,
      balance_after_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      reference_id TEXT,
      description TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wtx_user ON wallet_transactions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wtx_kind ON wallet_transactions(kind, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wtx_ref ON wallet_transactions(reference_id);

    CREATE TABLE IF NOT EXISTS gift_cards (
      id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL UNIQUE,
      code_prefix TEXT NOT NULL,
      initial_amount_cents INTEGER NOT NULL,
      remaining_amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'BDT',
      status TEXT NOT NULL DEFAULT 'active',
      issued_by TEXT,
      redeemed_by TEXT,
      redeemed_at TEXT,
      expires_at TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gift_status ON gift_cards(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_gift_redeemed_by ON gift_cards(redeemed_by);

    CREATE TABLE IF NOT EXISTS promo_credits (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'BDT',
      reason TEXT NOT NULL,
      source TEXT,
      expires_at TEXT,
      consumed_at TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_promo_user ON promo_credits(user_id, consumed_at);
    CREATE INDEX IF NOT EXISTS idx_promo_expires ON promo_credits(expires_at);
  `);
}

// ============================================================
// 83.1 — Wallet
// ============================================================

function ensureWalletRow(userId: string): Wallet {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId) as Wallet | undefined;
  if (existing) return existing;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO wallets (user_id, currency, balance_cents, lifetime_topup_cents,
      lifetime_spend_cents, is_frozen, created_at, updated_at)
    VALUES (?, 'BDT', 0, 0, 0, 0, ?, ?)
  `).run(userId, now, now);
  return getWallet(userId)!;
}

export function getWallet(userId: string): Wallet | null {
  return (getDb().prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId) as Wallet | undefined) ?? null;
}

export function getOrCreateWallet(userId: string): Wallet {
  return ensureWalletRow(userId);
}

export function freezeWallet(userId: string, frozen: boolean): Wallet {
  ensureWalletRow(userId);
  const now = new Date().toISOString();
  getDb().prepare('UPDATE wallets SET is_frozen = ?, updated_at = ? WHERE user_id = ?')
    .run(frozen ? 1 : 0, now, userId);
  return getWallet(userId)!;
}

// ============================================================
// 83.4 — Transaction core (used by all mutations)
// ============================================================

function applyTransaction(input: {
  user_id: string;
  kind: TransactionKind;
  amount_cents: number;         // positive = credit, negative = debit
  description: string;
  reference_id?: string | null;
  metadata?: Record<string, unknown> | null;
  allow_negative?: boolean;
  skip_tx?: boolean;            // when caller already owns a transaction
}): WalletTransaction {
  if (input.amount_cents === 0) throw new Error('amount_cents must be non-zero');
  const db = getDb();
  const wallet = ensureWalletRow(input.user_id);
  if (wallet.is_frozen === 1 && input.amount_cents < 0) {
    throw new Error('Wallet is frozen');
  }

  const newBalance = wallet.balance_cents + input.amount_cents;
  if (newBalance < 0 && !input.allow_negative) {
    throw new Error('Insufficient balance');
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const isTopup = input.amount_cents > 0 && input.kind === 'topup';

  const ownTx = !input.skip_tx;
  if (ownTx) db.exec('BEGIN');
  try {
    db.prepare(`
      UPDATE wallets SET balance_cents = ?, updated_at = ?,
        lifetime_topup_cents = lifetime_topup_cents + ?,
        lifetime_spend_cents = lifetime_spend_cents + ?
      WHERE user_id = ?
    `).run(
      newBalance, now,
      isTopup ? input.amount_cents : 0,
      input.amount_cents < 0 ? -input.amount_cents : 0,
      input.user_id,
    );
    db.prepare(`
      INSERT INTO wallet_transactions
        (id, user_id, kind, status, amount_cents, balance_after_cents, currency,
         reference_id, description, metadata_json, created_at)
      VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.user_id, input.kind, input.amount_cents, newBalance, wallet.currency,
      input.reference_id ?? null, input.description,
      input.metadata ? JSON.stringify(input.metadata) : null, now,
    );
    if (ownTx) db.exec('COMMIT');
  } catch (e) { if (ownTx) db.exec('ROLLBACK'); throw e; }

  return db.prepare('SELECT * FROM wallet_transactions WHERE id = ?').get(id) as WalletTransaction;
}

// ============================================================
// 83.1 — Top-up / Spend
// ============================================================

export function topUpWallet(userId: string, amountCents: number, opts: {
  reference_id?: string | null;
  description?: string;
  metadata?: Record<string, unknown> | null;
} = {}): WalletTransaction {
  if (amountCents <= 0) throw new Error('amount must be positive');
  if (amountCents > 1_000_000_00) throw new Error('top-up exceeds max (1,000,000)');
  return applyTransaction({
    user_id: userId,
    kind: 'topup',
    amount_cents: amountCents,
    description: opts.description ?? 'Wallet top-up',
    reference_id: opts.reference_id,
    metadata: opts.metadata,
  });
}

export function spendFromWallet(userId: string, amountCents: number, opts: {
  reference_id?: string | null;
  description?: string;
  metadata?: Record<string, unknown> | null;
} = {}): WalletTransaction {
  if (amountCents <= 0) throw new Error('amount must be positive');
  return applyTransaction({
    user_id: userId,
    kind: 'spend',
    amount_cents: -amountCents,
    description: opts.description ?? 'Wallet spend',
    reference_id: opts.reference_id,
    metadata: opts.metadata,
  });
}

export function refundToWallet(userId: string, amountCents: number, opts: {
  reference_id?: string | null;
  description?: string;
} = {}): WalletTransaction {
  if (amountCents <= 0) throw new Error('amount must be positive');
  return applyTransaction({
    user_id: userId,
    kind: 'refund',
    amount_cents: amountCents,
    description: opts.description ?? 'Refund',
    reference_id: opts.reference_id,
  });
}

export function transferBetweenWallets(fromUserId: string, toUserId: string, amountCents: number, note?: string): {
  debit: WalletTransaction;
  credit: WalletTransaction;
} {
  if (fromUserId === toUserId) throw new Error('Cannot transfer to yourself');
  if (amountCents <= 0) throw new Error('amount must be positive');
  if (amountCents > MAX_TRANSFER_CENTS) throw new Error(`Transfer exceeds max ${MAX_TRANSFER_CENTS / 100}`);

  const db = getDb();
  db.exec('BEGIN');
  try {
    const ref = randomUUID();
    const debit = applyTransaction({
      user_id: fromUserId, kind: 'transfer_out', amount_cents: -amountCents,
      description: note ?? `Transfer to ${toUserId.slice(0, 8)}`, reference_id: ref,
      skip_tx: true,
    });
    const credit = applyTransaction({
      user_id: toUserId, kind: 'transfer_in', amount_cents: amountCents,
      description: note ?? `Transfer from ${fromUserId.slice(0, 8)}`, reference_id: ref,
      skip_tx: true,
    });
    db.exec('COMMIT');
    return { debit, credit };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ============================================================
// 83.4 — Transaction History
// ============================================================

export function listTransactions(userId: string, opts: {
  kind?: TransactionKind;
  limit?: number;
  offset?: number;
  from?: string;
  to?: string;
} = {}): { transactions: WalletTransaction[]; total: number } {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const filters: string[] = ['user_id = ?'];
  const params: any[] = [userId];
  if (opts.kind) { filters.push('kind = ?'); params.push(opts.kind); }
  if (opts.from) { filters.push('created_at >= ?'); params.push(opts.from); }
  if (opts.to) { filters.push('created_at <= ?'); params.push(opts.to); }

  const where = filters.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) as n FROM wallet_transactions WHERE ${where}`)
    .get(...params) as { n: number }).n;

  const transactions = db.prepare(
    `SELECT * FROM wallet_transactions WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as WalletTransaction[];

  return { transactions, total };
}

export interface WalletSummary {
  balance_cents: number;
  currency: WalletCurrency;
  lifetime_topup_cents: number;
  lifetime_spend_cents: number;
  active_promo_cents: number;
  recent_30d_credits: number;
  recent_30d_debits: number;
}

export function getWalletSummary(userId: string): WalletSummary {
  const db = getDb();
  const wallet = getOrCreateWallet(userId);
  const now = new Date();
  const cutoff = new Date(now.getTime() - 30 * 86400_000).toISOString();

  const activePromo = (db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) as s FROM promo_credits
    WHERE user_id = ? AND consumed_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
  `).get(userId, now.toISOString()) as { s: number }).s;

  const credits30d = (db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) as s FROM wallet_transactions
    WHERE user_id = ? AND amount_cents > 0 AND created_at >= ?
  `).get(userId, cutoff) as { s: number }).s;

  const debits30d = (db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) as s FROM wallet_transactions
    WHERE user_id = ? AND amount_cents < 0 AND created_at >= ?
  `).get(userId, cutoff) as { s: number }).s;

  return {
    balance_cents: wallet.balance_cents,
    currency: wallet.currency,
    lifetime_topup_cents: wallet.lifetime_topup_cents,
    lifetime_spend_cents: wallet.lifetime_spend_cents,
    active_promo_cents: activePromo,
    recent_30d_credits: credits30d,
    recent_30d_debits: Math.abs(debits30d),
  };
}

// ============================================================
// 83.3 — Promotional Credits
// ============================================================

export function grantPromoCredit(input: {
  user_id: string;
  amount_cents: number;
  reason: string;
  source?: string | null;
  expires_at?: string | null;
  created_by?: string | null;
}): PromoCredit {
  if (input.amount_cents <= 0) throw new Error('amount must be positive');
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO promo_credits
      (id, user_id, amount_cents, currency, reason, source, expires_at, consumed_at, created_by, created_at)
    VALUES (?, ?, ?, 'BDT', ?, ?, ?, NULL, ?, ?)
  `).run(id, input.user_id, input.amount_cents, input.reason,
    input.source ?? null, input.expires_at ?? null, input.created_by ?? null, now);

  const credit = db.prepare('SELECT * FROM promo_credits WHERE id = ?').get(id) as PromoCredit;

  // Record wallet transaction but do not add to balance until consumed
  return credit;
}

export function listPromoCredits(userId: string, opts: { active_only?: boolean; limit?: number } = {}): PromoCredit[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const filters: string[] = ['user_id = ?'];
  const params: any[] = [userId];
  if (opts.active_only) {
    filters.push('consumed_at IS NULL');
    filters.push('(expires_at IS NULL OR expires_at > ?)');
    params.push(new Date().toISOString());
  }
  params.push(limit);
  return db.prepare(
    `SELECT * FROM promo_credits WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT ?`
  ).all(...params) as PromoCredit[];
}

/**
 * Consume active promo credits up to `amountCents`.
 * Returns total consumed and the wallet transaction created.
 */
export function consumePromoCredits(userId: string, amountCents: number, reference?: string): {
  consumed_cents: number;
  remaining_cents: number;
  transaction: WalletTransaction | null;
} {
  if (amountCents <= 0) throw new Error('amount must be positive');
  const db = getDb();
  const now = new Date().toISOString();

  const active = db.prepare(`
    SELECT * FROM promo_credits
    WHERE user_id = ? AND consumed_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY created_at ASC
  `).all(userId, now) as PromoCredit[];

  let remaining = amountCents;
  let consumed = 0;
  let tx: WalletTransaction | null = null;

  db.exec('BEGIN');
  try {
    for (const pc of active) {
      if (remaining <= 0) break;
      if (pc.amount_cents <= remaining) {
        db.prepare('UPDATE promo_credits SET consumed_at = ? WHERE id = ?').run(now, pc.id);
        consumed += pc.amount_cents;
        remaining -= pc.amount_cents;
      } else {
        // Partial consume: reduce amount and mark consumed_at
        db.prepare('UPDATE promo_credits SET amount_cents = ?, consumed_at = ? WHERE id = ?')
          .run(pc.amount_cents - remaining, now, pc.id);
        consumed += remaining;
        remaining = 0;
      }
    }

    if (consumed > 0) {
      tx = applyTransaction({
        user_id: userId,
        kind: 'promo_credit',
        amount_cents: consumed,
        description: 'Promo credits applied',
        reference_id: reference ?? null,
        skip_tx: true,
      });
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  return { consumed_cents: consumed, remaining_cents: remaining, transaction: tx };
}

// ============================================================
// 83.2 — Gift Cards
// ============================================================

function hashCode(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function generateGiftCode(): { raw: string; hash: string; prefix: string } {
  // Format: MFXX-XXXX-XXXX-XXXX-XXXX (20 chars after MFXX-)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const raw = 'MFXX-' + [block(), block(), block(), block()].join('-');
  return { raw, hash: hashCode(raw), prefix: raw.slice(0, 8) };
}

export function createGiftCard(input: {
  initial_amount_cents: number;
  issued_by?: string | null;
  expires_at?: string | null;
  note?: string | null;
}): { gift_card: GiftCard; raw_code: string } {
  if (input.initial_amount_cents <= 0) throw new Error('amount must be positive');
  if (input.initial_amount_cents > 100_000_00) throw new Error('gift card amount too large');
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const { raw, hash, prefix } = generateGiftCode();

  db.prepare(`
    INSERT INTO gift_cards
      (id, code_hash, code_prefix, initial_amount_cents, remaining_amount_cents,
       currency, status, issued_by, redeemed_by, redeemed_at, expires_at, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'BDT', 'active', ?, NULL, NULL, ?, ?, ?, ?)
  `).run(id, hash, prefix, input.initial_amount_cents, input.initial_amount_cents,
    input.issued_by ?? null, input.expires_at ?? null, input.note ?? null, now, now);

  const card = db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(id) as GiftCard;
  return { gift_card: card, raw_code: raw };
}

export function getGiftCardByPrefix(prefix: string): GiftCard | null {
  return (getDb().prepare('SELECT * FROM gift_cards WHERE code_prefix = ?').get(prefix) as GiftCard | undefined) ?? null;
}

export function getGiftCardById(id: string): GiftCard | null {
  return (getDb().prepare('SELECT * FROM gift_cards WHERE id = ?').get(id) as GiftCard | undefined) ?? null;
}

export function redeemGiftCard(rawCode: string, userId: string): {
  card: GiftCard;
  transaction: WalletTransaction;
} {
  const clean = rawCode.trim().toUpperCase().replace(/\s+/g, '');
  if (!clean) throw new Error('Gift card code required');
  const hash = hashCode(clean);
  const db = getDb();
  const card = db.prepare('SELECT * FROM gift_cards WHERE code_hash = ?').get(hash) as GiftCard | undefined;
  if (!card) throw new Error('Invalid gift card');
  if (card.status === 'redeemed') throw new Error('Gift card already redeemed');
  if (card.status === 'cancelled') throw new Error('Gift card cancelled');
  if (card.status === 'expired') throw new Error('Gift card expired');
  if (card.expires_at && new Date(card.expires_at) < new Date()) throw new Error('Gift card expired');

  const now = new Date().toISOString();
  const amount = card.remaining_amount_cents;

  db.exec('BEGIN');
  try {
    db.prepare(`
      UPDATE gift_cards SET status = 'redeemed', redeemed_by = ?, redeemed_at = ?,
        remaining_amount_cents = 0, updated_at = ? WHERE id = ?
    `).run(userId, now, now, card.id);

    const tx = applyTransaction({
      user_id: userId, kind: 'gift_card_redeem', amount_cents: amount,
      description: `Gift card ${card.code_prefix} redeemed`, reference_id: card.id,
      skip_tx: true,
    });
    db.exec('COMMIT');
    return { card: getGiftCardById(card.id)!, transaction: tx };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function cancelGiftCard(id: string, issuedBy: string): boolean {
  const db = getDb();
  const card = getGiftCardById(id);
  if (!card || card.issued_by !== issuedBy) return false;
  if (card.status !== 'active') return false;
  const info = db.prepare(
    "UPDATE gift_cards SET status = 'cancelled', updated_at = ? WHERE id = ?"
  ).run(new Date().toISOString(), id);
  return Number(info.changes ?? 0) > 0;
}

export function listIssuedGiftCards(issuedBy: string, limit = 100): GiftCard[] {
  return getDb().prepare(
    'SELECT * FROM gift_cards WHERE issued_by = ? ORDER BY created_at DESC LIMIT ?'
  ).all(issuedBy, Math.min(Math.max(limit, 1), 500)) as GiftCard[];
}

export function listRedeemedGiftCards(userId: string, limit = 100): GiftCard[] {
  return getDb().prepare(
    'SELECT * FROM gift_cards WHERE redeemed_by = ? ORDER BY redeemed_at DESC LIMIT ?'
  ).all(userId, Math.min(Math.max(limit, 1), 500)) as GiftCard[];
}
