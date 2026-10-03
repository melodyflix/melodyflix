// melodyflix videos — Payouts + KYC (10.10 Revenue Sharing, 10.11 Payout Schedule,
// 10.12 Minimum Payout Limit, 10.13 Tax/KYC Verification)

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type PayoutState = 'pending' | 'approved' | 'processing' | 'paid' | 'failed' | 'cancelled';
export type PayoutSchedule = 'weekly' | 'biweekly' | 'monthly' | 'threshold';
export type KYCStatus = 'none' | 'pending' | 'verified' | 'rejected' | 'expired';
export type KYCDocType = 'government_id' | 'passport' | 'drivers_license' | 'tax_form_w9' | 'tax_form_w8ben';

export function ensurePayoutSchema(): void {
  const db = getDb();
  db.exec(`
    -- 10.10 Revenue sharing: per-owner split config
    CREATE TABLE IF NOT EXISTS revenue_share_config (
      owner_id TEXT PRIMARY KEY,
      creator_share_pct REAL NOT NULL DEFAULT 70,
      platform_share_pct REAL NOT NULL DEFAULT 30,
      updated_at TEXT NOT NULL
    );

    -- 10.11 Payout schedule + 10.12 Minimum payout limit
    CREATE TABLE IF NOT EXISTS payout_settings (
      owner_id TEXT PRIMARY KEY,
      schedule TEXT NOT NULL DEFAULT 'monthly'
        CHECK (schedule IN ('weekly','biweekly','monthly','threshold')),
      min_payout_cents INTEGER NOT NULL DEFAULT 5000,
      payout_currency TEXT NOT NULL DEFAULT 'USD',
      payout_method TEXT,
      payout_details_json TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_payout_at TEXT,
      next_payout_at TEXT,
      updated_at TEXT NOT NULL
    );

    -- Running balance per owner (in cents to avoid float)
    CREATE TABLE IF NOT EXISTS payout_balances (
      owner_id TEXT PRIMARY KEY,
      pending_cents INTEGER NOT NULL DEFAULT 0,
      available_cents INTEGER NOT NULL DEFAULT 0,
      lifetime_cents INTEGER NOT NULL DEFAULT 0,
      lifetime_paid_cents INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    -- Individual payout records
    CREATE TABLE IF NOT EXISTS payouts (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      state TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending','approved','processing','paid','failed','cancelled')),
      method TEXT,
      reference TEXT,
      error_message TEXT,
      scheduled_for TEXT,
      paid_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_payouts_owner
      ON payouts(owner_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_payouts_state
      ON payouts(state, scheduled_for);

    -- Ledger — every credit/debit against a payout balance
    CREATE TABLE IF NOT EXISTS payout_ledger (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      kind TEXT NOT NULL
        CHECK (kind IN ('earning','adjustment','payout_debit','refund_debit','fee')),
      source TEXT,
      reference_id TEXT,
      amount_cents INTEGER NOT NULL, -- positive = credit, negative = debit
      currency TEXT NOT NULL DEFAULT 'USD',
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_owner
      ON payout_ledger(owner_id, created_at DESC);

    -- 10.13 KYC / tax verification
    CREATE TABLE IF NOT EXISTS kyc_profiles (
      owner_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'none'
        CHECK (status IN ('none','pending','verified','rejected','expired')),
      legal_name TEXT,
      country TEXT,
      tax_id_last4 TEXT,
      business_type TEXT,
      submitted_at TEXT,
      verified_at TEXT,
      rejected_reason TEXT,
      expires_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kyc_documents (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      doc_type TEXT NOT NULL
        CHECK (doc_type IN ('government_id','passport','drivers_license','tax_form_w9','tax_form_w8ben')),
      file_url TEXT NOT NULL,
      file_hash TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','rejected')),
      review_notes TEXT,
      uploaded_at TEXT NOT NULL,
      reviewed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_kyc_docs_owner
      ON kyc_documents(owner_id, uploaded_at DESC);
  `);
}

const MIN_MIN_PAYOUT_CENTS = 1000;       // $10 floor for min_payout
const MAX_MIN_PAYOUT_CENTS = 1_000_000;  // $10,000 ceiling
const MIN_PAYOUT_CENTS = 1000;           // hard floor: never schedule below $10

// ============================================================
// 10.10 Revenue Sharing
// ============================================================

