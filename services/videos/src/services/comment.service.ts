// melodyflix videos - comments, likes, reports, saves
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export interface Comment {
  id: string;
  video_id: string;
  user_id: string;
  parent_id: string | null;
  content: string;
  like_count: number;
  reply_count: number;
  is_edited: number;
  is_deleted: number;
  is_pinned: number;
  creator_heart: number;
  created_at: string;
  updated_at: string;
  // joined fields
  user_reaction?: boolean;
}

export interface CommentWithReplies extends Comment {
  replies: Comment[];
}

export function ensureCommentSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      parent_id TEXT,
      content TEXT NOT NULL,
      like_count INTEGER NOT NULL DEFAULT 0,
      reply_count INTEGER NOT NULL DEFAULT 0,
      is_edited INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comments_video ON comments(video_id);
    CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
    CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id);

    CREATE TABLE IF NOT EXISTS comment_likes (
      id TEXT PRIMARY KEY,
      comment_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (comment_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS comment_reports (
      id TEXT PRIMARY KEY,
      comment_id TEXT NOT NULL,
      reporter_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saved_videos (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (user_id, video_id)
    );
  `);

  // Migration: add new columns to existing DBs (ignore errors if already present)
  try { db.exec('ALTER TABLE comments ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE comments ADD COLUMN creator_heart INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_comments_pinned ON comments(video_id, is_pinned DESC)'); } catch {}
}

// ---------- Comments ----------
export function createComment(
  videoId: string,
  userId: string,
  content: string,
  parentId: string | null
): Comment {
  const db = getDb();

  if (parentId) {
    const parent = db.prepare('SELECT id, video_id, is_deleted FROM comments WHERE id = ?').get(parentId) as { id: string; video_id: string; is_deleted: number } | undefined;
    if (!parent) throw new Error('Parent comment not found');
    if (parent.video_id !== videoId) throw new Error('Parent belongs to different video');
    if (parent.is_deleted) throw new Error('Cannot reply to deleted comment');
  }

  const now = new Date().toISOString();
  const comment: Comment = {
    id: randomUUID(),
    video_id: videoId,
    user_id: userId,
    parent_id: parentId,
    content: content.trim(),
    like_count: 0,
    reply_count: 0,
    is_edited: 0,
    is_deleted: 0,
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO comments (id, video_id, user_id, parent_id, content, like_count, reply_count, is_edited, is_deleted, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    comment.id, comment.video_id, comment.user_id, comment.parent_id,
    comment.content, comment.like_count, comment.reply_count,
    comment.is_edited, comment.is_deleted, comment.created_at, comment.updated_at
  );

  if (parentId) {
    db.prepare('UPDATE comments SET reply_count = reply_count + 1 WHERE id = ?').run(parentId);
  }

  return comment;
}

export function getComments(videoId: string, currentUserId: string | null): CommentWithReplies[] {
  const db = getDb();

  // Top-level comments
  const tops = db.prepare(`
    SELECT * FROM comments
    WHERE video_id = ? AND parent_id IS NULL
    ORDER BY created_at DESC
    LIMIT 200
  `).all(videoId) as Comment[];

  // All replies for these comments
  const result: CommentWithReplies[] = [];

  for (const top of tops) {
    const replies = db.prepare(`
      SELECT * FROM comments
      WHERE parent_id = ?
      ORDER BY created_at ASC
      LIMIT 100
    `).all(top.id) as Comment[];

    const enrichedReplies = replies.map((r) => ({
      ...r,
      user_reaction: currentUserId ? isCommentLiked(r.id, currentUserId) : false,
    }));

    result.push({
      ...top,
      user_reaction: currentUserId ? isCommentLiked(top.id, currentUserId) : false,
      replies: enrichedReplies,
    });
  }

  return result;
}

export function getCommentCount(videoId: string): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as n FROM comments WHERE video_id = ? AND is_deleted = 0').get(videoId) as { n: number };
  return row.n;
}

export function updateComment(commentId: string, userId: string, content: string): Comment {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId) as Comment | undefined;
  if (!existing) throw new Error('Comment not found');
  if (existing.user_id !== userId) throw new Error('Not authorized');
  if (existing.is_deleted) throw new Error('Comment is deleted');

  const now = new Date().toISOString();
  db.prepare('UPDATE comments SET content = ?, is_edited = 1, updated_at = ? WHERE id = ?')
    .run(content.trim(), now, commentId);

  return db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId) as Comment;
}

export function deleteComment(commentId: string, userId: string, isAdmin: boolean): void {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId) as Comment | undefined;
  if (!existing) throw new Error('Comment not found');
  if (!isAdmin && existing.user_id !== userId) throw new Error('Not authorized');

  // Soft delete — keep content for reply chains
  db.prepare('UPDATE comments SET is_deleted = 1, content = ?, updated_at = ? WHERE id = ?')
    .run('[deleted]', new Date().toISOString(), commentId);
}

// ---------- Comment likes ----------
function isCommentLiked(commentId: string, userId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT id FROM comment_likes WHERE comment_id = ? AND user_id = ?').get(commentId, userId);
  return !!row;
}

export interface CommentLikeResult {
  liked: boolean;
  likeCount: number;
}

export function likeComment(commentId: string, userId: string): CommentLikeResult {
  const db = getDb();
  const comment = db.prepare('SELECT id FROM comments WHERE id = ?').get(commentId);
  if (!comment) throw new Error('Comment not found');

  const existing = db.prepare('SELECT id FROM comment_likes WHERE comment_id = ? AND user_id = ?').get(commentId, userId) as { id: string } | undefined;

  if (existing) {
    db.prepare('DELETE FROM comment_likes WHERE id = ?').run(existing.id);
    db.prepare('UPDATE comments SET like_count = MAX(like_count - 1, 0) WHERE id = ?').run(commentId);
    const updated = db.prepare('SELECT like_count FROM comments WHERE id = ?').get(commentId) as { like_count: number };
    return { liked: false, likeCount: updated.like_count };
  } else {
    db.prepare('INSERT INTO comment_likes (id, comment_id, user_id, created_at) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), commentId, userId, new Date().toISOString());
    db.prepare('UPDATE comments SET like_count = like_count + 1 WHERE id = ?').run(commentId);
    const updated = db.prepare('SELECT like_count FROM comments WHERE id = ?').get(commentId) as { like_count: number };
    return { liked: true, likeCount: updated.like_count };
  }
}

// ---------- Reports ----------
export function reportComment(commentId: string, reporterId: string, reason: string, note: string | null): void {
  const db = getDb();
  const comment = db.prepare('SELECT id FROM comments WHERE id = ?').get(commentId);
  if (!comment) throw new Error('Comment not found');

  const existing = db.prepare('SELECT id FROM comment_reports WHERE comment_id = ? AND reporter_id = ?').get(commentId, reporterId);
  if (existing) throw new Error('You already reported this comment');

  db.prepare(`
    INSERT INTO comment_reports (id, comment_id, reporter_id, reason, note, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(randomUUID(), commentId, reporterId, reason, note, new Date().toISOString());
}

// ---------- Saved videos ----------
export function toggleSaveVideo(videoId: string, userId: string): { saved: boolean } {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM saved_videos WHERE user_id = ? AND video_id = ?').get(userId, videoId) as { id: string } | undefined;

  if (existing) {
    db.prepare('DELETE FROM saved_videos WHERE id = ?').run(existing.id);
    return { saved: false };
  }
  db.prepare('INSERT INTO saved_videos (id, user_id, video_id, created_at) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), userId, videoId, new Date().toISOString());
  return { saved: true };
}

export function isVideoSaved(videoId: string, userId: string | null): boolean {
  if (!userId) return false;
  const db = getDb();
  const row = db.prepare('SELECT id FROM saved_videos WHERE user_id = ? AND video_id = ?').get(userId, videoId);
  return !!row;
}

export function listSavedVideos(userId: string): string[] {
  const db = getDb();
  const rows = db.prepare('SELECT video_id FROM saved_videos WHERE user_id = ? ORDER BY created_at DESC').all(userId) as { video_id: string }[];
  return rows.map((r) => r.video_id);
}

// ---------- Admin: Reports ----------
export interface Report {
  id: string;
  comment_id: string;
  reporter_id: string;
  reason: string;
  note: string | null;
  status: string;
  created_at: string;
}

export interface ReportWithDetails extends Report {
  comment_content: string | null;
  comment_author_id: string | null;
  comment_video_id: string | null;
  comment_is_deleted: number | null;
}

export function listReports(status: string = 'pending'): ReportWithDetails[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      r.*,
      c.content AS comment_content,
      c.user_id AS comment_author_id,
      c.video_id AS comment_video_id,
      c.is_deleted AS comment_is_deleted
    FROM comment_reports r
    LEFT JOIN comments c ON c.id = r.comment_id
    WHERE r.status = ?
    ORDER BY r.created_at DESC
    LIMIT 200
  `).all(status) as ReportWithDetails[];
  return rows;
}

export function getReportById(id: string): ReportWithDetails | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      r.*,
      c.content AS comment_content,
      c.user_id AS comment_author_id,
      c.video_id AS comment_video_id,
      c.is_deleted AS comment_is_deleted
    FROM comment_reports r
    LEFT JOIN comments c ON c.id = r.comment_id
    WHERE r.id = ?
  `).get(id) as ReportWithDetails | undefined;
  return row ?? null;
}

export function resolveReport(reportId: string, resolution: 'resolved' | 'dismissed'): void {
  const db = getDb();
  db.prepare('UPDATE comment_reports SET status = ? WHERE id = ?').run(resolution, reportId);
}

export function countPendingReports(): number {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as n FROM comment_reports WHERE status = 'pending'").get() as { n: number };
  return row.n;
}

// ---------- Watch Later (full video data) ----------
export function listSavedVideoIds(userId: string): string[] {
  const db = getDb();
  const rows = db.prepare('SELECT video_id FROM saved_videos WHERE user_id = ? ORDER BY created_at DESC').all(userId) as { video_id: string }[];
  return rows.map((r) => r.video_id);
}

export function listSavedVideosWithData(userId: string): any[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT v.*, s.created_at AS saved_at
    FROM videos v
    INNER JOIN saved_videos s ON s.video_id = v.id
    WHERE s.user_id = ?
    ORDER BY s.created_at DESC
    LIMIT 200
  `).all(userId) as any[];
  return rows;
}

// ---------- History ----------
export interface HistoryEntry {
  id: string;
  user_id: string;
  video_id: string;
  position: number;
  watched_at: string;
}

export function ensureHistorySchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      position REAL NOT NULL DEFAULT 0,
      watched_at TEXT NOT NULL,
      UNIQUE (user_id, video_id)
    );
    CREATE INDEX IF NOT EXISTS idx_history_user ON video_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_history_watched ON video_history(watched_at);
  `);
}

// Upsert: record watch (updates watched_at, position)
export function recordHistory(userId: string, videoId: string, position: number): void {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare(
    'SELECT id FROM video_history WHERE user_id = ? AND video_id = ?'
  ).get(userId, videoId) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      'UPDATE video_history SET position = ?, watched_at = ? WHERE id = ?'
    ).run(position, now, existing.id);
  } else {
    db.prepare(
      'INSERT INTO video_history (id, user_id, video_id, position, watched_at) VALUES (?, ?, ?, ?, ?)'
    ).run(randomUUID(), userId, videoId, position, now);
  }
}

