// melodyflix videos - creator studio routes (9.1 - 9.11)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import { getDb } from '@melodyflix/shared-db';
import {
  getStudioSummary, listMilestones, checkMilestones, markMilestoneNotified,
  generateGrowthInsights,
  getEndScreen, setEndScreen, deleteEndScreen, END_SCREEN_TEMPLATES,
  listTrackedCompetitors, trackCompetitor, untrackCompetitor, getCompetitorAnalysis,
  createABTest, getABTest, listABTestsForVideo, listABTestsForChannel,
  recordABImpression, recordABClick, pickABVariant,
  getABTestScores, completeABTest, cancelABTest,
} from '../services/creatorstudio.service.js';

const EndScreenSchema = z.object({
  elements: z.array(z.object({
    type: z.enum(['video', 'playlist', 'channel', 'subscribe', 'link']),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0.05).max(1),
    height: z.number().min(0.05).max(1),
    label: z.string().max(60),
    target_id: z.string().nullable().optional(),
    thumbnail_url: z.string().max(500).nullable().optional(),
  })).max(4),
  start_seconds: z.number().min(0).max(86400).optional(),
  duration_seconds: z.number().min(5).max(60).optional(),
});

const TrackCompetitorSchema = z.object({
  competitor_channel_id: z.string().min(1),
});

const ABTestSchema = z.object({
  video_id: z.string().min(1),
  test_type: z.enum(['thumbnail', 'title']),
  variants: z.array(z.object({
    label: z.string().min(1).max(60),
    content: z.string().min(1).max(500),
  })).min(2).max(4),
  min_impressions: z.number().int().min(100).max(1000000).optional(),
  ends_at: z.string().datetime().nullable().optional(),
});

const ABEventSchema = z.object({
  variant_id: z.string().min(1),
  watch_seconds: z.number().min(0).max(86400).optional(),
});

function checkChannelOwner(channelId: string, userId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT owner_id FROM channels WHERE id = ?').get(channelId) as { owner_id: string } | undefined;
  return row?.owner_id === userId;
}

function checkVideoOwner(videoId: string, userId: string): { channel_id: string } | null {
  const db = getDb();
  const row = db.prepare('SELECT channel_id FROM videos WHERE id = ?').get(videoId) as { channel_id: string } | undefined;
  if (!row) return null;
  if (!checkChannelOwner(row.channel_id, userId)) return null;
  return { channel_id: row.channel_id };
}

