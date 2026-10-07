// melodyflix videos - Section 15.6 Comment on Timeline
// Timestamped comments anchored to a video / edit project timeline,
// with threading, mentions, reactions, and resolve workflow.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export function ensureTimelineCommentSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS timeline_comments (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      video_id TEXT NOT NULL,
      version_id TEXT,
      clip_id TEXT,
      parent_id TEXT,
      author_id TEXT NOT NULL,
      time_ms INTEGER NOT NULL DEFAULT 0,
      time_end_ms INTEGER,
      track_index INTEGER,
      body TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      resolved_by TEXT,
      resolved_at TEXT,
      edited_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tlc_video ON timeline_comments(video_id, time_ms);
    CREATE INDEX IF NOT EXISTS idx_tlc_project ON timeline_comments(project_id, time_ms);
    CREATE INDEX IF NOT EXISTS idx_tlc_parent ON timeline_comments(parent_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_tlc_clip ON timeline_comments(clip_id, time_ms);
    CREATE INDEX IF NOT EXISTS idx_tlc_resolved ON timeline_comments(video_id, resolved, created_at DESC);

    CREATE TABLE IF NOT EXISTS timeline_comment_mentions (
      id TEXT PRIMARY KEY,
      comment_id TEXT NOT NULL,
      mentioned_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (comment_id, mentioned_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_tlc_mention_user ON timeline_comment_mentions(mentioned_user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS timeline_comment_reactions (
      id TEXT PRIMARY KEY,
      comment_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (comment_id, user_id, emoji)
    );
    CREATE INDEX IF NOT EXISTS idx_tlc_reaction_comment ON timeline_comment_reactions(comment_id, emoji);
  `);
}

export interface TimelineComment {
  id: string;
  project_id: string | null;
  video_id: string;
  version_id: string | null;
  clip_id: string | null;
  parent_id: string | null;
  author_id: string;
  time_ms: number;
  time_end_ms: number | null;
  track_index: number | null;
  body: string;
  resolved: number;
  resolved_by: string | null;
  resolved_at: string | null;
  edited_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimelineMention {
  id: string;
  comment_id: string;
  mentioned_user_id: string;
  created_at: string;
}

export interface TimelineReaction {
  id: string;
  comment_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

// ---------- comments ----------
export interface AddCommentInput {
  video_id: string;
  author_id: string;
  body: string;
  time_ms?: number;
  time_end_ms?: number | null;
  track_index?: number | null;
  project_id?: string | null;
  version_id?: string | null;
  clip_id?: string | null;
  parent_id?: string | null;
  mentions?: string[];
}

export function addComment(input: AddCommentInput): TimelineComment {
  if (!input.video_id) throw new Error('video_required');
  if (!input.author_id) throw new Error('author_required');
  if (!input.body || input.body.length > 5000) throw new Error('invalid_body');
  if (input.time_ms !== undefined && (input.time_ms < 0 || input.time_ms > 86_400_000)) throw new Error('invalid_time');
  if (input.parent_id) {
    const parent = getComment(input.parent_id);
    if (!parent) throw new Error('parent_not_found');
    if (parent.video_id !== input.video_id) throw new Error('parent_video_mismatch');
  }
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO timeline_comments
      (id, project_id, video_id, version_id, clip_id, parent_id, author_id,
       time_ms, time_end_ms, track_index, body, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.project_id ?? null, input.video_id, input.version_id ?? null,
    input.clip_id ?? null, input.parent_id ?? null, input.author_id,
    input.time_ms ?? 0, input.time_end_ms ?? null, input.track_index ?? null,
    input.body, now, now);
  if (input.mentions && input.mentions.length) {
    const insMention = db.prepare(`
      INSERT OR IGNORE INTO timeline_comment_mentions (id, comment_id, mentioned_user_id, created_at)
      VALUES (?, ?, ?, ?)
    `);
    for (const u of input.mentions) insMention.run(randomUUID(), id, u, now);
  }
  return getComment(id)!;
}

export function getComment(id: string): TimelineComment | null {
  return (getDb().prepare('SELECT * FROM timeline_comments WHERE id = ?').get(id) as TimelineComment | undefined) ?? null;
}

export interface ListCommentsFilter {
  video_id?: string;
  project_id?: string;
  clip_id?: string;
  author_id?: string;
  parent_id?: string | null; // null => top-level only
  resolved?: boolean;
  from_ms?: number;
  to_ms?: number;
  limit?: number;
}

export function listComments(filter: ListCommentsFilter): TimelineComment[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter.video_id) { where.push('video_id = ?'); args.push(filter.video_id); }
  if (filter.project_id) { where.push('project_id = ?'); args.push(filter.project_id); }
  if (filter.clip_id) { where.push('clip_id = ?'); args.push(filter.clip_id); }
  if (filter.author_id) { where.push('author_id = ?'); args.push(filter.author_id); }
  if (filter.parent_id === null) where.push('parent_id IS NULL');
  else if (filter.parent_id !== undefined) { where.push('parent_id = ?'); args.push(filter.parent_id); }
  if (filter.resolved !== undefined) { where.push('resolved = ?'); args.push(filter.resolved ? 1 : 0); }
  if (filter.from_ms !== undefined) { where.push('time_ms >= ?'); args.push(filter.from_ms); }
  if (filter.to_ms !== undefined) { where.push('time_ms <= ?'); args.push(filter.to_ms); }
  const sql = `SELECT * FROM timeline_comments ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY time_ms ASC, created_at ASC LIMIT ?`;
  args.push(Math.min(Math.max(filter.limit ?? 200, 1), 1000));
  return db.prepare(sql).all(...args) as TimelineComment[];
}

export function updateComment(id: string, actorId: string, body: string): TimelineComment | null {
  const c = getComment(id);
  if (!c) return null;
  if (c.author_id !== actorId) throw new Error('author_only');
  if (!body || body.length > 5000) throw new Error('invalid_body');
  const now = new Date().toISOString();
  getDb().prepare('UPDATE timeline_comments SET body = ?, edited_at = ?, updated_at = ? WHERE id = ?')
    .run(body, now, now, id);
  return getComment(id);
}

export function deleteComment(id: string, actorId: string, ownerVideoIds?: string[]): boolean {
  const c = getComment(id);
  if (!c) return false;
  const isOwner = ownerVideoIds?.includes(c.video_id);
  if (c.author_id !== actorId && !isOwner) throw new Error('not_allowed');
  const db = getDb();
  // delete replies + mentions + reactions too
  db.prepare('DELETE FROM timeline_comment_reactions WHERE comment_id = ?').run(id);
  db.prepare('DELETE FROM timeline_comment_mentions WHERE comment_id = ?').run(id);
  db.prepare('DELETE FROM timeline_comments WHERE parent_id = ?').run(id);
  return db.prepare('DELETE FROM timeline_comments WHERE id = ?').run(id).changes > 0;
}

// ---------- resolve ----------
export function resolveComment(id: string, actorId: string): TimelineComment | null {
  const c = getComment(id);
  if (!c) return null;
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE timeline_comments SET resolved = 1, resolved_by = ?, resolved_at = ?, updated_at = ?
    WHERE id = ?
  `).run(actorId, now, now, id);
  return getComment(id);
}

export function unresolveComment(id: string, actorId: string): TimelineComment | null {
  const c = getComment(id);
  if (!c) return null;
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE timeline_comments SET resolved = 0, resolved_by = NULL, resolved_at = NULL, updated_at = ?
    WHERE id = ?
  `).run(now, id);
  return getComment(id);
}

// ---------- replies / thread ----------
export function listReplies(parentId: string): TimelineComment[] {
  return getDb().prepare('SELECT * FROM timeline_comments WHERE parent_id = ? ORDER BY created_at ASC')
    .all(parentId) as TimelineComment[];
}

export interface CommentThread {
  root: TimelineComment;
  replies: TimelineComment[];
  reactions_summary: { emoji: string; count: number; user_ids: string[] }[];
  mentions: string[];
}

export function getThread(rootId: string): CommentThread | null {
  const root = getComment(rootId);
  if (!root) return null;
  const replies = listReplies(rootId);
  const db = getDb();
  const reactionRows = db.prepare(`
    SELECT emoji, user_id FROM timeline_comment_reactions WHERE comment_id = ? ORDER BY emoji
  `).all(rootId) as { emoji: string; user_id: string }[];
  const groups: Record<string, { count: number; user_ids: string[] }> = {};
  for (const r of reactionRows) {
    if (!groups[r.emoji]) groups[r.emoji] = { count: 0, user_ids: [] };
    groups[r.emoji].count++;
    groups[r.emoji].user_ids.push(r.user_id);
  }
  const mentions = (db.prepare('SELECT mentioned_user_id FROM timeline_comment_mentions WHERE comment_id = ?')
    .all(rootId) as { mentioned_user_id: string }[]).map(x => x.mentioned_user_id);
  return {
    root,
    replies,
    reactions_summary: Object.entries(groups).map(([emoji, v]) => ({ emoji, count: v.count, user_ids: v.user_ids })),
    mentions,
  };
}

// ---------- mentions ----------
export function listMentionsForUser(userId: string, limit = 100): { mention: TimelineMention; comment: TimelineComment }[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM timeline_comment_mentions WHERE mentioned_user_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(userId, Math.min(Math.max(limit, 1), 500)) as TimelineMention[];
  const out: { mention: TimelineMention; comment: TimelineComment }[] = [];
  for (const m of rows) {
    const c = getComment(m.comment_id);
    if (c) out.push({ mention: m, comment: c });
  }
  return out;
}

// ---------- reactions ----------
export function addReaction(commentId: string, userId: string, emoji: string): TimelineReaction {
  if (!emoji || emoji.length > 32) throw new Error('invalid_emoji');
  const c = getComment(commentId);
  if (!c) throw new Error('comment_not_found');
  const db = getDb();
  const existing = db.prepare('SELECT * FROM timeline_comment_reactions WHERE comment_id = ? AND user_id = ? AND emoji = ?')
    .get(commentId, userId, emoji) as TimelineReaction | undefined;
  if (existing) return existing;
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO timeline_comment_reactions (id, comment_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, commentId, userId, emoji, now);
  return db.prepare('SELECT * FROM timeline_comment_reactions WHERE id = ?').get(id) as TimelineReaction;
}

export function removeReaction(commentId: string, userId: string, emoji: string): boolean {
  return getDb().prepare('DELETE FROM timeline_comment_reactions WHERE comment_id = ? AND user_id = ? AND emoji = ?')
    .run(commentId, userId, emoji).changes > 0;
}

export function listReactions(commentId: string): TimelineReaction[] {
  return getDb().prepare('SELECT * FROM timeline_comment_reactions WHERE comment_id = ? ORDER BY created_at')
    .all(commentId) as TimelineReaction[];
}

// ---------- stats ----------
export interface TimelineCommentStats {
  total_comments: number;
  top_level: number;
  replies: number;
  resolved: number;
  unresolved: number;
  with_clip: number;
  with_project: number;
  total_reactions: number;
  total_mentions: number;
  by_video: { video_id: string; count: number }[];
}

export function getTimelineCommentStats(): TimelineCommentStats {
  const db = getDb();
  const rows = db.prepare('SELECT parent_id, resolved, clip_id, project_id, video_id FROM timeline_comments')
    .all() as { parent_id: string | null; resolved: number; clip_id: string | null; project_id: string | null; video_id: string }[];
  let top = 0, replies = 0, resolved = 0, withClip = 0, withProj = 0;
  const byVideo: Record<string, number> = {};
  for (const r of rows) {
    if (r.parent_id) replies++; else top++;
    if (r.resolved) resolved++;
    if (r.clip_id) withClip++;
    if (r.project_id) withProj++;
    byVideo[r.video_id] = (byVideo[r.video_id] ?? 0) + 1;
  }
  const reactions = db.prepare('SELECT COUNT(*) AS c FROM timeline_comment_reactions').get() as { c: number };
  const mentions = db.prepare('SELECT COUNT(*) AS c FROM timeline_comment_mentions').get() as { c: number };
  const sorted = Object.entries(byVideo).sort((a, b) => b[1] - a[1]).slice(0, 20)
    .map(([video_id, count]) => ({ video_id, count }));
  return {
    total_comments: rows.length,
    top_level: top,
    replies,
    resolved,
    unresolved: rows.length - resolved,
    with_clip: withClip,
    with_project: withProj,
    total_reactions: reactions.c,
    total_mentions: mentions.c,
    by_video: sorted,
  };
}
