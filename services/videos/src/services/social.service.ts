// melodyflix videos — Social Features (Section 22)
// 22.1 Friend/Following  22.2 Direct Message  22.3 Activity Feed
// 22.4 Badges & Achievements  22.5 Leaderboard
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type FollowStatus = 'pending' | 'accepted' | 'blocked';
export type BadgeTier = 'bronze' | 'silver' | 'gold' | 'platinum';
export type ActivityKind =
  | 'video_upload' | 'subscription' | 'follow' | 'comment'
  | 'like' | 'badge_earned' | 'milestone' | 'community_post'
  | 'event_created' | 'tip_received';

export interface Follow {
  id: string;
  follower_id: string;
  following_id: string;
  status: FollowStatus;
  created_at: string;
  accepted_at: string | null;
}

export interface DirectMessage {
  id: string;
  thread_id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  is_read: number;
  read_at: string | null;
  created_at: string;
}

export interface ActivityItem {
  id: string;
  actor_id: string;
  kind: ActivityKind;
  object_type: string | null;
  object_id: string | null;
  summary: string;
  visibility: 'public' | 'followers' | 'private';
  created_at: string;
}

export interface Badge {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  tier: BadgeTier;
  points: number;
  is_active: number;
  created_at: string;
}

export interface UserBadge {
  user_id: string;
  badge_id: string;
  awarded_at: string;
  awarded_by: string | null;
  note: string | null;
}

