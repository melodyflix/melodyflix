// melodyflix videos - series HTTP routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, verifyJwt, extractBearerToken } from '@melodyflix/shared-auth';
import {
  createSeries, getSeriesById, listSeriesByChannel, listAllSeries,
  updateSeries, deleteSeries,
  createSeason, listSeasons, deleteSeason,
  createEpisode, listEpisodes, listAllEpisodesForSeries,
  getEpisodeByVideo, updateEpisode, deleteEpisode,
  getNextEpisode, getSeriesWithSeasons,
} from '../services/series.service.js';
import { getDb } from '@melodyflix/shared-db';

function optionalUser(auth?: string) {
  const token = extractBearerToken(auth);
  if (!token) return null;
  return verifyJwt(token);
}

const CreateSeriesSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  cover_url: z.string().max(500).optional(),
  category: z.string().max(30).optional(),
});

const UpdateSeriesSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  cover_url: z.string().max(500).optional(),
  category: z.string().max(30).optional(),
  status: z.enum(['ongoing', 'completed', 'cancelled']).optional(),
});

const CreateSeasonSchema = z.object({
  season_number: z.number().int().min(1).max(100),
  title: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
});

const CreateEpisodeSchema = z.object({
  season_id: z.string().min(1),
  video_id: z.string().min(1),
  episode_number: z.number().int().min(1).max(1000),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  skip_intro_seconds: z.number().min(0).max(600).optional(),
  skip_recap_seconds: z.number().min(0).max(600).optional(),
  skip_credits_seconds: z.number().min(0).max(600).optional(),
  air_date: z.string().optional(),
});

const UpdateEpisodeSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  episode_number: z.number().int().min(1).max(1000).optional(),
  skip_intro_seconds: z.number().min(0).max(600).optional(),
  skip_recap_seconds: z.number().min(0).max(600).optional(),
  skip_credits_seconds: z.number().min(0).max(600).optional(),
  air_date: z.string().optional(),
});

