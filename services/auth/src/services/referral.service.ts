// melodyflix auth - referral program (27.2)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export interface ReferralCode {
  user_id: string;
  code: string;
  created_at: string;
}

export interface Referral {
  id: string;
  referrer_user_id: string;
  referred_user_id: string;
  code: string;
  status: 'pending' | 'completed' | 'rewarded' | 'rejected';
  reward_amount: number;      // credits awarded to referrer
  referred_bonus: number;      // credits awarded to referred
  created_at: string;
  completed_at: string | null;
  rewarded_at: string | null;
}

export interface ReferralStats {
  code: string;
  total_invited: number;
  completed: number;
  pending: number;
  total_earned: number;        // credits
}

// Rewards (in credits)
export const REFERRER_REWARD = 100;
export const REFERRED_BONUS = 50;

// ---------- Schema ----------

export function ensureReferralSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS referral_codes (
      user_id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);

    CREATE TABLE IF NOT EXISTS referrals (
      id TEXT PRIMARY KEY,
      referrer_user_id TEXT NOT NULL,
      referred_user_id TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      reward_amount INTEGER NOT NULL DEFAULT 0,
      referred_bonus INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      rewarded_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS user_credits (
      user_id TEXT PRIMARY KEY,
      balance INTEGER NOT NULL DEFAULT 0,
      lifetime_earned INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
}

// ---------- Credits (shared helper) ----------

export function getCreditBalance(userId: string): { balance: number; lifetime_earned: number } {
  const db = getDb();
  const row = db.prepare('SELECT balance, lifetime_earned FROM user_credits WHERE user_id = ?').get(userId) as { balance: number; lifetime_earned: number } | undefined;
  return row ?? { balance: 0, lifetime_earned: 0 };
}

function addCredits(userId: string, amount: number): void {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT user_id FROM user_credits WHERE user_id = ?').get(userId) as { user_id: string } | undefined;
  if (existing) {
    db.prepare('UPDATE user_credits SET balance = balance + ?, lifetime_earned = lifetime_earned + ?, updated_at = ? WHERE user_id = ?')
      .run(amount, Math.max(0, amount), now, userId);
  } else {
    db.prepare('INSERT INTO user_credits (user_id, balance, lifetime_earned, updated_at) VALUES (?, ?, ?, ?)')
      .run(userId, amount, Math.max(0, amount), now);
  }
}

// ---------- Code generation ----------

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1

function randomCode(length = 8): string {
  let s = '';
  for (let i = 0; i < length; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return s;
}

export function getOrCreateCode(userId: string): ReferralCode {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM referral_codes WHERE user_id = ?').get(userId) as ReferralCode | undefined;
  if (existing) return existing;

  // Generate unique code
  let code = '';
  for (let attempt = 0; attempt < 8; attempt++) {
    code = randomCode(8);
    const clash = db.prepare('SELECT user_id FROM referral_codes WHERE code = ?').get(code) as { user_id: string } | undefined;
    if (!clash) break;
  }
  if (!code) throw new Error('Could not generate unique referral code');

  const now = new Date().toISOString();
  db.prepare('INSERT INTO referral_codes (user_id, code, created_at) VALUES (?, ?, ?)')
    .run(userId, code, now);
  return { user_id: userId, code, created_at: now };
}

export function findUserByCode(code: string): string | null {
  const db = getDb();
  const clean = (code || '').trim().toUpperCase();
  if (!clean) return null;
  const row = db.prepare('SELECT user_id FROM referral_codes WHERE code = ?').get(clean) as { user_id: string } | undefined;
  return row?.user_id ?? null;
}

// ---------- Track referral ----------

export function applyReferral(referredUserId: string, code: string): Referral | null {
  const db = getDb();
  const referrerId = findUserByCode(code);
  if (!referrerId) return null;
  if (referrerId === referredUserId) return null; // can't refer yourself

  // Already referred? (user can only be referred once)
  const existing = db.prepare('SELECT id FROM referrals WHERE referred_user_id = ?').get(referredUserId) as { id: string } | undefined;
  if (existing) return null;

  // Was referrer created before referred? (basic sanity check — referrer must be older)
  try {
    const referrerRow = db.prepare('SELECT created_at FROM users WHERE id = ?').get(referrerId) as { created_at: string } | undefined;
    const referredRow = db.prepare('SELECT created_at FROM users WHERE id = ?').get(referredUserId) as { created_at: string } | undefined;
    if (referrerRow && referredRow && referrerRow.created_at > referredRow.created_at) {
      return null;
    }
  } catch { /* skip check if users table shape differs */ }

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO referrals (id, referrer_user_id, referred_user_id, code, status, reward_amount, referred_bonus, created_at, completed_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id, referrerId, referredUserId, code.trim().toUpperCase(),
    'completed', REFERRER_REWARD, REFERRED_BONUS, now, now,
  );

  // Award credits immediately (email verification could gate this in future)
  try {
    addCredits(referrerId, REFERRER_REWARD);
    addCredits(referredUserId, REFERRED_BONUS);
    db.prepare("UPDATE referrals SET status = 'rewarded', rewarded_at = ? WHERE id = ?").run(now, id);
  } catch { /* keep 'completed' if credit fails */ }

  return db.prepare('SELECT * FROM referrals WHERE id = ?').get(id) as Referral;
}

export function listReferralsByUser(referrerUserId: string, limit = 100): (Referral & { referred_email?: string; referred_username?: string })[] {
  const db = getDb();
  try {
    return db.prepare(
      'SELECT r.*, u.email as referred_email, u.username as referred_username ' +
      'FROM referrals r LEFT JOIN users u ON u.id = r.referred_user_id ' +
      'WHERE r.referrer_user_id = ? ORDER BY r.created_at DESC LIMIT ?'
    ).all(referrerUserId, Math.max(1, Math.min(500, limit))) as any[];
  } catch {
    return db.prepare('SELECT * FROM referrals WHERE referrer_user_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(referrerUserId, Math.max(1, Math.min(500, limit))) as Referral[];
  }
}

export function getReferralStats(userId: string): ReferralStats {
  const db = getDb();
  const code = getOrCreateCode(userId).code;
  const total = (db.prepare('SELECT COUNT(*) as n FROM referrals WHERE referrer_user_id = ?').get(userId) as { n: number }).n;
  const completed = (db.prepare("SELECT COUNT(*) as n FROM referrals WHERE referrer_user_id = ? AND status IN ('completed','rewarded')").get(userId) as { n: number }).n;
  const pending = (db.prepare("SELECT COUNT(*) as n FROM referrals WHERE referrer_user_id = ? AND status = 'pending'").get(userId) as { n: number }).n;
  const earned = (db.prepare("SELECT COALESCE(SUM(reward_amount), 0) as n FROM referrals WHERE referrer_user_id = ? AND status = 'rewarded'").get(userId) as { n: number }).n;
  return { code, total_invited: total, completed, pending, total_earned: earned };
}

export function buildShareLink(code: string, origin = ''): string {
  const base = origin.replace(/\/$/, '');
  return `${base}/signup?ref=${encodeURIComponent(code)}`;
}
