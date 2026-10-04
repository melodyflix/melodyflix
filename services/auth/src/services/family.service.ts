// melodyflix auth — Family & Parental Profiles (Section 65)
// 65.3 Screen-Time Limit  65.5 Screen-Time Report
// 65.6 Content Approval   65.7 Parent–Teacher Messaging
// (65.1 Kids, 65.2 PIN, 65.4 Age restrictions live in profiles.service.ts)

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

// ============================================================
// 65.3 — Screen-Time Limit
// ============================================================

export interface ScreenTimeLimit {
  profile_id: string;
  daily_minutes: number;
  weekday_minutes: number | null;
  weekend_minutes: number | null;
  is_enabled: number;
  updated_by: string;
  updated_at: string;
}

export interface UsageLog {
  id: string;
  profile_id: string;
  video_id: string | null;
  seconds_watched: number;
  device_id: string | null;
  started_at: string;
  ended_at: string | null;
  day_key: string;
  created_at: string;
}

export function ensureFamilySchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS screen_time_limits (
      profile_id TEXT PRIMARY KEY,
      daily_minutes INTEGER NOT NULL DEFAULT 120,
      weekday_minutes INTEGER,
      weekend_minutes INTEGER,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usage_logs (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      video_id TEXT,
      seconds_watched INTEGER NOT NULL,
      device_id TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      day_key TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_profile_day
      ON usage_logs(profile_id, day_key);
    CREATE INDEX IF NOT EXISTS idx_usage_profile_time
      ON usage_logs(profile_id, started_at);

    CREATE TABLE IF NOT EXISTS content_approvals (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      reviewed_by TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      note TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (profile_id, video_id)
    );
    CREATE INDEX IF NOT EXISTS idx_approvals_profile
      ON content_approvals(profile_id, status);
    CREATE INDEX IF NOT EXISTS idx_approvals_video
      ON content_approvals(video_id);

    CREATE TABLE IF NOT EXISTS parent_teacher_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      profile_id TEXT,
      subject TEXT,
      body TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      read_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pt_thread
      ON parent_teacher_messages(thread_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_pt_recipient
      ON parent_teacher_messages(recipient_id, is_read);
  `);
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function setScreenTimeLimit(input: {
  profile_id: string;
  updated_by: string;
  daily_minutes?: number;
  weekday_minutes?: number | null;
  weekend_minutes?: number | null;
  is_enabled?: boolean;
}): ScreenTimeLimit {
  if (input.daily_minutes !== undefined) {
    if (input.daily_minutes < 0 || input.daily_minutes > 1440) throw new Error('daily_minutes must be 0-1440');
  }
  if (input.weekday_minutes !== undefined && input.weekday_minutes !== null) {
    if (input.weekday_minutes < 0 || input.weekday_minutes > 1440) throw new Error('weekday_minutes must be 0-1440');
  }
  if (input.weekend_minutes !== undefined && input.weekend_minutes !== null) {
    if (input.weekend_minutes < 0 || input.weekend_minutes > 1440) throw new Error('weekend_minutes must be 0-1440');
  }

  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO screen_time_limits
      (profile_id, daily_minutes, weekday_minutes, weekend_minutes, is_enabled, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id) DO UPDATE SET
      daily_minutes = COALESCE(excluded.daily_minutes, screen_time_limits.daily_minutes),
      weekday_minutes = excluded.weekday_minutes,
      weekend_minutes = excluded.weekend_minutes,
      is_enabled = excluded.is_enabled,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(
    input.profile_id,
    input.daily_minutes ?? 120,
    input.weekday_minutes ?? null,
    input.weekend_minutes ?? null,
    input.is_enabled === false ? 0 : 1,
    input.updated_by, now,
  );
  return getScreenTimeLimit(input.profile_id)!;
}

export function getScreenTimeLimit(profileId: string): ScreenTimeLimit | null {
  return (getDb().prepare('SELECT * FROM screen_time_limits WHERE profile_id = ?').get(profileId) as ScreenTimeLimit | undefined) ?? null;
}

export function logUsage(input: {
  profile_id: string;
  seconds_watched: number;
  video_id?: string | null;
  device_id?: string | null;
  started_at?: string;
  ended_at?: string | null;
}): UsageLog {
  if (input.seconds_watched < 0 || input.seconds_watched > 86400) throw new Error('seconds_watched out of range');
  const db = getDb();
  const id = randomUUID();
  const now = new Date();
  const startedAt = input.started_at ?? now.toISOString();
  const day = dayKey(new Date(startedAt));
  db.prepare(`
    INSERT INTO usage_logs
      (id, profile_id, video_id, seconds_watched, device_id, started_at, ended_at, day_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.profile_id, input.video_id ?? null, Math.round(input.seconds_watched),
    input.device_id ?? null, startedAt, input.ended_at ?? null, day, now.toISOString(),
  );
  return db.prepare('SELECT * FROM usage_logs WHERE id = ?').get(id) as UsageLog;
}

export interface ScreenTimeStatus {
  profile_id: string;
  is_enabled: boolean;
  limit_minutes: number;
  used_minutes: number;
  remaining_minutes: number;
  exceeded: boolean;
}

/** Returns today's remaining minutes for a profile (in UTC by default). */
export function getScreenTimeStatus(profileId: string, at: Date = new Date()): ScreenTimeStatus {
  const db = getDb();
  const limit = getScreenTimeLimit(profileId);
  if (!limit || limit.is_enabled !== 1) {
    return { profile_id: profileId, is_enabled: false, limit_minutes: 0, used_minutes: 0, remaining_minutes: 0, exceeded: false };
  }
  const day = dayKey(at);
  const dow = at.getUTCDay(); // 0=Sun, 6=Sat
  const isWeekend = dow === 0 || dow === 6;
  const limitMinutes = isWeekend && limit.weekend_minutes !== null
    ? limit.weekend_minutes
    : !isWeekend && limit.weekday_minutes !== null
      ? limit.weekday_minutes
      : limit.daily_minutes;

  const usedSeconds = (db.prepare(
    'SELECT COALESCE(SUM(seconds_watched), 0) as s FROM usage_logs WHERE profile_id = ? AND day_key = ?'
  ).get(profileId, day) as { s: number }).s;
  const usedMinutes = Math.round(usedSeconds / 60);
  const remaining = Math.max(0, limitMinutes - usedMinutes);
  return {
    profile_id: profileId,
    is_enabled: true,
    limit_minutes: limitMinutes,
    used_minutes: usedMinutes,
    remaining_minutes: remaining,
    exceeded: usedMinutes >= limitMinutes,
  };
}

// ============================================================
// 65.5 — Screen-Time Report
// ============================================================

export interface DailyUsage {
  day_key: string;
  total_seconds: number;
  total_minutes: number;
  session_count: number;
  top_videos: Array<{ video_id: string; seconds: number }>;
}

export interface ScreenTimeReport {
  profile_id: string;
  from: string;
  to: string;
  days: DailyUsage[];
  total_seconds: number;
  total_minutes: number;
  average_daily_minutes: number;
  limit_minutes: number | null;
  days_over_limit: number;
}

export function getScreenTimeReport(profileId: string, fromDay: string, toDay: string): ScreenTimeReport {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDay) || !/^\d{4}-\d{2}-\d{2}$/.test(toDay)) {
    throw new Error('from/to must be YYYY-MM-DD');
  }
  if (fromDay > toDay) throw new Error('from must be <= to');

  const db = getDb();
  const rows = db.prepare(`
    SELECT day_key, COALESCE(SUM(seconds_watched), 0) as total_seconds, COUNT(*) as session_count
    FROM usage_logs
    WHERE profile_id = ? AND day_key BETWEEN ? AND ?
    GROUP BY day_key
    ORDER BY day_key ASC
  `).all(profileId, fromDay, toDay) as Array<{ day_key: string; total_seconds: number; session_count: number }>;

  const topRows = db.prepare(`
    SELECT day_key, video_id, SUM(seconds_watched) as seconds
    FROM usage_logs
    WHERE profile_id = ? AND day_key BETWEEN ? AND ? AND video_id IS NOT NULL
    GROUP BY day_key, video_id
    ORDER BY seconds DESC
  `).all(profileId, fromDay, toDay) as Array<{ day_key: string; video_id: string; seconds: number }>;

  const topByDay: Record<string, Array<{ video_id: string; seconds: number }>> = {};
  for (const r of topRows) {
    if (!topByDay[r.day_key]) topByDay[r.day_key] = [];
    if (topByDay[r.day_key].length < 5) topByDay[r.day_key].push({ video_id: r.video_id, seconds: r.seconds });
  }

  const days: DailyUsage[] = rows.map((r) => ({
    day_key: r.day_key,
    total_seconds: r.total_seconds,
    total_minutes: Math.round(r.total_seconds / 60),
    session_count: r.session_count,
    top_videos: topByDay[r.day_key] ?? [],
  }));

  const limit = getScreenTimeLimit(profileId);
  const limitMinutes = limit?.daily_minutes ?? null;
  const daysOver = limitMinutes !== null
    ? days.filter((d) => d.total_minutes > limitMinutes).length
    : 0;

  const totalSeconds = days.reduce((s, d) => s + d.total_seconds, 0);
  const dayCount = Math.max(days.length, 1);

  return {
    profile_id: profileId,
    from: fromDay,
    to: toDay,
    days,
    total_seconds: totalSeconds,
    total_minutes: Math.round(totalSeconds / 60),
    average_daily_minutes: Math.round((totalSeconds / 60) / dayCount),
    limit_minutes: limitMinutes,
    days_over_limit: daysOver,
  };
}

