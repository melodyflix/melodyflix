// melodyflix videos - Live TV Broadcasting routes (Section 40)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  listChannels, getChannel, createChannel, updateChannel, deleteChannel,
  listCategories, countByOwner, checkStreamHealth, getLatestHealth, listHealthHistory,
} from '../services/livetv.service.js';

const CreateSchema = z.object({
  name: z.string().min(1).max(200),
  stream_url: z.string().url(),
  logo_url: z.string().url().nullable().optional(),
  category: z.string().max(80).nullable().optional(),
  country: z.string().max(2).nullable().optional(),
  language: z.string().max(10).nullable().optional(),
  tvg_id: z.string().max(200).nullable().optional(),
  tvg_name: z.string().max(200).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  is_public: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(100000).optional(),
});

const UpdateSchema = CreateSchema.partial().extend({
  is_active: z.boolean().optional(),
});

function userId(req: any): string | null {
  return req.user?.id ?? req.user?.sub ?? null;
}

export async function liveTvRoutes(app: FastifyInstance) {
  // ---- Public discovery ----

  // GET /live-tv/channels — list with filters (40.1, 40.6)
  app.get('/live-tv/channels', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const channels = listChannels({
      category: q.category,
      country: q.country,
      language: q.language,
      owner_id: q.owner_id,
      active_only: q.active_only !== 'false',
      public_only: q.public_only !== 'false',
      limit: q.limit ? parseInt(q.limit) : undefined,
    });
    return reply.send({ success: true, data: { channels, count: channels.length } });
  });

  // GET /live-tv/categories — category pills (40.6)
  app.get('/live-tv/categories', async (_req, reply) => {
    return reply.send({ success: true, data: { categories: listCategories() } });
  });

  // GET /live-tv/channels/:id — single channel (public if is_public=1)
  app.get('/live-tv/channels/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ch = getChannel(id);
    if (!ch) return reply.code(404).send({ success: false, error: 'Channel not found' });
    const me = userId(req as any);
    if (!ch.is_public && ch.owner_id !== me) {
      return reply.code(403).send({ success: false, error: 'Private channel' });
    }
    return reply.send({ success: true, data: { channel: ch } });
  });

  // ---- Owner-protected ----

  // GET /live-tv/mine — my channels (40.6)
  app.get('/live-tv/mine', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const channels = listChannels({ owner_id: me, active_only: false, public_only: false, limit: 500 });
    return reply.send({ success: true, data: { channels, count: countByOwner(me) } });
  });

  // POST /live-tv/channels — create (40.1, 40.15)
  app.post('/live-tv/channels', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    const ch = createChannel({ owner_id: me, ...parsed.data });
    return reply.code(201).send({ success: true, data: { channel: ch } });
  });

  // PATCH /live-tv/channels/:id — update (owner only)
  app.patch('/live-tv/channels/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    const { id } = req.params as { id: string };
    const ch = getChannel(id);
    if (!ch) return reply.code(404).send({ success: false, error: 'Channel not found' });
    if (ch.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your channel' });
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    const updated = updateChannel(id, parsed.data);
    return reply.send({ success: true, data: { channel: updated } });
  });

  // DELETE /live-tv/channels/:id — remove (owner only)
  app.delete('/live-tv/channels/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    const { id } = req.params as { id: string };
    const ch = getChannel(id);
    if (!ch) return reply.code(404).send({ success: false, error: 'Channel not found' });
    if (ch.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your channel' });
    deleteChannel(id);
    return reply.send({ success: true, data: { deleted: true } });
  });

  // ---- Stream Health (40.16) ----

  // POST /live-tv/channels/:id/health — run health check (owner only)
  app.post('/live-tv/channels/:id/health', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    const { id } = req.params as { id: string };
    const ch = getChannel(id);
    if (!ch) return reply.code(404).send({ success: false, error: 'Channel not found' });
    if (ch.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your channel' });
    try {
      const health = await checkStreamHealth(id);
      return reply.send({ success: true, data: { health } });
    } catch (e: any) {
      return reply.code(500).send({ success: false, error: e?.message ?? 'Health check failed' });
    }
  });

  // GET /live-tv/channels/:id/health — latest health (public)
  app.get('/live-tv/channels/:id/health', async (req, reply) => {
    const { id } = req.params as { id: string };
    const latest = getLatestHealth(id);
    return reply.send({ success: true, data: { health: latest } });
  });

  // GET /live-tv/channels/:id/health/history — recent checks
  app.get('/live-tv/channels/:id/health/history', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string };
    const history = listHealthHistory(id, q.limit ? parseInt(q.limit) : 20);
    return reply.send({ success: true, data: { history } });
  });
}
