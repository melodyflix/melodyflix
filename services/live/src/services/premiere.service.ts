// melodyflix live — Premiere (7.2)
// A Premiere is a scheduled first-release of an (already uploaded) video.
// It has a countdown, optional pre-show chat, and at T-0 it goes live
// like a stream (with live chat), then transitions to a normal VOD.

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type PremiereStatus = 'scheduled' | 'countdown' | 'live' | 'ended' | 'cancelled';

export interface Premiere {
  id: string;
  stream_id: string;          // reused live_streams row (source='premiere')
  video_id: string;
  owner_id: string;
  title: string;
  description: string | null;
  scheduled_at: string;       // ISO
  countdown_starts_at: string;// ISO — typically scheduled_at - 30min
  duration_seconds: number | null;   // known via video metadata
  status: PremiereStatus;
  chat_enabled: number;
  live_chat_id: string | null;       // ties to a stream chat once live
  thumbnail_url: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export function ensurePremiereSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS premieres (
      id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      scheduled_at TEXT NOT NULL,
      countdown_starts_at TEXT NOT NULL,
      duration_seconds REAL,
      status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled','countdown','live','ended','cancelled')),
      chat_enabled INTEGER NOT NULL DEFAULT 1,
      live_chat_id TEXT,
      thumbnail_url TEXT,
      ended_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_premieres_time
      ON premieres(scheduled_at ASC, status);
    CREATE INDEX IF NOT EXISTS idx_premieres_owner
      ON premieres(owner_id, scheduled_at DESC);
    CREATE INDEX IF NOT EXISTS idx_premieres_status
      ON premieres(status, scheduled_at);

    -- Premiere chat (separate from stream chat so it can exist during countdown)
    CREATE TABLE IF NOT EXISTS premiere_chat (
      id TEXT PRIMARY KEY,
      premiere_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_premiere_chat
      ON premiere_chat(premiere_id, created_at DESC);

    -- RSVP / reminder subscriptions
    CREATE TABLE IF NOT EXISTS premiere_rsvps (
      id TEXT PRIMARY KEY,
      premiere_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      remind_minutes_before INTEGER NOT NULL DEFAULT 15,
      notified_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (premiere_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_rsvps_premiere
      ON premiere_rsvps(premiere_id, user_id);
  `);
}

// ---------- CRUD ----------

export interface CreatePremiereInput {
  video_id: string;
  owner_id: string;
  title?: string;
  description?: string | null;
  scheduled_at: string;          // ISO
  countdown_minutes?: number;    // default 30
  duration_seconds?: number | null;
  chat_enabled?: boolean;
  thumbnail_url?: string | null;
}

const MIN_LEAD_MINUTES = 1;
const MAX_LEAD_MINUTES = 30 * 24 * 60; // 30 days

export function createPremiere(input: CreatePremiereInput): Premiere {
  const scheduledMs = new Date(input.scheduled_at).getTime();
  if (isNaN(scheduledMs)) throw new Error('Invalid scheduled_at');

  const leadMinutes = (scheduledMs - Date.now()) / 60_000;
  if (leadMinutes < MIN_LEAD_MINUTES) throw new Error('Premiere must be scheduled at least 1 minute in the future');
  if (leadMinutes > MAX_LEAD_MINUTES) throw new Error('Premiere cannot be scheduled more than 30 days ahead');

  const countdownMinutes = Math.max(1, Math.min(input.countdown_minutes ?? 30, 60 * 24));
  const countdownStartsMs = scheduledMs - countdownMinutes * 60_000;
  if (countdownStartsMs < Date.now() - 60_000) throw new Error('Countdown start time is in the past');

  const db = getDb();

  // Video metadata lookup is optional — the videos table may live in a
  // separate service. Fall back to caller-supplied metadata.
  let videoOk: { id: string; title: string; description: string | null; duration_seconds: number | null; thumbnail_url: string | null } | undefined;
  try {
    videoOk = db.prepare('SELECT id, title, description, duration_seconds, thumbnail_url FROM videos WHERE id = ?')
      .get(input.video_id) as typeof videoOk;
  } catch {
    // videos table not present in this DB — skip validation
  }

  const title = (input.title ?? videoOk?.title ?? '').slice(0, 200) || 'Premiere';
  const description = input.description ?? videoOk?.description ?? null;
  const duration = input.duration_seconds ?? videoOk?.duration_seconds ?? null;
  const thumb = input.thumbnail_url ?? videoOk?.thumbnail_url ?? null;

  // Create a backing stream row (source='premiere', status='idle' until countdown)
  const streamId = randomUUID();
  const streamKey = 'prm_' + randomUUID().replace(/-/g, '');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO live_streams
      (id, user_id, channel_id, title, description, stream_key, category, status, source, created_at, updated_at)
    VALUES (?, ?, 'ch-1', ?, ?, ?, 'premiere', 'idle', 'premiere', ?, ?)
  `).run(streamId, input.owner_id, title, description, streamKey, now, now);

  const id = randomUUID();
  db.prepare(`
    INSERT INTO premieres
      (id, stream_id, video_id, owner_id, title, description,
       scheduled_at, countdown_starts_at, duration_seconds, status,
       chat_enabled, thumbnail_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)
  `).run(
    id, streamId, input.video_id, input.owner_id, title, description,
    new Date(scheduledMs).toISOString(),
    new Date(countdownStartsMs).toISOString(),
    duration,
    input.chat_enabled === false ? 0 : 1,
    thumb, now, now,
  );

  return getPremiere(id)!;
}

export function getPremiere(id: string): Premiere | null {
  return (getDb().prepare('SELECT * FROM premieres WHERE id = ?').get(id) as Premiere | undefined) ?? null;
}

export function getPremiereByStreamId(streamId: string): Premiere | null {
  return (getDb().prepare('SELECT * FROM premieres WHERE stream_id = ?').get(streamId) as Premiere | undefined) ?? null;
}

export interface ListPremieresOpts {
  owner_id?: string;
  status?: PremiereStatus;
  from?: string;
  to?: string;
  limit?: number;
}

export function listPremieres(opts: ListPremieresOpts = {}): Premiere[] {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];
  if (opts.owner_id) { where.push('owner_id = ?'); params.push(opts.owner_id); }
  if (opts.status) { where.push('status = ?'); params.push(opts.status); }
  if (opts.from) { where.push('scheduled_at >= ?'); params.push(opts.from); }
  if (opts.to) { where.push('scheduled_at <= ?'); params.push(opts.to); }
  const n = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  params.push(n);
  const sql = `SELECT * FROM premieres
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY scheduled_at ASC LIMIT ?`;
  return db.prepare(sql).all(...params) as Premiere[];
}

export function listUpcomingPremieres(limit = 20): Premiere[] {
  const db = getDb();
  const now = new Date().toISOString();
  const n = Math.min(Math.max(limit, 1), 100);
  return db.prepare(`
    SELECT * FROM premieres
    WHERE status IN ('scheduled','countdown') AND scheduled_at >= ?
    ORDER BY scheduled_at ASC LIMIT ?
  `).all(now, n) as Premiere[];
}

export interface UpdatePremiereInput {
  title?: string;
  description?: string | null;
  scheduled_at?: string;
  countdown_minutes?: number;
  chat_enabled?: boolean;
  thumbnail_url?: string | null;
}

export function updatePremiere(id: string, ownerId: string, patch: UpdatePremiereInput): Premiere | null {
  const prm = getPremiere(id);
  if (!prm) return null;
  if (prm.owner_id !== ownerId) throw new Error('Not your premiere');
  if (prm.status === 'live' || prm.status === 'ended') throw new Error('Cannot edit a live or ended premiere');

  const db = getDb();
  const now = new Date().toISOString();
  const fields: string[] = [];
  const values: any[] = [];

  if (patch.title !== undefined) { fields.push('title = ?'); values.push(patch.title.slice(0, 200)); }
  if (patch.description !== undefined) { fields.push('description = ?'); values.push(patch.description); }
  if (patch.chat_enabled !== undefined) { fields.push('chat_enabled = ?'); values.push(patch.chat_enabled ? 1 : 0); }
  if (patch.thumbnail_url !== undefined) { fields.push('thumbnail_url = ?'); values.push(patch.thumbnail_url); }

  if (patch.scheduled_at !== undefined) {
    const ms = new Date(patch.scheduled_at).getTime();
    if (isNaN(ms)) throw new Error('Invalid scheduled_at');
    const lead = (ms - Date.now()) / 60_000;
    if (lead < MIN_LEAD_MINUTES) throw new Error('Must be at least 1 minute in the future');
    const cdMin = patch.countdown_minutes ?? Math.max(1, Math.round((ms - new Date(prm.countdown_starts_at).getTime()) / 60_000));
    const cdStart = ms - Math.max(1, Math.min(cdMin, 60 * 24)) * 60_000;
    fields.push('scheduled_at = ?');
    values.push(new Date(ms).toISOString());
    fields.push('countdown_starts_at = ?');
    values.push(new Date(cdStart).toISOString());
  } else if (patch.countdown_minutes !== undefined) {
    const cdMs = new Date(prm.scheduled_at).getTime() - Math.max(1, Math.min(patch.countdown_minutes, 60 * 24)) * 60_000;
    fields.push('countdown_starts_at = ?');
    values.push(new Date(cdMs).toISOString());
  }

  if (fields.length === 0) return prm;
  fields.push('updated_at = ?');
  values.push(now);
  values.push(id);
  db.prepare(`UPDATE premieres SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getPremiere(id);
}

export function cancelPremiere(id: string, ownerId: string): boolean {
  const prm = getPremiere(id);
  if (!prm) return false;
  if (prm.owner_id !== ownerId) throw new Error('Not your premiere');
  if (prm.status === 'live' || prm.status === 'ended') throw new Error('Cannot cancel a live or ended premiere');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`UPDATE premieres SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(now, id);
  return true;
}

// ---------- State machine ----------

// Called by scheduler worker: transition to countdown / live / ended based on time
export interface TransitionResult {
  changed: Premiere[];
}

export function tickPremieres(nowIso = new Date().toISOString()): TransitionResult {
  const db = getDb();
  const now = new Date(nowIso).getTime();
  const changed: Premiere[] = [];

  // scheduled -> countdown
  const dueToCountdown = db.prepare(`
    SELECT id FROM premieres
    WHERE status = 'scheduled' AND countdown_starts_at <= ? AND scheduled_at > ?
  `).all(new Date(now).toISOString(), new Date(now).toISOString()) as { id: string }[];
  for (const { id } of dueToCountdown) {
    db.prepare(`UPDATE premieres SET status = 'countdown', updated_at = ? WHERE id = ?`)
      .run(new Date(now).toISOString(), id);
    db.prepare(`UPDATE live_streams SET status = 'ready', updated_at = ? WHERE id = (SELECT stream_id FROM premieres WHERE id = ?)`)
      .run(new Date(now).toISOString(), id);
    changed.push(getPremiere(id)!);
  }

  // countdown / scheduled -> live at scheduled_at
  const dueToLive = db.prepare(`
    SELECT id FROM premieres
    WHERE status IN ('scheduled','countdown') AND scheduled_at <= ?
  `).all(new Date(now).toISOString()) as { id: string }[];
  for (const { id } of dueToLive) {
    const prm = getPremiere(id)!;
    db.prepare(`UPDATE premieres SET status = 'live', updated_at = ? WHERE id = ?`)
      .run(new Date(now).toISOString(), id);
    db.prepare(`UPDATE live_streams SET status = 'live', started_at = ?, updated_at = ? WHERE id = ?`)
      .run(new Date(now).toISOString(), new Date(now).toISOString(), prm.stream_id);
    changed.push(getPremiere(id)!);
  }

  return { changed };
}

// Manual end (owner)
export function endPremiere(id: string, ownerId: string): Premiere | null {
  const prm = getPremiere(id);
  if (!prm) return null;
  if (prm.owner_id !== ownerId) throw new Error('Not your premiere');
  if (prm.status !== 'live') throw new Error('Premiere is not live');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`UPDATE premieres SET status = 'ended', ended_at = ?, updated_at = ? WHERE id = ?`)
    .run(now, now, id);
  db.prepare(`UPDATE live_streams SET status = 'ended', ended_at = ?, updated_at = ? WHERE id = ?`)
    .run(now, now, prm.stream_id);
  return getPremiere(id);
}

// ---------- Chat ----------

export interface PremiereChatMessage {
  id: string;
  premiere_id: string;
  user_id: string;
  username: string;
  content: string;
  is_pinned: number;
  created_at: string;
}

export function postPremiereChat(input: {
  premiereId: string;
  userId: string;
  username: string;
  content: string;
}): PremiereChatMessage {
  const prm = getPremiere(input.premiereId);
  if (!prm) throw new Error('Premiere not found');
  if (prm.chat_enabled !== 1) throw new Error('Chat is disabled for this premiere');
  if (prm.status === 'ended' || prm.status === 'cancelled') throw new Error('Premiere chat is closed');

  const content = (input.content ?? '').trim();
  if (content.length < 1 || content.length > 500) throw new Error('Message must be 1-500 chars');

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO premiere_chat
      (id, premiere_id, user_id, username, content, is_pinned, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `).run(id, input.premiereId, input.userId, input.username, content, now);
  return db.prepare('SELECT * FROM premiere_chat WHERE id = ?').get(id) as PremiereChatMessage;
}

export function listPremiereChat(premiereId: string, limit = 100): PremiereChatMessage[] {
  const n = Math.min(Math.max(limit, 1), 500);
  return getDb().prepare(`
    SELECT * FROM premiere_chat
    WHERE premiere_id = ?
    ORDER BY created_at ASC LIMIT ?
  `).all(premiereId, n) as PremiereChatMessage[];
}

export function pinPremiereChat(messageId: string, premiereId: string, ownerId: string): boolean {
  const prm = getPremiere(premiereId);
  if (!prm || prm.owner_id !== ownerId) throw new Error('Not your premiere');
  const r = getDb().prepare(
    'UPDATE premiere_chat SET is_pinned = 1 WHERE id = ? AND premiere_id = ?'
  ).run(messageId, premiereId);
  return r.changes > 0;
}

// ---------- RSVPs ----------

export interface PremiereRsvp {
  id: string;
  premiere_id: string;
  user_id: string;
  remind_minutes_before: number;
  notified_at: string | null;
  created_at: string;
}

export function addRsvp(input: {
  premiereId: string;
  userId: string;
  remindMinutesBefore?: number;
}): PremiereRsvp {
  const prm = getPremiere(input.premiereId);
  if (!prm) throw new Error('Premiere not found');
  if (prm.status === 'ended' || prm.status === 'cancelled') throw new Error('Premiere already ended');

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const remind = Math.max(1, Math.min(input.remindMinutesBefore ?? 15, 24 * 60));
  db.prepare(`
    INSERT INTO premiere_rsvps
      (id, premiere_id, user_id, remind_minutes_before, notified_at, created_at)
    VALUES (?, ?, ?, ?, NULL, ?)
    ON CONFLICT(premiere_id, user_id) DO UPDATE SET
      remind_minutes_before = excluded.remind_minutes_before
  `).run(id, input.premiereId, input.userId, remind, now);
  return db.prepare(
    'SELECT * FROM premiere_rsvps WHERE premiere_id = ? AND user_id = ?'
  ).get(input.premiereId, input.userId) as PremiereRsvp;
}

export function removeRsvp(premiereId: string, userId: string): boolean {
  return getDb().prepare(
    'DELETE FROM premiere_rsvps WHERE premiere_id = ? AND user_id = ?'
  ).run(premiereId, userId).changes > 0;
}

export function countRsvps(premiereId: string): number {
  return (getDb().prepare(
    'SELECT COUNT(*) as n FROM premiere_rsvps WHERE premiere_id = ?'
  ).get(premiereId) as { n: number }).n;
}

export function isRsvped(premiereId: string, userId: string): boolean {
  return !!getDb().prepare(
    'SELECT 1 FROM premiere_rsvps WHERE premiere_id = ? AND user_id = ? LIMIT 1'
  ).get(premiereId, userId);
}

// Worker: due reminders that need to fire
export function listDueRsvps(nowIso = new Date().toISOString()): PremiereRsvp[] {
  const db = getDb();
  const now = new Date(nowIso).getTime();
  const rows = db.prepare(`
    SELECT r.* FROM premiere_rsvps r
    JOIN premieres p ON p.id = r.premiere_id
    WHERE r.notified_at IS NULL
      AND p.status IN ('scheduled','countdown')
  `).all() as PremiereRsvp[];
  return rows.filter((r) => {
    const prm = getPremiere(r.premiere_id);
    if (!prm) return false;
    const remindMs = new Date(prm.scheduled_at).getTime() - r.remind_minutes_before * 60_000;
    return remindMs <= now;
  });
}

export function markRsvpNotified(rsvpId: string): void {
  getDb().prepare('UPDATE premiere_rsvps SET notified_at = ? WHERE id = ?')
    .run(new Date().toISOString(), rsvpId);
}

// ---------- Public summary ----------

export interface PremierePublicView {
  id: string;
  stream_id: string;
  video_id: string;
  title: string;
  description: string | null;
  scheduled_at: string;
  countdown_starts_at: string;
  status: PremiereStatus;
  thumbnail_url: string | null;
  chat_enabled: boolean;
  rsvp_count: number;
  ends_in_seconds: number | null;    // null if not live
  starts_in_seconds: number | null;  // null if already live/ended
}

export function getPublicView(premiereId: string, nowIso = new Date().toISOString()): PremierePublicView | null {
  const prm = getPremiere(premiereId);
  if (!prm) return null;
  const now = new Date(nowIso).getTime();
  const scheduledMs = new Date(prm.scheduled_at).getTime();
  const startsIn = prm.status === 'scheduled' || prm.status === 'countdown'
    ? Math.max(0, Math.round((scheduledMs - now) / 1000))
    : null;
  const endsIn = prm.status === 'live' && prm.duration_seconds
    ? Math.max(0, Math.round((scheduledMs + prm.duration_seconds * 1000 - now) / 1000))
    : null;
  return {
    id: prm.id,
    stream_id: prm.stream_id,
    video_id: prm.video_id,
    title: prm.title,
    description: prm.description,
    scheduled_at: prm.scheduled_at,
    countdown_starts_at: prm.countdown_starts_at,
    status: prm.status,
    thumbnail_url: prm.thumbnail_url,
    chat_enabled: prm.chat_enabled === 1,
    rsvp_count: countRsvps(premiereId),
    starts_in_seconds: startsIn,
    ends_in_seconds: endsIn,
  };
}
