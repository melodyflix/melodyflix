// melodyflix videos - playlist routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, extractBearerToken, verifyJwt } from '@melodyflix/shared-auth';
import {
  createPlaylist, listPlaylists, getPlaylistById, updatePlaylist, deletePlaylist,
  addToPlaylist, removeFromPlaylist, listPlaylistItems, listPlaylistsContainingVideo,
} from '../services/comment.service.js';

const CreatePlaylistSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(1000).optional(),
  visibility: z.enum(['public', 'unlisted', 'private']).optional(),
});

const UpdatePlaylistSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  description: z.string().max(1000).optional(),
  visibility: z.enum(['public', 'unlisted', 'private']).optional(),
});

const AddVideoSchema = z.object({
  videoId: z.string().uuid(),
});

function optionalUser(authorization: string | undefined) {
  const token = extractBearerToken(authorization);
  if (!token) return null;
  return verifyJwt(token);
}

export async function playlistRoutes(app: FastifyInstance) {
  // GET /api/v1/videos/playlists — my playlists
  app.get('/playlists', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const playlists = listPlaylists(user.sub);
    return reply.send({ success: true, data: { playlists } });
  });

  // POST /api/v1/videos/playlists — create
  app.post('/playlists', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = CreatePlaylistSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const p = createPlaylist(user.sub, parsed.data.name, parsed.data.description ?? null, parsed.data.visibility ?? 'public');
      return reply.code(201).send({ success: true, data: p });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /api/v1/videos/playlists/:id — playlist + items
  app.get('/playlists/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = getPlaylistById(id);
    if (!p) return reply.code(404).send({ success: false, error: 'Playlist not found' });

    const user = optionalUser(req.headers.authorization);
    if (p.visibility === 'private' && (!user || user.sub !== p.user_id)) {
      return reply.code(403).send({ success: false, error: 'Private playlist' });
    }

    const items = listPlaylistItems(id);
    return reply.send({
      success: true,
      data: {
        playlist: p,
        items,
        total: items.length,
        is_owner: user?.sub === p.user_id,
      },
    });
  });

  // PATCH /api/v1/videos/playlists/:id
  app.patch('/playlists/:id', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = UpdatePlaylistSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const { id } = req.params as { id: string };
      const updated = updatePlaylist(id, user.sub, parsed.data);
      return reply.send({ success: true, data: updated });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /api/v1/videos/playlists/:id
  app.delete('/playlists/:id', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    try {
      const { id } = req.params as { id: string };
      deletePlaylist(id, user.sub);
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /api/v1/videos/playlists/:id/items — add video
  app.post('/playlists/:id/items', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = AddVideoSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const { id } = req.params as { id: string };
      const result = addToPlaylist(id, user.sub, parsed.data.videoId);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /api/v1/videos/playlists/:id/items/:videoId — remove video
  app.delete('/playlists/:id/items/:videoId', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    try {
      const { id, videoId } = req.params as { id: string; videoId: string };
      const result = removeFromPlaylist(id, user.sub, videoId);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /api/v1/videos/:videoId/playlists — playlists containing this video
  app.get('/:videoId/playlists', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const { videoId } = req.params as { videoId: string };
    const playlists = listPlaylistsContainingVideo(user.sub, videoId);
    return reply.send({ success: true, data: { playlists } });
  });
}
