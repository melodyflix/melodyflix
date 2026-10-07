// melodyflix videos - Section 11.19 Secret/Key Management
// AES-256-GCM encrypted secret storage with versioning + audit trail.
// Master key lives in ENV (MELODYFLIX_MASTER_KEY, base64url 32 bytes).
// Secrets are never returned in plaintext by list APIs — only masked.
import { randomUUID, randomBytes, createCipheriv, createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type SecretCategory = 'api_key' | 'oauth' | 'db_credential' | 'smtp' | 'payment' | 'encryption_key' | 'webhook' | 'other';

export interface SecretRecord {
  id: string;
  name: string;
  category: SecretCategory;
  description: string | null;
  ciphertext: string;            // base64 — never exposed
  iv: string;                    // base64 — never exposed
  auth_tag: string;              // base64 — never exposed
  value_preview: string;         // masked: "••••1234" — safe to display
  version: number;
  is_active: number;
  expires_at: string | null;
  last_rotated_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecretView {
  id: string;
  name: string;
  category: SecretCategory;
  description: string | null;
  value_preview: string;
  version: number;
  is_active: boolean;
  expires_at: string | null;
  last_rotated_at: string | null;
  created_at: string;
  updated_at: string;
  is_expired: boolean;
}

export interface SecretEvent {
  id: string;
  secret_id: string | null;
  secret_name: string;
  actor_id: string | null;
  event_type: string;
  note: string | null;
  metadata: string | null;
  created_at: string;
}

const VALID_CATEGORIES: SecretCategory[] = ['api_key', 'oauth', 'db_credential', 'smtp', 'payment', 'encryption_key', 'webhook', 'other'];

// ============================================================
// Master key handling
// ============================================================

function loadMasterKey(): Buffer {
  const raw = process.env.MELODYFLIX_MASTER_KEY;
  if (!raw) {
    throw new Error(
      'MELODYFLIX_MASTER_KEY is not set. Generate one with: ' +
      'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"'
    );
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, 'base64url');
  } catch {
    throw new Error('MELODYFLIX_MASTER_KEY must be base64url-encoded');
  }
  if (buf.length !== 32) {
    throw new Error(`MELODYFLIX_MASTER_KEY must decode to 32 bytes (got ${buf.length})`);
  }
  return buf;
}

/** True if master key is present + valid. */
export function isMasterKeyConfigured(): boolean {
  try { loadMasterKey(); return true; } catch { return false; }
}

/** Mask a secret value for safe display: "••••" + last 4 chars. */
function maskValue(value: string): string {
  if (!value) return '••••';
  const s = String(value);
  if (s.length <= 4) return '••••' + s;
  return '••••' + s.slice(-4);
}

// ============================================================
// Encryption (AES-256-GCM)
// ============================================================

interface EncryptedBlob {
  ciphertext: string;
  iv: string;
  auth_tag: string;
  preview: string;
}

function encrypt(plaintext: string, masterKey: Buffer): EncryptedBlob {
  const iv = randomBytes(12); // GCM standard 96-bit IV
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    auth_tag: authTag.toString('base64'),
    preview: maskValue(plaintext),
  };
}

