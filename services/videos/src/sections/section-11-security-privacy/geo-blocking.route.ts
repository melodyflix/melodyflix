// melodyflix videos - Section 11.5 Geo-blocking routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  listRules, getRule, createRule, updateRule, deleteRule,
  checkAccess,
} from './geo-blocking.service.js';

const RULE_TYPES = ['allow', 'deny'] as const;
const APPLIES_TO = ['global', 'video', 'channel', 'series'] as const;

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  rule_type: z.enum(RULE_TYPES),
  countries: z.array(z.string()).min(1).max(300),
  applies_to: z.enum(APPLIES_TO).optional(),
  target_id: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  priority: z.number().int().min(1).max(10000).optional(),
});

const UpdateSchema = CreateSchema.partial();

const CheckSchema = z.object({
  ip: z.string().optional(),
  country: z.string().length(2).optional(),
  video_id: z.string().optional(),
  channel_id: z.string().optional(),
  series_id: z.string().optional(),
});

function requireAdmin(authorization: string | undefined): { ok: boolean; userId?: string; error?: string } {
  try {
    const payload = requireAuth(authorization);
    if (payload.role !== 'admin') return { ok: false, error: 'Admin only' };
    return { ok: true, userId: payload.sub as string };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function geoBlockingRoutes(app: FastifyInstance) {
  // GET /geo-blocking/rules - list rules (admin only)
  app.get('/geo-blocking/rules', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as { applies_to?: string; target_id?: string; active_only?: string };
    const rules = listRules({
      applies_to: q.applies_to as any,
      target_id: q.target_id,
      active_only: q.active_only === 'true',
    });
    return reply.send({ success: true, data: { rules } });
  });

  // POST /geo-blocking/rules - create rule (admin only)
  app.post('/geo-blocking/rules', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const rule = createRule({ ...parsed.data, created_by: auth.userId ?? null });
      return reply.code(201).send({ success: true, data: rule });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /geo-blocking/rules/:id (admin only)
  app.get('/geo-blocking/rules/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const rule = getRule(id);
    if (!rule) return reply.code(404).send({ success: false, error: 'Rule not found' });
    return reply.send({ success: true, data: rule });
  });

  // PATCH /geo-blocking/rules/:id (admin only)
  app.patch('/geo-blocking/rules/:id', async (req, reply) => {
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

  // DELETE /geo-blocking/rules/:id (admin only)
  app.delete('/geo-blocking/rules/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const ok = deleteRule(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Rule not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // POST /geo-blocking/check - evaluate access (public, used by playback + middleware)
  app.post('/geo-blocking/check', async (req, reply) => {
    const parsed = CheckSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const decision = checkAccess(parsed.data);
      return reply.send({ success: true, data: decision });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });
}
