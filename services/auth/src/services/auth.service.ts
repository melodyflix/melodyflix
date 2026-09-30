// melodyflix auth - business logic
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';
import { hashPassword, verifyPassword, signJwt } from './crypto.service.js';
import { toSafeUser, type User, type SafeUser } from '../models/user.model.js';
import { loadConfig } from '@melodyflix/shared-config';
import { isTwoFAEnabled } from './twofa.service.js';
import { createVerificationToken, sendEmail, getVerificationTemplate } from './email.service.js';
import { publish, CHANNELS } from '@melodyflix/shared-events';

export interface SignupInput {
  email: string;
  username: string;
  password: string;
  displayName?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export function ensureSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      email_verified INTEGER NOT NULL DEFAULT 0,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  `);
}

export function signup(input: SignupInput): SafeUser {
  const db = getDb();
  const existing = db.prepare(
    'SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1'
  ).get(input.email, input.username);

  if (existing) throw new Error('Email or username already taken');

  const now = new Date().toISOString();
  const user: User = {
    id: randomUUID(),
    email: input.email,
    username: input.username,
    password_hash: hashPassword(input.password),
    display_name: input.displayName ?? input.username,
    avatar_url: null,
    email_verified: 0,
    role: 'user',
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO users (id, email, username, password_hash, display_name, avatar_url, email_verified, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.id, user.email, user.username, user.password_hash,
    user.display_name, user.avatar_url, user.email_verified,
    user.role, user.created_at, user.updated_at
  );

  publish(CHANNELS.USER_CREATED, { userId: user.id, username: user.username, email: user.email }).catch(() => {});
  return toSafeUser(user);
}

export type LoginResult =
  | { user: SafeUser; token: string; requires_2fa?: false }
  | { requires_2fa: true; temp_token: string; user_id: string };

export function login(input: LoginInput): LoginResult {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE email = ? LIMIT 1').get(input.email) as User | undefined;
  if (!row) throw new Error('Invalid credentials');

  if (!verifyPassword(input.password, row.password_hash)) {
    throw new Error('Invalid credentials');
  }

  const config = loadConfig();

  // Check if 2FA is enabled
  if (isTwoFAEnabled(row.id)) {
    // Return a short-lived temp token (5 min) to complete 2FA
    const tempToken = signJwt(
      { sub: row.id, role: row.role, purpose: '2fa_verify' },
      config.JWT_SECRET,
      5 * 60
    );
    return { requires_2fa: true, temp_token: tempToken, user_id: row.id };
  }

  const expiresInSec = 7 * 24 * 60 * 60;
  const token = signJwt({ sub: row.id, role: row.role }, config.JWT_SECRET, expiresInSec);

  return { user: toSafeUser(row), token, requires_2fa: false };
}

// Complete 2FA login — verify code and return full token
export function completeTwoFALogin(tempToken: string, code: string): { user: SafeUser; token: string } {
  const config = loadConfig();
  const payload = require('./crypto.service.js').verifyJwt(tempToken, config.JWT_SECRET) as
    | { sub: string; purpose: string; role: string }
    | null;
  if (!payload || payload.purpose !== '2fa_verify') {
    throw new Error('Invalid or expired session');
  }

  const twofa = require('./twofa.service.js');
  const valid = twofa.consumeTwoFACode(payload.sub, code);
  if (!valid) throw new Error('Invalid 2FA code');

  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').get(payload.sub) as User | undefined;
  if (!row) throw new Error('User not found');

  const expiresInSec = 7 * 24 * 60 * 60;
  const token = signJwt({ sub: row.id, role: row.role }, config.JWT_SECRET, expiresInSec);

  return { user: toSafeUser(row), token };
}

export function getUserById(id: string): SafeUser | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').get(id) as User | undefined;
  return row ? toSafeUser(row) : null;
}


// ---------- Send verification email ----------
export async function sendVerificationEmailFor(userId: string, email: string, displayName: string): Promise<void> {
  try {
    const token = createVerificationToken(userId, email);
    const baseUrl = process.env.PUBLIC_BASE_URL ?? 'http://127.0.0.1:5174';
    const verifyUrl = `${baseUrl}/verify-email?token=${token}`;
    const html = getVerificationTemplate(displayName, verifyUrl);
    await sendEmail({
      to: email,
      subject: 'Verify your melodyflix email',
      html,
      user_id: userId,
    });
  } catch (err) {
    // Log but don't fail signup
    const { createLogger } = await import('@melodyflix/shared-logger');
    createLogger('signup').warn({ err: (err as Error).message }, 'verification email failed');
  }
}