function decrypt(ciphertextB64: string, ivB64: string, authTagB64: string, masterKey: Buffer): string {
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

/** SHA-256 fingerprint of a plaintext value — used for dedupe/audit without exposing value. */
export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

// ============================================================
// Schema
// ============================================================

export function ensureSecretVaultSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS secrets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      value_preview TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      last_rotated_at TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_secret_name ON secrets(name);
    CREATE INDEX IF NOT EXISTS idx_secret_category ON secrets(category, is_active);
    CREATE INDEX IF NOT EXISTS idx_secret_expires ON secrets(expires_at);

    CREATE TABLE IF NOT EXISTS secret_events (
      id TEXT PRIMARY KEY,
      secret_id TEXT,
      secret_name TEXT NOT NULL,
      actor_id TEXT,
      event_type TEXT NOT NULL,
      note TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_secretev_secret ON secret_events(secret_id);
    CREATE INDEX IF NOT EXISTS idx_secretev_name ON secret_events(secret_name);
    CREATE INDEX IF NOT EXISTS idx_secretev_created ON secret_events(created_at DESC);
  `);
}

function rowToSecret(r: any): SecretRecord { return r as SecretRecord; }

function toView(r: SecretRecord): SecretView {
  const now = new Date().toISOString();
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    description: r.description,
    value_preview: r.value_preview,
    version: r.version,
    is_active: r.is_active === 1,
    expires_at: r.expires_at,
    last_rotated_at: r.last_rotated_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
    is_expired: !!(r.expires_at && r.expires_at <= now),
  };
}

function logEvent(secretId: string | null, secretName: string, actorId: string | null, eventType: string, note?: string | null, metadata?: Record<string, unknown> | null): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO secret_events (id, secret_id, secret_name, actor_id, event_type, note, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), secretId, secretName, actorId, eventType,
    note ?? null,
    metadata ? JSON.stringify(metadata) : null,
    new Date().toISOString(),
  );
}

// ============================================================
// CRUD
// ============================================================

export interface CreateSecretInput {
  name: string;
  category: SecretCategory;
  description?: string | null;
  value: string;
  expires_at?: string | null;
  created_by?: string | null;
}

function validateName(name: string): string {
  const n = (name || '').trim();
  if (n.length < 3 || n.length > 120) throw new Error('name must be 3-120 chars');
  if (!/^[A-Za-z0-9_.:-]+$/.test(n)) throw new Error('name may only contain A-Z a-z 0-9 _ . : -');
  return n;
}

export function createSecret(input: CreateSecretInput): SecretView {
  const name = validateName(input.name);
  if (!VALID_CATEGORIES.includes(input.category)) throw new Error(`Invalid category: ${input.category}`);
  if (!input.value || typeof input.value !== 'string') throw new Error('value is required');
  if (input.value.length > 100_000) throw new Error('value too large (max 100k)');
  if (input.expires_at && new Date(input.expires_at).getTime() <= Date.now()) {
    throw new Error('expires_at must be in the future');
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM secrets WHERE name = ?').get(name) as { id: string } | undefined;
  if (existing) throw new Error(`Secret "${name}" already exists — use rotate instead`);

  const masterKey = loadMasterKey();
  const enc = encrypt(input.value, masterKey);

  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO secrets
      (id, name, category, description, ciphertext, iv, auth_tag, value_preview,
       version, is_active, expires_at, last_rotated_at, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, NULL, ?, ?, ?)
  `).run(
    id, name, input.category, input.description ?? null,
    enc.ciphertext, enc.iv, enc.auth_tag, enc.preview,
    input.expires_at ?? null,
    input.created_by ?? null, now, now,
  );

  logEvent(id, name, input.created_by ?? null, 'created', 'Secret created', {
    metadata: {
      category: input.category,
      fingerprint: fingerprint(input.value),
      length: input.value.length,
      expires_at: input.expires_at ?? null,
    },
  });

  return toView(getSecret(id)!);
}

function getSecret(id: string): SecretRecord | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM secrets WHERE id = ?').get(id) as any;
  return r ? rowToSecret(r) : null;
}

export function getSecretByName(name: string): SecretRecord | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM secrets WHERE name = ?').get(name) as any;
  return r ? rowToSecret(r) : null;
}

export function getSecretView(id: string): SecretView | null {
  const r = getSecret(id);
  return r ? toView(r) : null;
}

export interface ListSecretsOpts {
  category?: SecretCategory;
  active_only?: boolean;
  include_expired?: boolean;
  limit?: number;
  offset?: number;
}

export function listSecrets(opts: ListSecretsOpts = {}): { secrets: SecretView[]; total: number } {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];

  if (opts.category) { where.push('category = ?'); params.push(opts.category); }
  if (opts.active_only) where.push('is_active = 1');
  if (!opts.include_expired) {
    where.push("(expires_at IS NULL OR expires_at > ?)");
    params.push(new Date().toISOString());
  }

  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);

  const total = (db.prepare(`SELECT COUNT(*) as c FROM secrets ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT * FROM secrets ${w} ORDER BY name ASC LIMIT ${limit} OFFSET ${offset}`
  ).all(...params) as SecretRecord[];

  return { secrets: rows.map(toView), total };
}

export interface UpdateSecretMetaInput {
  description?: string | null;
  category?: SecretCategory;
  is_active?: boolean;
  expires_at?: string | null;
}

