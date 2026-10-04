// melodyflix videos — Reactions & Rich Media routes (Section 148)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, verifyJwt, extractBearerToken } from '@melodyflix/shared-auth';
import {
  setReaction, removeReaction, getReactionSummary, listUserReactions,
  createCustomEmoji, getCustomEmoji, listCustomEmojis, updateCustomEmoji,
  recordCustomEmojiUse, deleteCustomEmoji,
  createStickerPack, getStickerPack, listStickerPacks,
  createSticker, getSticker, listStickers, recordStickerUse, deleteSticker,
  searchGifs, trendingGifs, searchTenor, getGifProvidersStatus,
  getReactionStats, listTopReacted, listUserReactionBreakdown,
  createSuperThanks, getSuperThanks, listVideoSuperThanks, listUserSuperThanks,
  getVideoSuperThanksTotal,
  type ReactableType, type ReactionEmoji,
} from '../services/reactions.service.js';

const EMOJIS = ['like', 'love', 'haha', 'wow', 'sad', 'angry'] as const;
const TYPES = ['video', 'comment', 'community_post', 'clip', 'news', 'story'] as const;

const ReactSchema = z.object({
  reactable_type: z.enum(TYPES),
  reactable_id: z.string().min(1).max(100),
  emoji: z.enum(EMOJIS),
});

const CustomEmojiSchema = z.object({
  slug: z.string().min(2).max(40).regex(/^[a-z0-9_-]+$/),
  name: z.string().min(1).max(60),
  image_url: z.string().url().max(500),
  category: z.string().max(60).optional(),
  is_public: z.boolean().optional(),
});

const UpdateCustomEmojiSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  image_url: z.string().url().max(500).optional(),
  category: z.string().max(60).optional(),
  is_public: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

const StickerPackSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(2).max(40).regex(/^[a-z0-9_-]+$/),
  thumbnail_url: z.string().url().max(500).nullable().optional(),
  is_public: z.boolean().optional(),
});

const StickerSchema = z.object({
  name: z.string().min(1).max(100),
  image_url: z.string().url().max(500),
  pack_id: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  is_public: z.boolean().optional(),
});

const GifSearchSchema = z.object({
  query: z.string().min(1).max(100),
  limit: z.number().int().min(1).max(50).optional(),
  provider: z.enum(['giphy', 'tenor']).optional(),
});

const SuperThanksSchema = z.object({
  video_id: z.string().uuid(),
  amount_cents: z.number().int().positive().max(50_000_000),
  message: z.string().max(500).nullable().optional(),
  emoji: z.string().min(1).max(20).optional(),
  display_mode: z.enum(['public', 'anonymous']).optional(),
  currency: z.string().min(3).max(5).optional(),
});

function optionalUser(authorization: string | undefined) {
  const token = extractBearerToken(authorization);
  if (!token) return null;
  try { return verifyJwt(token); } catch { return null; }
}

function requireAuthPayload(auth: string | undefined): { sub: string; role: string } {
  const payload = requireAuth(auth);
  return { sub: payload.sub as string, role: (payload.role as string) ?? 'user' };
}

