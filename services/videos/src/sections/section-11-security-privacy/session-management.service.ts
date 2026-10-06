// melodyflix videos - Section 11.8 Device/Session Management
// Tracks login sessions per user/device with IP, UA, geo, activity.
// Supports listing, revoking, "log out everywhere", and suspicious-login hooks.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type DeviceType = 'mobile' | 'tablet' | 'desktop' | 'tv' | 'console' | 'bot' | 'unknown';
export type SessionStatus = 'active' | 'revoked' | 'expired';

export interface UserSession {
  id: string;
  user_id: string;
  device_label: string;
  device_type: DeviceType;
  platform: string | null;
  app_version: string | null;
  ip_address: string | null;
  user_agent: string | null;
  country: string | null;
  city: string | null;
  status: SessionStatus;
  is_current: number;
  created_at: string;
  last_active_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
}

export interface SessionEvent {
  id: string;
  session_id: string;
  user_id: string;
  event_type: string;
  actor_id: string | null;
  ip_address: string | null;
  note: string | null;
  metadata: string | null;
  created_at: string;
}

export interface CreateSessionInput {
  user_id: string;
  device_label: string;
  device_type?: DeviceType;
  platform?: string | null;
  app_version?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  country?: string | null;
  city?: string | null;
  ttl_hours?: number;   // default 720 (30 days)
}

const VALID_DEVICE_TYPES: DeviceType[] = ['mobile', 'tablet', 'desktop', 'tv', 'console', 'bot', 'unknown'];

const DEFAULT_TTL_HOURS = 720; // 30 days

export function ensureSessionSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_label TEXT NOT NULL,
      device_type TEXT NOT NULL DEFAULT 'unknown',
      platform TEXT,
      app_version TEXT,
      ip_address TEXT,
      user_agent TEXT,
      country TEXT,
      city TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
      is_current INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      expires_at TEXT,
      revoked_at TEXT,
      revoked_by TEXT,
      revoke_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_session_user ON user_sessions(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_session_active ON user_sessions(status, last_active_at DESC);
    CREATE INDEX IF NOT EXISTS idx_session_created ON user_sessions(created_at);
    CREATE INDEX IF NOT EXISTS idx_session_ip ON user_sessions(ip_address);

    CREATE TABLE IF NOT EXISTS session_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor_id TEXT,
      ip_address TEXT,
      note TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_event_session ON session_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_session_event_user ON session_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_session_event_created ON session_events(created_at);
  `);
}

function rowToSession(r: any): UserSession {
  return r as UserSession;
}

function logEvent(sessionId: string, userId: string, eventType: string, opts: {
  actorId?: string | null;
  ip?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown> | null;
} = {}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO session_events (id, session_id, user_id, event_type, actor_id, ip_address, note, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), sessionId, userId, eventType,
    opts.actorId ?? null, opts.ip ?? null, opts.note ?? null,
    opts.metadata ? JSON.stringify(opts.metadata) : null,
    new Date().toISOString(),
  );
}

// ============================================================
// Session CRUD
// ============================================================

function computeExpiry(ttlHours: number): string {
  return new Date(Date.now() + ttlHours * 3600_000).toISOString();
}

function validateCreate(input: CreateSessionInput): void {
  if (!input.user_id || typeof input.user_id !== 'string') throw new Error('user_id is required');
  const label = (input.device_label ?? '').trim();
  if (label.length < 1 || label.length > 80) throw new Error('device_label must be 1-80 chars');
  if (input.device_type && !VALID_DEVICE_TYPES.includes(input.device_type)) {
    throw new Error(`Invalid device_type: ${input.device_type}`);
  }
  if (input.ttl_hours !== undefined) {
    if (!Number.isInteger(input.ttl_hours) || input.ttl_hours < 1 || input.ttl_hours > 8760) {
      throw new Error('ttl_hours must be 1-8760 (max 1 year)');
    }
  }
}

export function createSession(input: CreateSessionInput): UserSession {
  validateCreate(input);
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const ttl = input.ttl_hours ?? DEFAULT_TTL_HOURS;
  const expiresAt = computeExpiry(ttl);

  db.prepare(`
    INSERT INTO user_sessions
      (id, user_id, device_label, device_type, platform, app_version,
       ip_address, user_agent, country, city, status, is_current,
       created_at, last_active_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?)
  `).run(
    id, input.user_id, input.device_label.trim(),
    input.device_type ?? 'unknown',
    input.platform ?? null, input.app_version ?? null,
    input.ip_address ?? null, input.user_agent ?? null,
    input.country ?? null, input.city ?? null,
    now, now, expiresAt,
  );

  logEvent(id, input.user_id, 'created', {
    ip: input.ip_address ?? null,
    metadata: {
      device_type: input.device_type ?? 'unknown',
      platform: input.platform ?? null,
      ttl_hours: ttl,
    },
  });

  return getSession(id)!;
}

export function getSession(id: string): UserSession | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM user_sessions WHERE id = ?').get(id) as any;
  return r ? rowToSession(r) : null;
}

export interface ListSessionsOpts {
  user_id?: string;
  status?: SessionStatus;
  active_only?: boolean;
  limit?: number;
  offset?: number;
}

export function listSessions(opts: ListSessionsOpts = {}): { sessions: UserSession[]; total: number } {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];

  if (opts.user_id) { where.push('user_id = ?'); params.push(opts.user_id); }
  if (opts.status) { where.push('status = ?'); params.push(opts.status); }
  if (opts.active_only) { where.push("status = 'active'"); }

  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const total = (db.prepare(`SELECT COUNT(*) as c FROM user_sessions ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT * FROM user_sessions ${w} ORDER BY last_active_at DESC LIMIT ${limit} OFFSET ${offset}`
  ).all(...params) as any[];

  return { sessions: rows.map(rowToSession), total };
}

/** Mark a session as the "current" one (for UI highlight). Only one at a time per user. */
export function markCurrentSession(sessionId: string): void {
  const db = getDb();
  const s = getSession(sessionId);
  if (!s) throw new Error('Session not found');
  db.prepare('UPDATE user_sessions SET is_current = 0 WHERE user_id = ?').run(s.user_id);
  db.prepare('UPDATE user_sessions SET is_current = 1 WHERE id = ?').run(sessionId);
}

/** Touch session — updates last_active_at, optionally extends expiry. */
export function touchSession(sessionId: string, opts: { extend_hours?: number } = {}): UserSession | null {
  const db = getDb();
  const s = getSession(sessionId);
  if (!s || s.status !== 'active') return null;

  const now = new Date().toISOString();
  const fields = ['last_active_at = ?'];
  const params: any[] = [now];

  if (opts.extend_hours && opts.extend_hours > 0) {
    fields.push('expires_at = ?');
    params.push(computeExpiry(opts.extend_hours));
  }

  params.push(sessionId);
  db.prepare(`UPDATE user_sessions SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getSession(sessionId);
}

