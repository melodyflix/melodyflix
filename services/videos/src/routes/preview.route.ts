// melodyflix videos - preview/trailer/highlight routes (Section 48)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole, requireAuth } from '@melodyflix/shared-auth';
import {
  ensurePreviewSchema,
  createPreviewJob, getPreviewJob, listPreviewJobs, updatePreviewJob, deletePreviewJob,
  addSegment, listSegments, replaceJobSegments, buildPlanFromScenes,
  createPreviewClip, getPreviewClip, listPreviewClips, updatePreviewClip, deletePreviewClip,
  createSceneAnalysis, getSceneAnalysis, listSceneAnalyses, updateSceneAnalysis,
  addAutoChapter, listAutoChapters, replaceAutoChapters, deleteAutoChapter,
  deriveAutoChapters,
  createThumbnailStrip, getThumbnailStrip, listThumbnailStrips, updateThumbnailStrip,
  buildThumbVtt,
  runSceneDetection, runPreviewJob, runPreviewClip, runThumbnailStrip, autoGeneratePreview,
} from '../services/preview.service.js';

export async function previewRoutes(app: FastifyInstance) {
  ensurePreviewSchema();

  const isAdmin = async (req: any, reply: any) => {
    try { requireRole(req.headers.authorization, ['admin']); return true; }
    catch (err) { reply.code(403).send({ success: false, error: (err as Error).message }); return false; }
  };
  const authUser = (req: any): string | null => {
    try { return requireAuth(req.headers.authorization).sub; } catch { return null; }
  };

  // ============ 48.1/48.3/48.4 Preview Jobs ============
  app.post('/videos/:videoId/preview-jobs', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { videoId } = req.params as { videoId: string };
    const BodySchema = z.object({
      kind: z.enum(['trailer', 'teaser', 'highlight']),
      preset: z.string().max(40).optional(),
      target_duration_seconds: z.number().positive().optional(),
      config: z.record(z.unknown()).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const job = createPreviewJob({ video_id: videoId, ...parsed.data, created_by: authUser(req) ?? undefined });
      return reply.code(201).send({ success: true, data: job });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.get('/videos/:videoId/preview-jobs', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { kind?: string };
    return reply.send({ success: true, data: { jobs: listPreviewJobs(videoId, q.kind as any) } });
  });

  app.get('/preview-jobs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = getPreviewJob(id);
    if (!job) return reply.code(404).send({ success: false, error: 'Job not found' });
    return reply.send({ success: true, data: { job, segments: listSegments({ job_id: id }) } });
  });

  app.patch('/preview-jobs/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const job = updatePreviewJob(id, req.body as any);
    if (!job) return reply.code(404).send({ success: false, error: 'Job not found' });
    return reply.send({ success: true, data: job });
  });

  app.delete('/preview-jobs/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const ok = deletePreviewJob(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Job not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // Segments
  app.post('/preview-jobs/:id/segments', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const job = getPreviewJob(id);
    if (!job) return reply.code(404).send({ success: false, error: 'Job not found' });
    const BodySchema = z.object({
      start_seconds: z.number().min(0),
      end_seconds: z.number().positive(),
      score: z.number().min(0).max(1).optional(),
      reason: z.string().max(200).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const seg = addSegment({ job_id: id, video_id: job.video_id, ...parsed.data });
      return reply.code(201).send({ success: true, data: seg });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.put('/preview-jobs/:id/segments', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const job = getPreviewJob(id);
    if (!job) return reply.code(404).send({ success: false, error: 'Job not found' });
    const BodySchema = z.object({
      segments: z.array(z.object({
        start_seconds: z.number().min(0),
        end_seconds: z.number().positive(),
        score: z.number().min(0).max(1).optional(),
        reason: z.string().max(200).optional(),
      })).max(100),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const segments = replaceJobSegments(id, job.video_id, parsed.data.segments);
    return reply.send({ success: true, data: { segments } });
  });

  // ============ 48.2 Preview Clips ============
  app.post('/videos/:videoId/preview-clips', async (req, reply) => {
    const userId = authUser(req);
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { videoId } = req.params as { videoId: string };
    const BodySchema = z.object({
      start_seconds: z.number().min(0),
      end_seconds: z.number().positive(),
      label: z.string().max(120).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const clip = createPreviewClip({ video_id: videoId, user_id: userId, ...parsed.data });
      return reply.code(201).send({ success: true, data: clip });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.get('/videos/:videoId/preview-clips', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const userId = authUser(req);
    const q = req.query as { mine?: string };
    return reply.send({
      success: true,
      data: { clips: listPreviewClips({ video_id: videoId, user_id: q.mine === '1' ? userId ?? undefined : undefined }) },
    });
  });

  app.get('/preview-clips/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const clip = getPreviewClip(id);
    if (!clip) return reply.code(404).send({ success: false, error: 'Clip not found' });
    return reply.send({ success: true, data: clip });
  });

  app.patch('/preview-clips/:id', async (req, reply) => {
    const userId = authUser(req);
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const clip = getPreviewClip(id);
    if (!clip) return reply.code(404).send({ success: false, error: 'Clip not found' });
    let isAdminUser = false;
    try { requireRole(req.headers.authorization, ['admin']); isAdminUser = true; } catch {}
    if (clip.user_id !== userId && !isAdminUser) return reply.code(403).send({ success: false, error: 'Not your clip' });
    const updated = updatePreviewClip(id, req.body as any);
    return reply.send({ success: true, data: updated });
  });

  app.delete('/preview-clips/:id', async (req, reply) => {
    const userId = authUser(req);
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const clip = getPreviewClip(id);
    if (!clip) return reply.code(404).send({ success: false, error: 'Clip not found' });
    let isAdminUser = false;
    try { requireRole(req.headers.authorization, ['admin']); isAdminUser = true; } catch {}
    if (clip.user_id !== userId && !isAdminUser) return reply.code(403).send({ success: false, error: 'Not your clip' });
    deletePreviewClip(id);
    return reply.send({ success: true, data: { deleted: true } });
  });

  // ============ Scene analysis (BONUS) ============
  app.post('/videos/:videoId/scene-analyses', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { videoId } = req.params as { videoId: string };
    const BodySchema = z.object({ threshold: z.number().min(0.01).max(1).optional() });
    const parsed = BodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const a = createSceneAnalysis({ video_id: videoId, threshold: parsed.data.threshold });
    return reply.code(201).send({ success: true, data: a });
  });

  app.get('/videos/:videoId/scene-analyses', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    return reply.send({ success: true, data: { analyses: listSceneAnalyses(videoId) } });
  });

  app.get('/scene-analyses/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const a = getSceneAnalysis(id);
    if (!a) return reply.code(404).send({ success: false, error: 'Analysis not found' });
    return reply.send({ success: true, data: a });
  });

  app.patch('/scene-analyses/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const a = updateSceneAnalysis(id, req.body as any);
    if (!a) return reply.code(404).send({ success: false, error: 'Analysis not found' });
    return reply.send({ success: true, data: a });
  });

  // ============ Auto chapters (BONUS) ============
  app.post('/videos/:videoId/auto-chapters', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { videoId } = req.params as { videoId: string };
    const BodySchema = z.object({
      title: z.string().min(1).max(200),
      start_seconds: z.number().min(0),
      end_seconds: z.number().nullable().optional(),
      scene_analysis_id: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const c = addAutoChapter({ video_id: videoId, ...parsed.data });
    return reply.code(201).send({ success: true, data: c });
  });

  app.get('/videos/:videoId/auto-chapters', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    return reply.send({ success: true, data: { chapters: listAutoChapters(videoId) } });
  });

  app.post('/videos/:videoId/auto-chapters/derive', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { videoId } = req.params as { videoId: string };
    const BodySchema = z.object({ scene_analysis_id: z.string() });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const chapters = deriveAutoChapters(videoId, parsed.data.scene_analysis_id);
    return reply.send({ success: true, data: { chapters } });
  });

  app.delete('/auto-chapters/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const ok = deleteAutoChapter(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Chapter not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // ============ Thumbnail strips (BONUS) ============
  app.post('/videos/:videoId/thumbnail-strips', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { videoId } = req.params as { videoId: string };
    const BodySchema = z.object({
      columns: z.number().int().min(1).max(50).optional(),
      rows: z.number().int().min(1).max(50).optional(),
      thumb_width: z.number().int().min(40).max(640).optional(),
      thumb_height: z.number().int().min(20).max(360).optional(),
      interval_seconds: z.number().min(1).max(300).optional(),
    });
    const parsed = BodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const s = createThumbnailStrip({ video_id: videoId, ...parsed.data });
    return reply.code(201).send({ success: true, data: s });
  });

  app.get('/videos/:videoId/thumbnail-strips', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    return reply.send({ success: true, data: { strips: listThumbnailStrips(videoId) } });
  });

  app.get('/thumbnail-strips/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = getThumbnailStrip(id);
    if (!s) return reply.code(404).send({ success: false, error: 'Strip not found' });
    return reply.send({ success: true, data: s });
  });

  app.patch('/thumbnail-strips/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const s = updateThumbnailStrip(id, req.body as any);
    if (!s) return reply.code(404).send({ success: false, error: 'Strip not found' });
    return reply.send({ success: true, data: s });
  });

  // VTT generation for existing strip
  app.get('/thumbnail-strips/:id/vtt', async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = getThumbnailStrip(id);
    if (!s) return reply.code(404).send({ success: false, error: 'Strip not found' });
    const q = req.query as { duration?: string };
    const duration = q.duration ? Number(q.duration) : 0;
    const vtt = buildThumbVtt(s, duration);
    reply.header('Content-Type', 'text/vtt; charset=utf-8');
    return reply.send(vtt);
  });

  // ============ Worker endpoints (admin) ============
  app.post('/scene-analyses/:id/run', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const BodySchema = z.object({
      input_path: z.string().min(1),
      total_duration: z.number().min(0),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const a = await runSceneDetection(id, parsed.data.input_path, parsed.data.total_duration);
    if (!a) return reply.code(404).send({ success: false, error: 'Analysis not found' });
    return reply.send({ success: true, data: a });
  });

  app.post('/preview-jobs/:id/run', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const BodySchema = z.object({
      input_path: z.string().min(1),
      output_path: z.string().min(1),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const job = await runPreviewJob(id, parsed.data.input_path, parsed.data.output_path);
    if (!job) return reply.code(404).send({ success: false, error: 'Job not found' });
    return reply.send({ success: true, data: job });
  });

  app.post('/videos/:videoId/preview-jobs/auto-generate', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { videoId } = req.params as { videoId: string };
    const BodySchema = z.object({
      kind: z.enum(['trailer', 'teaser', 'highlight']),
      target_duration_seconds: z.number().positive().optional(),
      input_path: z.string().min(1),
      output_path: z.string().min(1),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const job = await autoGeneratePreview({
      video_id: videoId, created_by: authUser(req) ?? undefined, ...parsed.data,
    });
    return reply.send({ success: true, data: job });
  });

  app.post('/preview-clips/:id/run', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const BodySchema = z.object({
      input_path: z.string().min(1),
      output_path: z.string().min(1),
      format: z.enum(['mp4', 'hls']).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const clip = await runPreviewClip(id, parsed.data.input_path, parsed.data.output_path, parsed.data.format ?? 'mp4');
    if (!clip) return reply.code(404).send({ success: false, error: 'Clip not found' });
    return reply.send({ success: true, data: clip });
  });

  app.post('/thumbnail-strips/:id/run', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const BodySchema = z.object({
      input_path: z.string().min(1),
      output_path: z.string().min(1),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const s = await runThumbnailStrip(id, parsed.data.input_path, parsed.data.output_path);
    if (!s) return reply.code(404).send({ success: false, error: 'Strip not found' });
    return reply.send({ success: true, data: s });
  });
}