export function updateSecretMeta(id: string, patch: UpdateSecretMetaInput, actorId: string | null): SecretView {
  const db = getDb();
  const existing = getSecret(id);
  if (!existing) throw new Error('Secret not found');

  const fields: string[] = [];
  const params: any[] = [];

  if (patch.description !== undefined) {
    fields.push('description = ?'); params.push(patch.description);
  }
  if (patch.category !== undefined) {
    if (!VALID_CATEGORIES.includes(patch.category)) throw new Error('Invalid category');
    fields.push('category = ?'); params.push(patch.category);
  }
  if (patch.is_active !== undefined) {
    fields.push('is_active = ?'); params.push(patch.is_active ? 1 : 0);
  }
  if (patch.expires_at !== undefined) {
    if (patch.expires_at !== null && new Date(patch.expires_at).getTime() <= Date.now()) {
      throw new Error('expires_at must be in the future');
    }
    fields.push('expires_at = ?'); params.push(patch.expires_at);
  }

  if (fields.length === 0) return toView(existing);

  fields.push('updated_at = ?'); params.push(new Date().toISOString());
  params.push(id);

  db.prepare(`UPDATE secrets SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  logEvent(id, existing.name, actorId, 'metadata_updated', 'Metadata updated', { metadata: patch });
  return toView(getSecret(id)!);
}

/** Rotate: re-encrypt with a new plaintext value + bump version. */
export function rotateSecret(id: string, newValue: string, actorId: string | null): SecretView {
  if (!newValue || typeof newValue !== 'string') throw new Error('new value required');
  if (newValue.length > 100_000) throw new Error('value too large (max 100k)');

  const db = getDb();
  const existing = getSecret(id);
  if (!existing) throw new Error('Secret not found');

  const masterKey = loadMasterKey();
  const enc = encrypt(newValue, masterKey);
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE secrets
    SET ciphertext = ?, iv = ?, auth_tag = ?, value_preview = ?,
        version = version + 1, last_rotated_at = ?, updated_at = ?
    WHERE id = ?
  `).run(enc.ciphertext, enc.iv, enc.auth_tag, enc.preview, now, now, id);

  logEvent(id, existing.name, actorId, 'rotated', `Rotated to version ${existing.version + 1}`, {
    metadata: { new_version: existing.version + 1, new_fingerprint: fingerprint(newValue) },
  });

  return toView(getSecret(id)!);
}

export function deleteSecret(id: string, actorId: string | null, reason?: string): boolean {
  const db = getDb();
  const existing = getSecret(id);
  if (!existing) return false;

  db.prepare('DELETE FROM secrets WHERE id = ?').run(id);
  logEvent(null, existing.name, actorId, 'deleted', reason ?? 'Secret deleted', {
    metadata: { original_id: id, version: existing.version },
  });
  return true;
}

// ============================================================
// Read (internal use only — must not be exposed via API)
// ============================================================

/**
 * Decrypt a secret's plaintext value.
 * USE ONLY INSIDE TRUSTED SERVER CODE — NEVER return this via HTTP API.
 * Every call is logged to the audit trail.
 */
export function readSecretPlaintext(name: string, actorId: string | null = null, purpose?: string): string | null {
  const rec = getSecretByName(name);
  if (!rec) return null;
  if (rec.is_active !== 1) throw new Error(`Secret "${name}" is inactive`);
  if (rec.expires_at && rec.expires_at <= new Date().toISOString()) {
    throw new Error(`Secret "${name}" is expired`);
  }

  const masterKey = loadMasterKey();
  const plaintext = decrypt(rec.ciphertext, rec.iv, rec.auth_tag, masterKey);

  logEvent(rec.id, name, actorId, 'read', purpose ?? 'Plaintext read', {
    metadata: { version: rec.version, fingerprint: fingerprint(plaintext) },
  });

  return plaintext;
}

