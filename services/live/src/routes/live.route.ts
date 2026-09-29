// melodyflix live - HTTP routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { existsSync, createReadStream, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { requireAuth, verifyJwt, extractBearerToken } from '@melodyflix/shared-auth';
import {
  createStream, getStreamById, getActiveStreamByUser, listLiveStreams,
  countLiveStreams, listStreamsByUser, updateStreamInfo, deleteStream,
  listChat, postChat, deleteChat,
} from '../services/live.service.js';
import { streamDir } from '../services/pipeline.service.js';
import { isLive } from '../services/ws.service.js';

const CreateStreamSchema = z.object({
  channel_id: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().max(30).optional(),
});

const UpdateStreamSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  category: z.string().max(30).optional(),
});

const ChatSchema = z.object({
  content: z.string().min(1).max(500),
});

function optionalUser(auth?: string) {
  const token = extractBearerToken(auth);
  if (!token) return null;
  return verifyJwt(token);
}

export async function liveRoutes(app: FastifyInstance) {
  // POST /api/v1/live/streams — create stream (get stream key)
  app.post('/streams', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = CreateStreamSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    // Check if user already has active stream
    const active = getActiveStreamByUser(user.sub);
    if (active && active.status !== 'ended') {
      return reply.code(409).send({
        success: false,
        error: 'You already have an active stream',
        data: active,
      });
    }

    try {
      const stream = createStream({
        user_id: user.sub,
        channel_id: parsed.data.channel_id,
        title: parsed.data.title,
        description: parsed.data.description,
        category: parsed.data.category,
        source: 'camera',
      });
      return reply.code(201).send({ success: true, data: stream });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /api/v1/live/streams — list live streams
  app.get('/streams', async (req, reply) => {
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(Number(q.limit ?? 50), 100);
    const offset = Number(q.offset ?? 0);
    const streams = listLiveStreams(limit, offset);
    return reply.send({
      success: true,
      data: { streams, total: countLiveStreams() },
    });
  });

  // GET /api/v1/live/me — my streams
  app.get('/me', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const streams = listStreamsByUser(user.sub, 50);
    return reply.send({ success: true, data: { streams } });
  });

  // GET /api/v1/live/me/active — my active stream
  app.get('/me/active', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const stream = getActiveStreamByUser(user.sub);
    if (!stream) return reply.code(404).send({ success: false, error: 'No active stream' });
    return reply.send({ success: true, data: stream });
  });

  // GET /api/v1/live/:id — stream detail
  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const stream = getStreamById(id);
    if (!stream) return reply.code(404).send({ success: false, error: 'Stream not found' });
    return reply.send({
      success: true,
      data: { ...stream, is_live: isLive(id) },
    });
  });

  // PATCH /api/v1/live/:id — update stream info
  app.patch('/:id', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = UpdateStreamSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const { id } = req.params as { id: string };
      const updated = updateStreamInfo(id, user.sub, parsed.data);
      return reply.send({ success: true, data: updated });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /api/v1/live/:id
  app.delete('/:id', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    try {
      const { id } = req.params as { id: string };
      deleteStream(id, user.sub);
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // ---------- HLS file serving ----------
  // GET /api/v1/live/:id/hls/* — serve HLS segments
  app.get('/:id/hls/*', async (req, reply) => {
    const { id } = req.params as { id: string };
    const wildcard = (req.params as any)['*'] as string;
    if (wildcard.includes('..') || wildcard.startsWith('/')) {
      return reply.code(400).send({ success: false, error: 'Bad path' });
    }
    const dir = streamDir(id);
    const filePath = join(dir, wildcard);
    if (!existsSync(filePath)) {
      return reply.code(404).send({ success: false, error: 'Not found' });
    }
    if (wildcard.endsWith('.m3u8')) {
      reply.type('application/vnd.apple.mpegurl');
      reply.header('Cache-Control', 'no-cache');
    } else if (wildcard.endsWith('.ts')) {
      reply.type('video/mp2t');
      reply.header('Cache-Control', 'public, max-age=10');
    }
    return reply.send(createReadStream(filePath));
  });

  // ---------- Chat ----------
  // GET /api/v1/live/:id/chat
  app.get('/:id/chat', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string; since?: string };
    const limit = Math.min(Number(q.limit ?? 100), 200);
    const chat = listChat(id, limit, q.since);
    return reply.send({ success: true, data: { chat } });
  });

  // POST /api/v1/live/:id/chat — send message
  app.post('/:id/chat', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = ChatSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const { id } = req.params as { id: string };
      const stream = getStreamById(id);
      if (!stream) return reply.code(404).send({ success: false, error: 'Stream not found' });
      const chat = postChat(id, user.sub, (user as any).username ?? user.sub.slice(0, 8), parsed.data.content);
      return reply.send({ success: true, data: chat });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /api/v1/live/chat/:chatId — delete chat message
  app.delete('/chat/:chatId', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { chatId } = req.params as { chatId: string };
    const ok = deleteChat(chatId, user.sub, user.role === 'admin');
    if (!ok) return reply.code(403).send({ success: false, error: 'Not authorized' });
    return reply.send({ success: true, data: { deleted: true } });
  });
}
