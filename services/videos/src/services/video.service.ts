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

    CREATE TABLE IF NOT EXISTS video_ratings (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      rating INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (video_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_video_ratings_video ON video_ratings(video_id);
    -- Add rating aggregate columns (idempotent)

    CREATE TABLE IF NOT EXISTS video_views (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      user_id TEXT,
      ip TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_video_views_video ON video_views(video_id);
  `);
  // Add rating aggregate columns (idempotent migrations)
  try { db.exec('ALTER TABLE videos ADD COLUMN rating_avg REAL NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE videos ADD COLUMN rating_count INTEGER NOT NULL DEFAULT 0'); } catch {}

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

// ---------- Rating (5-star) ----------
export interface RatingResult {
  ratingAvg: number;
  ratingCount: number;
  userRating: number | null;
}

export function rateVideo(videoId: string, userId: string, rating: number): RatingResult {
  const db = getDb();
  const video = getVideoById(videoId);
  if (!video) throw new Error('Video not found');
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error('Rating must be an integer 1-5');
  }

  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM video_ratings WHERE video_id = ? AND user_id = ?')
    .get(videoId, userId) as { id: string } | undefined;

  if (existing) {
    db.prepare('UPDATE video_ratings SET rating = ?, updated_at = ? WHERE id = ?')
      .run(rating, now, existing.id);
  } else {
    db.prepare('INSERT INTO video_ratings (id, video_id, user_id, rating, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), videoId, userId, rating, now, now);
  }

  // Recompute aggregate
  const agg = db.prepare('SELECT AVG(rating) as avg, COUNT(*) as n FROM video_ratings WHERE video_id = ?')
    .get(videoId) as { avg: number | null; n: number };
  const avg = agg.avg ?? 0;
  const n = agg.n ?? 0;
  db.prepare('UPDATE videos SET rating_avg = ?, rating_count = ? WHERE id = ?').run(avg, n, videoId);

  return { ratingAvg: avg, ratingCount: n, userRating: rating };
}

export function deleteRating(videoId: string, userId: string): RatingResult {
  const db = getDb();
  const video = getVideoById(videoId);
  if (!video) throw new Error('Video not found');

  db.prepare('DELETE FROM video_ratings WHERE video_id = ? AND user_id = ?').run(videoId, userId);

  const agg = db.prepare('SELECT AVG(rating) as avg, COUNT(*) as n FROM video_ratings WHERE video_id = ?')
    .get(videoId) as { avg: number | null; n: number };
  const avg = agg.avg ?? 0;
  const n = agg.n ?? 0;
  db.prepare('UPDATE videos SET rating_avg = ?, rating_count = ? WHERE id = ?').run(avg, n, videoId);

  return { ratingAvg: avg, ratingCount: n, userRating: null };
}

export function getUserRating(videoId: string, userId: string | null): number | null {
  if (!userId) return null;
  const db = getDb();
  const row = db.prepare('SELECT rating FROM video_ratings WHERE video_id = ? AND user_id = ?')
    .get(videoId, userId) as { rating: number } | undefined;
  return row?.rating ?? null;
}

export function getRatingStats(videoId: string): { avg: number; count: number } {
  const db = getDb();
  const row = db.prepare('SELECT rating_avg as avg, rating_count as count FROM videos WHERE id = ?')
    .get(videoId) as { avg: number; count: number } | undefined;
  return { avg: row?.avg ?? 0, count: row?.count ?? 0 };
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


// ---------- Shorts ----------
export function listShorts(limit = 50, offset = 0): Video[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM videos
    WHERE status = 'ready' AND visibility = 'public'
      AND COALESCE(content_type, 'video') = 'short'
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as Video[];
}

export function countShorts(): number {
  const db = getDb();
  const row = db.prepare(
    "SELECT COUNT(*) as n FROM videos WHERE status = 'ready' AND visibility = 'public' AND COALESCE(content_type, 'video') = 'short'"
  ).get() as { n: number };
  return row.n;
}

export function listShortsByChannel(channelId: string, limit = 50, offset = 0): Video[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM videos
    WHERE channel_id = ? AND status = 'ready' AND visibility = 'public'
      AND COALESCE(content_type, 'video') = 'short'
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(channelId, limit, offset) as Video[];
}

// ============================================================
// 4.8 HDR Support — idempotent columns + setters
// ============================================================

export function ensureHdrColumns(): void {
  const db = getDb();
  try { db.exec('ALTER TABLE videos ADD COLUMN is_hdr INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE videos ADD COLUMN hdr_format TEXT'); } catch {}
  try { db.exec('ALTER TABLE videos ADD COLUMN max_luminance_nits INTEGER'); } catch {}
  try { db.exec('ALTER TABLE videos ADD COLUMN color_primaries TEXT'); } catch {}
  try { db.exec('ALTER TABLE videos ADD COLUMN transfer_characteristics TEXT'); } catch {}
}

export interface HdrInfo {
  video_id: string;
  is_hdr: number;
  hdr_format: string | null;
  max_luminance_nits: number | null;
  color_primaries: string | null;
  transfer_characteristics: string | null;
}

export function getHdrInfo(videoId: string): HdrInfo | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT id as video_id, is_hdr, hdr_format, max_luminance_nits, color_primaries, transfer_characteristics FROM videos WHERE id = ?'
  ).get(videoId) as HdrInfo | undefined;
  return row ?? null;
}

export interface SetHdrInput {
  is_hdr?: boolean;
  hdr_format?: string | null;    // 'hdr10' | 'hdr10+' | 'dolby_vision' | 'hlg' | null
  max_luminance_nits?: number | null;
  color_primaries?: string | null;       // 'bt2020' | 'bt709' | ...
  transfer_characteristics?: string | null; // 'pq' | 'hlg' | ...
}

const VALID_HDR_FORMATS = ['hdr10', 'hdr10+', 'dolby_vision', 'hlg'];

export function setHdrInfo(videoId: string, ownerId: string, input: SetHdrInput): HdrInfo | null {
  const db = getDb();
  const cur = db.prepare('SELECT owner_id FROM videos WHERE id = ?')
    .get(videoId) as { owner_id: string } | undefined;
  if (!cur) return null;
  if (cur.owner_id !== ownerId) throw new Error('Not your video');

  if (input.hdr_format && !VALID_HDR_FORMATS.includes(input.hdr_format)) {
    throw new Error(`hdr_format must be one of ${VALID_HDR_FORMATS.join(', ')}`);
  }
  if (input.max_luminance_nits !== undefined && input.max_luminance_nits !== null) {
    if (input.max_luminance_nits < 100 || input.max_luminance_nits > 10000) {
      throw new Error('max_luminance_nits must be 100-10000');
    }
  }

  const fields: string[] = [];
  const values: any[] = [];
  if (input.is_hdr !== undefined) { fields.push('is_hdr = ?'); values.push(input.is_hdr ? 1 : 0); }
  if (input.hdr_format !== undefined) { fields.push('hdr_format = ?'); values.push(input.hdr_format); }
  if (input.max_luminance_nits !== undefined) { fields.push('max_luminance_nits = ?'); values.push(input.max_luminance_nits); }
  if (input.color_primaries !== undefined) { fields.push('color_primaries = ?'); values.push(input.color_primaries); }
  if (input.transfer_characteristics !== undefined) { fields.push('transfer_characteristics = ?'); values.push(input.transfer_characteristics); }

  if (fields.length === 0) return getHdrInfo(videoId);

  values.push(new Date().toISOString());
  values.push(videoId);
  db.prepare(`UPDATE videos SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`).run(...values);
  return getHdrInfo(videoId);
}

export function listHdrVideos(limit = 40): { id: string; title: string; hdr_format: string | null; thumbnail_url: string | null }[] {
  const db = getDb();
  const n = Math.min(Math.max(limit, 1), 200);
  return db.prepare(`
    SELECT id, title, hdr_format, thumbnail_url FROM videos
    WHERE is_hdr = 1 AND visibility = 'public'
    ORDER BY created_at DESC LIMIT ?
  `).all(n) as any[];
}

// ---------- Content-type segregation (Section 37 Phase B) ----------

export type ContentType =
  | 'video'
  | 'movie'
  | 'tv'
  | 'drama'
  | 'web_series'
  | 'music_video'
  | 'song'
  | 'album'
  | 'podcast'
  | 'short'
  | 'news'
  | 'article'
  | 'other';

export const CONTENT_TYPES: ContentType[] = [
  'video', 'movie', 'tv', 'drama', 'web_series', 'music_video',
  'song', 'album', 'podcast', 'short', 'news', 'article', 'other',
];

export interface ContentTypeStat {
  content_type: string;
  count: number;
  label: string;
}

const CONTENT_TYPE_LABELS: Record<string, string> = {
  video: 'Videos',
  movie: 'Movies',
  tv: 'TV Shows',
  drama: 'Dramas',
  web_series: 'Web Series',
  music_video: 'Music Videos',
  song: 'Songs',
  album: 'Albums',
  podcast: 'Podcasts',
  short: 'Shorts',
  news: 'News',
  article: 'Articles',
  other: 'Other',
};

export function contentLabel(contentType: string): string {
  return CONTENT_TYPE_LABELS[contentType] ?? contentType;
}

export function listVideosByContentType(contentType: string, limit = 50, offset = 0): Video[] {
  const db = getDb();
  const n = Math.min(Math.max(limit, 1), 200);
  const o = Math.max(offset, 0);
  return db.prepare(`
    SELECT * FROM videos
    WHERE visibility = 'public' AND status = 'ready'
      AND COALESCE(content_type, 'video') = ?
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(contentType, n, o) as Video[];
}

export function countVideosByContentType(contentType: string): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT COUNT(*) as n FROM videos
    WHERE visibility = 'public' AND status = 'ready'
      AND COALESCE(content_type, 'video') = ?
  `).get(contentType) as { n: number };
  return row.n;
}

export function listContentTypeStats(): ContentTypeStat[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT COALESCE(content_type, 'video') as content_type, COUNT(*) as count
    FROM videos
    WHERE visibility = 'public' AND status = 'ready'
    GROUP BY content_type
    ORDER BY count DESC
  `).all() as Array<{ content_type: string; count: number }>;
  return rows.map((r) => ({
    content_type: r.content_type,
    count: r.count,
    label: contentLabel(r.content_type),
  }));
}