export function listHistoryWithData(userId: string, limit = 100, offset = 0): any[] {
  const db = getDb();
  return db.prepare(`
    SELECT v.*, h.watched_at, h.position AS resume_position
    FROM videos v
    INNER JOIN video_history h ON h.video_id = v.id
    WHERE h.user_id = ?
    ORDER BY h.watched_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, limit, offset) as any[];
}

export function countHistory(userId: string): number {
  const db = getDb();
  const row = db.prepare(
    'SELECT COUNT(*) as n FROM video_history WHERE user_id = ?'
  ).get(userId) as { n: number };
  return row.n;
}

export function removeHistoryEntry(userId: string, videoId: string): boolean {
  const db = getDb();
  const result = db.prepare(
    'DELETE FROM video_history WHERE user_id = ? AND video_id = ?'
  ).run(userId, videoId);
  return result.changes > 0;
}

export function clearHistory(userId: string): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM video_history WHERE user_id = ?').run(userId);
  return result.changes;
}

export function getResumePosition(userId: string, videoId: string): number {
  const db = getDb();
  const row = db.prepare(
    'SELECT position FROM video_history WHERE user_id = ? AND video_id = ?'
  ).get(userId, videoId) as { position: number } | undefined;
  return row?.position ?? 0;
}

// ---------- Playlists ----------
export interface Playlist {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  visibility: string;
  video_count: number;
  created_at: string;
  updated_at: string;
}

export function ensurePlaylistSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      visibility TEXT NOT NULL DEFAULT 'public',
      video_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id);

    CREATE TABLE IF NOT EXISTS playlist_items (
      id TEXT PRIMARY KEY,
      playlist_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      added_at TEXT NOT NULL,
      UNIQUE (playlist_id, video_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pl_items_playlist ON playlist_items(playlist_id);
    CREATE INDEX IF NOT EXISTS idx_pl_items_video ON playlist_items(video_id);
  `);
}