export interface RevenueShareConfig {
  owner_id: string;
  creator_share_pct: number;
  platform_share_pct: number;
  updated_at: string;
}

export function getRevenueShare(ownerId: string): RevenueShareConfig {
  const row = getDb().prepare(
    'SELECT * FROM revenue_share_config WHERE owner_id = ?'
  ).get(ownerId) as RevenueShareConfig | undefined;
  if (row) return row;
  return {
    owner_id: ownerId,
    creator_share_pct: 70,
    platform_share_pct: 30,
    updated_at: new Date(0).toISOString(),
  };
}

export function setRevenueShare(ownerId: string, creatorSharePct: number): RevenueShareConfig {
  if (creatorSharePct < 0 || creatorSharePct > 100) {
    throw new Error('creator_share_pct must be 0-100');
  }
  const db = getDb();
  const now = new Date().toISOString();
  const platform = Math.round((100 - creatorSharePct) * 100) / 100;
  db.prepare(`
    INSERT INTO revenue_share_config (owner_id, creator_share_pct, platform_share_pct, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(owner_id) DO UPDATE SET
      creator_share_pct = excluded.creator_share_pct,
      platform_share_pct = excluded.platform_share_pct,
      updated_at = excluded.updated_at
  `).run(ownerId, creatorSharePct, platform, now);
  return getRevenueShare(ownerId);
}

// Split a revenue amount (in cents) into creator + platform shares
export interface RevenueSplit {
  owner_id: string;
  gross_cents: number;
  creator_share_pct: number;
  platform_share_pct: number;
  creator_cents: number;
  platform_cents: number;
}

export function splitRevenue(ownerId: string, grossCents: number): RevenueSplit {
  const cfg = getRevenueShare(ownerId);
  const platform = Math.round(grossCents * cfg.platform_share_pct / 100);
  const creator = grossCents - platform;
  return {
    owner_id: ownerId,
    gross_cents: grossCents,
    creator_share_pct: cfg.creator_share_pct,
    platform_share_pct: cfg.platform_share_pct,
    creator_cents: creator,
    platform_cents: platform,
  };
}

// ============================================================
// Balance / ledger
// ============================================================

export interface PayoutBalance {
  owner_id: string;
  pending_cents: number;
  available_cents: number;
  lifetime_cents: number;
  lifetime_paid_cents: number;
  updated_at: string;
}

export function getBalance(ownerId: string): PayoutBalance {
  const row = getDb().prepare(
    'SELECT * FROM payout_balances WHERE owner_id = ?'
  ).get(ownerId) as PayoutBalance | undefined;
  if (row) return row;
  return {
    owner_id: ownerId,
    pending_cents: 0, available_cents: 0,
    lifetime_cents: 0, lifetime_paid_cents: 0,
    updated_at: new Date(0).toISOString(),
  };
}

