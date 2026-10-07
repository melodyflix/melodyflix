// melodyflix notifications - business logic
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';
import type { Notification, CreateNotificationInput, NotificationType } from '../models/notification.model.js';

export function ensureSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      link TEXT,
      actor_id TEXT,
      target_id TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_notif_user_read ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(created_at);

    CREATE TABLE IF NOT EXISTS delivery_retry_rules (
      id TEXT PRIMARY KEY,
      notification_type TEXT NOT NULL,
      channel TEXT NOT NULL,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      initial_backoff_seconds INTEGER NOT NULL DEFAULT 30,
      backoff_multiplier REAL NOT NULL DEFAULT 2.0,
      max_backoff_seconds INTEGER NOT NULL DEFAULT 3600,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (notification_type, channel)
    );
    CREATE INDEX IF NOT EXISTS idx_retry_rules_type ON delivery_retry_rules(notification_type, channel);

    CREATE TABLE IF NOT EXISTS delivery_attempts (
      id TEXT PRIMARY KEY,
      notification_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'in_app',
      attempt_no INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','sending','sent','failed','abandoned')),
      error TEXT,
      scheduled_at TEXT NOT NULL,
      sent_at TEXT,
      next_retry_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_da_notif ON delivery_attempts(notification_id);
    CREATE INDEX IF NOT EXISTS idx_da_status ON delivery_attempts(status, next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_da_user ON delivery_attempts(user_id, created_at DESC);
  `);

  // seed default retry rules (idempotent)
  const defaults: Array<[string, string, number, number, number, number]> = [
    ['*', 'in_app', 3, 30, 2.0, 3600],
    ['*', 'email', 5, 60, 2.0, 7200],
    ['*', 'push', 4, 30, 3.0, 3600],
    ['*', 'sms', 3, 120, 2.0, 7200],
  ];
  const ins = db.prepare(
    'INSERT OR IGNORE INTO delivery_retry_rules (id, notification_type, channel, max_attempts, initial_backoff_seconds, backoff_multiplier, max_backoff_seconds, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)'
  );
  const now = new Date().toISOString();
  for (const [t, ch, ma, ib, bm, mb] of defaults) {
    ins.run(randomUUID(), t, ch, ma, ib, bm, mb, now, now);
  }
}

export function createNotification(input: CreateNotificationInput): Notification {
  const db = getDb();
  const now = new Date().toISOString();
  const n: Notification = {
    id: randomUUID(),
    user_id: input.user_id,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
    actor_id: input.actor_id ?? null,
    target_id: input.target_id ?? null,
    is_read: 0,
    created_at: now,
  };
  db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, body, link, actor_id, target_id, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    n.id, n.user_id, n.type, n.title, n.body, n.link,
    n.actor_id, n.target_id, n.is_read, n.created_at
  );
  return n;
}

export function listNotifications(userId: string, limit = 50, offset = 0): Notification[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, limit, offset) as Notification[];
}

export function countUnread(userId: string): number {
  const db = getDb();
  const row = db.prepare(
    'SELECT COUNT(*) as n FROM notifications WHERE user_id = ? AND is_read = 0'
  ).get(userId) as { n: number };
  return row.n;
}

export function markAsRead(notificationId: string, userId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT id FROM notifications WHERE id = ? AND user_id = ?').get(notificationId, userId);
  if (!row) return false;
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(notificationId);
  return true;
}

export function markAllAsRead(userId: string): number {
  const db = getDb();
  const result = db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(userId);
  return result.changes;
}

export function deleteNotification(notificationId: string, userId: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(notificationId, userId);
  return result.changes > 0;
}

export function deleteAllForUser(userId: string): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userId);
  return result.changes;
}

// ============================================================
// 90.2 Retry Rules
// Per (notification_type, channel) policy: max attempts, initial
// backoff, exponential multiplier, max backoff. Wildcard "*" for
// any type. Backoff computation is used to schedule retries.
// ============================================================

export interface RetryRule {
  id: string;
  notification_type: string;
  channel: string;
  max_attempts: number;
  initial_backoff_seconds: number;
  backoff_multiplier: number;
  max_backoff_seconds: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export function listRetryRules(): RetryRule[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM delivery_retry_rules ORDER BY notification_type, channel'
  ).all() as RetryRule[];
}

export function getRetryRule(notificationType: string, channel: string): RetryRule | null {
  const db = getDb();
  const exact = db.prepare(
    'SELECT * FROM delivery_retry_rules WHERE notification_type = ? AND channel = ? AND enabled = 1'
  ).get(notificationType, channel) as RetryRule | undefined;
  if (exact) return exact;
  const wildcard = db.prepare(
    "SELECT * FROM delivery_retry_rules WHERE notification_type = '*' AND channel = ? AND enabled = 1"
  ).get(channel) as RetryRule | undefined;
  return wildcard ?? null;
}

export interface UpsertRetryRuleInput {
  notification_type: string;
  channel: string;
  max_attempts?: number;
  initial_backoff_seconds?: number;
  backoff_multiplier?: number;
  max_backoff_seconds?: number;
  enabled?: boolean;
}

export function upsertRetryRule(input: UpsertRetryRuleInput): RetryRule {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare(
    'SELECT id FROM delivery_retry_rules WHERE notification_type = ? AND channel = ?'
  ).get(input.notification_type, input.channel) as { id: string } | undefined;
  if (existing) {
    const fields: string[] = [];
    const vals: unknown[] = [];
    if (input.max_attempts !== undefined) { fields.push('max_attempts = ?'); vals.push(Math.max(1, Math.min(input.max_attempts, 20))); }
    if (input.initial_backoff_seconds !== undefined) { fields.push('initial_backoff_seconds = ?'); vals.push(Math.max(1, Math.min(input.initial_backoff_seconds, 86400))); }
    if (input.backoff_multiplier !== undefined) { fields.push('backoff_multiplier = ?'); vals.push(Math.max(1, Math.min(input.backoff_multiplier, 10))); }
    if (input.max_backoff_seconds !== undefined) { fields.push('max_backoff_seconds = ?'); vals.push(Math.max(1, Math.min(input.max_backoff_seconds, 604800))); }
    if (input.enabled !== undefined) { fields.push('enabled = ?'); vals.push(input.enabled ? 1 : 0); }
    if (fields.length === 0) return db.prepare('SELECT * FROM delivery_retry_rules WHERE id = ?').get(existing.id) as RetryRule;
    fields.push('updated_at = ?'); vals.push(now);
    vals.push(existing.id);
    db.prepare(`UPDATE delivery_retry_rules SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return db.prepare('SELECT * FROM delivery_retry_rules WHERE id = ?').get(existing.id) as RetryRule;
  }
  const id = randomUUID();
  db.prepare(
    `INSERT INTO delivery_retry_rules
     (id, notification_type, channel, max_attempts, initial_backoff_seconds, backoff_multiplier, max_backoff_seconds, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, input.notification_type, input.channel,
    Math.max(1, Math.min(input.max_attempts ?? 3, 20)),
    Math.max(1, Math.min(input.initial_backoff_seconds ?? 30, 86400)),
    Math.max(1, Math.min(input.backoff_multiplier ?? 2.0, 10)),
    Math.max(1, Math.min(input.max_backoff_seconds ?? 3600, 604800)),
    input.enabled === false ? 0 : 1, now, now,
  );
  return db.prepare('SELECT * FROM delivery_retry_rules WHERE id = ?').get(id) as RetryRule;
}

export function deleteRetryRule(id: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM delivery_retry_rules WHERE id = ?').run(id).changes > 0;
}

// backoff = initial * (multiplier ^ (attempt_no - 1)), capped at max
export function computeBackoffSeconds(attemptNo: number, rule: RetryRule): number {
  const raw = rule.initial_backoff_seconds * Math.pow(rule.backoff_multiplier, Math.max(0, attemptNo - 1));
  return Math.min(Math.round(raw), rule.max_backoff_seconds);
}

// ============================================================
// 90.3 Delivery Tracking
// One row per delivery attempt. When a send fails and attempts
// remain, next_retry_at is scheduled using the retry rule.
// ============================================================

export type DeliveryStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'abandoned';
export type DeliveryChannel = 'in_app' | 'email' | 'push' | 'sms';

export interface DeliveryAttempt {
  id: string;
  notification_id: string;
  user_id: string;
  channel: string;
  attempt_no: number;
  status: DeliveryStatus;
  error: string | null;
  scheduled_at: string;
  sent_at: string | null;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrackDeliveryInput {
  notification_id: string;
  user_id: string;
  notification_type?: string;
  channel?: DeliveryChannel;
}

export function startDeliveryTracking(input: TrackDeliveryInput): DeliveryAttempt {
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO delivery_attempts
     (id, notification_id, user_id, channel, attempt_no, status, scheduled_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, 'pending', ?, ?, ?)`
  ).run(id, input.notification_id, input.user_id, input.channel ?? 'in_app', now, now, now);
  return db.prepare('SELECT * FROM delivery_attempts WHERE id = ?').get(id) as DeliveryAttempt;
}