export function ensureSocialSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS follows (
      id TEXT PRIMARY KEY,
      follower_id TEXT NOT NULL,
      following_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'accepted',
      created_at TEXT NOT NULL,
      accepted_at TEXT,
      UNIQUE (follower_id, following_id)
    );
    CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id, status);
    CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id, status);

    CREATE TABLE IF NOT EXISTS dm_threads (
      id TEXT PRIMARY KEY,
      user_a TEXT NOT NULL,
      user_b TEXT NOT NULL,
      last_message_at TEXT,
      last_message_preview TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (user_a, user_b)
    );
    CREATE INDEX IF NOT EXISTS idx_dm_thread_a ON dm_threads(user_a, last_message_at);
    CREATE INDEX IF NOT EXISTS idx_dm_thread_b ON dm_threads(user_b, last_message_at);

    CREATE TABLE IF NOT EXISTS direct_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      body TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      read_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dm_thread ON direct_messages(thread_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_dm_recipient_unread ON direct_messages(recipient_id, is_read);

    CREATE TABLE IF NOT EXISTS activity_feed (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      object_type TEXT,
      object_id TEXT,
      summary TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'public',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_activity_actor ON activity_feed(actor_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_feed(created_at DESC);

    CREATE TABLE IF NOT EXISTS badges (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '',
      tier TEXT NOT NULL DEFAULT 'bronze',
      points INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_badges_tier ON badges(tier, points);

    CREATE TABLE IF NOT EXISTS user_badges (
      user_id TEXT NOT NULL,
      badge_id TEXT NOT NULL,
      awarded_at TEXT NOT NULL,
      awarded_by TEXT,
      note TEXT,
      PRIMARY KEY (user_id, badge_id)
    );
    CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id, awarded_at DESC);

    CREATE TABLE IF NOT EXISTS user_scores (
      user_id TEXT PRIMARY KEY,
      total_points INTEGER NOT NULL DEFAULT 0,
      badge_count INTEGER NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_scores_rank ON user_scores(total_points DESC);
  `);

  // Seed default badges (idempotent)
  const now = new Date().toISOString();
  const defaults: Array<Omit<Badge, 'id' | 'created_at'>> = [
    { slug: 'first_upload', name: 'First Upload', description: 'Uploaded your first video', icon: '🎬', tier: 'bronze', points: 10, is_active: 1 },
    { slug: 'first_100_subs', name: 'First 100 Subscribers', description: 'Reached 100 subscribers', icon: '💯', tier: 'bronze', points: 50, is_active: 1 },
    { slug: 'community_helper', name: 'Community Helper', description: 'Helped 10 community members', icon: '🤝', tier: 'silver', points: 100, is_active: 1 },
    { slug: 'top_creator', name: 'Top Creator', description: 'Ranked top 10 creators this month', icon: '🏆', tier: 'gold', points: 500, is_active: 1 },
    { slug: 'veteran', name: 'Veteran', description: 'Active for 1 year', icon: '⭐', tier: 'platinum', points: 1000, is_active: 1 },
  ];
  const ins = db.prepare(`
    INSERT OR IGNORE INTO badges (id, slug, name, description, icon, tier, points, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const b of defaults) {
    ins.run(randomUUID(), b.slug, b.name, b.description, b.icon, b.tier, b.points, b.is_active, now);
  }
}

// ============================================================
// 22.1 — Friend / Following System
// ============================================================

export function followUser(followerId: string, followingId: string, requireApproval = false): Follow {
  if (followerId === followingId) throw new Error('Cannot follow yourself');
  const db = getDb();
  const existing = db.prepare(
    'SELECT * FROM follows WHERE follower_id = ? AND following_id = ?'
  ).get(followerId, followingId) as Follow | undefined;
  if (existing) {
    if (existing.status === 'blocked') throw new Error('Blocked');
    return existing;
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  const status: FollowStatus = requireApproval ? 'pending' : 'accepted';
  db.prepare(
    'INSERT INTO follows (id, follower_id, following_id, status, created_at, accepted_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, followerId, followingId, status, now, status === 'accepted' ? now : null);
  return getFollow(id)!;
}

export function getFollow(id: string): Follow | null {
  return (getDb().prepare('SELECT * FROM follows WHERE id = ?').get(id) as Follow | undefined) ?? null;
}

export function unfollowUser(followerId: string, followingId: string): boolean {
  const info = getDb().prepare(
    'DELETE FROM follows WHERE follower_id = ? AND following_id = ?'
  ).run(followerId, followingId);
  return Number(info.changes ?? 0) > 0;
}

export function acceptFollow(followerId: string, followingId: string): Follow | null {
  const db = getDb();
  const now = new Date().toISOString();
  const info = db.prepare(
    "UPDATE follows SET status = 'accepted', accepted_at = ? WHERE follower_id = ? AND following_id = ? AND status = 'pending'"
  ).run(now, followerId, followingId);
  if (Number(info.changes ?? 0) === 0) return null;
  return db.prepare('SELECT * FROM follows WHERE follower_id = ? AND following_id = ?')
    .get(followerId, followingId) as Follow;
}

export function blockUser(blockerId: string, blockedId: string): Follow {
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO follows (id, follower_id, following_id, status, created_at, accepted_at)
    VALUES (?, ?, ?, 'blocked', ?, NULL)
    ON CONFLICT(follower_id, following_id) DO UPDATE SET status = 'blocked'
  `).run(id, blockerId, blockedId, now);
  return db.prepare('SELECT * FROM follows WHERE follower_id = ? AND following_id = ?')
    .get(blockerId, blockedId) as Follow;
}

export function listFollowers(userId: string, limit = 100): Follow[] {
  return getDb().prepare(
    "SELECT * FROM follows WHERE following_id = ? AND status = 'accepted' ORDER BY accepted_at DESC LIMIT ?"
  ).all(userId, Math.min(Math.max(limit, 1), 500)) as Follow[];
}

export function listFollowing(userId: string, limit = 100): Follow[] {
  return getDb().prepare(
    "SELECT * FROM follows WHERE follower_id = ? AND status = 'accepted' ORDER BY created_at DESC LIMIT ?"
  ).all(userId, Math.min(Math.max(limit, 1), 500)) as Follow[];
}

export interface FollowCounts {
  user_id: string;
  followers: number;
  following: number;
  pending_requests: number;
}

export function getFollowCounts(userId: string): FollowCounts {
  const db = getDb();
  const followers = (db.prepare(
    "SELECT COUNT(*) as n FROM follows WHERE following_id = ? AND status = 'accepted'"
  ).get(userId) as { n: number }).n;
  const following = (db.prepare(
    "SELECT COUNT(*) as n FROM follows WHERE follower_id = ? AND status = 'accepted'"
  ).get(userId) as { n: number }).n;
  const pending = (db.prepare(
    "SELECT COUNT(*) as n FROM follows WHERE following_id = ? AND status = 'pending'"
  ).get(userId) as { n: number }).n;
  return { user_id: userId, followers, following, pending_requests: pending };
}

// ============================================================
// 22.2 — Direct Message
// ============================================================

function threadKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function getOrCreateThread(userA: string, userB: string): { id: string; user_a: string; user_b: string } {
  if (userA === userB) throw new Error('Cannot DM yourself');
  const [a, b] = threadKey(userA, userB);
  const db = getDb();
  let row = db.prepare('SELECT id, user_a, user_b FROM dm_threads WHERE user_a = ? AND user_b = ?')
    .get(a, b) as { id: string; user_a: string; user_b: string } | undefined;
  if (row) return row;
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO dm_threads (id, user_a, user_b, last_message_at, last_message_preview, created_at) VALUES (?, ?, ?, NULL, NULL, ?)'
  ).run(id, a, b, now);
  return { id, user_a: a, user_b: b };
}

export function sendDirectMessage(senderId: string, recipientId: string, body: string): DirectMessage {
  const clean = (body ?? '').trim();
  if (clean.length < 1 || clean.length > 5000) throw new Error('body must be 1-5000 chars');

  const db = getDb();
  // Block check
  const blocked = db.prepare(
    "SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ? AND status = 'blocked'"
  ).get(recipientId, senderId);
  if (blocked) throw new Error('Recipient has blocked you');

  const thread = getOrCreateThread(senderId, recipientId);
  const id = randomUUID();
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO direct_messages (id, thread_id, sender_id, recipient_id, body, is_read, read_at, created_at)
      VALUES (?, ?, ?, ?, ?, 0, NULL, ?)
    `).run(id, thread.id, senderId, recipientId, clean, now);
    db.prepare(
      'UPDATE dm_threads SET last_message_at = ?, last_message_preview = ? WHERE id = ?'
    ).run(now, clean.slice(0, 120), thread.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  return db.prepare('SELECT * FROM direct_messages WHERE id = ?').get(id) as DirectMessage;
}

export function listMessages(threadId: string, userId: string, limit = 100): DirectMessage[] {
  const db = getDb();
  const thread = db.prepare('SELECT * FROM dm_threads WHERE id = ?').get(threadId) as
    { user_a: string; user_b: string } | undefined;
  if (!thread) throw new Error('Thread not found');
  if (thread.user_a !== userId && thread.user_b !== userId) throw new Error('Not your thread');

  return db.prepare(
    'SELECT * FROM direct_messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT ?'
  ).all(threadId, Math.min(Math.max(limit, 1), 500)) as DirectMessage[];
}

export interface DMThreadSummary {
  thread_id: string;
  other_user_id: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
}

export function listThreads(userId: string, limit = 50): DMThreadSummary[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, user_a, user_b, last_message_at, last_message_preview
    FROM dm_threads
    WHERE user_a = ? OR user_b = ?
    ORDER BY COALESCE(last_message_at, created_at) DESC
    LIMIT ?
  `).all(userId, userId, Math.min(Math.max(limit, 1), 200)) as Array<{
    id: string; user_a: string; user_b: string;
    last_message_at: string | null; last_message_preview: string | null;
  }>;

  return rows.map((r) => {
    const other = r.user_a === userId ? r.user_b : r.user_a;
    const unread = (db.prepare(
      'SELECT COUNT(*) as n FROM direct_messages WHERE thread_id = ? AND recipient_id = ? AND is_read = 0'
    ).get(r.id, userId) as { n: number }).n;
    return {
      thread_id: r.id,
      other_user_id: other,
      last_message_at: r.last_message_at,
      last_message_preview: r.last_message_preview,
      unread_count: unread,
    };
  });
}

export function markThreadRead(threadId: string, userId: string): number {
  const db = getDb();
  const thread = db.prepare('SELECT * FROM dm_threads WHERE id = ?').get(threadId) as
    { user_a: string; user_b: string } | undefined;
  if (!thread) return 0;
  if (thread.user_a !== userId && thread.user_b !== userId) return 0;
  const now = new Date().toISOString();
  const info = db.prepare(
    'UPDATE direct_messages SET is_read = 1, read_at = ? WHERE thread_id = ? AND recipient_id = ? AND is_read = 0'
  ).run(now, threadId, userId);
  return Number(info.changes ?? 0);
}

export function unreadDMCount(userId: string): number {
  return (getDb().prepare(
    'SELECT COUNT(*) as n FROM direct_messages WHERE recipient_id = ? AND is_read = 0'
  ).get(userId) as { n: number }).n;
}

// ============================================================
// 22.3 — Activity Feed
// ============================================================

export function postActivity(input: {
  actor_id: string;
  kind: ActivityKind;
  summary: string;
  object_type?: string | null;
  object_id?: string | null;
  visibility?: 'public' | 'followers' | 'private';
}): ActivityItem {
  const summary = (input.summary ?? '').trim();
  if (summary.length < 1 || summary.length > 500) throw new Error('summary must be 1-500 chars');
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO activity_feed (id, actor_id, kind, object_type, object_id, summary, visibility, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.actor_id, input.kind, input.object_type ?? null, input.object_id ?? null,
    summary, input.visibility ?? 'public', now);
  return db.prepare('SELECT * FROM activity_feed WHERE id = ?').get(id) as ActivityItem;
}

/** Public feed — most recent public activities across the platform. */
export function getPublicFeed(opts: { limit?: number; before?: string } = {}): ActivityItem[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  if (opts.before) {
    return db.prepare(
      "SELECT * FROM activity_feed WHERE visibility = 'public' AND created_at < ? ORDER BY created_at DESC LIMIT ?"
    ).all(opts.before, limit) as ActivityItem[];
  }
  return db.prepare(
    "SELECT * FROM activity_feed WHERE visibility = 'public' ORDER BY created_at DESC LIMIT ?"
  ).all(limit) as ActivityItem[];
}

/** Feed for a user — activities of people they follow + their own. */
export function getUserFeed(userId: string, opts: { limit?: number; before?: string } = {}): ActivityItem[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const followIds = (db.prepare(
    "SELECT following_id FROM follows WHERE follower_id = ? AND status = 'accepted'"
  ).all(userId) as Array<{ following_id: string }>).map((r) => r.following_id);
  const ids = [userId, ...followIds];
  const placeholders = ids.map(() => '?').join(',');
  const params: any[] = [...ids];
  let where = `actor_id IN (${placeholders}) AND visibility IN ('public','followers')`;
  if (opts.before) { where += ' AND created_at < ?'; params.push(opts.before); }
  params.push(limit);
  return db.prepare(
    `SELECT * FROM activity_feed WHERE ${where} ORDER BY created_at DESC LIMIT ?`
  ).all(...params) as ActivityItem[];
}

export function getUserActivities(userId: string, limit = 50): ActivityItem[] {
  return getDb().prepare(
    "SELECT * FROM activity_feed WHERE actor_id = ? AND visibility = 'public' ORDER BY created_at DESC LIMIT ?"
  ).all(userId, Math.min(Math.max(limit, 1), 200)) as ActivityItem[];
}

export function deleteActivity(id: string, actorId: string): boolean {
  const info = getDb().prepare(
    'DELETE FROM activity_feed WHERE id = ? AND actor_id = ?'
  ).run(id, actorId);
  return Number(info.changes ?? 0) > 0;
}

// ============================================================
// 22.4 — Badges & Achievements
// ============================================================

function recalcUserScore(userId: string): void {
  const db = getDb();
  const badgeCount = (db.prepare(
    'SELECT COUNT(*) as n FROM user_badges WHERE user_id = ?'
  ).get(userId) as { n: number }).n;
  const points = (db.prepare(`
    SELECT COALESCE(SUM(b.points), 0) as p FROM user_badges ub
    INNER JOIN badges b ON b.id = ub.badge_id WHERE ub.user_id = ?
  `).get(userId) as { p: number }).p;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO user_scores (user_id, total_points, badge_count, last_updated)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET total_points = excluded.total_points,
      badge_count = excluded.badge_count, last_updated = excluded.last_updated
  `).run(userId, points, badgeCount, now);
}

export function listBadges(): Badge[] {
  return getDb().prepare('SELECT * FROM badges WHERE is_active = 1 ORDER BY points ASC').all() as Badge[];
}

export function getBadge(idOrSlug: string): Badge | null {
  return (getDb().prepare('SELECT * FROM badges WHERE id = ? OR slug = ?').get(idOrSlug, idOrSlug) as Badge | undefined) ?? null;
}

export function awardBadge(userId: string, badgeIdOrSlug: string, awardedBy?: string, note?: string): UserBadge {
  const badge = getBadge(badgeIdOrSlug);
  if (!badge) throw new Error('Badge not found');
  const db = getDb();
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT OR IGNORE INTO user_badges (user_id, badge_id, awarded_at, awarded_by, note)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, badge.id, now, awardedBy ?? null, note ?? null);
    recalcUserScore(userId);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return db.prepare('SELECT * FROM user_badges WHERE user_id = ? AND badge_id = ?')
    .get(userId, badge.id) as UserBadge;
}

export function revokeBadge(userId: string, badgeIdOrSlug: string): boolean {
  const badge = getBadge(badgeIdOrSlug);
  if (!badge) return false;
  const db = getDb();
  const info = db.prepare('DELETE FROM user_badges WHERE user_id = ? AND badge_id = ?').run(userId, badge.id);
  recalcUserScore(userId);
  return Number(info.changes ?? 0) > 0;
}

export interface UserBadgeWithDetails extends UserBadge {
  badge: Badge;
}

export function listUserBadges(userId: string): UserBadgeWithDetails[] {
  const rows = getDb().prepare(`
    SELECT ub.*, b.id AS b_id, b.slug AS b_slug, b.name AS b_name, b.description AS b_description,
           b.icon AS b_icon, b.tier AS b_tier, b.points AS b_points, b.is_active AS b_is_active,
           b.created_at AS b_created_at
    FROM user_badges ub
    INNER JOIN badges b ON b.id = ub.badge_id
    WHERE ub.user_id = ?
    ORDER BY ub.awarded_at DESC
  `).all(userId) as any[];
  return rows.map((r) => ({
    user_id: r.user_id, badge_id: r.badge_id, awarded_at: r.awarded_at,
    awarded_by: r.awarded_by, note: r.note,
    badge: {
      id: r.b_id, slug: r.b_slug, name: r.b_name, description: r.b_description,
      icon: r.b_icon, tier: r.b_tier, points: r.b_points, is_active: r.b_is_active,
      created_at: r.b_created_at,
    },
  }));
}

// ============================================================
// 22.5 — Leaderboard
// ============================================================

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  total_points: number;
  badge_count: number;
}

export function getLeaderboard(limit = 50): LeaderboardEntry[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT user_id, total_points, badge_count FROM user_scores
    ORDER BY total_points DESC, badge_count DESC LIMIT ?
  `).all(Math.min(Math.max(limit, 1), 200)) as Array<{ user_id: string; total_points: number; badge_count: number }>;
  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}

export function getUserRank(userId: string): LeaderboardEntry | null {
  const db = getDb();
  const me = db.prepare('SELECT * FROM user_scores WHERE user_id = ?').get(userId) as
    { total_points: number; badge_count: number } | undefined;
  if (!me) return null;
  const higher = (db.prepare(
    'SELECT COUNT(*) as n FROM user_scores WHERE total_points > ? OR (total_points = ? AND badge_count > ?)'
  ).get(me.total_points, me.total_points, me.badge_count) as { n: number }).n;
  return { rank: higher + 1, user_id: userId, total_points: me.total_points, badge_count: me.badge_count };
}

export function getUserScore(userId: string): { total_points: number; badge_count: number } {
  const row = getDb().prepare('SELECT total_points, badge_count FROM user_scores WHERE user_id = ?')
    .get(userId) as { total_points: number; badge_count: number } | undefined;
  return row ?? { total_points: 0, badge_count: 0 };
}
