// melodyflix videos — Payout + KYC routes (10.10, 10.11, 10.12, 10.13)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  getRevenueShare, setRevenueShare, splitRevenue, creditEarning,
  getBalance, releasePending,
  getPayoutSettings, setPayoutSettings, computeNextPayout,
  getKYC, submitKYC, verifyKYC, rejectKYC,
  addKYCDocument, listKYCDocuments, reviewKYCDocument,
  requestPayout, getPayout, listPayouts, listPayoutsByState, advancePayout,
  listDuePayoutOwners, getOwnerPayoutSummary,
} from '../services/payout.service.js';

function userId(req: any): string | null {
  return req.user?.id ?? req.user?.sub ?? null;
}

function isAdmin(req: any): boolean {
  const u = req.user as any;
  const roles = u?.roles ?? [];
  return Array.isArray(roles) && roles.includes('admin');
}

export async function payoutRoutes(app: FastifyInstance) {
  // ---- Summary ----

  app.get('/payouts/summary', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    return reply.send({ success: true, data: getOwnerPayoutSummary(me) });
  });

  app.get('/payouts/balance', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    return reply.send({ success: true, data: { balance: getBalance(me) } });
  });

  // ---- 10.10 Revenue sharing ----

  app.get('/payouts/revenue-share', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    return reply.send({ success: true, data: { revenue_share: getRevenueShare(me) } });
  });

  const RevShareSchema = z.object({ creator_share_pct: z.number().min(0).max(100) });
  app.put('/payouts/revenue-share', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = RevShareSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const rs = setRevenueShare(me, parsed.data.creator_share_pct);
      return reply.send({ success: true, data: { revenue_share: rs } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Failed' });
    }
  });

  // Split preview
  const SplitSchema = z.object({ gross_cents: z.number().int().min(1).max(100_000_000) });
  app.post('/payouts/split-preview', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = SplitSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    return reply.send({ success: true, data: splitRevenue(me, parsed.data.gross_cents) });
  });

  // Credit earnings (typically called by ad/donation/superchat services)
  const CreditSchema = z.object({
    gross_cents: z.number().int().min(1).max(100_000_000),
    source: z.string().min(1).max(40),
    reference_id: z.string().nullable().optional(),
    note: z.string().max(200).nullable().optional(),
  });
  app.post('/payouts/credit', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = CreditSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const result = creditEarning({ owner_id: me, ...parsed.data });
    return reply.code(201).send({ success: true, data: result });
  });

  app.post('/payouts/release-pending', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    return reply.send({ success: true, data: { balance: releasePending(me) } });
  });

  // ---- 10.11 + 10.12 Settings ----

  app.get('/payouts/settings', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    return reply.send({ success: true, data: { settings: getPayoutSettings(me) } });
  });

  const SettingsSchema = z.object({
    schedule: z.enum(['weekly', 'biweekly', 'monthly', 'threshold']).optional(),
    min_payout_cents: z.number().int().min(1000).max(1_000_000).optional(),
    payout_currency: z.string().min(3).max(3).optional(),
    payout_method: z.string().max(40).nullable().optional(),
    payout_details_json: z.string().max(2000).nullable().optional(),
    is_active: z.boolean().optional(),
  });

  app.put('/payouts/settings', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = SettingsSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const settings = setPayoutSettings(me, parsed.data);
    return reply.send({ success: true, data: { settings } });
  });

  // ---- 10.13 KYC ----

  app.get('/payouts/kyc', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    return reply.send({
      success: true,
      data: { kyc: getKYC(me), documents: listKYCDocuments(me) },
    });
  });

  const KYCSchema = z.object({
    legal_name: z.string().min(1).max(200),
    country: z.string().length(2),
    tax_id: z.string().min(4).max(40),
    business_type: z.string().max(40).nullable().optional(),
  });

  app.post('/payouts/kyc/submit', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = KYCSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const kyc = submitKYC({ owner_id: me, ...parsed.data });
      return reply.code(201).send({ success: true, data: { kyc } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Submit failed' });
    }
  });

  // Admin: verify / reject
  const KYCDecisionSchema = z.object({ reason: z.string().max(500).optional() });

  app.post('/payouts/kyc/:ownerId/verify', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!isAdmin(req as any)) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { ownerId } = req.params as { ownerId: string };
    try {
      const kyc = verifyKYC(ownerId);
      return reply.send({ success: true, data: { kyc } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Verify failed' });
    }
  });

  app.post('/payouts/kyc/:ownerId/reject', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!isAdmin(req as any)) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { ownerId } = req.params as { ownerId: string };
    const parsed = KYCDecisionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    try {
      const kyc = rejectKYC(ownerId, parsed.data.reason ?? 'Not specified');
      return reply.send({ success: true, data: { kyc } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Reject failed' });
    }
  });

  // KYC documents
  const DocSchema = z.object({
    doc_type: z.enum(['government_id', 'passport', 'drivers_license', 'tax_form_w9', 'tax_form_w8ben']),
    file_url: z.string().url(),
    file_hash: z.string().max(128).nullable().optional(),
  });

  app.post('/payouts/kyc/documents', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = DocSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const doc = addKYCDocument({ owner_id: me, ...parsed.data });
      return reply.code(201).send({ success: true, data: { document: doc } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Upload failed' });
    }
  });

  app.get('/payouts/kyc/documents', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    return reply.send({ success: true, data: { documents: listKYCDocuments(me) } });
  });

  const DocReviewSchema = z.object({
    decision: z.enum(['approved', 'rejected']),
    notes: z.string().max(500).optional(),
  });
  app.post('/payouts/kyc/documents/:docId/review', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!isAdmin(req as any)) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { docId } = req.params as { docId: string };
    const parsed = DocReviewSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    const doc = reviewKYCDocument(docId, parsed.data.decision, parsed.data.notes);
    if (!doc) return reply.code(404).send({ success: false, error: 'Document not found' });
    return reply.send({ success: true, data: { document: doc } });
  });

  // ---- Payouts lifecycle ----

  const RequestSchema = z.object({ force: z.boolean().optional() });

  app.post('/payouts/request', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = RequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    const result = requestPayout(me, { force: parsed.data.force });
    const code = result.ok ? 201 : (result.reason === 'kyc_not_verified' ? 403 : 409);
    return reply.code(code).send({ success: result.ok, data: result });
  });

  app.get('/payouts/mine', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const q = req.query as { limit?: string };
    const payouts = listPayouts(me, q.limit ? parseInt(q.limit) : 100);
    return reply.send({ success: true, data: { payouts, count: payouts.length } });
  });

  app.get('/payouts/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const p = getPayout(id);
    if (!p) return reply.code(404).send({ success: false, error: 'Not found' });
    if (p.owner_id !== me && !isAdmin(req as any)) return reply.code(403).send({ success: false, error: 'Not your payout' });
    return reply.send({ success: true, data: { payout: p } });
  });

  // Admin: list by state
  app.get('/admin/payouts', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!isAdmin(req as any)) return reply.code(403).send({ success: false, error: 'Admin only' });
    const q = req.query as { state?: string; limit?: string };
    const state = (q.state as any) ?? 'pending';
    const payouts = listPayoutsByState(state, q.limit ? parseInt(q.limit) : 100);
    return reply.send({ success: true, data: { payouts, count: payouts.length } });
  });

  // Admin: advance state
  const AdvanceSchema = z.object({
    state: z.enum(['approved', 'processing', 'paid', 'failed', 'cancelled']),
    reference: z.string().max(200).nullable().optional(),
    error_message: z.string().max(500).nullable().optional(),
  });

  app.post('/admin/payouts/:id/advance', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!isAdmin(req as any)) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { id } = req.params as { id: string };
    const parsed = AdvanceSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const payout = advancePayout(id, parsed.data.state, {
      reference: parsed.data.reference ?? null,
      errorMessage: parsed.data.error_message ?? null,
    });
    if (!payout) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.send({ success: true, data: { payout } });
  });

  // Admin: due payout owners (for scheduler)
  app.get('/admin/payouts/due', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!isAdmin(req as any)) return reply.code(403).send({ success: false, error: 'Admin only' });
    const q = req.query as { at?: string };
    const due = listDuePayoutOwners(q.at);
    return reply.send({ success: true, data: { due, count: due.length } });
  });
}