// Credits: revenue earned from ads/donations/etc
export function creditEarning(input: {
  owner_id: string;
  gross_cents: number;
  source: string;
  reference_id?: string | null;
  note?: string | null;
}): { split: RevenueSplit; balance: PayoutBalance } {
  if (input.gross_cents <= 0) throw new Error('gross_cents must be > 0');
  const split = splitRevenue(input.owner_id, input.gross_cents);
  const db = getDb();
  const now = new Date().toISOString();
  const ledgerId = randomUUID();

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO payout_ledger
        (id, owner_id, kind, source, reference_id, amount_cents, currency, note, created_at)
      VALUES (?, ?, 'earning', ?, ?, ?, 'USD', ?, ?)
    `).run(
      ledgerId, input.owner_id, input.source,
      input.reference_id ?? null,
      split.creator_cents, input.note ?? null, now,
    );

    db.prepare(`
      INSERT INTO payout_balances (owner_id, pending_cents, available_cents, lifetime_cents, lifetime_paid_cents, updated_at)
      VALUES (?, ?, 0, ?, 0, ?)
      ON CONFLICT(owner_id) DO UPDATE SET
        pending_cents = pending_cents + ?,
        lifetime_cents = lifetime_cents + ?,
        updated_at = ?
    `).run(
      input.owner_id, split.creator_cents, split.creator_cents, now,
      split.creator_cents, split.creator_cents, now,
    );

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { split, balance: getBalance(input.owner_id) };
}

// After a hold period, pending earnings become available
export function releasePending(ownerId: string): PayoutBalance {
  const db = getDb();
  const now = new Date().toISOString();
  const bal = getBalance(ownerId);
  if (bal.pending_cents <= 0) return bal;
  db.exec('BEGIN');
  try {
    db.prepare(`
      UPDATE payout_balances
      SET available_cents = available_cents + pending_cents,
          pending_cents = 0,
          updated_at = ?
      WHERE owner_id = ?
    `).run(now, ownerId);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return getBalance(ownerId);
}

// ============================================================
// 10.11 Payout Schedule + 10.12 Minimum Payout Limit
// ============================================================

export interface PayoutSettings {
  owner_id: string;
  schedule: PayoutSchedule;
  min_payout_cents: number;
  payout_currency: string;
  payout_method: string | null;
  payout_details_json: string | null;
  is_active: number;
  last_payout_at: string | null;
  next_payout_at: string | null;
  updated_at: string;
}

export function getPayoutSettings(ownerId: string): PayoutSettings {
  const row = getDb().prepare(
    'SELECT * FROM payout_settings WHERE owner_id = ?'
  ).get(ownerId) as PayoutSettings | undefined;
  if (row) return row;
  const now = new Date().toISOString();
  return {
    owner_id: ownerId,
    schedule: 'monthly',
    min_payout_cents: 5000,
    payout_currency: 'USD',
    payout_method: null,
    payout_details_json: null,
    is_active: 1,
    last_payout_at: null,
    next_payout_at: null,
    updated_at: now,
  };
}

export interface SetPayoutSettingsInput {
  schedule?: PayoutSchedule;
  min_payout_cents?: number;
  payout_currency?: string;
  payout_method?: string | null;
  payout_details_json?: string | null;
  is_active?: boolean;
}

export function setPayoutSettings(ownerId: string, patch: SetPayoutSettingsInput): PayoutSettings {
  const cur = getPayoutSettings(ownerId);
  const now = new Date().toISOString();

  const minPayout = patch.min_payout_cents === undefined
    ? cur.min_payout_cents
    : Math.max(MIN_MIN_PAYOUT_CENTS, Math.min(patch.min_payout_cents, MAX_MIN_PAYOUT_CENTS));

  const schedule = patch.schedule ?? cur.schedule;
  const nextPayout = computeNextPayout(schedule, now);

  const db = getDb();
  db.prepare(`
    INSERT INTO payout_settings
      (owner_id, schedule, min_payout_cents, payout_currency, payout_method,
       payout_details_json, is_active, last_payout_at, next_payout_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    ON CONFLICT(owner_id) DO UPDATE SET
      schedule = excluded.schedule,
      min_payout_cents = excluded.min_payout_cents,
      payout_currency = excluded.payout_currency,
      payout_method = excluded.payout_method,
      payout_details_json = excluded.payout_details_json,
      is_active = excluded.is_active,
      next_payout_at = excluded.next_payout_at,
      updated_at = excluded.updated_at
  `).run(
    ownerId, schedule, minPayout,
    (patch.payout_currency ?? cur.payout_currency).toUpperCase().slice(0, 3),
    patch.payout_method === undefined ? cur.payout_method : patch.payout_method,
    patch.payout_details_json === undefined ? cur.payout_details_json : patch.payout_details_json,
    patch.is_active === undefined ? cur.is_active : (patch.is_active ? 1 : 0),
    nextPayout, now,
  );
  return getPayoutSettings(ownerId);
}

// Compute next payout date based on schedule
export function computeNextPayout(schedule: PayoutSchedule, fromIso: string): string | null {
  if (schedule === 'threshold') return null; // trigger-only, no scheduled date
  const from = new Date(fromIso);
  const next = new Date(from);
  if (schedule === 'weekly') next.setDate(from.getDate() + 7);
  else if (schedule === 'biweekly') next.setDate(from.getDate() + 14);
  else if (schedule === 'monthly') next.setMonth(from.getMonth() + 1);
  else return null;
  return next.toISOString();
}

// ============================================================
// 10.13 KYC / Tax verification
// ============================================================

export interface KYCProfile {
  owner_id: string;
  status: KYCStatus;
  legal_name: string | null;
  country: string | null;
  tax_id_last4: string | null;
  business_type: string | null;
  submitted_at: string | null;
  verified_at: string | null;
  rejected_reason: string | null;
  expires_at: string | null;
  updated_at: string;
}

export function getKYC(ownerId: string): KYCProfile {
  const row = getDb().prepare(
    'SELECT * FROM kyc_profiles WHERE owner_id = ?'
  ).get(ownerId) as KYCProfile | undefined;
  if (row) return row;
  return {
    owner_id: ownerId,
    status: 'none',
    legal_name: null, country: null, tax_id_last4: null,
    business_type: null,
    submitted_at: null, verified_at: null,
    rejected_reason: null, expires_at: null,
    updated_at: new Date(0).toISOString(),
  };
}

export interface SubmitKYCInput {
  owner_id: string;
  legal_name: string;
  country: string;
  tax_id: string;
  business_type?: string | null;
}

export function submitKYC(input: SubmitKYCInput): KYCProfile {
  if (!input.legal_name?.trim()) throw new Error('legal_name required');
  if (!input.country?.trim() || input.country.length !== 2) throw new Error('country must be ISO-2');
  if (!input.tax_id?.trim() || input.tax_id.length < 4) throw new Error('tax_id required (min 4 chars)');

  const db = getDb();
  const now = new Date().toISOString();
  const last4 = input.tax_id.slice(-4);

  db.prepare(`
    INSERT INTO kyc_profiles
      (owner_id, status, legal_name, country, tax_id_last4, business_type,
       submitted_at, verified_at, rejected_reason, expires_at, updated_at)
    VALUES (?, 'pending', ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)
    ON CONFLICT(owner_id) DO UPDATE SET
      status = 'pending',
      legal_name = excluded.legal_name,
      country = excluded.country,
      tax_id_last4 = excluded.tax_id_last4,
      business_type = excluded.business_type,
      submitted_at = excluded.submitted_at,
      verified_at = NULL,
      rejected_reason = NULL,
      updated_at = excluded.updated_at
  `).run(
    input.owner_id, input.legal_name.trim(),
    input.country.toUpperCase(), last4,
    input.business_type ?? null, now, now,
  );
  return getKYC(input.owner_id);
}

export function verifyKYC(ownerId: string, yearsValid = 2): KYCProfile {
  const cur = getKYC(ownerId);
  if (cur.status !== 'pending') throw new Error('KYC is not pending');
  const db = getDb();
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + yearsValid * 365 * 86400_000).toISOString();
  db.prepare(`
    UPDATE kyc_profiles
    SET status = 'verified', verified_at = ?, expires_at = ?, updated_at = ?
    WHERE owner_id = ?
  `).run(now, expires, now, ownerId);
  return getKYC(ownerId);
}

export function rejectKYC(ownerId: string, reason: string): KYCProfile {
  const cur = getKYC(ownerId);
  if (cur.status !== 'pending') throw new Error('KYC is not pending');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE kyc_profiles
    SET status = 'rejected', rejected_reason = ?, updated_at = ?
    WHERE owner_id = ?
  `).run(reason.slice(0, 500), now, ownerId);
  return getKYC(ownerId);
}

