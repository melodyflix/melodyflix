// melodyflix videos - advanced analytics routes (26.2 - 26.18)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import { getDb } from '@melodyflix/shared-db';
import {
  trackEvent,
  getDemographics, getTrafficSources,
  getRevenueReport, getPredictiveAnalytics, getChurnRate, getLifetimeValue,
  getCohortAnalysis, getFunnelAnalysis, getCompletionRate,
  getRewatchAnalytics, getDropOffPoints,
  getClickTracking, getScrollDepth, getSessionTimeline, getHeatmap, listRecentSessions,
  exportReport, upsertUserProfile, getUserProfile,
  type EventType, type ExportReportType, type ExportFormat,
} from '../services/advancedanalytics.service.js';

const EventSchema = z.object({
  event_type: z.string().min(1).max(40),
  channel_id: z.string().nullable().optional(),
  video_id: z.string().nullable().optional(),
  session_id: z.string().max(100).nullable().optional(),
  data: z.any().optional(),
  country: z.string().max(3).nullable().optional(),
  language: z.string().max(10).nullable().optional(),
  device_type: z.string().max(30).nullable().optional(),
  browser: z.string().max(50).nullable().optional(),
  os: z.string().max(50).nullable().optional(),
  referrer: z.string().max(200).nullable().optional(),
  utm_source: z.string().max(100).nullable().optional(),
  utm_medium: z.string().max(100).nullable().optional(),
  utm_campaign: z.string().max(100).nullable().optional(),
});

