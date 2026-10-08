// melodyflix videos - Watch Later routes (33.1)
import type { FastifyInstance } from 'fastify';
import { authGuard } from '@melodyflix/shared-auth';
import {
  toggleSaveVideo,
  isVideoSaved,
  listSavedVideosWithData,
  listSavedVideos,
} from '../services/comment.service.js';

export async function watchLaterRoutes(app: FastifyInstance) {
  // GET /watch-later/list — full data
  app.get('/watch-later/list', { preHandler: [authGuard] }, async (req, reply) => {
    const user = (req as any).user;
    const videos = listSavedVideosWithData(user.sub);
    return reply.send({ success: true, data: { videos, total: videos.length } });
  });

  // GET /watch-later/ids — just ids (lightweight, for UI state)
  app.get('/watch-later/ids', { preHandler: [authGuard] }, async (req, reply) => {
    const user = (req as any).user;
    return reply.send({ success: true, data: { video_ids: listSavedVideos(user.sub) } });
  });

  // POST /watch-later/:videoId — toggle save (idempotent add)
  app.post('/watch-later/:videoId', { preHandler: [authGuard] }, async (req, reply) => {
    const user = (req as any).user;
    const { videoId } = req.params as { videoId: string };
    const r = toggleSaveVideo(videoId, user.sub);
    return reply.send({ success: true, data: r });
  });

  // DELETE /watch-later/:videoId — explicitly remove
  app.delete('/watch-later/:videoId', { preHandler: [authGuard] }, async (req, reply) => {
    const user = (req as any).user;
    const { videoId } = req.params as { videoId: string };
    const r = toggleSaveVideo(videoId, user.sub);
    if (r.saved) {
      // toggled on instead of off — flip back so delete is idempotent
      toggleSaveVideo(videoId, user.sub);
    }
    return reply.send({ success: true, data: { removed: true } });
  });

  // GET /watch-later/check/:videoId
  app.get('/watch-later/check/:videoId', { preHandler: [authGuard] }, async (req, reply) => {
    const user = (req as any).user;
    const { videoId } = req.params as { videoId: string };
    return reply.send({ success: true, data: { saved: isVideoSaved(videoId, user.sub) } });
  });
}
