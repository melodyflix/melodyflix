// melodyflix videos - search route
import type { FastifyInstance } from 'fastify';
import {
  searchVideos, countSearchResults,
  type SearchSort, type DurationFilter,
} from '../services/video.service.js';

const VALID_SORTS: SearchSort[] = ['relevance', 'date', 'views'];
const VALID_DURATIONS: DurationFilter[] = ['any', 'short', 'medium', 'long'];

export async function searchRoutes(app: FastifyInstance) {
  // GET /api/v1/videos/search?q=...&sort=...&channel=...&duration=...&limit=...&offset=...
  app.get('/search', async (req, reply) => {
    const q = req.query as {
      q?: string;
      sort?: string;
      channel?: string;
      duration?: string;
      limit?: string;
      offset?: string;
    };

    const query = (q.q ?? '').trim();
    const sort = (VALID_SORTS.includes(q.sort as SearchSort) ? q.sort : 'relevance') as SearchSort;
    const duration = (VALID_DURATIONS.includes(q.duration as DurationFilter) ? q.duration : 'any') as DurationFilter;
    const limit = Math.min(Number(q.limit ?? 50), 100);
    const offset = Number(q.offset ?? 0);

    const videos = searchVideos({
      query,
      sort,
      channelId: q.channel,
      duration,
      limit,
      offset,
    });

    const total = countSearchResults({
      query,
      channelId: q.channel,
      duration,
    });

    return reply.send({
      success: true,
      data: {
        videos,
        total,
        query,
        sort,
        duration,
      },
    });
  });
}
