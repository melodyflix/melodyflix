// melodyflix videos - subtitle routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, verifyJwt, extractBearerToken } from '@melodyflix/shared-auth';
import { getDb } from '@melodyflix/shared-db';
import {
  listSubtitles, getSubtitle, uploadSubtitle, deleteSubtitle,
  setDefaultSubtitle, getSubtitleAsVtt, getDefaultSubtitle,
} from '../services/subtitle.service.js';

const UploadSchema = z.object({
  language: z.string().min(2).max(10),
  label: z.string().min(1).max(60),
  format: z.enum(['srt', 'vtt']),
  kind: z.enum(['subtitles', 'captions']).optional(),
  content: z.string().min(1).max(500_000),
  is_default: z.boolean().optional(),
});

function checkVideoOwner(videoId: string, userId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT owner_id FROM videos WHERE id = ?').get(videoId) as { owner_id: string } | undefined;
  return row?.owner_id === userId;
}

export async function subtitleRoutes(app: FastifyInstance) {
  // GET /:videoId/subtitles — list all tracks (no content)
  app.get('/:videoId/subtitles', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const tracks = listSubtitles(videoId);
    return reply.send({ success: true, data: { subtitles: tracks } });
  });

  // GET /:videoId/subtitles/default.vtt — default track (for HLS integration)
  app.get('/:videoId/subtitles/default.vtt', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const kind = ((req.query as any).kind === 'captions' ? 'captions' : 'subtitles') as 'subtitles' | 'captions';
    const track = getDefaultSubtitle(videoId, kind);
    if (!track) {
      return reply.code(404).header('Content-Type', 'text/plain').send('No default subtitle');
    }
    const vtt = getSubtitleAsVtt(track.id) ?? '';
    reply.header('Content-Type', 'text/vtt; charset=utf-8');
    reply.header('Cache-Control', 'public, max-age=300');
    return reply.send(vtt);
  });

  // GET /subtitles/:trackId.vtt — a specific track as VTT
  app.get('/subtitles/:trackId.vtt', async (req, reply) => {
    const { trackId } = req.params as { trackId: string };
    const cleanId = trackId.replace(/\.vtt$/, '');
    const vtt = getSubtitleAsVtt(cleanId);
    if (!vtt) return reply.code(404).send('Not found');
    reply.header('Content-Type', 'text/vtt; charset=utf-8');
    reply.header('Cache-Control', 'public, max-age=300');
    return reply.send(vtt);
  });

  // GET /subtitles/:trackId/raw — raw content for editor
  app.get('/subtitles/:trackId/raw', { preHandler: [requireAuth] }, async (req, reply) => {
    const { trackId } = req.params as { trackId: string };
    const track = getSubtitle(trackId);
    if (!track) return reply.code(404).send({ success: false, error: 'Not found' });
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!checkVideoOwner(track.video_id, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your video' });
    }
    return reply.send({ success: true, data: { track } });
  });

  // POST /:videoId/subtitles — upload a new track (SRT or VTT)
  app.post('/:videoId/subtitles', { preHandler: [requireAuth] }, async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkVideoOwner(videoId, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your video' });
    }
    const parsed = UploadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    }
    try {
      const track = uploadSubtitle(videoId, parsed.data);
      return reply.send({ success: true, data: { track } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /subtitles/:trackId/set-default
  app.post('/subtitles/:trackId/set-default', { preHandler: [requireAuth] }, async (req, reply) => {
    const { trackId } = req.params as { trackId: string };
    const track = getSubtitle(trackId);
    if (!track) return reply.code(404).send({ success: false, error: 'Not found' });
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!checkVideoOwner(track.video_id, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your video' });
    }
    setDefaultSubtitle(trackId);
    return reply.send({ success: true, data: { ok: true } });
  });

  // DELETE /subtitles/:trackId
  app.delete('/subtitles/:trackId', { preHandler: [requireAuth] }, async (req, reply) => {
    const { trackId } = req.params as { trackId: string };
    const track = getSubtitle(trackId);
    if (!track) return reply.code(404).send({ success: false, error: 'Not found' });
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!checkVideoOwner(track.video_id, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your video' });
    }
    deleteSubtitle(trackId);
    return reply.send({ success: true, data: { deleted: true } });
  });
}
