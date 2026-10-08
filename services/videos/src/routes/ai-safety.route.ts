// melodyflix videos — AI Safety routes (8.11, 8.12, 8.13, 8.14, 8.15, 8.16)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '@melodyflix/shared-auth';
import {
  getSafetyPolicy, setSafetyPolicy, listCategories,
  runSafetyCheck, listChecks, getCheck,
  checkContentFilter, checkInappropriate, checkSpamComment,
  checkFakeAccount, checkHallucination, checkPromptSafety,
  getUserTrust, adjustUserTrust, listLowTrustUsers,
  recordSpamReport, getSpamHash, hashInput,
  getSafetyStats,
} from '../services/ai-safety.service.js';

function userId(req: any): string | null {
  return req.user?.id ?? req.user?.sub ?? null;
}

function isAdmin(req: any): boolean {
  const u = req.user as any;
  const roles = u?.roles ?? [];
  return Array.isArray(roles) && roles.includes('admin');
}

export async function aiSafetyRoutes(app: FastifyInstance) {
  // ---- Categories + policy ----

  app.get('/ai/safety/categories', async (req, reply) => {
    const q = req.query as { feature?: string };
    const cats = listCategories(q.feature as any);
    return reply.send({ success: true, data: { categories: cats, count: cats.length } });
  });

  app.get('/ai/safety/policy', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    return reply.send({ success: true, data: { policy: getSafetyPolicy(me) } });
  });

  const PolicySchema = z.object({
    strict_mode: z.boolean().optional(),
    auto_hide_threshold: z.number().min(0.1).max(1).optional(),
    auto_block_threshold: z.number().min(0.1).max(1).optional(),
    review_threshold: z.number().min(0.1).max(0.9).optional(),
  });

  app.put('/ai/safety/policy', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = PolicySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const policy = setSafetyPolicy(me, parsed.data);
    return reply.send({ success: true, data: { policy } });
  });

  // ---- Core unified check ----

  const CheckSchema = z.object({
    feature: z.enum(['content_filter','inappropriate','spam_comment','fake_account','hallucination','prompt_safety']),
    subject_type: z.string().min(1).max(40),
    subject_id: z.string().min(1).max(200),
    content: z.string().min(1).max(20_000),
    context: z.record(z.any()).optional(),
  });

  app.post('/ai/safety/check', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = CheckSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const result = await runSafetyCheck({
        feature: parsed.data.feature,
        subject_type: parsed.data.subject_type,
        subject_id: parsed.data.subject_id,
        content: parsed.data.content,
        owner_id: me,
        requester_id: me,
        context: parsed.data.context,
      });
      return reply.send({ success: true, data: result });
    } catch (e: any) {
      return reply.code(500).send({ success: false, error: e?.message ?? 'Check failed' });
    }
  });

  // Convenience wrappers
  const WrapSchema = CheckSchema.omit({ feature: true });

  app.post('/ai/safety/check/content-filter', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = WrapSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const r = await checkContentFilter({ ...parsed.data, owner_id: me, requester_id: me });
    return reply.send({ success: true, data: r });
  });

  app.post('/ai/safety/check/inappropriate', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = WrapSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const r = await checkInappropriate({ ...parsed.data, owner_id: me, requester_id: me });
    return reply.send({ success: true, data: r });
  });

  app.post('/ai/safety/check/spam-comment', async (req, reply) => {
    // Public: comment filter can be called by anonymous writers; owner not required
    const parsed = WrapSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const me = userId(req as any);
    const r = await checkSpamComment({ ...parsed.data, owner_id: null, requester_id: me });
    return reply.send({ success: true, data: r });
  });

  app.post('/ai/safety/check/fake-account', { preHandler: [authGuard] }, async (req, reply) => {
    if (!isAdmin(req as any)) return reply.code(403).send({ success: false, error: 'Admin only' });
    const parsed = WrapSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const r = await checkFakeAccount({ ...parsed.data, owner_id: null, requester_id: null });
    return reply.send({ success: true, data: r });
  });

  app.post('/ai/safety/check/hallucination', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = WrapSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const r = await checkHallucination({ ...parsed.data, owner_id: me, requester_id: me });
    return reply.send({ success: true, data: r });
  });

  app.post('/ai/safety/check/prompt-safety', async (req, reply) => {
    // Public: caller filters their own prompt before sending to a model
    const parsed = WrapSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const me = userId(req as any);
    const r = await checkPromptSafety({ ...parsed.data, owner_id: null, requester_id: me });
    return reply.send({ success: true, data: r });
  });

  // ---- Checks list + read ----

  app.get('/ai/safety/checks', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const q = req.query as { feature?: string; verdict?: string; severity?: string; subject_id?: string; limit?: string };
    const checks = listChecks({
      feature: q.feature as any,
      verdict: q.verdict as any,
      severity: q.severity as any,
      subject_id: q.subject_id,
      owner_id: isAdmin(req as any) ? undefined : me,
      limit: q.limit ? parseInt(q.limit) : 100,
    });
    return reply.send({ success: true, data: { checks, count: checks.length } });
  });

  app.get('/ai/safety/checks/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const c = getCheck(id);
    if (!c) return reply.code(404).send({ success: false, error: 'Not found' });
    if (c.owner_id && c.owner_id !== me && !isAdmin(req as any)) {
      return reply.code(403).send({ success: false, error: 'Not your check' });
    }
    return reply.send({ success: true, data: { check: c } });
  });

  // ---- 8.13 Spam hashes ----

  const SpamReportSchema = z.object({ content: z.string().min(1).max(20_000) });

  app.post('/ai/safety/spam-report', async (req, reply) => {
    const parsed = SpamReportSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const row = recordSpamReport(parsed.data.content);
    return reply.send({ success: true, data: { hash: row } });
  });

  app.get('/ai/safety/spam-hash/:hash', { preHandler: [authGuard] }, async (req, reply) => {
    if (!isAdmin(req as any)) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { hash } = req.params as { hash: string };
    const row = getSpamHash(hash);
    if (!row) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.send({ success: true, data: { hash: row } });
  });

  // ---- 8.14 User trust ----

  app.get('/ai/safety/trust/:userId', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    const { userId: target } = req.params as { userId: string };
    if (target !== me && !isAdmin(req as any)) return reply.code(403).send({ success: false, error: 'Forbidden' });
    return reply.send({ success: true, data: { trust: getUserTrust(target) } });
  });

  const TrustAdjSchema = z.object({
    delta: z.number().min(-100).max(100),
    note: z.string().max(200).nullable().optional(),
  });

  app.post('/ai/safety/trust/:userId/adjust', { preHandler: [authGuard] }, async (req, reply) => {
    if (!isAdmin(req as any)) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { userId: target } = req.params as { userId: string };
    const parsed = TrustAdjSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const t = adjustUserTrust(target, parsed.data.delta, parsed.data.note ?? null);
    return reply.send({ success: true, data: { trust: t } });
  });

  app.get('/ai/safety/low-trust-users', { preHandler: [authGuard] }, async (req, reply) => {
    if (!isAdmin(req as any)) return reply.code(403).send({ success: false, error: 'Admin only' });
    const q = req.query as { threshold?: string; limit?: string };
    const users = listLowTrustUsers(q.threshold ? parseInt(q.threshold) : 60, q.limit ? parseInt(q.limit) : 100);
    return reply.send({ success: true, data: { users, count: users.length } });
  });

  // ---- Stats ----

  app.get('/ai/safety/stats', { preHandler: [authGuard] }, async (req, reply) => {
    if (!isAdmin(req as any)) return reply.code(403).send({ success: false, error: 'Admin only' });
    const q = req.query as { from?: string; to?: string };
    const stats = getSafetyStats({ from: q.from, to: q.to });
    return reply.send({ success: true, data: stats });
  });
}
