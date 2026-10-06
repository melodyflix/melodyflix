// melodyflix videos - Section 11.10 Data Export/Delete routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  createRequest, getRequest, listRequests, cancelRequest, undoDelete,
  startProcessing, markExportReady, rejectRequest, completeRequest,
  listDueDeletions, expireOldExports, collectExportManifest,
  listRequestEvents, getRequestStats, pruneOldRequests,
} from './data-subject.service.js';

const REQUEST_TYPES = ['export', 'delete'] as const;
const REQUEST_STATUSES = ['pending', 'processing', 'ready', 'completed', 'rejected', 'cancelled', 'expired'] as const;
const EXPORT_FORMATS = ['json', 'csv', 'zip'] as const;

const CreateSchema = z.object({
  request_type: z.enum(REQUEST_TYPES),
  reason: z.string().max(1000).nullable().optional(),
  export_format: z.enum(EXPORT_FORMATS).optional(),
  grace_days: z.number().int().min(0).max(90).optional(),
});

const RejectSchema = z.object({
  reason: z.string().min(5).max(1000),
});

const ReadySchema = z.object({
  download_url: z.string().url().max(2000),
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

export async function dataSubjectRoutes(app: FastifyInstance) {
  // ============================================================
  // User endpoints
  // ============================================================

  // POST /data-requests - create export/delete request
  app.post('/data-requests', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const r = createRequest({ ...parsed.data, user_id: auth.userId! });
      return reply.code(201).send({ success: true, data: r });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /data-requests/mine
  app.get('/data-requests/mine', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const q = req.query as { request_type?: string; status?: string; limit?: string; offset?: string };
    const result = listRequests({
      user_id: auth.userId!,
      request_type: q.request_type as any,
      status: q.status as any,
      limit: q.limit ? parseInt(q.limit, 10) : 50,
      offset: q.offset ? parseInt(q.offset, 10) : 0,
    });
    return reply.send({ success: true, data: result });
  });

  // GET /data-requests/:id — own or admin
  app.get('/data-requests/:id', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const r = getRequest(id);
    if (!r) return reply.code(404).send({ success: false, error: 'Request not found' });

    if (r.user_id !== auth.userId && auth.role !== 'admin') {
      return reply.code(403).send({ success: false, error: 'Access denied' });
    }
    return reply.send({ success: true, data: r });
  });

  // GET /data-requests/:id/events
  app.get('/data-requests/:id/events', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const r = getRequest(id);
    if (!r) return reply.code(404).send({ success: false, error: 'Request not found' });

    if (r.user_id !== auth.userId && auth.role !== 'admin') {
      return reply.code(403).send({ success: false, error: 'Access denied' });
    }
    return reply.send({ success: true, data: { events: listRequestEvents(id) } });
  });

  // POST /data-requests/:id/cancel — user cancels pending request
  app.post('/data-requests/:id/cancel', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    try {
      const r = cancelRequest(id, auth.userId!);
      return reply.send({ success: true, data: r });
    } catch (err) {
      const msg = (err as Error).message;
      const code = msg === 'Request not found' ? 404 : msg === 'Not your request' ? 403 : 400;
      return reply.code(code).send({ success: false, error: msg });
    }
  });

  // POST /data-requests/:id/undo — undo delete during grace period
  app.post('/data-requests/:id/undo', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    try {
      const r = undoDelete(id, auth.userId!);
      return reply.send({ success: true, data: r });
    } catch (err) {
      const msg = (err as Error).message;
      const code = msg === 'Request not found' ? 404 : msg === 'Not your request' ? 403 : 400;
      return reply.code(code).send({ success: false, error: msg });
    }
  });

  // GET /data-requests/manifest/:userId — preview what would be exported (own only)
  app.get('/data-requests/manifest/:userId', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const { userId } = req.params as { userId: string };
    if (userId !== auth.userId && auth.role !== 'admin') {
      return reply.code(403).send({ success: false, error: 'Access denied' });
    }

    try {
      const manifest = collectExportManifest(userId);
      return reply.send({ success: true, data: manifest });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // Admin endpoints
  // ============================================================

  // GET /data-requests — admin: list all
  app.get('/data-requests', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as Record<string, string | undefined>;
    const result = listRequests({
      user_id: q.user_id,
      request_type: q.request_type as any,
      status: q.status as any,
      limit: q.limit ? parseInt(q.limit, 10) : 50,
      offset: q.offset ? parseInt(q.offset, 10) : 0,
    });
    return reply.send({ success: true, data: result });
  });

  // POST /data-requests/:id/process
  app.post('/data-requests/:id/process', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    try {
      const r = startProcessing(id, auth.userId!);
      return reply.send({ success: true, data: r });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /data-requests/:id/ready — mark export ready with download URL
  app.post('/data-requests/:id/ready', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const parsed = ReadySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const r = markExportReady(id, auth.userId!, parsed.data.download_url);
      return reply.send({ success: true, data: r });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /data-requests/:id/reject
  app.post('/data-requests/:id/reject', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const parsed = RejectSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const r = rejectRequest(id, auth.userId!, parsed.data.reason);
      return reply.send({ success: true, data: r });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /data-requests/:id/complete
  app.post('/data-requests/:id/complete', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    try {
      const r = completeRequest(id, auth.userId!);
      return reply.send({ success: true, data: r });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /data-requests/stats/summary
  app.get('/data-requests/stats/summary', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as { window_days?: string };
    const days = q.window_days ? parseInt(q.window_days, 10) : 30;
    return reply.send({ success: true, data: getRequestStats(days) });
  });

  // GET /data-requests/due-deletions — admin: list due deletions
  app.get('/data-requests/due-deletions', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    return reply.send({ success: true, data: { due: listDueDeletions() } });
  });

  // POST /data-requests/maintenance/expire-exports
  app.post('/data-requests/maintenance/expire-exports', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const result = expireOldExports();
    return reply.send({ success: true, data: result });
  });

  // POST /data-requests/maintenance/prune
  app.post('/data-requests/maintenance/prune', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const parsed = PruneSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const result = pruneOldRequests(parsed.data.older_than_days ?? 730);
    return reply.send({ success: true, data: result });
  });
}
