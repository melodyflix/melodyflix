// melodyflix auth - influencer routes (27.3)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  TIERS, isInfluencer, getInfluencer, markInfluencer, unmarkInfluencer,
  updateTier, getMetrics, listInfluencers, findCandidates,
} from '../services/influencer.service.js';

const MarkSchema = z.object({
  tier: z.enum(['bronze', 'silver', 'gold', 'platinum']).optional(),
  notes: z.string().max(500).nullable().optional(),
});

const TierSchema = z.object({
  tier: z.enum(['bronze', 'silver', 'gold', 'platinum']),
});

function requireAdmin(auth: string | undefined): { id: string } | null {
  try {
    const p = requireAuth(auth);
    if (p.role !== 'admin') return null;
    return { id: p.sub as string };
  } catch { return null; }
}

function requireUser(auth: string | undefined): { id: string } | null {
  try {
    const p = requireAuth(auth);
    return { id: p.sub as string };
  } catch { return null; }
}

export async function influencerRoutes(app: FastifyInstance) {
  // GET /influencers/tiers — public list of tier definitions
  app.get('/influencers/tiers', async (_req, reply) => {
    return reply.send({ success: true, data: { tiers: TIERS } });
  });

  // GET /influencers/me — own dashboard (if user is influencer; else 404)
  app.get('/influencers/me', async (req, reply) => {
    const user = requireUser(req.headers.authorization);
    if (!user) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!isInfluencer(user.id)) {
      return reply.send({ success: true, data: { influencer: null, metrics: null } });
    }
    return reply.send({
      success: true,
      data: {
        influencer: getInfluencer(user.id),
        metrics: getMetrics(user.id),
      },
    });
  });

  // ---- Admin endpoints ----

  // GET /admin/influencers/tiers — same as public
  app.get('/admin/influencers/tiers', async (_req, reply) => {
    return reply.send({ success: true, data: { tiers: TIERS } });
  });

  // GET /admin/influencers — list all marked influencers
  app.get('/admin/influencers', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const q = req.query as { limit?: string };
    const limit = Math.min(Math.max(parseInt(q.limit ?? '100') || 100, 1), 500);
    return reply.send({ success: true, data: { influencers: listInfluencers(limit) } });
  });

  // GET /admin/influencers/candidates?min=1000
  app.get('/admin/influencers/candidates', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const q = req.query as { min?: string };
    const min = Math.max(0, parseInt(q.min ?? '1000') || 1000);
    return reply.send({ success: true, data: { candidates: findCandidates(min, 50) } });
  });

  // GET /admin/influencers/:userId — metrics for a single influencer
  app.get('/admin/influencers/:userId', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { userId } = req.params as { userId: string };
    return reply.send({
      success: true,
      data: {
        influencer: getInfluencer(userId),
        metrics: getMetrics(userId),
      },
    });
  });

  // POST /admin/influencers/:userId — mark as influencer
  app.post('/admin/influencers/:userId', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { userId } = req.params as { userId: string };
    const parsed = MarkSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    try {
      const influencer = markInfluencer(userId, parsed.data, admin.id);
      return reply.send({ success: true, data: { influencer } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // PUT /admin/influencers/:userId/tier — change tier
  app.put('/admin/influencers/:userId/tier', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { userId } = req.params as { userId: string };
    const parsed = TierSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    try {
      const influencer = updateTier(userId, parsed.data.tier);
      return reply.send({ success: true, data: { influencer } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /admin/influencers/:userId
  app.delete('/admin/influencers/:userId', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { userId } = req.params as { userId: string };
    unmarkInfluencer(userId);
    return reply.send({ success: true, data: { unmarked: true } });
  });
}
