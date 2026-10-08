// melodyflix videos — AI Features routes (Section 8)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '@melodyflix/shared-auth';
import {
  getAiJob, listAiJobs, listQueuedAiJobs, cancelAiJob,
  markAiJobRunning, markAiJobDone, markAiJobFailed,
  getCaption, saveCaption, generateCaption,
  getTranslation, listTranslations, translateText,
  getSummary, generateSummary,
  listKeyMoments, detectKeyMoments,
  suggestTags, getAiSummary,
} from '../services/ai.service.js';

function userId(req: any): string | null {
  return req.user?.id ?? req.user?.sub ?? null;
}

function isAdmin(req: any): boolean {
  const u = req.user as any;
  const roles = u?.roles ?? [];
  return Array.isArray(roles) && roles.includes('admin');
}

function checkInternalSecret(req: any): boolean {
  const secret = req.headers['x-internal-secret'];
  const expected = process.env.MELODYFLIX_INTERNAL_SECRET ?? '';
  if (!expected) return true;
  return secret === expected;
}

export async function aiRoutes(app: FastifyInstance) {
  // ---- Dashboard ----

  app.get('/ai/summary', { preHandler: [authGuard] }, async (_req, reply) => {
    return reply.send({ success: true, data: getAiSummary() });
  });

  // ---- Jobs ----

  app.get('/ai/jobs', { preHandler: [authGuard] }, async (req, reply) => {
    const q = req.query as { feature?: string; status?: string; limit?: string };
    const jobs = listAiJobs({
      feature: q.feature as any,
      status: q.status as any,
      limit: q.limit ? parseInt(q.limit) : 100,
    });
    return reply.send({ success: true, data: { jobs, count: jobs.length } });
  });

  app.get('/ai/jobs/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const j = getAiJob(id);
    if (!j) return reply.code(404).send({ success: false, error: 'Job not found' });
    return reply.send({ success: true, data: { job: j } });
  });

  app.post('/ai/jobs/:id/cancel', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const ok = cancelAiJob(id, me);
      if (!ok) return reply.code(404).send({ success: false, error: 'Job not found' });
      return reply.send({ success: true, data: { cancelled: true } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  // Worker endpoints
  app.get('/ai/worker/queued', async (req, reply) => {
    if (!checkInternalSecret(req)) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const q = req.query as { limit?: string };
    const jobs = listQueuedAiJobs(q.limit ? parseInt(q.limit) : 10);
    return reply.send({ success: true, data: { jobs, count: jobs.length } });
  });

  app.post('/ai/worker/:id/running', async (req, reply) => {
    if (!checkInternalSecret(req)) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const { id } = req.params as { id: string };
    markAiJobRunning(id);
    return reply.send({ success: true, data: { running: true } });
  });

  const JobDoneSchema = z.object({
    output: z.record(z.any()).optional(),
    provider: z.string().max(80).nullable().optional(),
    model: z.string().max(80).nullable().optional(),
    tokens_in: z.number().int().min(0).optional(),
    tokens_out: z.number().int().min(0).optional(),
  });

  app.post('/ai/worker/:id/done', async (req, reply) => {
    if (!checkInternalSecret(req)) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const { id } = req.params as { id: string };
    const parsed = JobDoneSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    const job = markAiJobDone(id, {
      output: parsed.data.output ?? {},
      provider: parsed.data.provider ?? null,
      model: parsed.data.model ?? null,
      tokens_in: parsed.data.tokens_in,
      tokens_out: parsed.data.tokens_out,
    });
    if (!job) return reply.code(404).send({ success: false, error: 'Job not found' });
    return reply.send({ success: true, data: { job } });
  });

  const JobFailSchema = z.object({ error: z.string().min(1).max(500) });
  app.post('/ai/worker/:id/failed', async (req, reply) => {
    if (!checkInternalSecret(req)) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const { id } = req.params as { id: string };
    const parsed = JobFailSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    const job = markAiJobFailed(id, parsed.data.error);
    if (!job) return reply.code(404).send({ success: false, error: 'Job not found' });
    return reply.send({ success: true, data: { job } });
  });

  // ============================================================
  // 8.1 Caption
  // ============================================================

  app.get('/ai/videos/:videoId/caption', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const c = getCaption(videoId);
    return reply.send({ success: true, data: { caption: c } });
  });

  const CaptionSaveSchema = z.object({
    language: z.string().max(8).optional(),
    vtt_content: z.string().min(1).max(500_000),
    srt_content: z.string().max(500_000).nullable().optional(),
    is_auto: z.boolean().optional(),
  });

  app.put('/ai/videos/:videoId/caption', { preHandler: [authGuard] }, async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const parsed = CaptionSaveSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const c = saveCaption({ video_id: videoId, provider: 'manual', ...parsed.data });
    return reply.send({ success: true, data: { caption: c } });
  });

  const CaptionGenSchema = z.object({
    language: z.string().max(8).optional(),
    transcript: z.string().max(200_000).optional(),
  });

  app.post('/ai/videos/:videoId/caption/generate', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { videoId } = req.params as { videoId: string };
    const parsed = CaptionGenSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const result = await generateCaption({ video_id: videoId, requester_id: me, ...parsed.data });
      return reply.code(201).send({ success: true, data: result });
    } catch (e: any) {
      return reply.code(500).send({ success: false, error: e?.message ?? 'Generation failed' });
    }
  });

  // ============================================================
  // 8.2 Translation
  // ============================================================

  app.get('/ai/videos/:videoId/translations', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const list = listTranslations(videoId);
    return reply.send({ success: true, data: { translations: list, count: list.length } });
  });

  app.get('/ai/videos/:videoId/translations/:target', async (req, reply) => {
    const { videoId, target } = req.params as { videoId: string; target: string };
    const q = req.query as { type?: string };
    const t = getTranslation(videoId, target, q.type ?? 'captions');
    if (!t) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.send({ success: true, data: { translation: t } });
  });

  const TranslateSchema = z.object({
    source_language: z.string().min(2).max(8),
    target_language: z.string().min(2).max(8),
    content: z.string().min(1).max(500_000),
    content_type: z.string().max(20).optional(),
  });

  app.post('/ai/videos/:videoId/translate', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { videoId } = req.params as { videoId: string };
    const parsed = TranslateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const result = await translateText({ video_id: videoId, requester_id: me, ...parsed.data });
      return reply.code(201).send({ success: true, data: result });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Translation failed' });
    }
  });

  // ============================================================
  // 8.4 Video Summary
  // ============================================================

  app.get('/ai/videos/:videoId/summary', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const s = getSummary(videoId);
    return reply.send({ success: true, data: { summary: s } });
  });

  const SummarySchema = z.object({
    transcript: z.string().min(10).max(500_000),
    language: z.string().max(8).optional(),
  });

  app.post('/ai/videos/:videoId/summary', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { videoId } = req.params as { videoId: string };
    const parsed = SummarySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const result = await generateSummary({ video_id: videoId, requester_id: me, ...parsed.data });
      return reply.code(201).send({ success: true, data: result });
    } catch (e: any) {
      return reply.code(500).send({ success: false, error: e?.message ?? 'Summary failed' });
    }
  });

  // ============================================================
  // 8.7 Key Moments
  // ============================================================

  app.get('/ai/videos/:videoId/key-moments', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const moments = listKeyMoments(videoId);
    return reply.send({ success: true, data: { moments, count: moments.length } });
  });

  const KeyMomentsSchema = z.object({
    transcript: z.string().min(10).max(500_000),
  });

  app.post('/ai/videos/:videoId/key-moments', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { videoId } = req.params as { videoId: string };
    const parsed = KeyMomentsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const result = await detectKeyMoments({ video_id: videoId, requester_id: me, transcript: parsed.data.transcript });
      return reply.code(201).send({ success: true, data: result });
    } catch (e: any) {
      return reply.code(500).send({ success: false, error: e?.message ?? 'Detection failed' });
    }
  });

  // ============================================================
  // 8.6 Auto Tag suggestions (no persistence — reuse /tag endpoint to persist)
  // ============================================================

  const SuggestTagsSchema = z.object({
    title: z.string().min(1).max(300),
    description: z.string().max(5000).nullable().optional(),
    existing_tags: z.array(z.string().max(30)).max(50).optional(),
    max: z.number().int().min(1).max(20).optional(),
  });

  app.post('/ai/suggest-tags', { preHandler: [authGuard] }, async (req, reply) => {
    const parsed = SuggestTagsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const result = await suggestTags(parsed.data);
      return reply.send({ success: true, data: result });
    } catch (e: any) {
      return reply.code(500).send({ success: false, error: e?.message ?? 'Suggest failed' });
    }
  });
}
