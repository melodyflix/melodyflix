// melodyflix videos - Live TV Broadcasting routes (Section 40)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  listChannels, getChannel, createChannel, updateChannel, deleteChannel,
  listCategories, countByOwner, checkStreamHealth, getLatestHealth, listHealthHistory,
  parseM3U, importM3U,
  parseXmltv, importXmltv,
  getEpgForChannel, getNowPlaying, getUpNext,
  getSchedule, getScheduleForChannel,
  ensureLiveTvStateSchema, switchChannel, getWatchState,
  updatePosition, listRecentChannels, clearWatchState,
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

  // ---- M3U/M3U8 Import (40.13) ----

  const ImportSchema = z.object({
    playlist: z.string().min(1).max(2_000_000),
    replace_existing: z.boolean().optional(),
    skip_duplicates_by_url: z.boolean().optional(),
    default_category: z.string().max(80).nullable().optional(),
    is_public: z.boolean().optional(),
  });

  // POST /live-tv/import/m3u/preview — parse only, no DB write
  app.post('/live-tv/import/m3u/preview', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = ImportSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    const channels = parseM3U(parsed.data.playlist);
    return reply.send({ success: true, data: { count: channels.length, channels } });
  });

  // POST /live-tv/import/m3u — parse + insert
  app.post('/live-tv/import/m3u', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = ImportSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    const result = importM3U(me, parsed.data.playlist, {
      replace_existing: parsed.data.replace_existing,
      skip_duplicates_by_url: parsed.data.skip_duplicates_by_url !== false,
      default_category: parsed.data.default_category,
      is_public: parsed.data.is_public,
    });
    return reply.send({ success: true, data: result });
  });


  // ---- XMLTV EPG Import (40.14) ----

  const XmltvImportSchema = z.object({
    xml: z.string().min(1).max(50_000_000),
    replace_programs: z.boolean().optional(),
  });

  // POST /live-tv/import/xmltv/preview — parse only, no DB write
  app.post('/live-tv/import/xmltv/preview', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = XmltvImportSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    const result = parseXmltv(parsed.data.xml);
    return reply.send({
      success: true,
      data: {
        channels_count: result.channels.length,
        programs_count: result.programs.length,
        channels: result.channels,
        programs: result.programs.slice(0, 50),
      },
    });
  });

  // POST /live-tv/import/xmltv — parse + upsert channels + insert programs
  app.post('/live-tv/import/xmltv', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = XmltvImportSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    const result = importXmltv(parsed.data.xml, {
      replace_programs: parsed.data.replace_programs,
    });
    return reply.send({ success: true, data: result });
  });

  // ---- EPG Query (40.2) ----

  // GET /live-tv/epg/:channelId?from=ISO&to=ISO — EPG timeline
  app.get('/live-tv/epg/:channelId', async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const q = req.query as { from?: string; to?: string };
    const entries = getEpgForChannel(channelId, q.from, q.to);
    return reply.send({ success: true, data: { entries, count: entries.length } });
  });

  // GET /live-tv/epg/:channelId/now — currently airing program
  app.get('/live-tv/epg/:channelId/now', async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const q = req.query as { at?: string };
    const entry = getNowPlaying(channelId, q.at);
    return reply.send({ success: true, data: { entry } });
  });

  // GET /live-tv/epg/:channelId/up-next?limit=N — upcoming programs
  app.get('/live-tv/epg/:channelId/up-next', async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const q = req.query as { limit?: string; at?: string };
    const limit = q.limit ? parseInt(q.limit) : 5;
    const entries = getUpNext(channelId, q.at, limit);
    return reply.send({ success: true, data: { entries } });
  });


  // ---- TV Schedule (40.7) ----

  // GET /live-tv/schedule — aggregate now+up_next across channels
  app.get('/live-tv/schedule', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const me = userId(req as any);
    const result = getSchedule({
      at: q.at,
      owner_id: q.mine === 'true' ? (me ?? undefined) : q.owner_id,
      category: q.category,
      limit_channels: q.limit_channels ? parseInt(q.limit_channels) : undefined,
      up_next_limit: q.up_next_limit ? parseInt(q.up_next_limit) : undefined,
    });
    return reply.send({ success: true, data: result });
  });

  // GET /live-tv/schedule/:channelId — single channel timeline
  app.get('/live-tv/schedule/:channelId', async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const q = req.query as { from?: string; to?: string };
    const result = getScheduleForChannel(channelId, { from: q.from, to: q.to });
    if (!result) return reply.code(404).send({ success: false, error: 'Channel not found' });
    return reply.send({ success: true, data: result });
  });


  // ---- Channel Switching / Watch State (40.3) ----

  const SwitchBodySchema = z.object({
    device: z.string().max(80).nullable().optional(),
    resume: z.boolean().optional(),
  });

  const PositionBodySchema = z.object({
    position_seconds: z.number().min(0).max(3600 * 24),
  });

  // POST /live-tv/switch/:channelId — switch to a channel, save state
  app.post('/live-tv/switch/:channelId', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { channelId } = req.params as { channelId: string };
    const body = SwitchBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: body.error.issues });
    }
    try {
      const result = switchChannel(me, channelId, body.data);
      return reply.send({ success: true, data: result });
    } catch (e: any) {
      if (e?.message === 'Channel not found') {
        return reply.code(404).send({ success: false, error: 'Channel not found' });
      }
      throw e;
    }
  });

  // GET /live-tv/state — current watch state + channel
  app.get('/live-tv/state', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const state = getWatchState(me);
    return reply.send({ success: true, data: { state } });
  });

  // PATCH /live-tv/state/position — heartbeat to update position_seconds
  app.patch('/live-tv/state/position', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const body = PositionBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: body.error.issues });
    }
    updatePosition(me, body.data.position_seconds);
    return reply.send({ success: true, data: { updated: true } });
  });

  // DELETE /live-tv/state — stop watching (clear current state, keep recents)
  app.delete('/live-tv/state', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    clearWatchState(me);
    return reply.send({ success: true, data: { cleared: true } });
  });

  // GET /live-tv/recent?limit=N — recently watched channels
  app.get('/live-tv/recent', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const q = req.query as { limit?: string };
    const recent = listRecentChannels(me, q.limit ? parseInt(q.limit) : 10);
    return reply.send({ success: true, data: { recent, count: recent.length } });
  });

}
