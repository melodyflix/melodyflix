// melodyflix videos — Community Management (25.1 Forum/Discussion,
// 25.2 User Groups, 25.3 Community Guidelines, 25.4 User Reputation)

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export function ensureCommunitySchema(): void {
  const db = getDb();
  db.exec(`
    -- 25.1 Forum / discussion board
    CREATE TABLE IF NOT EXISTS community_forums (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      channel_id TEXT,
      slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      description TEXT,
      is_public INTEGER NOT NULL DEFAULT 1,
      is_locked INTEGER NOT NULL DEFAULT 0,
      thread_count INTEGER NOT NULL DEFAULT 0,
      post_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_forums_channel
      ON community_forums(channel_id, is_public);

    CREATE TABLE IF NOT EXISTS community_threads (
      id TEXT PRIMARY KEY,
      forum_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_locked INTEGER NOT NULL DEFAULT 0,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      reply_count INTEGER NOT NULL DEFAULT 0,
      last_activity_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_threads_forum
      ON community_threads(forum_id, is_pinned DESC, last_activity_at DESC);

    CREATE TABLE IF NOT EXISTS community_posts (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      body TEXT NOT NULL,
      parent_post_id TEXT,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_posts_thread
      ON community_posts(thread_id, created_at ASC);

    -- 25.2 User groups (clubs / community spaces)
    CREATE TABLE IF NOT EXISTS community_groups (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      description TEXT,
      rules TEXT,
      is_public INTEGER NOT NULL DEFAULT 1,
      require_approval INTEGER NOT NULL DEFAULT 0,
      member_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_groups_owner
      ON community_groups(owner_id, is_public);

    CREATE TABLE IF NOT EXISTS community_group_members (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member'
        CHECK (role IN ('member','moderator','owner')),
      state TEXT NOT NULL DEFAULT 'active'
        CHECK (state IN ('pending','active','banned')),
      joined_at TEXT NOT NULL,
      PRIMARY KEY (group_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_group_members_user
      ON community_group_members(user_id, state);

    -- 25.3 Community guidelines (per-channel)
    CREATE TABLE IF NOT EXISTS community_guidelines (
      channel_id TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 1,
      summary TEXT,
      rules_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS community_guideline_accepts (
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      accepted_at TEXT NOT NULL,
      PRIMARY KEY (channel_id, user_id)
    );

    -- 25.4 User reputation
    CREATE TABLE IF NOT EXISTS community_reputation (
      user_id TEXT PRIMARY KEY,
      score INTEGER NOT NULL DEFAULT 0,
      level TEXT NOT NULL DEFAULT 'newcomer'
        CHECK (level IN ('newcomer','member','regular','veteran','trusted')),
      helpful_count INTEGER NOT NULL DEFAULT 0,
      report_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reputation_score
      ON community_reputation(score DESC);

    -- Audit for every reputation delta
    CREATE TABLE IF NOT EXISTS community_reputation_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      reference_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reputation_events_user
      ON community_reputation_events(user_id, created_at DESC);
  `);
}

// ============================================================
// 25.1 Forum
// ============================================================

export interface CommunityForum {
  id: string;
  owner_id: string;
  channel_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  is_public: number;
  is_locked: number;
  thread_count: number;
  post_count: number;
  created_at: string;
  updated_at: string;
}

const SLUG_RE = /^[a-z0-9-]{2,60}$/;

export function createForum(input: {
  owner_id: string;
  channel_id?: string | null;
  slug: string;
  name: string;
  description?: string | null;
  is_public?: boolean;
}): CommunityForum {
  const slug = input.slug.toLowerCase().trim();
  if (!SLUG_RE.test(slug)) throw new Error('slug must be 2-60 chars a-z, 0-9, -');
  const name = (input.name ?? '').trim();
  if (name.length < 1 || name.length > 120) throw new Error('name must be 1-120 chars');

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  try {
    db.prepare(`
      INSERT INTO community_forums
        (id, owner_id, channel_id, slug, name, description, is_public, is_locked,
         thread_count, post_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)
    `).run(
      id, input.owner_id, input.channel_id ?? null,
      slug, name, input.description ?? null,
      input.is_public === false ? 0 : 1, now, now,
    );
  } catch (e: any) {
    if (String(e?.message ?? '').includes('UNIQUE')) throw new Error('slug already taken');
    throw e;
  }
  return getForum(id)!;
}

