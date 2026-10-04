// melodyflix videos — Social Share routes (Section 47)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, verifyJwt, extractBearerToken } from '@melodyflix/shared-auth';
import {
  listPlatforms, getPlatform, updatePlatform,
  generateShareUrl, trackShare, getShareStats, listShareEvents,
  getVideoSocialMeta, setVideoSocialMeta, buildSocialMetaTags, buildEmbedSnippet,
} from '../services/social-share.service.js';

const PLATFORM_IDS = ['facebook', 'twitter', 'instagram', 'tiktok', 'linkedin'] as const;

function optionalUser(authorization: string | undefined) {
  const token = extractBearerToken(authorization);
  if (!token) return null;
  try { return verifyJwt(token); } catch { return null; }
}

const UpdatePlatformSchema = z.object({
  label: z.string().min(1).max(60).optional(),
  icon: z.string().max(20).optional(),
  is_enabled: z.boolean().optional(),
  share_url_template: z.string().min(1).max(500).optional(),
  max_title_length: z.number().int().min(20).max(500).optional(),
  tracking_enabled: z.boolean().optional(),
  display_order: z.number().int().min(0).max(1000).optional(),
});

const TrackShareSchema = z.object({
  video_id: z.string().uuid(),
  platform: z.enum(PLATFORM_IDS),
  share_url: z.string().min(1).max(2000),
  referrer: z.string().max(500).nullable().optional(),
});

const SetVideoMetaSchema = z.object({
  og_title: z.string().max(300).nullable().optional(),
  og_description: z.string().max(2000).nullable().optional(),
  og_image_url: z.string().max(2000).nullable().optional(),
  og_type: z.string().max(60).optional(),
  twitter_card_type: z.string().max(60).optional(),
  embed_allowed: z.boolean().optional(),
});

export async function socialShareRoutes(app: FastifyInstance) {
  // ============================================================
  // Platform config (admin-toggleable)
  // ============================================================

  // GET /social/platforms?enabled_only=true
  app.get('/social/platforms', async (req, reply) => {
    const q = req.query as { enabled_only?: string };
    const platforms = listPlatforms({ enabledOnly: q.enabled_only === 'true' });
    return reply.send({ success: true, data: { platforms } });
  });

  // PATCH /social/platforms/:id  (admin-only via role check)
  app.patch('/social/platforms/:id', async (req, reply) => {
    let isAdmin = false;
    try {
      const payload = requireAuth(req.headers.authorization);
      isAdmin = payload.role === 'admin';
    } catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isAdmin) return reply.code(403).send({ success: false, error: 'Admin only' });

    const { id } = req.params as { id: string };
    if (!PLATFORM_IDS.includes(id as any)) {
      return reply.code(400).send({ success: false, error: 'Unknown platform' });
    }
    const parsed = UpdatePlatformSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const platform = updatePlatform(id as any, parsed.data);
      return reply.send({ success: true, data: platform });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // Share URL generation
  // ============================================================

  // GET /social/share-url/:videoId/:platform?base_url=&title=
  app.get('/social/share-url/:videoId/:platform', async (req, reply) => {
    const { videoId, platform } = req.params as { videoId: string; platform: string };
    if (!PLATFORM_IDS.includes(platform as any)) {
      return reply.code(400).send({ success: false, error: 'Unknown platform' });
    }
    const q = req.query as { base_url?: string; title?: string };
    try {
      const result = generateShareUrl(videoId, platform as any, {
        baseUrl: q.base_url, title: q.title,
      });
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /social/all-share-urls/:videoId?base_url=&title=
  // Returns share URLs for all enabled platforms — used by ShareMenu UI
  app.get('/social/all-share-urls/:videoId', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { base_url?: string; title?: string };
    const platforms = listPlatforms({ enabledOnly: true });
    const result: Array<{ platform: string; label: string; icon: string; share_url: string; video_url: string }> = [];
    for (const p of platforms) {
      try {
        const r = generateShareUrl(videoId, p.id, { baseUrl: q.base_url, title: q.title });
        result.push({ platform: p.id, label: p.label, icon: p.icon, share_url: r.share_url, video_url: r.video_url });
      } catch {}
    }
    return reply.send({ success: true, data: { shares: result } });
  });

  // ============================================================
  // Share tracking
  // ============================================================

  // POST /social/track
  app.post('/social/track', async (req, reply) => {
    const parsed = TrackShareSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const user = optionalUser(req.headers.authorization);
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      ?? req.socket?.remoteAddress ?? null;

    try {
      const event = trackShare({
        user_id: user?.sub ?? null,
        video_id: parsed.data.video_id,
        platform: parsed.data.platform,
        share_url: parsed.data.share_url,
        referrer: parsed.data.referrer,
        user_agent: req.headers['user-agent'] ?? null,
        ip,
      });
      if (!event) return reply.code(404).send({ success: false, error: 'Tracking disabled for this platform' });
      return reply.code(201).send({ success: true, data: event });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /social/stats/:videoId
  app.get('/social/stats/:videoId', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    return reply.send({ success: true, data: getShareStats(videoId) });
  });

  // GET /social/events/:videoId?platform=&limit=
  app.get('/social/events/:videoId', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { platform?: string; limit?: string };
    const platform = PLATFORM_IDS.includes(q.platform as any) ? q.platform as any : undefined;
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    const events = listShareEvents(videoId, { platform, limit });
    return reply.send({ success: true, data: { events } });
  });

  // ============================================================
  // Video social meta (OpenGraph / Twitter Card)
  // ============================================================

  // GET /social/meta/:videoId
  app.get('/social/meta/:videoId', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const meta = getVideoSocialMeta(videoId);
    return reply.send({ success: true, data: meta });
  });

  // PUT /social/meta/:videoId
  app.put('/social/meta/:videoId', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = SetVideoMetaSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { videoId } = req.params as { videoId: string };
    try {
      const meta = setVideoSocialMeta(videoId, parsed.data);
      return reply.send({ success: true, data: meta });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // Meta tags + embed
  // ============================================================

  // GET /social/tags/:videoId?base_url=
  app.get('/social/tags/:videoId', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { base_url?: string };
    try {
      const tags = buildSocialMetaTags(videoId, q.base_url);
      return reply.send({ success: true, data: tags });
    } catch (err) {
      return reply.code(404).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /social/embed/:videoId?base_url=&width=&height=
  app.get('/social/embed/:videoId', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { base_url?: string; width?: string; height?: string };
    const width = q.width ? Math.min(Math.max(parseInt(q.width) || 640, 200), 1920) : 640;
    const height = q.height ? Math.min(Math.max(parseInt(q.height) || 360, 100), 1080) : 360;
    const snippet = buildEmbedSnippet(videoId, q.base_url, { width, height });
    return reply.send({ success: true, data: snippet });
  });
}
