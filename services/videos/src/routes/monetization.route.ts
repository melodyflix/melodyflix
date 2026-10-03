// melodyflix videos — Monetization routes (10.3 Donation, 10.9 Coupon)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  createDonation, getDonation, listDonationsForRecipient,
  listDonationsForChannel, refundDonation, getDonationStats,
  createPromoCode, getPromoCode, getPromoCodeByCode, listPromoCodesByOwner,
  updatePromoCode, deletePromoCode, validatePromo, redeemPromo,
  listRedemptions, getPromoStats,
} from '../services/monetization.service.js';

function userId(req: any): string | null {
  return req.user?.id ?? req.user?.sub ?? null;
}

export async function monetizationRoutes(app: FastifyInstance) {
  // ============================================================
  // 10.3 Donation
  // ============================================================

  const DonateSchema = z.object({
    recipient_id: z.string().min(1),
    channel_id: z.string().nullable().optional(),
    video_id: z.string().nullable().optional(),
    amount: z.number().min(0.5).max(10000),
    currency: z.string().min(3).max(3).optional(),
    message: z.string().max(200).nullable().optional(),
    is_anonymous: z.boolean().optional(),
    transaction_id: z.string().nullable().optional(),
  });

  app.post('/donations', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = DonateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const d = createDonation({ sender_id: me, ...parsed.data });
      return reply.code(201).send({ success: true, data: { donation: d } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Donation failed' });
    }
  });

  app.get('/donations/received', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const q = req.query as { limit?: string };
    const donations = listDonationsForRecipient(me, q.limit ? parseInt(q.limit) : 100);
    return reply.send({ success: true, data: { donations, count: donations.length } });
  });

  app.get('/donations/channels/:channelId', async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const q = req.query as { limit?: string };
    const donations = listDonationsForChannel(channelId, q.limit ? parseInt(q.limit) : 100);
    return reply.send({ success: true, data: { donations, count: donations.length } });
  });

  app.get('/donations/stats', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    return reply.send({ success: true, data: getDonationStats(me) });
  });

  app.get('/donations/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const d = getDonation(id);
    if (!d) return reply.code(404).send({ success: false, error: 'Donation not found' });
    return reply.send({ success: true, data: { donation: d } });
  });

  app.post('/donations/:id/refund', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const ok = refundDonation(id, me);
      if (!ok) return reply.code(404).send({ success: false, error: 'Not found or already refunded' });
      return reply.send({ success: true, data: { refunded: true } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  // ============================================================
  // 10.9 Promo codes
  // ============================================================

  const CreatePromoSchema = z.object({
    code: z.string().min(4).max(32).regex(/^[A-Za-z0-9_-]+$/).optional(),
    description: z.string().max(200).nullable().optional(),
    discount_type: z.enum(['percent', 'fixed']),
    discount_value: z.number().min(0.01).max(100000),
    max_uses: z.number().int().min(1).max(1_000_000).nullable().optional(),
    per_user_limit: z.number().int().min(1).max(100).optional(),
    applicable_to: z.enum(['all', 'membership', 'ppv', 'donation', 'merch']).optional(),
    target_channel_id: z.string().nullable().optional(),
    starts_at: z.string().nullable().optional(),
    ends_at: z.string().nullable().optional(),
  });

  app.get('/promo-codes/mine', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const q = req.query as { limit?: string };
    const codes = listPromoCodesByOwner(me, q.limit ? parseInt(q.limit) : 100);
    return reply.send({ success: true, data: { codes, count: codes.length } });
  });

  app.get('/promo-codes/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const code = getPromoCode(id);
    if (!code) return reply.code(404).send({ success: false, error: 'Not found' });
    if (code.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your code' });
    return reply.send({ success: true, data: { code } });
  });

  app.post('/promo-codes', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = CreatePromoSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const code = createPromoCode({ owner_id: me, ...parsed.data });
      return reply.code(201).send({ success: true, data: { code } });
    } catch (e: any) {
      const msg = e?.message ?? 'Create failed';
      if (msg.includes('exists')) return reply.code(409).send({ success: false, error: msg });
      return reply.code(400).send({ success: false, error: msg });
    }
  });

  const UpdatePromoSchema = z.object({
    description: z.string().max(200).nullable().optional(),
    max_uses: z.number().int().min(1).max(1_000_000).nullable().optional(),
    per_user_limit: z.number().int().min(1).max(100).optional(),
    applicable_to: z.enum(['all', 'membership', 'ppv', 'donation', 'merch']).optional(),
    starts_at: z.string().nullable().optional(),
    ends_at: z.string().nullable().optional(),
    is_active: z.boolean().optional(),
  });

  app.patch('/promo-codes/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const parsed = UpdatePromoSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const code = updatePromoCode(id, me, parsed.data);
      if (!code) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { code } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  app.delete('/promo-codes/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const ok = deletePromoCode(id, me);
      if (!ok) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { deleted: true } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  // Validate without redeeming (preview)
  const ValidateSchema = z.object({
    code: z.string().min(1).max(32),
    context: z.enum(['membership', 'ppv', 'donation', 'merch']).optional(),
    amount: z.number().min(0).max(1_000_000).optional(),
  });

  app.post('/promo-codes/validate', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = ValidateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const result = validatePromo({
      code: parsed.data.code,
      user_id: me,
      context: parsed.data.context,
      amount: parsed.data.amount,
    });
    return reply.send({ success: true, data: result });
  });

  // Redeem (with optional amount_saved)
  const RedeemSchema = ValidateSchema.extend({
    reference_id: z.string().nullable().optional(),
    amount_saved: z.number().min(0).max(100000),
  });

  app.post('/promo-codes/redeem', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = RedeemSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const result = redeemPromo({
      code: parsed.data.code,
      user_id: me,
      context: parsed.data.context,
      amount: parsed.data.amount,
      reference_id: parsed.data.reference_id ?? null,
      amount_saved: parsed.data.amount_saved,
    });
    if (!result.ok) return reply.code(409).send({ success: false, error: result.reason });
    return reply.send({ success: true, data: { redeemed: true } });
  });

  app.get('/promo-codes/:id/redemptions', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const code = getPromoCode(id);
    if (!code) return reply.code(404).send({ success: false, error: 'Not found' });
    if (code.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your code' });
    const redemptions = listRedemptions(id, 200);
    return reply.send({ success: true, data: { redemptions, stats: getPromoStats(id) } });
  });
}