export function updateSessionContext(sessionId: string, patch: {
  country?: string | null;
  city?: string | null;
  app_version?: string | null;
}): UserSession | null {
  const db = getDb();
  const s = getSession(sessionId);
  if (!s) return null;

  const fields: string[] = [];
  const params: any[] = [];
  if (patch.country !== undefined) { fields.push('country = ?'); params.push(patch.country); }
  if (patch.city !== undefined) { fields.push('city = ?'); params.push(patch.city); }
  if (patch.app_version !== undefined) { fields.push('app_version = ?'); params.push(patch.app_version); }

  if (fields.length === 0) return s;

  fields.push('last_active_at = ?');
  params.push(new Date().toISOString());
  params.push(sessionId);

  db.prepare(`UPDATE user_sessions SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getSession(sessionId);
}

export function revokeSession(sessionId: string, opts: {
  actor_id?: string | null;
  reason?: string | null;
} = {}): UserSession {
  const db = getDb();
  const s = getSession(sessionId);
  if (!s) throw new Error('Session not found');
  if (s.status !== 'active') return s;

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE user_sessions
    SET status = 'revoked', revoked_at = ?, revoked_by = ?, revoke_reason = ?
    WHERE id = ?
  `).run(now, opts.actor_id ?? null, opts.reason ?? null, sessionId);

  logEvent(sessionId, s.user_id, 'revoked', {
    actorId: opts.actor_id ?? null,
    ip: s.ip_address,
    note: opts.reason ?? 'Session revoked',
  });

  return getSession(sessionId)!;
}

/** Revoke all other sessions for a user (keep current one). */
export function revokeAllOtherSessions(userId: string, currentSessionId: string | null, opts: {
  actor_id?: string | null;
  reason?: string | null;
} = {}): { revoked: number } {
  const db = getDb();
  const now = new Date().toISOString();

  const activeOthers = db.prepare(
    "SELECT id FROM user_sessions WHERE user_id = ? AND status = 'active' AND id != ?"
  ).all(userId, currentSessionId ?? '') as Array<{ id: string }>;

  if (activeOthers.length === 0) return { revoked: 0 };

  const stmt = db.prepare(`
    UPDATE user_sessions
    SET status = 'revoked', revoked_at = ?, revoked_by = ?, revoke_reason = ?
    WHERE id = ?
  `);
  for (const o of activeOthers) {
    stmt.run(now, opts.actor_id ?? null, opts.reason ?? 'Logout all other devices', o.id);
    logEvent(o.id, userId, 'revoked', {
      actorId: opts.actor_id ?? null,
      note: opts.reason ?? 'Revoked via "log out other devices"',
    });
  }

  return { revoked: activeOthers.length };
}

/** Extend a session's expiration by N hours. */
export function extendSession(sessionId: string, hours: number): UserSession {
  if (!Number.isInteger(hours) || hours < 1 || hours > 8760) {
    throw new Error('hours must be 1-8760');
  }
  const db = getDb();
  const s = getSession(sessionId);
  if (!s) throw new Error('Session not found');
  if (s.status !== 'active') throw new Error(`Cannot extend session in status ${s.status}`);

  const newExpiry = computeExpiry(hours);
  const now = new Date().toISOString();
  db.prepare('UPDATE user_sessions SET expires_at = ?, last_active_at = ? WHERE id = ?')
    .run(newExpiry, now, sessionId);

  logEvent(sessionId, s.user_id, 'extended', {
    note: `Extended by ${hours}h`,
    metadata: { hours, new_expires_at: newExpiry },
  });

  return getSession(sessionId)!;
}

