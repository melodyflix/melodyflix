// melodyflix videos - Section 11.11 Age Verification routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  declareAge, submitVerification, approveVerification, rejectVerification,
  revokeVerification, getVerification, getVerificationById, listVerifications,
  listEvents, isAgeVerified, getAgeStats, expireOldVerifications, pruneOldVerifications,
} from './age-verification.service.js';

const METHODS = ['declared', 'id_document', 'credit_card', 'biometric', 'third_party'] as const;
const STATUSES = ['unverified', 'pending', 'verified', 'rejected', 'expired', 'revoked'] as const;
const DOC_TYPES = ['passport', 'national_id', 'driving_license', 'birth_certificate', 'other'] as const;

const DeclareSchema = z.object({
  declared_dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'DOB must be YYYY-MM-DD'),
  min_age: z.number().int().min(13).max(21).optional(),
});

const SubmitSchema = z.object({
  method: z.enum(METHODS),
  doc_type: z.enum(DOC_TYPES).optional(),
  doc_number: z.string().min(4).max(100).optional(),
  doc_country: z.string().length(2).optional(),
  selfie_data: z.string().max(10000).optional(),
});

const ApproveSchema = z.object({
  validity_days: z.number().int().min(1).max(3650).optional(),
});

const RejectSchema = z.object({
  reason: z.string().min(5).max(1000),
});

const RevokeSchema = z.object({
  reason: z.string().max(500).optional(),
});

const PruneSchema = z.object({
  older_than_days: z.number().int().min(1).max(3650).optional(),
});

function getAuth(authorization: string | undefined): { ok: boolean; userId?: string; role?: string; error?: string } {
  try {
    const payload = requireAuth(authorization);
    return { ok: true, userId: payload.sub as string, role: payload.role as string };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function requireAdmin(authorization: string | undefined): { ok: boolean; userId?: string; error?: string } {
  const auth = getAuth(authorization);
  if (!auth.ok) return auth;
  if (auth.role !== 'admin') return { ok: false, error: 'Admin only' };
  return auth;
}

export async function ageVerificationRoutes(app: FastifyInstance) {
  // ============================================================
  // User endpoints
  // ============================================================

  // POST /age/declare — declare DOB
  app.post('/age/declare', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const parsed = DeclareSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const v = declareAge({ ...parsed.data, user_id: auth.userId! });
      return reply.send({ success: true, data: v });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /age/submit — submit verification with doc/selfie
  app.post('/age/submit', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const parsed = SubmitSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const v = submitVerification({ ...parsed.data, user_id: auth.userId! });
      return reply.send({ success: true, data: v });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /age/me — my verification status
  app.get('/age/me', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const v = getVerification(auth.userId!);
    const verified_18 = isAgeVerified(auth.userId!, 18);
    const verified_21 = isAgeVerified(auth.userId!, 21);
    return reply.send({ success: true, data: { verification: v, is_18_verified: verified_18, is_21_verified: verified_21 } });
  });

  // GET /age/me/events — my audit trail
  app.get('/age/me/events', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    return reply.send({ success: true, data: { events: listEvents(auth.userId!) } });
  });

  // ============================================================
  // Admin endpoints
  // ============================================================

  // GET /age/verifications — admin list
  app.get('/age/verifications', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as { status?: string; method?: string; limit?: string; offset?: string };
    const result = listVerifications({
      status: q.status as any,
      method: q.method as any,
      limit: q.limit ? parseInt(q.limit, 10) : 50,
      offset: q.offset ? parseInt(q.offset, 10) : 0,
    });
    return reply.send({ success: true, data: result });
  });

  // GET /age/verifications/:id — admin detail
  app.get('/age/verifications/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const v = getVerificationById(id);
    if (!v) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.send({ success: true, data: v });
  });

  // POST /age/verifications/:userId/approve
  app.post('/age/verifications/:userId/approve', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { userId } = req.params as { userId: string };
    const parsed = ApproveSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const v = approveVerification({ user_id: userId, admin_id: auth.userId!, ...parsed.data });
      return reply.send({ success: true, data: v });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /age/verifications/:userId/reject
  app.post('/age/verifications/:userId/reject', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { userId } = req.params as { userId: string };
    const parsed = RejectSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const v = rejectVerification({ user_id: userId, admin_id: auth.userId!, reason: parsed.data.reason });
      return reply.send({ success: true, data: v });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /age/verifications/:userId/revoke
  app.post('/age/verifications/:userId/revoke', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { userId } = req.params as { userId: string };
    const parsed = RevokeSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const v = revokeVerification(userId, auth.userId!, parsed.data.reason);
      return reply.send({ success: true, data: v });
    } catch (err) {
      return reply.code(404).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /age/stats/summary — admin dashboard
  app.get('/age/stats/summary', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as { window_days?: string };
    const days = q.window_days ? parseInt(q.window_days, 10) : 30;
    return reply.send({ success: true, data: getAgeStats(days) });
  });

  // POST /age/maintenance/expire
  app.post('/age/maintenance/expire', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const result = expireOldVerifications();
    return reply.send({ success: true, data: result });
  });

  // POST /age/maintenance/prune
  app.post('/age/maintenance/prune', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const parsed = PruneSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const result = pruneOldVerifications(parsed.data.older_than_days ?? 1825);
    return reply.send({ success: true, data: result });
  });
}
