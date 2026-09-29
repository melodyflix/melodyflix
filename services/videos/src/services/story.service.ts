// melodyflix videos - stories service (24-hour ephemeral)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export interface Story {
  id: string;
  user_id: string;
  media_type: 'image' | 'video';
  media_url: string;
  caption: string | null;
  duration_seconds: number;
  view_count: number;
  expires_at: string;
  created_at: string;
}

export function ensureStorySchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      media_type TEXT NOT NULL DEFAULT 'image',
      media_url TEXT NOT NULL,
      caption TEXT,
      duration_seconds REAL NOT NULL DEFAULT 5,
      view_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stories_user ON stories(user_id);
    CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories(expires_at);

    CREATE TABLE IF NOT EXISTS story_views (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL,
      viewer_id TEXT NOT NULL,
      viewed_at TEXT NOT NULL,
      UNIQUE (story_id, viewer_id)
    );
    CREATE INDEX IF NOT EXISTS idx_story_views_story ON story_views(story_id);
  `);
}

// Delete expired stories (call periodically or on every list)
export function cleanupExpiredStories(): number {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db.prepare('DELETE FROM stories WHERE expires_at < ?').run(now);
  return result.changes;
}

export interface CreateStoryInput {
  user_id: string;
  media_type: 'image' | 'video';
  media_url: string;
  caption?: string;
  duration_seconds?: number;
}

export function createStory(input: CreateStoryInput): Story {
  const db = getDb();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
  const story: Story = {
    id: randomUUID(),
    user_id: input.user_id,
    media_type: input.media_type,
    media_url: input.media_url,
    caption: input.caption?.trim() || null,
    duration_seconds: input.media_type === 'video' ? (input.duration_seconds ?? 5) : 5,
    view_count: 0,
    expires_at: expiresAt.toISOString(),
    created_at: now.toISOString(),
  };
  db.prepare(`
    INSERT INTO stories (id, user_id, media_type, media_url, caption, duration_seconds,
      view_count, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    story.id, story.user_id, story.media_type, story.media_url, story.caption,
    story.duration_seconds, story.view_count, story.expires_at, story.created_at
  );
  return story;
}

export function getStoryById(id: string): Story | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM stories WHERE id = ?').get(id) as Story | undefined) ?? null;
}

// Story groups — one entry per user with active stories
export interface StoryGroup {
  user_id: string;
  stories: Story[];
  has_unseen: boolean;
  latest_at: string;
}

export function listStoryGroups(viewerId: string | null): StoryGroup[] {
  cleanupExpiredStories();
  const db = getDb();
  const now = new Date().toISOString();

  const stories = db.prepare(`
    SELECT * FROM stories WHERE expires_at > ? ORDER BY created_at ASC
  `).all(now) as Story[];

  const groups = new Map<string, Story[]>();
  for (const s of stories) {
    if (!groups.has(s.user_id)) groups.set(s.user_id, []);
    groups.get(s.user_id)!.push(s);
  }

  const result: StoryGroup[] = [];
  for (const [userId, list] of groups) {
    let hasUnseen = true;
    if (viewerId) {
      // Check if viewer has seen ALL stories in this group
      const storyIds = list.map((s) => s.id);
      const placeholders = storyIds.map(() => '?').join(',');
      const seenRow = db.prepare(`
        SELECT COUNT(DISTINCT story_id) as n FROM story_views
        WHERE viewer_id = ? AND story_id IN (${placeholders})
      `).get(viewerId, ...storyIds) as { n: number };
      hasUnseen = seenRow.n < list.length;
    }
    result.push({
      user_id: userId,
      stories: list,
      has_unseen: hasUnseen,
      latest_at: list[list.length - 1].created_at,
    });
  }

  // Sort: unseen first, then by latest
  result.sort((a, b) => {
    if (a.has_unseen && !b.has_unseen) return -1;
    if (!a.has_unseen && b.has_unseen) return 1;
    return b.latest_at.localeCompare(a.latest_at);
  });

  return result;
}

export function markStoryViewed(storyId: string, viewerId: string): void {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM story_views WHERE story_id = ? AND viewer_id = ?')
    .get(storyId, viewerId);
  if (existing) return;
  db.prepare('INSERT INTO story_views (id, story_id, viewer_id, viewed_at) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), storyId, viewerId, new Date().toISOString());
  db.prepare('UPDATE stories SET view_count = view_count + 1 WHERE id = ?').run(storyId);
}

export function deleteStory(storyId: string, userId: string): void {
  const db = getDb();
  const story = getStoryById(storyId);
  if (!story) throw new Error('Story not found');
  if (story.user_id !== userId) throw new Error('Not authorized');
  db.prepare('DELETE FROM story_views WHERE story_id = ?').run(storyId);
  db.prepare('DELETE FROM stories WHERE id = ?').run(storyId);
}

export function getStoriesByUser(userId: string): Story[] {
  cleanupExpiredStories();
  const db = getDb();
  const now = new Date().toISOString();
  return db.prepare(`
    SELECT * FROM stories WHERE user_id = ? AND expires_at > ? ORDER BY created_at ASC
  `).all(userId, now) as Story[];
}
