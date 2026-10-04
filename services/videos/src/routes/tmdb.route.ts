// melodyflix videos — TMDB/IMDb Metadata routes (Section 149)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  searchTmdb, getTmdbDetail, getTmdbDetailInLanguage, fetchImdbRating,
  importMovieToVideo, importTvShowToSeries, importEpisodeToVideo,
  resyncImport, getImport, getImportByTmdbId, getImportByVideo, getImportBySeries,
  listImports, deleteImport, normalizeCastCrew,
} from '../services/tmdb.service.js';
import { isIntegrationReady } from '../services/integration-settings.service.js';

const SearchSchema = z.object({
  query: z.string().min(1).max(200),
  type: z.enum(['movie', 'tv', 'multi']).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  page: z.number().int().min(1).max(500).optional(),
});

const ImportMovieSchema = z.object({
  tmdb_id: z.number().int().positive(),
  video_id: z.string().uuid(),
  fetch_imdb: z.boolean().optional(),
});

const ImportTvSchema = z.object({
  tmdb_id: z.number().int().positive(),
  series_id: z.string().uuid(),
  fetch_imdb: z.boolean().optional(),
});

const ImportEpisodeSchema = z.object({
  tmdb_id: z.number().int().positive(),
  season_number: z.number().int().min(0),
  episode_number: z.number().int().min(0),
  video_id: z.string().uuid(),
});

const DetailQuery = z.object({
  type: z.enum(['movie', 'tv']),
});

async function requireAdminOrCreator(authorization: string | undefined) {
  const payload = requireAuth(authorization);
  if (payload.role !== 'admin' && payload.role !== 'creator') {
    throw new Error('Admin or creator only');
  }
  return payload;
}

function wrapError(reply: any, err: unknown) {
  const message = (err as Error).message;
  const code = message.includes('not configured') || message.includes('integration') ? 503
    : message.includes('only') || message.includes('Admin') ? 403
    : message.includes('TMDB API') ? 502
    : 400;
  return reply.code(code).send({ success: false, error: message });
}

