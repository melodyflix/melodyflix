// melodyflix videos — Internet Radio routes (Section 124)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  createRadioStation, getRadioStation, listRadioStations,
  updateRadioStation, deleteRadioStation,
  listRadioGenres, countStationsByOwner,
  checkRadioHealth, getLatestRadioHealth,
} from '../services/radio.service.js';

function userId(req: any): string | null {
  return req.user?.id ?? req.user?.sub ?? null;
}

export async function radioRoutes(app: FastifyInstance) {
  const StationSchema = z.object({
    name: z.string().min(1).max(200),
    stream_url: z.string().url(),
    logo_url: z.string().url().nullable().optional(),
    genre: z.string().max(80).nullable().optional(),
    country: z.string().max(2).nullable().optional(),
    language: z.string().max(10).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    bitrate_kbps: z.number().int().min(8).max(512).nullable().optional(),
    sample_rate_hz: z.number().int().min(8000).max(192000).nullable().optional(),
    is_public: z.boolean().optional(),
    sort_order: z.number().int().min(0).max(100000).optional(),
  });

  const UpdateSchema = StationSchema.partial().extend({
    is_active: z.boolean().optional(),
  });

  // ---- Discovery ----

  app.get('/radio/stations', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const stations = listRadioStations({
      genre: q.genre,
      country: q.country,
      language: q.language,
      owner_id: q.owner_id,
      search: q.search,
      active_only: q.active_only !== 'false',
      public_only: q.public_only !== 'false',
      limit: q.limit ? parseInt(q.limit) : undefined,
    });
    return reply.send({ success: true, data: { stations, count: stations.length } });
  });

  app.get('/radio/genres', async (_req, reply) => {
    return reply.send({ success: true, data: { genres: listRadioGenres() } });
  });

  // ---- Owner-scoped ----

  app.get('/radio/mine', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const stations = listRadioStations({ owner_id: me, active_only: false, public_only: false, limit: 500 });
    return reply.send({ success: true, data: { stations, count: countStationsByOwner(me) } });
  });

  app.post('/radio/stations', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = StationSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const station = createRadioStation({ owner_id: me, ...parsed.data });
    return reply.code(201).send({ success: true, data: { station } });
  });

  // ---- Public single ----

  app.get('/radio/stations/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const st = getRadioStation(id);
    if (!st) return reply.code(404).send({ success: false, error: 'Station not found' });
    const me = userId(req as any);
    if (!st.is_public && st.owner_id !== me) {
      return reply.code(403).send({ success: false, error: 'Private station' });
    }
    return reply.send({ success: true, data: { station: st } });
  });

  app.patch('/radio/stations/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const st = getRadioStation(id);
    if (!st) return reply.code(404).send({ success: false, error: 'Station not found' });
    if (st.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your station' });
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const updated = updateRadioStation(id, parsed.data);
    return reply.send({ success: true, data: { station: updated } });
  });

  app.delete('/radio/stations/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const st = getRadioStation(id);
    if (!st) return reply.code(404).send({ success: false, error: 'Station not found' });
    if (st.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your station' });
    deleteRadioStation(id);
    return reply.send({ success: true, data: { deleted: true } });
  });

  // ---- Health ----

  app.post('/radio/stations/:id/health', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const st = getRadioStation(id);
    if (!st) return reply.code(404).send({ success: false, error: 'Station not found' });
    if (st.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your station' });
    try {
      const health = await checkRadioHealth(id);
      return reply.send({ success: true, data: { health } });
    } catch (e: any) {
      return reply.code(500).send({ success: false, error: e?.message ?? 'Health check failed' });
    }
  });

  app.get('/radio/stations/:id/health', async (req, reply) => {
    const { id } = req.params as { id: string };
    const latest = getLatestRadioHealth(id);
    return reply.send({ success: true, data: { health: latest } });
  });
}
