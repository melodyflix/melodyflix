// melodyflix live — Chat Moderation (7.8 Slow Mode, 7.9 Live Moderator)

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export function ensureModerationSchema(): void {
  const db = getDb();
  db.exec(`
    -- 7.8 Slow Mode: per-stream chat rate limit
    CREATE TABLE IF NOT EXISTS stream_chat_settings (
      stream_id TEXT PRIMARY KEY,
      slow_mode_seconds INTEGER NOT NULL DEFAULT 0,
      subscriber_bypass INTEGER NOT NULL DEFAULT 1,
      followers_only INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    -- 7.9 Live Moderator: moderators, mutes, bans
    CREATE TABLE IF NOT EXISTS stream_moderators (
      id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      added_by TEXT NOT NULL,
      added_at TEXT NOT NULL,
      UNIQUE (stream_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_mods_stream ON stream_moderators(stream_id);

    CREATE TABLE IF NOT EXISTS stream_mutes (
      id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      muted_by TEXT NOT NULL,
      reason TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (stream_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_mutes_stream ON stream_mutes(stream_id);

    CREATE TABLE IF NOT EXISTS stream_bans (
      id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      banned_by TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (stream_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_bans_stream ON stream_bans(stream_id);

    -- 7.8 Slow Mode: per-user last post timestamp
    CREATE TABLE IF NOT EXISTS stream_chat_last_post (
      stream_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      last_posted_at TEXT NOT NULL,
      PRIMARY KEY (stream_id, user_id)
    );
  `);
}

// ============================================================
// 7.8 Slow Mode
// ============================================================

export interface ChatSettings {
  stream_id: string;
  slow_mode_seconds: number;
  subscriber_bypass: number;
  followers_only: number;
  updated_at: string;
}

export function getChatSettings(streamId: string): ChatSettings {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM stream_chat_settings WHERE stream_id = ?'
  ).get(streamId) as ChatSettings | undefined;
  if (row) return row;
  return {
    stream_id: streamId,
    slow_mode_seconds: 0,
    subscriber_bypass: 1,
    followers_only: 0,
    updated_at: new Date(0).toISOString(),
  };
}

export interface SetSlowModeInput {
  slow_mode_seconds: number;      // 0 = off, 1..600
  subscriber_bypass?: boolean;
  followers_only?: boolean;
}

export function setChatSettings(streamId: string, input: SetSlowModeInput): ChatSettings {
  const sec = Math.max(0, Math.min(input.slow_mode_seconds, 600));
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO stream_chat_settings
      (stream_id, slow_mode_seconds, subscriber_bypass, followers_only, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(stream_id) DO UPDATE SET
      slow_mode_seconds = excluded.slow_mode_seconds,
      subscriber_bypass = excluded.subscriber_bypass,
      followers_only = excluded.followers_only,
      updated_at = excluded.updated_at
  `).run(
    streamId, sec,
    input.subscriber_bypass === false ? 0 : 1,
    input.followers_only ? 1 : 0,
    now
  );
  return getChatSettings(streamId);
}

export interface SlowModeCheck {
  allowed: boolean;
  wait_seconds: number;
  slow_mode_seconds: number;
}

// Called before posting a chat message
export function checkSlowMode(
  streamId: string,
  userId: string,
  opts: { isSubscriber?: boolean } = {}
): SlowModeCheck {
  const settings = getChatSettings(streamId);
  if (settings.slow_mode_seconds === 0) {
    return { allowed: true, wait_seconds: 0, slow_mode_seconds: 0 };
  }
  if (settings.subscriber_bypass && opts.isSubscriber) {
    return { allowed: true, wait_seconds: 0, slow_mode_seconds: settings.slow_mode_seconds };
  }

  const db = getDb();
  const row = db.prepare(
    'SELECT last_posted_at FROM stream_chat_last_post WHERE stream_id = ? AND user_id = ?'
  ).get(streamId, userId) as { last_posted_at: string } | undefined;

  if (!row) {
    return { allowed: true, wait_seconds: 0, slow_mode_seconds: settings.slow_mode_seconds };
  }

  const last = new Date(row.last_posted_at).getTime();
  const elapsed = (Date.now() - last) / 1000;
  const wait = settings.slow_mode_seconds - elapsed;
  if (wait > 0) {
    return { allowed: false, wait_seconds: Math.ceil(wait), slow_mode_seconds: settings.slow_mode_seconds };
  }
  return { allowed: true, wait_seconds: 0, slow_mode_seconds: settings.slow_mode_seconds };
}

export function recordChatPost(streamId: string, userId: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO stream_chat_last_post (stream_id, user_id, last_posted_at)
    VALUES (?, ?, ?)
    ON CONFLICT(stream_id, user_id) DO UPDATE SET last_posted_at = excluded.last_posted_at
  `).run(streamId, userId, now);
}

