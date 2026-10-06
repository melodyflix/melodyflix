// melodyflix videos - Section 11.11 Age Verification
// Declared DOB + ID-document upload + selfie-liveness verification flow.
// Verifies users are old enough for age-restricted content (18+, 21+).
// Stores minimal PII (hash of doc number, not raw ID) + audit trail.
import { randomUUID, createHash } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type AgeTier = 'under13' | 'teen' | 'adult' | 'senior';
export type VerifyMethod = 'declared' | 'id_document' | 'credit_card' | 'biometric' | 'third_party';
export type VerifyStatus = 'unverified' | 'pending' | 'verified' | 'rejected' | 'expired' | 'revoked';
export type DocType = 'passport' | 'national_id' | 'driving_license' | 'birth_certificate' | 'other';

export interface AgeVerification {
  id: string;
  user_id: string;
  declared_dob: string | null;
  declared_age: number | null;
  age_tier: AgeTier | null;
  method: VerifyMethod;
  status: VerifyStatus;
  min_age: number;
  doc_type: DocType | null;
  doc_hash: string | null;       // SHA-256 of doc number (never raw)
  doc_country: string | null;
  selfie_hash: string | null;
  rejection_reason: string | null;
  verified_by: string | null;
  verified_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgeEvent {
  id: string;
  verification_id: string;
  user_id: string;
  actor_id: string | null;
  event_type: string;
  note: string | null;
  metadata: string | null;
  created_at: string;
}

const VALID_METHODS: VerifyMethod[] = ['declared', 'id_document', 'credit_card', 'biometric', 'third_party'];
const VALID_STATUSES: VerifyStatus[] = ['unverified', 'pending', 'verified', 'rejected', 'expired', 'revoked'];
const VALID_DOC_TYPES: DocType[] = ['passport', 'national_id', 'driving_license', 'birth_certificate', 'other'];

const DEFAULT_VALIDITY_DAYS = 365;   // re-verify yearly

export function ensureAgeVerificationSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS age_verifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      declared_dob TEXT,
      declared_age INTEGER,
      age_tier TEXT CHECK (age_tier IN ('under13','teen','adult','senior') OR age_tier IS NULL),
      method TEXT NOT NULL DEFAULT 'declared',
      status TEXT NOT NULL DEFAULT 'unverified'
        CHECK (status IN ('unverified','pending','verified','rejected','expired','revoked')),
      min_age INTEGER NOT NULL DEFAULT 18,
      doc_type TEXT,
      doc_hash TEXT,
      doc_country TEXT,
      selfie_hash TEXT,
      rejection_reason TEXT,
      verified_by TEXT,
      verified_at TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_age_user ON age_verifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_age_status ON age_verifications(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_age_doc_hash ON age_verifications(doc_hash);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_age_user_unique ON age_verifications(user_id);

    CREATE TABLE IF NOT EXISTS age_verification_events (
      id TEXT PRIMARY KEY,
      verification_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      actor_id TEXT,
      event_type TEXT NOT NULL,
      note TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_age_event_verif ON age_verification_events(verification_id);
    CREATE INDEX IF NOT EXISTS idx_age_event_user ON age_verification_events(user_id, created_at DESC);
  `);
}

function rowToVerification(r: any): AgeVerification {
  return r as AgeVerification;
}

function logEvent(verificationId: string, userId: string, eventType: string, opts: {
  actorId?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown> | null;
} = {}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO age_verification_events (id, verification_id, user_id, actor_id, event_type, note, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), verificationId, userId, opts.actorId ?? null,
    eventType, opts.note ?? null,
    opts.metadata ? JSON.stringify(opts.metadata) : null,
    new Date().toISOString(),
  );
}

function calculateAge(dobIso: string): number {
  const dob = new Date(dobIso);
  if (isNaN(dob.getTime())) throw new Error('Invalid DOB');
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

function computeAgeTier(age: number): AgeTier {
  if (age < 13) return 'under13';
  if (age < 18) return 'teen';
  if (age < 65) return 'adult';
  return 'senior';
}

/** Hash a document number — never store raw. */
export function hashDocNumber(raw: string): string {
  return createHash('sha256').update(String(raw).trim().toUpperCase()).digest('hex');
}

export function hashSelfie(raw: string): string {
  return createHash('sha256').update(String(raw)).digest('hex');
}

// ============================================================
// CRUD
// ============================================================

export function getVerification(userId: string): AgeVerification | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM age_verifications WHERE user_id = ?').get(userId) as any;
  return r ? rowToVerification(r) : null;
}

export function getVerificationById(id: string): AgeVerification | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM age_verifications WHERE id = ?').get(id) as any;
  return r ? rowToVerification(r) : null;
}

export interface DeclareAgeInput {
  user_id: string;
  declared_dob: string;      // ISO date
  min_age?: number;
}

/** Create or update an age declaration (DOB only, no docs). */
export function declareAge(input: DeclareAgeInput): AgeVerification {
  const age = calculateAge(input.declared_dob);
  if (age < 0 || age > 120) throw new Error('Invalid DOB (age out of range)');

  const minAge = input.min_age ?? 18;
  if (minAge < 13 || minAge > 21) throw new Error('min_age must be 13-21');

  const db = getDb();
  const existing = getVerification(input.user_id);
  const now = new Date().toISOString();
  const tier = computeAgeTier(age);

  if (existing) {
    db.prepare(`
      UPDATE age_verifications
      SET declared_dob = ?, declared_age = ?, age_tier = ?, min_age = ?,
          status = 'unverified', method = 'declared', updated_at = ?
      WHERE user_id = ?
    `).run(input.declared_dob, age, tier, minAge, now, input.user_id);
    logEvent(existing.id, input.user_id, 'declared', `Declared DOB age ${age}`, {
      metadata: { age, tier, min_age: minAge },
    });
    return getVerification(input.user_id)!;
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO age_verifications
      (id, user_id, declared_dob, declared_age, age_tier, method, status,
       min_age, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'declared', 'unverified', ?, ?, ?)
  `).run(id, input.user_id, input.declared_dob, age, tier, minAge, now, now);

  logEvent(id, input.user_id, 'declared', `Initial declaration age ${age}`, {
    metadata: { age, tier, min_age: minAge },
  });
  return getVerification(input.user_id)!;
}

export interface SubmitVerificationInput {
  user_id: string;
  method: VerifyMethod;
  doc_type?: DocType;
  doc_number?: string;       // raw — will be hashed
  doc_country?: string;
  selfie_data?: string;      // raw — will be hashed
  min_age?: number;
}

/** Submit a verification request (with document or selfie). */
export function submitVerification(input: SubmitVerificationInput): AgeVerification {
  if (!VALID_METHODS.includes(input.method)) throw new Error(`Invalid method: ${input.method}`);
  if (input.method === 'id_document' && !input.doc_number) {
    throw new Error('doc_number is required for id_document method');
  }
  if (input.method === 'id_document' && !input.doc_type) {
    throw new Error('doc_type is required for id_document method');
  }
  if (input.doc_type && !VALID_DOC_TYPES.includes(input.doc_type)) {
    throw new Error(`Invalid doc_type: ${input.doc_type}`);
  }

  const db = getDb();
  const existing = getVerification(input.user_id);
  const now = new Date().toISOString();

  const docHash = input.doc_number ? hashDocNumber(input.doc_number) : null;
  const selfieHash = input.selfie_data ? hashSelfie(input.selfie_data) : null;

  // Check for duplicate doc (same doc used by another account → fraud signal)
  if (docHash) {
    const dup = db.prepare(
      'SELECT user_id FROM age_verifications WHERE doc_hash = ? AND user_id != ? LIMIT 1'
    ).get(docHash, input.user_id) as { user_id: string } | undefined;
    if (dup) throw new Error('This document is already registered to another account');
  }

  if (!existing) throw new Error('Must declare age first — call declareAge');
  if (existing.status === 'verified' && existing.expires_at && existing.expires_at > now) {
    throw new Error('Already verified and not expired');
  }

  db.prepare(`
    UPDATE age_verifications
    SET method = ?, status = 'pending', doc_type = ?, doc_hash = ?,
        doc_country = ?, selfie_hash = ?, updated_at = ?
    WHERE user_id = ?
  `).run(input.method, input.doc_type ?? null, docHash, input.doc_country ?? null,
    selfieHash, now, input.user_id);

  logEvent(existing.id, input.user_id, 'submitted',
    `Verification submitted via ${input.method}`, {
      metadata: {
        method: input.method,
        doc_type: input.doc_type ?? null,
        doc_country: input.doc_country ?? null,
        has_selfie: !!selfieHash,
      },
    });

  return getVerification(input.user_id)!;
}

export interface ApproveInput {
  user_id: string;
  admin_id: string;
  validity_days?: number;
}

export function approveVerification(input: ApproveInput): AgeVerification {
  const db = getDb();
  const existing = getVerification(input.user_id);
  if (!existing) throw new Error('Verification not found');
  if (existing.status !== 'pending') throw new Error(`Cannot approve from status ${existing.status}`);
  if (existing.declared_age === null) throw new Error('No declared age on record');
  if (existing.declared_age < existing.min_age) {
    throw new Error(`Declared age ${existing.declared_age} is below minimum ${existing.min_age}`);
  }

  const validityDays = input.validity_days ?? DEFAULT_VALIDITY_DAYS;
  const expiresAt = new Date(Date.now() + validityDays * 86400_000).toISOString();
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE age_verifications
    SET status = 'verified', verified_by = ?, verified_at = ?, expires_at = ?,
        rejection_reason = NULL, updated_at = ?
    WHERE user_id = ?
  `).run(input.admin_id, now, expiresAt, now, input.user_id);

  logEvent(existing.id, input.user_id, 'approved', `Verified by admin for ${validityDays} days`, {
    actorId: input.admin_id,
    metadata: { validity_days: validityDays, expires_at: expiresAt },
  });

  return getVerification(input.user_id)!;
}

export interface RejectInput {
  user_id: string;
  admin_id: string;
  reason: string;
}

export function rejectVerification(input: RejectInput): AgeVerification {
  if (!input.reason || input.reason.trim().length < 5 || input.reason.length > 1000) {
    throw new Error('reason must be 5-1000 chars');
  }
  const db = getDb();
  const existing = getVerification(input.user_id);
  if (!existing) throw new Error('Verification not found');
  if (existing.status !== 'pending') throw new Error(`Cannot reject from status ${existing.status}`);

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE age_verifications
    SET status = 'rejected', rejection_reason = ?, verified_by = ?, updated_at = ?
    WHERE user_id = ?
  `).run(input.reason.trim(), input.admin_id, now, input.user_id);

