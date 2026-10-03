// melodyflix auth — Multiple Profiles (Section 1.6)
// Netflix-style: one account, multiple profiles (family members,
// kids mode, etc.). Each profile has its own display name, avatar,
// PIN, and preference scope.

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export interface AccountProfile {
  id: string;
  account_id: string;
  name: string;
  avatar_url: string | null;
  is_kids: number;
  pin_hash: string | null;
  pin_salt: string | null;
  language: string | null;
  autoplay: number;
  max_age_rating: number | null;
  sort_order: number;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export function ensureProfilesSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_profiles (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar_url TEXT,
      is_kids INTEGER NOT NULL DEFAULT 0,
      pin_hash TEXT,
      pin_salt TEXT,
      language TEXT,
      autoplay INTEGER NOT NULL DEFAULT 1,
      max_age_rating INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_profiles_account
      ON account_profiles(account_id, sort_order, created_at);
  `);
}

// ---------- PIN helpers (duplicated minimal logic from livetv) ----------
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

function hashPin(pin: string, salt: string): string {
  return scryptSync(pin, salt, 64).toString('hex');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

// ---------- CRUD ----------

export interface CreateProfileInput {
  account_id: string;
  name: string;
  avatar_url?: string | null;
  is_kids?: boolean;
  pin?: string | null;
  language?: string | null;
  autoplay?: boolean;
  max_age_rating?: number | null;
}

const MAX_PROFILES = 5;

export function createProfile(input: CreateProfileInput): AccountProfile {
  const name = (input.name ?? '').trim();
  if (name.length < 1 || name.length > 40) throw new Error('Name must be 1-40 chars');

  const db = getDb();
  const count = (db.prepare('SELECT COUNT(*) as n FROM account_profiles WHERE account_id = ?')
    .get(input.account_id) as { n: number }).n;
  if (count >= MAX_PROFILES) throw new Error(`Max ${MAX_PROFILES} profiles per account`);

  let pin_hash: string | null = null;
  let pin_salt: string | null = null;
  if (input.pin) {
    if (!/^\d{4,6}$/.test(input.pin)) throw new Error('PIN must be 4-6 digits');
    pin_salt = randomBytes(16).toString('hex');
    pin_hash = hashPin(input.pin, pin_salt);
  }

  const maxAge = input.max_age_rating === undefined || input.max_age_rating === null
    ? (input.is_kids ? 13 : null)
    : Math.max(0, Math.min(21, input.max_age_rating));

  const id = randomUUID();
  const now = new Date().toISOString();
  const isDefault = count === 0 ? 1 : 0;
  const sortOrder = count;

  db.prepare(`
    INSERT INTO account_profiles
      (id, account_id, name, avatar_url, is_kids, pin_hash, pin_salt,
       language, autoplay, max_age_rating, sort_order, is_default,
       created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.account_id, name, input.avatar_url ?? null,
    input.is_kids ? 1 : 0, pin_hash, pin_salt,
    input.language ?? null, input.autoplay === false ? 0 : 1,
    maxAge, sortOrder, isDefault, now, now
  );
  return getProfile(id)!;
}

export function getProfile(id: string): AccountProfile | null {
  const row = getDb().prepare('SELECT * FROM account_profiles WHERE id = ?')
    .get(id) as AccountProfile | undefined;
  return row ?? null;
}

export function listProfiles(accountId: string): AccountProfile[] {
  return getDb().prepare(`
    SELECT * FROM account_profiles
    WHERE account_id = ?
    ORDER BY is_default DESC, sort_order ASC, created_at ASC
  `).all(accountId) as AccountProfile[];
}

export function countProfiles(accountId: string): number {
  return (getDb().prepare(
    'SELECT COUNT(*) as n FROM account_profiles WHERE account_id = ?'
  ).get(accountId) as { n: number }).n;
}

export interface UpdateProfileInput {
  name?: string;
  avatar_url?: string | null;
  is_kids?: boolean;
  language?: string | null;
  autoplay?: boolean;
  max_age_rating?: number | null;
  sort_order?: number;
}

export function updateProfile(
  id: string,
  accountId: string,
  patch: UpdateProfileInput
): AccountProfile | null {
  const cur = getProfile(id);
  if (!cur) return null;
  if (cur.account_id !== accountId) throw new Error('Not your profile');

  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (n.length < 1 || n.length > 40) throw new Error('Name must be 1-40 chars');
  }

  const fields: string[] = [];
  const values: any[] = [];
  const map: Record<string, any> = {
    name: patch.name?.trim(),
    avatar_url: patch.avatar_url,
    is_kids: patch.is_kids === undefined ? undefined : (patch.is_kids ? 1 : 0),
    language: patch.language,
    autoplay: patch.autoplay === undefined ? undefined : (patch.autoplay ? 1 : 0),
    max_age_rating: patch.max_age_rating === undefined
      ? undefined
      : (patch.max_age_rating === null ? null : Math.max(0, Math.min(21, patch.max_age_rating))),
    sort_order: patch.sort_order,
  };
  for (const [k, v] of Object.entries(map)) {
    if (v === undefined) continue;
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (fields.length === 0) return cur;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  getDb().prepare(`UPDATE account_profiles SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getProfile(id);
}

export function deleteProfile(id: string, accountId: string): boolean {
  const cur = getProfile(id);
  if (!cur) return false;
  if (cur.account_id !== accountId) throw new Error('Not your profile');
  if (cur.is_default === 1) throw new Error('Cannot delete the default profile');
  const remaining = countProfiles(accountId);
  if (remaining <= 1) throw new Error('Must have at least one profile');
  return getDb().prepare('DELETE FROM account_profiles WHERE id = ?').run(id).changes > 0;
}

// ---------- Default profile ----------

export function getDefaultProfile(accountId: string): AccountProfile | null {
  const row = getDb().prepare(`
    SELECT * FROM account_profiles
    WHERE account_id = ? AND is_default = 1
    LIMIT 1
  `).get(accountId) as AccountProfile | undefined;
  return row ?? null;
}

export function setDefaultProfile(id: string, accountId: string): AccountProfile | null {
  const cur = getProfile(id);
  if (!cur) return null;
  if (cur.account_id !== accountId) throw new Error('Not your profile');

  const db = getDb();
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE account_profiles SET is_default = 0, updated_at = ? WHERE account_id = ?')
      .run(now, accountId);
    db.prepare('UPDATE account_profiles SET is_default = 1, updated_at = ? WHERE id = ?')
      .run(now, id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return getProfile(id);
}

// ---------- PIN verify ----------

export function setProfilePin(id: string, accountId: string, pin: string): AccountProfile | null {
  const cur = getProfile(id);
  if (!cur) return null;
  if (cur.account_id !== accountId) throw new Error('Not your profile');
  if (!/^\d{4,6}$/.test(pin)) throw new Error('PIN must be 4-6 digits');
  const salt = randomBytes(16).toString('hex');
  const hash = hashPin(pin, salt);
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE account_profiles SET pin_hash = ?, pin_salt = ?, updated_at = ? WHERE id = ?
  `).run(hash, salt, now, id);
  return getProfile(id);
}

export function removeProfilePin(id: string, accountId: string, currentPin: string): boolean {
  const cur = getProfile(id);
  if (!cur) return false;
  if (cur.account_id !== accountId) throw new Error('Not your profile');
  if (!cur.pin_hash || !cur.pin_salt) return true; // already none
  const ok = safeEqual(hashPin(currentPin, cur.pin_salt), cur.pin_hash);
  if (!ok) throw new Error('Incorrect PIN');
  const now = new Date().toISOString();
  getDb().prepare(
    'UPDATE account_profiles SET pin_hash = NULL, pin_salt = NULL, updated_at = ? WHERE id = ?'
  ).run(now, id);
  return true;
}

export function verifyProfilePin(id: string, pin: string): boolean {
  const cur = getProfile(id);
  if (!cur) return false;
  if (!cur.pin_hash || !cur.pin_salt) return true; // no PIN → always allowed
  return safeEqual(hashPin(pin, cur.pin_salt), cur.pin_hash);
}

export function profileHasPin(id: string): boolean {
  const cur = getProfile(id);
  if (!cur) return false;
  return !!cur.pin_hash;
}

// ---------- Aggregate helpers ----------

export interface ProfileSummary {
  account_id: string;
  count: number;
  max_profiles: number;
  profiles: AccountProfile[];
  default_profile_id: string | null;
}

export function summarizeProfiles(accountId: string): ProfileSummary {
  const profiles = listProfiles(accountId);
  return {
    account_id: accountId,
    count: profiles.length,
    max_profiles: MAX_PROFILES,
    profiles,
    default_profile_id: profiles.find((p) => p.is_default === 1)?.id ?? null,
  };
}
