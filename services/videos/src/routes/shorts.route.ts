// melodyflix videos - shorts routes
import type { FastifyInstance } from 'fastify';
import { listShorts, countShorts, listShortsByChannel } from '../services/video.service.js';

export async function shortRoutes(app: FastifyInstance) {
  // GET /api/v1/videos/shorts
  app.get('/shorts', async (req, reply) => {
    const q = req.query as { limit?: string; offset?: string; channel?: string };
    const limit = Math.min(Number(q.limit ?? 50), 100);
    const offset = Number(q.offset ?? 0);

    const shorts = q.channel
      ? listShortsByChannel(q.channel, limit, offset)
      : listShorts(limit, offset);

    return reply.send({
      success: true,
      data: {
        shorts,
        total: q.channel ? shorts.length : countShorts(),
      },
    });
  });
}
