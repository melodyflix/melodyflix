// melodyflix videos — autoplay routes
import type { FastifyInstance } from 'fastify';
import { verifyJwt, extractBearerToken } from '@melodyflix/shared-auth';
import { getAutoplayNext } from '../services/autoplay.service.js';

function optionalUser(authorization: string | undefined) {
  const token = extractBearerToken(authorization);
  if (!token) return null;
  try { return verifyJwt(token); } catch { return null; }
}

export async function autoplayRoutes(app: FastifyInstance) {
  // GET /api/v1/videos/:videoId/autoplay
  // Returns the next video the client should autoplay (respects user preferences).
  app.get('/:videoId/autoplay', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const user = optionalUser(req.headers.authorization);
    try {
      const next = getAutoplayNext(videoId, user?.sub ?? null);
      return reply.send({ success: true, data: { next } });
    } catch (err) {
      return reply.code(404).send({ success: false, error: (err as Error).message });
    }
  });
}