  logEvent(existing.id, input.user_id, 'rejected', `Rejected: ${input.reason.trim()}`, {
    actorId: input.admin_id,
  });

  return getVerification(input.user_id)!;
}

export function revokeVerification(userId: string, adminId: string, reason?: string): AgeVerification {
  const db = getDb();
  const existing = getVerification(userId);
  if (!existing) throw new Error('Verification not found');
  if (existing.status === 'revoked') return existing;

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE age_verifications SET status = 'revoked', updated_at = ? WHERE user_id = ?
  `).run(now, userId);

  logEvent(existing.id, userId, 'revoked', reason ?? 'Revoked by admin', { actorId: adminId });
  return getVerification(userId)!;
}

// ============================================================
// Queries
// ============================================================

export interface ListVerificationsOpts {
  status?: VerifyStatus;
  method?: VerifyMethod;
  limit?: number;
  offset?: number;
}

export function listVerifications(opts: ListVerificationsOpts = {}): { items: AgeVerification[]; total: number } {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];

  if (opts.status) { where.push('status = ?'); params.push(opts.status); }
  if (opts.method) { where.push('method = ?'); params.push(opts.method); }

  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const total = (db.prepare(`SELECT COUNT(*) as c FROM age_verifications ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT * FROM age_verifications ${w} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
  ).all(...params) as any[];
  return { items: rows.map(rowToVerification), total };
}

