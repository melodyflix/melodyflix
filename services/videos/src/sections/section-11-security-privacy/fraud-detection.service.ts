// melodyflix videos - Section 11.14 Fraud Detection
// Rule-based fraud scoring for user actions (signup, payment, refund,
// promo redemption, referral). Signals combine into a risk score; high-risk
// events are flagged for review.
import { randomUUID, createHash } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type FraudAction =
  | 'signup'
  | 'login'
  | 'payment'
  | 'refund'
  | 'promo_redeem'
  | 'referral_claim'
  | 'payout'
  | 'content_upload';

export type FraudSeverity = 'low' | 'medium' | 'high' | 'critical';
export type FraudDecision = 'allow' | 'review' | 'block';

export interface FraudSignal {
  id: string;
  event_id: string;
  signal_type: string;
  weight: number;
  details: string | null;      // JSON
  created_at: string;
}

export interface FraudEvent {
  id: string;
  user_id: string;
  action: FraudAction;
  ip_address: string | null;
  device_fingerprint: string | null;
  country: string | null;
  amount_cents: number | null;
  currency: string | null;
  score: number;
  decision: FraudDecision;
  severity: FraudSeverity;
  reasons: string;             // JSON array of signal_type strings
  metadata: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

const VALID_ACTIONS: FraudAction[] = [
  'signup', 'login', 'payment', 'refund', 'promo_redeem',
  'referral_claim', 'payout', 'content_upload',
];
const VALID_DECISIONS: FraudDecision[] = ['allow', 'review', 'block'];

// Signal weights — sum caps at 100
const SIGNAL_WEIGHTS = {
  new_account_high_value: 20,
  velocity_1h: 25,
  velocity_24h: 15,
  same_ip_multiple_accounts: 30,
  same_device_multiple_accounts: 35,
  vpn_or_tor: 20,
  datacenter_ip: 10,
  country_mismatch: 15,
  disposable_email: 20,
  blacklisted_email: 40,
  high_refund_rate: 30,
  new_device_high_value: 15,
  rapid_failures: 15,
  amount_anomaly: 20,
  impossible_amount: 40,
} as const;

type SignalType = keyof typeof SIGNAL_WEIGHTS;

// Email domain blocklist (sample; extend via admin)
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'tempmail.com', '10minutemail.com',
  'throwaway.email', 'yopmail.com', 'trashmail.com', 'sharklasers.com',
]);

