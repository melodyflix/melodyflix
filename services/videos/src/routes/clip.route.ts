// melodyflix videos - clip routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard, verifyJwt, extractBearerToken } from '@melodyflix/shared-auth';
import {
  createClip, getClip, listClipsForVideo, listClipsByCreator,
  incrementClipView, deleteClip,
} from '../services/clip.service.js';

const CreateSchema = z.object({
  title: z.string().min(1).max(200),
  start_seconds: z.number().min(0),
  end_seconds: z.number().min(0),
});

function optionalUser(authorization: string | undefined): { id: string; role?: string } | null {
  const token = extractBearerToken(authorization);
  if (!token) return null;
  try {
    const payload = verifyJwt(token);
    return { id: payload.sub as string, role: payload.role as string | undefined };
  } catch {
    return null;
  }
}

export async function clipRoutes(app: FastifyInstance) {
  // GET /:videoId/clips
  app.get('/:videoId/clips', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const clips = listClipsForVideo(videoId);
    return reply.send({ success: true, data: { clips } });
  });

  // POST /:videoId/clips
  app.post('/:videoId/clips', { preHandler: [authGuard] }, async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    }
    try {
      const clip = createClip(
        videoId,
        userId,
        parsed.data.title,
        parsed.data.start_seconds,
        parsed.data.end_seconds,
      );
      return reply.send({ success: true, data: { clip } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /clips/:clipId — public clip view
  app.get('/clips/:clipId', async (req, reply) => {
    const { clipId } = req.params as { clipId: string };
    const clip = getClip(clipId);
    if (!clip) return reply.code(404).send({ success: false, error: 'Clip not found' });
    return reply.send({ success: true, data: { clip } });
  });

  // POST /clips/:clipId/view — increment view count
  app.post('/clips/:clipId/view', async (req, reply) => {
    const { clipId } = req.params as { clipId: string };
    const clip = getClip(clipId);
    if (!clip) return reply.code(404).send({ success: false, error: 'Clip not found' });
    incrementClipView(clipId);
    return reply.send({ success: true, data: { counted: true } });
  });

  // GET /clips/mine — my clips
  app.get('/clips/mine', { preHandler: [authGuard] }, async (req, reply) => {
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const clips = listClipsByCreator(userId);
    return reply.send({ success: true, data: { clips } });
  });

  // DELETE /clips/:clipId
  app.delete('/clips/:clipId', { preHandler: [authGuard] }, async (req, reply) => {
    const { clipId } = req.params as { clipId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    const role = (req as any).user?.role;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    try {
      deleteClip(clipId, userId, role === 'admin');
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });
}