export function getForum(id: string): CommunityForum | null {
  return (getDb().prepare('SELECT * FROM community_forums WHERE id = ?').get(id) as CommunityForum | undefined) ?? null;
}

export function getForumBySlug(slug: string): CommunityForum | null {
  return (getDb().prepare('SELECT * FROM community_forums WHERE slug = ? COLLATE NOCASE').get(slug) as CommunityForum | undefined) ?? null;
}

export function listForums(opts: { owner_id?: string; channel_id?: string; public_only?: boolean; limit?: number } = {}): CommunityForum[] {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];
  if (opts.owner_id) { where.push('owner_id = ?'); params.push(opts.owner_id); }
  if (opts.channel_id) { where.push('channel_id = ?'); params.push(opts.channel_id); }
  if (opts.public_only) where.push('is_public = 1');
  const n = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  params.push(n);
  return db.prepare(`
    SELECT * FROM community_forums
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY name ASC LIMIT ?
  `).all(...params) as CommunityForum[];
}

export function updateForum(id: string, ownerId: string, patch: {
  name?: string; description?: string | null; is_public?: boolean; is_locked?: boolean;
}): CommunityForum | null {
  const f = getForum(id);
  if (!f) return null;
  if (f.owner_id !== ownerId) throw new Error('Not your forum');
  const fields: string[] = [];
  const values: any[] = [];
  if (patch.name !== undefined) { fields.push('name = ?'); values.push(patch.name.trim().slice(0, 120)); }
  if (patch.description !== undefined) { fields.push('description = ?'); values.push(patch.description); }
  if (patch.is_public !== undefined) { fields.push('is_public = ?'); values.push(patch.is_public ? 1 : 0); }
  if (patch.is_locked !== undefined) { fields.push('is_locked = ?'); values.push(patch.is_locked ? 1 : 0); }
  if (fields.length === 0) return f;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  getDb().prepare(`UPDATE community_forums SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getForum(id);
}

export function deleteForum(id: string, ownerId: string): boolean {
  const f = getForum(id);
  if (!f) return false;
  if (f.owner_id !== ownerId) throw new Error('Not your forum');
  const db = getDb();
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM community_posts WHERE thread_id IN (SELECT id FROM community_threads WHERE forum_id = ?)').run(id);
    db.prepare('DELETE FROM community_threads WHERE forum_id = ?').run(id);
    db.prepare('DELETE FROM community_forums WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return true;
}

// ---- Threads ----

export interface CommunityThread {
  id: string;
  forum_id: string;
  author_id: string;
  title: string;
  body: string | null;
  is_pinned: number;
  is_locked: number;
  is_hidden: number;
  reply_count: number;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
}

export function createThread(input: {
  forum_id: string;
  author_id: string;
  title: string;
  body?: string | null;
}): CommunityThread {
  const forum = getForum(input.forum_id);
  if (!forum) throw new Error('Forum not found');
  if (forum.is_locked === 1) throw new Error('Forum is locked');
  const title = (input.title ?? '').trim();
  if (title.length < 1 || title.length > 200) throw new Error('title must be 1-200 chars');

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO community_threads
        (id, forum_id, author_id, title, body, is_pinned, is_locked, is_hidden,
         reply_count, last_activity_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?)
    `).run(id, input.forum_id, input.author_id, title, input.body ?? null, now, now, now);
    db.prepare(`UPDATE community_forums SET thread_count = thread_count + 1, updated_at = ? WHERE id = ?`)
      .run(now, input.forum_id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return getThread(id)!;
}

export function getThread(id: string): CommunityThread | null {
  return (getDb().prepare('SELECT * FROM community_threads WHERE id = ?').get(id) as CommunityThread | undefined) ?? null;
}

export function listThreads(forumId: string, opts: { include_hidden?: boolean; limit?: number } = {}): CommunityThread[] {
  const n = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const where = opts.include_hidden ? 'forum_id = ?' : 'forum_id = ? AND is_hidden = 0';
  return getDb().prepare(`
    SELECT * FROM community_threads WHERE ${where}
    ORDER BY is_pinned DESC, last_activity_at DESC LIMIT ?
  `).all(forumId, n) as CommunityThread[];
}

export function updateThread(id: string, authorId: string, patch: {
  title?: string; body?: string | null; is_pinned?: boolean; is_locked?: boolean; is_hidden?: boolean;
}): CommunityThread | null {
  const t = getThread(id);
  if (!t) return null;
  if (t.author_id !== authorId) throw new Error('Not your thread');
  const fields: string[] = [];
  const values: any[] = [];
  if (patch.title !== undefined) { fields.push('title = ?'); values.push(patch.title.slice(0, 200)); }
  if (patch.body !== undefined) { fields.push('body = ?'); values.push(patch.body); }
  if (patch.is_pinned !== undefined) { fields.push('is_pinned = ?'); values.push(patch.is_pinned ? 1 : 0); }
  if (patch.is_locked !== undefined) { fields.push('is_locked = ?'); values.push(patch.is_locked ? 1 : 0); }
  if (patch.is_hidden !== undefined) { fields.push('is_hidden = ?'); values.push(patch.is_hidden ? 1 : 0); }
  if (fields.length === 0) return t;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  getDb().prepare(`UPDATE community_threads SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getThread(id);
}

export function deleteThread(id: string, requesterId: string): boolean {
  const t = getThread(id);
  if (!t) return false;
  if (t.author_id !== requesterId) throw new Error('Not your thread');
  const db = getDb();
  const forum = getForum(t.forum_id);
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM community_posts WHERE thread_id = ?').run(id);
    db.prepare('DELETE FROM community_threads WHERE id = ?').run(id);
    if (forum) {
      db.prepare(`UPDATE community_forums SET thread_count = MAX(0, thread_count - 1), updated_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), forum.id);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return true;
}