// ============================================================
// 7.9 Live Moderator
// ============================================================

export interface Moderator {
  id: string;
  stream_id: string;
  user_id: string;
  added_by: string;
  added_at: string;
}

export interface Mute {
  id: string;
  stream_id: string;
  user_id: string;
  muted_by: string;
  reason: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface Ban {
  id: string;
  stream_id: string;
  user_id: string;
  banned_by: string;
  reason: string | null;
  created_at: string;
}

export function isModerator(streamId: string, userId: string): boolean {
  const db = getDb();
  const row = db.prepare(
    'SELECT 1 FROM stream_moderators WHERE stream_id = ? AND user_id = ? LIMIT 1'
  ).get(streamId, userId);
  return !!row;
}

export function addModerator(streamId: string, ownerId: string, targetUserId: string): Moderator {
  if (ownerId === targetUserId) throw new Error('Owner is already a moderator');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  try {
    db.prepare(`
      INSERT INTO stream_moderators (id, stream_id, user_id, added_by, added_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, streamId, targetUserId, ownerId, now);
  } catch (e: any) {
    if (String(e?.message ?? '').includes('UNIQUE')) throw new Error('Already a moderator');
    throw e;
  }
  return db.prepare('SELECT * FROM stream_moderators WHERE id = ?').get(id) as Moderator;
}

export function removeModerator(streamId: string, ownerId: string, targetUserId: string): boolean {
  const db = getDb();
  const r = db.prepare(
    'DELETE FROM stream_moderators WHERE stream_id = ? AND user_id = ?'
  ).run(streamId, targetUserId);
  return r.changes > 0;
}

export function listModerators(streamId: string): Moderator[] {
  return getDb().prepare(
    'SELECT * FROM stream_moderators WHERE stream_id = ? ORDER BY added_at ASC'
  ).all(streamId) as Moderator[];
}

// ---- Mutes ----

export function muteUser(input: {
  streamId: string;
  moderatorId: string;
  targetUserId: string;
  durationSeconds?: number | null;
  reason?: string | null;
}): Mute {
  const db = getDb();
  const now = new Date().toISOString();
  const expires = input.durationSeconds && input.durationSeconds > 0
    ? new Date(Date.now() + input.durationSeconds * 1000).toISOString()
    : null;
  const id = randomUUID();
  db.prepare(`
    INSERT INTO stream_mutes (id, stream_id, user_id, muted_by, reason, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(stream_id, user_id) DO UPDATE SET
      muted_by = excluded.muted_by,
      reason = excluded.reason,
      expires_at = excluded.expires_at,
      created_at = excluded.created_at
  `).run(
    id, input.streamId, input.targetUserId, input.moderatorId,
    input.reason ?? null, expires, now
  );
  return db.prepare(
    'SELECT * FROM stream_mutes WHERE stream_id = ? AND user_id = ?'
  ).get(input.streamId, input.targetUserId) as Mute;
}

export function unmuteUser(streamId: string, targetUserId: string): boolean {
  const r = getDb().prepare(
    'DELETE FROM stream_mutes WHERE stream_id = ? AND user_id = ?'
  ).run(streamId, targetUserId);
  return r.changes > 0;
}

export function listMutes(streamId: string): Mute[] {
  return getDb().prepare(
    'SELECT * FROM stream_mutes WHERE stream_id = ? ORDER BY created_at DESC'
  ).all(streamId) as Mute[];
}

export interface MuteStatus {
  muted: boolean;
  expires_at: string | null;
  reason: string | null;
}

export function checkMute(streamId: string, userId: string): MuteStatus {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM stream_mutes WHERE stream_id = ? AND user_id = ?'
  ).get(streamId, userId) as Mute | undefined;
  if (!row) return { muted: false, expires_at: null, reason: null };
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    // Expired — cleanup lazily
    db.prepare('DELETE FROM stream_mutes WHERE id = ?').run(row.id);
    return { muted: false, expires_at: null, reason: null };
  }
  return { muted: true, expires_at: row.expires_at, reason: row.reason };
}

// ---- Bans ----

export function banUser(input: {
  streamId: string;
  moderatorId: string;
  targetUserId: string;
  reason?: string | null;
}): Ban {
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO stream_bans (id, stream_id, user_id, banned_by, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(stream_id, user_id) DO UPDATE SET
      banned_by = excluded.banned_by,
      reason = excluded.reason,
      created_at = excluded.created_at
  `).run(
    id, input.streamId, input.targetUserId, input.moderatorId,
    input.reason ?? null, now
  );
  return db.prepare(
    'SELECT * FROM stream_bans WHERE stream_id = ? AND user_id = ?'
  ).get(input.streamId, input.targetUserId) as Ban;
}

export function unbanUser(streamId: string, targetUserId: string): boolean {
  const r = getDb().prepare(
    'DELETE FROM stream_bans WHERE stream_id = ? AND user_id = ?'
  ).run(streamId, targetUserId);
  return r.changes > 0;
}

export function isBanned(streamId: string, userId: string): boolean {
  const db = getDb();
  return !!db.prepare(
    'SELECT 1 FROM stream_bans WHERE stream_id = ? AND user_id = ? LIMIT 1'
  ).get(streamId, userId);
}

export function listBans(streamId: string): Ban[] {
  return getDb().prepare(
    'SELECT * FROM stream_bans WHERE stream_id = ? ORDER BY created_at DESC'
  ).all(streamId) as Ban[];
}

// ---- Unified permission check ----

export interface ChatPermission {
  can_post: boolean;
  reason: 'ok' | 'banned' | 'muted' | 'slow_mode' | 'followers_only';
  wait_seconds: number;
  slow_mode_seconds: number;
  mute_expires_at: string | null;
}

export function checkChatPermission(input: {
  streamId: string;
  userId: string;
  isSubscriber?: boolean;
  isFollowing?: boolean;
}): ChatPermission {
  const settings = getChatSettings(input.streamId);

  // Ban: immediate block
  if (isBanned(input.streamId, input.userId)) {
    return {
      can_post: false, reason: 'banned', wait_seconds: 0,
      slow_mode_seconds: settings.slow_mode_seconds, mute_expires_at: null,
    };
  }

  // Mute: block until expiry
  const mute = checkMute(input.streamId, input.userId);
  if (mute.muted) {
    return {
      can_post: false, reason: 'muted', wait_seconds: 0,
      slow_mode_seconds: settings.slow_mode_seconds, mute_expires_at: mute.expires_at,
    };
  }

  // Followers-only gate
  if (settings.followers_only && !input.isFollowing && !input.isSubscriber) {
    return {
      can_post: false, reason: 'followers_only', wait_seconds: 0,
      slow_mode_seconds: settings.slow_mode_seconds, mute_expires_at: null,
    };
  }

  // Slow mode
  const slow = checkSlowMode(input.streamId, input.userId, { isSubscriber: input.isSubscriber });
  if (!slow.allowed) {
    return {
      can_post: false, reason: 'slow_mode', wait_seconds: slow.wait_seconds,
      slow_mode_seconds: settings.slow_mode_seconds, mute_expires_at: null,
    };
  }

  return {
    can_post: true, reason: 'ok', wait_seconds: 0,
    slow_mode_seconds: settings.slow_mode_seconds, mute_expires_at: null,
  };
}