export async function seriesRoutes(app: FastifyInstance) {
  // ============ SERIES ============

  // GET /api/v1/videos/series — all series
  app.get('/series', async (req, reply) => {
    const q = req.query as { limit?: string; offset?: string; channel?: string };
    const limit = Math.min(Number(q.limit ?? 50), 100);
    const offset = Number(q.offset ?? 0);
    const series = q.channel ? listSeriesByChannel(q.channel) : listAllSeries(limit, offset);
    return reply.send({ success: true, data: { series, total: series.length } });
  });

  // POST /api/v1/videos/series — create
  app.post('/series', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = CreateSeriesSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    // Get user's channel
    const db = getDb();
    const channel = db.prepare('SELECT id FROM channels WHERE owner_id = ?').get(user.sub) as { id: string } | undefined;
    if (!channel) return reply.code(400).send({ success: false, error: 'You need a channel first' });

    try {
      const series = createSeries({ channel_id: channel.id, ...parsed.data });
      return reply.code(201).send({ success: true, data: series });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /api/v1/videos/series/:id — full series + seasons + episodes
  app.get('/series/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = getSeriesWithSeasons(id);
    if (!data) return reply.code(404).send({ success: false, error: 'Series not found' });
    const user = optionalUser(req.headers.authorization);
    return reply.send({
      success: true,
      data: { ...data, is_owner: user?.sub === data.series.channel_id },
    });
  });

  // PATCH /api/v1/videos/series/:id
  app.patch('/series/:id', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = UpdateSeriesSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const db = getDb();
    const channel = db.prepare('SELECT id FROM channels WHERE owner_id = ?').get(user.sub) as { id: string } | undefined;
    if (!channel) return reply.code(400).send({ success: false, error: 'No channel' });

    try {
      const { id } = req.params as { id: string };
      const updated = updateSeries(id, channel.id, parsed.data);
      return reply.send({ success: true, data: updated });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /api/v1/videos/series/:id
  app.delete('/series/:id', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const db = getDb();
    const channel = db.prepare('SELECT id FROM channels WHERE owner_id = ?').get(user.sub) as { id: string } | undefined;
    if (!channel) return reply.code(400).send({ success: false, error: 'No channel' });

    try {
      const { id } = req.params as { id: string };
      deleteSeries(id, channel.id);
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // ============ SEASONS ============

  // GET /api/v1/videos/series/:id/seasons
  app.get('/series/:id/seasons', async (req, reply) => {
    const { id } = req.params as { id: string };
    const seasons = listSeasons(id);
    return reply.send({ success: true, data: { seasons } });
  });

  // POST /api/v1/videos/series/:id/seasons
  app.post('/series/:id/seasons', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = CreateSeasonSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const db = getDb();
    const channel = db.prepare('SELECT id FROM channels WHERE owner_id = ?').get(user.sub) as { id: string } | undefined;
    if (!channel) return reply.code(400).send({ success: false, error: 'No channel' });

    try {
      const { id } = req.params as { id: string };
      const season = createSeason(id, channel.id, parsed.data.season_number, parsed.data.title, parsed.data.description);
      return reply.code(201).send({ success: true, data: season });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /api/v1/videos/seasons/:seasonId
  app.delete('/seasons/:seasonId', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const db = getDb();
    const channel = db.prepare('SELECT id FROM channels WHERE owner_id = ?').get(user.sub) as { id: string } | undefined;
    if (!channel) return reply.code(400).send({ success: false, error: 'No channel' });

    try {
      const { seasonId } = req.params as { seasonId: string };
      deleteSeason(seasonId, channel.id);
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // ============ EPISODES ============

  // GET /api/v1/videos/seasons/:seasonId/episodes
  app.get('/seasons/:seasonId/episodes', async (req, reply) => {
    const { seasonId } = req.params as { seasonId: string };
    const episodes = listEpisodes(seasonId);
    return reply.send({ success: true, data: { episodes } });
  });

  // POST /api/v1/videos/series/:id/episodes
  app.post('/series/:id/episodes', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = CreateEpisodeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const db = getDb();
    const channel = db.prepare('SELECT id FROM channels WHERE owner_id = ?').get(user.sub) as { id: string } | undefined;
    if (!channel) return reply.code(400).send({ success: false, error: 'No channel' });

    try {
      const { id } = req.params as { id: string };
      const episode = createEpisode({ series_id: id, ...parsed.data }, channel.id);
      return reply.code(201).send({ success: true, data: episode });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // PATCH /api/v1/videos/episodes/:episodeId
  app.patch('/episodes/:episodeId', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = UpdateEpisodeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const db = getDb();
    const channel = db.prepare('SELECT id FROM channels WHERE owner_id = ?').get(user.sub) as { id: string } | undefined;
    if (!channel) return reply.code(400).send({ success: false, error: 'No channel' });

    try {
      const { episodeId } = req.params as { episodeId: string };
      const updated = updateEpisode(episodeId, channel.id, parsed.data);
      return reply.send({ success: true, data: updated });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /api/v1/videos/episodes/:episodeId
  app.delete('/episodes/:episodeId', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const db = getDb();
    const channel = db.prepare('SELECT id FROM channels WHERE owner_id = ?').get(user.sub) as { id: string } | undefined;
    if (!channel) return reply.code(400).send({ success: false, error: 'No channel' });

    try {
      const { episodeId } = req.params as { episodeId: string };
      deleteEpisode(episodeId, channel.id);
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // ============ NAVIGATION ============

  // GET /api/v1/videos/:videoId/episode-info — is this video part of a series?
  app.get('/:videoId/episode-info', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const episode = getEpisodeByVideo(videoId);
    if (!episode) return reply.send({ success: true, data: { episode: null, series: null, next: null } });

    const series = getSeriesById(episode.series_id);
    const next = getNextEpisode(videoId);

    return reply.send({
      success: true,
      data: {
        episode,
        series,
        next_episode: next.episode,
        next_video: next.video,
      },
    });
  });
}
