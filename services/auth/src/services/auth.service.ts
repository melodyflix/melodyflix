// melodyflix auth - business logic
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';
import { hashPassword, verifyPassword, signJwt } from './crypto.service.js';
import { toSafeUser, type User, type SafeUser } from '../models/user.model.js';
import { loadConfig } from '@melodyflix/shared-config';
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

export function login(input: LoginInput): { user: SafeUser; token: string } {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE email = ? LIMIT 1').get(input.email) as User | undefined;
  if (!row) throw new Error('Invalid credentials');

  if (!verifyPassword(input.password, row.password_hash)) {
    throw new Error('Invalid credentials');
  }

  const config = loadConfig();
  const expiresInSec = 7 * 24 * 60 * 60;
  const token = signJwt({ sub: row.id, role: row.role }, config.JWT_SECRET, expiresInSec);

  return { user: toSafeUser(row), token };
}

export function getUserById(id: string): SafeUser | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').get(id) as User | undefined;
  return row ? toSafeUser(row) : null;
}
