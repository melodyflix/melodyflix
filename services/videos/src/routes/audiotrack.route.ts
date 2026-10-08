// melodyflix videos - audio track routes (45.8)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard, verifyJwt, extractBearerToken } from '@melodyflix/shared-auth';
import { getDb } from '@melodyflix/shared-db';
import {
  AUDIO_TRACK_KINDS, listAudioTracks, getAudioTrack, addAudioTrack,
  removeAudioTrack, setDefaultTrack, setUserPreference, getUserPreference,
  ensureMainTrack,
} from '../services/audiotrack.service.js';

const AddSchema = z.object({
  language: z.string().min(2).max(10),
  label: z.string().min(1).max(60).optional(),
  kind: z.enum(['main', 'dub', 'commentary', 'descriptive']).optional(),
  is_default: z.boolean().optional(),
});

const PreferenceSchema = z.object({
  track_id: z.string().min(1),
});

function checkVideoOwner(videoId: string, userId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT owner_id FROM videos WHERE id = ?').get(videoId) as { owner_id: string } | undefined;
  return row?.owner_id === userId;
}

function optionalUser(authorization: string | undefined): string | null {
  const token = extractBearerToken(authorization);
  if (!token) return null;
  try { return verifyJwt(token).sub as string; } catch { return null; }
}

export async function audioTrackRoutes(app: FastifyInstance) {
  // GET /audio-track-kinds — list predefined kinds
  app.get('/audio-track-kinds', async (_req, reply) => {
    return reply.send({ success: true, data: { kinds: AUDIO_TRACK_KINDS } });
  });

  // GET /:videoId/audio-tracks — public list; include user preference if signed in
  app.get('/:videoId/audio-tracks', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const userId = optionalUser(req.headers.authorization);
    ensureMainTrack(videoId, 'und');
    const tracks = listAudioTracks(videoId);
    const preference = userId ? getUserPreference(userId, videoId) : null;
    const defaultTrack = tracks.find((t) => t.is_default === 1)?.id ?? tracks[0]?.id ?? null;
    return reply.send({
      success: true,
      data: { tracks, preference, defaultTrack },
    });
  });

  // POST /:videoId/audio-tracks — owner only
  app.post('/:videoId/audio-tracks', { preHandler: [authGuard] }, async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkVideoOwner(videoId, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your video' });
    }
    const parsed = AddSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    }
    try {
      const track = addAudioTrack(videoId, parsed.data);
      return reply.send({ success: true, data: { track } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /audio-tracks/:trackId/set-default — owner only
  app.post('/audio-tracks/:trackId/set-default', { preHandler: [authGuard] }, async (req, reply) => {
    const { trackId } = req.params as { trackId: string };
    const track = getAudioTrack(trackId);
    if (!track) return reply.code(404).send({ success: false, error: 'Track not found' });
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!checkVideoOwner(track.video_id, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your video' });
    }
    setDefaultTrack(trackId);
    return reply.send({ success: true, data: { ok: true } });
  });

  // DELETE /audio-tracks/:trackId — owner only
  app.delete('/audio-tracks/:trackId', { preHandler: [authGuard] }, async (req, reply) => {
    const { trackId } = req.params as { trackId: string };
    const track = getAudioTrack(trackId);
    if (!track) return reply.code(404).send({ success: false, error: 'Track not found' });
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!checkVideoOwner(track.video_id, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your video' });
    }
    removeAudioTrack(trackId);
    return reply.send({ success: true, data: { deleted: true } });
  });

  // POST /:videoId/audio-tracks/preference { track_id } — signed-in user
  app.post('/:videoId/audio-tracks/preference', { preHandler: [authGuard] }, async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = PreferenceSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    try {
      setUserPreference(userId, videoId, parsed.data.track_id);
      return reply.send({ success: true, data: { ok: true } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });
}
