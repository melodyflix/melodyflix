// melodyflix videos - Watch Later routes
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '@melodyflix/shared-auth';
import { listSavedVideosWithData } from '../services/comment.service.js';

export async function watchLaterRoutes(app: FastifyInstance) {
  app.get('/watch-later/list', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const videos = listSavedVideosWithData(user.sub);
    return reply.send({ success: true, data: { videos, total: videos.length } });
  });
}
