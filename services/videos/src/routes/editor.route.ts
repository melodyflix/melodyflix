// melodyflix videos — Online Video Editor routes (Section 9.5)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '@melodyflix/shared-auth';
import {
  createEditorJob, getEditorJob, listEditorJobs,
  updateEditorJob, deleteEditorJob,
  queueEditorJob, cancelEditorJob,
  listQueuedEditorJobs, markEditorProcessing, markEditorReady,
  markEditorFailed, setEditorProgress, renderEditorJob,
  buildFfmpegArgs, getEditorSummary,
} from '../services/editor.service.js';

function userId(req: any): string | null {
  return req.user?.id ?? req.user?.sub ?? null;
}

export async function editorRoutes(app: FastifyInstance) {
  const CropEnum = z.enum(['original', '16:9', '9:16', '1:1', '4:5']);
  const WmPosEnum = z.enum(['tl', 'tr', 'bl', 'br']);
  const KindEnum = z.enum(['trim', 'crop', 'watermark', 'composite']);

  // GET /editor/jobs — list own jobs
  app.get('/editor/jobs', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const q = req.query as { status?: string; video_id?: string; limit?: string };
    const jobs = listEditorJobs({
      owner_id: me,
      video_id: q.video_id,
      status: q.status as any,
      limit: q.limit ? parseInt(q.limit) : undefined,
    });
    return reply.send({ success: true, data: { jobs, count: jobs.length } });
  });

  // GET /editor/summary — per-owner dashboard
  app.get('/editor/summary', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    return reply.send({ success: true, data: getEditorSummary(me) });
  });

  // GET /editor/jobs/:id
  app.get('/editor/jobs/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const job = getEditorJob(id);
    if (!job) return reply.code(404).send({ success: false, error: 'Job not found' });
    if (job.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your job' });
    return reply.send({ success: true, data: { job } });
  });

  // GET /editor/jobs/:id/preview — ffmpeg args preview (dry-run)
  app.get('/editor/jobs/:id/preview', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const job = getEditorJob(id);
    if (!job) return reply.code(404).send({ success: false, error: 'Job not found' });
    if (job.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your job' });
    const preview = buildFfmpegArgs({
      inputPath: `/videos/${job.video_id}/source.mp4`,
      outputPath: `/renders/${job.id}.mp4`,
      job,
    });
    return reply.send({ success: true, data: preview });
  });

  // POST /editor/jobs — create
  const CreateSchema = z.object({
    video_id: z.string().min(1),
    kind: KindEnum.optional(),
    title: z.string().max(200).nullable().optional(),
    trim_start_s: z.number().min(0).max(24 * 3600).nullable().optional(),
    trim_end_s: z.number().min(0).max(24 * 3600).nullable().optional(),
    crop_preset: CropEnum.optional(),
    crop_x: z.number().int().min(0).max(20000).nullable().optional(),
    crop_y: z.number().int().min(0).max(20000).nullable().optional(),
    crop_w: z.number().int().min(10).max(20000).nullable().optional(),
    crop_h: z.number().int().min(10).max(20000).nullable().optional(),
    watermark_url: z.string().url().nullable().optional(),
    watermark_position: WmPosEnum.optional(),
    watermark_scale: z.number().min(0.05).max(0.5).optional(),
    watermark_opacity: z.number().min(0).max(1).optional(),
  });

  app.post('/editor/jobs', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const job = createEditorJob({ owner_id: me, ...parsed.data });
      return reply.code(201).send({ success: true, data: { job } });
    } catch (e: any) {
      const msg = e?.message ?? 'Create failed';
      if (msg === 'Video not found') return reply.code(404).send({ success: false, error: msg });
      if (msg === 'Not your video') return reply.code(403).send({ success: false, error: msg });
      return reply.code(400).send({ success: false, error: msg });
    }
  });

  // PATCH /editor/jobs/:id — update
  const UpdateSchema = CreateSchema.partial().omit({ video_id: true });
  app.patch('/editor/jobs/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const parsed = UpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const job = updateEditorJob(id, me, parsed.data);
      if (!job) return reply.code(404).send({ success: false, error: 'Job not found' });
      return reply.send({ success: true, data: { job } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Update failed' });
    }
  });

  // DELETE /editor/jobs/:id
  app.delete('/editor/jobs/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const removed = deleteEditorJob(id, me);
      if (!removed) return reply.code(404).send({ success: false, error: 'Job not found' });
      return reply.send({ success: true, data: { removed: true } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Delete failed' });
    }
  });

  // POST /editor/jobs/:id/queue
  app.post('/editor/jobs/:id/queue', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const job = queueEditorJob(id, me);
      if (!job) return reply.code(404).send({ success: false, error: 'Job not found' });
      return reply.send({ success: true, data: { job } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Queue failed' });
    }
  });

  // POST /editor/jobs/:id/cancel
  app.post('/editor/jobs/:id/cancel', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const job = cancelEditorJob(id, me);
      if (!job) return reply.code(404).send({ success: false, error: 'Job not found' });
      return reply.send({ success: true, data: { job } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Cancel failed' });
    }
  });

  // POST /editor/jobs/:id/render — mock-safe render (real mode delegates to worker)
  app.post('/editor/jobs/:id/render', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const job = getEditorJob(id);
    if (!job) return reply.code(404).send({ success: false, error: 'Job not found' });
    if (job.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your job' });
    try {
      const result = await renderEditorJob(id);
      return reply.send({ success: true, data: { job: result } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Render failed' });
    }
  });

  // ---- Worker endpoints (internal, x-internal-secret gated) ----
  function checkSecret(req: any): boolean {
    const secret = req.headers['x-internal-secret'];
    const expected = process.env.MELODYFLIX_INTERNAL_SECRET ?? '';
    if (!expected) return true;
    return secret === expected;
  }

  app.get('/editor/worker/queued', async (req, reply) => {
    if (!checkSecret(req)) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const q = req.query as { limit?: string };
    const jobs = listQueuedEditorJobs(q.limit ? parseInt(q.limit) : 10);
    return reply.send({ success: true, data: { jobs, count: jobs.length } });
  });

  app.post('/editor/worker/:id/processing', async (req, reply) => {
    if (!checkSecret(req)) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const { id } = req.params as { id: string };
    markEditorProcessing(id);
    return reply.send({ success: true, data: { processing: true } });
  });

  const ProgressSchema = z.object({ progress: z.number().min(0).max(100) });
  app.post('/editor/worker/:id/progress', async (req, reply) => {
    if (!checkSecret(req)) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const { id } = req.params as { id: string };
    const parsed = ProgressSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    setEditorProgress(id, parsed.data.progress);
    return reply.send({ success: true, data: { ok: true } });
  });

  const ReadySchema = z.object({
    output_path: z.string().min(1).max(1000),
    output_size_bytes: z.number().int().min(0).max(100 * 1024 * 1024 * 1024).optional(),
    output_video_id: z.string().nullable().optional(),
  });
  app.post('/editor/worker/:id/ready', async (req, reply) => {
    if (!checkSecret(req)) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const { id } = req.params as { id: string };
    const parsed = ReadySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    const job = markEditorReady(id, {
      outputPath: parsed.data.output_path,
      outputSizeBytes: parsed.data.output_size_bytes,
      outputVideoId: parsed.data.output_video_id,
    });
    if (!job) return reply.code(404).send({ success: false, error: 'Job not found' });
    return reply.send({ success: true, data: { job } });
  });

  const FailSchema = z.object({ error: z.string().min(1).max(500) });
  app.post('/editor/worker/:id/failed', async (req, reply) => {
    if (!checkSecret(req)) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const { id } = req.params as { id: string };
    const parsed = FailSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    const job = markEditorFailed(id, parsed.data.error);
    if (!job) return reply.code(404).send({ success: false, error: 'Job not found' });
    return reply.send({ success: true, data: { job } });
  });
}
