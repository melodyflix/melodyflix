// melodyflix videos - community routes (Section 25)
// 25.1 Forum/Discussion  |  25.2 User Groups  |  25.3 Community Guidelines  |  25.4 User Reputation
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, verifyJwt, extractBearerToken } from '@melodyflix/shared-auth';
import {
  createForum, getForum, getForumBySlug, listForums, updateForum, deleteForum,
  createThread, getThread, listThreads, updateThread, deleteThread,
  createPost, getPost, listPosts, deletePost, hidePost,
  createGroup, getGroup, getGroupBySlug, listGroups,
  joinGroup, approveMember, leaveGroup, banMember, listMembers, isMember,
  getGuidelines, publishGuidelines, acceptGuidelines, hasAcceptedGuidelines,
  getReputation, adjustReputation, listReputationEvents, listTopContributors,
  getCommunitySummary,
} from '../services/community.service.js';

function optionalUser(authorization: string | undefined) {
  const token = extractBearerToken(authorization);
  if (!token) return null;
  try { return verifyJwt(token); } catch { return null; }
}

const CreateForumSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(100),
  description: z.string().max(1000).optional(),
  channel_id: z.string().uuid().nullable().optional(),
  is_public: z.boolean().optional(),
});

const UpdateForumSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(1000).optional(),
  is_public: z.boolean().optional(),
  is_locked: z.boolean().optional(),
});

