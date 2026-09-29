// melodyflix videos - trending & categories routes
import type { FastifyInstance } from 'fastify';
import {
  listTrending, countTrending, listCategories,
  listVideosByCategory, countVideosByCategory,
} from '../services/video.service.js';

export async function trendingRoutes(app: FastifyInstance) {
  // GET /api/v1/videos/trending
  app.get('/trending', async (req, reply) => {
    const q = req.query as { limit?: string; offset?: string; days?: string };
    const limit = Math.min(Number(q.limit ?? 50), 100);
    const offset = Number(q.offset ?? 0);
    const days = Math.min(Number(q.days ?? 7), 30);
    const videos = listTrending(limit, offset, days);
    return reply.send({
      success: true,
      data: { videos, total: countTrending(days), days },
    });
  });

  // GET /api/v1/videos/categories
  app.get('/categories', async (req, reply) => {
    const categories = listCategories();
    return reply.send({ success: true, data: { categories } });
  });

  // GET /api/v1/videos/category/:category
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
