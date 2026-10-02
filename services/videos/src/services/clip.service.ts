// melodyflix videos - video clips (shareable segments)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export interface Clip {
  id: string;
  video_id: string;
  creator_user_id: string;
  title: string;
  start_seconds: number;
  end_seconds: number;
  duration_seconds: number;
  view_count: number;
  created_at: string;
}

export interface ClipWithVideo extends Clip {
  video_title: string | null;
  video_thumbnail_url: string | null;
  video_owner_id: string | null;
  channel_id: string | null;
}

export function ensureClipSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_clips (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      creator_user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      start_seconds INTEGER NOT NULL,
      end_seconds INTEGER NOT NULL,
      duration_seconds INTEGER NOT NULL,
      view_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_clips_video ON video_clips(video_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_clips_creator ON video_clips(creator_user_id, created_at DESC);
  `);
}

function loadClipRow(row: Clip): ClipWithVideo {
  const db = getDb();
  const v = db.prepare('SELECT title, thumbnail_url, owner_id, channel_id FROM videos WHERE id = ?')
    .get(row.video_id) as { title: string | null; thumbnail_url: string | null; owner_id: string | null; channel_id: string | null } | undefined;
  return {
    ...row,
    video_title: v?.title ?? null,
    video_thumbnail_url: v?.thumbnail_url ?? null,
    video_owner_id: v?.owner_id ?? null,
    channel_id: v?.channel_id ?? null,
  };
}

export function createClip(
  videoId: string,
  creatorUserId: string,
  title: string,
  startSeconds: number,
  endSeconds: number,
): ClipWithVideo {
  const db = getDb();
  if (!Number.isFinite(startSeconds) || startSeconds < 0) throw new Error('Invalid start time');
  if (!Number.isFinite(endSeconds) || endSeconds <= startSeconds) throw new Error('End must be after start');
  const duration = Math.round(endSeconds - startSeconds);
  if (duration < 5) throw new Error('Clip must be at least 5 seconds');
  if (duration > 60) throw new Error('Clip cannot exceed 60 seconds');

  const video = db.prepare('SELECT id FROM videos WHERE id = ?').get(videoId) as { id: string } | undefined;
  if (!video) throw new Error('Video not found');

  const id = randomUUID();
  const now = new Date().toISOString();
  const cleanTitle = (title || '').trim() || 'Clip';

  db.prepare(
    'INSERT INTO video_clips (id, video_id, creator_user_id, title, start_seconds, end_seconds, duration_seconds, view_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)'
  ).run(id, videoId, creatorUserId, cleanTitle.slice(0, 200), Math.floor(startSeconds), Math.floor(endSeconds), duration, now);

  const row = db.prepare('SELECT * FROM video_clips WHERE id = ?').get(id) as Clip;
  return loadClipRow(row);
}

export function getClip(clipId: string): ClipWithVideo | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM video_clips WHERE id = ?').get(clipId) as Clip | undefined;
  if (!row) return null;
  return loadClipRow(row);
}

export function listClipsForVideo(videoId: string, limit = 50): ClipWithVideo[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM video_clips WHERE video_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(videoId, Math.max(1, Math.min(100, limit))) as Clip[];
  return rows.map(loadClipRow);
}

export function listClipsByCreator(userId: string, limit = 50): ClipWithVideo[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM video_clips WHERE creator_user_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(userId, Math.max(1, Math.min(100, limit))) as Clip[];
  return rows.map(loadClipRow);
}

export function incrementClipView(clipId: string): void {
  const db = getDb();
  db.prepare('UPDATE video_clips SET view_count = view_count + 1 WHERE id = ?').run(clipId);
}

export function deleteClip(clipId: string, userId: string, isAdmin = false): void {
  const db = getDb();
  const row = db.prepare('SELECT creator_user_id FROM video_clips WHERE id = ?').get(clipId) as { creator_user_id: string } | undefined;
  if (!row) throw new Error('Clip not found');
  if (!isAdmin && row.creator_user_id !== userId) throw new Error('Not your clip');
  db.prepare('DELETE FROM video_clips WHERE id = ?').run(clipId);
}
