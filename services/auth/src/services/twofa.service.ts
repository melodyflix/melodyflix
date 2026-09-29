// melodyflix auth - Two-Factor Authentication (TOTP)
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { randomBytes, randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

const APP_NAME = 'melodyflix';
const BACKUP_CODE_COUNT = 10;

export interface TwoFAStatus {
  enabled: boolean;
  has_backup_codes: number;
}

export function ensureTwoFASchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS twofa_secrets (
      user_id TEXT PRIMARY KEY,
      secret TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      confirmed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS twofa_backup_codes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_2fa_backup_user ON twofa_backup_codes(user_id);
  `);
}

function hashBackupCode(code: string): string {
  const { createHash } = require('node:crypto');
  return createHash('sha256').update(code).digest('hex');
}

function generateBackupCode(): string {
  const raw = randomBytes(5).toString('hex').toUpperCase();
  return raw.slice(0, 5) + '-' + raw.slice(5, 10);
}

// ============ Setup Flow ============

export interface SetupResult {
  secret: string;
  qr_data_url: string;
  manual_entry: string;
}

export async function beginTwoFASetup(userId: string, email: string): Promise<SetupResult> {
  const db = getDb();
  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(email, APP_NAME, secret);
  const qrDataUrl = await QRCode.toDataURL(otpauth, {
    width: 240,
    margin: 1,
    color: { dark: '#0f0f0f', light: '#ffffff' },
  });

  const now = new Date().toISOString();
  const existing = db.prepare('SELECT user_id FROM twofa_secrets WHERE user_id = ?').get(userId);
  if (existing) {
    db.prepare('UPDATE twofa_secrets SET secret = ?, enabled = 0, confirmed_at = NULL, updated_at = ? WHERE user_id = ?')
      .run(secret, now, userId);
  } else {
    db.prepare('INSERT INTO twofa_secrets (user_id, secret, enabled, created_at, updated_at) VALUES (?, ?, 0, ?, ?)')
      .run(userId, secret, now, now);
  }

  return {
    secret,
    qr_data_url: qrDataUrl,
    manual_entry: secret.match(/.{1,4}/g)?.join(' ') ?? secret,
  };
}

// ============ Confirm Setup ============

export interface ConfirmResult {
  enabled: boolean;
  backup_codes: string[];
}

export function confirmTwoFA(userId: string, code: string): ConfirmResult {
  const db = getDb();
  const row = db.prepare('SELECT secret, enabled FROM twofa_secrets WHERE user_id = ?').get(userId) as
    | { secret: string; enabled: number }
    | undefined;
  if (!row) throw new Error('No setup in progress');

  const isValid = authenticator.verify({ token: code, secret: row.secret });
  if (!isValid) throw new Error('Invalid code. Please try again.');

  const now = new Date().toISOString();
  db.prepare('UPDATE twofa_secrets SET enabled = 1, confirmed_at = ?, updated_at = ? WHERE user_id = ?')
    .run(now, now, userId);

  // Invalidate old backup codes and generate new ones
  db.prepare('DELETE FROM twofa_backup_codes WHERE user_id = ?').run(userId);
  const codes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const code = generateBackupCode();
    codes.push(code);
    db.prepare('INSERT INTO twofa_backup_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), userId, hashBackupCode(code), now);
  }

  return { enabled: true, backup_codes: codes };
}

// ============ Verify Login ============

export function verifyTwoFACode(userId: string, code: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT secret, enabled FROM twofa_secrets WHERE user_id = ?').get(userId) as
    | { secret: string; enabled: number }
    | undefined;
  if (!row || !row.enabled) return false;
  return authenticator.verify({ token: code, secret: row.secret });
}

export function verifyBackupCode(userId: string, code: string): boolean {
  const db = getDb();
  const normalized = code.trim().toUpperCase().replace(/\s+/g, '');
  const hash = hashBackupCode(normalized);
  const row = db.prepare(
    'SELECT id FROM twofa_backup_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL'
  ).get(userId, hash) as { id: string } | undefined;
  if (!row) return false;
  db.prepare('UPDATE twofa_backup_codes SET used_at = ? WHERE id = ?')
    .run(new Date().toISOString(), row.id);
  return true;
}

export function consumeTwoFACode(userId: string, code: string): boolean {
  // Try TOTP first, then backup code
  if (verifyTwoFACode(userId, code)) return true;
  if (verifyBackupCode(userId, code)) return true;
  return false;
}

// ============ Status / Disable ============

export function getTwoFAStatus(userId: string): TwoFAStatus {
  const db = getDb();
  const row = db.prepare('SELECT enabled FROM twofa_secrets WHERE user_id = ?').get(userId) as
    | { enabled: number }
    | undefined;
  const backups = db.prepare(
    'SELECT COUNT(*) as n FROM twofa_backup_codes WHERE user_id = ? AND used_at IS NULL'
  ).get(userId) as { n: number };
  return {
    enabled: !!(row && row.enabled),
    has_backup_codes: backups.n,
  };
}

export function isTwoFAEnabled(userId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT enabled FROM twofa_secrets WHERE user_id = ?').get(userId) as
    | { enabled: number }
    | undefined;
  return !!(row && row.enabled);
}

export function disableTwoFA(userId: string, code: string): void {
  const db = getDb();
  const row = db.prepare('SELECT secret, enabled FROM twofa_secrets WHERE user_id = ?').get(userId) as
    | { secret: string; enabled: number }
    | undefined;
  if (!row || !row.enabled) throw new Error('2FA is not enabled');

  const valid = authenticator.verify({ token: code, secret: row.secret }) || verifyBackupCode(userId, code);
  if (!valid) throw new Error('Invalid code');

  db.prepare('DELETE FROM twofa_secrets WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM twofa_backup_codes WHERE user_id = ?').run(userId);
}

// ============ Regenerate Backup Codes ============

export function regenerateBackupCodes(userId: string, code: string): { backup_codes: string[] } {
  const db = getDb();
  if (!verifyTwoFACode(userId, code)) throw new Error('Invalid code');
  db.prepare('DELETE FROM twofa_backup_codes WHERE user_id = ?').run(userId);
  const codes: string[] = [];
  const now = new Date().toISOString();
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const c = generateBackupCode();
    codes.push(c);
    db.prepare('INSERT INTO twofa_backup_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), userId, hashBackupCode(c), now);
  }
  return { backup_codes: codes };
}
