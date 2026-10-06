// melodyflix videos - Section 11.6 Bot Detection routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  listSignatures, getSignature, createSignature, updateSignature, deleteSignature,
  classifyUserAgent, recordEvent, listEvents, getStats, pruneOldEvents,
} from './bot-detection.service.js';

const ACTIONS = ['allow', 'challenge', 'deny'] as const;
const CATEGORIES = ['search_engine', 'social_preview', 'scraper', 'headless', 'cli_tool', 'unknown', 'custom'] as const;

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  pattern: z.string().min(1).max(500),
  category: z.enum(CATEGORIES).optional(),
  action: z.enum(ACTIONS),
  is_active: z.boolean().optional(),
  priority: z.number().int().min(1).max(10000).optional(),
  notes: z.string().max(500).nullable().optional(),
});

const UpdateSchema = CreateSchema.partial();

const ClassifySchema = z.object({
  user_agent: z.string().min(1).max(1000),
  ip: z.string().max(64).optional(),
  path: z.string().max(500).optional(),
  method: z.string().max(10).optional(),
  record: z.boolean().optional(),
});

const PruneSchema = z.object({
  older_than_days: z.number().int().min(1).max(365).optional(),
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

export async function botDetectionRoutes(app: FastifyInstance) {
  // GET /bot-detection/signatures — list (admin only)
  app.get('/bot-detection/signatures', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as { category?: string; action?: string; active_only?: string };
    const signatures = listSignatures({
      category: q.category as any,
      action: q.action as any,
      active_only: q.active_only === 'true',
    });
    return reply.send({ success: true, data: { signatures } });
  });

  // POST /bot-detection/signatures — create (admin only)
  app.post('/bot-detection/signatures', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const sig = createSignature({ ...parsed.data, created_by: auth.userId ?? null });
      return reply.code(201).send({ success: true, data: sig });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /bot-detection/signatures/:id (admin only)
  app.get('/bot-detection/signatures/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const sig = getSignature(id);
    if (!sig) return reply.code(404).send({ success: false, error: 'Signature not found' });
    return reply.send({ success: true, data: sig });
  });

  // PATCH /bot-detection/signatures/:id (admin only)
  app.patch('/bot-detection/signatures/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const sig = updateSignature(id, parsed.data);
      return reply.send({ success: true, data: sig });
    } catch (err) {
      const msg = (err as Error).message;
      return reply.code(msg === 'Signature not found' ? 404 : 400).send({ success: false, error: msg });
    }
  });

  // DELETE /bot-detection/signatures/:id (admin only)
  app.delete('/bot-detection/signatures/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const ok = deleteSignature(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Signature not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // POST /bot-detection/classify — public, used by edge / middleware
  app.post('/bot-detection/classify', async (req, reply) => {
    const parsed = ClassifySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const result = classifyUserAgent(parsed.data.user_agent);
      if (parsed.data.record) {
        recordEvent({
          user_agent: parsed.data.user_agent,
          ip: parsed.data.ip ?? null,
          path: parsed.data.path ?? null,
          method: parsed.data.method ?? null,
          result,
        });
      }
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /bot-detection/events (admin only)
  app.get('/bot-detection/events', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as { action?: string; category?: string; limit?: string };
    const events = listEvents({
      action: q.action as any,
      category: q.category as any,
      limit: q.limit ? parseInt(q.limit, 10) : 100,
    });
    return reply.send({ success: true, data: { events } });
  });

  // GET /bot-detection/stats (admin only)
  app.get('/bot-detection/stats', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as { window_hours?: string };
    const hours = q.window_hours ? parseInt(q.window_hours, 10) : 24;
    return reply.send({ success: true, data: getStats(hours) });
  });

  // POST /bot-detection/prune (admin only)
  app.post('/bot-detection/prune', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const parsed = PruneSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const result = pruneOldEvents(parsed.data.older_than_days ?? 30);
    return reply.send({ success: true, data: result });
  });
}