export interface KYCDocument {
  id: string;
  owner_id: string;
  doc_type: KYCDocType;
  file_url: string;
  file_hash: string | null;
  status: 'pending' | 'approved' | 'rejected';
  review_notes: string | null;
  uploaded_at: string;
  reviewed_at: string | null;
}

export function addKYCDocument(input: {
  owner_id: string;
  doc_type: KYCDocType;
  file_url: string;
  file_hash?: string | null;
}): KYCDocument {
  if (!/^https?:\/\//i.test(input.file_url)) throw new Error('file_url must be http(s)');
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO kyc_documents
      (id, owner_id, doc_type, file_url, file_hash, status, review_notes, uploaded_at, reviewed_at)
    VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, NULL)
  `).run(id, input.owner_id, input.doc_type, input.file_url, input.file_hash ?? null, now);
  return db.prepare('SELECT * FROM kyc_documents WHERE id = ?').get(id) as KYCDocument;
}

export function listKYCDocuments(ownerId: string): KYCDocument[] {
  return getDb().prepare(
    'SELECT * FROM kyc_documents WHERE owner_id = ? ORDER BY uploaded_at DESC'
  ).all(ownerId) as KYCDocument[];
}

export function reviewKYCDocument(id: string, decision: 'approved' | 'rejected', notes?: string): KYCDocument | null {
  const db = getDb();
  const cur = db.prepare('SELECT * FROM kyc_documents WHERE id = ?').get(id) as KYCDocument | undefined;
  if (!cur) return null;
  const now = new Date().toISOString();
  db.prepare(`UPDATE kyc_documents SET status = ?, review_notes = ?, reviewed_at = ? WHERE id = ?`)
    .run(decision, notes ?? null, now, id);
  return db.prepare('SELECT * FROM kyc_documents WHERE id = ?').get(id) as KYCDocument;
}

// ============================================================
// Payout creation + lifecycle
// ============================================================

export interface Payout {
  id: string;
  owner_id: string;
  amount_cents: number;
  currency: string;
  state: PayoutState;
  method: string | null;
  reference: string | null;
  error_message: string | null;
  scheduled_for: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RequestPayoutResult {
  ok: boolean;
  reason?: 'kyc_not_verified' | 'inactive' | 'below_minimum' | 'insufficient_balance';
  payout?: Payout;
  balance: PayoutBalance;
  settings: PayoutSettings;
  kyc: KYCProfile;
}

// Owner-initiated payout (or worker-generated)
export function requestPayout(ownerId: string, opts: { force?: boolean; scheduledFor?: string | null } = {}): RequestPayoutResult {
  const settings = getPayoutSettings(ownerId);
  const balance = getBalance(ownerId);
  const kyc = getKYC(ownerId);

  if (settings.is_active !== 1 && !opts.force) {
    return { ok: false, reason: 'inactive', balance, settings, kyc };
  }

  // KYC gate
  if (kyc.status !== 'verified') {
    return { ok: false, reason: 'kyc_not_verified', balance, settings, kyc };
  }
  // Expired verification also blocks
  if (kyc.expires_at && new Date(kyc.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'kyc_not_verified', balance, settings, kyc };
  }

  // Zero balance → distinct reason from "some balance but below min"
  if (balance.available_cents <= 0) {
    return { ok: false, reason: 'insufficient_balance', balance, settings, kyc };
  }

  // Minimum payout gate (unless forced)
  if (!opts.force && balance.available_cents < Math.max(settings.min_payout_cents, MIN_PAYOUT_CENTS)) {
    return { ok: false, reason: 'below_minimum', balance, settings, kyc };
  }

  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO payouts
        (id, owner_id, amount_cents, currency, state, method, reference,
         error_message, scheduled_for, paid_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, NULL, NULL, ?, NULL, ?, ?)
    `).run(
      id, ownerId, balance.available_cents,
      settings.payout_currency,
      settings.payout_method, opts.scheduledFor ?? now, now, now,
    );

    // Debit available balance + ledger
    db.prepare(`
      UPDATE payout_balances
      SET available_cents = available_cents - ?, updated_at = ?
      WHERE owner_id = ?
    `).run(balance.available_cents, now, ownerId);

    db.prepare(`
      INSERT INTO payout_ledger
        (id, owner_id, kind, source, reference_id, amount_cents, currency, note, created_at)
      VALUES (?, ?, 'payout_debit', 'payout_request', ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), ownerId, id,
      -balance.available_cents, settings.payout_currency,
      'Scheduled payout', now,
    );

    // Update settings.last_payout_at / next_payout_at
    const next = computeNextPayout(settings.schedule, now);
    db.prepare(`
      UPDATE payout_settings SET last_payout_at = ?, next_payout_at = ?, updated_at = ? WHERE owner_id = ?
    `).run(now, next, now, ownerId);

    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  return {
    ok: true,
    payout: getPayout(id),
    balance: getBalance(ownerId),
    settings: getPayoutSettings(ownerId),
    kyc: getKYC(ownerId),
  };
}

export function getPayout(id: string): Payout | null {
  return (getDb().prepare('SELECT * FROM payouts WHERE id = ?').get(id) as Payout | undefined) ?? null;
}

export function listPayouts(ownerId: string, limit = 100): Payout[] {
  const n = Math.min(Math.max(limit, 1), 500);
  return getDb().prepare(
    'SELECT * FROM payouts WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(ownerId, n) as Payout[];
}

export function listPayoutsByState(state: PayoutState, limit = 100): Payout[] {
  const n = Math.min(Math.max(limit, 1), 500);
  return getDb().prepare(
    'SELECT * FROM payouts WHERE state = ? ORDER BY created_at ASC LIMIT ?'
  ).all(state, n) as Payout[];
}

export function advancePayout(id: string, state: PayoutState, opts: { reference?: string | null; errorMessage?: string | null } = {}): Payout | null {
  const p = getPayout(id);
  if (!p) return null;
  const db = getDb();
  const now = new Date().toISOString();
  const paidAt = state === 'paid' ? now : p.paid_at;

  db.exec('BEGIN');
  try {
    db.prepare(`
      UPDATE payouts
      SET state = ?, reference = COALESCE(?, reference),
          error_message = ?, paid_at = ?, updated_at = ?
      WHERE id = ?
    `).run(state, opts.reference ?? null, opts.errorMessage ?? null, paidAt, now, id);

    if (state === 'paid') {
      db.prepare(`
        UPDATE payout_balances
        SET lifetime_paid_cents = lifetime_paid_cents + ?, updated_at = ?
        WHERE owner_id = ?
      `).run(p.amount_cents, now, p.owner_id);
    } else if (state === 'failed' || state === 'cancelled') {
      // Reverse the debit — money goes back to available
      db.prepare(`
        UPDATE payout_balances
        SET available_cents = available_cents + ?, updated_at = ?
        WHERE owner_id = ?
      `).run(p.amount_cents, now, p.owner_id);

      db.prepare(`
        INSERT INTO payout_ledger
          (id, owner_id, kind, source, reference_id, amount_cents, currency, note, created_at)
        VALUES (?, ?, 'adjustment', 'payout_reverse', ?, ?, ?, ?, ?)
      `).run(
        randomUUID(), p.owner_id, id,
        p.amount_cents, p.currency,
        `Reversal for ${state}`, now,
      );
    }

    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return getPayout(id);
}

// ============================================================
// Worker: build due payouts across all owners
// ============================================================

export interface DuePayout {
  owner_id: string;
  schedule: PayoutSchedule;
  available_cents: number;
  min_payout_cents: number;
  kyc_ok: boolean;
  eligible: boolean;
  reason?: string;
}

export function listDuePayoutOwners(nowIso = new Date().toISOString()): DuePayout[] {
  const db = getDb();
  const owners = db.prepare(`
    SELECT s.owner_id, s.schedule, s.min_payout_cents, s.is_active,
           COALESCE(b.available_cents, 0) as available_cents,
           COALESCE(k.status, 'none') as kyc_status,
           k.expires_at as kyc_expires_at
    FROM payout_settings s
    LEFT JOIN payout_balances b ON b.owner_id = s.owner_id
    LEFT JOIN kyc_profiles k ON k.owner_id = s.owner_id
  `).all() as any[];

  const now = Date.now();
  const out: DuePayout[] = [];
  for (const o of owners) {
    const kycOk = o.kyc_status === 'verified' &&
      (!o.kyc_expires_at || new Date(o.kyc_expires_at).getTime() > now);
    const threshold = Math.max(o.min_payout_cents, MIN_PAYOUT_CENTS);
    const eligible = o.is_active === 1 && kycOk && o.available_cents >= threshold;
    let reason: string | undefined;
    if (!o.is_active) reason = 'inactive';
    else if (!kycOk) reason = 'kyc';
    else if (o.available_cents < threshold) reason = 'below_minimum';
    out.push({
      owner_id: o.owner_id,
      schedule: o.schedule,
      available_cents: o.available_cents,
      min_payout_cents: o.min_payout_cents,
      kyc_ok: kycOk,
      eligible,
      reason,
    });
  }
  return out;
}

// Summary
export interface OwnerPayoutSummary {
  owner_id: string;
  balance: PayoutBalance;
  settings: PayoutSettings;
  kyc: KYCProfile;
  revenue_share: RevenueShareConfig;
  recent_payouts: number;
}
export function getOwnerPayoutSummary(ownerId: string): OwnerPayoutSummary {
  const db = getDb();
  const recent = (db.prepare(
    'SELECT COUNT(*) as n FROM payouts WHERE owner_id = ? AND state IN (\'paid\',\'processing\')'
  ).get(ownerId) as { n: number }).n;
  return {
    owner_id: ownerId,
    balance: getBalance(ownerId),
    settings: getPayoutSettings(ownerId),
    kyc: getKYC(ownerId),
    revenue_share: getRevenueShare(ownerId),
    recent_payouts: recent,
  };
}