// ---- Posts ----

export interface CommunityPost {
  id: string;
  thread_id: string;
  author_id: string;
  body: string;
  parent_post_id: string | null;
  is_hidden: number;
  is_deleted: number;
  created_at: string;
}

export function createPost(input: {
  thread_id: string;
  author_id: string;
  body: string;
  parent_post_id?: string | null;
}): CommunityPost {
  const thread = getThread(input.thread_id);
  if (!thread) throw new Error('Thread not found');
  if (thread.is_locked === 1) throw new Error('Thread is locked');
  const body = (input.body ?? '').trim();
  if (body.length < 1 || body.length > 20_000) throw new Error('body must be 1-20K chars');
  if (input.parent_post_id) {
    const parent = getDb().prepare('SELECT * FROM community_posts WHERE id = ? AND thread_id = ?')
      .get(input.parent_post_id, input.thread_id);
    if (!parent) throw new Error('Parent post not found in this thread');
  }

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO community_posts
        (id, thread_id, author_id, body, parent_post_id, is_hidden, is_deleted, created_at)
      VALUES (?, ?, ?, ?, ?, 0, 0, ?)
    `).run(id, input.thread_id, input.author_id, body, input.parent_post_id ?? null, now);
    db.prepare(`UPDATE community_threads SET reply_count = reply_count + 1, last_activity_at = ?, updated_at = ? WHERE id = ?`)
      .run(now, now, input.thread_id);
    db.prepare(`UPDATE community_forums SET post_count = post_count + 1, updated_at = ? WHERE id = ?`)
      .run(now, thread.forum_id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return getPost(id)!;
}

export function getPost(id: string): CommunityPost | null {
  return (getDb().prepare('SELECT * FROM community_posts WHERE id = ?').get(id) as CommunityPost | undefined) ?? null;
}

export function listPosts(threadId: string, limit = 200): CommunityPost[] {
  const n = Math.min(Math.max(limit, 1), 500);
  return getDb().prepare(`
    SELECT * FROM community_posts
    WHERE thread_id = ? AND is_hidden = 0 AND is_deleted = 0
    ORDER BY created_at ASC LIMIT ?
  `).all(threadId, n) as CommunityPost[];
}

export function deletePost(id: string, requesterId: string): boolean {
  const p = getPost(id);
  if (!p) return false;
  if (p.author_id !== requesterId) throw new Error('Not your post');
  const db = getDb();
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE community_posts SET is_deleted = 1 WHERE id = ?').run(id);
    db.prepare(`UPDATE community_threads SET reply_count = MAX(0, reply_count - 1), updated_at = ? WHERE id = ?`)
      .run(now, p.thread_id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return true;
}

export function hidePost(id: string, moderatorId: string): boolean {
  const p = getPost(id);
  if (!p) return false;
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare('UPDATE community_posts SET is_hidden = 1 WHERE id = ?').run(id);
  db.prepare(`UPDATE community_threads SET reply_count = MAX(0, reply_count - 1), updated_at = ? WHERE id = ?`)
    .run(now, p.thread_id);
  return true;
}

// ============================================================
// 25.2 User Groups
// ============================================================

export interface CommunityGroup {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  description: string | null;
  rules: string | null;
  is_public: number;
  require_approval: number;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export function createGroup(input: {
  owner_id: string;
  slug: string;
  name: string;
  description?: string | null;
  rules?: string | null;
  is_public?: boolean;
  require_approval?: boolean;
}): CommunityGroup {
  const slug = input.slug.toLowerCase().trim();
  if (!SLUG_RE.test(slug)) throw new Error('slug must be 2-60 chars a-z, 0-9, -');
  const name = (input.name ?? '').trim();
  if (name.length < 1 || name.length > 120) throw new Error('name must be 1-120 chars');

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  try {
    db.prepare(`
      INSERT INTO community_groups
        (id, owner_id, slug, name, description, rules, is_public, require_approval,
         member_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      id, input.owner_id, slug, name,
      input.description ?? null, input.rules ?? null,
      input.is_public === false ? 0 : 1,
      input.require_approval ? 1 : 0,
      now, now,
    );
  } catch (e: any) {
    if (String(e?.message ?? '').includes('UNIQUE')) throw new Error('slug already taken');
    throw e;
  }
  // Auto-join owner as 'owner'
  db.prepare(`
    INSERT INTO community_group_members (group_id, user_id, role, state, joined_at)
    VALUES (?, ?, 'owner', 'active', ?)
  `).run(id, input.owner_id, now);
  db.prepare('UPDATE community_groups SET member_count = 1 WHERE id = ?').run(id);
  return getGroup(id)!;
}

