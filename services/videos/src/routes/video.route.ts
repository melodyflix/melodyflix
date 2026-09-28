// melodyflix videos - HTTP routes
import type { FastifyInstance } from 'fastify';
import { createWriteStream, statSync, existsSync, createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { requireAuth, verifyJwt, extractBearerToken } from '@melodyflix/shared-auth';
import { createLogger } from '@melodyflix/shared-logger';
import { publish, CHANNELS } from '@melodyflix/shared-events';
import {
  createVideo, getVideoById, listVideos, countVideos,
  updateVideo, deleteVideo, updateVideoStatus,
  recordView, likeVideo, getUserReaction,
} from '../services/video.service.js';
import { uploadsDir, processedDir } from '../services/storage.service.js';
import { transcodeToHls } from '../services/transcode.service.js';

const logger = createLogger('videos');
const CreateMetaSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  visibility: z.enum(['public', 'unlisted', 'private']).optional(),
});

const UpdateVideoSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  visibility: z.enum(['public', 'unlisted', 'private']).optional(),
});

const LikeSchema = z.object({
  type: z.enum(['like', 'dislike', 'none']),
});

function optionalUser(authorization: string | undefined) {
  const token = extractBearerToken(authorization);
  if (!token) return null;
  return verifyJwt(token);
}

export async function videoRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const q = req.query as { limit?: string; offset?: string; channelId?: string; status?: string };
    const videos = listVideos({
      limit: Number(q.limit ?? 50),
      offset: Number(q.offset ?? 0),
      channelId: q.channelId,
      status: q.status as any,
    });
    return reply.send({ success: true, data: { videos, total: countVideos() } });
  });

  // GET /api/v1/videos/my/list — my videos (before :id)
  app.get('/my/list', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const { getDb } = await import('@melodyflix/shared-db');
    const db = getDb();
    const videos = db.prepare(
      'SELECT * FROM videos WHERE owner_id = ? ORDER BY created_at DESC LIMIT 200'
    ).all(user.sub) as any[];
    return reply.send({ success: true, data: { videos, total: videos.length } });
  });

  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const video = getVideoById(id);
    if (!video) return reply.code(404).send({ success: false, error: 'Video not found' });
    const user = optionalUser(req.headers.authorization);
    const reaction = getUserReaction(id, user?.sub ?? null);
    return reply.send({ success: true, data: { ...video, user_reaction: reaction } });
  });

  app.post('/:id/view', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const user = optionalUser(req.headers.authorization);
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
        ?? req.ip ?? null;
      const viewCount = recordView(id, user?.sub ?? null, ip);
      return reply.send({ success: true, data: { view_count: viewCount } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/:id/reaction', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = LikeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const { id } = req.params as { id: string };
      const result = likeVideo(id, user.sub, parsed.data.type);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/upload', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    if (!req.isMultipart()) {
      return reply.code(400).send({ success: false, error: 'Expected multipart/form-data' });
    }

    const data = await req.file({ limits: { fileSize: 2 * 1024 * 1024 * 1024 } });
    if (!data) return reply.code(400).send({ success: false, error: 'No file uploaded' });

    const fields = data.fields as Record<string, any>;
    const title = (fields.title?.value ?? data.filename ?? 'Untitled').toString();
    const description = fields.description?.value?.toString();
    const channelId = fields.channelId?.value?.toString() ?? 'unknown';
    const visibility = fields.visibility?.value?.toString() as 'public' | 'unlisted' | 'private' | undefined;

    const parsed = CreateMetaSchema.safeParse({ title, description, visibility });
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    }

    const video = createVideo(user.sub, channelId, parsed.data, 0, data.filename);

    const ext = (data.filename.split('.').pop() ?? 'mp4').toLowerCase();
    const inputPath = join(uploadsDir(), `${video.id}.${ext}`);
    await pipeline(data.file, createWriteStream(inputPath));

    const realSize = statSync(inputPath).size;
    const { getDb } = await import('@melodyflix/shared-db');
    getDb().prepare('UPDATE videos SET file_size_bytes = ? WHERE id = ?').run(realSize, video.id);

    logger.info({ videoId: video.id, inputPath, realSize }, 'file saved');

    const updated = getVideoById(video.id)!;
    reply.code(202).send({ success: true, data: updated });

    publish(CHANNELS.VIDEO_UPLOADED, {
      videoId: video.id, channelId, ownerId: user.sub, title: updated.title,
    }).catch(() => {});

    (async () => {
      try {
        updateVideoStatus(video.id, 'processing');
        const result = await transcodeToHls(inputPath, video.id);
        const masterRel = `/api/v1/videos/${video.id}/stream/master.m3u8`;
        const thumbRel = `/api/v1/videos/${video.id}/thumbnail.jpg`;
        updateVideoStatus(video.id, 'ready', {
          hls_master_url: masterRel,
          thumbnail_url: thumbRel,
          duration_seconds: result.durationSeconds,
        });
        logger.info({ videoId: video.id }, 'processing done');
        publish(CHANNELS.VIDEO_TRANSCODED, {
          videoId: video.id, channelId, ownerId: user.sub, status: 'ready', title: updated.title,
        }).catch(() => {});
      } catch (err) {
        logger.error({ err, videoId: video.id }, 'transcode failed');
        publish(CHANNELS.VIDEO_TRANSCODED, {
          videoId: video.id, channelId, ownerId: user.sub, status: 'failed', title: updated.title,
        }).catch(() => {});
        updateVideoStatus(video.id, 'failed');
      }
    })();
  });

  app.patch('/:id', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = UpdateVideoSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const { id } = req.params as { id: string };
      const updated = updateVideo(id, user.sub, parsed.data);
      return reply.send({ success: true, data: updated });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  app.delete('/:id', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    try {
      const { id } = req.params as { id: string };
      deleteVideo(id, user.sub);
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  app.get('/:id/thumbnail.jpg', async (req, reply) => {
    const { id } = req.params as { id: string };
    const video = getVideoById(id);
    if (!video) return reply.code(404).send({ success: false, error: 'Video not found' });
    const path = join(processedDir(id), 'thumbnail.jpg');
    if (!existsSync(path)) return reply.code(404).send({ success: false, error: 'Thumbnail not ready' });
    reply.type('image/jpeg');
    reply.header('Cache-Control', 'public, max-age=3600');
    return reply.send(createReadStream(path));
  });

  app.get('/:id/stream/*', async (req, reply) => {
    const { id } = req.params as { id: string };
    const wildcard = (req.params as any)['*'] as string;
    if (wildcard.includes('..') || wildcard.startsWith('/')) {
      return reply.code(400).send({ success: false, error: 'Bad path' });
    }
    const video = getVideoById(id);
    if (!video) return reply.code(404).send({ success: false, error: 'Video not found' });

    const baseDir = processedDir(id);
    const filePath = join(baseDir, wildcard);
    if (!existsSync(filePath)) return reply.code(404).send({ success: false, error: 'File not found' });

    if (wildcard.endsWith('.m3u8')) {
      reply.type('application/vnd.apple.mpegurl');
      reply.header('Cache-Control', 'no-cache');
    } else if (wildcard.endsWith('.ts')) {
      reply.type('video/mp2t');
      reply.header('Cache-Control', 'public, max-age=31536000');
    } else {
      reply.type('application/octet-stream');
    }
    return reply.send(createReadStream(filePath));
  });
}
