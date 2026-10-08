// melodyflix videos - Favorites/Bookmarks routes (33.4)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '@melodyflix/shared-auth';
import {
  ensureFavoritesSchema, addFavorite, removeFavorite, isFavorited,
  listFavorites, listFavoritesWithData, listCollections, updateFavorite,
  getFavoriteStats, type FavoriteKind,
} from '../services/favorites.service.js';

const KindSchema = z.enum(['favorite', 'bookmark']);

export async function favoritesRoutes(app: FastifyInstance) {
  ensureFavoritesSchema();

  // GET /favorites/list?kind=favorite
  app.get('/favorites/list', { preHandler: [authGuard] }, async (req, reply) => {
    const user = (req as any).user;
    const q = req.query as { kind?: string };
    const kind = (q.kind ?? 'favorite') as FavoriteKind;
    const items = listFavoritesWithData(user.sub, kind);
    return reply.send({ success: true, data: { items, total: items.length, kind } });
  });

  // GET /favorites/ids?kind=favorite
  app.get('/favorites/ids', { preHandler: [authGuard] }, async (req, reply) => {
    const user = (req as any).user;
    const q = req.query as { kind?: string };
    const kind = (q.kind ?? 'favorite') as FavoriteKind;
    const items = listFavorites(user.sub, { kind, limit: 500 });
    return reply.send({ success: true, data: { video_ids: items.map((i) => i.video_id), kind } });
  });

  // GET /favorites/collections?kind=favorite
  app.get('/favorites/collections', { preHandler: [authGuard] }, async (req, reply) => {
    const user = (req as any).user;
    const q = req.query as { kind?: string };
    const kind = (q.kind ?? 'favorite') as FavoriteKind;
    return reply.send({ success: true, data: { collections: listCollections(user.sub, kind), kind } });
  });

  // GET /favorites/stats
  app.get('/favorites/stats', { preHandler: [authGuard] }, async (req, reply) => {
    const user = (req as any).user;
    return reply.send({ success: true, data: getFavoriteStats(user.sub) });
  });

  // GET /favorites/check/:videoId?kind=favorite
  app.get('/favorites/check/:videoId', { preHandler: [authGuard] }, async (req, reply) => {
    const user = (req as any).user;
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { kind?: string };
    const kind = (q.kind ?? 'favorite') as FavoriteKind;
    return reply.send({ success: true, data: { favorited: isFavorited(user.sub, videoId, kind), kind } });
  });

  // POST /favorites/:videoId
  app.post('/favorites/:videoId', { preHandler: [authGuard] }, async (req, reply) => {
    const user = (req as any).user;
    const { videoId } = req.params as { videoId: string };
    const BodySchema = z.object({
      kind: KindSchema.optional(),
      collection: z.string().max(100).nullable().optional(),
      note: z.string().max(500).nullable().optional(),
    });
    const parsed = BodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const fav = addFavorite({
        user_id: user.sub, video_id: videoId,
        kind: parsed.data.kind, collection: parsed.data.collection, note: parsed.data.note,
      });
      return reply.code(201).send({ success: true, data: fav });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // PATCH /favorites/:videoId — update collection/note
  app.patch('/favorites/:videoId', { preHandler: [authGuard] }, async (req, reply) => {
    const user = (req as any).user;
    const { videoId } = req.params as { videoId: string };
    const BodySchema = z.object({
      kind: KindSchema.optional(),
      collection: z.string().max(100).nullable().optional(),
      note: z.string().max(500).nullable().optional(),
    });
    const parsed = BodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const updated = updateFavorite(
      user.sub, videoId,
      { collection: parsed.data.collection, note: parsed.data.note },
      parsed.data.kind ?? 'favorite',
    );
    if (!updated) return reply.code(404).send({ success: false, error: 'Favorite not found' });
    return reply.send({ success: true, data: updated });
  });

  // DELETE /favorites/:videoId?kind=favorite
  app.delete('/favorites/:videoId', { preHandler: [authGuard] }, async (req, reply) => {
    const user = (req as any).user;
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { kind?: string };
    const kind = (q.kind ?? 'favorite') as FavoriteKind;
    const ok = removeFavorite(user.sub, videoId, kind);
    return reply.send({ success: true, data: { removed: ok } });
  });
}