export function createPlaylist(userId: string, name: string, description: string | null, visibility: string = 'public'): Playlist {
  const db = getDb();
  const now = new Date().toISOString();
  const p: Playlist = {
    id: randomUUID(),
    user_id: userId,
    name: name.trim(),
    description: description?.trim() || null,
    visibility,
    video_count: 0,
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO playlists (id, user_id, name, description, visibility, video_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(p.id, p.user_id, p.name, p.description, p.visibility, p.video_count, p.created_at, p.updated_at);
  return p;
}

export function listPlaylists(userId: string): Playlist[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM playlists WHERE user_id = ? ORDER BY updated_at DESC
  `).all(userId) as Playlist[];
}

export function getPlaylistById(id: string): Playlist | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM playlists WHERE id = ?').get(id) as Playlist | undefined) ?? null;
}

export function updatePlaylist(id: string, userId: string, updates: { name?: string; description?: string; visibility?: string }): Playlist {
  const db = getDb();
  const existing = getPlaylistById(id);
  if (!existing) throw new Error('Playlist not found');
  if (existing.user_id !== userId) throw new Error('Not authorized');
  const now = new Date().toISOString();
  const next: Playlist = {
    ...existing,
    name: updates.name?.trim() || existing.name,
    description: updates.description !== undefined ? (updates.description.trim() || null) : existing.description,
    visibility: updates.visibility ?? existing.visibility,
    updated_at: now,
  };
  db.prepare(`
    UPDATE playlists SET name = ?, description = ?, visibility = ?, updated_at = ? WHERE id = ?
  `).run(next.name, next.description, next.visibility, next.updated_at, id);
  return next;
}

export function deletePlaylist(id: string, userId: string): void {
  const db = getDb();
  const existing = getPlaylistById(id);
  if (!existing) throw new Error('Playlist not found');
  if (existing.user_id !== userId) throw new Error('Not authorized');
  db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(id);
  db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
}

export function addToPlaylist(playlistId: string, userId: string, videoId: string): { added: boolean; videoCount: number } {
  const db = getDb();
  const playlist = getPlaylistById(playlistId);
  if (!playlist) throw new Error('Playlist not found');
  if (playlist.user_id !== userId) throw new Error('Not authorized');

  const existing = db.prepare(
    'SELECT id FROM playlist_items WHERE playlist_id = ? AND video_id = ?'
  ).get(playlistId, videoId);
  if (existing) {
    const cnt = (db.prepare('SELECT COUNT(*) as n FROM playlist_items WHERE playlist_id = ?').get(playlistId) as { n: number }).n;
    return { added: false, videoCount: cnt };
  }

  const maxPos = (db.prepare(
    'SELECT MAX(position) as m FROM playlist_items WHERE playlist_id = ?'
  ).get(playlistId) as { m: number | null }).m ?? -1;

  db.prepare(`
    INSERT INTO playlist_items (id, playlist_id, video_id, position, added_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(randomUUID(), playlistId, videoId, maxPos + 1, new Date().toISOString());

  db.prepare('UPDATE playlists SET video_count = video_count + 1, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), playlistId);

  const cnt = (db.prepare('SELECT COUNT(*) as n FROM playlist_items WHERE playlist_id = ?').get(playlistId) as { n: number }).n;
  return { added: true, videoCount: cnt };
}

export function removeFromPlaylist(playlistId: string, userId: string, videoId: string): { removed: boolean; videoCount: number } {
  const db = getDb();
  const playlist = getPlaylistById(playlistId);
  if (!playlist) throw new Error('Playlist not found');
  if (playlist.user_id !== userId) throw new Error('Not authorized');

  const r = db.prepare('DELETE FROM playlist_items WHERE playlist_id = ? AND video_id = ?').run(playlistId, videoId);
  if (r.changes > 0) {
    db.prepare('UPDATE playlists SET video_count = MAX(video_count - 1, 0), updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), playlistId);
  }
  const cnt = (db.prepare('SELECT COUNT(*) as n FROM playlist_items WHERE playlist_id = ?').get(playlistId) as { n: number }).n;
  return { removed: r.changes > 0, videoCount: cnt };
}

export function listPlaylistItems(playlistId: string): any[] {
  const db = getDb();
  return db.prepare(`
    SELECT v.*, pi.position, pi.added_at AS item_added_at
    FROM videos v
    INNER JOIN playlist_items pi ON pi.video_id = v.id
    WHERE pi.playlist_id = ?
    ORDER BY pi.position ASC
  `).all(playlistId) as any[];
}

export function listPlaylistsContainingVideo(userId: string, videoId: string): Playlist[] {
  const db = getDb();
  return db.prepare(`
    SELECT p.* FROM playlists p
    INNER JOIN playlist_items pi ON pi.playlist_id = p.id
    WHERE p.user_id = ? AND pi.video_id = ?
  `).all(userId, videoId) as Playlist[];
}


// ---------- Better comments: pagination, sorting, pin, heart ----------

export type CommentSort = 'top' | 'newest' | 'oldest';

export interface CommentsPage {
  comments: CommentWithReplies[];
  total: number;
  has_more: boolean;
  next_offset: number;
}

export function getCommentsPaginated(
  videoId: string,
  currentUserId: string | null,
  sort: CommentSort = 'top',
  limit = 20,
  offset = 0
): CommentsPage {
  const db = getDb();

  // Determine ORDER BY
  let orderClause = 'is_pinned DESC, ';
  if (sort === 'newest') orderClause += 'created_at DESC';
  else if (sort === 'oldest') orderClause += 'created_at ASC';
  else orderClause += 'like_count DESC, created_at DESC'; // top

  // Note: LIMIT/OFFSET inlined because node:sqlite (Node 22) doesn't bind
  // placeholders in LIMIT/OFFSET clauses reliably. Values are clamped ints — safe.
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const safeOffset = Math.max(0, Math.floor(offset));
  const tops = db.prepare(
    'SELECT * FROM comments WHERE video_id = ? AND parent_id IS NULL AND is_deleted = 0 ORDER BY ' + orderClause + ' LIMIT ' + safeLimit + ' OFFSET ' + safeOffset
  ).all(videoId) as Comment[];

  const totalRow = db.prepare(
    'SELECT COUNT(*) as n FROM comments WHERE video_id = ? AND parent_id IS NULL AND is_deleted = 0'
  ).get(videoId) as { n: number };

  const result: CommentWithReplies[] = [];
  for (const top of tops) {
    const replies = db.prepare(
      'SELECT * FROM comments WHERE parent_id = ? AND is_deleted = 0 ORDER BY created_at ASC LIMIT 50'
    ).all(top.id) as Comment[];

    const enrichedReplies = replies.map((r) => ({
      ...r,
      user_reaction: currentUserId ? isCommentLiked(r.id, currentUserId) : false,
    }));

    result.push({
      ...top,
      user_reaction: currentUserId ? isCommentLiked(top.id, currentUserId) : false,
      replies: enrichedReplies,
    });
  }

  const total = totalRow.n;
  const hasMore = offset + limit < total;

  return {
    comments: result,
    total,
    has_more: hasMore,
    next_offset: offset + limit,
  };
}

// Pin a comment (creator only — check ownership of the video)
export function pinComment(commentId: string, userId: string, isAdmin = false): void {
  const db = getDb();
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId) as Comment | undefined;
  if (!comment) throw new Error('Comment not found');

  // Check ownership: either comment author OR video owner OR admin
  if (!isAdmin && comment.user_id !== userId) {
    const video = db.prepare('SELECT owner_id FROM videos WHERE id = ?').get(comment.video_id) as { owner_id: string } | undefined;
    if (!video || video.owner_id !== userId) {
      throw new Error('Only the video creator can pin comments');
    }
  }

  // Unpin any currently pinned comment in the same video (only one pinned per video)
  db.prepare('UPDATE comments SET is_pinned = 0 WHERE video_id = ?').run(comment.video_id);
  db.prepare('UPDATE comments SET is_pinned = 1 WHERE id = ?').run(commentId);
}

export function unpinComment(commentId: string, userId: string, isAdmin = false): void {
  const db = getDb();
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId) as Comment | undefined;
  if (!comment) throw new Error('Comment not found');

  if (!isAdmin && comment.user_id !== userId) {
    const video = db.prepare('SELECT owner_id FROM videos WHERE id = ?').get(comment.video_id) as { owner_id: string } | undefined;
    if (!video || video.owner_id !== userId) {
      throw new Error('Only the video creator can unpin comments');
    }
  }

  db.prepare('UPDATE comments SET is_pinned = 0 WHERE id = ?').run(commentId);
}

// Creator heart: toggle a heart on a comment (creator only)
export function toggleCreatorHeart(commentId: string, userId: string, isAdmin = false): { heart: boolean } {
  const db = getDb();
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId) as Comment | undefined;
  if (!comment) throw new Error('Comment not found');

  if (!isAdmin && comment.user_id !== userId) {
    const video = db.prepare('SELECT owner_id FROM videos WHERE id = ?').get(comment.video_id) as { owner_id: string } | undefined;
    if (!video || video.owner_id !== userId) {
      throw new Error('Only the video creator can heart comments');
    }
  }

  const newVal = comment.creator_heart ? 0 : 1;
  db.prepare('UPDATE comments SET creator_heart = ? WHERE id = ?').run(newVal, commentId);
  return { heart: newVal === 1 };
}
