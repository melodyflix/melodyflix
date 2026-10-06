// melodyflix videos - Section 11.9 Suspicious Login Alert routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  evaluateLogin, listLoginAttempts, listAlerts, getAlert, acknowledgeAlert,
  getSuspiciousStats, pruneOldAttempts, pruneOldAlerts,
} from './suspicious-login.service.js';

const LEVELS = ['low', 'medium', 'high', 'critical'] as const;
const STATUSES = ['new', 'acknowledged', 'dismissed', 'confirmed_fraud'] as const;

const EvaluateSchema = z.object({
  ip_address: z.string().max(64).nullable().optional(),
  user_agent: z.string().max(1000).nullable().optional(),
  device_label: z.string().max(80).nullable().optional(),
  device_type: z.string().max(20).nullable().optional(),
  country: z.string().max(10).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  success: z.boolean().optional(),
  failed_reason: z.string().max(200).nullable().optional(),
});

const AckSchema = z.object({
  status: z.enum(STATUSES),
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

export async function suspiciousLoginRoutes(app: FastifyInstance) {
  // POST /security/login/evaluate — evaluate login (auth endpoint calls this)
  app.post('/security/login/evaluate', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const parsed = EvaluateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const result = evaluateLogin({ ...parsed.data, user_id: auth.userId! });
      return reply.code(201).send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /security/login/attempts/mine
  app.get('/security/login/attempts/mine', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const q = req.query as { success_only?: string; failed_only?: string; limit?: string; offset?: string };
    const result = listLoginAttempts({
      user_id: auth.userId!,
      success_only: q.success_only === 'true',
      failed_only: q.failed_only === 'true',
      limit: q.limit ? parseInt(q.limit, 10) : 100,
      offset: q.offset ? parseInt(q.offset, 10) : 0,
    });
    return reply.send({ success: true, data: result });
  });

  // GET /security/alerts/mine
  app.get('/security/alerts/mine', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const q = req.query as { status?: string; level?: string; limit?: string; offset?: string };
    const result = listAlerts({
      user_id: auth.userId!,
      status: q.status as any,
      level: q.level as any,
      limit: q.limit ? parseInt(q.limit, 10) : 50,
      offset: q.offset ? parseInt(q.offset, 10) : 0,
    });
    return reply.send({ success: true, data: result });
  });

  // GET /security/alerts/:id — own or admin
  app.get('/security/alerts/:id', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const alert = getAlert(id);
    if (!alert) return reply.code(404).send({ success: false, error: 'Alert not found' });

    if (alert.user_id !== auth.userId && auth.role !== 'admin') {
      return reply.code(403).send({ success: false, error: 'Access denied' });
    }
    return reply.send({ success: true, data: alert });
  });

  // POST /security/alerts/:id/ack — acknowledge/dismiss/confirm
  app.post('/security/alerts/:id/ack', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const alert = getAlert(id);
    if (!alert) return reply.code(404).send({ success: false, error: 'Alert not found' });

    if (alert.user_id !== auth.userId && auth.role !== 'admin') {
      return reply.code(403).send({ success: false, error: 'Access denied' });
    }

    const parsed = AckSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const updated = acknowledgeAlert(id, auth.userId!, parsed.data.status);
      return reply.send({ success: true, data: updated });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // Admin endpoints
  // ============================================================

  // GET /security/alerts — admin: list all
  app.get('/security/alerts', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as Record<string, string | undefined>;
    const result = listAlerts({
      user_id: q.user_id,
      status: q.status as any,
      level: q.level as any,
      limit: q.limit ? parseInt(q.limit, 10) : 50,
      offset: q.offset ? parseInt(q.offset, 10) : 0,
    });
    return reply.send({ success: true, data: result });
  });

  // GET /security/login/attempts — admin: list all attempts
  app.get('/security/login/attempts', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as Record<string, string | undefined>;
    const result = listLoginAttempts({
      user_id: q.user_id,
      success_only: q.success_only === 'true',
      failed_only: q.failed_only === 'true',
      limit: q.limit ? parseInt(q.limit, 10) : 100,
      offset: q.offset ? parseInt(q.offset, 10) : 0,
    });
    return reply.send({ success: true, data: result });
  });

  // GET /security/stats — admin dashboard
  app.get('/security/stats/suspicious', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as { window_days?: string };
    const days = q.window_days ? parseInt(q.window_days, 10) : 30;
    return reply.send({ success: true, data: getSuspiciousStats(days) });
  });

  // POST /security/maintenance/prune-attempts
  app.post('/security/maintenance/prune-attempts', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const parsed = PruneSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const result = pruneOldAttempts(parsed.data.older_than_days ?? 90);
    return reply.send({ success: true, data: result });
  });

  // POST /security/maintenance/prune-alerts
  app.post('/security/maintenance/prune-alerts', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const parsed = PruneSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const result = pruneOldAlerts(parsed.data.older_than_days ?? 365);
    return reply.send({ success: true, data: result });
  });
}
