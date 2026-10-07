// melodyflix videos - Section 24 Video Interactivity routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  createHotspot, listHotspots, updateHotspot, deleteHotspot,
  createCard, listCards, deleteCard,
  createBranch, listBranches, deleteBranch,
  createShoppable, listShoppable, deleteShoppable,
  getInteractivityAt, getInteractivityBundle, getInteractivityStats,
} from '../services/video-interactivity.service.js';

const HOTSPOT_ACTIONS = ['link','seek','branch','tooltip'] as const;
const CARD_TYPES = ['info','channel','video','playlist','link'] as const;
const BRANCH_KINDS = ['video','ending'] as const;

const HotspotSchema = z.object({
  video_id: z.string().min(1).max(100),
  channel_id: z.string().min(1).max(100),
  label: z.string().min(1).max(120),
  start_seconds: z.number().min(0).max(86400),
  end_seconds: z.number().min(0).max(86400),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
  width: z.number().min(0).max(1).optional(),
  height: z.number().min(0).max(1).optional(),
  action_type: z.enum(HOTSPOT_ACTIONS).optional(),
  action_value: z.string().max(1000).nullable().optional(),
  tooltip: z.string().max(500).nullable().optional(),
  style: z.string().max(200).nullable().optional(),
});

const UpdateHotspotSchema = HotspotSchema.partial().omit({ video_id: true, channel_id: true }).extend({
  active: z.boolean().optional(),
});

const CardSchema = z.object({
  video_id: z.string().min(1).max(100),
  channel_id: z.string().min(1).max(100),
  card_type: z.enum(CARD_TYPES),
  show_at_seconds: z.number().min(0).max(86400),
  title: z.string().min(1).max(200),
  body: z.string().max(2000).nullable().optional(),
  target_id: z.string().max(200).nullable().optional(),
  target_url: z.string().max(1000).nullable().optional(),
  thumbnail_url: z.string().max(1000).nullable().optional(),
});

const BranchSchema = z.object({
  video_id: z.string().min(1).max(100),
  channel_id: z.string().min(1).max(100),
  at_seconds: z.number().min(0).max(86400),
  prompt: z.string().min(1).max(300),
  target_kind: z.enum(BRANCH_KINDS).optional(),
  target_video_id: z.string().max(100).nullable().optional(),
  label: z.string().min(1).max(120),
  countdown_seconds: z.number().int().min(0).max(60).optional(),
  is_default: z.boolean().optional(),
});

const ShoppableSchema = z.object({
  video_id: z.string().min(1).max(100),
  channel_id: z.string().min(1).max(100),
  product_name: z.string().min(1).max(200),
  product_url: z.string().min(1).max(1000),
  image_url: z.string().max(1000).nullable().optional(),
  price_cents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  currency: z.string().max(6).optional(),
  show_from_seconds: z.number().min(0).max(86400).optional(),
  show_to_seconds: z.number().min(0).max(86400).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
});

function authPayload(auth: string | undefined): { sub: string } | null {
  try { return { sub: requireAuth(auth).sub as string }; } catch { return null; }
}