export async function tmdbRoutes(app: FastifyInstance) {
  // ============================================================
  // Configuration check (public — no credentials needed)
  // ============================================================

  // GET /tmdb/status — is TMDB integration ready?
  app.get('/tmdb/status', async (_req, reply) => {
    return reply.send({
      success: true,
      data: {
        tmdb_ready: isIntegrationReady('tmdb'),
        omdb_ready: isIntegrationReady('omdb'),
        hint: isIntegrationReady('tmdb')
          ? 'TMDB is configured and ready'
          : 'Configure TMDB API key in admin panel > Integrations',
      },
    });
  });

  // ============================================================
  // 149.1 — Search & Match
  // ============================================================

  // POST /tmdb/search
  app.post('/tmdb/search', async (req, reply) => {
    const parsed = SearchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const results = await searchTmdb(parsed.data.query, {
        type: parsed.data.type, year: parsed.data.year, page: parsed.data.page,
      });
      return reply.send({ success: true, data: { results } });
    } catch (err) { return wrapError(reply, err); }
  });

  // GET /tmdb/search?query=...&type=movie|tv|multi&year=&page=
  app.get('/tmdb/search', async (req, reply) => {
    const q = req.query as any;
    if (!q.query) return reply.code(400).send({ success: false, error: 'query required' });
    const parsed = SearchSchema.safeParse({
      query: q.query, type: q.type, year: q.year ? parseInt(q.year) : undefined,
      page: q.page ? parseInt(q.page) : undefined,
    });
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const results = await searchTmdb(parsed.data.query, {
        type: parsed.data.type, year: parsed.data.year, page: parsed.data.page,
      });
      return reply.send({ success: true, data: { results } });
    } catch (err) { return wrapError(reply, err); }
  });

  // ============================================================
  // 149.2 / 149.3 — Detail
  // ============================================================

  // GET /tmdb/detail/:mediaType/:tmdbId  (mediaType = movie|tv)
  app.get('/tmdb/detail/:mediaType/:tmdbId', async (req, reply) => {
    const { mediaType, tmdbId } = req.params as { mediaType: string; tmdbId: string };
    const parsed = DetailQuery.safeParse({ type: mediaType });
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'mediaType must be movie or tv' });
    const idNum = parseInt(tmdbId, 10);
    if (!idNum || idNum <= 0) return reply.code(400).send({ success: false, error: 'invalid tmdb id' });
    try {
      const detail = await getTmdbDetail(idNum, parsed.data.type);
      const castcrew = normalizeCastCrew(detail);
      return reply.send({ success: true, data: { detail, castcrew } });
    } catch (err) { return wrapError(reply, err); }
  });

  // GET /tmdb/detail/:mediaType/:tmdbId/:language
  app.get('/tmdb/detail/:mediaType/:tmdbId/:language', async (req, reply) => {
    const { mediaType, tmdbId, language } = req.params as { mediaType: string; tmdbId: string; language: string };
    const parsed = DetailQuery.safeParse({ type: mediaType });
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'mediaType must be movie or tv' });
    const idNum = parseInt(tmdbId, 10);
    if (!idNum || idNum <= 0) return reply.code(400).send({ success: false, error: 'invalid tmdb id' });
    try {
      const detail = await getTmdbDetailInLanguage(idNum, parsed.data.type, language);
      return reply.send({ success: true, data: { detail } });
    } catch (err) { return wrapError(reply, err); }
  });

  // GET /tmdb/imdb-rating/:imdbId (149.7)
  app.get('/tmdb/imdb-rating/:imdbId', async (req, reply) => {
    const { imdbId } = req.params as { imdbId: string };
    try {
      const rating = await fetchImdbRating(imdbId);
      if (!rating) return reply.code(404).send({ success: false, error: 'IMDb rating not available (OMDb not configured or title not found)' });
      return reply.send({ success: true, data: rating });
    } catch (err) { return wrapError(reply, err); }
  });

  // ============================================================
  // 149.2 / 149.3 / 149.9 — Import
  // ============================================================

  // POST /tmdb/import/movie
  app.post('/tmdb/import/movie', async (req, reply) => {
    let userId: string;
    try { const p = await requireAdminOrCreator(req.headers.authorization); userId = p.sub as string; }
    catch (err) { return wrapError(reply, err); }
    const parsed = ImportMovieSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const record = await importMovieToVideo({
        tmdb_id: parsed.data.tmdb_id, video_id: parsed.data.video_id,
        imported_by: userId, fetch_imdb: parsed.data.fetch_imdb,
      });
      return reply.code(201).send({ success: true, data: record });
    } catch (err) { return wrapError(reply, err); }
  });

  // POST /tmdb/import/tv
  app.post('/tmdb/import/tv', async (req, reply) => {
    let userId: string;
    try { const p = await requireAdminOrCreator(req.headers.authorization); userId = p.sub as string; }
    catch (err) { return wrapError(reply, err); }
    const parsed = ImportTvSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const record = await importTvShowToSeries({
        tmdb_id: parsed.data.tmdb_id, series_id: parsed.data.series_id,
        imported_by: userId, fetch_imdb: parsed.data.fetch_imdb,
      });
      return reply.code(201).send({ success: true, data: record });
    } catch (err) { return wrapError(reply, err); }
  });

  // POST /tmdb/import/episode
  app.post('/tmdb/import/episode', async (req, reply) => {
    let userId: string;
    try { const p = await requireAdminOrCreator(req.headers.authorization); userId = p.sub as string; }
    catch (err) { return wrapError(reply, err); }
    const parsed = ImportEpisodeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const record = await importEpisodeToVideo({
        tmdb_id: parsed.data.tmdb_id, season_number: parsed.data.season_number,
        episode_number: parsed.data.episode_number, video_id: parsed.data.video_id,
        imported_by: userId,
      });
      return reply.code(201).send({ success: true, data: record });
    } catch (err) { return wrapError(reply, err); }
  });

  // ============================================================
  // 149.10 — Sync
  // ============================================================

  // POST /tmdb/imports/:id/resync
  app.post('/tmdb/imports/:id/resync', async (req, reply) => {
    try { await requireAdminOrCreator(req.headers.authorization); }
    catch (err) { return wrapError(reply, err); }
    const { id } = req.params as { id: string };
    try {
      const record = await resyncImport(id);
      return reply.send({ success: true, data: record });
    } catch (err) { return wrapError(reply, err); }
  });

  // ============================================================
  // Import records
  // ============================================================

  // GET /tmdb/imports?media_type=&limit=&offset=
  app.get('/tmdb/imports', async (req, reply) => {
    const q = req.query as any;
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    const offset = q.offset ? Math.max(parseInt(q.offset) || 0, 0) : 0;
    const media_type = ['movie', 'tv'].includes(q.media_type) ? q.media_type : undefined;
    const imports = listImports({ media_type, limit, offset });
    return reply.send({ success: true, data: { imports } });
  });

  // GET /tmdb/imports/:id
  app.get('/tmdb/imports/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = getImport(id);
    if (!record) return reply.code(404).send({ success: false, error: 'Import not found' });
    return reply.send({ success: true, data: record });
  });

  // GET /tmdb/imports/by-video/:videoId
  app.get('/tmdb/imports/by-video/:videoId', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const record = getImportByVideo(videoId);
    if (!record) return reply.code(404).send({ success: false, error: 'No import for this video' });
    return reply.send({ success: true, data: record });
  });

  // GET /tmdb/imports/by-series/:seriesId
  app.get('/tmdb/imports/by-series/:seriesId', async (req, reply) => {
    const { seriesId } = req.params as { seriesId: string };
    const record = getImportBySeries(seriesId);
    if (!record) return reply.code(404).send({ success: false, error: 'No import for this series' });
    return reply.send({ success: true, data: record });
  });

  // GET /tmdb/imports/by-tmdb/:mediaType/:tmdbId
  app.get('/tmdb/imports/by-tmdb/:mediaType/:tmdbId', async (req, reply) => {
    const { mediaType, tmdbId } = req.params as { mediaType: string; tmdbId: string };
    if (mediaType !== 'movie' && mediaType !== 'tv') {
      return reply.code(400).send({ success: false, error: 'mediaType must be movie or tv' });
    }
    const idNum = parseInt(tmdbId, 10);
    if (!idNum) return reply.code(400).send({ success: false, error: 'invalid tmdb id' });
    const record = getImportByTmdbId(idNum, mediaType);
    if (!record) return reply.code(404).send({ success: false, error: 'Import not found' });
    return reply.send({ success: true, data: record });
  });

  // DELETE /tmdb/imports/:id  (admin only)
  app.delete('/tmdb/imports/:id', async (req, reply) => {
    try {
      const p = requireAuth(req.headers.authorization);
      if (p.role !== 'admin') return reply.code(403).send({ success: false, error: 'Admin only' });
    } catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const ok = deleteImport(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Import not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });
}
