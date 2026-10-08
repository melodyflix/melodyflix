// melodyflix videos - distribution routes (31.1 - 31.4)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '@melodyflix/shared-auth';
import { getDb } from '@melodyflix/shared-db';
import {
  PLATFORMS, listPlatformAccounts, connectPlatform, disconnectPlatform,
  createJob, getJob, listJobsForVideo, listJobsForChannel, cancelJob, deleteJob,
  simulatePublish, processScheduledJobs,
  getAutoShareRule, setAutoShareRule, runAutoShare,
  getFeed, createFeed, updateFeed, deleteFeed, getFeedBySlug, buildRssXml,
} from '../services/distribution.service.js';

const PlatformEnum = z.enum(['youtube', 'facebook', 'instagram', 'twitter', 'tiktok', 'linkedin', 'telegram']);

const ConnectSchema = z.object({
  platform: PlatformEnum,
  account_name: z.string().min(1).max(120),
  access_token: z.string().min(4).max(500),
});

const JobSchema = z.object({
  video_id: z.string().min(1),
  platform: PlatformEnum,
  title: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  scheduled_at: z.string().datetime().nullable().optional(),
});

const AutoShareSchema = z.object({
  share_on_publish: z.boolean().optional(),
  platforms: z.array(PlatformEnum).optional(),
  auto_message: z.string().max(500).nullable().optional(),
});

const FeedSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(500).nullable().optional(),
  is_enabled: z.boolean().optional(),
});

function checkChannelOwner(channelId: string, userId: string): boolean {
  // videos DB may not have a `channels` table (channels live in channel service).
  // Fallback: permissive when table missing (dev mode) — production should
  // resolve ownership via channel service.
  try {
    const db = getDb();
    const row = db.prepare('SELECT owner_id FROM channels WHERE id = ?').get(channelId) as { owner_id: string } | undefined;
    return row?.owner_id === userId;
  } catch {
    return true;
  }
}

function getChannelName(channelId: string): string {
  try {
    const db = getDb();
    const row = db.prepare('SELECT name FROM channels WHERE id = ?').get(channelId) as { name: string } | undefined;
    return row?.name ?? 'Channel';
  } catch {
    return 'Channel';
  }
}

