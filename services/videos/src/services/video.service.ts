// melodyflix videos - business logic
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';
import type { Video, CreateVideoInput, VideoStatus, VideoVisibility } from '../models/video.model.js';
import { publish, CHANNELS } from '@melodyflix/shared-events';

export function ensureSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      visibility TEXT NOT NULL DEFAULT 'public',
      status TEXT NOT NULL DEFAULT 'uploading',
      duration_seconds REAL DEFAULT 0,
      file_size_bytes INTEGER DEFAULT 0,
      original_filename TEXT,
      hls_master_url TEXT,
      thumbnail_url TEXT,
      view_count INTEGER NOT NULL DEFAULT 0,
      like_count INTEGER NOT NULL DEFAULT 0,
      dislike_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id);
    CREATE INDEX IF NOT EXISTS idx_videos_owner ON videos(owner_id);
    CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);

    CREATE TABLE IF NOT EXISTS video_likes (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (video_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_video_likes_video ON video_likes(video_id);

    CREATE TABLE IF NOT EXISTS video_views (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      user_id TEXT,
      ip TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_video_views_video ON video_views(video_id);
  `);
}

export function createVideo(
  ownerId: string,
  channelId: string,
  input: CreateVideoInput,
  fileSize: number,
  originalFilename: string
): Video {
  const db = getDb();
  const now = new Date().toISOString();
  const video: Video = {
    id: randomUUID(),
    channel_id: channelId,
    owner_id: ownerId,
    title: input.title,
    description: input.description ?? null,
    visibility: input.visibility ?? 'public',
    status: 'uploading',
    category: input.category ?? 'other',
    content_type: input.content_type ?? 'video',
    duration_seconds: 0,
    file_size_bytes: fileSize,
    original_filename: originalFilename,
    hls_master_url: null,
    thumbnail_url: null,
    view_count: 0,
    like_count: 0,
    dislike_count: 0,
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO videos (id, channel_id, owner_id, title, description, visibility, status, category, content_type,
                        duration_seconds, file_size_bytes, original_filename,
                        hls_master_url, thumbnail_url, view_count, like_count, dislike_count,
                        created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    video.id, video.channel_id, video.owner_id, video.title, video.description,
    video.visibility, video.status, video.category, video.content_type, video.duration_seconds, video.file_size_bytes,
    video.original_filename, video.hls_master_url, video.thumbnail_url,
    video.view_count, video.like_count, video.dislike_count,
    video.created_at, video.updated_at
  );
  return video;
}

export function getVideoById(id: string): Video | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM videos WHERE id = ?').get(id) as Video | undefined) ?? null;
}

export function listVideos(opts: { limit?: number; offset?: number; channelId?: string; status?: VideoStatus } = {}): Video[] {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;
  const filters: string[] = [];
  const params: unknown[] = [];
  if (opts.channelId) { filters.push('channel_id = ?'); params.push(opts.channelId); }
  if (opts.status) { filters.push('status = ?'); params.push(opts.status); }
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  params.push(limit, offset);
  return db.prepare(`SELECT * FROM videos ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params) as Video[];
}

export function countVideos(): number {
  const db = getDb();
  return (db.prepare('SELECT COUNT(*) as n FROM videos').get() as { n: number }).n;
}

export function updateVideoStatus(id: string, status: VideoStatus, extras?: { hls_master_url?: string; thumbnail_url?: string; duration_seconds?: number }): Video | null {
  const db = getDb();
  const existing = getVideoById(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE videos
    SET status = ?, hls_master_url = ?, thumbnail_url = ?, duration_seconds = ?, updated_at = ?
    WHERE id = ?
  `).run(
    status,
    extras?.hls_master_url ?? existing.hls_master_url,
    extras?.thumbnail_url ?? existing.thumbnail_url,
    extras?.duration_seconds ?? existing.duration_seconds,
    now,
    id
  );
  return getVideoById(id);
}

export function updateVideo(id: string, ownerId: string, updates: Partial<{ title: string; description: string; visibility: VideoVisibility }>): Video {
  const db = getDb();
  const existing = getVideoById(id);
  if (!existing) throw new Error('Video not found');
  if (existing.owner_id !== ownerId) throw new Error('Not authorized');
  const now = new Date().toISOString();
  const next: Video = {
    ...existing,
    title: updates.title ?? existing.title,
    description: updates.description ?? existing.description,
    visibility: updates.visibility ?? existing.visibility,
    updated_at: now,
  };
  db.prepare(`
    UPDATE videos SET title = ?, description = ?, visibility = ?, updated_at = ? WHERE id = ?
  `).run(next.title, next.description, next.visibility, next.updated_at, id);
  return next;
}

export function deleteVideo(id: string, ownerId: string): void {
  const db = getDb();
  const existing = getVideoById(id);
  if (!existing) throw new Error('Video not found');
  if (existing.owner_id !== ownerId) throw new Error('Not authorized');
  db.prepare('DELETE FROM videos WHERE id = ?').run(id);
}

// ---------- Views ----------
export function recordView(videoId: string, userId: string | null, ip: string | null): number {
  const db = getDb();
  const video = getVideoById(videoId);
  if (!video) throw new Error('Video not found');

  const now = new Date().toISOString();
  db.prepare('INSERT INTO video_views (id, video_id, user_id, ip, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), videoId, userId, ip, now);
  db.prepare('UPDATE videos SET view_count = view_count + 1 WHERE id = ?').run(videoId);
  const updated = getVideoById(videoId)!;
  return updated.view_count;
}

// ---------- Likes / Dislikes ----------
export interface LikeResult {
  likeCount: number;
  dislikeCount: number;
  userReaction: 'like' | 'dislike' | null;
}

export function likeVideo(videoId: string, userId: string, type: 'like' | 'dislike' | 'none'): LikeResult {
  const db = getDb();
  const video = getVideoById(videoId);
  if (!video) throw new Error('Video not found');

  const existing = db.prepare('SELECT id, type FROM video_likes WHERE video_id = ? AND user_id = ?')
    .get(videoId, userId) as { id: string; type: 'like' | 'dislike' } | undefined;

  if (type === 'none') {
    if (existing) {
      db.prepare('DELETE FROM video_likes WHERE id = ?').run(existing.id);
      if (existing.type === 'like') {
        db.prepare('UPDATE videos SET like_count = MAX(like_count - 1, 0) WHERE id = ?').run(videoId);
      } else {
        db.prepare('UPDATE videos SET dislike_count = MAX(dislike_count - 1, 0) WHERE id = ?').run(videoId);
      }
    }
  } else if (existing) {
    if (existing.type === type) {
      // No change — same reaction clicked again
    } else {
      // Switch reaction
      db.prepare('UPDATE video_likes SET type = ?, created_at = ? WHERE id = ?')
        .run(type, new Date().toISOString(), existing.id);
      if (existing.type === 'like') {
        db.prepare('UPDATE videos SET like_count = MAX(like_count - 1, 0), dislike_count = dislike_count + 1 WHERE id = ?').run(videoId);
      } else {
        db.prepare('UPDATE videos SET dislike_count = MAX(dislike_count - 1, 0), like_count = like_count + 1 WHERE id = ?').run(videoId);
      }
    }
  } else {
    db.prepare('INSERT INTO video_likes (id, video_id, user_id, type, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), videoId, userId, type, new Date().toISOString());
    if (type === 'like') {
      db.prepare('UPDATE videos SET like_count = like_count + 1 WHERE id = ?').run(videoId);
    } else {
      db.prepare('UPDATE videos SET dislike_count = dislike_count + 1 WHERE id = ?').run(videoId);
    }
  }

  const updated = getVideoById(videoId)!;
  const userRow = db.prepare('SELECT type FROM video_likes WHERE video_id = ? AND user_id = ?')
    .get(videoId, userId) as { type: 'like' | 'dislike' } | undefined;

  // Publish event for notifications
  try {
    publish(CHANNELS.VIDEO_LIKED, {
      videoId,
      videoOwnerId: updated.owner_id,
      likerId: userId,
      likerUsername: 'someone',
      type,
      videoTitle: updated.title,
    }).catch(() => {});
  } catch {}

  return {
    likeCount: updated.like_count,
    dislikeCount: updated.dislike_count,
    userReaction: userRow?.type ?? null,
  };
}

export function getUserReaction(videoId: string, userId: string | null): 'like' | 'dislike' | null {
  if (!userId) return null;
  const db = getDb();
  const row = db.prepare('SELECT type FROM video_likes WHERE video_id = ? AND user_id = ?')
    .get(videoId, userId) as { type: 'like' | 'dislike' } | undefined;
  return row?.type ?? null;
}

// ---------- Search ----------
export type SearchSort = 'relevance' | 'date' | 'views';
export type DurationFilter = 'any' | 'short' | 'medium' | 'long';

export interface SearchOptions {
  query: string;
  sort?: SearchSort;
  channelId?: string;
  duration?: DurationFilter;
  limit?: number;
  offset?: number;
}

export function searchVideos(opts: SearchOptions): Video[] {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;
  const q = opts.query.trim();

  const filters: string[] = ["status = 'ready'", "visibility = 'public'"];
  const params: unknown[] = [];

  if (q) {
    filters.push('(LOWER(title) LIKE ? OR LOWER(description) LIKE ?)');
    const like = `%${q.toLowerCase()}%`;
    params.push(like, like);
  }

  if (opts.channelId) {
    filters.push('channel_id = ?');
    params.push(opts.channelId);
  }

  if (opts.duration === 'short') {
    filters.push('duration_seconds < 240'); // < 4 min
  } else if (opts.duration === 'medium') {
    filters.push('duration_seconds >= 240 AND duration_seconds < 1200'); // 4-20 min
  } else if (opts.duration === 'long') {
    filters.push('duration_seconds >= 1200'); // > 20 min
  }

  let orderBy = 'created_at DESC';
  if (opts.sort === 'views') orderBy = 'view_count DESC, created_at DESC';
  else if (opts.sort === 'date') orderBy = 'created_at DESC';
  else if (opts.sort === 'relevance' && q) {
    // relevance: title match first, then description match
    orderBy = `CASE
      WHEN LOWER(title) LIKE ? THEN 1
      WHEN LOWER(description) LIKE ? THEN 2
      ELSE 3
    END ASC, view_count DESC, created_at DESC`;
    const like = `%${q.toLowerCase()}%`;
    params.push(like, like);
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  params.push(limit, offset);

  return db.prepare(
    `SELECT * FROM videos ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
  ).all(...params) as Video[];
}

export function countSearchResults(opts: Omit<SearchOptions, 'limit' | 'offset' | 'sort'>): number {
  const db = getDb();
  const q = opts.query.trim();
  const filters: string[] = ["status = 'ready'", "visibility = 'public'"];
  const params: unknown[] = [];

  if (q) {
    filters.push('(LOWER(title) LIKE ? OR LOWER(description) LIKE ?)');
    const like = `%${q.toLowerCase()}%`;
    params.push(like, like);
  }
  if (opts.channelId) {
    filters.push('channel_id = ?');
    params.push(opts.channelId);
  }
  if (opts.duration === 'short') filters.push('duration_seconds < 240');
  else if (opts.duration === 'medium') filters.push('duration_seconds >= 240 AND duration_seconds < 1200');
  else if (opts.duration === 'long') filters.push('duration_seconds >= 1200');

  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const row = db.prepare(`SELECT COUNT(*) as n FROM videos ${where}`).get(...params) as { n: number };
  return row.n;
}

// ---------- Trending ----------
export function listTrending(limit = 50, offset = 0, windowDays = 7): Video[] {
  const db = getDb();
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare(`
    SELECT * FROM videos
    WHERE status = 'ready'
      AND visibility = 'public'
      AND created_at >= ?
    ORDER BY (view_count * 2 + like_count * 5 - dislike_count * 2) DESC, created_at DESC
    LIMIT ? OFFSET ?
  `).all(cutoff, limit, offset) as Video[];
}

export function countTrending(windowDays = 7): number {
  const db = getDb();
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const row = db.prepare(`
    SELECT COUNT(*) as n FROM videos
    WHERE status = 'ready' AND visibility = 'public' AND created_at >= ?
  `).get(cutoff) as { n: number };
  return row.n;
}

// ---------- Categories ----------
export interface CategoryStats {
  category: string;
  video_count: number;
  total_views: number;
}

export function listCategories(): CategoryStats[] {
  const db = getDb();
  return db.prepare(`
    SELECT
      COALESCE(category, 'other') as category,
      COUNT(*) as video_count,
      COALESCE(SUM(view_count), 0) as total_views
    FROM videos
    WHERE status = 'ready' AND visibility = 'public'
    GROUP BY category
    ORDER BY video_count DESC
  `).all() as CategoryStats[];
}

export function listVideosByCategory(category: string, limit = 50, offset = 0): Video[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM videos
    WHERE status = 'ready'
      AND visibility = 'public'
      AND COALESCE(category, 'other') = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(category, limit, offset) as Video[];
}

export function countVideosByCategory(category: string): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT COUNT(*) as n FROM videos
    WHERE status = 'ready' AND visibility = 'public' AND COALESCE(category, 'other') = ?
  `).get(category) as { n: number };
  return row.n;
}

// ---------- Update category ----------
export function updateVideoCategory(id: string, ownerId: string, category: string): Video {
  const db = getDb();
  const existing = getVideoById(id);
  if (!existing) throw new Error('Video not found');
  if (existing.owner_id !== ownerId) throw new Error('Not authorized');
  const now = new Date().toISOString();
  db.prepare('UPDATE videos SET category = ?, updated_at = ? WHERE id = ?')
    .run(category, now, id);
  return getVideoById(id)!;
}


// ---------- Podcasts ----------
export function listPodcasts(limit = 50, offset = 0): Video[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM videos
    WHERE status = 'ready' AND visibility = 'public' AND COALESCE(content_type, 'video') = 'podcast'
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as Video[];
}

export function countPodcasts(): number {
  const db = getDb();
  const row = db.prepare(
    "SELECT COUNT(*) as n FROM videos WHERE status = 'ready' AND visibility = 'public' AND COALESCE(content_type, 'video') = 'podcast'"
  ).get() as { n: number };
  return row.n;
}

export function listPodcastsByChannel(channelId: string, limit = 50, offset = 0): Video[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM videos
    WHERE channel_id = ? AND status = 'ready' AND visibility = 'public' AND COALESCE(content_type, 'video') = 'podcast'
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(channelId, limit, offset) as Video[];
}
