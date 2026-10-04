// melodyflix videos — Social Features routes (Section 22)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  followUser, unfollowUser, acceptFollow, blockUser,
  listFollowers, listFollowing, getFollowCounts,
  sendDirectMessage, listMessages, listThreads, markThreadRead, unreadDMCount,
  postActivity, getPublicFeed, getUserFeed, getUserActivities, deleteActivity,
  listBadges, getBadge, awardBadge, revokeBadge, listUserBadges,
  getLeaderboard, getUserRank, getUserScore,
} from '../services/social.service.js';

const FollowSchema = z.object({
  following_id: z.string().uuid(),
  require_approval: z.boolean().optional(),
});

const DMSchema = z.object({
  recipient_id: z.string().uuid(),
  body: z.string().min(1).max(5000),
});

const ActivitySchema = z.object({
  kind: z.enum(['video_upload', 'subscription', 'follow', 'comment', 'like',
    'badge_earned', 'milestone', 'community_post', 'event_created', 'tip_received']),
  summary: z.string().min(1).max(500),
  object_type: z.string().max(60).nullable().optional(),
  object_id: z.string().uuid().nullable().optional(),
  visibility: z.enum(['public', 'followers', 'private']).optional(),
});

const AwardBadgeSchema = z.object({
  user_id: z.string().uuid(),
  badge: z.string().min(1).max(60),  // id or slug
  note: z.string().max(500).nullable().optional(),
});