export function listSessionEvents(sessionId: string): SessionEvent[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM session_events WHERE session_id = ? ORDER BY created_at ASC'
  ).all(sessionId) as SessionEvent[];
}

// ============================================================
// Stats & Cleanup
// ============================================================

export interface SessionStats {
  total_active: number;
  total_revoked: number;
  total_expired: number;
  unique_devices: number;
  unique_ips: number;
  logins_last_24h: number;
  revokes_last_24h: number;
  window_hours: number;
}

export function getUserSessionStats(userId: string, windowHours = 24): SessionStats {
  const db = getDb();
  const since = new Date(Date.now() - windowHours * 3600_000).toISOString();

  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN status='revoked' THEN 1 ELSE 0 END) as revoked,
      SUM(CASE WHEN status='expired' THEN 1 ELSE 0 END) as expired
    FROM user_sessions WHERE user_id = ?
  `).get(userId) as { active: number | null; revoked: number | null; expired: number | null };

  const devices = (db.prepare(
    "SELECT COUNT(DISTINCT device_label) as c FROM user_sessions WHERE user_id = ?"
  ).get(userId) as { c: number }).c;

  const ips = (db.prepare(
    "SELECT COUNT(DISTINCT ip_address) as c FROM user_sessions WHERE user_id = ? AND ip_address IS NOT NULL"
  ).get(userId) as { c: number }).c;

  const logins = (db.prepare(
    "SELECT COUNT(*) as c FROM session_events WHERE user_id = ? AND event_type = 'created' AND created_at >= ?"
  ).get(userId, since) as { c: number }).c;

  const revokes = (db.prepare(
    "SELECT COUNT(*) as c FROM session_events WHERE user_id = ? AND event_type = 'revoked' AND created_at >= ?"
  ).get(userId, since) as { c: number }).c;

  return {
    total_active: row.active ?? 0,
    total_revoked: row.revoked ?? 0,
    total_expired: row.expired ?? 0,
    unique_devices: devices,
    unique_ips: ips,
    logins_last_24h: logins,
    revokes_last_24h: revokes,
    window_hours: windowHours,
  };
}

export interface AdminSessionStats {
  active_total: number;
  users_with_active: number;
  revoked_last_24h: number;
  expired_last_24h: number;
  by_device_type: Record<string, number>;
}

export function getAdminSessionStats(): AdminSessionStats {
  const db = getDb();
  const since = new Date(Date.now() - 86400_000).toISOString();

  const activeTotal = (db.prepare(
    "SELECT COUNT(*) as c FROM user_sessions WHERE status = 'active'"
  ).get() as { c: number }).c;

  const usersActive = (db.prepare(
    "SELECT COUNT(DISTINCT user_id) as c FROM user_sessions WHERE status = 'active'"
  ).get() as { c: number }).c;

  const revokedLast = (db.prepare(
    "SELECT COUNT(*) as c FROM user_sessions WHERE status = 'revoked' AND revoked_at >= ?"
  ).get(since) as { c: number }).c;

  const expiredLast = (db.prepare(
    "SELECT COUNT(*) as c FROM user_sessions WHERE status = 'expired' AND last_active_at >= ?"
  ).get(since) as { c: number }).c;

  const byDevice: Record<string, number> = {};
  for (const r of db.prepare(
    "SELECT device_type, COUNT(*) as c FROM user_sessions WHERE status = 'active' GROUP BY device_type"
  ).all() as Array<{ device_type: string; c: number }>) {
    byDevice[r.device_type] = r.c;
  }

  return {
    active_total: activeTotal,
    users_with_active: usersActive,
    revoked_last_24h: revokedLast,
    expired_last_24h: expiredLast,
    by_device_type: byDevice,
  };
}

/** Mark expired sessions as expired. Called periodically. */
export function expireStaleSessions(): { expired: number } {
  const db = getDb();
  const now = new Date().toISOString();
  const rows = db.prepare(
    "SELECT id, user_id FROM user_sessions WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < ?"
  ).all(now) as Array<{ id: string; user_id: string }>;

  if (rows.length === 0) return { expired: 0 };

  const stmt = db.prepare("UPDATE user_sessions SET status = 'expired' WHERE id = ?");
  for (const r of rows) {
    stmt.run(r.id);
    logEvent(r.id, r.user_id, 'expired', { note: 'Session expired' });
  }
  return { expired: rows.length };
}

/** Prune old revoked/expired session records (hard delete, default 90 days). */
export function pruneOldSessions(olderThanDays = 90): { pruned: number } {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000).toISOString();
  const info = db.prepare(
    `DELETE FROM user_sessions
     WHERE status IN ('revoked','expired')
       AND COALESCE(revoked_at, last_active_at) < ?`
  ).run(cutoff);
  return { pruned: info.changes };
}
