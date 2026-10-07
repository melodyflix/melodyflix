// melodyflix videos - Section 11.18 WAF routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  createRule, getRule, listRules, updateRule, deleteRule,
  inspect, listMatches, getWafStats, pruneOldMatches,
} from './waf.service.js';

const CATEGORIES = ['sqli', 'xss', 'lfi', 'rfi', 'rce', 'scanner', 'bot', 'protocol', 'custom'] as const;
const TARGETS = ['path', 'query', 'body', 'header', 'user_agent', 'referer'] as const;
const ACTIONS = ['log', 'block', 'challenge', 'redirect'] as const;
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  category: z.enum(CATEGORIES),
  target: z.enum(TARGETS),
  pattern: z.string().min(1).max(1000),
  action: z.enum(ACTIONS),
  severity: z.enum(SEVERITIES),
  redirect_url: z.string().url().max(500).nullable().optional(),
  is_active: z.boolean().optional(),
  priority: z.number().int().min(1).max(10000).optional(),
  notes: z.string().max(500).nullable().optional(),
});

const UpdateSchema = CreateSchema.partial();

const InspectSchema = z.object({
  path: z.string().max(2000).nullable().optional(),
  query: z.string().max(4000).nullable().optional(),
  body: z.string().max(100_000).nullable().optional(),
  method: z.string().max(10).nullable().optional(),
  user_agent: z.string().max(1000).nullable().optional(),
  referer: z.string().max(2000).nullable().optional(),
  headers: z.record(z.string(), z.string()).nullable().optional(),
  ip_address: z.string().max(64).nullable().optional(),
  user_id: z.string().max(100).nullable().optional(),
  dry_run: z.boolean().optional(),
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

export async function wafRoutes(app: FastifyInstance) {
  // POST /waf/inspect — public: inspect a request (used by other services/edge)
  app.post('/waf/inspect', async (req, reply) => {
    const parsed = InspectSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const result = inspect(parsed.data);
      const status = result.action === 'block' ? 403 : result.action === 'redirect' ? 302 : 200;

      if (result.action === 'redirect' && result.redirect_url) {
        reply.header('Location', result.redirect_url);
      }

      return reply.code(status).send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // Admin endpoints
  // ============================================================

  // GET /waf/rules — list rules
  app.get('/waf/rules', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as { category?: string; target?: string; active_only?: string; limit?: string; offset?: string };
    const result = listRules({
      category: q.category as any,
      target: q.target as any,
      active_only: q.active_only === 'true',
      limit: q.limit ? parseInt(q.limit, 10) : 100,
      offset: q.offset ? parseInt(q.offset, 10) : 0,
    });
    return reply.send({ success: true, data: result });
  });

  // POST /waf/rules — create rule
  app.post('/waf/rules', async (req, reply) => {
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

  // GET /waf/rules/:id
  app.get('/waf/rules/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const rule = getRule(id);
    if (!rule) return reply.code(404).send({ success: false, error: 'Rule not found' });
    return reply.send({ success: true, data: rule });
  });

  // PATCH /waf/rules/:id
  app.patch('/waf/rules/:id', async (req, reply) => {
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

  // DELETE /waf/rules/:id
  app.delete('/waf/rules/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const ok = deleteRule(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Rule not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // GET /waf/matches — history
  app.get('/waf/matches', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as { rule_id?: string; category?: string; ip_address?: string; severity?: string; limit?: string; offset?: string };
    const result = listMatches({
      rule_id: q.rule_id,
      category: q.category as any,
      ip_address: q.ip_address,
      severity: q.severity as any,
      limit: q.limit ? parseInt(q.limit, 10) : 100,
      offset: q.offset ? parseInt(q.offset, 10) : 0,
    });
    return reply.send({ success: true, data: result });
  });

  // GET /waf/stats/summary
  app.get('/waf/stats/summary', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as { window_hours?: string };
    const hours = q.window_hours ? parseInt(q.window_hours, 10) : 24;
    return reply.send({ success: true, data: getWafStats(hours) });
  });

  // POST /waf/maintenance/prune
  app.post('/waf/maintenance/prune', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const parsed = PruneSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const result = pruneOldMatches(parsed.data.older_than_days ?? 90);
    return reply.send({ success: true, data: result });
  });
}