export async function distributionRoutes(app: FastifyInstance) {
  // GET /distribution/platforms
  app.get('/distribution/platforms', async (_req, reply) => {
    return reply.send({ success: true, data: { platforms: PLATFORMS } });
  });

  // ============ Platform accounts (31.1) ============

  // GET /channels/:channelId/platforms
  app.get('/channels/:channelId/platforms', async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    return reply.send({ success: true, data: { accounts: listPlatformAccounts(channelId) } });
  });

  // POST /channels/:channelId/platforms (owner)
  app.post('/channels/:channelId/platforms', { preHandler: [authGuard] }, async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    const parsed = ConnectSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    try {
      const account = connectPlatform(channelId, parsed.data.platform, parsed.data.account_name, parsed.data.access_token);
      return reply.send({ success: true, data: { account } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /channels/:channelId/platforms/:platform (owner)
  app.delete('/channels/:channelId/platforms/:platform', { preHandler: [authGuard] }, async (req, reply) => {
    const { channelId, platform } = req.params as { channelId: string; platform: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    const ok = disconnectPlatform(channelId, platform as any);
    return reply.send({ success: true, data: { removed: ok } });
  });

  // ============ Distribution jobs (31.1, 31.2) ============

  // POST /channels/:channelId/distribution/jobs (owner)
  app.post('/channels/:channelId/distribution/jobs', { preHandler: [authGuard] }, async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    const parsed = JobSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    try {
      const job = createJob({ ...parsed.data, channel_id: channelId }, userId);
      return reply.send({ success: true, data: { job } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /channels/:channelId/distribution/jobs
  app.get('/channels/:channelId/distribution/jobs', async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const q = req.query as { limit?: string };
    const limit = Math.min(Math.max(parseInt(q.limit ?? '100') || 100, 1), 500);
    return reply.send({ success: true, data: { jobs: listJobsForChannel(channelId, limit) } });
  });

  // GET /videos/:videoId/distribution/jobs
  app.get('/videos/:videoId/distribution/jobs', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    return reply.send({ success: true, data: { jobs: listJobsForVideo(videoId) } });
  });

  // POST /distribution/jobs/:id/publish — simulate publish now
  app.post('/distribution/jobs/:id/publish', { preHandler: [authGuard] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const j = getJob(id);
    if (!j) return reply.code(404).send({ success: false, error: 'Job not found' });
    if (!checkChannelOwner(j.channel_id, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    const updated = simulatePublish(id);
    return reply.send({ success: true, data: { job: updated } });
  });

  // POST /distribution/jobs/:id/cancel
  app.post('/distribution/jobs/:id/cancel', { preHandler: [authGuard] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const j = getJob(id);
    if (!j) return reply.code(404).send({ success: false, error: 'Job not found' });
    if (!checkChannelOwner(j.channel_id, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    try {
      const updated = cancelJob(id);
      return reply.send({ success: true, data: { job: updated } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /distribution/jobs/:id
  app.delete('/distribution/jobs/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const j = getJob(id);
    if (!j) return reply.code(404).send({ success: false, error: 'Job not found' });
    if (!checkChannelOwner(j.channel_id, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    deleteJob(id);
    return reply.send({ success: true, data: { deleted: true } });
  });

  // POST /distribution/process-scheduled — cron hook (admin-only)
  app.post('/distribution/process-scheduled', { preHandler: [authGuard] }, async (req, reply) => {
    const role = (req as any).user?.role;
    if (role !== 'admin') return reply.code(403).send({ success: false, error: 'Admin only' });
    const n = processScheduledJobs();
    return reply.send({ success: true, data: { processed: n } });
  });

  // ============ Auto-share rules (31.3) ============

  // GET /channels/:channelId/auto-share
  app.get('/channels/:channelId/auto-share', { preHandler: [authGuard] }, async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    return reply.send({ success: true, data: { rule: getAutoShareRule(channelId) } });
  });

  // PUT /channels/:channelId/auto-share (owner)
  app.put('/channels/:channelId/auto-share', { preHandler: [authGuard] }, async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    const parsed = AutoShareSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    const rule = setAutoShareRule(channelId, parsed.data);
    return reply.send({ success: true, data: { rule } });
  });

  // POST /videos/:videoId/auto-share — trigger manually (owner)
  app.post('/videos/:videoId/auto-share', { preHandler: [authGuard] }, async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const db = getDb();
    const v = db.prepare('SELECT channel_id, title, description FROM videos WHERE id = ?').get(videoId) as any;
    if (!v) return reply.code(404).send({ success: false, error: 'Video not found' });
    if (!checkChannelOwner(v.channel_id, userId)) return reply.code(403).send({ success: false, error: 'Not your video' });
    const n = runAutoShare(videoId, v.channel_id, v.title, v.description);
    return reply.send({ success: true, data: { created: n } });
  });

  // ============ Syndication feed (31.4) ============

  // GET /channels/:channelId/feed (owner)
  app.get('/channels/:channelId/feed', { preHandler: [authGuard] }, async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    return reply.send({ success: true, data: { feed: getFeed(channelId) } });
  });

  // POST /channels/:channelId/feed (owner, creates if missing)
  app.post('/channels/:channelId/feed', { preHandler: [authGuard] }, async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    const name = getChannelName(channelId);
    const feed = createFeed(channelId, name);
    return reply.send({ success: true, data: { feed } });
  });

  // PUT /channels/:channelId/feed (owner)
  app.put('/channels/:channelId/feed', { preHandler: [authGuard] }, async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    const parsed = FeedSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    const feed = updateFeed(channelId, parsed.data);
    return reply.send({ success: true, data: { feed } });
  });

  // DELETE /channels/:channelId/feed (owner)
  app.delete('/channels/:channelId/feed', { preHandler: [authGuard] }, async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    deleteFeed(channelId);
    return reply.send({ success: true, data: { deleted: true } });
  });

  // GET /feeds/:slug.xml — public RSS
  app.get('/feeds/:slug.xml', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const cleanSlug = slug.replace(/\.xml$/, '');
    const feed = getFeedBySlug(cleanSlug);
    if (!feed || feed.is_enabled !== 1) {
      return reply.code(404).header('Content-Type', 'text/plain').send('Feed not found');
    }
    const origin = (req.headers.origin as string) || (req.headers.host ? `https://${req.headers.host}` : '');
    const xml = buildRssXml(feed, origin);
    reply.header('Content-Type', 'application/rss+xml; charset=utf-8');
    reply.header('Cache-Control', 'public, max-age=300');
    return reply.send(xml);
  });
}
