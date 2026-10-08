// melodyflix videos - VR/360 routes (3.6)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '@melodyflix/shared-auth';
import { getDb } from '@melodyflix/shared-db';
import {
  PROJECTIONS, STEREOS, getVrMetadata, setVrMetadata, clearVrMetadata, listVrVideos,
} from '../services/vr.service.js';

const VrUpdateSchema = z.object({
  projection: z.enum(['none', 'equirectangular', 'cubemap']).optional(),
  stereo: z.enum(['mono', 'sbs', 'ou']).optional(),
  fov: z.number().min(30).max(120).optional(),
  initial_yaw: z.number().min(0).max(360).optional(),
  initial_pitch: z.number().min(-90).max(90).optional(),
  has_spatial_audio: z.boolean().optional(),
});

function checkVideoOwner(videoId: string, userId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT owner_id FROM videos WHERE id = ?').get(videoId) as { owner_id: string } | undefined;
  return row?.owner_id === userId;
}

export async function vrRoutes(app: FastifyInstance) {
  // GET /vr/projections — predefined projection + stereo options
  app.get('/vr/options', async (_req, reply) => {
    return reply.send({ success: true, data: { projections: PROJECTIONS, stereos: STEREOS } });
  });

  // GET /vr/videos — list all VR-enabled videos
  app.get('/vr/videos', async (req, reply) => {
    const q = req.query as { limit?: string };
    const limit = Math.min(Math.max(parseInt(q.limit ?? '40') || 40, 1), 100);
    const videos = listVrVideos(limit);
    return reply.send({ success: true, data: { videos } });
  });

  // GET /:videoId/vr — metadata for a video (public)
  app.get('/:videoId/vr', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const meta = getVrMetadata(videoId);
    return reply.send({ success: true, data: { vr: meta } });
  });

  // PUT /:videoId/vr — update metadata (owner only)
  app.put('/:videoId/vr', { preHandler: [authGuard] }, async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkVideoOwner(videoId, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your video' });
    }
    const parsed = VrUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    }
    const meta = setVrMetadata(videoId, parsed.data);
    return reply.send({ success: true, data: { vr: meta } });
  });

  // DELETE /:videoId/vr — clear metadata (revert to 2D) (owner only)
  app.delete('/:videoId/vr', { preHandler: [authGuard] }, async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkVideoOwner(videoId, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your video' });
    }
    const meta = clearVrMetadata(videoId);
    return reply.send({ success: true, data: { vr: meta } });
  });
}