const ProfileSchema = z.object({
  birth_year: z.number().int().min(1900).max(2100).optional(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not']).optional(),
  country: z.string().max(3).optional(),
  language: z.string().max(10).optional(),
  interests: z.array(z.string().max(50)).max(50).optional(),
});

function checkChannelOwner(channelId: string, userId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT owner_id FROM channels WHERE id = ?').get(channelId) as { owner_id: string } | undefined;
  return row?.owner_id === userId;
}

function optionalUserId(auth: string | undefined): string | null {
  try { return requireAuth(auth).sub as string; } catch { return null; }
}

export async function advancedAnalyticsRoutes(app: FastifyInstance) {
  // ============ Event ingestion (public) ============
  app.post('/analytics/track', async (req, reply) => {
    const parsed = EventSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    const userId = optionalUserId(req.headers.authorization);
    try {
      const res = trackEvent({ ...parsed.data, event_type: parsed.data.event_type as EventType, user_id: userId });
      return reply.send({ success: true, data: res });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============ User profile ============
  app.put('/analytics/profile', { preHandler: [requireAuth] }, async (req, reply) => {
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = ProfileSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    upsertUserProfile(userId, parsed.data);
    return reply.send({ success: true, data: getUserProfile(userId) });
  });

  app.get('/analytics/profile', { preHandler: [requireAuth] }, async (req, reply) => {
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    return reply.send({ success: true, data: getUserProfile(userId) });
  });

  // ============ Owner-only reports ============

  function requireOwner(req: any): { channelId: string; userId: string } | null {
    const userId = req.user?.id ?? req.user?.sub;
    if (!userId) return null;
    const channelId = req.params.channelId ?? req.query.channel_id;
    if (!channelId) return null;
    if (!checkChannelOwner(channelId, userId)) return null;
    return { channelId, userId };
  }

  // 26.2 — Demographics
  app.get('/analytics/channels/:channelId/demographics', { preHandler: [requireAuth] }, async (req, reply) => {
    const ctx = requireOwner(req);
    if (!ctx) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const days = Math.max(1, Math.min(365, parseInt((req.query as any).days ?? '30') || 30));
    return reply.send({ success: true, data: getDemographics(ctx.channelId, days) });
  });

  // 26.3 — Traffic sources
  app.get('/analytics/channels/:channelId/traffic', { preHandler: [requireAuth] }, async (req, reply) => {
    const ctx = requireOwner(req);
    if (!ctx) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const days = Math.max(1, Math.min(365, parseInt((req.query as any).days ?? '30') || 30));
    return reply.send({ success: true, data: getTrafficSources(ctx.channelId, days) });
  });

  // 26.4 — Revenue
  app.get('/analytics/channels/:channelId/revenue', { preHandler: [requireAuth] }, async (req, reply) => {
    const ctx = requireOwner(req);
    if (!ctx) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const days = Math.max(1, Math.min(365, parseInt((req.query as any).days ?? '30') || 30));
    return reply.send({ success: true, data: getRevenueReport(ctx.channelId, days) });
  });

  // 26.5 — Report export
  app.get('/analytics/channels/:channelId/export', { preHandler: [requireAuth] }, async (req, reply) => {
    const ctx = requireOwner(req);
    if (!ctx) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const q = req.query as { report?: string; format?: string; days?: string };
    const report = (q.report ?? 'overview') as ExportReportType;
    const format = (q.format === 'json' ? 'json' : 'csv') as ExportFormat;
    const days = Math.max(1, Math.min(365, parseInt(q.days ?? '30') || 30));
    try {
      const res = exportReport(report, ctx.channelId, format, days);
      reply.header('Content-Type', res.mime);
      reply.header('Content-Disposition', `attachment; filename="${res.filename}"`);
      return reply.send(res.content);
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // 26.6 — Predictive
  app.get('/analytics/channels/:channelId/predictive', { preHandler: [requireAuth] }, async (req, reply) => {
    const ctx = requireOwner(req);
    if (!ctx) return reply.code(403).send({ success: false, error: 'Forbidden' });
    return reply.send({ success: true, data: getPredictiveAnalytics(ctx.channelId, 30) });
  });

  // 26.7 — Churn
  app.get('/analytics/channels/:channelId/churn', { preHandler: [requireAuth] }, async (req, reply) => {
    const ctx = requireOwner(req);
    if (!ctx) return reply.code(403).send({ success: false, error: 'Forbidden' });
    return reply.send({ success: true, data: getChurnRate(ctx.channelId, 90) });
  });

  // 26.8 — LTV
  app.get('/analytics/channels/:channelId/ltv', { preHandler: [requireAuth] }, async (req, reply) => {
    const ctx = requireOwner(req);
    if (!ctx) return reply.code(403).send({ success: false, error: 'Forbidden' });
    return reply.send({ success: true, data: getLifetimeValue(ctx.channelId, 12) });
  });

  // 26.9 — Cohort
  app.get('/analytics/channels/:channelId/cohort', { preHandler: [requireAuth] }, async (req, reply) => {
    const ctx = requireOwner(req);
    if (!ctx) return reply.code(403).send({ success: false, error: 'Forbidden' });
    return reply.send({ success: true, data: getCohortAnalysis(ctx.channelId, 12) });
  });

  // 26.10 — Funnel
  app.get('/analytics/channels/:channelId/funnel', { preHandler: [requireAuth] }, async (req, reply) => {
    const ctx = requireOwner(req);
    if (!ctx) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const days = Math.max(1, Math.min(365, parseInt((req.query as any).days ?? '30') || 30));
    return reply.send({ success: true, data: getFunnelAnalysis(ctx.channelId, days) });
  });

  // 26.12 — Completion
  app.get('/analytics/channels/:channelId/completion', { preHandler: [requireAuth] }, async (req, reply) => {
    const ctx = requireOwner(req);
    if (!ctx) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const days = Math.max(1, Math.min(365, parseInt((req.query as any).days ?? '30') || 30));
    return reply.send({ success: true, data: getCompletionRate(ctx.channelId, days) });
  });

  // 26.13 — Rewatch
  app.get('/analytics/channels/:channelId/rewatch', { preHandler: [requireAuth] }, async (req, reply) => {
    const ctx = requireOwner(req);
    if (!ctx) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const days = Math.max(1, Math.min(365, parseInt((req.query as any).days ?? '30') || 30));
    return reply.send({ success: true, data: getRewatchAnalytics(ctx.channelId, days) });
  });

  // 26.14 — Drop-off
  app.get('/analytics/channels/:channelId/dropoff', { preHandler: [requireAuth] }, async (req, reply) => {
    const ctx = requireOwner(req);
    if (!ctx) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const days = Math.max(1, Math.min(365, parseInt((req.query as any).days ?? '30') || 30));
    return reply.send({ success: true, data: getDropOffPoints(ctx.channelId, days) });
  });

  // 26.15 — Click tracking
  app.get('/analytics/channels/:channelId/clicks', { preHandler: [requireAuth] }, async (req, reply) => {
    const ctx = requireOwner(req);
    if (!ctx) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const days = Math.max(1, Math.min(365, parseInt((req.query as any).days ?? '30') || 30));
    return reply.send({ success: true, data: getClickTracking(ctx.channelId, days) });
  });

  // 26.16 — Scroll depth
  app.get('/analytics/channels/:channelId/scroll', { preHandler: [requireAuth] }, async (req, reply) => {
    const ctx = requireOwner(req);
    if (!ctx) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const days = Math.max(1, Math.min(365, parseInt((req.query as any).days ?? '30') || 30));
    return reply.send({ success: true, data: getScrollDepth(ctx.channelId, days) });
  });

  // 26.17 — Sessions list
  app.get('/analytics/channels/:channelId/sessions', { preHandler: [requireAuth] }, async (req, reply) => {
    const ctx = requireOwner(req);
    if (!ctx) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const q = req.query as { days?: string; limit?: string };
    const days = Math.max(1, Math.min(90, parseInt(q.days ?? '7') || 7));
    const limit = Math.max(1, Math.min(500, parseInt(q.limit ?? '50') || 50));
    return reply.send({ success: true, data: { sessions: listRecentSessions(ctx.channelId, days, limit) } });
  });

  // 26.17 — Session timeline
  app.get('/analytics/sessions/:sessionId/timeline', { preHandler: [requireAuth] }, async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const t = getSessionTimeline(sessionId);
    if (!t) return reply.code(404).send({ success: false, error: 'Session not found' });
    return reply.send({ success: true, data: t });
  });

  // 26.18 — Heatmap
  app.get('/analytics/channels/:channelId/heatmap/:videoId', { preHandler: [requireAuth] }, async (req, reply) => {
    const ctx = requireOwner(req);
    if (!ctx) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { duration?: string; bucket?: string; days?: string };
    const duration = Math.max(1, Math.min(86400, parseInt(q.duration ?? '600') || 600));
    const bucket = Math.max(5, Math.min(60, parseInt(q.bucket ?? '15') || 15));
    const days = Math.max(1, Math.min(365, parseInt(q.days ?? '30') || 30));
    return reply.send({ success: true, data: getHeatmap(ctx.channelId, videoId, duration, bucket, days) });
  });
}
