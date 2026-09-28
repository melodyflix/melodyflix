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
  `);
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