export async function socialRoutes(app: FastifyInstance) {
  // ============================================================
  // 22.1 — Friend / Following
  // ============================================================

  // POST /social/follow
  app.post('/social/follow', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = FollowSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const follow = followUser(userId, parsed.data.following_id, parsed.data.require_approval);
      return reply.code(201).send({ success: true, data: follow });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /social/follow/:userId
  app.delete('/social/follow/:userId', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { userId: target } = req.params as { userId: string };
    const ok = unfollowUser(userId, target);
    if (!ok) return reply.code(404).send({ success: false, error: 'Not following' });
    return reply.send({ success: true, data: { unfollowed: true } });
  });

  // POST /social/follow/accept/:followerId
  app.post('/social/follow/accept/:followerId', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { followerId } = req.params as { followerId: string };
    const follow = acceptFollow(followerId, userId);
    if (!follow) return reply.code(404).send({ success: false, error: 'No pending request' });
    return reply.send({ success: true, data: follow });
  });

  // POST /social/block/:userId
  app.post('/social/block/:userId', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { userId: target } = req.params as { userId: string };
    try {
      const f = blockUser(userId, target);
      return reply.send({ success: true, data: f });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /social/followers/:userId?limit=100
  app.get('/social/followers/:userId', async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 100, 1), 500) : 100;
    const followers = listFollowers(userId, limit);
    return reply.send({ success: true, data: { followers } });
  });

  // GET /social/following/:userId?limit=100
  app.get('/social/following/:userId', async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 100, 1), 500) : 100;
    const following = listFollowing(userId, limit);
    return reply.send({ success: true, data: { following } });
  });

  // GET /social/follow-counts/:userId
  app.get('/social/follow-counts/:userId', async (req, reply) => {
    const { userId } = req.params as { userId: string };
    return reply.send({ success: true, data: getFollowCounts(userId) });
  });

  // ============================================================
  // 22.2 — Direct Message
  // ============================================================

  // POST /social/dm
  app.post('/social/dm', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = DMSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const msg = sendDirectMessage(userId, parsed.data.recipient_id, parsed.data.body);
      return reply.code(201).send({ success: true, data: msg });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /social/dm/threads
  app.get('/social/dm/threads', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    const threads = listThreads(userId, limit);
    return reply.send({ success: true, data: { threads } });
  });

  // GET /social/dm/thread/:threadId?limit=100
  app.get('/social/dm/thread/:threadId', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { threadId } = req.params as { threadId: string };
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 100, 1), 500) : 100;
    try {
      const messages = listMessages(threadId, userId, limit);
      return reply.send({ success: true, data: { messages } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /social/dm/thread/:threadId/read
  app.post('/social/dm/thread/:threadId/read', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { threadId } = req.params as { threadId: string };
    const count = markThreadRead(threadId, userId);
    return reply.send({ success: true, data: { marked_read: count } });
  });

  // GET /social/dm/unread-count
  app.get('/social/dm/unread-count', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: { unread: unreadDMCount(userId) } });
  });

  // ============================================================
  // 22.3 — Activity Feed
  // ============================================================

  // POST /social/activity
  app.post('/social/activity', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = ActivitySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const activity = postActivity({ actor_id: userId, ...parsed.data });
      return reply.code(201).send({ success: true, data: activity });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /social/activity/public?limit=&before=
  app.get('/social/activity/public', async (req, reply) => {
    const q = req.query as { limit?: string; before?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    const feed = getPublicFeed({ limit, before: q.before });
    return reply.send({ success: true, data: { feed } });
  });

  // GET /social/activity/feed?limit=&before=
  app.get('/social/activity/feed', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { limit?: string; before?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    const feed = getUserFeed(userId, { limit, before: q.before });
    return reply.send({ success: true, data: { feed } });
  });

  // GET /social/activity/user/:userId?limit=50
  app.get('/social/activity/user/:userId', async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    const activities = getUserActivities(userId, limit);
    return reply.send({ success: true, data: { activities } });
  });

  // DELETE /social/activity/:id
  app.delete('/social/activity/:id', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const ok = deleteActivity(id, userId);
    if (!ok) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // ============================================================
  // 22.4 — Badges & Achievements
  // ============================================================

  // GET /social/badges — list all available
  app.get('/social/badges', async (_req, reply) => {
    return reply.send({ success: true, data: { badges: listBadges() } });
  });

  // GET /social/badges/:idOrSlug
  app.get('/social/badges/:idOrSlug', async (req, reply) => {
    const { idOrSlug } = req.params as { idOrSlug: string };
    const badge = getBadge(idOrSlug);
    if (!badge) return reply.code(404).send({ success: false, error: 'Badge not found' });
    return reply.send({ success: true, data: badge });
  });

  // GET /social/badges/user/:userId — badges awarded to a user
  app.get('/social/badges/user/:userId', async (req, reply) => {
    const { userId } = req.params as { userId: string };
    return reply.send({ success: true, data: { badges: listUserBadges(userId) } });
  });

  // POST /social/badges/award  (admin-only)
  app.post('/social/badges/award', async (req, reply) => {
    let isAdmin = false;
    let adminId: string;
    try {
      const payload = requireAuth(req.headers.authorization);
      adminId = payload.sub as string;
      isAdmin = payload.role === 'admin';
    } catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isAdmin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const parsed = AwardBadgeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const ub = awardBadge(parsed.data.user_id, parsed.data.badge, adminId, parsed.data.note ?? undefined);
      return reply.code(201).send({ success: true, data: ub });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /social/badges/:userId/:badgeIdOrSlug  (admin-only)
  app.delete('/social/badges/:userId/:badgeIdOrSlug', async (req, reply) => {
    let isAdmin = false;
    try {
      const payload = requireAuth(req.headers.authorization);
      isAdmin = payload.role === 'admin';
    } catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isAdmin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { userId, badgeIdOrSlug } = req.params as { userId: string; badgeIdOrSlug: string };
    const ok = revokeBadge(userId, badgeIdOrSlug);
    if (!ok) return reply.code(404).send({ success: false, error: 'Badge not awarded' });
    return reply.send({ success: true, data: { revoked: true } });
  });

  // ============================================================
  // 22.5 — Leaderboard
  // ============================================================

  // GET /social/leaderboard?limit=50
  app.get('/social/leaderboard', async (req, reply) => {
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    const leaderboard = getLeaderboard(limit);
    return reply.send({ success: true, data: { leaderboard } });
  });

  // GET /social/leaderboard/me
  app.get('/social/leaderboard/me', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const rank = getUserRank(userId);
    const score = getUserScore(userId);
    return reply.send({ success: true, data: { rank, score } });
  });

  // GET /social/leaderboard/user/:userId
  app.get('/social/leaderboard/user/:userId', async (req, reply) => {
    const { userId } = req.params as { userId: string };
    return reply.send({ success: true, data: getUserRank(userId) });
  });
}
