// melodyflix videos - Section 11.15 Rate Limiting routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  createRule, getRule, listRules, updateRule, deleteRule,
  checkRateLimit, getRateLimitStats, pruneOldEvents, resetRateLimitStore, _storeSize,
} from './rate-limiting.service.js';

const SCOPES = ['global', 'auth', 'api', 'upload', 'comment', 'search', 'admin'] as const;
const APPLY_TO = ['ip', 'user', 'ip+user', 'global'] as const;

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  route_pattern: z.string().min(1).max(200),
  method: z.string().regex(/^[A-Z]{3,7}$/).nullable().optional(),
  scope: z.enum(SCOPES).optional(),
  window_seconds: z.number().int().min(1).max(86400),
  max_requests: z.number().int().min(1).max(1_000_000),
  apply_to: z.enum(APPLY_TO).optional(),
  burst_multiplier: z.number().min(1).max(10).optional(),
  is_active: z.boolean().optional(),
  priority: z.number().int().min(1).max(10000).optional(),
});

const UpdateSchema = CreateSchema.partial();

const CheckSchema = z.object({
  ip: z.string().max(64).nullable().optional(),
  user_id: z.string().max(100).nullable().optional(),
  route: z.string().max(500).nullable().optional(),
  method: z.string().max(10).nullable().optional(),
  scope: z.enum(SCOPES).optional(),
  rule_id: z.string().max(100).optional(),
  record: z.boolean().optional(),
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

export async function rateLimitingRoutes(app: FastifyInstance) {
  // POST /rate-limit/check — public: check + consume a token.
  // Called by other services or an edge/middleware layer.
  app.post('/rate-limit/check', async (req, reply) => {
    const parsed = CheckSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const result = checkRateLimit(parsed.data);
      const status = result.allowed ? 200 : 429;
      if (!result.allowed) reply.header('Retry-After', String(result.retry_after));
      return reply.code(status).send({ success: result.allowed, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // Admin endpoints
  // ============================================================

  // GET /rate-limit/rules
  app.get('/rate-limit/rules', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as { scope?: string; active_only?: string; limit?: string; offset?: string };
    const result = listRules({
      scope: q.scope as any,
      active_only: q.active_only === 'true',
      limit: q.limit ? parseInt(q.limit, 10) : 100,
      offset: q.offset ? parseInt(q.offset, 10) : 0,
    });
    return reply.send({ success: true, data: result });
  });

  // POST /rate-limit/rules
  app.post('/rate-limit/rules', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const rule = createRule({ ...parsed.data, created_by: auth.userId! });
      return reply.code(201).send({ success: true, data: rule });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /rate-limit/rules/:id
  app.get('/rate-limit/rules/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const rule = getRule(id);
    if (!rule) return reply.code(404).send({ success: false, error: 'Rule not found' });
    return reply.send({ success: true, data: rule });
  });

  // PATCH /rate-limit/rules/:id
  app.patch('/rate-limit/rules/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const rule = updateRule(id, parsed.data);
      return reply.send({ success: true, data: rule });
    } catch (err) {
      const msg = (err as Error).message;
      return reply.code(msg === 'Rule not found' ? 404 : 400).send({ success: false, error: msg });
    }
  });

  // DELETE /rate-limit/rules/:id
  app.delete('/rate-limit/rules/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const ok = deleteRule(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Rule not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // GET /rate-limit/stats/summary
  app.get('/rate-limit/stats/summary', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const stats = getRateLimitStats();
    return reply.send({ success: true, data: { ...stats, in_memory_keys: _storeSize() } });
  });

  // POST /rate-limit/maintenance/reset-store — dev/debug
  app.post('/rate-limit/maintenance/reset-store', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    resetRateLimitStore();
    return reply.send({ success: true, data: { reset: true } });
  });

  // POST /rate-limit/maintenance/prune
  app.post('/rate-limit/maintenance/prune', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const parsed = PruneSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const result = pruneOldEvents(parsed.data.older_than_days ?? 30);
    return reply.send({ success: true, data: result });
  });
}
