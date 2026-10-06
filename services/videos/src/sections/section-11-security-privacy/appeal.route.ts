// melodyflix videos - Section 11.7 Appeal System routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  createAppeal, getAppeal, listAppeals, updateAppeal, assignAppeal,
  withdrawAppeal, listAppealEvents, getAppealStats, getAdminWorkload,
  expireStaleAppeals, pruneOldAppeals,
} from './appeal.service.js';

const APPEAL_TYPES = ['content_removal', 'account_suspension', 'strike', 'block', 'ban', 'other'] as const;
const APPEAL_STATUSES = ['submitted', 'under_review', 'awaiting_user', 'approved', 'rejected', 'withdrawn', 'expired'] as const;
const APPEAL_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

const CreateSchema = z.object({
  appeal_type: z.enum(APPEAL_TYPES),
  target_id: z.string().max(200).nullable().optional(),
  target_type: z.string().max(100).nullable().optional(),
  subject: z.string().min(3).max(200),
  description: z.string().min(10).max(5000),
  evidence_urls: z.array(z.string().url().max(500)).max(10).optional(),
  priority: z.enum(APPEAL_PRIORITIES).optional(),
});

const UpdateSchema = z.object({
  status: z.enum(APPEAL_STATUSES).optional(),
  priority: z.enum(APPEAL_PRIORITIES).optional(),
  assigned_to: z.string().max(100).nullable().optional(),
  resolution_note: z.string().max(2000).nullable().optional(),
  due_at: z.string().datetime().nullable().optional(),
});

const AssignSchema = z.object({
  assigned_to: z.string().max(100).nullable(),
});

const PruneSchema = z.object({
  older_than_days: z.number().int().min(1).max(3650).optional(),
});

const ExpireSchema = z.object({
  grace_days: z.number().int().min(0).max(365).optional(),
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

export async function appealRoutes(app: FastifyInstance) {
  // ============================================================
  // User endpoints
  // ============================================================

  // POST /appeals - create appeal (auth required)
  app.post('/appeals', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const appeal = createAppeal({ ...parsed.data, user_id: auth.userId! });
      return reply.code(201).send({ success: true, data: appeal });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /appeals/mine - my appeals
  app.get('/appeals/mine', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const q = req.query as { status?: string; limit?: string; offset?: string };
    const result = listAppeals({
      user_id: auth.userId!,
      status: q.status as any,
      limit: q.limit ? parseInt(q.limit, 10) : 50,
      offset: q.offset ? parseInt(q.offset, 10) : 0,
    });
    return reply.send({ success: true, data: result });
  });

  // GET /appeals/:id - view own appeal (or admin)
  app.get('/appeals/:id', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const appeal = getAppeal(id);
    if (!appeal) return reply.code(404).send({ success: false, error: 'Appeal not found' });

    if (appeal.user_id !== auth.userId && auth.role !== 'admin') {
      return reply.code(403).send({ success: false, error: 'Access denied' });
    }
    return reply.send({ success: true, data: appeal });
  });

  // GET /appeals/:id/events - audit trail (owner or admin)
  app.get('/appeals/:id/events', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const appeal = getAppeal(id);
    if (!appeal) return reply.code(404).send({ success: false, error: 'Appeal not found' });

    if (appeal.user_id !== auth.userId && auth.role !== 'admin') {
      return reply.code(403).send({ success: false, error: 'Access denied' });
    }
    return reply.send({ success: true, data: { events: listAppealEvents(id) } });
  });

  // POST /appeals/:id/withdraw - withdraw own appeal
  app.post('/appeals/:id/withdraw', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    try {
      const appeal = withdrawAppeal(id, auth.userId!);
      return reply.send({ success: true, data: appeal });
    } catch (err) {
      const msg = (err as Error).message;
      const code = msg === 'Appeal not found' ? 404 : msg === 'Not your appeal' ? 403 : 400;
      return reply.code(code).send({ success: false, error: msg });
    }
  });

  // ============================================================
  // Admin endpoints
  // ============================================================

  // GET /appeals - list all (admin)
  app.get('/appeals', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as Record<string, string | undefined>;
    const result = listAppeals({
      status: q.status as any,
      appeal_type: q.appeal_type as any,
      assigned_to: q.assigned_to,
      priority: q.priority as any,
      overdue_only: q.overdue_only === 'true',
      limit: q.limit ? parseInt(q.limit, 10) : 50,
      offset: q.offset ? parseInt(q.offset, 10) : 0,
    });
    return reply.send({ success: true, data: result });
  });

  // PATCH /appeals/:id - update (admin)
  app.patch('/appeals/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const appeal = updateAppeal(id, parsed.data, auth.userId!);
      return reply.send({ success: true, data: appeal });
    } catch (err) {
      const msg = (err as Error).message;
      return reply.code(msg === 'Appeal not found' ? 404 : 400).send({ success: false, error: msg });
    }
  });

  // POST /appeals/:id/assign - assign to admin (admin)
  app.post('/appeals/:id/assign', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const parsed = AssignSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const appeal = assignAppeal(id, parsed.data.assigned_to, auth.userId!);
      return reply.send({ success: true, data: appeal });
    } catch (err) {
      return reply.code(404).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /appeals/stats - dashboard stats (admin)
  app.get('/appeals/stats/summary', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as { window_days?: string };
    const days = q.window_days ? parseInt(q.window_days, 10) : 30;
    return reply.send({ success: true, data: getAppealStats(days) });
  });

  // GET /appeals/stats/workload - admin workload (admin)
  app.get('/appeals/stats/workload', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    return reply.send({ success: true, data: { workload: getAdminWorkload() } });
  });

  // POST /appeals/maintenance/expire - expire stale (admin)
  app.post('/appeals/maintenance/expire', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const parsed = ExpireSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const result = expireStaleAppeals(parsed.data.grace_days ?? 7);
    return reply.send({ success: true, data: result });
  });

  // POST /appeals/maintenance/prune - prune old (admin)
  app.post('/appeals/maintenance/prune', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const parsed = PruneSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const result = pruneOldAppeals(parsed.data.older_than_days ?? 365);
    return reply.send({ success: true, data: result });
  });
}
