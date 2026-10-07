// melodyflix videos - Section 36 Gamification routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '@melodyflix/shared-auth';
import {
  awardPoints, getBalance, listPointsHistory, getLeaderboard,
  createChallenge, listChallenges, getChallenge, getChallengeBySlug,
  joinChallenge, recordProgress, claimChallenge, listUserChallenges,
  createReward, listRewards, getReward, redeemReward,
  fulfillRedemption, cancelRedemption, listUserRedemptions,
  recordStreakEvent, getUserStreaks, getStreak,
  getGamificationStats,
} from '../services/gamification.service.js';

const POINT_SOURCES = ['watch','like','comment','share','upload','challenge','streak','bonus','admin','redeem','refund'] as const;
const CHALLENGE_KINDS = ['watch_minutes','watch_videos','like_count','comment_count','share_count','upload_count','streak_days','custom'] as const;
const REWARD_KINDS = ['badge','premium_days','gift_card','custom'] as const;
const STREAK_KINDS = ['daily_watch','daily_login','weekly_upload'] as const;

const AwardSchema = z.object({
  user_id: z.string().min(1).max(100),
  delta: z.number().int().min(-1_000_000).max(1_000_000),
  source: z.enum(POINT_SOURCES),
  ref_type: z.string().max(50).nullable().optional(),
  ref_id: z.string().max(100).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

const CreateChallengeSchema = z.object({
  slug: z.string().min(3).max(80),
  title: z.string().min(3).max(200),
  description: z.string().max(2000).nullable().optional(),
  kind: z.enum(CHALLENGE_KINDS),
  target_value: z.number().int().min(1).max(1_000_000),
  reward_points: z.number().int().min(0).max(1_000_000).optional(),
  reward_badge_slug: z.string().max(80).nullable().optional(),
  starts_at: z.string().datetime().optional(),
  ends_at: z.string().datetime().nullable().optional(),
});

const ProgressSchema = z.object({
  challenge_id: z.string().max(100).optional(),
  slug: z.string().max(80).optional(),
  delta: z.number().int().min(0).max(1_000_000),
}).refine(d => d.challenge_id || d.slug, { message: 'challenge_id or slug required' });

const CreateRewardSchema = z.object({
  slug: z.string().min(3).max(80),
  title: z.string().min(3).max(200),
  description: z.string().max(2000).nullable().optional(),
  kind: z.enum(REWARD_KINDS),
  cost_points: z.number().int().min(1).max(10_000_000),
  stock: z.number().int().min(0).max(1_000_000).nullable().optional(),
  payload: z.record(z.string(), z.unknown()).nullable().optional(),
});

const StreakSchema = z.object({
  kind: z.enum(STREAK_KINDS),
});

function authPayload(auth: string | undefined): { sub: string; role: string } | null {
  try {
    const p = requireAuth(auth);
    return { sub: p.sub as string, role: (p.role as string) ?? 'user' };
  } catch { return null; }
}

function requireAdmin(auth: string | undefined): boolean {
  try { requireRole(auth, ['admin']); return true; } catch { return false; }
}

export async function gamificationRoutes(app: FastifyInstance): Promise<void> {
  // ============ 36.1 POINTS ============

  // GET /gamification/me/points
  app.get('/gamification/me/points', async (req, reply) => {
    const u = authPayload(req.headers.authorization);
    if (!u) return reply.code(401).send({ success: false, error: 'unauthorized' });
    return reply.send({ success: true, data: { balance: getBalance(u.sub) } });
  });

  // GET /gamification/me/points/history
  app.get('/gamification/me/points/history', async (req, reply) => {
    const u = authPayload(req.headers.authorization);
    if (!u) return reply.code(401).send({ success: false, error: 'unauthorized' });
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(Number(q.limit), 1), 500) : 100;
    return reply.send({ success: true, data: { history: listPointsHistory(u.sub, limit) } });
  });

  // GET /gamification/leaderboard?limit=50
  app.get('/gamification/leaderboard', async (req, reply) => {
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(Number(q.limit), 1), 500) : 50;
    return reply.send({ success: true, data: { leaderboard: getLeaderboard(limit) } });
  });

  // POST /gamification/points/award (admin only)
  app.post('/gamification/points/award', async (req, reply) => {
    if (!requireAdmin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = AwardSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try {
      const entry = awardPoints(p.data);
      return reply.code(201).send({ success: true, data: entry });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============ 36.2 CHALLENGES ============

  // POST /gamification/challenges (admin)
  app.post('/gamification/challenges', async (req, reply) => {
    if (!requireAdmin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = CreateChallengeSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try {
      const c = createChallenge(p.data, null);
      return reply.code(201).send({ success: true, data: c });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /gamification/challenges
  app.get('/gamification/challenges', async (req, reply) => {
    const q = req.query as { status?: string; limit?: string };
    const limit = q.limit ? Math.min(Math.max(Number(q.limit), 1), 200) : 50;
    const status = q.status as any;
    return reply.send({ success: true, data: { challenges: listChallenges({ status, limit }) } });
  });

  // GET /gamification/challenges/:idOrSlug
  app.get('/gamification/challenges/:idOrSlug', async (req, reply) => {
    const { idOrSlug } = req.params as { idOrSlug: string };
    const c = getChallenge(idOrSlug) ?? getChallengeBySlug(idOrSlug);
    if (!c) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: c });
  });

  // POST /gamification/challenges/:id/join
  app.post('/gamification/challenges/:id/join', async (req, reply) => {
    const u = authPayload(req.headers.authorization);
    if (!u) return reply.code(401).send({ success: false, error: 'unauthorized' });
    const { id } = req.params as { id: string };
    const c = getChallenge(id) ?? getChallengeBySlug(id);
    if (!c) return reply.code(404).send({ success: false, error: 'not_found' });
    try {
      return reply.code(201).send({ success: true, data: joinChallenge(u.sub, c.id) });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /gamification/challenges/progress
  app.post('/gamification/challenges/progress', async (req, reply) => {
    const u = authPayload(req.headers.authorization);
    if (!u) return reply.code(401).send({ success: false, error: 'unauthorized' });
    const p = ProgressSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try {
      const uc = recordProgress({ user_id: u.sub, ...p.data });
      return reply.send({ success: true, data: uc });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /gamification/challenges/:id/claim
  app.post('/gamification/challenges/:id/claim', async (req, reply) => {
    const u = authPayload(req.headers.authorization);
    if (!u) return reply.code(401).send({ success: false, error: 'unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const result = claimChallenge(u.sub, id);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /gamification/me/challenges
  app.get('/gamification/me/challenges', async (req, reply) => {
    const u = authPayload(req.headers.authorization);
    if (!u) return reply.code(401).send({ success: false, error: 'unauthorized' });
    const q = req.query as { status?: string };
    return reply.send({ success: true, data: { challenges: listUserChallenges(u.sub, q.status as any) } });
  });

  // ============ 36.3 REWARDS ============

  // POST /gamification/rewards (admin)
  app.post('/gamification/rewards', async (req, reply) => {
    if (!requireAdmin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = CreateRewardSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try {
      const r = createReward(p.data);
      return reply.code(201).send({ success: true, data: r });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /gamification/rewards
  app.get('/gamification/rewards', async (req, reply) => {
    const q = req.query as { all?: string };
    return reply.send({ success: true, data: { rewards: listRewards(q.all !== 'true') } });
  });

  // POST /gamification/rewards/:id/redeem
  app.post('/gamification/rewards/:id/redeem', async (req, reply) => {
    const u = authPayload(req.headers.authorization);
    if (!u) return reply.code(401).send({ success: false, error: 'unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const redemption = redeemReward(u.sub, id);
      return reply.code(201).send({ success: true, data: redemption });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /gamification/me/redemptions
  app.get('/gamification/me/redemptions', async (req, reply) => {
    const u = authPayload(req.headers.authorization);
    if (!u) return reply.code(401).send({ success: false, error: 'unauthorized' });
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(Number(q.limit), 1), 200) : 50;
    return reply.send({ success: true, data: { redemptions: listUserRedemptions(u.sub, limit) } });
  });

  // POST /gamification/redemptions/:id/fulfill (admin)
  app.post('/gamification/redemptions/:id/fulfill', async (req, reply) => {
    if (!requireAdmin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { note?: string };
    const r = fulfillRedemption(id, body.note ?? null);
    if (!r) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: r });
  });

  // POST /gamification/redemptions/:id/cancel (admin)
  app.post('/gamification/redemptions/:id/cancel', async (req, reply) => {
    if (!requireAdmin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { refund?: boolean };
    const r = cancelRedemption(id, body.refund !== false);
    if (!r) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: r });
  });

  // ============ 36.4 STREAKS ============

  // POST /gamification/streak/event
  app.post('/gamification/streak/event', async (req, reply) => {
    const u = authPayload(req.headers.authorization);
    if (!u) return reply.code(401).send({ success: false, error: 'unauthorized' });
    const p = StreakSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body' });
    const r = recordStreakEvent(u.sub, p.data.kind);
    return reply.send({ success: true, data: r });
  });

  // GET /gamification/me/streaks
  app.get('/gamification/me/streaks', async (req, reply) => {
    const u = authPayload(req.headers.authorization);
    if (!u) return reply.code(401).send({ success: false, error: 'unauthorized' });
    return reply.send({ success: true, data: { streaks: getUserStreaks(u.sub) } });
  });

  // GET /gamification/me/streaks/:kind
  app.get('/gamification/me/streaks/:kind', async (req, reply) => {
    const u = authPayload(req.headers.authorization);
    if (!u) return reply.code(401).send({ success: false, error: 'unauthorized' });
    const { kind } = req.params as { kind: string };
    const s = getStreak(u.sub, kind as any);
    if (!s) return reply.code(404).send({ success: false, error: 'no_streak' });
    return reply.send({ success: true, data: s });
  });

  // ============ STATS ============

  // GET /gamification/stats (admin)
  app.get('/gamification/stats', async (req, reply) => {
    if (!requireAdmin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getGamificationStats() });
  });
}
