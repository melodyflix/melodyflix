// melodyflix channel - community post routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, verifyJwt, extractBearerToken } from '@melodyflix/shared-auth';
import {
  createPost, getPostById, listChannelPosts, countChannelPosts,
  updatePost, deletePost, togglePostLike, getPostUserReaction,
} from '../services/community.service.js';
import { getChannelById, getChannelByOwner } from '../services/channel.service.js';

const CreatePostSchema = z.object({
  content: z.string().min(1).max(2000),
});

const UpdatePostSchema = z.object({
  content: z.string().min(1).max(2000),
});

function optionalUser(auth?: string) {
  const token = extractBearerToken(auth);
  if (!token) return null;
  return verifyJwt(token);
}

export async function communityRoutes(app: FastifyInstance) {
  // GET /api/v1/channels/:id/posts
  app.get('/:id/posts', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(Number(q.limit ?? 20), 50);
    const offset = Number(q.offset ?? 0);
    const channel = getChannelById(id);
    if (!channel) return reply.code(404).send({ success: false, error: 'Channel not found' });

    const user = optionalUser(req.headers.authorization);
    const posts = listChannelPosts(id, limit, offset).map((p) => ({
      ...p,
      user_reaction: getPostUserReaction(p.id, user?.sub ?? null),
    }));

    return reply.send({
      success: true,
      data: { posts, total: countChannelPosts(id) },
    });
  });

  // POST /api/v1/channels/:id/posts
  app.post('/:id/posts', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = CreatePostSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const { id } = req.params as { id: string };
    const channel = getChannelById(id);
    if (!channel) return reply.code(404).send({ success: false, error: 'Channel not found' });
    if (channel.owner_id !== user.sub) {
      return reply.code(403).send({ success: false, error: 'Only channel owner can post' });
    }

    try {
      const post = createPost(id, parsed.data.content);
      return reply.code(201).send({ success: true, data: post });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /api/v1/channels/me/posts/own — my own channel's posts (for composer)
  app.get('/me/posts/own', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const channel = getChannelByOwner(user.sub);
    if (!channel) return reply.send({ success: true, data: { posts: [], total: 0, channel: null } });
    const posts = listChannelPosts(channel.id, 50, 0);
    return reply.send({
      success: true,
      data: { posts, total: countChannelPosts(channel.id), channel },
    });
  });

  // PATCH /api/v1/channels/posts/:postId
  app.patch('/posts/:postId', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = UpdatePostSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const { postId } = req.params as { postId: string };
    const post = getPostById(postId);
    if (!post) return reply.code(404).send({ success: false, error: 'Post not found' });
    const channel = getChannelById(post.channel_id);
    if (!channel || channel.owner_id !== user.sub) {
      return reply.code(403).send({ success: false, error: 'Not authorized' });
    }

    try {
      const updated = updatePost(postId, post.channel_id, parsed.data.content);
      return reply.send({ success: true, data: updated });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /api/v1/channels/posts/:postId
  app.delete('/posts/:postId', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const { postId } = req.params as { postId: string };
    const post = getPostById(postId);
    if (!post) return reply.code(404).send({ success: false, error: 'Post not found' });
    const channel = getChannelById(post.channel_id);
    if (!channel || channel.owner_id !== user.sub) {
      return reply.code(403).send({ success: false, error: 'Not authorized' });
    }

    try {
      deletePost(postId, post.channel_id);
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /api/v1/channels/posts/:postId/like — toggle
  app.post('/posts/:postId/like', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const { postId } = req.params as { postId: string };
    try {
      const result = togglePostLike(postId, user.sub);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });
}