/** Rotate all secrets with a new master key (offline operation). */
export function rotateMasterKey(newMasterKeyB64: string, actorId: string | null = null): { reencrypted: number } {
  let newKey: Buffer;
  try {
    newKey = Buffer.from(newMasterKeyB64, 'base64url');
  } catch {
    throw new Error('new master key must be base64url');
  }
  if (newKey.length !== 32) throw new Error('new master key must decode to 32 bytes');

  const oldKey = loadMasterKey();
  const db = getDb();
  const all = db.prepare('SELECT * FROM secrets').all() as SecretRecord[];

  const update = db.prepare(
    'UPDATE secrets SET ciphertext = ?, iv = ?, auth_tag = ?, updated_at = ? WHERE id = ?'
  );
  const now = new Date().toISOString();
  let reencrypted = 0;

  for (const rec of all) {
    try {
      const plaintext = decrypt(rec.ciphertext, rec.iv, rec.auth_tag, oldKey);
      const enc = encrypt(plaintext, newKey);
      update.run(enc.ciphertext, enc.iv, enc.auth_tag, now, rec.id);
      reencrypted++;
      logEvent(rec.id, rec.name, actorId, 'reencrypted', 'Re-encrypted with new master key');
    } catch (e) {
      logEvent(rec.id, rec.name, actorId, 'reencrypt_failed', (e as Error).message);
    }
  }

  return { reencrypted };
}

// ============================================================
// Audit & Stats
// ============================================================

export interface ListEventsOpts {
  secret_name?: string;
  actor_id?: string;
  event_type?: string;
  limit?: number;
  offset?: number;
}

export function listEvents(opts: ListEventsOpts = {}): { events: SecretEvent[]; total: number } {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];

  if (opts.secret_name) { where.push('secret_name = ?'); params.push(opts.secret_name); }
  if (opts.actor_id) { where.push('actor_id = ?'); params.push(opts.actor_id); }
  if (opts.event_type) { where.push('event_type = ?'); params.push(opts.event_type); }

  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);

  const total = (db.prepare(`SELECT COUNT(*) as c FROM secret_events ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT * FROM secret_events ${w} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
  ).all(...params) as any[];

  return { events: rows.map((r) => r as SecretEvent), total };
}

export interface SecretStats {
  total: number;
  active: number;
  expired: number;
  by_category: Record<string, number>;
  expiring_in_30d: number;
  never_rotated: number;
  master_key_configured: boolean;
  events_24h: number;
  reads_24h: number;
}

export function getSecretStats(): SecretStats {
  const db = getDb();
  const now = new Date().toISOString();
  const in30d = new Date(Date.now() + 30 * 86400_000).toISOString();
  const since = new Date(Date.now() - 86400_000).toISOString();

  const total = (db.prepare('SELECT COUNT(*) as c FROM secrets').get() as { c: number }).c;
  const active = (db.prepare(
    "SELECT COUNT(*) as c FROM secrets WHERE is_active = 1 AND (expires_at IS NULL OR expires_at > ?)"
  ).get(now) as { c: number }).c;
  const expired = (db.prepare(
    "SELECT COUNT(*) as c FROM secrets WHERE expires_at IS NOT NULL AND expires_at <= ?"
  ).get(now) as { c: number }).c;

  const byCategory: Record<string, number> = {};
  for (const r of db.prepare(
    'SELECT category, COUNT(*) as c FROM secrets GROUP BY category'
  ).all() as Array<{ category: string; c: number }>) byCategory[r.category] = r.c;

  const expiringSoon = (db.prepare(
    "SELECT COUNT(*) as c FROM secrets WHERE is_active = 1 AND expires_at IS NOT NULL AND expires_at <= ? AND expires_at > ?"
  ).get(in30d, now) as { c: number }).c;

  const neverRotated = (db.prepare(
    'SELECT COUNT(*) as c FROM secrets WHERE last_rotated_at IS NULL'
  ).get() as { c: number }).c;

  const events24h = (db.prepare(
    'SELECT COUNT(*) as c FROM secret_events WHERE created_at >= ?'
  ).get(since) as { c: number }).c;

  const reads24h = (db.prepare(
    "SELECT COUNT(*) as c FROM secret_events WHERE event_type = 'read' AND created_at >= ?"
  ).get(since) as { c: number }).c;

  return {
    total,
    active,
    expired,
    by_category: byCategory,
    expiring_in_30d: expiringSoon,
    never_rotated: neverRotated,
    master_key_configured: isMasterKeyConfigured(),
    events_24h: events24h,
    reads_24h: reads24h,
  };
}

export function pruneOldEvents(olderThanDays = 365): { pruned: number } {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000).toISOString();
  const info = db.prepare("DELETE FROM secret_events WHERE created_at < ? AND event_type != 'read'").run(cutoff);
  return { pruned: info.changes };
}
