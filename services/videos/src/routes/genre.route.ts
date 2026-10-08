// melodyflix videos - genre routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '@melodyflix/shared-auth';
import { getDb } from '@melodyflix/shared-db';
import {
  GENRES, listGenresForVideo, replaceGenres, addGenre, removeGenre,
  listGenresWithCounts, listVideoIdsByGenre,
} from '../services/genre.service.js';

const AddSchema = z.object({
  genre: z.string().min(1).max(40),
});

const ReplaceSchema = z.object({
  genres: z.array(z.string().min(1).max(40)).max(20),
});

function checkVideoOwner(videoId: string, userId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT owner_id FROM videos WHERE id = ?').get(videoId) as { owner_id: string } | undefined;
  return row?.owner_id === userId;
}

export async function genreRoutes(app: FastifyInstance) {
  // GET /genres — list all predefined genres with counts
  app.get('/genres', async (_req, reply) => {
    const genres = listGenresWithCounts();
    return reply.send({ success: true, data: { genres } });
  });

  // GET /:videoId/genres
  app.get('/:videoId/genres', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const genres = listGenresForVideo(videoId);
    return reply.send({ success: true, data: { genres } });
  });

  // POST /:videoId/genres  { genre }
  app.post('/:videoId/genres', { preHandler: [authGuard] }, async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkVideoOwner(videoId, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your video' });
    }
    const parsed = AddSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    try {
      const g = addGenre(videoId, parsed.data.genre);
      return reply.send({ success: true, data: { genre: g } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // PUT /:videoId/genres  { genres: [...] } — replace all
  app.put('/:videoId/genres', { preHandler: [authGuard] }, async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkVideoOwner(videoId, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your video' });
    }
    const parsed = ReplaceSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    const genres = replaceGenres(videoId, parsed.data.genres);
    return reply.send({ success: true, data: { genres } });
  });

  // DELETE /:videoId/genres/:genre
  app.delete('/:videoId/genres/:genre', { preHandler: [authGuard] }, async (req, reply) => {
    const { videoId, genre } = req.params as { videoId: string; genre: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkVideoOwner(videoId, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your video' });
    }
    const removed = removeGenre(videoId, decodeURIComponent(genre));
    return reply.send({ success: true, data: { removed } });
  });

  // GET /genres/:genre/videos
  app.get('/genres/:genre/videos', async (req, reply) => {
    const { genre } = req.params as { genre: string };
    const q = req.query as { limit?: string };
    const limit = Math.min(Math.max(parseInt(q.limit ?? '60') || 60, 1), 100);
    const ids = listVideoIdsByGenre(decodeURIComponent(genre), limit);
    if (ids.length === 0) return reply.send({ success: true, data: { videos: [] } });
    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    const videos = db.prepare(
      `SELECT id, title, thumbnail_url, duration_seconds, channel_id, owner_id, view_count, created_at, status ` +
      `FROM videos WHERE id IN (${placeholders})`
    ).all(...ids);
    return reply.send({ success: true, data: { videos } });
  });

  // GET /genres/list — static predefined list (for dropdowns)
  app.get('/genres/list', async (_req, reply) => {
    return reply.send({ success: true, data: { genres: GENRES } });
  });
}
