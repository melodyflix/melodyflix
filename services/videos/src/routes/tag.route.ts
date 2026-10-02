// melodyflix videos - tag routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import { getDb } from '@melodyflix/shared-db';
import {
  addTag, removeTag, listTagsForVideo, replaceManualTags,
  listVideoIdsByTag, topTags, suggestTags, syncHashtagsFromText,
} from '../services/tag.service.js';

const AddSchema = z.object({
  tag: z.string().min(1).max(50),
});

const ReplaceSchema = z.object({
  tags: z.array(z.string().min(1).max(50)).max(30),
});

function checkVideoOwner(videoId: string, userId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT owner_id FROM videos WHERE id = ?').get(videoId) as { owner_id: string } | undefined;
  return row?.owner_id === userId;
}

export async function tagRoutes(app: FastifyInstance) {
  // GET /:videoId/tags
  app.get('/:videoId/tags', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const tags = listTagsForVideo(videoId);
    return reply.send({ success: true, data: { tags } });
  });

  // POST /:videoId/tags  { tag }
  app.post('/:videoId/tags', { preHandler: [requireAuth] }, async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkVideoOwner(videoId, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your video' });
    }
    const parsed = AddSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    }
    try {
      const tag = addTag(videoId, parsed.data.tag, 'manual');
      return reply.send({ success: true, data: { tag } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // PUT /:videoId/tags  { tags: [...] } — replace all manual tags
  app.put('/:videoId/tags', { preHandler: [requireAuth] }, async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkVideoOwner(videoId, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your video' });
    }
    const parsed = ReplaceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    }
    const tags = replaceManualTags(videoId, parsed.data.tags);
    return reply.send({ success: true, data: { tags } });
  });

  // DELETE /:videoId/tags/:tag
  app.delete('/:videoId/tags/:tag', { preHandler: [requireAuth] }, async (req, reply) => {
    const { videoId, tag } = req.params as { videoId: string; tag: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkVideoOwner(videoId, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your video' });
    }
    const removed = removeTag(videoId, decodeURIComponent(tag));
    return reply.send({ success: true, data: { removed } });
  });

  // POST /:videoId/tags/sync-hashtags  — scan title+description, extract #hashtags
  app.post('/:videoId/tags/sync-hashtags', { preHandler: [requireAuth] }, async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkVideoOwner(videoId, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your video' });
    }
    const db = getDb();
    const video = db.prepare('SELECT title, description FROM videos WHERE id = ?')
      .get(videoId) as { title: string; description: string | null } | undefined;
    if (!video) return reply.code(404).send({ success: false, error: 'Video not found' });
    const combined = `${video.title || ''}\n${video.description || ''}`;
    const added = syncHashtagsFromText(videoId, combined);
    return reply.send({ success: true, data: { added } });
  });

  // GET /tags/top
  app.get('/tags/top', async (req, reply) => {
    const q = req.query as { limit?: string };
    const limit = Math.min(Math.max(parseInt(q.limit ?? '50') || 50, 1), 100);
    const tags = topTags(limit);
    return reply.send({ success: true, data: { tags } });
  });

  // GET /tags/suggest?q=prefix
  app.get('/tags/suggest', async (req, reply) => {
    const q = req.query as { q?: string; limit?: string };
    const prefix = (q.q ?? '').trim();
    if (!prefix) return reply.send({ success: true, data: { tags: [] } });
    const limit = Math.min(Math.max(parseInt(q.limit ?? '10') || 10, 1), 20);
    const tags = suggestTags(prefix, limit);
    return reply.send({ success: true, data: { tags } });
  });

  // GET /tags/:tag/videos
  app.get('/tags/:tag/videos', async (req, reply) => {
    const { tag } = req.params as { tag: string };
    const q = req.query as { limit?: string };
    const limit = Math.min(Math.max(parseInt(q.limit ?? '50') || 50, 1), 100);
    const ids = listVideoIdsByTag(decodeURIComponent(tag), limit);
    if (ids.length === 0) return reply.send({ success: true, data: { videos: [] } });
    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    const videos = db.prepare(
      `SELECT id, title, thumbnail_url, duration_seconds, channel_id, owner_id, view_count, created_at, status ` +
      `FROM videos WHERE id IN (${placeholders})`
    ).all(...ids);
    return reply.send({ success: true, data: { videos } });
  });
}
