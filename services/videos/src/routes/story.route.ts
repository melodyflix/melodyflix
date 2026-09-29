// melodyflix videos - story routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createWriteStream, existsSync, createReadStream, mkdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join, extname } from 'node:path';
import { requireAuth, verifyJwt, extractBearerToken } from '@melodyflix/shared-auth';
import {
  listStoryGroups, createStory, getStoryById, markStoryViewed,
  deleteStory, getStoriesByUser, cleanupExpiredStories,
} from '../services/story.service.js';

const STORY_ROOT = '/root/melodyflix/data/stories';

function ensureStoryStorage(): void {
  mkdirSync(STORY_ROOT, { recursive: true });
}

function optionalUser(auth?: string) {
  const token = extractBearerToken(auth);
  if (!token) return null;
  return verifyJwt(token);
}

export async function storyRoutes(app: FastifyInstance) {
  ensureStoryStorage();

  // GET /api/v1/videos/stories/groups — grouped by user
  app.get('/stories/groups', async (req, reply) => {
    const user = optionalUser(req.headers.authorization);
    const groups = listStoryGroups(user?.sub ?? null);
    return reply.send({ success: true, data: { groups } });
  });

  // GET /api/v1/videos/stories/user/:userId — all stories of a user
  app.get('/stories/user/:userId', async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const stories = getStoriesByUser(userId);
    return reply.send({ success: true, data: { stories } });
  });

  // POST /api/v1/videos/stories/upload — multipart upload (image or video)
  app.post('/stories/upload', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    if (!req.isMultipart()) {
      return reply.code(400).send({ success: false, error: 'Expected multipart/form-data' });
    }

    const data = await req.file({ limits: { fileSize: 50 * 1024 * 1024 } }); // 50 MB
    if (!data) return reply.code(400).send({ success: false, error: 'No file uploaded' });

    const fields = data.fields as Record<string, any>;
    const caption = fields.caption?.value?.toString();
    const durationSeconds = Number(fields.duration?.value ?? 5);

    // Determine media type
    const mime = data.mimetype || '';
    const isVideo = mime.startsWith('video/');
    const isImage = mime.startsWith('image/');
    if (!isVideo && !isImage) {
      return reply.code(400).send({ success: false, error: 'Only images or videos allowed' });
    }

    const ext = (extname(data.filename) || (isVideo ? '.mp4' : '.jpg')).toLowerCase();
    const storyId = 'tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const filename = storyId + ext;
    const filePath = join(STORY_ROOT, filename);

    try {
      await pipeline(data.file, createWriteStream(filePath));
    } catch (err) {
      return reply.code(500).send({ success: false, error: 'Failed to save file' });
    }

    // Create story record
    try {
      const story = createStory({
        user_id: user.sub,
        media_type: isVideo ? 'video' : 'image',
        media_url: `/api/v1/videos/stories/media/${filename}`,
        caption,
        duration_seconds: isVideo ? durationSeconds : 5,
      });
      return reply.code(201).send({ success: true, data: story });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /api/v1/videos/stories/media/:filename
  app.get('/stories/media/:filename', async (req, reply) => {
    const { filename } = req.params as { filename: string };
    if (filename.includes('..') || filename.includes('/')) {
      return reply.code(400).send({ success: false, error: 'Bad path' });
    }
    const filePath = join(STORY_ROOT, filename);
    if (!existsSync(filePath)) {
      return reply.code(404).send({ success: false, error: 'Not found' });
    }
    const ext = extname(filename).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') reply.type('image/jpeg');
    else if (ext === '.png') reply.type('image/png');
    else if (ext === '.gif') reply.type('image/gif');
    else if (ext === '.webp') reply.type('image/webp');
    else if (ext === '.mp4') reply.type('video/mp4');
    else if (ext === '.webm') reply.type('video/webm');
    else reply.type('application/octet-stream');
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(createReadStream(filePath));
  });

  // POST /api/v1/videos/stories/:id/view — mark as viewed
  app.post('/stories/:id/view', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const story = getStoryById(id);
    if (!story) return reply.code(404).send({ success: false, error: 'Story not found' });
    markStoryViewed(id, user.sub);
    return reply.send({ success: true, data: { viewed: true } });
  });

  // DELETE /api/v1/videos/stories/:id
  app.delete('/stories/:id', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    try {
      const { id } = req.params as { id: string };
      deleteStory(id, user.sub);
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });
}
