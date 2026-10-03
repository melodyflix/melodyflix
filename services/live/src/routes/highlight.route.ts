// melodyflix live — Auto Highlight routes (7.6)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import { getStreamById } from '../services/live.service.js';
import {
  getHighlight, listHighlights, updateHighlight, deleteHighlight,
  recordSignalSample, listSignalSamples,
  detectHighlightsFromSamples, persistDetectedHighlights, runAutoHighlight,
  createManualHighlight, getHighlightStats,
} from '../services/highlight.service.js';

function userId(req: any): string | null {
  return req.user?.id ?? req.user?.sub ?? null;
}

function isOwner(streamId: string, uid: string): boolean {
  const s = getStreamById(streamId);
  return !!s && s.user_id === uid;
}

export async function highlightRoutes(app: FastifyInstance) {
  // ---- Highlights ----

  app.get('/streams/:id/highlights', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string; public_only?: string };
    const highlights = listHighlights(id, {
      limit: q.limit ? parseInt(q.limit) : 50,
      publicOnly: q.public_only === 'true',
    });
    return reply.send({ success: true, data: { highlights, count: highlights.length } });
  });

  app.get('/streams/:id/highlights/stats', async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: getHighlightStats(id) });
  });

  // POST /streams/:id/highlights/manual — manual bookmark
  const ManualSchema = z.object({
    offset_seconds: z.number().min(0).max(24 * 3600),
    title: z.string().max(150).nullable().optional(),
    duration_seconds: z.number().min(5).max(300).optional(),
    labels: z.array(z.string().max(40)).max(10).optional(),
  });

  app.post('/streams/:id/highlights/manual', { preHandler: [requireAuth] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    if (!isOwner(id, uid)) return reply.code(403).send({ success: false, error: 'Owner only' });
    const parsed = ManualSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const h = createManualHighlight({
      streamId: id,
      offsetSeconds: parsed.data.offset_seconds,
      title: parsed.data.title ?? null,
      durationSeconds: parsed.data.duration_seconds,
      labels: parsed.data.labels,
    });
    return reply.code(201).send({ success: true, data: { highlight: h } });
  });

  // GET /highlights/:id — single
  app.get('/highlights/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const h = getHighlight(id);
    if (!h) return reply.code(404).send({ success: false, error: 'Highlight not found' });
    return reply.send({ success: true, data: { highlight: h } });
  });

  // PATCH /highlights/:id — update title / labels / visibility
  const UpdateSchema = z.object({
    title: z.string().max(150).nullable().optional(),
    description: z.string().max(500).nullable().optional(),
    duration_seconds: z.number().min(5).max(300).optional(),
    is_public: z.boolean().optional(),
    labels: z.array(z.string().max(40)).max(10).optional(),
  });

  app.patch('/highlights/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const h = getHighlight(id);
    if (!h) return reply.code(404).send({ success: false, error: 'Highlight not found' });
    if (!isOwner(h.stream_id, uid)) return reply.code(403).send({ success: false, error: 'Owner only' });
    const parsed = UpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const updated = updateHighlight(id, {
      title: parsed.data.title,
      description: parsed.data.description,
      durationSeconds: parsed.data.duration_seconds,
      isPublic: parsed.data.is_public,
      labels: parsed.data.labels,
    });
    return reply.send({ success: true, data: { highlight: updated } });
  });

  app.delete('/highlights/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const h = getHighlight(id);
    if (!h) return reply.code(404).send({ success: false, error: 'Highlight not found' });
    if (!isOwner(h.stream_id, uid)) return reply.code(403).send({ success: false, error: 'Owner only' });
    const removed = deleteHighlight(id);
    return reply.send({ success: true, data: { removed } });
  });

  // ---- Signal samples (ingest feed) ----

  const SampleSchema = z.object({
    offset_seconds: z.number().min(0).max(24 * 3600),
    chat_count: z.number().int().min(0).max(1_000_000),
    viewer_count: z.number().int().min(0).max(1_000_000),
    superchat_total: z.number().min(0).max(1_000_000),
  });

  app.post('/streams/:id/signals', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = SampleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    recordSignalSample({
      streamId: id,
      offsetSeconds: parsed.data.offset_seconds,
      chatCount: parsed.data.chat_count,
      viewerCount: parsed.data.viewer_count,
      superchatTotal: parsed.data.superchat_total,
    });
    return reply.code(202).send({ success: true, data: { recorded: true } });
  });

  app.get('/streams/:id/signals', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string };
    const samples = listSignalSamples(id, q.limit ? parseInt(q.limit) : 100);
    return reply.send({ success: true, data: { samples, count: samples.length } });
  });

  // ---- Detection ----

  // POST /streams/:id/highlights/detect — preview candidates (no DB write)
  const DetectSchema = z.object({
    lookback_samples: z.number().int().min(3).max(200).optional(),
    chat_rate_multiplier: z.number().min(1).max(20).optional(),
    viewer_rate_multiplier: z.number().min(1).max(20).optional(),
    superchat_threshold: z.number().min(0).max(10000).optional(),
    min_score: z.number().min(0).max(100).optional(),
    duration_seconds: z.number().min(5).max(300).optional(),
  });

  app.post('/streams/:id/highlights/detect', { preHandler: [requireAuth] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    if (!isOwner(id, uid)) return reply.code(403).send({ success: false, error: 'Owner only' });
    const parsed = DetectSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const lookback = parsed.data.lookback_samples ?? 30;
    const samples = listSignalSamples(id, lookback * 2);
    const candidates = detectHighlightsFromSamples(samples, {
      lookbackSamples: lookback,
      chatRateMultiplier: parsed.data.chat_rate_multiplier,
      viewerRateMultiplier: parsed.data.viewer_rate_multiplier,
      superchatThreshold: parsed.data.superchat_threshold,
      minScore: parsed.data.min_score,
      durationSeconds: parsed.data.duration_seconds,
    });
    return reply.send({ success: true, data: { candidates, count: candidates.length } });
  });

  // POST /streams/:id/highlights/detect-and-save — persist candidates
  app.post('/streams/:id/highlights/detect-and-save', { preHandler: [requireAuth] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    if (!isOwner(id, uid)) return reply.code(403).send({ success: false, error: 'Owner only' });
    const parsed = DetectSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const created = runAutoHighlight(id, {
      lookbackSamples: parsed.data.lookback_samples,
      chatRateMultiplier: parsed.data.chat_rate_multiplier,
      viewerRateMultiplier: parsed.data.viewer_rate_multiplier,
      superchatThreshold: parsed.data.superchat_threshold,
      minScore: parsed.data.min_score,
      durationSeconds: parsed.data.duration_seconds,
    });
    return reply.send({ success: true, data: { created, count: created.length } });
  });
}
