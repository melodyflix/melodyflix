// melodyflix videos - Section 11.13 VPN Detection routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  createRule, getRule, listRules, updateRule, deleteRule,
  checkIp, listChecks, getVpnStats, pruneOldChecks,
} from './vpn-detection.service.js';

const CATEGORIES = ['vpn', 'proxy', 'tor_exit', 'datacenter', 'residential'] as const;
const CLASSES = ['vpn', 'proxy', 'tor', 'datacenter', 'residential', 'unknown'] as const;

const CreateSchema = z.object({
  cidr: z.string().min(3).max(64),
  category: z.enum(CATEGORIES),
  provider: z.string().max(100).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  is_active: z.boolean().optional(),
});

const UpdateSchema = CreateSchema.partial().omit({ cidr: true }).extend({
  cidr: z.string().min(3).max(64).optional(),
});

const CheckSchema = z.object({
  ip: z.string().min(3).max(64),
  country: z.string().max(10).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
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

export async function vpnDetectionRoutes(app: FastifyInstance) {
  // POST /vpn/check — public: classify an IP (used by auth/edge/playback)
  app.post('/vpn/check', async (req, reply) => {
    const parsed = CheckSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const result = checkIp(parsed.data);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // Admin endpoints
  // ============================================================

  // GET /vpn/rules — list
  app.get('/vpn/rules', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as { category?: string; active_only?: string; limit?: string; offset?: string };
    const result = listRules({
      category: q.category as any,
      active_only: q.active_only === 'true',
      limit: q.limit ? parseInt(q.limit, 10) : 100,
      offset: q.offset ? parseInt(q.offset, 10) : 0,
    });
    return reply.send({ success: true, data: result });
  });

  // POST /vpn/rules — create
  app.post('/vpn/rules', async (req, reply) => {
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

  // GET /vpn/rules/:id
  app.get('/vpn/rules/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const r = getRule(id);
    if (!r) return reply.code(404).send({ success: false, error: 'Rule not found' });
    return reply.send({ success: true, data: r });
  });

  // PATCH /vpn/rules/:id
  app.patch('/vpn/rules/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const r = updateRule(id, parsed.data);
      return reply.send({ success: true, data: r });
    } catch (err) {
      const msg = (err as Error).message;
      return reply.code(msg === 'Rule not found' ? 404 : 400).send({ success: false, error: msg });
    }
  });

  // DELETE /vpn/rules/:id
  app.delete('/vpn/rules/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const ok = deleteRule(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Rule not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // GET /vpn/checks — list past checks
  app.get('/vpn/checks', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as { ip?: string; classification?: string; min_risk?: string; limit?: string; offset?: string };
    const result = listChecks({
      ip: q.ip,
      classification: q.classification as any,
      min_risk: q.min_risk ? parseInt(q.min_risk, 10) : undefined,
      limit: q.limit ? parseInt(q.limit, 10) : 100,
      offset: q.offset ? parseInt(q.offset, 10) : 0,
    });
    return reply.send({ success: true, data: result });
  });

  // GET /vpn/stats/summary
  app.get('/vpn/stats/summary', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    return reply.send({ success: true, data: getVpnStats() });
  });

  // POST /vpn/maintenance/prune
  app.post('/vpn/maintenance/prune', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const parsed = PruneSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const result = pruneOldChecks(parsed.data.older_than_days ?? 90);
    return reply.send({ success: true, data: result });
  });
}