export interface MarkResultInput {
  status: 'sent' | 'failed';
  error?: string | null;
  notification_type?: string;
}

export interface MarkResultOutcome {
  attempt: DeliveryAttempt;
  retry_scheduled: boolean;
  next_retry_at: string | null;
  backoff_seconds: number | null;
}

export function markDeliveryResult(attemptId: string, input: MarkResultInput): MarkResultOutcome | null {
  const db = getDb();
  const attempt = db.prepare('SELECT * FROM delivery_attempts WHERE id = ?').get(attemptId) as DeliveryAttempt | undefined;
  if (!attempt) return null;
  const now = new Date().toISOString();
  if (input.status === 'sent') {
    db.prepare(
      "UPDATE delivery_attempts SET status = 'sent', sent_at = ?, error = NULL, next_retry_at = NULL, updated_at = ? WHERE id = ?"
    ).run(now, now, attemptId);
    return {
      attempt: db.prepare('SELECT * FROM delivery_attempts WHERE id = ?').get(attemptId) as DeliveryAttempt,
      retry_scheduled: false, next_retry_at: null, backoff_seconds: null,
    };
  }
  // failed path
  const rule = getRetryRule(input.notification_type ?? '*', attempt.channel);
  const maxAttempts = rule?.max_attempts ?? 1;
  if (!rule || attempt.attempt_no >= maxAttempts) {
    db.prepare(
      "UPDATE delivery_attempts SET status = 'abandoned', error = ?, next_retry_at = NULL, updated_at = ? WHERE id = ?"
    ).run(input.error ?? 'max_attempts_reached', now, attemptId);
    return {
      attempt: db.prepare('SELECT * FROM delivery_attempts WHERE id = ?').get(attemptId) as DeliveryAttempt,
      retry_scheduled: false, next_retry_at: null, backoff_seconds: null,
    };
  }
  const backoff = computeBackoffSeconds(attempt.attempt_no, rule);
  const nextRetry = new Date(Date.now() + backoff * 1000).toISOString();
  db.prepare(
    "UPDATE delivery_attempts SET status = 'failed', error = ?, next_retry_at = ?, updated_at = ? WHERE id = ?"
  ).run(input.error ?? 'send_failed', nextRetry, now, attemptId);
  return {
    attempt: db.prepare('SELECT * FROM delivery_attempts WHERE id = ?').get(attemptId) as DeliveryAttempt,
    retry_scheduled: true,
    next_retry_at: nextRetry,
    backoff_seconds: backoff,
  };
}