export async function reactionsRoutes(app: FastifyInstance) {
  // ============================================================
  // 148.1 — Reactions
  // ============================================================

  // POST /reactions — set/toggle reaction
  app.post('/reactions', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = ReactSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const reaction = setReaction({
        user_id: payload.sub,
        reactable_type: parsed.data.reactable_type as ReactableType,
        reactable_id: parsed.data.reactable_id,
        emoji: parsed.data.emoji as ReactionEmoji,
      });
      const summary = getReactionSummary(parsed.data.reactable_type as ReactableType, parsed.data.reactable_id, payload.sub);
      return reply.code(201).send({ success: true, data: { reaction, summary } });
    } catch (err) {
      // Sentinel: user toggled off
      if ((err as Error).message === 'REACTION_REMOVED') {
        const summary = getReactionSummary(parsed.data.reactable_type as ReactableType, parsed.data.reactable_id, payload.sub);
        return reply.send({ success: true, data: { reaction: null, summary, removed: true } });
      }
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /reactions/:type/:id — explicit remove
  app.delete('/reactions/:type/:id', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { type, id } = req.params as { type: string; id: string };
    if (!TYPES.includes(type as any)) return reply.code(400).send({ success: false, error: 'Invalid type' });
    const ok = removeReaction(payload.sub, type as ReactableType, id);
    if (!ok) return reply.code(404).send({ success: false, error: 'No reaction to remove' });
    return reply.send({ success: true, data: { removed: true } });
  });

  // GET /reactions/:type/:id — summary
  app.get('/reactions/:type/:id', async (req, reply) => {
    const { type, id } = req.params as { type: string; id: string };
    if (!TYPES.includes(type as any)) return reply.code(400).send({ success: false, error: 'Invalid type' });
    const user = optionalUser(req.headers.authorization);
    const summary = getReactionSummary(type as ReactableType, id, user?.sub ?? null);
    return reply.send({ success: true, data: summary });
  });

  // GET /reactions/mine — my reactions
  app.get('/reactions/mine', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    return reply.send({ success: true, data: { reactions: listUserReactions(payload.sub, limit) } });
  });

  // ============================================================
  // 148.5 — Analytics
  // ============================================================

  // GET /reactions/stats/:type/:id
  app.get('/reactions/stats/:type/:id', async (req, reply) => {
    const { type, id } = req.params as { type: string; id: string };
    if (!TYPES.includes(type as any)) return reply.code(400).send({ success: false, error: 'Invalid type' });
    return reply.send({ success: true, data: getReactionStats(type as ReactableType, id) });
  });

  // GET /reactions/top/:type?limit=20
  app.get('/reactions/top/:type', async (req, reply) => {
    const { type } = req.params as { type: string };
    if (!TYPES.includes(type as any)) return reply.code(400).send({ success: false, error: 'Invalid type' });
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 20, 1), 200) : 20;
    return reply.send({ success: true, data: { items: listTopReacted(type as ReactableType, limit) } });
  });

  // GET /reactions/mine/breakdown
  app.get('/reactions/mine/breakdown', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: { breakdown: listUserReactionBreakdown(payload.sub) } });
  });

  // ============================================================
  // 148.2 — Custom Emojis
  // ============================================================

  // POST /custom-emojis
  app.post('/custom-emojis', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = CustomEmojiSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const emoji = createCustomEmoji({ ...parsed.data, created_by: payload.sub });
      return reply.code(201).send({ success: true, data: emoji });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /custom-emojis?category=&public_only=true
  app.get('/custom-emojis', async (req, reply) => {
    const q = req.query as { category?: string; public_only?: string; limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 100, 1), 500) : 100;
    const emojis = listCustomEmojis({
      category: q.category, public_only: q.public_only === 'true', limit,
    });
    return reply.send({ success: true, data: { emojis } });
  });

  // GET /custom-emojis/:idOrSlug
  app.get('/custom-emojis/:idOrSlug', async (req, reply) => {
    const { idOrSlug } = req.params as { idOrSlug: string };
    const emoji = getCustomEmoji(idOrSlug);
    if (!emoji || emoji.is_active !== 1) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.send({ success: true, data: emoji });
  });

  // PATCH /custom-emojis/:id
  app.patch('/custom-emojis/:id', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = UpdateCustomEmojiSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const emoji = updateCustomEmoji(id, payload.sub, payload.role === 'admin', parsed.data);
      return reply.send({ success: true, data: emoji });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /custom-emojis/:id/use — increments usage counter
  app.post('/custom-emojis/:id/use', async (req, reply) => {
    const { id } = req.params as { id: string };
    recordCustomEmojiUse(id);
    return reply.send({ success: true, data: { recorded: true } });
  });

  // DELETE /custom-emojis/:id
  app.delete('/custom-emojis/:id', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      const ok = deleteCustomEmoji(id, payload.sub, payload.role === 'admin');
      if (!ok) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // 148.3 — Stickers
  // ============================================================

  // POST /sticker-packs
  app.post('/sticker-packs', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = StickerPackSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const pack = createStickerPack({ ...parsed.data, created_by: payload.sub });
      return reply.code(201).send({ success: true, data: pack });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /sticker-packs?public_only=true
  app.get('/sticker-packs', async (req, reply) => {
    const q = req.query as { public_only?: string; limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    const packs = listStickerPacks({ public_only: q.public_only === 'true', limit });
    return reply.send({ success: true, data: { packs } });
  });

  // GET /sticker-packs/:id
  app.get('/sticker-packs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const pack = getStickerPack(id);
    if (!pack) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.send({ success: true, data: pack });
  });

  // POST /stickers
  app.post('/stickers', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = StickerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const sticker = createSticker({ ...parsed.data, created_by: payload.sub });
      return reply.code(201).send({ success: true, data: sticker });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /stickers?pack_id=&public_only=true
  app.get('/stickers', async (req, reply) => {
    const q = req.query as { pack_id?: string; public_only?: string; limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 100, 1), 500) : 100;
    const stickers = listStickers({
      pack_id: q.pack_id, public_only: q.public_only === 'true', limit,
    });
    return reply.send({ success: true, data: { stickers } });
  });

  // GET /stickers/:id
  app.get('/stickers/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const sticker = getSticker(id);
    if (!sticker) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.send({ success: true, data: sticker });
  });

  // POST /stickers/:id/use
  app.post('/stickers/:id/use', async (req, reply) => {
    const { id } = req.params as { id: string };
    recordStickerUse(id);
    return reply.send({ success: true, data: { recorded: true } });
  });

  // DELETE /stickers/:id
  app.delete('/stickers/:id', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      const ok = deleteSticker(id, payload.sub, payload.role === 'admin');
      if (!ok) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // 148.4 — GIFs (Giphy + Tenor)
  // ============================================================

  // GET /gifs/providers — which providers are ready
  app.get('/gifs/providers', async (_req, reply) => {
    return reply.send({ success: true, data: { providers: getGifProvidersStatus() } });
  });

  // POST /gifs/search
  app.post('/gifs/search', async (req, reply) => {
    const parsed = GifSearchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const provider = parsed.data.provider ?? 'giphy';
    try {
      const results = provider === 'tenor'
        ? await searchTenor(parsed.data.query, parsed.data.limit)
        : await searchGifs(parsed.data.query, parsed.data.limit);
      return reply.send({ success: true, data: { provider, results } });
    } catch (err) {
      const msg = (err as Error).message;
      const code = msg.includes('not configured') ? 503 : 400;
      return reply.code(code).send({ success: false, error: msg });
    }
  });

  // GET /gifs/trending?limit=25
  app.get('/gifs/trending', async (req, reply) => {
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 25, 1), 50) : 25;
    try {
      const results = await trendingGifs(limit);
      return reply.send({ success: true, data: { provider: 'giphy', results } });
    } catch (err) {
      const msg = (err as Error).message;
      const code = msg.includes('not configured') ? 503 : 400;
      return reply.code(code).send({ success: false, error: msg });
    }
  });

  // ============================================================
  // 148.6 — Super Thanks
  // ============================================================

  // POST /super-thanks
  app.post('/super-thanks', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = SuperThanksSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const st = createSuperThanks({ user_id: payload.sub, ...parsed.data });
      return reply.code(201).send({ success: true, data: st });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /super-thanks/video/:videoId
  app.get('/super-thanks/video/:videoId', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    const items = listVideoSuperThanks(videoId, limit);
    const total = getVideoSuperThanksTotal(videoId);
    return reply.send({ success: true, data: { items, total } });
  });

  // GET /super-thanks/mine
  app.get('/super-thanks/mine', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    return reply.send({ success: true, data: { items: listUserSuperThanks(payload.sub, limit) } });
  });

  // GET /super-thanks/:id
  app.get('/super-thanks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const st = getSuperThanks(id);
    if (!st) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.send({ success: true, data: st });
  });
}
