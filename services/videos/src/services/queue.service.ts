// melodyflix videos - watch queue (per user)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export interface QueueItem {
  id: string;
  user_id: string;
  video_id: string;
  position: number;
  added_at: string;
}

export function ensureQueueSchema(): void {
  const db = getDb();
  db.exec(
    'CREATE TABLE IF NOT EXISTS watch_queue (' +
    '  id TEXT PRIMARY KEY,' +
    '  user_id TEXT NOT NULL,' +
    '  video_id TEXT NOT NULL,' +
    '  position INTEGER NOT NULL DEFAULT 0,' +
    '  added_at TEXT NOT NULL,' +
    '  UNIQUE (user_id, video_id)' +
    ');' +
    'CREATE INDEX IF NOT EXISTS idx_queue_user ON watch_queue(user_id, position);'
  );
}

export function listQueue(userId: string): QueueItem[] {
  const db = getDb();
  return db.prepare('SELECT * FROM watch_queue WHERE user_id = ? ORDER BY position ASC, added_at ASC').all(userId) as QueueItem[];
}

export function addToQueue(userId: string, videoId: string, atTop = false): QueueItem {
  const db = getDb();
  // If already there, return existing
  const existing = db.prepare('SELECT * FROM watch_queue WHERE user_id = ? AND video_id = ?').get(userId, videoId) as QueueItem | undefined;
  if (existing) return existing;

  const items = listQueue(userId);
  const now = new Date().toISOString();
  const position = atTop ? 0 : items.length;

  if (atTop) {
    // shift all others down
    db.prepare('UPDATE watch_queue SET position = position + 1 WHERE user_id = ?').run(userId);
  }

  const id = randomUUID();
  db.prepare('INSERT INTO watch_queue (id, user_id, video_id, position, added_at) VALUES (?, ?, ?, ?, ?)').run(id, userId, videoId, position, now);
  return db.prepare('SELECT * FROM watch_queue WHERE id = ?').get(id) as QueueItem;
}

export function removeFromQueue(userId: string, videoId: string): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM watch_queue WHERE user_id = ? AND video_id = ?').run(userId, videoId);
  if (res.changes > 0) reindex(userId);
  return res.changes > 0;
}

export function clearQueue(userId: string): number {
  const db = getDb();
  const res = db.prepare('DELETE FROM watch_queue WHERE user_id = ?').run(userId);
  return res.changes;
}

export function reorderQueue(userId: string, videoIds: string[]): QueueItem[] {
  const db = getDb();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM watch_queue WHERE user_id = ?').run(userId);
    const insert = db.prepare('INSERT INTO watch_queue (id, user_id, video_id, position, added_at) VALUES (?, ?, ?, ?, ?)');
    videoIds.forEach((vid, i) => {
      insert.run(randomUUID(), userId, vid, i, now);
    });
  });
  tx();
  return listQueue(userId);
}

function reindex(userId: string): void {
  const db = getDb();
  const items = listQueue(userId);
  const update = db.prepare('UPDATE watch_queue SET position = ? WHERE id = ?');
  items.forEach((it, i) => update.run(i, it.id));
}

export function getNextInQueue(userId: string, currentVideoId: string): QueueItem | null {
  const db = getDb();
  const current = db.prepare('SELECT * FROM watch_queue WHERE user_id = ? AND video_id = ?').get(userId, currentVideoId) as QueueItem | undefined;
  if (!current) {
    // Not in queue — return first item if any
    const first = db.prepare('SELECT * FROM watch_queue WHERE user_id = ? ORDER BY position ASC LIMIT 1').get(userId) as QueueItem | undefined;
    return first ?? null;
  }
  const next = db.prepare('SELECT * FROM watch_queue WHERE user_id = ? AND position > ? ORDER BY position ASC LIMIT 1').get(userId, current.position) as QueueItem | undefined;
  return next ?? null;
}
