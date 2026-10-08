// melodyflix videos — Internet Radio routes (Section 124)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '@melodyflix/shared-auth';
import {
  createRadioStation, getRadioStation, listRadioStations,
  updateRadioStation, deleteRadioStation,
  listRadioGenres, countStationsByOwner,
  checkRadioHealth, getLatestRadioHealth,
  createJingle, getJingle, listJingles, updateJingle, deleteJingle,
  pickJingle, countJingles, jinglesByType,
  ensureRadioScheduleSchema,
  createScheduleSlot, getScheduleSlot, listSchedule, updateScheduleSlot,
  deleteScheduleSlot, getScheduleNow, scheduleStats,
  ensureRadioHistorySchema,
  logPlay, getPlay, listPlays, nowPlaying, historyStats,
  deleteOldPlays, deletePlay,
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

  app.get('/radio/mine', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const stations = listRadioStations({ owner_id: me, active_only: false, public_only: false, limit: 500 });
    return reply.send({ success: true, data: { stations, count: countStationsByOwner(me) } });
  });

  app.post('/radio/stations', { preHandler: [authGuard] }, async (req, reply) => {
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

  app.patch('/radio/stations/:id', { preHandler: [authGuard] }, async (req, reply) => {
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

  app.delete('/radio/stations/:id', { preHandler: [authGuard] }, async (req, reply) => {
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

  app.post('/radio/stations/:id/health', { preHandler: [authGuard] }, async (req, reply) => {
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

  // ---- Jingles (124.3) ----

  const JINGLE_TYPES = ['intro','outro','transition','ad_break','station_id','news'] as const;

  const JingleCreateSchema = z.object({
    name: z.string().min(1).max(200),
    audio_url: z.string().url(),
    duration_seconds: z.number().min(0).max(300).optional(),
    jingle_type: z.enum(JINGLE_TYPES).optional(),
    weight: z.number().int().min(1).max(100).optional(),
  });

  const JingleUpdateSchema = JingleCreateSchema.partial().extend({
    is_active: z.boolean().optional(),
  });

  // GET /radio/stations/:id/jingles — list (filter by type)
  app.get('/radio/stations/:id/jingles', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { jingle_type?: string; active_only?: string; limit?: string };
    const jingles = listJingles(id, {
      jingle_type: q.jingle_type as any,
      active_only: q.active_only !== 'false',
      limit: q.limit ? parseInt(q.limit) : undefined,
    });
    return reply.send({ success: true, data: { jingles, count: jingles.length } });
  });

  // POST /radio/stations/:id/jingles — create
  app.post('/radio/stations/:id/jingles', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const parsed = JingleCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const jingle = createJingle({ station_id: id, owner_id: me, ...parsed.data });
      return reply.code(201).send({ success: true, data: { jingle } });
    } catch (e: any) {
      const msg = e?.message ?? 'Create failed';
      if (msg === 'Station not found') return reply.code(404).send({ success: false, error: msg });
      if (msg === 'Not your station') return reply.code(403).send({ success: false, error: msg });
      return reply.code(400).send({ success: false, error: msg });
    }
  });

  // PATCH /radio/jingles/:id — update
  app.patch('/radio/jingles/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const parsed = JingleUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const updated = updateJingle(id, me, parsed.data);
      if (!updated) return reply.code(404).send({ success: false, error: 'Jingle not found' });
      return reply.send({ success: true, data: { jingle: updated } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  // DELETE /radio/jingles/:id
  app.delete('/radio/jingles/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const removed = deleteJingle(id, me);
      return reply.send({ success: true, data: { removed } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  // GET /radio/jingles/:id — single
  app.get('/radio/jingles/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const j = getJingle(id);
    if (!j) return reply.code(404).send({ success: false, error: 'Jingle not found' });
    return reply.send({ success: true, data: { jingle: j } });
  });

  // GET /radio/stations/:id/jingles/stats — by-type counts
  app.get('/radio/stations/:id/jingles/stats', async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({
      success: true,
      data: { total: countJingles(id), by_type: jinglesByType(id) },
    });
  });

  // POST /radio/stations/:id/jingles/pick — preview weighted pick
  app.post('/radio/stations/:id/jingles/pick', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { jingle_type?: string; seed?: number };
    const type = (body?.jingle_type as any) ?? 'transition';
    const seed = typeof body?.seed === 'number' ? body.seed : Date.now();
    const jingle = pickJingle(id, type, seed);
    return reply.send({ success: true, data: { jingle, seed } });
  });


  // ---- Station Scheduling (124.2) ----

  const SLOT_KINDS = ['show','music_rotation','jingle','ad_break','news'] as const;

  const SlotCreateSchema = z.object({
    title: z.string().min(1).max(200),
    kind: z.enum(SLOT_KINDS).optional(),
    day_of_week: z.number().int().min(0).max(6).nullable().optional(),
    start_minute: z.number().int().min(0).max(1439),
    duration_minutes: z.number().int().min(1).max(1440),
    playlist_url: z.string().url().nullable().optional(),
    jingle_id: z.string().nullable().optional(),
    description: z.string().max(1000).nullable().optional(),
  });

  const SlotUpdateSchema = SlotCreateSchema.partial().extend({
    is_active: z.boolean().optional(),
  });

  // GET /radio/stations/:id/schedule — list slots (filter by day)
  app.get('/radio/stations/:id/schedule', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { day_of_week?: string; active_only?: string; limit?: string };
    const dow = q.day_of_week !== undefined ? parseInt(q.day_of_week) : undefined;
    const slots = listSchedule(id, {
      day_of_week: dow,
      active_only: q.active_only !== 'false',
      limit: q.limit ? parseInt(q.limit) : undefined,
    });
    return reply.send({ success: true, data: { slots, count: slots.length } });
  });

  // GET /radio/stations/:id/schedule/now — what's on now + next
  app.get('/radio/stations/:id/schedule/now', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { at?: string };
    const result = getScheduleNow(id, q.at);
    return reply.send({ success: true, data: result });
  });

  // GET /radio/stations/:id/schedule/stats
  app.get('/radio/stations/:id/schedule/stats', async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: scheduleStats(id) });
  });

  // POST /radio/stations/:id/schedule — create slot
  app.post('/radio/stations/:id/schedule', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const parsed = SlotCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const slot = createScheduleSlot({ station_id: id, owner_id: me, ...parsed.data });
      return reply.code(201).send({ success: true, data: { slot } });
    } catch (e: any) {
      const msg = e?.message ?? 'Create failed';
      if (msg === 'Station not found') return reply.code(404).send({ success: false, error: msg });
      if (msg === 'Not your station') return reply.code(403).send({ success: false, error: msg });
      if (msg.startsWith('Overlaps')) return reply.code(409).send({ success: false, error: msg });
      return reply.code(400).send({ success: false, error: msg });
    }
  });

  // GET /radio/schedule/:id — single slot
  app.get('/radio/schedule/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = getScheduleSlot(id);
    if (!s) return reply.code(404).send({ success: false, error: 'Slot not found' });
    return reply.send({ success: true, data: { slot: s } });
  });

  // PATCH /radio/schedule/:id — update
  app.patch('/radio/schedule/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const parsed = SlotUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const updated = updateScheduleSlot(id, me, parsed.data);
      if (!updated) return reply.code(404).send({ success: false, error: 'Slot not found' });
      return reply.send({ success: true, data: { slot: updated } });
    } catch (e: any) {
      const msg = e?.message ?? 'Forbidden';
      if (msg.startsWith('Overlaps')) return reply.code(409).send({ success: false, error: msg });
      if (msg === 'Not your slot') return reply.code(403).send({ success: false, error: msg });
      return reply.code(400).send({ success: false, error: msg });
    }
  });

  // DELETE /radio/schedule/:id
  app.delete('/radio/schedule/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const removed = deleteScheduleSlot(id, me);
      return reply.send({ success: true, data: { removed } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });


  // ---- Song History / Now Playing (124.4) ----

  const SOURCES = ['playlist','live','manual','schedule'] as const;

  const PlayLogSchema = z.object({
    title: z.string().min(1).max(300),
    artist: z.string().max(200).nullable().optional(),
    album: z.string().max(200).nullable().optional(),
    duration_seconds: z.number().min(0).max(6 * 3600).optional(),
    played_at: z.string().optional(),
    source: z.enum(SOURCES).optional(),
    cover_url: z.string().url().nullable().optional(),
    metadata_json: z.string().max(5000).nullable().optional(),
  });

  // GET /radio/stations/:id/history — list plays (filters)
  app.get('/radio/stations/:id/history', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { from?: string; to?: string; artist?: string; search?: string; limit?: string };
    const plays = listPlays(id, {
      from: q.from,
      to: q.to,
      artist: q.artist,
      search: q.search,
      limit: q.limit ? parseInt(q.limit) : 50,
    });
    return reply.send({ success: true, data: { plays, count: plays.length } });
  });

  // GET /radio/stations/:id/now-playing — current track
  app.get('/radio/stations/:id/now-playing', async (req, reply) => {
    const { id } = req.params as { id: string };
    const play = nowPlaying(id);
    return reply.send({ success: true, data: { play } });
  });

  // GET /radio/stations/:id/history/stats
  app.get('/radio/stations/:id/history/stats', async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: historyStats(id) });
  });

  // POST /radio/stations/:id/history — log a play (owner or worker)
  app.post('/radio/stations/:id/history', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const st = getRadioStation(id);
    if (!st) return reply.code(404).send({ success: false, error: 'Station not found' });
    if (st.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your station' });
    const parsed = PlayLogSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const play = logPlay({ station_id: id, ...parsed.data });
      return reply.code(201).send({ success: true, data: { play } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Log failed' });
    }
  });

  // GET /radio/history/:id — single play
  app.get('/radio/history/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const play = getPlay(id);
    if (!play) return reply.code(404).send({ success: false, error: 'Play not found' });
    return reply.send({ success: true, data: { play } });
  });

  // DELETE /radio/history/:id — delete a play (owner-only)
  app.delete('/radio/history/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const removed = deletePlay(id, me);
      return reply.send({ success: true, data: { removed } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  // POST /radio/stations/:id/history/prune — retention prune (owner or worker)
  app.post('/radio/stations/:id/history/prune', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const st = getRadioStation(id);
    if (!st) return reply.code(404).send({ success: false, error: 'Station not found' });
    if (st.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your station' });
    const body = (req.body ?? {}) as { keep_days?: number };
    const keepDays = Math.max(1, Math.min(body.keep_days ?? 30, 365));
    const pruned = deleteOldPlays(id, keepDays);
    return reply.send({ success: true, data: { pruned, keep_days: keepDays } });
  });

}