export function listEvents(userId: string): AgeEvent[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM age_verification_events WHERE user_id = ? ORDER BY created_at ASC'
  ).all(userId) as AgeEvent[];
}

/** Helper: quick check used by playback / content gate. */
export function isAgeVerified(userId: string, requiredAge = 18): boolean {
  const db = getDb();
  const r = db.prepare(`
    SELECT status, declared_age, min_age, expires_at
    FROM age_verifications WHERE user_id = ?
  `).get(userId) as { status: string; declared_age: number | null; min_age: number; expires_at: string | null } | undefined;
  if (!r) return false;
  if (r.status !== 'verified') return false;
  if (r.expires_at && r.expires_at < new Date().toISOString()) return false;
  if (r.declared_age === null || r.declared_age < requiredAge) return false;
  return true;
}

// ============================================================
// Stats & Maintenance
// ============================================================

export interface AgeStats {
  total: number;
  by_status: Record<string, number>;
  by_method: Record<string, number>;
  by_tier: Record<string, number>;
  pending_older_than_48h: number;
  expiring_in_30d: number;
  window_days: number;
}

export function getAgeStats(windowDays = 30): AgeStats {
  const db = getDb();
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString();

  const total = (db.prepare(
    'SELECT COUNT(*) as c FROM age_verifications WHERE created_at >= ?'
  ).get(since) as { c: number }).c;

  const byStatus: Record<string, number> = {};
  for (const r of db.prepare(
    'SELECT status, COUNT(*) as c FROM age_verifications WHERE created_at >= ? GROUP BY status'
  ).all(since) as Array<{ status: string; c: number }>) byStatus[r.status] = r.c;

  const byMethod: Record<string, number> = {};
  for (const r of db.prepare(
    'SELECT method, COUNT(*) as c FROM age_verifications WHERE created_at >= ? GROUP BY method'
  ).all(since) as Array<{ method: string; c: number }>) byMethod[r.method] = r.c;

  const byTier: Record<string, number> = {};
  for (const r of db.prepare(
    'SELECT age_tier, COUNT(*) as c FROM age_verifications WHERE created_at >= ? AND age_tier IS NOT NULL GROUP BY age_tier'
  ).all(since) as Array<{ age_tier: string; c: number }>) byTier[r.age_tier] = r.c;

  const twoDaysAgo = new Date(Date.now() - 48 * 3600_000).toISOString();
  const pendingOld = (db.prepare(
    "SELECT COUNT(*) as c FROM age_verifications WHERE status = 'pending' AND updated_at < ?"
  ).get(twoDaysAgo) as { c: number }).c;

  const in30d = new Date(Date.now() + 30 * 86400_000).toISOString();
  const expiringSoon = (db.prepare(
    "SELECT COUNT(*) as c FROM age_verifications WHERE status = 'verified' AND expires_at IS NOT NULL AND expires_at <= ?"
  ).get(in30d) as { c: number }).c;

  return {
    total,
    by_status: byStatus,
    by_method: byMethod,
    by_tier: byTier,
    pending_older_than_48h: pendingOld,
    expiring_in_30d: expiringSoon,
    window_days: windowDays,
  };
}

export function expireOldVerifications(): { expired: number } {
  const db = getDb();
  const now = new Date().toISOString();
  const rows = db.prepare(
    "SELECT id, user_id FROM age_verifications WHERE status = 'verified' AND expires_at IS NOT NULL AND expires_at < ?"
  ).all(now) as Array<{ id: string; user_id: string }>;

  if (rows.length === 0) return { expired: 0 };
  const stmt = db.prepare("UPDATE age_verifications SET status = 'expired', updated_at = ? WHERE id = ?");
  for (const r of rows) {
    stmt.run(now, r.id);
    logEvent(r.id, r.user_id, 'expired', 'Auto-expired');
  }
  return { expired: rows.length };
}

export function pruneOldVerifications(olderThanDays = 1825): { pruned: number } {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000).toISOString();
  const info = db.prepare(
    "DELETE FROM age_verifications WHERE status IN ('rejected','expired','revoked') AND updated_at < ?"
  ).run(cutoff);
  return { pruned: info.changes };
}
