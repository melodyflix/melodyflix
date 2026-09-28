// melodyflix channel - HTTP routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import { publish, CHANNELS } from '@melodyflix/shared-events';
import {
  createChannel, getChannelById, getChannelByHandle, getChannelByOwner,
  listChannels, updateChannel, followChannel, unfollowChannel, isFollowing,
} from '../services/channel.service.js';

const CreateChannelSchema = z.object({
  name: z.string().min(1).max(100),
  handle: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
  description: z.string().max(1000).optional(),
});

const UpdateChannelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  avatar_url: z.string().url().optional(),
  banner_url: z.string().url().optional(),
});

export async function channelRoutes(app: FastifyInstance) {
  // POST /api/v1/channels - create channel (auth required)
  app.post('/', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = CreateChannelSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    }
    try {
      const channel = createChannel(user.sub, parsed.data);
      return reply.code(201).send({ success: true, data: channel });
    } catch (err) {
      return reply.code(409).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /api/v1/channels - list channels
  app.get('/', async (req, reply) => {
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(Number(q.limit ?? 20), 100);
    const offset = Number(q.offset ?? 0);
    const channels = listChannels(limit, offset);
    return reply.send({ success: true, data: channels });
  });

  // GET /api/v1/channels/me - get my channel
  app.get('/me', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const channel = getChannelByOwner(user.sub);
    if (!channel) return reply.code(404).send({ success: false, error: 'No channel for this user' });
    return reply.send({ success: true, data: channel });
  });

  // GET /api/v1/channels/handle/:handle
  app.get('/handle/:handle', async (req, reply) => {
    const { handle } = req.params as { handle: string };
    const channel = getChannelByHandle(handle);
    if (!channel) return reply.code(404).send({ success: false, error: 'Channel not found' });
    return reply.send({ success: true, data: channel });
  });

  // GET /api/v1/channels/:id
  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const channel = getChannelById(id);
    if (!channel) return reply.code(404).send({ success: false, error: 'Channel not found' });
    return reply.send({ success: true, data: channel });
  });

  // PATCH /api/v1/channels/:id - update
  app.patch('/:id', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = UpdateChannelSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    }
    try {
      const { id } = req.params as { id: string };
      const channel = updateChannel(id, user.sub, parsed.data);
      return reply.send({ success: true, data: channel });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /api/v1/channels/:id/follow
  app.post('/:id/follow', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    try {
      const { id } = req.params as { id: string };
      const result = followChannel(user.sub, id);
      try {
        const ch = getChannelById(id);
        if (ch) {
          publish(CHANNELS.CHANNEL_FOLLOWED, {
            channelId: id, channelOwnerId: ch.owner_id,
            followerId: user.sub, followerUsername: 'someone',
            channelName: ch.name,
          }).catch(() => {});
        }
      } catch {}
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /api/v1/channels/:id/follow
  app.delete('/:id/follow', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    try {
      const { id } = req.params as { id: string };
      const result = unfollowChannel(user.sub, id);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /api/v1/channels/:id/following - check if user is following
  app.get('/:id/following', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const { id } = req.params as { id: string };
    const following = isFollowing(user.sub, id);
    return reply.send({ success: true, data: { following } });
  });
}

// ============ Avatar/Banner Upload Routes ============
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { avatarPath, bannerPath, avatarExists, bannerExists, readAvatar, readBanner } from '../services/storage.service.js';

export async function channelUploadRoutes(app: any) {
  // POST /api/v1/channels/:id/avatar
  app.post('/:id/avatar', async (req: any, reply: any) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    if (!req.isMultipart()) {
      return reply.code(400).send({ success: false, error: 'Expected multipart/form-data' });
    }

    const data = await req.file({ limits: { fileSize: 5 * 1024 * 1024 } });
    if (!data) return reply.code(400).send({ success: false, error: 'No file uploaded' });

    const { id } = req.params as { id: string };
    const ch = getChannelById(id);
    if (!ch) return reply.code(404).send({ success: false, error: 'Channel not found' });
    if (ch.owner_id !== user.sub) return reply.code(403).send({ success: false, error: 'Not authorized' });

    try {
      await pipeline(data.file, createWriteStream(avatarPath(id)));
      return reply.send({ success: true, data: { url: `/api/v1/channels/${id}/avatar.jpg` } });
    } catch (err) {
      return reply.code(500).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /api/v1/channels/:id/banner
  app.post('/:id/banner', async (req: any, reply: any) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    if (!req.isMultipart()) {
      return reply.code(400).send({ success: false, error: 'Expected multipart/form-data' });
    }

    const data = await req.file({ limits: { fileSize: 10 * 1024 * 1024 } });
    if (!data) return reply.code(400).send({ success: false, error: 'No file uploaded' });

    const { id } = req.params as { id: string };
    const ch = getChannelById(id);
    if (!ch) return reply.code(404).send({ success: false, error: 'Channel not found' });
    if (ch.owner_id !== user.sub) return reply.code(403).send({ success: false, error: 'Not authorized' });

    try {
      await pipeline(data.file, createWriteStream(bannerPath(id)));
      return reply.send({ success: true, data: { url: `/api/v1/channels/${id}/banner.jpg` } });
    } catch (err) {
      return reply.code(500).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /api/v1/channels/:id/avatar.jpg
  app.get('/:id/avatar.jpg', async (req: any, reply: any) => {
    const { id } = req.params as { id: string };
    if (!avatarExists(id)) {
      return reply.code(404).send({ success: false, error: 'Avatar not found' });
    }
    reply.type('image/jpeg');
    reply.header('Cache-Control', 'public, max-age=60');
    return reply.send(readAvatar(id));
  });

  // GET /api/v1/channels/:id/banner.jpg
  app.get('/:id/banner.jpg', async (req: any, reply: any) => {
    const { id } = req.params as { id: string };
    if (!bannerExists(id)) {
      return reply.code(404).send({ success: false, error: 'Banner not found' });
    }
    reply.type('image/jpeg');
    reply.header('Cache-Control', 'public, max-age=60');
    return reply.send(readBanner(id));
  });
}
