// melodyflix videos — Advanced Ad routes (Section 51.11, 51.14, 51.17)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '@melodyflix/shared-auth';
import {
  getRevenueOverview, getDailyRevenue, getTopAdvertisers,
  recordAdBlock, getAdBlockStats, listAdBlockEvents,
  createSsaiBreak, listSsaiBreaks, updateSsaiBreak, deleteSsaiBreak,
  buildVmapXml, getSsaiSummary,
} from '../services/adadvanced.service.js';

function userId(req: any): string | null {
  return req.user?.id ?? req.user?.sub ?? null;
}

function isAdmin(req: any): boolean {
  const u = req.user as any;
  const roles = u?.roles ?? [];
  return Array.isArray(roles) && roles.includes('admin');
}

export async function adAdvancedRoutes(app: FastifyInstance) {
  // ---- 51.11 Revenue Dashboard ----

  app.get('/admin/ads/revenue/overview', { preHandler: [authGuard] }, async (req, reply) => {
    if (!isAdmin(req as any)) return reply.code(403).send({ success: false, error: 'Admin only' });
    const q = req.query as { from?: string; to?: string };
    const overview = getRevenueOverview({ from: q.from, to: q.to });
    return reply.send({ success: true, data: overview });
  });

  app.get('/admin/ads/revenue/daily', { preHandler: [authGuard] }, async (req, reply) => {
    if (!isAdmin(req as any)) return reply.code(403).send({ success: false, error: 'Admin only' });
    const q = req.query as { from?: string; to?: string; days?: string };
    const daily = getDailyRevenue({
      from: q.from,
      to: q.to,
      days: q.days ? parseInt(q.days) : undefined,
    });
    return reply.send({ success: true, data: { daily, count: daily.length } });
  });

  app.get('/admin/ads/revenue/advertisers', { preHandler: [authGuard] }, async (req, reply) => {
    if (!isAdmin(req as any)) return reply.code(403).send({ success: false, error: 'Admin only' });
    const q = req.query as { from?: string; to?: string; limit?: string };
    const advertisers = getTopAdvertisers({
      from: q.from, to: q.to,
      limit: q.limit ? parseInt(q.limit) : 20,
    });
    return reply.send({ success: true, data: { advertisers, count: advertisers.length } });
  });

  // ---- 51.14 Ad Block Detection ----

  const AdBlockSchema = z.object({
    user_id: z.string().nullable().optional(),
    session_id: z.string().nullable().optional(),
    video_id: z.string().nullable().optional(),
    detected: z.boolean().optional(),
    detection_method: z.string().max(40).nullable().optional(),
    user_agent: z.string().max(200).nullable().optional(),
    ip_hash: z.string().max(80).nullable().optional(),
  });

  // POST /ads/adblock — record a detection event (anonymous is fine)
  app.post('/ads/adblock', async (req, reply) => {
    const parsed = AdBlockSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    const me = userId(req as any);
    const ev = recordAdBlock({ user_id: me, ...parsed.data });
    return reply.code(201).send({ success: true, data: { event: ev } });
  });

  // GET /admin/ads/adblock/stats — aggregated
  app.get('/admin/ads/adblock/stats', { preHandler: [authGuard] }, async (req, reply) => {
    if (!isAdmin(req as any)) return reply.code(403).send({ success: false, error: 'Admin only' });
    const q = req.query as { from?: string; to?: string };
    const stats = getAdBlockStats({ from: q.from, to: q.to });
    return reply.send({ success: true, data: stats });
  });

  // GET /admin/ads/adblock/events — recent raw events
  app.get('/admin/ads/adblock/events', { preHandler: [authGuard] }, async (req, reply) => {
    if (!isAdmin(req as any)) return reply.code(403).send({ success: false, error: 'Admin only' });
    const q = req.query as { detected_only?: string; user_id?: string; limit?: string };
    const events = listAdBlockEvents({
      detected_only: q.detected_only === 'true',
      user_id: q.user_id,
      limit: q.limit ? parseInt(q.limit) : undefined,
    });
    return reply.send({ success: true, data: { events, count: events.length } });
  });

  // ---- 51.17 SSAI ----

  const SsaiCreateSchema = z.object({
    video_id: z.string().min(1),
    break_type: z.enum(['pre-roll','mid-roll','post-roll']).optional(),
    at_seconds: z.number().min(0).max(24 * 3600),
    duration_seconds: z.number().min(1).max(300),
    pod_id: z.string().nullable().optional(),
  });

  const SsaiUpdateSchema = z.object({
    at_seconds: z.number().min(0).max(24 * 3600).optional(),
    duration_seconds: z.number().min(1).max(300).optional(),
    pod_id: z.string().nullable().optional(),
    is_active: z.boolean().optional(),
  });

  // GET /videos/:videoId/ssai/breaks
  app.get('/videos/:videoId/ssai/breaks', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { active_only?: string };
    const breaks = listSsaiBreaks(videoId, q.active_only !== 'false');
    return reply.send({ success: true, data: { breaks, count: breaks.length } });
  });

  // GET /videos/:videoId/ssai/summary
  app.get('/videos/:videoId/ssai/summary', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const summary = getSsaiSummary(videoId);
    return reply.send({ success: true, data: summary });
  });

  // GET /videos/:videoId/ssai/vmap — VMAP XML response
  app.get('/videos/:videoId/ssai/vmap', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const xml = buildVmapXml(videoId);
    return reply
      .header('content-type', 'application/xml; charset=utf-8')
      .send(xml);
  });

  // POST /videos/:videoId/ssai/breaks — create break (owner/admin)
  app.post('/videos/:videoId/ssai/breaks', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { videoId } = req.params as { videoId: string };
    const parsed = SsaiCreateSchema.safeParse({ ...(req.body as any), video_id: videoId });
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    try {
      const b = createSsaiBreak(parsed.data);
      return reply.code(201).send({ success: true, data: { break: b } });
    } catch (e: any) {
      const msg = e?.message ?? 'Create failed';
      if (msg === 'Video not found') return reply.code(404).send({ success: false, error: msg });
      return reply.code(400).send({ success: false, error: msg });
    }
  });

  // PATCH /ssai/breaks/:id
  app.patch('/ssai/breaks/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const parsed = SsaiUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    try {
      const b = updateSsaiBreak(id, parsed.data);
      if (!b) return reply.code(404).send({ success: false, error: 'Break not found' });
      return reply.send({ success: true, data: { break: b } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Update failed' });
    }
  });

  // DELETE /ssai/breaks/:id
  app.delete('/ssai/breaks/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const removed = deleteSsaiBreak(id);
    return reply.send({ success: true, data: { removed } });
  });
}