export async function communityRoutes(app: FastifyInstance) {
  // ============================================================
  // 25.1 Forum / Discussion
  // ============================================================

  // POST /forums
  app.post('/forums', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = CreateForumSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const forum = createForum({ owner_id: userId, ...parsed.data });
      return reply.code(201).send({ success: true, data: forum });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /forums?owner_id=&channel_id=&public_only=&limit=
  app.get('/forums', async (req, reply) => {
    const q = req.query as { owner_id?: string; channel_id?: string; public_only?: string; limit?: string };
    const forums = listForums({
      owner_id: q.owner_id,
      channel_id: q.channel_id,
      public_only: q.public_only === 'true',
      limit: q.limit ? Math.min(Math.max(parseInt(q.limit) || 20, 1), 100) : undefined,
    });
    return reply.send({ success: true, data: { forums } });
  });

  // GET /forums/:id
  app.get('/forums/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const forum = getForum(id);
    if (!forum) return reply.code(404).send({ success: false, error: 'Forum not found' });
    return reply.send({ success: true, data: forum });
  });

  // GET /forums/slug/:slug
  app.get('/forums/slug/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const forum = getForumBySlug(slug);
    if (!forum) return reply.code(404).send({ success: false, error: 'Forum not found' });
    return reply.send({ success: true, data: forum });
  });

  // PATCH /forums/:id
  app.patch('/forums/:id', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = UpdateForumSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const updated = updateForum(id, userId, parsed.data);
      if (!updated) return reply.code(404).send({ success: false, error: 'Forum not found or not owner' });
      return reply.send({ success: true, data: getForum(id) });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /forums/:id
  app.delete('/forums/:id', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      const ok = deleteForum(id, userId);
      if (!ok) return reply.code(404).send({ success: false, error: 'Forum not found' });
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // 25.1 Threads
  // ============================================================

  const CreateThreadSchema = z.object({
    forum_id: z.string().uuid(),
    title: z.string().min(1).max(200),
    body: z.string().max(20000).nullable().optional(),
  });

  const UpdateThreadSchema = z.object({
    title: z.string().min(1).max(200).optional(),
    body: z.string().max(20000).nullable().optional(),
    is_pinned: z.boolean().optional(),
    is_locked: z.boolean().optional(),
    is_hidden: z.boolean().optional(),
  });

  // POST /threads
  app.post('/threads', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = CreateThreadSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const thread = createThread({ author_id: userId, ...parsed.data });
      return reply.code(201).send({ success: true, data: thread });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /threads/:id
  app.get('/threads/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const thread = getThread(id);
    if (!thread) return reply.code(404).send({ success: false, error: 'Thread not found' });
    return reply.send({ success: true, data: thread });
  });

  // GET /forums/:forumId/threads?include_hidden=&limit=
  app.get('/forums/:forumId/threads', async (req, reply) => {
    const { forumId } = req.params as { forumId: string };
    const q = req.query as { include_hidden?: string; limit?: string };
    const threads = listThreads(forumId, {
      include_hidden: q.include_hidden === 'true',
      limit: q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : undefined,
    });
    return reply.send({ success: true, data: { threads } });
  });

  // PATCH /threads/:id
  app.patch('/threads/:id', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = UpdateThreadSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const updated = updateThread(id, userId, parsed.data);
      if (!updated) return reply.code(404).send({ success: false, error: 'Thread not found' });
      return reply.send({ success: true, data: updated });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /threads/:id
  app.delete('/threads/:id', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      const ok = deleteThread(id, userId);
      if (!ok) return reply.code(404).send({ success: false, error: 'Thread not found' });
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // 25.1 Posts
  // ============================================================

  const CreatePostSchema = z.object({
    thread_id: z.string().uuid(),
    body: z.string().min(1).max(20000),
    parent_post_id: z.string().uuid().nullable().optional(),
  });

  // POST /posts
  app.post('/posts', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = CreatePostSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const post = createPost({ author_id: userId, ...parsed.data });
      return reply.code(201).send({ success: true, data: post });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /posts/:id
  app.get('/posts/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const post = getPost(id);
    if (!post) return reply.code(404).send({ success: false, error: 'Post not found' });
    return reply.send({ success: true, data: post });
  });

  // GET /threads/:threadId/posts?limit=
  app.get('/threads/:threadId/posts', async (req, reply) => {
    const { threadId } = req.params as { threadId: string };
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 200, 1), 500) : 200;
    const posts = listPosts(threadId, limit);
    return reply.send({ success: true, data: { posts } });
  });

  // DELETE /posts/:id
  app.delete('/posts/:id', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      const ok = deletePost(id, userId);
      if (!ok) return reply.code(404).send({ success: false, error: 'Post not found' });
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /posts/:id/hide
  app.post('/posts/:id/hide', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      const ok = hidePost(id, userId);
      if (!ok) return reply.code(404).send({ success: false, error: 'Post not found' });
      return reply.send({ success: true, data: { hidden: true } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // 25.2 User Groups
  // ============================================================

  const CreateGroupSchema = z.object({
    slug: z.string().min(2).max(60),
    name: z.string().min(1).max(120),
    description: z.string().max(2000).nullable().optional(),
    rules: z.string().max(20000).nullable().optional(),
    is_public: z.boolean().optional(),
    require_approval: z.boolean().optional(),
  });

  // POST /groups
  app.post('/groups', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = CreateGroupSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const group = createGroup({ owner_id: userId, ...parsed.data });
      return reply.code(201).send({ success: true, data: group });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /groups?owner_id=&member_id=&public_only=&limit=
  app.get('/groups', async (req, reply) => {
    const q = req.query as { owner_id?: string; member_id?: string; public_only?: string; limit?: string };
    const groups = listGroups({
      owner_id: q.owner_id,
      member_id: q.member_id,
      public_only: q.public_only === 'true',
      limit: q.limit ? Math.min(Math.max(parseInt(q.limit) || 20, 1), 100) : undefined,
    });
    return reply.send({ success: true, data: { groups } });
  });

  // GET /groups/:id
  app.get('/groups/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const group = getGroup(id);
    if (!group) return reply.code(404).send({ success: false, error: 'Group not found' });
    return reply.send({ success: true, data: group });
  });

  // GET /groups/slug/:slug
  app.get('/groups/slug/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const group = getGroupBySlug(slug);
    if (!group) return reply.code(404).send({ success: false, error: 'Group not found' });
    return reply.send({ success: true, data: group });
  });

  // POST /groups/:id/join
  app.post('/groups/:id/join', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      const member = joinGroup(id, userId);
      return reply.send({ success: true, data: member });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /groups/:id/leave
  app.post('/groups/:id/leave', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const ok = leaveGroup(id, userId);
    if (!ok) return reply.code(404).send({ success: false, error: 'Not a member' });
    return reply.send({ success: true, data: { left: true } });
  });

  // POST /groups/:id/approve/:userId  (owner only)
  app.post('/groups/:id/approve/:userId', async (req, reply) => {
    let ownerId: string;
    try { ownerId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id, userId } = req.params as { id: string; userId: string };
    try {
      const member = approveMember(id, ownerId, userId);
      return reply.send({ success: true, data: member });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /groups/:id/ban/:userId  (owner only)
  app.post('/groups/:id/ban/:userId', async (req, reply) => {
    let requesterId: string;
    try { requesterId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id, userId } = req.params as { id: string; userId: string };
    try {
      const ok = banMember(id, requesterId, userId);
      if (!ok) return reply.code(404).send({ success: false, error: 'Member not found' });
      return reply.send({ success: true, data: { banned: true } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /groups/:id/members?limit=
  app.get('/groups/:id/members', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 200, 1), 500) : 200;
    const members = listMembers(id, limit);
    return reply.send({ success: true, data: { members } });
  });

  // GET /groups/:id/is-member
  app.get('/groups/:id/is-member', async (req, reply) => {
    const user = optionalUser(req.headers.authorization);
    if (!user) return reply.send({ success: true, data: { is_member: false } });
    const { id } = req.params as { id: string };
    const ok = isMember(id, user.sub as string);
    return reply.send({ success: true, data: { is_member: ok } });
  });

  // ============================================================
  // 25.3 Community Guidelines
  // ============================================================

  const PublishGuidelinesSchema = z.object({
    summary: z.string().max(5000).nullable().optional(),
    rules: z.array(z.string().min(1).max(500)).min(1).max(50),
  });

  // GET /channels/:channelId/guidelines
  app.get('/channels/:channelId/guidelines', async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const g = getGuidelines(channelId);
    if (!g) return reply.code(404).send({ success: false, error: 'Guidelines not published' });
    return reply.send({ success: true, data: g });
  });

  // POST /channels/:channelId/guidelines  (owner publishes)
  app.post('/channels/:channelId/guidelines', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = PublishGuidelinesSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { channelId } = req.params as { channelId: string };
    try {
      const g = publishGuidelines({ channel_id: channelId, ...parsed.data });
      return reply.send({ success: true, data: g });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /channels/:channelId/guidelines/accept
  app.post('/channels/:channelId/guidelines/accept', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { channelId } = req.params as { channelId: string };
    const ok = acceptGuidelines(channelId, userId);
    if (!ok) return reply.code(404).send({ success: false, error: 'Guidelines not published' });
    return reply.send({ success: true, data: { accepted: true } });
  });

  // GET /channels/:channelId/guidelines/status
  app.get('/channels/:channelId/guidelines/status', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { channelId } = req.params as { channelId: string };
    const status = hasAcceptedGuidelines(channelId, userId);
    return reply.send({ success: true, data: status });
  });

  // ============================================================
  // 25.4 User Reputation
  // ============================================================

  const AdjustReputationSchema = z.object({
    user_id: z.string().uuid(),
    delta: z.number().int().min(-1000).max(1000),
    reason: z.string().min(1).max(200),
    reference_id: z.string().uuid().nullable().optional(),
  });

  // GET /reputation/me
  app.get('/reputation/me', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: getReputation(userId) });
  });

  // GET /reputation/:userId
  app.get('/reputation/:userId', async (req, reply) => {
    const { userId } = req.params as { userId: string };
    return reply.send({ success: true, data: getReputation(userId) });
  });

  // GET /reputation/:userId/events?limit=
  app.get('/reputation/:userId/events', async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    return reply.send({ success: true, data: { events: listReputationEvents(userId, limit) } });
  });

  // GET /reputation/top?limit=
  app.get('/reputation/top/contributors', async (req, reply) => {
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 20, 1), 100) : 20;
    return reply.send({ success: true, data: { contributors: listTopContributors(limit) } });
  });

  // POST /reputation/adjust  (admin only)
  app.post('/reputation/adjust', async (req, reply) => {
    let isAdmin = false;
    try {
      const payload = requireAuth(req.headers.authorization);
      isAdmin = payload.role === 'admin';
    } catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isAdmin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const parsed = AdjustReputationSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const rep = adjustReputation(parsed.data);
      return reply.send({ success: true, data: rep });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // Summary
  // ============================================================

  // GET /summary
  app.get('/summary', async (_req, reply) => {
    return reply.send({ success: true, data: getCommunitySummary() });
  });
}