// Country mismatches (sample heuristic — user declared vs IP country)
export function ensureFraudDetectionSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS fraud_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      ip_address TEXT,
      device_fingerprint TEXT,
      country TEXT,
      amount_cents INTEGER,
      currency TEXT,
      score INTEGER NOT NULL DEFAULT 0,
      decision TEXT NOT NULL DEFAULT 'allow'
        CHECK (decision IN ('allow','review','block')),
      severity TEXT NOT NULL DEFAULT 'low'
        CHECK (severity IN ('low','medium','high','critical')),
      reasons TEXT NOT NULL DEFAULT '[]',
      metadata TEXT,
      status TEXT NOT NULL DEFAULT 'new'
        CHECK (status IN ('new','in_review','approved','blocked','dismissed')),
      reviewed_by TEXT,
      reviewed_at TEXT,
      review_note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_fraud_user ON fraud_events(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_fraud_action ON fraud_events(action, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_fraud_decision ON fraud_events(decision, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_fraud_status ON fraud_events(status);
    CREATE INDEX IF NOT EXISTS idx_fraud_ip ON fraud_events(ip_address, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_fraud_device ON fraud_events(device_fingerprint, created_at DESC);

    CREATE TABLE IF NOT EXISTS fraud_signals (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      signal_type TEXT NOT NULL,
      weight INTEGER NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_fraud_signal_event ON fraud_signals(event_id);
    CREATE INDEX IF NOT EXISTS idx_fraud_signal_type ON fraud_signals(signal_type);
  `);
}

function rowToEvent(r: any): FraudEvent { return r as FraudEvent; }
function rowToSignal(r: any): FraudSignal { return r as FraudSignal; }

function hashFingerprint(s: string): string {
  return createHash('sha256').update(String(s)).digest('hex');
}

function addSignal(eventId: string, type: SignalType, details?: Record<string, unknown> | null): number {
  const weight = SIGNAL_WEIGHTS[type] ?? 0;
  const db = getDb();
  db.prepare(`
    INSERT INTO fraud_signals (id, event_id, signal_type, weight, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), eventId, type, weight,
    details ? JSON.stringify(details) : null,
    new Date().toISOString());
  return weight;
}

function scoreToSeverity(score: number): FraudSeverity {
  if (score >= 80) return 'critical';
  if (score >= 55) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

function scoreToDecision(score: number): FraudDecision {
  if (score >= 80) return 'block';
  if (score >= 40) return 'review';
  return 'allow';
}

// ============================================================
// Signals collection
// ============================================================

interface SignalContext {
  user_id: string;
  action: FraudAction;
  ip_address?: string | null;
  device_fingerprint?: string | null;
  country?: string | null;
  email?: string | null;
  amount_cents?: number | null;
}

function computeSignals(ctx: SignalContext, eventId: string): { total: number; types: SignalType[] } {
  const db = getDb();
  const now = Date.now();
  const hourAgo = new Date(now - 3600_000).toISOString();
  const dayAgo = new Date(now - 86400_000).toISOString();

  const types: SignalType[] = [];
  let total = 0;

  const push = (t: SignalType, details?: Record<string, unknown>) => {
    const w = addSignal(eventId, t, details ?? null);
    total += w;
    types.push(t);
  };

  // 1. Disposable / blacklisted email (signup only)
  if (ctx.action === 'signup' && ctx.email) {
    const domain = ctx.email.toLowerCase().split('@')[1];
    if (domain && DISPOSABLE_EMAIL_DOMAINS.has(domain)) push('disposable_email', { domain });
  }

  // 2. Velocity: same user, high-value action, >3 in 1h
  if (ctx.amount_cents && ctx.amount_cents > 0) {
    const recentHour = (db.prepare(
      'SELECT COUNT(*) as c FROM fraud_events WHERE user_id = ? AND created_at >= ? AND amount_cents > 0'
    ).get(ctx.user_id, hourAgo) as { c: number }).c;
    if (recentHour >= 3) push('velocity_1h', { count: recentHour });

    const recentDay = (db.prepare(
      'SELECT COUNT(*) as c FROM fraud_events WHERE user_id = ? AND created_at >= ? AND amount_cents > 0'
    ).get(ctx.user_id, dayAgo) as { c: number }).c;
    if (recentDay >= 10) push('velocity_24h', { count: recentDay });
  }

  // 3. Same IP → multiple accounts (last 24h)
  if (ctx.ip_address) {
    const distinctUsersOnIp = (db.prepare(
      'SELECT COUNT(DISTINCT user_id) as c FROM fraud_events WHERE ip_address = ? AND created_at >= ?'
    ).get(ctx.ip_address, dayAgo) as { c: number }).c;
    if (distinctUsersOnIp >= 3) push('same_ip_multiple_accounts', { accounts: distinctUsersOnIp });
  }

  // 4. Same device fingerprint → multiple accounts
  if (ctx.device_fingerprint) {
    const hash = hashFingerprint(ctx.device_fingerprint);
    const distinctUsersOnDevice = (db.prepare(
      'SELECT COUNT(DISTINCT user_id) as c FROM fraud_events WHERE device_fingerprint = ? AND created_at >= ?'
    ).get(hash, dayAgo) as { c: number }).c;
    if (distinctUsersOnDevice >= 3) push('same_device_multiple_accounts', { accounts: distinctUsersOnDevice });
  }

  // 5. High refund rate (last 30 days)
  if (ctx.action === 'refund') {
    const thirtyAgo = new Date(now - 30 * 86400_000).toISOString();
    const refunds = (db.prepare(
      "SELECT COUNT(*) as c FROM fraud_events WHERE user_id = ? AND action = 'refund' AND created_at >= ?"
    ).get(ctx.user_id, thirtyAgo) as { c: number }).c;
    const payments = (db.prepare(
      "SELECT COUNT(*) as c FROM fraud_events WHERE user_id = ? AND action = 'payment' AND created_at >= ?"
    ).get(ctx.user_id, thirtyAgo) as { c: number }).c;
    if (payments > 0 && refunds / payments > 0.5) {
      push('high_refund_rate', { refunds, payments });
    }
  }

  // 6. New account + high value (account <24h + amount > 10,000 cents)
  // Note: 'users' table may not exist in this service's DB (auth service owns it).
  // Fall back to signup events recorded in fraud_events when absent.
  if (ctx.amount_cents && ctx.amount_cents > 10000) {
    try {
      const userAge = (db.prepare(
        'SELECT created_at FROM users WHERE id = ?'
      ).get(ctx.user_id) as { created_at: string } | undefined);
      if (userAge) {
        const ageHours = (now - new Date(userAge.created_at).getTime()) / 3600_000;
        if (ageHours < 24) push('new_account_high_value', { age_hours: Math.round(ageHours), amount_cents: ctx.amount_cents });
      }
    } catch {
      // Fallback: check if we recorded a signup fraud_event for this user in last 24h
      const recentSignup = (db.prepare(
        "SELECT created_at FROM fraud_events WHERE user_id = ? AND action = 'signup' AND created_at >= ? LIMIT 1"
      ).get(ctx.user_id, dayAgo) as { created_at: string } | undefined);
      if (recentSignup) push('new_account_high_value', { via: 'fraud_events_signup', amount_cents: ctx.amount_cents });
    }
  }

  // 7. Impossible amount (> $10,000)
  if (ctx.amount_cents && ctx.amount_cents > 1_000_000) {
    push('impossible_amount', { amount_cents: ctx.amount_cents });
  }

  total = Math.min(total, 100);
  return { total, types };
}

// ============================================================
// Record event
// ============================================================

export interface RecordFraudInput {
  user_id: string;
  action: FraudAction;
  ip_address?: string | null;
  device_fingerprint?: string | null;
  country?: string | null;
  email?: string | null;
  amount_cents?: number | null;
  currency?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function recordFraudEvent(input: RecordFraudInput): FraudEvent {
  if (!input.user_id) throw new Error('user_id is required');
  if (!VALID_ACTIONS.includes(input.action)) throw new Error(`Invalid action: ${input.action}`);
  if (input.amount_cents !== undefined && input.amount_cents !== null) {
    if (!Number.isInteger(input.amount_cents) || input.amount_cents < 0) {
      throw new Error('amount_cents must be a non-negative integer');
    }
  }

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO fraud_events
      (id, user_id, action, ip_address, device_fingerprint, country,
       amount_cents, currency, score, decision, severity, reasons, metadata,
       status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'allow', 'low', '[]', ?, 'new', ?)
  `).run(
    id, input.user_id, input.action,
    input.ip_address ?? null,
    input.device_fingerprint ? hashFingerprint(input.device_fingerprint) : null,
    input.country ?? null,
    input.amount_cents ?? null,
    input.currency ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null,
    now,
  );

  const { total, types } = computeSignals({
    user_id: input.user_id,
    action: input.action,
    ip_address: input.ip_address,
    device_fingerprint: input.device_fingerprint,
    country: input.country,
    email: input.email,
    amount_cents: input.amount_cents,
  }, id);

  const severity = scoreToSeverity(total);
  const decision = scoreToDecision(total);

  db.prepare(`
    UPDATE fraud_events
    SET score = ?, decision = ?, severity = ?, reasons = ?
    WHERE id = ?
  `).run(total, decision, severity, JSON.stringify(types), id);

  return getFraudEvent(id)!;
}

export function getFraudEvent(id: string): FraudEvent | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM fraud_events WHERE id = ?').get(id) as any;
  return r ? rowToEvent(r) : null;
}

export function listSignals(eventId: string): FraudSignal[] {
  const db = getDb();
  return db.prepare('SELECT * FROM fraud_signals WHERE event_id = ? ORDER BY created_at ASC')
    .all(eventId) as FraudSignal[];
}

export interface ListFraudOpts {
  user_id?: string;
  action?: FraudAction;
  decision?: FraudDecision;
  severity?: FraudSeverity;
  status?: string;
  min_score?: number;
  limit?: number;
  offset?: number;
}

export function listFraudEvents(opts: ListFraudOpts = {}): { events: FraudEvent[]; total: number } {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];

  if (opts.user_id) { where.push('user_id = ?'); params.push(opts.user_id); }
  if (opts.action) { where.push('action = ?'); params.push(opts.action); }
  if (opts.decision) { where.push('decision = ?'); params.push(opts.decision); }
  if (opts.severity) { where.push('severity = ?'); params.push(opts.severity); }
  if (opts.status) { where.push('status = ?'); params.push(opts.status); }
  if (opts.min_score !== undefined) { where.push('score >= ?'); params.push(opts.min_score); }

  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const total = (db.prepare(`SELECT COUNT(*) as c FROM fraud_events ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT * FROM fraud_events ${w} ORDER BY
      CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      created_at DESC
     LIMIT ${limit} OFFSET ${offset}`
  ).all(...params) as any[];

  return { events: rows.map(rowToEvent), total };
}

// ============================================================
// Review workflow
// ============================================================

export type ReviewStatus = 'new' | 'in_review' | 'approved' | 'blocked' | 'dismissed';

export function reviewFraudEvent(id: string, reviewerId: string, newStatus: ReviewStatus, note?: string): FraudEvent {
  if (!['new', 'in_review', 'approved', 'blocked', 'dismissed'].includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}`);
  }
  const db = getDb();
  const existing = getFraudEvent(id);
  if (!existing) throw new Error('Event not found');

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE fraud_events
    SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?
    WHERE id = ?
  `).run(newStatus, reviewerId, now, note ?? null, id);

  return getFraudEvent(id)!;
}

// ============================================================
// Stats
// ============================================================

export interface FraudStats {
  total: number;
  by_decision: Record<string, number>;
  by_severity: Record<string, number>;
  by_action: Record<string, number>;
  by_status: Record<string, number>;
  pending_review: number;
  window_days: number;
}

export function getFraudStats(windowDays = 30): FraudStats {
  const db = getDb();
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString();

  const total = (db.prepare(
    'SELECT COUNT(*) as c FROM fraud_events WHERE created_at >= ?'
  ).get(since) as { c: number }).c;

  const groupBy = (col: string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const r of db.prepare(
      `SELECT ${col} as k, COUNT(*) as c FROM fraud_events WHERE created_at >= ? GROUP BY ${col}`
    ).all(since) as Array<{ k: string; c: number }>) out[r.k] = r.c;
    return out;
  };

  const pending = (db.prepare(
    "SELECT COUNT(*) as c FROM fraud_events WHERE status IN ('new','in_review')"
  ).get() as { c: number }).c;

  return {
    total,
    by_decision: groupBy('decision'),
    by_severity: groupBy('severity'),
    by_action: groupBy('action'),
    by_status: groupBy('status'),
    pending_review: pending,
    window_days: windowDays,
  };
}

export function pruneOldEvents(olderThanDays = 365): { pruned: number } {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000).toISOString();
  const info = db.prepare(
    "DELETE FROM fraud_events WHERE status IN ('approved','dismissed','blocked') AND created_at < ?"
  ).run(cutoff);
  return { pruned: info.changes };
}