/**
 * Trending videos per content type — for the home page.
 * Each category returns up to `perCategory` top videos (by views).
 */
export interface TrendingByCategory {
  content_type: string;
  label: string;
  videos: Video[];
  total_in_category: number;
}

export function trendingByContentType(perCategory = 3, windowDays = 7): TrendingByCategory[] {
  const db = getDb();
  const n = Math.min(Math.max(perCategory, 1), 20);
  const cutoff = new Date(Date.now() - Math.min(windowDays, 90) * 24 * 60 * 60 * 1000).toISOString();

  // Content types with at least one ready+public row
  const kinds = db.prepare(`
    SELECT DISTINCT COALESCE(content_type, 'video') as content_type
    FROM videos
    WHERE visibility = 'public' AND status = 'ready'
  `).all() as Array<{ content_type: string }>;

  const result: TrendingByCategory[] = [];
  const trendingStmt = db.prepare(`
    SELECT * FROM videos
    WHERE visibility = 'public' AND status = 'ready'
      AND COALESCE(content_type, 'video') = ?
      AND created_at >= ?
    ORDER BY view_count DESC, like_count DESC, created_at DESC
    LIMIT ?
  `);
  const fallbackStmt = db.prepare(`
    SELECT * FROM videos
    WHERE visibility = 'public' AND status = 'ready'
      AND COALESCE(content_type, 'video') = ?
    ORDER BY view_count DESC, like_count DESC, created_at DESC
    LIMIT ?
  `);
  const countStmt = db.prepare(`
    SELECT COUNT(*) as n FROM videos
    WHERE visibility = 'public' AND status = 'ready'
      AND COALESCE(content_type, 'video') = ?
  `);

  for (const k of kinds) {
    let videos = trendingStmt.all(k.content_type, cutoff, n) as Video[];
    if (videos.length === 0) videos = fallbackStmt.all(k.content_type, n) as Video[];
    if (videos.length === 0) continue;
    result.push({
      content_type: k.content_type,
      label: contentLabel(k.content_type),
      videos,
      total_in_category: (countStmt.get(k.content_type) as { n: number }).n,
    });
  }
  // sort categories by total_in_category desc
  result.sort((a, b) => b.total_in_category - a.total_in_category);
  return result;
}

export function updateVideoContentType(id: string, ownerId: string, contentType: string): Video {
  const db = getDb();
  const existing = getVideoById(id);
  if (!existing) throw new Error('Video not found');
  if (existing.owner_id !== ownerId) throw new Error('Not authorized');
  if (!CONTENT_TYPES.includes(contentType as ContentType)) {
    throw new Error(`Unknown content_type: ${contentType}`);
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE videos SET content_type = ?, updated_at = ? WHERE id = ?')
    .run(contentType, now, id);
  return getVideoById(id)!;
}
