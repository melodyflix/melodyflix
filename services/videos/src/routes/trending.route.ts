// melodyflix videos - trending, categories, content-type segregation
import type { FastifyInstance } from 'fastify';
import {
  listTrending, countTrending, listCategories,
  listVideosByCategory, countVideosByCategory,
  listContentTypeStats, listVideosByContentType, countVideosByContentType,
  trendingByContentType, CONTENT_TYPES, contentLabel,
} from '../services/video.service.js';

export async function trendingRoutes(app: FastifyInstance) {
  // GET /trending
  app.get('/trending', async (req, reply) => {
    const q = req.query as { limit?: string; offset?: string; days?: string };
    const limit = Math.min(Number(q.limit ?? 50), 100);
    const offset = Number(q.offset ?? 0);
    const days = Math.min(Number(q.days ?? 7), 30);
    const videos = listTrending(limit, offset, days);
    return reply.send({ success: true, data: { videos, total: countTrending(days), days } });
  });

  // GET /trending/by-category?per_category=3&days=7
  // Home page: top N per content type + label + total for "see more"
  app.get('/trending/by-category', async (req, reply) => {
    const q = req.query as { per_category?: string; days?: string };
    const perCategory = Math.min(Math.max(Number(q.per_category ?? 3), 1), 20);
    const days = Math.min(Math.max(Number(q.days ?? 7), 1), 90);
    const groups = trendingByContentType(perCategory, days);
    return reply.send({
      success: true,
      data: { groups, per_category: perCategory, days },
    });
  });

  // GET /content-types — list all known types with counts
  app.get('/content-types', async (_req, reply) => {
    const stats = listContentTypeStats();
    // also include declared types that have zero rows so UI can show empty pages
    const present = new Set(stats.map((s) => s.content_type));
    const allKnown = CONTENT_TYPES.map((ct) => ({
      content_type: ct,
      label: contentLabel(ct),
      count: present.has(ct) ? (stats.find((s) => s.content_type === ct)?.count ?? 0) : 0,
    }));
    return reply.send({ success: true, data: { content_types: allKnown } });
  });

  // GET /content-type/:contentType?limit=&offset=
  app.get('/content-type/:contentType', async (req, reply) => {
    const { contentType } = req.params as { contentType: string };
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(Number(q.limit ?? 50), 100);
    const offset = Number(q.offset ?? 0);
    const videos = listVideosByContentType(contentType, limit, offset);
    return reply.send({
      success: true,
      data: {
        videos,
        total: countVideosByContentType(contentType),
        content_type: contentType,
        label: contentLabel(contentType),
      },
    });
  });

  // PATCH /content-type/:videoId — admin/owner updates content type
  app.patch('/content-type/:videoId', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const { contentType } = (req.body ?? {}) as { contentType?: string };
    if (!contentType) return reply.code(400).send({ success: false, error: 'contentType required' });
    // Lazy import to avoid top-level import cycle if any
    const { updateVideoContentType } = await import('../services/video.service.js');
    try {
      // requireAuth via shared helper — but we've not added auth here yet.
      // Use existing pattern from other routes: caller passes bearer token
      const { requireAuth } = await import('@melodyflix/shared-auth');
      const user = requireAuth(req.headers.authorization);
      const updated = updateVideoContentType(videoId, user.sub, contentType);
      return reply.send({ success: true, data: updated });
    } catch (err) {
      const msg = (err as Error).message;
      const code = msg === 'Video not found' ? 404 : msg === 'Not authorized' ? 403 : 400;
      return reply.code(code).send({ success: false, error: msg });
    }
  });

  // GET /categories — legacy category (genre-like) list
  app.get('/categories', async (_req, reply) => {
    const categories = listCategories();
    return reply.send({ success: true, data: { categories } });
  });

  // GET /category/:category — legacy
  app.get('/category/:category', async (req, reply) => {
    const { category } = req.params as { category: string };
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(Number(q.limit ?? 50), 100);
    const offset = Number(q.offset ?? 0);
    const videos = listVideosByCategory(category, limit, offset);
    return reply.send({
      success: true,
      data: { videos, total: countVideosByCategory(category), category },
    });
  });
}
