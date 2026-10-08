// melodyflix live — Low-Latency + DVR routes (7.4, 7.7)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '@melodyflix/shared-auth';
import { getStreamById } from '../services/live.service.js';
import {
  getLatencyConfig, setLatencyConfig, getFfmpegLatencyHints, LATENCY_PRESETS,
  getDvrConfig, setDvrConfig, recordDvrSegment, getDvrWindow,
  seekInDvr, createBookmark, listBookmarks, deleteBookmark, pruneDvrSegments,
} from '../services/streaming-config.service.js';

function userId(req: any): string | null {
  return req.user?.id ?? req.user?.sub ?? null;
}

function isOwner(streamId: string, uid: string): boolean {
  const s = getStreamById(streamId);
  return !!s && s.user_id === uid;
}

export async function streamingConfigRoutes(app: FastifyInstance) {
  // ---- 7.7 Latency config ----

  app.get('/latency/presets', async (_req, reply) => {
    return reply.send({ success: true, data: { presets: LATENCY_PRESETS } });
  });

  app.get('/streams/:id/latency', async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = getStreamById(id);
    if (!s) return reply.code(404).send({ success: false, error: 'Stream not found' });
    return reply.send({
      success: true,
      data: {
        config: getLatencyConfig(id),
        ffmpeg_hints: getFfmpegLatencyHints(id),
      },
    });
  });

  const LatencySchema = z.object({
    mode: z.enum(['standard', 'low', 'ultra_low']).optional(),
    target_latency_seconds: z.number().min(0.5).max(30).optional(),
    hls_part_duration_ms: z.number().int().min(0).max(2000).optional(),
    hls_segment_duration_s: z.number().min(0.5).max(12).optional(),
    force_abr_low_start: z.boolean().optional(),
  });

  app.put('/streams/:id/latency', { preHandler: [authGuard] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    if (!isOwner(id, uid)) return reply.code(403).send({ success: false, error: 'Owner only' });
    const parsed = LatencySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const config = setLatencyConfig(id, parsed.data);
    return reply.send({ success: true, data: { config, ffmpeg_hints: getFfmpegLatencyHints(id) } });
  });

  // ---- 7.4 DVR config ----

  app.get('/streams/:id/dvr', async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = getStreamById(id);
    if (!s) return reply.code(404).send({ success: false, error: 'Stream not found' });
    return reply.send({
      success: true,
      data: { config: getDvrConfig(id), window: getDvrWindow(id) },
    });
  });

  const DvrSchema = z.object({
    enabled: z.boolean().optional(),
    window_minutes: z.number().int().min(5).max(24 * 60).optional(),
    allow_live_rewind: z.boolean().optional(),
    keep_recordings_days: z.number().int().min(1).max(90).optional(),
  });

  app.put('/streams/:id/dvr', { preHandler: [authGuard] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    if (!isOwner(id, uid)) return reply.code(403).send({ success: false, error: 'Owner only' });
    const parsed = DvrSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const config = setDvrConfig(id, parsed.data);
    return reply.send({ success: true, data: { config, window: getDvrWindow(id) } });
  });

  // ---- DVR window + seek ----

  app.get('/streams/:id/dvr/window', async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: getDvrWindow(id) });
  });

  const SeekSchema = z.object({
    offset_seconds: z.number().min(0).max(24 * 3600),
  });

  app.post('/streams/:id/dvr/seek', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = SeekSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const result = seekInDvr(id, { offsetSeconds: parsed.data.offset_seconds });
    return reply.send({ success: true, data: result });
  });

  // ---- Segment index (ingest/worker calls) ----

  const SegmentSchema = z.object({
    segment_path: z.string().min(1).max(500),
    start_offset_s: z.number().min(0).max(24 * 3600),
    duration_s: z.number().min(0.1).max(60),
    bytes: z.number().int().min(0).max(500 * 1024 * 1024).optional(),
  });

  app.post('/streams/:id/dvr/segment', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = SegmentSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const seg = recordDvrSegment({
      streamId: id,
      segmentPath: parsed.data.segment_path,
      startOffsetS: parsed.data.start_offset_s,
      durationS: parsed.data.duration_s,
      bytes: parsed.data.bytes,
    });
    return reply.code(201).send({ success: true, data: { segment: seg } });
  });

  app.post('/streams/:id/dvr/prune', { preHandler: [authGuard] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    if (!isOwner(id, uid)) return reply.code(403).send({ success: false, error: 'Owner only' });
    const pruned = pruneDvrSegments(id);
    return reply.send({ success: true, data: { pruned } });
  });

  // ---- DVR Bookmarks ----

  const BookmarkSchema = z.object({
    label: z.string().min(1).max(100),
    offset_seconds: z.number().min(0).max(24 * 3600),
  });

  app.post('/streams/:id/dvr/bookmarks', { preHandler: [authGuard] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const parsed = BookmarkSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const bookmark = createBookmark({
        streamId: id,
        userId: uid,
        label: parsed.data.label,
        offsetSeconds: parsed.data.offset_seconds,
      });
      return reply.code(201).send({ success: true, data: { bookmark } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Create failed' });
    }
  });

  app.get('/streams/:id/dvr/bookmarks', { preHandler: [authGuard] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const q = req.query as { all?: string };
    const bookmarks = listBookmarks(id, q.all === 'true' ? null : uid);
    return reply.send({ success: true, data: { bookmarks, count: bookmarks.length } });
  });

  app.delete('/streams/:id/dvr/bookmarks/:bmId', { preHandler: [authGuard] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { bmId } = req.params as { id: string; bmId: string };
    const removed = deleteBookmark(bmId, uid);
    return reply.send({ success: true, data: { removed } });
  });
}
