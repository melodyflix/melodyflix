// melodyflix videos - Section 11.12 IP Blocking routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  createBlock, getBlock, listBlocks, deactivateBlock, deleteBlock,
  checkIp, getIpBlockStats, expireOldBlocks, pruneOldBlocks, listEvents,
} from './ip-blocking.service.js';

const SCOPES = ['global', 'api', 'login', 'upload', 'comment'] as const;
const SOURCES = ['manual', 'auto_brute_force', 'auto_abuse', 'auto_fraud', 'integration'] as const;

const CreateSchema = z.object({
  cidr: z.string().min(3).max(64),
  reason: z.string().min(3).max(500),
  scope: z.enum(SCOPES).optional(),
  source: z.enum(SOURCES).optional(),
  expires_at: z.string().datetime().nullable().optional(),
});

const CheckSchema = z.object({
  ip: z.string().min(3).max(64),
  scope: z.enum(SCOPES).optional(),
});

const DeactivateSchema = z.object({
  note: z.string().max(500).optional(),
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

export async function ipBlockingRoutes(app: FastifyInstance) {
  // POST /ip-blocks/check — public: check whether an IP is blocked
  // Used by other services (auth, edge, middleware).
  app.post('/ip-blocks/check', async (req, reply) => {
    const parsed = CheckSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const result = checkIp(parsed.data.ip, parsed.data.scope ?? 'global');
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // Admin endpoints
  // ============================================================

  // GET /ip-blocks — admin: list
  app.get('/ip-blocks', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as { scope?: string; source?: string; active_only?: string; limit?: string; offset?: string };
    const result = listBlocks({
      scope: q.scope as any,
      source: q.source as any,
      active_only: q.active_only === 'true',
      limit: q.limit ? parseInt(q.limit, 10) : 100,
      offset: q.offset ? parseInt(q.offset, 10) : 0,
    });
    return reply.send({ success: true, data: result });
  });

  // POST /ip-blocks — admin: create
  app.post('/ip-blocks', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const block = createBlock({ ...parsed.data, created_by: auth.userId! });
      return reply.code(201).send({ success: true, data: block });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /ip-blocks/:id — admin: get
  app.get('/ip-blocks/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const b = getBlock(id);
    if (!b) return reply.code(404).send({ success: false, error: 'Block not found' });
    return reply.send({ success: true, data: b });
  });

  // GET /ip-blocks/:id/events — admin: audit
  app.get('/ip-blocks/:id/events', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const b = getBlock(id);
    if (!b) return reply.code(404).send({ success: false, error: 'Block not found' });
    return reply.send({ success: true, data: { events: listEvents(id) } });
  });

  // POST /ip-blocks/:id/deactivate
  app.post('/ip-blocks/:id/deactivate', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const parsed = DeactivateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const ok = deactivateBlock(id, auth.userId!, parsed.data.note);
    if (!ok) return reply.code(404).send({ success: false, error: 'Block not found' });
    return reply.send({ success: true, data: getBlock(id) });
  });

  // DELETE /ip-blocks/:id
  app.delete('/ip-blocks/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const ok = deleteBlock(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Block not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // GET /ip-blocks/stats/summary
  app.get('/ip-blocks/stats/summary', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    return reply.send({ success: true, data: getIpBlockStats() });
  });

  // POST /ip-blocks/maintenance/expire
  app.post('/ip-blocks/maintenance/expire', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const result = expireOldBlocks();
    return reply.send({ success: true, data: result });
  });

  // POST /ip-blocks/maintenance/prune
  app.post('/ip-blocks/maintenance/prune', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const parsed = PruneSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const result = pruneOldBlocks(parsed.data.older_than_days ?? 180);
    return reply.send({ success: true, data: result });
  });
}