export async function videoInteractivityRoutes(app: FastifyInstance): Promise<void> {
  // ---------- Public playback ----------
  app.get('/interactivity/videos/:videoId/at/:seconds', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const s = Number((req.params as { seconds: string }).seconds);
    if (!Number.isFinite(s)) return reply.code(400).send({ success: false, error: 'invalid_seconds' });
    return reply.send({ success: true, data: getInteractivityAt(videoId, s) });
  });

  app.get('/interactivity/videos/:videoId', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    return reply.send({ success: true, data: getInteractivityBundle(videoId) });
  });

  app.get('/interactivity/channels/:channelId/stats', async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    return reply.send({ success: true, data: getInteractivityStats(channelId) });
  });

  // ---------- Hotspots (admin/creator) ----------
  app.post('/interactivity/hotspots', async (req, reply) => {
    const u = authPayload(req.headers.authorization);
    if (!u) return reply.code(401).send({ success: false, error: 'unauthorized' });
    const p = HotspotSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try {
      const hs = createHotspot(p.data, u.sub);
      return reply.code(201).send({ success: true, data: hs });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.get('/interactivity/videos/:videoId/hotspots', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { all?: string };
    return reply.send({ success: true, data: { hotspots: listHotspots(videoId, q.all !== 'true') } });
  });

  app.patch('/interactivity/hotspots/:id', async (req, reply) => {
    const u = authPayload(req.headers.authorization);
    if (!u) return reply.code(401).send({ success: false, error: 'unauthorized' });
    const p = UpdateHotspotSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body' });
    const { id } = req.params as { id: string };
    const channel_id = (req.body as any)?.channel_id as string | undefined;
    if (!channel_id) return reply.code(400).send({ success: false, error: 'channel_id_required' });
    const updated = updateHotspot(id, channel_id, p.data);
    if (!updated) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: updated });
  });

  app.delete('/interactivity/hotspots/:id', async (req, reply) => {
    const u = authPayload(req.headers.authorization);
    if (!u) return reply.code(401).send({ success: false, error: 'unauthorized' });
    const { id } = req.params as { id: string };
    const q = req.query as { channel_id?: string };
    if (!q.channel_id) return reply.code(400).send({ success: false, error: 'channel_id_required' });
    const ok = deleteHotspot(id, q.channel_id);
    return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  // ---------- Cards ----------
  app.post('/interactivity/cards', async (req, reply) => {
    const u = authPayload(req.headers.authorization);
    if (!u) return reply.code(401).send({ success: false, error: 'unauthorized' });
    const p = CardSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    const c = createCard(p.data, u.sub);
    return reply.code(201).send({ success: true, data: c });
  });

  app.get('/interactivity/videos/:videoId/cards', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { all?: string };
    return reply.send({ success: true, data: { cards: listCards(videoId, q.all !== 'true') } });
  });

  app.delete('/interactivity/cards/:id', async (req, reply) => {
    const u = authPayload(req.headers.authorization);
    if (!u) return reply.code(401).send({ success: false, error: 'unauthorized' });
    const { id } = req.params as { id: string };
    const q = req.query as { channel_id?: string };
    if (!q.channel_id) return reply.code(400).send({ success: false, error: 'channel_id_required' });
    const ok = deleteCard(id, q.channel_id);
    return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  // ---------- Branches ----------
  app.post('/interactivity/branches', async (req, reply) => {
    const u = authPayload(req.headers.authorization);
    if (!u) return reply.code(401).send({ success: false, error: 'unauthorized' });
    const p = BranchSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    const b = createBranch(p.data, u.sub);
    return reply.code(201).send({ success: true, data: b });
  });

  app.get('/interactivity/videos/:videoId/branches', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { all?: string };
    return reply.send({ success: true, data: { branches: listBranches(videoId, q.all !== 'true') } });
  });

  app.delete('/interactivity/branches/:id', async (req, reply) => {
    const u = authPayload(req.headers.authorization);
    if (!u) return reply.code(401).send({ success: false, error: 'unauthorized' });
    const { id } = req.params as { id: string };
    const q = req.query as { channel_id?: string };
    if (!q.channel_id) return reply.code(400).send({ success: false, error: 'channel_id_required' });
    const ok = deleteBranch(id, q.channel_id);
    return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  // ---------- Shoppable ----------
  app.post('/interactivity/shoppable', async (req, reply) => {
    const u = authPayload(req.headers.authorization);
    if (!u) return reply.code(401).send({ success: false, error: 'unauthorized' });
    const p = ShoppableSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    const s = createShoppable(p.data, u.sub);
    return reply.code(201).send({ success: true, data: s });
  });

  app.get('/interactivity/videos/:videoId/shoppable', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { all?: string };
    return reply.send({ success: true, data: { products: listShoppable(videoId, q.all !== 'true') } });
  });

  app.delete('/interactivity/shoppable/:id', async (req, reply) => {
    const u = authPayload(req.headers.authorization);
    if (!u) return reply.code(401).send({ success: false, error: 'unauthorized' });
    const { id } = req.params as { id: string };
    const q = req.query as { channel_id?: string };
    if (!q.channel_id) return reply.code(400).send({ success: false, error: 'channel_id_required' });
    const ok = deleteShoppable(id, q.channel_id);
    return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });
}
