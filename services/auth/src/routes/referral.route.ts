// melodyflix auth - referral routes (27.2)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  getOrCreateCode, getReferralStats, listReferralsByUser,
  getCreditBalance, buildShareLink, REFERRER_REWARD, REFERRED_BONUS,
} from '../services/referral.service.js';

const ApplySchema = z.object({
  code: z.string().min(4).max(20),
});

export async function referralRoutes(app: FastifyInstance) {
  // GET /referrals/me — own code + stats + credits
  app.get('/referrals/me', { preHandler: [requireAuth] }, async (req, reply) => {
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const stats = getReferralStats(userId);
    const credits = getCreditBalance(userId);
    return reply.send({
      success: true,
      data: {
        stats,
        credits,
        reward_info: { referrer: REFERRER_REWARD, referred: REFERRED_BONUS },
      },
    });
  });

  // GET /referrals/me/list — list of referred users
  app.get('/referrals/me/list', { preHandler: [requireAuth] }, async (req, reply) => {
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const q = req.query as { limit?: string };
    const limit = Math.min(Math.max(parseInt(q.limit ?? '100') || 100, 1), 500);
    const referrals = listReferralsByUser(userId, limit);
    return reply.send({ success: true, data: { referrals } });
  });

  // GET /referrals/credits — own credits only
  app.get('/referrals/credits', { preHandler: [requireAuth] }, async (req, reply) => {
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    return reply.send({ success: true, data: getCreditBalance(userId) });
  });

  // POST /referrals/code/regenerate — regenerate own code (drops old one)
  app.post('/referrals/code/regenerate', { preHandler: [requireAuth] }, async (req, reply) => {
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    // Simple: delete existing and recreate (old code becomes invalid)
    const db = (await import('@melodyflix/shared-db')).getDb();
    db.prepare('DELETE FROM referral_codes WHERE user_id = ?').run(userId);
    const fresh = getOrCreateCode(userId);
    return reply.send({ success: true, data: { code: fresh.code } });
  });

  // GET /referrals/share — return full share link (with current origin)
  app.get('/referrals/share', { preHandler: [requireAuth] }, async (req, reply) => {
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const code = getOrCreateCode(userId).code;
    const origin = (req.headers.origin as string) || (req.headers.referer as string) || '';
    const link = buildShareLink(code, origin);
    return reply.send({ success: true, data: { code, link } });
  });
}
