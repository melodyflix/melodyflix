// melodyflix videos - Section 11.16 Passkey Login (WebAuthn / FIDO2)
// Handles passkey registration + authentication metadata. The actual
// cryptographic verification happens in the client + is validated here
// against stored public keys.
//
// Note: full WebAuthn signature verification requires @simplewebauthn/server.
// This module handles: challenge issuance, credential storage, counter
// tracking, passkey rename/delete, and auth event recording.
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type ChallengeType = 'registration' | 'authentication';
export type PasskeyStatus = 'active' | 'revoked';
export type Aaguid = string | null;   // authenticator model id

export interface PasskeyChallenge {
  id: string;
  user_id: string;
  type: ChallengeType;
  challenge: string;             // base64url random
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export interface UserPasskey {
  id: string;
  user_id: string;
  credential_id: string;         // base64url — unique per authenticator
  public_key: string;            // base64url COSE
  counter: number;
  transports: string | null;     // JSON: ["usb","nfc","ble","internal","hybrid"]
  aaguid: Aaguid;
  device_name: string | null;
  is_backup_eligible: number;
  is_backed_up: number;
  status: PasskeyStatus;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
}

export interface PasskeyEvent {
  id: string;
  passkey_id: string | null;
  user_id: string;
  event_type: string;
  ip_address: string | null;
  user_agent: string | null;
  note: string | null;
  metadata: string | null;
  created_at: string;
}

export interface RegisterInput {
  user_id: string;
  challenge_id: string;
  credential_id: string;
  public_key: string;
  counter?: number;
  transports?: string[];
  aaguid?: Aaguid;
  device_name?: string | null;
  is_backup_eligible?: boolean;
  is_backed_up?: boolean;
  ip_address?: string | null;
  user_agent?: string | null;
}

const CHALLENGE_TTL_SECONDS = 300;   // 5 minutes
const VALID_TRANSPORTS = ['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card'];

export function ensurePasskeySchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS passkey_challenges (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('registration','authentication')),
      challenge TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pkch_user ON passkey_challenges(user_id, type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pkch_expires ON passkey_challenges(expires_at);

    CREATE TABLE IF NOT EXISTS user_passkeys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      credential_id TEXT NOT NULL,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT,
      aaguid TEXT,
      device_name TEXT,
      is_backup_eligible INTEGER NOT NULL DEFAULT 0,
      is_backed_up INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
      last_used_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revoked_at TEXT,
      revoked_reason TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pk_cred ON user_passkeys(credential_id);
    CREATE INDEX IF NOT EXISTS idx_pk_user ON user_passkeys(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_pk_aaguid ON user_passkeys(aaguid);

    CREATE TABLE IF NOT EXISTS passkey_events (
      id TEXT PRIMARY KEY,
      passkey_id TEXT,
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      note TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pkev_user ON passkey_events(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pkev_passkey ON passkey_events(passkey_id);
  `);
}

function rowToPasskey(r: any): UserPasskey {
  return {
    ...r,
    transports: r.transports,
  } as UserPasskey;
}
function rowToChallenge(r: any): PasskeyChallenge { return r as PasskeyChallenge; }

function logEvent(userId: string, passkeyId: string | null, eventType: string, opts: {
  ip?: string | null;
  userAgent?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown> | null;
} = {}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO passkey_events
      (id, passkey_id, user_id, event_type, ip_address, user_agent, note, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), passkeyId, userId, eventType,
    opts.ip ?? null, opts.userAgent ?? null,
    opts.note ?? null,
    opts.metadata ? JSON.stringify(opts.metadata) : null,
    new Date().toISOString(),
  );
}

// ============================================================
// Challenges
// ============================================================

/** Generate a WebAuthn challenge (base64url, 32 bytes). */
function newChallengeValue(): string {
  return randomBytes(32).toString('base64url');
}

export function createChallenge(userId: string, type: ChallengeType, ttlSeconds = CHALLENGE_TTL_SECONDS): PasskeyChallenge {
  if (!['registration', 'authentication'].includes(type)) throw new Error('Invalid challenge type');
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 600) {
    throw new Error('ttlSeconds must be 30-600');
  }
  const db = getDb();
  const id = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

  // Invalidate any prior unconsumed challenges of the same type for this user
  db.prepare(`
    UPDATE passkey_challenges
    SET consumed_at = ?
    WHERE user_id = ? AND type = ? AND consumed_at IS NULL
  `).run(now.toISOString(), userId, type);

  db.prepare(`
    INSERT INTO passkey_challenges (id, user_id, type, challenge, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, userId, type, newChallengeValue(), expiresAt, now.toISOString());

  return getChallenge(id)!;
}

export function getChallenge(id: string): PasskeyChallenge | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM passkey_challenges WHERE id = ?').get(id) as any;
  return r ? rowToChallenge(r) : null;
}

/** Verify + mark challenge consumed. Returns the challenge on success. */
export function consumeChallenge(id: string, userId: string, type: ChallengeType): PasskeyChallenge {
  const db = getDb();
  const ch = getChallenge(id);
  if (!ch) throw new Error('Challenge not found');
  if (ch.user_id !== userId) throw new Error('Challenge belongs to another user');
  if (ch.type !== type) throw new Error(`Challenge is for ${ch.type}, not ${type}`);
  if (ch.consumed_at) throw new Error('Challenge already used');
  if (ch.expires_at < new Date().toISOString()) throw new Error('Challenge expired');

  db.prepare('UPDATE passkey_challenges SET consumed_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id);
  return { ...ch, consumed_at: new Date().toISOString() };
}

export function pruneExpiredChallenges(olderThanHours = 24): { pruned: number } {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanHours * 3600_000).toISOString();
  const info = db.prepare('DELETE FROM passkey_challenges WHERE expires_at < ?').run(cutoff);
  return { pruned: info.changes };
}

// ============================================================
// Passkey storage
// ============================================================

export function hashCredentialId(credentialId: string): string {
  return createHash('sha256').update(credentialId).digest('hex').slice(0, 16);
}

function validateRegister(input: RegisterInput): void {
  if (!input.user_id) throw new Error('user_id is required');
  if (!input.challenge_id) throw new Error('challenge_id is required');
  if (!input.credential_id || input.credential_id.length < 16 || input.credential_id.length > 2000) {
    throw new Error('credential_id must be 16-2000 chars (base64url)');
  }
  if (!input.public_key || input.public_key.length < 16 || input.public_key.length > 4000) {
    throw new Error('public_key must be 16-4000 chars (base64url COSE)');
  }
  if (input.counter !== undefined) {
    if (!Number.isInteger(input.counter) || input.counter < 0) throw new Error('counter must be non-negative integer');
  }
  if (input.transports) {
    for (const t of input.transports) {
      if (!VALID_TRANSPORTS.includes(t)) throw new Error(`Invalid transport: ${t}`);
    }
  }
  if (input.aaguid && (typeof input.aaguid !== 'string' || input.aaguid.length > 100)) {
    throw new Error('aaguid max 100 chars');
  }
  if (input.device_name && input.device_name.length > 100) {
    throw new Error('device_name max 100 chars');
  }
}

export function registerPasskey(input: RegisterInput): UserPasskey {
  validateRegister(input);

  // Consume the challenge first
  consumeChallenge(input.challenge_id, input.user_id, 'registration');

  const db = getDb();

  // Ensure credential_id isn't already registered (across any user)
  const existing = db.prepare(
    'SELECT id, user_id FROM user_passkeys WHERE credential_id = ?'
  ).get(input.credential_id) as { id: string; user_id: string } | undefined;
  if (existing) {
    if (existing.user_id === input.user_id) {
      throw new Error('This credential is already registered to your account');
    }
    throw new Error('This credential is already registered to another account');
  }

  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO user_passkeys
      (id, user_id, credential_id, public_key, counter, transports, aaguid,
       device_name, is_backup_eligible, is_backed_up, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(
    id, input.user_id, input.credential_id, input.public_key,
    input.counter ?? 0,
    input.transports ? JSON.stringify(input.transports) : null,
    input.aaguid ?? null,
    input.device_name ?? null,
    input.is_backup_eligible ? 1 : 0,
    input.is_backed_up ? 1 : 0,
    now, now,
  );

  logEvent(input.user_id, id, 'registered', {
    ip: input.ip_address,
    userAgent: input.user_agent,
    metadata: {
      credential_hash: hashCredentialId(input.credential_id),
      aaguid: input.aaguid ?? null,
      transports: input.transports ?? [],
    },
  });

  return getPasskey(id)!;
}

export function getPasskey(id: string): UserPasskey | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM user_passkeys WHERE id = ?').get(id) as any;
  return r ? rowToPasskey(r) : null;
}

export function getPasskeyByCredentialId(credentialId: string): UserPasskey | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM user_passkeys WHERE credential_id = ?').get(credentialId) as any;
  return r ? rowToPasskey(r) : null;
}

export function listPasskeys(userId: string, activeOnly = true): UserPasskey[] {
  const db = getDb();
  const w = activeOnly ? "AND status = 'active'" : '';
  return db.prepare(
    `SELECT * FROM user_passkeys WHERE user_id = ? ${w} ORDER BY created_at DESC`
  ).all(userId) as UserPasskey[];
}

export function renamePasskey(id: string, userId: string, deviceName: string): UserPasskey {
  if (!deviceName || deviceName.trim().length < 1 || deviceName.length > 100) {
    throw new Error('device_name must be 1-100 chars');
  }
  const db = getDb();
  const p = getPasskey(id);
  if (!p) throw new Error('Passkey not found');
  if (p.user_id !== userId) throw new Error('Not your passkey');

  db.prepare('UPDATE user_passkeys SET device_name = ?, updated_at = ? WHERE id = ?')
    .run(deviceName.trim(), new Date().toISOString(), id);
  return getPasskey(id)!;
}

export function revokePasskey(id: string, userId: string, reason?: string): UserPasskey {
  const db = getDb();
  const p = getPasskey(id);
  if (!p) throw new Error('Passkey not found');
  if (p.user_id !== userId) throw new Error('Not your passkey');
  if (p.status === 'revoked') return p;

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE user_passkeys
    SET status = 'revoked', revoked_at = ?, revoked_reason = ?, updated_at = ?
    WHERE id = ?
  `).run(now, reason ?? null, now, id);

  logEvent(userId, id, 'revoked', { note: reason ?? 'Revoked by user' });
  return getPasskey(id)!;
}

/** Touch passkey: update counter + last_used_at after successful auth. */
export function touchPasskey(id: string, newCounter: number): UserPasskey {
  if (!Number.isInteger(newCounter) || newCounter < 0) throw new Error('counter must be non-negative integer');
  const db = getDb();
  const p = getPasskey(id);
  if (!p) throw new Error('Passkey not found');
  if (p.status !== 'active') throw new Error('Passkey is not active');
  if (newCounter <= p.counter && p.counter !== 0) {
    // Counter regression may indicate cloned authenticator
    logEvent(p.user_id, id, 'counter_regression', {
      metadata: { expected_above: p.counter, got: newCounter },
    });
    throw new Error('Authenticator counter regressed — possible cloned credential');
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE user_passkeys SET counter = ?, last_used_at = ?, updated_at = ? WHERE id = ?')
    .run(newCounter, now, now, id);
  return getPasskey(id)!;
}

/** Record successful authentication for audit trail. */
export function recordAuthentication(userId: string, passkeyId: string, opts: {
  ip_address?: string | null;
  user_agent?: string | null;
} = {}): void {
  logEvent(userId, passkeyId, 'authenticated', {
    ip: opts.ip_address,
    userAgent: opts.user_agent,
  });
}

export function listEvents(userId: string, limit = 100): PasskeyEvent[] {
  const db = getDb();
  const lim = Math.min(Math.max(limit, 1), 500);
  return db.prepare(
    `SELECT * FROM passkey_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ${lim}`
  ).all(userId) as PasskeyEvent[];
}

// ============================================================
// Admin / stats
// ============================================================

export interface PasskeyStats {
  total_passkeys: number;
  active_passkeys: number;
  users_with_passkeys: number;
  by_aaguid: Array<{ aaguid: string; count: number }>;
  by_transport: Record<string, number>;
  registrations_24h: number;
  authentications_24h: number;
}

export function getPasskeyStats(): PasskeyStats {
  const db = getDb();
  const since = new Date(Date.now() - 86400_000).toISOString();

  const total = (db.prepare('SELECT COUNT(*) as c FROM user_passkeys').get() as { c: number }).c;
  const active = (db.prepare(
    "SELECT COUNT(*) as c FROM user_passkeys WHERE status = 'active'"
  ).get() as { c: number }).c;
  const users = (db.prepare(
    "SELECT COUNT(DISTINCT user_id) as c FROM user_passkeys WHERE status = 'active'"
  ).get() as { c: number }).c;

  const byAaguid = db.prepare(`
    SELECT aaguid, COUNT(*) as count FROM user_passkeys
    WHERE status = 'active' AND aaguid IS NOT NULL
    GROUP BY aaguid ORDER BY count DESC LIMIT 20
  `).all() as Array<{ aaguid: string; count: number }>;

  const byTransport: Record<string, number> = {};
  for (const r of db.prepare(
    "SELECT transports FROM user_passkeys WHERE status = 'active' AND transports IS NOT NULL"
  ).all() as Array<{ transports: string }>) {
    try {
      const arr = JSON.parse(r.transports) as string[];
      for (const t of arr) byTransport[t] = (byTransport[t] ?? 0) + 1;
    } catch { /* skip */ }
  }

  const reg24h = (db.prepare(
    "SELECT COUNT(*) as c FROM passkey_events WHERE event_type = 'registered' AND created_at >= ?"
  ).get(since) as { c: number }).c;
  const auth24h = (db.prepare(
    "SELECT COUNT(*) as c FROM passkey_events WHERE event_type = 'authenticated' AND created_at >= ?"
  ).get(since) as { c: number }).c;

  return {
    total_passkeys: total,
    active_passkeys: active,
    users_with_passkeys: users,
    by_aaguid: byAaguid,
    by_transport: byTransport,
    registrations_24h: reg24h,
    authentications_24h: auth24h,
  };
}
