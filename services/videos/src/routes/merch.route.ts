// melodyflix videos — Merch + Affiliate routes (10.7, 10.8)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  createMerchItem, getMerchItem, listMerchByChannel, listMerchByOwner,
  updateMerchItem, deleteMerchItem, reorderMerch,
  recordMerchClick, getMerchItemStats,
  createAffiliateLink, getAffiliateLink, getAffiliateBySlug, listAffiliateLinks,
  updateAffiliateLink, deleteAffiliateLink, resolveAffiliateRedirect,
  getAffiliateStats,
} from '../services/merch.service.js';

function userId(req: any): string | null {
  return req.user?.id ?? req.user?.sub ?? null;
}

export async function merchRoutes(app: FastifyInstance) {
  // ---- 10.7 Merch ----

  const MerchCreateSchema = z.object({
    channel_id: z.string().min(1),
    name: z.string().min(1).max(120),
    description: z.string().max(1000).nullable().optional(),
    image_url: z.string().url().nullable().optional(),
    product_url: z.string().url(),
    price: z.number().min(0).max(1_000_000).nullable().optional(),
    currency: z.string().min(3).max(3).optional(),
    category: z.string().max(60).nullable().optional(),
    position: z.number().int().min(0).max(100).optional(),
  });

  app.post('/merch/items', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = MerchCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const item = createMerchItem({ owner_id: me, ...parsed.data });
      return reply.code(201).send({ success: true, data: { item } });
    } catch (e: any) {
      const msg = e?.message ?? 'Create failed';
      if (msg.startsWith('Max')) return reply.code(409).send({ success: false, error: msg });
      return reply.code(400).send({ success: false, error: msg });
    }
  });

  app.get('/merch/items/mine', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const q = req.query as { limit?: string };
    const items = listMerchByOwner(me, q.limit ? parseInt(q.limit) : 100);
    return reply.send({ success: true, data: { items, count: items.length } });
  });

  app.get('/merch/channels/:channelId', async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const q = req.query as { include_inactive?: string };
    const items = listMerchByChannel(channelId, q.include_inactive === 'true');
    return reply.send({ success: true, data: { items, count: items.length } });
  });

  app.get('/merch/items/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = getMerchItem(id);
    if (!item) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.send({ success: true, data: { item } });
  });

  const MerchUpdateSchema = MerchCreateSchema.partial().omit({ channel_id: true }).extend({
    is_active: z.boolean().optional(),
  });

  app.patch('/merch/items/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const parsed = MerchUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const item = updateMerchItem(id, me, parsed.data);
      if (!item) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { item } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  app.delete('/merch/items/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const ok = deleteMerchItem(id, me);
      if (!ok) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { deleted: true } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  const ReorderSchema = z.object({
    channel_id: z.string().min(1),
    ordered_ids: z.array(z.string().min(1)).min(1).max(50),
  });

  app.post('/merch/reorder', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = ReorderSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const items = reorderMerch(parsed.data.channel_id, me, parsed.data.ordered_ids);
    return reply.send({ success: true, data: { items } });
  });

  // Click-through (public)
  const ClickSchema = z.object({
    referrer_video_id: z.string().nullable().optional(),
  });

  app.post('/merch/items/:id/click', async (req, reply) => {
    const me = userId(req as any);
    const { id } = req.params as { id: string };
    const parsed = ClickSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      recordMerchClick({
        merch_id: id,
        user_id: me,
        referrer_video_id: parsed.data.referrer_video_id ?? null,
      });
      return reply.code(202).send({ success: true, data: { recorded: true } });
    } catch (e: any) {
      if (e?.message === 'Merch item not found') return reply.code(404).send({ success: false, error: e.message });
      throw e;
    }
  });

  app.get('/merch/items/:id/stats', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const item = getMerchItem(id);
    if (!item) return reply.code(404).send({ success: false, error: 'Not found' });
    if (item.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your item' });
    return reply.send({ success: true, data: getMerchItemStats(id) });
  });

  // ---- 10.8 Affiliate ----

  const AffiliateCreateSchema = z.object({
    label: z.string().min(1).max(80),
    target_url: z.string().url(),
    slug: z.string().min(3).max(40).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  });

  app.post('/affiliate/links', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = AffiliateCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const link = createAffiliateLink({ owner_id: me, ...parsed.data });
      return reply.code(201).send({ success: true, data: { link } });
    } catch (e: any) {
      const msg = e?.message ?? 'Create failed';
      if (msg.includes('taken')) return reply.code(409).send({ success: false, error: msg });
      return reply.code(400).send({ success: false, error: msg });
    }
  });

  app.get('/affiliate/links/mine', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const q = req.query as { limit?: string };
    const links = listAffiliateLinks(me, q.limit ? parseInt(q.limit) : 100);
    return reply.send({ success: true, data: { links, count: links.length } });
  });

  app.get('/affiliate/links/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const link = getAffiliateLink(id);
    if (!link) return reply.code(404).send({ success: false, error: 'Not found' });
    if (link.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your link' });
    return reply.send({ success: true, data: { link } });
  });

  const AffiliateUpdateSchema = z.object({
    label: z.string().min(1).max(80).optional(),
    target_url: z.string().url().optional(),
    is_active: z.boolean().optional(),
  });

  app.patch('/affiliate/links/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const parsed = AffiliateUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const link = updateAffiliateLink(id, me, parsed.data);
      if (!link) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { link } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  app.delete('/affiliate/links/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const ok = deleteAffiliateLink(id, me);
      if (!ok) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { deleted: true } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  // Redirect resolver — public. Returns target URL, records click
  app.get('/a/:slug', async (req, reply) => {
    const me = userId(req as any);
    const { slug } = req.params as { slug: string };
    const q = req.query as { rv?: string; to?: string };
    const ua = req.headers['user-agent'] as string | undefined;
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      ?? req.ip
      ?? null;
    let ipHash: string | null = null;
    if (ip) {
      // Simple non-reversible hash — full IP not stored
      const { createHash } = await import('node:crypto');
      ipHash = createHash('sha256').update(ip + ':' + slug).digest('hex').slice(0, 32);
    }
    const result = resolveAffiliateRedirect(slug, {
      user_id: me,
      referrer_video_id: q.rv ?? null,
      ip_hash: ipHash,
      user_agent: ua ?? null,
    });
    if (!result.ok) {
      if (q.to) return reply.redirect(q.to); // graceful fallback
      return reply.code(404).send({ success: false, error: result.reason ?? 'Not found' });
    }
    return reply.redirect(result.target_url!);
  });

  // Preview without clicking (for UI link card)
  app.get('/affiliate/resolve/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const link = getAffiliateBySlug(slug);
    if (!link) return reply.code(404).send({ success: false, error: 'Not found' });
    if (link.is_active !== 1) return reply.code(410).send({ success: false, error: 'Inactive' });
    return reply.send({
      success: true,
      data: { label: link.label, target_url: link.target_url, slug: link.slug },
    });
  });

  app.get('/affiliate/links/:id/stats', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const link = getAffiliateLink(id);
    if (!link) return reply.code(404).send({ success: false, error: 'Not found' });
    if (link.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your link' });
    return reply.send({ success: true, data: getAffiliateStats(id) });
  });
}
