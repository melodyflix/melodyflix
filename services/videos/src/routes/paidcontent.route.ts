// melodyflix videos — Paid Content routes (10.5 PPV, 10.6 Rent/Buy)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  setPricing, getPricing, clearPricing, listPaidContentByOwner,
  listPaidContent,
  purchase, getPurchaseById, getActivePurchase, listMyPurchases,
  markFirstPlayed, revokePurchase, refundPurchase,
  checkAccess, getPaidContentStats, expireRentals,
} from '../services/paidcontent.service.js';

function userId(req: any): string | null {
  return req.user?.id ?? req.user?.sub ?? null;
}

export async function paidContentRoutes(app: FastifyInstance) {
  const TypeEnum = z.enum(['ppv', 'rent', 'buy']);

  // ---- Pricing (owner) ----

  const PricingSchema = z.object({
    type: TypeEnum,
    price: z.number().min(0.5).max(10000),
    currency: z.string().min(3).max(3).optional(),
    rental_hours: z.number().int().min(1).max(720).nullable().optional(),
    purchase_window_hours: z.number().int().min(1).max(24 * 365).nullable().optional(),
    description: z.string().max(500).nullable().optional(),
  });

  app.put('/videos/:videoId/pricing', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { videoId } = req.params as { videoId: string };
    const parsed = PricingSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const pricing = setPricing({ video_id: videoId, owner_id: me, ...parsed.data });
      return reply.send({ success: true, data: { pricing } });
    } catch (e: any) {
      const msg = e?.message ?? 'Set failed';
      if (msg === 'Video not found') return reply.code(404).send({ success: false, error: msg });
      if (msg === 'Not your video') return reply.code(403).send({ success: false, error: msg });
      return reply.code(400).send({ success: false, error: msg });
    }
  });

  app.get('/videos/:videoId/pricing', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const pricing = getPricing(videoId);
    return reply.send({ success: true, data: { pricing } });
  });

  app.delete('/videos/:videoId/pricing', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { videoId } = req.params as { videoId: string };
    try {
      const ok = clearPricing(videoId, me);
      return reply.send({ success: true, data: { cleared: ok } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  app.get('/pricing/mine', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const q = req.query as { limit?: string };
    const items = listPaidContentByOwner(me, q.limit ? parseInt(q.limit) : 100);
    return reply.send({ success: true, data: { items, count: items.length } });
  });

  app.get('/pricing', async (req, reply) => {
    const q = req.query as { type?: string; limit?: string };
    const items = listPaidContent(q.limit ? parseInt(q.limit) : 100, q.type as any);
    return reply.send({ success: true, data: { items, count: items.length } });
  });

  // ---- Purchases ----

  const PurchaseSchema = z.object({
    video_id: z.string().min(1),
    transaction_id: z.string().nullable().optional(),
  });

  app.post('/purchases', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = PurchaseSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const p = purchase({ user_id: me, ...parsed.data });
      return reply.code(201).send({ success: true, data: { purchase: p } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Purchase failed' });
    }
  });

  app.get('/purchases/mine', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const q = req.query as { limit?: string };
    const items = listMyPurchases(me, q.limit ? parseInt(q.limit) : 100);
    return reply.send({ success: true, data: { purchases: items, count: items.length } });
  });

  app.get('/purchases/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const p = getPurchaseById(id);
    if (!p) return reply.code(404).send({ success: false, error: 'Not found' });
    if (p.user_id !== me) return reply.code(403).send({ success: false, error: 'Not your purchase' });
    return reply.send({ success: true, data: { purchase: p } });
  });

  app.post('/purchases/:id/first-played', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const p = getPurchaseById(id);
    if (!p) return reply.code(404).send({ success: false, error: 'Not found' });
    if (p.user_id !== me) return reply.code(403).send({ success: false, error: 'Not your purchase' });
    markFirstPlayed(id);
    return reply.send({ success: true, data: { recorded: true } });
  });

  app.post('/purchases/:id/revoke', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const ok = revokePurchase(id, me);
      if (!ok) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { revoked: true } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  app.post('/purchases/:id/refund', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const ok = refundPurchase(id, me);
      if (!ok) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { refunded: true } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  // ---- Access check ----

  app.get('/videos/:videoId/access', async (req, reply) => {
    const me = userId(req as any);
    const { videoId } = req.params as { videoId: string };
    try {
      const result = checkAccess({ user_id: me, video_id: videoId });
      return reply.send({ success: true, data: result });
    } catch (e: any) {
      if (e?.message === 'Video not found') return reply.code(404).send({ success: false, error: e.message });
      throw e;
    }
  });

  // ---- Stats (owner) ----

  app.get('/videos/:videoId/pricing/stats', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { videoId } = req.params as { videoId: string };
    const pricing = getPricing(videoId);
    if (!pricing) return reply.code(404).send({ success: false, error: 'No pricing set' });
    if (pricing.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your video' });
    return reply.send({ success: true, data: getPaidContentStats(videoId) });
  });

  // ---- Worker: expire stale rentals ----

  app.post('/purchases/worker/expire', async (req, reply) => {
    const secret = req.headers['x-internal-secret'];
    const expected = process.env.MELODYFLIX_INTERNAL_SECRET ?? '';
    if (expected && secret !== expected) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const body = (req.body ?? {}) as { at?: string };
    const expired = expireRentals(body.at);
    return reply.send({ success: true, data: { expired } });
  });
}