export async function creatorStudioRoutes(app: FastifyInstance) {
  // ============ 9.1 — Studio Dashboard ============
  app.get('/studio/channels/:channelId/summary', { preHandler: [requireAuth] }, async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    return reply.send({ success: true, data: getStudioSummary(channelId) });
  });

  // ============ 9.9 — Milestones ============
  app.get('/studio/channels/:channelId/milestones', { preHandler: [requireAuth] }, async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    const result = checkMilestones(channelId);
    return reply.send({ success: true, data: result });
  });

  app.post('/studio/milestones/:id/notify', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    markMilestoneNotified(id);
    return reply.send({ success: true, data: { ok: true } });
  });

  // ============ 9.10 — Growth Insights ============
  app.get('/studio/channels/:channelId/insights', { preHandler: [requireAuth] }, async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    return reply.send({ success: true, data: { insights: generateGrowthInsights(channelId) } });
  });

  // ============ 9.7 — End Screen ============
  app.get('/studio/end-screen-templates', async (_req, reply) => {
    return reply.send({ success: true, data: { templates: END_SCREEN_TEMPLATES } });
  });

  app.get('/studio/videos/:videoId/end-screen', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    return reply.send({ success: true, data: { end_screen: getEndScreen(videoId) } });
  });

  app.put('/studio/videos/:videoId/end-screen', { preHandler: [requireAuth] }, async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const owned = checkVideoOwner(videoId, userId);
    if (!owned) return reply.code(403).send({ success: false, error: 'Not your video' });
    const parsed = EndScreenSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    try {
      const es = setEndScreen(videoId, owned.channel_id, parsed.data);
      return reply.send({ success: true, data: { end_screen: es } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.delete('/studio/videos/:videoId/end-screen', { preHandler: [requireAuth] }, async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const owned = checkVideoOwner(videoId, userId);
    if (!owned) return reply.code(403).send({ success: false, error: 'Not your video' });
    return reply.send({ success: true, data: { removed: deleteEndScreen(videoId) } });
  });

  // ============ 9.11 — Competitor Analysis ============
  app.get('/studio/channels/:channelId/competitors', { preHandler: [requireAuth] }, async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    return reply.send({ success: true, data: { competitors: listTrackedCompetitors(channelId) } });
  });

  app.post('/studio/channels/:channelId/competitors', { preHandler: [requireAuth] }, async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    const parsed = TrackCompetitorSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    try {
      const c = trackCompetitor(channelId, parsed.data.competitor_channel_id);
      return reply.send({ success: true, data: { competitor: c } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.delete('/studio/channels/:channelId/competitors/:competitorChannelId', { preHandler: [requireAuth] }, async (req, reply) => {
    const { channelId, competitorChannelId } = req.params as { channelId: string; competitorChannelId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    return reply.send({ success: true, data: { removed: untrackCompetitor(channelId, competitorChannelId) } });
  });

  app.get('/studio/channels/:channelId/competitors/:competitorChannelId/analysis', { preHandler: [requireAuth] }, async (req, reply) => {
    const { channelId, competitorChannelId } = req.params as { channelId: string; competitorChannelId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    const a = getCompetitorAnalysis(channelId, competitorChannelId);
    if (!a) return reply.code(404).send({ success: false, error: 'Competitor not found' });
    return reply.send({ success: true, data: a });
  });

  // ============ 9.4 — A/B Testing ============
  app.get('/studio/channels/:channelId/ab-tests', { preHandler: [requireAuth] }, async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    const q = req.query as { limit?: string };
    const limit = Math.min(Math.max(parseInt(q.limit ?? '50') || 50, 1), 200);
    return reply.send({ success: true, data: { tests: listABTestsForChannel(channelId, limit) } });
  });

  app.get('/studio/videos/:videoId/ab-tests', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    return reply.send({ success: true, data: { tests: listABTestsForVideo(videoId) } });
  });

  app.post('/studio/channels/:channelId/ab-tests', { preHandler: [requireAuth] }, async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    const parsed = ABTestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    try {
      const t = createABTest(channelId, parsed.data, userId);
      return reply.send({ success: true, data: { test: t } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.get('/studio/ab-tests/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = getABTest(id);
    if (!t) return reply.code(404).send({ success: false, error: 'Test not found' });
    const scores = getABTestScores(id);
    return reply.send({ success: true, data: { test: t, scores: scores.scores, winner: scores.winner, is_ready: scores.is_ready } });
  });

  // Serves the winner/next variant for a video (public)
  app.get('/studio/videos/:videoId/ab-variant', async (req, reply) => {
    const db = getDb();
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { type?: string };
    const type = (q.type === 'title' ? 'title' : 'thumbnail');
    const test = db.prepare("SELECT id FROM ab_tests WHERE video_id = ? AND test_type = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1")
      .get(videoId, type) as { id: string } | undefined;
    if (!test) return reply.send({ success: true, data: { variant: null } });
    const variant = pickABVariant(test.id);
    return reply.send({ success: true, data: { test_id: test.id, variant } });
  });

  // Record impression (public)
  app.post('/studio/ab-tests/impression', async (req, reply) => {
    const parsed = ABEventSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    recordABImpression(parsed.data.variant_id);
    return reply.send({ success: true, data: { ok: true } });
  });

  // Record click (public)
  app.post('/studio/ab-tests/click', async (req, reply) => {
    const parsed = ABEventSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    recordABClick(parsed.data.variant_id, parsed.data.watch_seconds ?? 0);
    return reply.send({ success: true, data: { ok: true } });
  });

  app.post('/studio/ab-tests/:id/complete', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const t = getABTest(id);
    if (!t) return reply.code(404).send({ success: false, error: 'Test not found' });
    if (!checkChannelOwner(t.channel_id, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    const force = !!(req.body as any)?.force;
    try {
      const updated = completeABTest(id, force);
      return reply.send({ success: true, data: { test: updated } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/studio/ab-tests/:id/cancel', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const t = getABTest(id);
    if (!t) return reply.code(404).send({ success: false, error: 'Test not found' });
    if (!checkChannelOwner(t.channel_id, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    return reply.send({ success: true, data: { test: cancelABTest(id) } });
  });
}
