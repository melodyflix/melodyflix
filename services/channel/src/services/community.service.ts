// melodyflix channel - community posts
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export interface CommunityPost {
  id: string;
  channel_id: string;
  content: string;
  like_count: number;
  comment_count: number;
  created_at: string;
  updated_at: string;
}

export function ensureCommunitySchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS community_posts (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      content TEXT NOT NULL,
      like_count INTEGER NOT NULL DEFAULT 0,
      comment_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cp_channel ON community_posts(channel_id);
    CREATE INDEX IF NOT EXISTS idx_cp_created ON community_posts(created_at);

    CREATE TABLE IF NOT EXISTS community_post_likes (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (post_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cpl_post ON community_post_likes(post_id);
  `);
}

export function createPost(channelId: string, content: string): CommunityPost {
  const db = getDb();
  const now = new Date().toISOString();
  const post: CommunityPost = {
    id: randomUUID(),
    channel_id: channelId,
    content: content.trim(),
    like_count: 0,
    comment_count: 0,
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO community_posts (id, channel_id, content, like_count, comment_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(post.id, post.channel_id, post.content, post.like_count, post.comment_count, post.created_at, post.updated_at);
  return post;
}

export function getPostById(id: string): CommunityPost | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM community_posts WHERE id = ?').get(id) as CommunityPost | undefined) ?? null;
}

export function listChannelPosts(channelId: string, limit = 20, offset = 0): CommunityPost[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM community_posts
    WHERE channel_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(channelId, limit, offset) as CommunityPost[];
}

export function countChannelPosts(channelId: string): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as n FROM community_posts WHERE channel_id = ?').get(channelId) as { n: number };
  return row.n;
}

export function updatePost(postId: string, channelId: string, content: string): CommunityPost {
  const db = getDb();
  const existing = getPostById(postId);
  if (!existing) throw new Error('Post not found');
  if (existing.channel_id !== channelId) throw new Error('Not authorized');
  const now = new Date().toISOString();
  db.prepare('UPDATE community_posts SET content = ?, updated_at = ? WHERE id = ?')
    .run(content.trim(), now, postId);
  return getPostById(postId)!;
}

export function deletePost(postId: string, channelId: string): void {
  const db = getDb();
  const existing = getPostById(postId);
  if (!existing) throw new Error('Post not found');
  if (existing.channel_id !== channelId) throw new Error('Not authorized');
  db.prepare('DELETE FROM community_post_likes WHERE post_id = ?').run(postId);
  db.prepare('DELETE FROM community_posts WHERE id = ?').run(postId);
}

export function togglePostLike(postId: string, userId: string): { liked: boolean; likeCount: number } {
  const db = getDb();
  const post = getPostById(postId);
  if (!post) throw new Error('Post not found');

  const existing = db.prepare('SELECT id FROM community_post_likes WHERE post_id = ? AND user_id = ?')
    .get(postId, userId) as { id: string } | undefined;

  if (existing) {
    db.prepare('DELETE FROM community_post_likes WHERE id = ?').run(existing.id);
    db.prepare('UPDATE community_posts SET like_count = MAX(like_count - 1, 0) WHERE id = ?').run(postId);
    const updated = getPostById(postId)!;
    return { liked: false, likeCount: updated.like_count };
  } else {
    db.prepare('INSERT INTO community_post_likes (id, post_id, user_id, created_at) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), postId, userId, new Date().toISOString());
    db.prepare('UPDATE community_posts SET like_count = like_count + 1 WHERE id = ?').run(postId);
    const updated = getPostById(postId)!;
    return { liked: true, likeCount: updated.like_count };
  }
}

export function getPostUserReaction(postId: string, userId: string | null): boolean {
  if (!userId) return false;
  const db = getDb();
  const row = db.prepare('SELECT id FROM community_post_likes WHERE post_id = ? AND user_id = ?').get(postId, userId);
  return !!row;
}
