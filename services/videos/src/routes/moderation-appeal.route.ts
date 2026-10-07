// melodyflix videos - Section 60.4 Appeal Review routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  listModerationAppeals, getModerationContext, reviewAppeal,
  listReviewsForAppeal, getModerationAppealStats,
} from '../services/moderation-appeal.service.js';

const ReviewSchema = z.object({
  action: z.enum(['uphold','overturn','request_info']),
  reason: z.string().max(2000).nullable().optional(),
  original_decision: z.string().max(500).nullable().optional(),
});

export async function moderationAppealRoutes(app: FastifyInstance): Promise<void> {
  // GET /moderation/appeals?status=&kind=&limit=
  app.get('/moderation/appeals', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin','moderator']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { status?: string; kind?: string; limit?: string };
    const limit = q.limit ? Math.min(Math.max(Number(q.limit), 1), 200) : 50;
    const kind = (q.kind as any) ?? undefined;
    const { appeals, total } = listModerationAppeals({ status: q.status, kind, limit });
    return reply.send({ success: true, data: { appeals, total } });
  });

  // GET /moderation/appeals/stats
  app.get('/moderation/appeals/stats', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin','moderator']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { window_days?: string };
    const days = q.window_days ? Math.min(Math.max(Number(q.window_days), 1), 365) : 30;
    return reply.send({ success: true, data: getModerationAppealStats(days) });
  });

  // GET /moderation/appeals/:id/context
  app.get('/moderation/appeals/:id/context', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin','moderator']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const ctx = getModerationContext(id);
    if (!ctx) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.send({ success: true, data: ctx });
  });

  // GET /moderation/appeals/:id/reviews
  app.get('/moderation/appeals/:id/reviews', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin','moderator']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const reviews = listReviewsForAppeal(id);
    return reply.send({ success: true, data: { reviews, total: reviews.length } });
  });

  // POST /moderation/appeals/:id/review
  app.post('/moderation/appeals/:id/review', async (req, reply) => {
    let payload;
    try { payload = requireRole(req.headers.authorization, ['admin','moderator']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const parsed = ReviewSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    try {
      const outcome = reviewAppeal(id, payload.sub as string, parsed.data);
      return reply.code(201).send({ success: true, data: outcome });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'appeal_not_found') return reply.code(404).send({ success: false, error: msg });
      if (msg === 'appeal_closed') return reply.code(409).send({ success: false, error: msg });
      return reply.code(400).send({ success: false, error: msg });
    }
  });
}