export function getGroup(id: string): CommunityGroup | null {
  return (getDb().prepare('SELECT * FROM community_groups WHERE id = ?').get(id) as CommunityGroup | undefined) ?? null;
}

export function getGroupBySlug(slug: string): CommunityGroup | null {
  return (getDb().prepare('SELECT * FROM community_groups WHERE slug = ? COLLATE NOCASE').get(slug) as CommunityGroup | undefined) ?? null;
}

export function listGroups(opts: { owner_id?: string; member_id?: string; public_only?: boolean; limit?: number } = {}): CommunityGroup[] {
  const db = getDb();
  if (opts.member_id) {
    return db.prepare(`
      SELECT g.* FROM community_groups g
      JOIN community_group_members m ON m.group_id = g.id
      WHERE m.user_id = ? AND m.state = 'active'
      ORDER BY g.name ASC LIMIT ?
    `).all(opts.member_id, Math.min(Math.max(opts.limit ?? 100, 1), 500)) as CommunityGroup[];
  }
  const where: string[] = [];
  const params: any[] = [];
  if (opts.owner_id) { where.push('owner_id = ?'); params.push(opts.owner_id); }
  if (opts.public_only) where.push('is_public = 1');
  const n = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  params.push(n);
  return db.prepare(`
    SELECT * FROM community_groups
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY name ASC LIMIT ?
  `).all(...params) as CommunityGroup[];
}

export interface GroupMember {
  group_id: string;
  user_id: string;
  role: 'member' | 'moderator' | 'owner';
  state: 'pending' | 'active' | 'banned';
  joined_at: string;
}

export function joinGroup(groupId: string, userId: string): GroupMember {
  const g = getGroup(groupId);
  if (!g) throw new Error('Group not found');
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?')
    .get(groupId, userId) as GroupMember | undefined;
  if (existing) {
    if (existing.state === 'banned') throw new Error('You are banned from this group');
    if (existing.state === 'active') return existing;
  }
  const state: 'pending' | 'active' = g.require_approval === 1 ? 'pending' : 'active';
  db.prepare(`
    INSERT INTO community_group_members (group_id, user_id, role, state, joined_at)
    VALUES (?, ?, 'member', ?, ?)
    ON CONFLICT(group_id, user_id) DO UPDATE SET state = excluded.state
  `).run(groupId, userId, state, now);
  if (state === 'active') {
    db.prepare('UPDATE community_groups SET member_count = member_count + 1, updated_at = ? WHERE id = ?')
      .run(now, groupId);
  }
  return db.prepare('SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?')
    .get(groupId, userId) as GroupMember;
}

