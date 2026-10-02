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
  addFavorite, removeFavorite, toggleFavorite, listFavorites, isFavorite, setFavoriteOrder,
  setPin, getParentalSettings, hasPin, removePin, changePin, updateMaxAgeRating,
  verifyPin, unlockSession, isUnlocked, lockSession,
  blockChannel, unblockChannel, listBlockedChannels, isChannelBlocked,
  checkAccess, setChannelAgeRating,
  postLiveTvChat, listLiveTvChat, deleteLiveTvChat, hideLiveTvChat,
  reportLiveTvChat, countRecentChat, getChatMessageChannelOwner,
  scheduleRecording, getRecording, listRecordings, cancelRecording,
  deleteRecording, getDueRecordings, getExpiredRecordings,
  markRecordingStarted, markRecordingCompleted, markRecordingFailed,
  setRecordingFilePath, recordingStats,
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


  // ---- Channel Favorites (40.11) ----

  // GET /live-tv/favorites — my favorites
  app.get('/live-tv/favorites', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const q = req.query as { limit?: string };
    const favorites = listFavorites(me, q.limit ? parseInt(q.limit) : 200);
    return reply.send({ success: true, data: { favorites, count: favorites.length } });
  });

  // POST /live-tv/favorites/:channelId — add to favorites
  app.post('/live-tv/favorites/:channelId', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { channelId } = req.params as { channelId: string };
    try {
      const fav = addFavorite(me, channelId);
      return reply.send({ success: true, data: { favorite: fav } });
    } catch (e: any) {
      if (e?.message === 'Channel not found') {
        return reply.code(404).send({ success: false, error: 'Channel not found' });
      }
      throw e;
    }
  });

  // DELETE /live-tv/favorites/:channelId — remove from favorites
  app.delete('/live-tv/favorites/:channelId', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { channelId } = req.params as { channelId: string };
    const removed = removeFavorite(me, channelId);
    return reply.send({ success: true, data: { removed } });
  });

  // POST /live-tv/favorites/:channelId/toggle — toggle favorite
  app.post('/live-tv/favorites/:channelId/toggle', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { channelId } = req.params as { channelId: string };
    try {
      const result = toggleFavorite(me, channelId);
      return reply.send({ success: true, data: result });
    } catch (e: any) {
      if (e?.message === 'Channel not found') {
        return reply.code(404).send({ success: false, error: 'Channel not found' });
      }
      throw e;
    }
  });

  // GET /live-tv/favorites/:channelId — check favorite status
  app.get('/live-tv/favorites/:channelId', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { channelId } = req.params as { channelId: string };
    return reply.send({ success: true, data: { favorited: isFavorite(me, channelId) } });
  });

  // PUT /live-tv/favorites/order — reorder favorites
  app.put('/live-tv/favorites/order', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const OrderSchema = z.object({
      channel_ids: z.array(z.string()).max(500),
    });
    const parsed = OrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    setFavoriteOrder(me, parsed.data.channel_ids);
    return reply.send({ success: true, data: { updated: true } });
  });


  // ---- Parental Control (40.12) ----

  const SetPinSchema = z.object({
    pin: z.string().regex(/^\d{4,6}$/),
    max_age_rating: z.number().int().min(0).max(21).optional(),
  });

  const ChangePinSchema = z.object({
    current_pin: z.string().regex(/^\d{4,6}$/),
    new_pin: z.string().regex(/^\d{4,6}$/),
  });

  const VerifyPinSchema = z.object({ pin: z.string().regex(/^\d{4,6}$/) });
  const MaxAgeSchema = z.object({ max_age_rating: z.number().int().min(0).max(21) });

  // GET /live-tv/parental — settings (no hash/salt)
  app.get('/live-tv/parental', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const settings = getParentalSettings(me);
    const unlocked = isUnlocked(me);
    return reply.send({
      success: true,
      data: {
        has_pin: !!settings,
        max_age_rating: settings?.max_age_rating ?? 21,
        unlocked,
        updated_at: settings?.updated_at ?? null,
      },
    });
  });

  // POST /live-tv/parental/pin — set PIN (first time)
  app.post('/live-tv/parental/pin', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (hasPin(me)) {
      return reply.code(409).send({ success: false, error: 'PIN already set — use change endpoint' });
    }
    const parsed = SetPinSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const settings = setPin(me, parsed.data.pin, parsed.data.max_age_rating ?? 18);
      return reply.send({
        success: true,
        data: { has_pin: true, max_age_rating: settings.max_age_rating },
      });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Set PIN failed' });
    }
  });

  // POST /live-tv/parental/pin/change — change PIN
  app.post('/live-tv/parental/pin/change', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = ChangePinSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const ok = changePin(me, parsed.data.current_pin, parsed.data.new_pin);
    if (!ok) return reply.code(403).send({ success: false, error: 'Current PIN incorrect' });
    return reply.send({ success: true, data: { changed: true } });
  });

  // DELETE /live-tv/parental/pin — remove PIN (requires current)
  app.delete('/live-tv/parental/pin', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = VerifyPinSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const ok = removePin(me, parsed.data.pin);
    if (!ok) return reply.code(403).send({ success: false, error: 'Incorrect PIN' });
    return reply.send({ success: true, data: { removed: true } });
  });

  // PATCH /live-tv/parental/max-age — update max age rating
  app.patch('/live-tv/parental/max-age', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = MaxAgeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const settings = updateMaxAgeRating(me, parsed.data.max_age_rating);
    if (!settings) return reply.code(404).send({ success: false, error: 'No PIN set' });
    return reply.send({ success: true, data: { max_age_rating: settings.max_age_rating } });
  });

  // POST /live-tv/parental/unlock — verify PIN → 1h session
  app.post('/live-tv/parental/unlock', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = VerifyPinSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const result = unlockSession(me, parsed.data.pin);
    if (!result) return reply.code(403).send({ success: false, error: 'Incorrect PIN' });
    return reply.send({ success: true, data: result });
  });

  // POST /live-tv/parental/lock — end unlock session
  app.post('/live-tv/parental/lock', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    lockSession(me);
    return reply.send({ success: true, data: { locked: true } });
  });

  // POST /live-tv/parental/verify — check PIN (no session grant)
  app.post('/live-tv/parental/verify', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = VerifyPinSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    return reply.send({ success: true, data: { valid: verifyPin(me, parsed.data.pin) } });
  });

  // ---- Blocked channels ----

  // GET /live-tv/parental/blocked — list
  app.get('/live-tv/parental/blocked', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const blocked = listBlockedChannels(me);
    return reply.send({ success: true, data: { blocked, count: blocked.length } });
  });

  // POST /live-tv/parental/blocked/:channelId — block
  app.post('/live-tv/parental/blocked/:channelId', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { channelId } = req.params as { channelId: string };
    blockChannel(me, channelId);
    return reply.send({ success: true, data: { blocked: true } });
  });

  // DELETE /live-tv/parental/blocked/:channelId — unblock
  app.delete('/live-tv/parental/blocked/:channelId', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { channelId } = req.params as { channelId: string };
    const removed = unblockChannel(me, channelId);
    return reply.send({ success: true, data: { unblocked: removed } });
  });

  // GET /live-tv/parental/blocked/:channelId — status
  app.get('/live-tv/parental/blocked/:channelId', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { channelId } = req.params as { channelId: string };
    return reply.send({ success: true, data: { blocked: isChannelBlocked(me, channelId) } });
  });

  // ---- Access check (public, but uses optional auth) ----

  // GET /live-tv/channels/:id/access — check if user can view
  app.get('/live-tv/channels/:id/access', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = userId(req as any);
    try {
      const result = checkAccess(me, id);
      return reply.send({ success: true, data: result });
    } catch (e: any) {
      if (e?.message === 'Channel not found') {
        return reply.code(404).send({ success: false, error: 'Channel not found' });
      }
      throw e;
    }
  });

  // PATCH /live-tv/channels/:id/age-rating — set age rating (owner only)
  app.patch('/live-tv/channels/:id/age-rating', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const ch = getChannel(id);
    if (!ch) return reply.code(404).send({ success: false, error: 'Channel not found' });
    if (ch.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your channel' });
    const parsed = MaxAgeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const updated = setChannelAgeRating(id, parsed.data.max_age_rating);
    return reply.send({ success: true, data: { channel: updated } });
  });


  // ---- Live TV Chat (40.9) ----

  const ChatPostSchema = z.object({
    content: z.string().min(1).max(500),
  });

  const ChatReportSchema = z.object({
    reason: z.string().max(200).optional(),
  });

  // GET /live-tv/chat/:channelId — poll for recent messages
  app.get('/live-tv/chat/:channelId', async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const q = req.query as { limit?: string; since?: string };
    const limit = q.limit ? parseInt(q.limit) : 100;
    const chat = listLiveTvChat(channelId, { limit, since: q.since });
    const recentCount = countRecentChat(channelId, 60_000);
    return reply.send({
      success: true,
      data: { chat, count: chat.length, recent_per_minute: recentCount },
    });
  });

  // POST /live-tv/chat/:channelId — send a message
  app.post('/live-tv/chat/:channelId', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { channelId } = req.params as { channelId: string };
    const parsed = ChatPostSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    try {
      const message = postLiveTvChat(channelId, me, parsed.data.content);
      return reply.code(201).send({ success: true, data: { message } });
    } catch (e: any) {
      const msg = e?.message ?? 'Send failed';
      if (msg === 'Channel not found') return reply.code(404).send({ success: false, error: msg });
      if (msg === 'Rate limited — wait a few seconds') return reply.code(429).send({ success: false, error: msg });
      if (msg.startsWith('Message too long')) return reply.code(400).send({ success: false, error: msg });
      if (msg === 'Empty message') return reply.code(400).send({ success: false, error: msg });
      return reply.code(500).send({ success: false, error: msg });
    }
  });

  // DELETE /live-tv/chat/messages/:id — delete own message
  app.delete('/live-tv/chat/messages/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const removed = deleteLiveTvChat(id, me);
      return reply.send({ success: true, data: { removed } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  // POST /live-tv/chat/messages/:id/report — flag a message
  app.post('/live-tv/chat/messages/:id/report', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const parsed = ChatReportSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    reportLiveTvChat(id, me, parsed.data.reason);
    return reply.send({ success: true, data: { reported: true } });
  });

  // POST /live-tv/chat/messages/:id/hide — hide message (channel owner only)
  app.post('/live-tv/chat/messages/:id/hide', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const owner = getChatMessageChannelOwner(id);
    if (!owner) return reply.code(404).send({ success: false, error: 'Message not found' });
    if (owner.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your channel' });
    const ok = hideLiveTvChat(id);
    return reply.send({ success: true, data: { hidden: ok } });
  });


  // ---- Live TV Recording / DVR (40.4) ----

  const ScheduleRecordingSchema = z.object({
    channel_id: z.string().min(1),
    title: z.string().max(200).optional(),
    start_ts: z.string(),
    stop_ts: z.string(),
  });

  // GET /live-tv/recordings — list user recordings (owner-scoped)
  app.get('/live-tv/recordings', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const q = req.query as { status?: string; channel_id?: string; from?: string; to?: string; limit?: string };
    const recordings = listRecordings({
      user_id: me,
      status: q.status as any,
      channel_id: q.channel_id,
      from: q.from,
      to: q.to,
      limit: q.limit ? parseInt(q.limit) : 100,
    });
    return reply.send({ success: true, data: { recordings, count: recordings.length } });
  });

  // GET /live-tv/recordings/stats — summary
  app.get('/live-tv/recordings/stats', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    return reply.send({ success: true, data: recordingStats(me) });
  });

  // GET /live-tv/recordings/due — poller: which are due to start now?
  // Simple shared-secret check via header to keep it internal-only
  app.get('/live-tv/recordings/due', async (req, reply) => {
    const secret = req.headers['x-internal-secret'];
    const expected = process.env.MELODYFLIX_INTERNAL_SECRET ?? '';
    if (expected && secret !== expected) {
      return reply.code(403).send({ success: false, error: 'Forbidden' });
    }
    const now = (req.query as { at?: string }).at ?? new Date().toISOString();
    return reply.send({
      success: true,
      data: { due: getDueRecordings(now), expired: getExpiredRecordings(now) },
    });
  });

  // GET /live-tv/recordings/:id — single
  app.get('/live-tv/recordings/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const rec = getRecording(id);
    if (!rec) return reply.code(404).send({ success: false, error: 'Recording not found' });
    if (rec.user_id !== me) return reply.code(403).send({ success: false, error: 'Not your recording' });
    return reply.send({ success: true, data: { recording: rec } });
  });

  // POST /live-tv/recordings — schedule
  app.post('/live-tv/recordings', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = ScheduleRecordingSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    try {
      const rec = scheduleRecording({ ...parsed.data, user_id: me });
      return reply.code(201).send({ success: true, data: { recording: rec } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Schedule failed' });
    }
  });

  // POST /live-tv/recordings/:id/cancel
  app.post('/live-tv/recordings/:id/cancel', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const ok = cancelRecording(id, me);
      if (!ok) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { cancelled: true } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  // DELETE /live-tv/recordings/:id
  app.delete('/live-tv/recordings/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const ok = deleteRecording(id, me);
      if (!ok) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { deleted: true } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  // Internal endpoints for the worker/poller (protected by shared secret)
  app.post('/live-tv/recordings/:id/started', async (req, reply) => {
    const secret = req.headers['x-internal-secret'];
    const expected = process.env.MELODYFLIX_INTERNAL_SECRET ?? '';
    if (expected && secret !== expected) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const { id } = req.params as { id: string };
    const body = req.body as { pid?: number };
    if (!body?.pid) return reply.code(400).send({ success: false, error: 'pid required' });
    markRecordingStarted(id, body.pid);
    return reply.send({ success: true, data: { started: true } });
  });

  app.post('/live-tv/recordings/:id/completed', async (req, reply) => {
    const secret = req.headers['x-internal-secret'];
    const expected = process.env.MELODYFLIX_INTERNAL_SECRET ?? '';
    if (expected && secret !== expected) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const { id } = req.params as { id: string };
    const body = req.body as { file_path?: string; file_size_bytes?: number; duration_seconds?: number };
    if (body?.file_path) setRecordingFilePath(id, body.file_path);
    markRecordingCompleted(id, body?.file_size_bytes ?? 0, body?.duration_seconds ?? 0);
    return reply.send({ success: true, data: { completed: true } });
  });

  app.post('/live-tv/recordings/:id/failed', async (req, reply) => {
    const secret = req.headers['x-internal-secret'];
    const expected = process.env.MELODYFLIX_INTERNAL_SECRET ?? '';
    if (expected && secret !== expected) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const { id } = req.params as { id: string };
    const body = req.body as { error?: string };
    markRecordingFailed(id, body?.error ?? 'unknown');
    return reply.send({ success: true, data: { failed: true } });
  });

}