export function recordRetryAttempt(attemptId: string): DeliveryAttempt | null {
  const db = getDb();
  const prev = db.prepare('SELECT * FROM delivery_attempts WHERE id = ?').get(attemptId) as DeliveryAttempt | undefined;
  if (!prev) return null;
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO delivery_attempts
     (id, notification_id, user_id, channel, attempt_no, status, scheduled_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
  ).run(id, prev.notification_id, prev.user_id, prev.channel, prev.attempt_no + 1, now, now, now);
  db.prepare('UPDATE delivery_attempts SET status = ?, updated_at = ? WHERE id = ?')
    .run('abandoned', now, attemptId);
  return db.prepare('SELECT * FROM delivery_attempts WHERE id = ?').get(id) as DeliveryAttempt;
}

export function listDeliveryAttempts(notificationId: string): DeliveryAttempt[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM delivery_attempts WHERE notification_id = ? ORDER BY attempt_no ASC'
  ).all(notificationId) as DeliveryAttempt[];
}

export function listUserDeliveryAttempts(userId: string, limit = 100): DeliveryAttempt[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM delivery_attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(userId, Math.min(Math.max(limit, 1), 500)) as DeliveryAttempt[];
}

export function listPendingRetries(limit = 200): DeliveryAttempt[] {
  const db = getDb();
  const now = new Date().toISOString();
  return db.prepare(
    "SELECT * FROM delivery_attempts WHERE status = 'failed' AND next_retry_at IS NOT NULL AND next_retry_at <= ? ORDER BY next_retry_at ASC LIMIT ?"
  ).all(now, Math.min(Math.max(limit, 1), 1000)) as DeliveryAttempt[];
}

export interface DeliveryStats {
  total_attempts: number;
  by_status: Record<string, number>;
  by_channel: Record<string, number>;
  success_rate: number;
  pending_retries: number;
  window_days: number;
}

export function getDeliveryStats(windowDays = 30): DeliveryStats {
  const db = getDb();
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const total = (db.prepare('SELECT COUNT(*) AS c FROM delivery_attempts WHERE created_at >= ?').get(since) as { c: number }).c;
  const byStatus = db.prepare(
    'SELECT status, COUNT(*) AS c FROM delivery_attempts WHERE created_at >= ? GROUP BY status'
  ).all(since) as Array<{ status: string; c: number }>;
  const byChannel = db.prepare(
    'SELECT channel, COUNT(*) AS c FROM delivery_attempts WHERE created_at >= ? GROUP BY channel'
  ).all(since) as Array<{ channel: string; c: number }>;
  const nowIso = new Date().toISOString();
  const pending = (db.prepare(
    "SELECT COUNT(*) AS c FROM delivery_attempts WHERE status = 'failed' AND next_retry_at IS NOT NULL AND next_retry_at <= ?"
  ).get(nowIso) as { c: number }).c;
  const by_status: Record<string, number> = {};
  for (const r of byStatus) by_status[r.status] = r.c;
  const by_channel: Record<string, number> = {};
  for (const r of byChannel) by_channel[r.channel] = r.c;
  const sent = by_status['sent'] ?? 0;
  const success_rate = total > 0 ? Math.round((sent / total) * 10000) / 100 : 0;
  return {
    total_attempts: total,
    by_status, by_channel, success_rate,
    pending_retries: pending, window_days: windowDays,
  };
}
