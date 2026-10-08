// melodyflix videos — AI Media routes (8.3, 8.5, 8.8, 8.9, 8.10)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '@melodyflix/shared-auth';
import {
  listThumbnails, selectThumbnail, generateThumbnails,
  getDub, listDubs, upsertDub, requestDubbing,
  getVoiceClone, listVoiceClones, createVoiceClone, revokeVoiceClone,
  createRealtimeSession, getRealtimeSession, listRealtimeSessions,
  updateRealtimeSessionStatus,
  getAiMediaSummary,
} from '../services/ai-media.service.js';

function userId(req: any): string | null {
  return req.user?.id ?? req.user?.sub ?? null;
}

function checkInternalSecret(req: any): boolean {
  const secret = req.headers['x-internal-secret'];
  const expected = process.env.MELODYFLIX_INTERNAL_SECRET ?? '';
  if (!expected) return true;
  return secret === expected;
}

export async function aiMediaRoutes(app: FastifyInstance) {
  // ---- Dashboard ----
  app.get('/ai/media/summary', { preHandler: [authGuard] }, async (_req, reply) => {
    return reply.send({ success: true, data: getAiMediaSummary() });
  });

  // ============================================================
  // 8.5 Thumbnails
  // ============================================================

  app.get('/ai/videos/:videoId/thumbnails', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const thumbnails = listThumbnails(videoId);
    return reply.send({ success: true, data: { thumbnails, count: thumbnails.length } });
  });

  const ThumbGenSchema = z.object({
    title: z.string().max(300).optional(),
    style: z.string().max(40).optional(),
    count: z.number().int().min(1).max(8).optional(),
  });

  app.post('/ai/videos/:videoId/thumbnails/generate', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { videoId } = req.params as { videoId: string };
    const parsed = ThumbGenSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const result = await generateThumbnails({ video_id: videoId, requester_id: me, ...parsed.data });
      return reply.code(201).send({ success: true, data: result });
    } catch (e: any) {
      return reply.code(500).send({ success: false, error: e?.message ?? 'Generation failed' });
    }
  });

  app.post('/ai/videos/:videoId/thumbnails/:thumbId/select', { preHandler: [authGuard] }, async (req, reply) => {
    const { videoId, thumbId } = req.params as { videoId: string; thumbId: string };
    const t = selectThumbnail(videoId, thumbId);
    if (!t) return reply.code(404).send({ success: false, error: 'Thumbnail not found' });
    return reply.send({ success: true, data: { thumbnail: t } });
  });

  // ============================================================
  // 8.3 + 8.8 Dubbing
  // ============================================================

  app.get('/ai/videos/:videoId/dubs', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const dubs = listDubs(videoId);
    return reply.send({ success: true, data: { dubs, count: dubs.length } });
  });

  app.get('/ai/videos/:videoId/dubs/:language', async (req, reply) => {
    const { videoId, language } = req.params as { videoId: string; language: string };
    const dub = getDub(videoId, language);
    if (!dub) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.send({ success: true, data: { dub } });
  });

  const DubRequestSchema = z.object({
    target_language: z.string().min(2).max(8),
    voice_id: z.string().max(80).nullable().optional(),
  });

  app.post('/ai/videos/:videoId/dubs', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { videoId } = req.params as { videoId: string };
    const parsed = DubRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const result = await requestDubbing({ video_id: videoId, requester_id: me, ...parsed.data });
      return reply.code(202).send({ success: true, data: result });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Dubbing failed' });
    }
  });

  // Internal: worker updates dub state
  const DubUpdateSchema = z.object({
    status: z.enum(['queued', 'running', 'ready', 'failed', 'cancelled']),
    audio_url: z.string().url().nullable().optional(),
    subtitle_url: z.string().url().nullable().optional(),
    voice_id: z.string().max(80).nullable().optional(),
    voice_provider: z.string().max(80).nullable().optional(),
    error_message: z.string().max(500).nullable().optional(),
  });

  app.post('/ai/worker/dubs/:videoId/:language', async (req, reply) => {
    if (!checkInternalSecret(req)) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const { videoId, language } = req.params as { videoId: string; language: string };
    const parsed = DubUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const dub = upsertDub({
      video_id: videoId,
      target_language: language,
      status: parsed.data.status,
      audio_url: parsed.data.audio_url,
      subtitle_url: parsed.data.subtitle_url,
      voice_id: parsed.data.voice_id,
      voice_provider: parsed.data.voice_provider,
      error_message: parsed.data.error_message,
      is_auto: true,
    });
    return reply.send({ success: true, data: { dub } });
  });

  // ============================================================
  // 8.9 Voice Cloning
  // ============================================================

  app.get('/ai/voice-clones', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const clones = listVoiceClones(me);
    return reply.send({ success: true, data: { clones, count: clones.length } });
  });

  const VoiceCloneSchema = z.object({
    name: z.string().min(1).max(60),
    sample_url: z.string().url(),
    language: z.string().max(8).nullable().optional(),
    consent_confirmed: z.boolean(),
  });

  app.post('/ai/voice-clones', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = VoiceCloneSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    if (!parsed.data.consent_confirmed) {
      return reply.code(400).send({ success: false, error: 'Consent confirmation required' });
    }
    try {
      const result = await createVoiceClone({ owner_id: me, ...parsed.data });
      return reply.code(201).send({ success: true, data: result });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Create failed' });
    }
  });

  app.get('/ai/voice-clones/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const c = getVoiceClone(id);
    if (!c) return reply.code(404).send({ success: false, error: 'Not found' });
    if (c.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your clone' });
    return reply.send({ success: true, data: { clone: c } });
  });

  app.post('/ai/voice-clones/:id/revoke', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const c = revokeVoiceClone(id, me);
      if (!c) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { clone: c } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  // ============================================================
  // 8.10 Real-Time Audio Translation
  // ============================================================

  const RealtimeSchema = z.object({
    video_id: z.string().min(1),
    source_language: z.string().min(2).max(8),
    target_languages: z.array(z.string().min(2).max(8)).min(1).max(6),
    latency_target_ms: z.number().int().min(300).max(4000).optional(),
  });

  app.post('/ai/realtime/sessions', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = RealtimeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const session = createRealtimeSession({ requester_id: me, ...parsed.data });
      return reply.code(201).send({ success: true, data: { session } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Create failed' });
    }
  });

  app.get('/ai/realtime/sessions/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const s = getRealtimeSession(id);
    if (!s) return reply.code(404).send({ success: false, error: 'Not found' });
    if (s.requester_id !== me) return reply.code(403).send({ success: false, error: 'Not your session' });
    return reply.send({ success: true, data: { session: s } });
  });

  app.get('/ai/videos/:videoId/realtime/sessions', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const list = listRealtimeSessions(videoId);
    return reply.send({ success: true, data: { sessions: list, count: list.length } });
  });

  const RealtimeUpdateSchema = z.object({
    status: z.enum(['ready', 'active', 'ended']),
  });

  app.post('/ai/realtime/sessions/:id/status', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const parsed = RealtimeUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    const s = getRealtimeSession(id);
    if (!s) return reply.code(404).send({ success: false, error: 'Not found' });
    if (s.requester_id !== me) return reply.code(403).send({ success: false, error: 'Not your session' });
    const updated = updateRealtimeSessionStatus(id, parsed.data.status);
    return reply.send({ success: true, data: { session: updated } });
  });
}