export function approveMember(groupId: string, ownerId: string, userId: string): GroupMember {
  const g = getGroup(groupId);
  if (!g) throw new Error('Group not found');
  if (g.owner_id !== ownerId) throw new Error('Owner only');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`UPDATE community_group_members SET state = 'active' WHERE group_id = ? AND user_id = ? AND state = 'pending'`)
    .run(groupId, userId);
  db.prepare(`UPDATE community_groups SET member_count = member_count + 1, updated_at = ? WHERE id = ?`)
    .run(now, groupId);
  return db.prepare('SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?')
    .get(groupId, userId) as GroupMember;
}

export function leaveGroup(groupId: string, userId: string): boolean {
  const db = getDb();
  const m = db.prepare('SELECT * FROM community_group_members WHERE group_id = ? AND user_id = ?')
    .get(groupId, userId) as GroupMember | undefined;
  if (!m) return false;
  if (m.role === 'owner') throw new Error('Owner cannot leave — transfer or delete first');
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM community_group_members WHERE group_id = ? AND user_id = ?').run(groupId, userId);
    if (m.state === 'active') {
      db.prepare(`UPDATE community_groups SET member_count = MAX(0, member_count - 1), updated_at = ? WHERE id = ?`)
        .run(now, groupId);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return true;
}

export function banMember(groupId: string, requesterId: string, userId: string): boolean {
  const g = getGroup(groupId);
  if (!g) return false;
  if (g.owner_id !== requesterId) throw new Error('Owner only');
  const db = getDb();
  const r = db.prepare(`UPDATE community_group_members SET state = 'banned' WHERE group_id = ? AND user_id = ?`)
    .run(groupId, userId);
  return r.changes > 0;
}

export function listMembers(groupId: string, limit = 200): GroupMember[] {
  const n = Math.min(Math.max(limit, 1), 500);
  return getDb().prepare(
    'SELECT * FROM community_group_members WHERE group_id = ? ORDER BY joined_at ASC LIMIT ?'
  ).all(groupId, n) as GroupMember[];
}

export function isMember(groupId: string, userId: string): boolean {
  const m = getDb().prepare(
    "SELECT 1 FROM community_group_members WHERE group_id = ? AND user_id = ? AND state = 'active' LIMIT 1"
  ).get(groupId, userId);
  return !!m;
}

// ============================================================
// 25.3 Community Guidelines
// ============================================================

export interface CommunityGuidelines {
  channel_id: string;
  version: number;
  summary: string | null;
  rules_json: string;
  updated_at: string;
}

export function getGuidelines(channelId: string): CommunityGuidelines | null {
  return (getDb().prepare('SELECT * FROM community_guidelines WHERE channel_id = ?')
    .get(channelId) as CommunityGuidelines | undefined) ?? null;
}

export function publishGuidelines(input: {
  channel_id: string;
  summary?: string | null;
  rules: string[];
}): CommunityGuidelines {
  if (!Array.isArray(input.rules) || input.rules.length === 0) {
    throw new Error('At least one rule required');
  }
  const clean = input.rules.map((r) => String(r).trim()).filter(Boolean).slice(0, 50);
  if (clean.some((r) => r.length > 500)) throw new Error('rule must be <= 500 chars');

  const db = getDb();
  const cur = getGuidelines(input.channel_id);
  const nextVersion = (cur?.version ?? 0) + 1;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO community_guidelines (channel_id, version, summary, rules_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET
      version = excluded.version,
      summary = excluded.summary,
      rules_json = excluded.rules_json,
      updated_at = excluded.updated_at
  `).run(input.channel_id, nextVersion, input.summary ?? null, JSON.stringify(clean), now);
  return getGuidelines(input.channel_id)!;
}

export function acceptGuidelines(channelId: string, userId: string): boolean {
  const g = getGuidelines(channelId);
  if (!g) throw new Error('Guidelines not published');
  const db = getDb();
  const now = new Date().toISOString();
  const r = db.prepare(`
    INSERT INTO community_guideline_accepts (channel_id, user_id, version, accepted_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(channel_id, user_id) DO UPDATE SET
      version = excluded.version,
      accepted_at = excluded.accepted_at
  `).run(channelId, userId, g.version, now);
  return r.changes > 0;
}

export function hasAcceptedGuidelines(channelId: string, userId: string): { accepted: boolean; stale: boolean; current_version: number } {
  const g = getGuidelines(channelId);
  if (!g) return { accepted: false, stale: false, current_version: 0 };
  const row = getDb().prepare(
    'SELECT version FROM community_guideline_accepts WHERE channel_id = ? AND user_id = ?'
  ).get(channelId, userId) as { version: number } | undefined;
  if (!row) return { accepted: false, stale: false, current_version: g.version };
  return { accepted: true, stale: row.version < g.version, current_version: g.version };
}

// ============================================================
// 25.4 Reputation
// ============================================================

export type ReputationLevel = 'newcomer' | 'member' | 'regular' | 'veteran' | 'trusted';

export interface Reputation {
  user_id: string;
  score: number;
  level: ReputationLevel;
  helpful_count: number;
  report_count: number;
  updated_at: string;
}

function levelFor(score: number): ReputationLevel {
  if (score >= 500) return 'trusted';
  if (score >= 200) return 'veteran';
  if (score >= 50) return 'regular';
  if (score >= 10) return 'member';
  return 'newcomer';
}

export function getReputation(userId: string): Reputation {
  const row = getDb().prepare('SELECT * FROM community_reputation WHERE user_id = ?')
    .get(userId) as Reputation | undefined;
  if (row) return row;
  return {
    user_id: userId,
    score: 0,
    level: 'newcomer',
    helpful_count: 0,
    report_count: 0,
    updated_at: new Date(0).toISOString(),
  };
}

export function adjustReputation(input: {
  user_id: string;
  delta: number;
  reason: string;
  reference_id?: string | null;
}): Reputation {
  const db = getDb();
  const now = new Date().toISOString();
  const cur = getReputation(input.user_id);
  const nextScore = Math.max(0, Math.min(10_000, cur.score + input.delta));
  const helpfulDelta = input.reason === 'helpful' && input.delta > 0 ? 1 : 0;
  const reportDelta = input.reason === 'reported' ? 1 : 0;

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO community_reputation
        (user_id, score, level, helpful_count, report_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        score = excluded.score,
        level = excluded.level,
        helpful_count = community_reputation.helpful_count + ?,
        report_count = community_reputation.report_count + ?,
        updated_at = excluded.updated_at
    `).run(
      input.user_id, nextScore, levelFor(nextScore),
      helpfulDelta, reportDelta, now,
      helpfulDelta, reportDelta,
    );
    db.prepare(`
      INSERT INTO community_reputation_events
        (id, user_id, delta, reason, reference_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), input.user_id, input.delta, input.reason, input.reference_id ?? null, now);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return getReputation(input.user_id);
}

export function listReputationEvents(userId: string, limit = 50): any[] {
  const n = Math.min(Math.max(limit, 1), 200);
  return getDb().prepare(
    'SELECT * FROM community_reputation_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(userId, n);
}

export function listTopContributors(limit = 20): Reputation[] {
  const n = Math.min(Math.max(limit, 1), 100);
  return getDb().prepare(
    'SELECT * FROM community_reputation ORDER BY score DESC LIMIT ?'
  ).all(n) as Reputation[];
}

// ============================================================
// Summary
// ============================================================

export interface CommunitySummary {
  forums_total: number;
  threads_total: number;
  posts_total: number;
  groups_total: number;
  group_members_total: number;
  reputation_events_last_7d: number;
}

export function getCommunitySummary(): CommunitySummary {
  const db = getDb();
  const f = (db.prepare('SELECT COUNT(*) as n FROM community_forums').get() as { n: number }).n;
  const t = (db.prepare('SELECT COUNT(*) as n FROM community_threads').get() as { n: number }).n;
  const p = (db.prepare('SELECT COUNT(*) as n FROM community_posts').get() as { n: number }).n;
  const g = (db.prepare('SELECT COUNT(*) as n FROM community_groups').get() as { n: number }).n;
  const m = (db.prepare("SELECT COUNT(*) as n FROM community_group_members WHERE state='active'").get() as { n: number }).n;
  const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
  const ev = (db.prepare('SELECT COUNT(*) as n FROM community_reputation_events WHERE created_at >= ?')
    .get(cutoff) as { n: number }).n;
  return {
    forums_total: f, threads_total: t, posts_total: p,
    groups_total: g, group_members_total: m,
    reputation_events_last_7d: ev,
  };
}
