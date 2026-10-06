// melodyflix videos - Section 11.8 Session Management routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  createSession, getSession, listSessions, markCurrentSession, touchSession,
  updateSessionContext, revokeSession, revokeAllOtherSessions, extendSession,
  listSessionEvents, getUserSessionStats, getAdminSessionStats,
  expireStaleSessions, pruneOldSessions,
} from './session-management.service.js';

const DEVICE_TYPES = ['mobile', 'tablet', 'desktop', 'tv', 'console', 'bot', 'unknown'] as const;
const SESSION_STATUSES = ['active', 'revoked', 'expired'] as const;

const CreateSchema = z.object({
  device_label: z.string().min(1).max(80),
  device_type: z.enum(DEVICE_TYPES).optional(),
  platform: z.string().max(100).nullable().optional(),
  app_version: z.string().max(50).nullable().optional(),
  ip_address: z.string().max(64).nullable().optional(),
  user_agent: z.string().max(1000).nullable().optional(),
  country: z.string().max(10).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  ttl_hours: z.number().int().min(1).max(8760).optional(),
});

const ContextSchema = z.object({
  country: z.string().max(10).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  app_version: z.string().max(50).nullable().optional(),
});

const TouchSchema = z.object({
  extend_hours: z.number().int().min(1).max(8760).optional(),
});

const RevokeSchema = z.object({
  reason: z.string().max(500).nullable().optional(),
});

const ExtendSchema = z.object({
  hours: z.number().int().min(1).max(8760),
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

export async function sessionManagementRoutes(app: FastifyInstance) {
  // ============================================================
  // Session CRUD
  // ============================================================

  // POST /sessions - register a new session (auth required)
  app.post('/sessions', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const session = createSession({ ...parsed.data, user_id: auth.userId! });
      return reply.code(201).send({ success: true, data: session });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /sessions/mine - list my sessions
  app.get('/sessions/mine', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const q = req.query as { status?: string; active_only?: string; limit?: string; offset?: string };
    const result = listSessions({
      user_id: auth.userId!,
      status: q.status as any,
      active_only: q.active_only === 'true',
      limit: q.limit ? parseInt(q.limit, 10) : 50,
      offset: q.offset ? parseInt(q.offset, 10) : 0,
    });
    return reply.send({ success: true, data: result });
  });

  // GET /sessions/mine/stats - my session stats
  app.get('/sessions/mine/stats', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const q = req.query as { window_hours?: string };
    const hours = q.window_hours ? parseInt(q.window_hours, 10) : 24;
    return reply.send({ success: true, data: getUserSessionStats(auth.userId!, hours) });
  });

  // GET /sessions/:id - get session details (owner or admin)
  app.get('/sessions/:id', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const session = getSession(id);
    if (!session) return reply.code(404).send({ success: false, error: 'Session not found' });

    if (session.user_id !== auth.userId && auth.role !== 'admin') {
      return reply.code(403).send({ success: false, error: 'Access denied' });
    }
    return reply.send({ success: true, data: session });
  });

  // GET /sessions/:id/events - audit trail
  app.get('/sessions/:id/events', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const session = getSession(id);
    if (!session) return reply.code(404).send({ success: false, error: 'Session not found' });

    if (session.user_id !== auth.userId && auth.role !== 'admin') {
      return reply.code(403).send({ success: false, error: 'Access denied' });
    }
    return reply.send({ success: true, data: { events: listSessionEvents(id) } });
  });

  // POST /sessions/:id/touch - heartbeat (updates last_active_at)
  app.post('/sessions/:id/touch', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const session = getSession(id);
    if (!session) return reply.code(404).send({ success: false, error: 'Session not found' });
    if (session.user_id !== auth.userId) return reply.code(403).send({ success: false, error: 'Not your session' });

    const parsed = TouchSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const updated = touchSession(id, parsed.data);
    if (!updated) return reply.code(400).send({ success: false, error: 'Session is not active' });
    return reply.send({ success: true, data: updated });
  });

  // POST /sessions/:id/context - update geo/version info
  app.post('/sessions/:id/context', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const session = getSession(id);
    if (!session) return reply.code(404).send({ success: false, error: 'Session not found' });
    if (session.user_id !== auth.userId) return reply.code(403).send({ success: false, error: 'Not your session' });

    const parsed = ContextSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const updated = updateSessionContext(id, parsed.data);
    if (!updated) return reply.code(404).send({ success: false, error: 'Session not found' });
    return reply.send({ success: true, data: updated });
  });

  // POST /sessions/:id/mark-current - mark as current device
  app.post('/sessions/:id/mark-current', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const session = getSession(id);
    if (!session) return reply.code(404).send({ success: false, error: 'Session not found' });
    if (session.user_id !== auth.userId) return reply.code(403).send({ success: false, error: 'Not your session' });

    try {
      markCurrentSession(id);
      return reply.send({ success: true, data: getSession(id) });
    } catch (err) {
      return reply.code(404).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /sessions/:id/revoke - revoke one session
  app.post('/sessions/:id/revoke', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const session = getSession(id);
    if (!session) return reply.code(404).send({ success: false, error: 'Session not found' });

    if (session.user_id !== auth.userId && auth.role !== 'admin') {
      return reply.code(403).send({ success: false, error: 'Access denied' });
    }

    const parsed = RevokeSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const updated = revokeSession(id, {
      actor_id: auth.userId!,
      reason: parsed.data.reason ?? (auth.role === 'admin' ? 'Revoked by admin' : 'Revoked by user'),
    });
    return reply.send({ success: true, data: updated });
  });

  // POST /sessions/revoke-others - log out all other devices
  app.post('/sessions/revoke-others', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const q = req.query as { current?: string };
    const currentId = q.current ?? null;

    const result = revokeAllOtherSessions(auth.userId!, currentId, {
      actor_id: auth.userId!,
      reason: 'Logout all other devices',
    });
    return reply.send({ success: true, data: result });
  });

  // POST /sessions/:id/extend - extend session expiry
  app.post('/sessions/:id/extend', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const session = getSession(id);
    if (!session) return reply.code(404).send({ success: false, error: 'Session not found' });
    if (session.user_id !== auth.userId && auth.role !== 'admin') {
      return reply.code(403).send({ success: false, error: 'Access denied' });
    }

    const parsed = ExtendSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const updated = extendSession(id, parsed.data.hours);
      return reply.send({ success: true, data: updated });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // Admin endpoints
  // ============================================================

  // GET /sessions - admin: list all sessions
  app.get('/sessions', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as Record<string, string | undefined>;
    const result = listSessions({
      user_id: q.user_id,
      status: q.status as any,
      active_only: q.active_only === 'true',
      limit: q.limit ? parseInt(q.limit, 10) : 50,
      offset: q.offset ? parseInt(q.offset, 10) : 0,
    });
    return reply.send({ success: true, data: result });
  });

  // GET /sessions/stats/admin - admin stats
  app.get('/sessions/stats/admin', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    return reply.send({ success: true, data: getAdminSessionStats() });
  });

  // POST /sessions/maintenance/expire - expire stale sessions
  app.post('/sessions/maintenance/expire', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const result = expireStaleSessions();
    return reply.send({ success: true, data: result });
  });

  // POST /sessions/maintenance/prune - prune old sessions
  app.post('/sessions/maintenance/prune', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const parsed = PruneSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const result = pruneOldSessions(parsed.data.older_than_days ?? 90);
    return reply.send({ success: true, data: result });
  });
}
