// melodyflix videos — Discovery routes (Section 5.5, 5.7, 5.12, 5.13, 5.14)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  getRelatedVideos, getUpNext,
  getPersonalizedHomepage,
  getRecommendations,
  searchByDetectedLabel,
} from '../services/discovery.service.js';

function userId(req: any): string | null {
  return req.user?.id ?? req.user?.sub ?? null;
}

export async function discoveryRoutes(app: FastifyInstance) {
  // 5.12 Related
  app.get('/videos/:videoId/related', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { limit?: string };
    const videos = getRelatedVideos(videoId, q.limit ? parseInt(q.limit) : 20);
    return reply.send({ success: true, data: { videos, count: videos.length } });
  });

  // 5.13 Up Next
  app.get('/videos/:videoId/up-next', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { limit?: string };
    const items = getUpNext(videoId, q.limit ? parseInt(q.limit) : 5);
    return reply.send({ success: true, data: { items, count: items.length } });
  });

  // 5.14 Personalized homepage
  app.get('/home/feed', async (req, reply) => {
    const me = userId(req as any);
    const q = req.query as { max_shelves?: string; max_per_shelf?: string };
    const result = getPersonalizedHomepage(me, {
      maxShelves: q.max_shelves ? parseInt(q.max_shelves) : undefined,
      maxPerShelf: q.max_per_shelf ? parseInt(q.max_per_shelf) : undefined,
    });
    return reply.send({ success: true, data: result });
  });

  // 5.5 Recommendations
  app.get('/recommendations', async (req, reply) => {
    const me = userId(req as any);
    const q = req.query as { limit?: string; category?: string; exclude?: string };
    const exclude = q.exclude ? q.exclude.split(',').filter(Boolean).slice(0, 200) : [];
    const recs = getRecommendations({
      userId: me,
      excludeVideoIds: exclude,
      category: q.category,
      limit: q.limit ? parseInt(q.limit) : 20,
    });
    return reply.send({ success: true, data: { recommendations: recs, count: recs.length } });
  });

  // 5.7 Object/Face search (metadata-only; returns [] if ML tables absent)
  const ObjectSearchSchema = z.object({
    kind: z.enum(['object', 'face']),
    label: z.string().min(1).max(80),
    limit: z.number().int().min(1).max(200).optional(),
  });

  app.post('/videos/:videoId/detected-search', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const parsed = ObjectSearchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    const results = searchByDetectedLabel(videoId, parsed.data);
    return reply.send({ success: true, data: { results, count: results.length } });
  });
}