// ============================================================
// 65.6 — Content Approval
// ============================================================

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface ContentApproval {
  id: string;
  profile_id: string;
  video_id: string;
  requested_by: string;
  reviewed_by: string | null;
  status: ApprovalStatus;
  note: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function requestContentApproval(input: {
  profile_id: string;
  video_id: string;
  requested_by: string;
  note?: string | null;
}): ContentApproval {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare(
    'SELECT * FROM content_approvals WHERE profile_id = ? AND video_id = ?'
  ).get(input.profile_id, input.video_id) as ContentApproval | undefined;

  if (existing) {
    if (existing.status === 'approved') return existing;
    db.prepare(
      "UPDATE content_approvals SET status = 'pending', requested_by = ?, note = ?, reviewed_by = NULL, reviewed_at = NULL, updated_at = ? WHERE id = ?"
    ).run(input.requested_by, input.note ?? null, now, existing.id);
    return getApproval(existing.id)!;
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO content_approvals
      (id, profile_id, video_id, requested_by, reviewed_by, status, note, reviewed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, 'pending', ?, NULL, ?, ?)
  `).run(id, input.profile_id, input.video_id, input.requested_by, input.note ?? null, now, now);
  return getApproval(id)!;
}

export function getApproval(id: string): ContentApproval | null {
  return (getDb().prepare('SELECT * FROM content_approvals WHERE id = ?').get(id) as ContentApproval | undefined) ?? null;
}

export function reviewContentApproval(id: string, reviewerId: string, status: 'approved' | 'rejected', note?: string | null): ContentApproval {
  const db = getDb();
  const existing = getApproval(id);
  if (!existing) throw new Error('Approval not found');
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE content_approvals SET status = ?, reviewed_by = ?, note = COALESCE(?, note), reviewed_at = ?, updated_at = ? WHERE id = ?'
  ).run(status, reviewerId, note ?? null, now, now, id);
  return getApproval(id)!;
}

export function listApprovals(profileId: string, status?: ApprovalStatus): ContentApproval[] {
  const db = getDb();
  const where = status ? 'AND status = ?' : '';
  const params: any[] = [profileId];
  if (status) params.push(status);
  return db.prepare(
    `SELECT * FROM content_approvals WHERE profile_id = ? ${where} ORDER BY created_at DESC LIMIT 200`
  ).all(...params) as ContentApproval[];
}

export function isVideoApproved(profileId: string, videoId: string): boolean {
  const row = getDb().prepare(
    "SELECT status FROM content_approvals WHERE profile_id = ? AND video_id = ?"
  ).get(profileId, videoId) as { status: string } | undefined;
  return row?.status === 'approved';
}

export function revokeApproval(profileId: string, videoId: string): boolean {
  const info = getDb().prepare(
    "DELETE FROM content_approvals WHERE profile_id = ? AND video_id = ? AND status = 'approved'"
  ).run(profileId, videoId);
  return Number(info.changes ?? 0) > 0;
}

// ============================================================
// 65.7 — Parent–Teacher Messaging
// ============================================================

export interface ParentTeacherMessage {
  id: string;
  thread_id: string;
  sender_id: string;
  recipient_id: string;
  profile_id: string | null;
  subject: string | null;
  body: string;
  is_read: number;
  read_at: string | null;
  created_at: string;
}

function threadKey(a: string, b: string): string {
  return [a, b].sort().join(':');
}

export function sendParentTeacherMessage(input: {
  sender_id: string;
  recipient_id: string;
  body: string;
  subject?: string | null;
  profile_id?: string | null;
}): ParentTeacherMessage {
  const body = (input.body ?? '').trim();
  if (body.length < 1 || body.length > 5000) throw new Error('body must be 1-5000 chars');
  if (input.sender_id === input.recipient_id) throw new Error('Cannot message yourself');

  const db = getDb();
  const id = randomUUID();
  const tid = threadKey(input.sender_id, input.recipient_id);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO parent_teacher_messages
      (id, thread_id, sender_id, recipient_id, profile_id, subject, body, is_read, read_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)
  `).run(id, tid, input.sender_id, input.recipient_id, input.profile_id ?? null,
    input.subject ?? null, body, now);
  return db.prepare('SELECT * FROM parent_teacher_messages WHERE id = ?').get(id) as ParentTeacherMessage;
}

export function listThread(a: string, b: string, limit = 100): ParentTeacherMessage[] {
  const db = getDb();
  const tid = threadKey(a, b);
  return db.prepare(
    'SELECT * FROM parent_teacher_messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT ?'
  ).all(tid, Math.min(Math.max(limit, 1), 500)) as ParentTeacherMessage[];
}

export function listInbox(userId: string, opts: { unread_only?: boolean; limit?: number } = {}): ParentTeacherMessage[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const where = opts.unread_only ? 'AND is_read = 0' : '';
  return db.prepare(
    `SELECT * FROM parent_teacher_messages WHERE recipient_id = ? ${where} ORDER BY created_at DESC LIMIT ?`
  ).all(userId, limit) as ParentTeacherMessage[];
}

export function markMessageRead(id: string, userId: string): boolean {
  const info = getDb().prepare(
    'UPDATE parent_teacher_messages SET is_read = 1, read_at = ? WHERE id = ? AND recipient_id = ? AND is_read = 0'
  ).run(new Date().toISOString(), id, userId);
  return Number(info.changes ?? 0) > 0;
}

export function unreadCount(userId: string): number {
  return (getDb().prepare(
    'SELECT COUNT(*) as n FROM parent_teacher_messages WHERE recipient_id = ? AND is_read = 0'
  ).get(userId) as { n: number }).n;
}
