// melodyflix videos - Section 15.4 Creator Marketplace routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  createListing, getListing, listListings, updateListing, deleteListing,
  createOrder, getOrder, listOrders, updateOrderStatus,
  deliverOrder, completeOrder, cancelOrder, openDispute,
  addReview, listReviews,
  sendMessage, listMessages,
  getListingSummary, getMarketplaceStats,
} from '../services/marketplace.service.js';

const CATEGORIES = ['thumbnail','editing','music','voiceover','animation','subtitle','promo','other'] as const;
const L_STATUSES = ['draft','active','paused','archived'] as const;
const O_STATUSES = ['pending','in_progress','delivered','revision','completed','cancelled','disputed'] as const;

const ListingSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  category: z.enum(CATEGORIES).optional(),
  price_cents: z.number().int().min(0).max(100000000).optional(),
  currency: z.string().min(3).max(3).optional(),
  delivery_days: z.number().int().min(1).max(180).optional(),
  revisions: z.number().int().min(0).max(20).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  status: z.enum(L_STATUSES).optional(),
});

const UpdateListingSchema = ListingSchema.partial();

const OrderSchema = z.object({
  listing_id: z.string().min(1).max(100),
  requirements: z.string().max(5000).nullable().optional(),
  deadline_days: z.number().int().min(1).max(180).optional(),
});

const StatusSchema = z.object({ status: z.enum(O_STATUSES) });

const ReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).nullable().optional(),
});

const MessageSchema = z.object({ body: z.string().min(1).max(4000) });

function uid(auth: string | undefined): string | null {
  try {
    const p: any = requireRole(auth, ['admin','user','moderator']);
    return p?.sub ?? p?.id ?? null;
  } catch { return null; }
}
function admin(auth: string | undefined): boolean {
  try { requireRole(auth, ['admin']); return true; } catch { return false; }
}

export async function marketplaceRoutes(app: FastifyInstance): Promise<void> {
  // ============ LISTINGS ============
  app.post('/marketplace/listings', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = ListingSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createListing({ creator_id: actor, ...p.data }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/marketplace/listings', async (req, reply) => {
    const q = req.query as { creator_id?: string; category?: string; status?: string; min_price?: string; max_price?: string; limit?: string };
    return reply.send({ success: true, data: { listings: listListings({
      creator_id: q.creator_id,
      category: q.category as any,
      status: q.status as any,
      min_price: q.min_price ? Number(q.min_price) : undefined,
      max_price: q.max_price ? Number(q.max_price) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    }) } });
  });

  app.get('/marketplace/listings/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = getListingSummary(id);
    if (!s) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: s });
  });

  app.patch('/marketplace/listings/:id', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const p = UpdateListingSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try {
      const r = updateListing(id, actor, p.data);
      return r ? reply.send({ success: true, data: r }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(403).send({ success: false, error: (e as Error).message }); }
  });

  app.delete('/marketplace/listings/:id', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    try {
      const ok = deleteListing(id, actor);
      return ok ? reply.send({ success: true, data: { archived: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(409).send({ success: false, error: (e as Error).message }); }
  });

  // ============ ORDERS ============
  app.post('/marketplace/orders', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = OrderSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createOrder({ buyer_id: actor, ...p.data }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/marketplace/orders', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const q = req.query as { box?: string; listing_id?: string; status?: string; limit?: string };
    const filter: any = { listing_id: q.listing_id, status: q.status as any, limit: q.limit ? Number(q.limit) : undefined };
    if (q.box === 'seller') filter.seller_id = actor;
    else if (q.box === 'buyer') filter.buyer_id = actor;
    else { filter.buyer_id = actor; filter.seller_id = actor; } // handled below
    if (!q.box) {
      const buyer = listOrders({ ...filter, buyer_id: actor, seller_id: undefined });
      const seller = listOrders({ ...filter, seller_id: actor, buyer_id: undefined });
      const seen = new Set<string>();
      const merged = [...buyer, ...seller].filter(o => seen.has(o.id) ? false : (seen.add(o.id), true));
      return reply.send({ success: true, data: { orders: merged } });
    }
    return reply.send({ success: true, data: { orders: listOrders(filter) } });
  });

  app.get('/marketplace/orders/:id', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const o = getOrder(id);
    if (!o) return reply.code(404).send({ success: false, error: 'not_found' });
    if (o.buyer_id !== actor && o.seller_id !== actor && !admin(req.headers.authorization)) {
      return reply.code(403).send({ success: false, error: 'not_participant' });
    }
    return reply.send({ success: true, data: o });
  });

  app.patch('/marketplace/orders/:id/status', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const p = StatusSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: updateOrderStatus(id, actor, p.data.status) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/marketplace/orders/:id/deliver', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: deliverOrder(id, actor) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/marketplace/orders/:id/complete', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: completeOrder(id, actor) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/marketplace/orders/:id/cancel', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: cancelOrder(id, actor) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/marketplace/orders/:id/dispute', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: openDispute(id, actor) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  // ============ REVIEWS ============
  app.post('/marketplace/orders/:id/reviews', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const p = ReviewSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: addReview({ order_id: id, reviewer_id: actor, ...p.data }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/marketplace/reviews', async (req, reply) => {
    const q = req.query as { reviewee_id?: string; order_id?: string; limit?: string };
    return reply.send({ success: true, data: { reviews: listReviews({
      reviewee_id: q.reviewee_id, order_id: q.order_id, limit: q.limit ? Number(q.limit) : undefined,
    }) } });
  });

  // ============ MESSAGES ============
  app.post('/marketplace/orders/:id/messages', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const p = MessageSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: sendMessage(id, actor, p.data.body) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/marketplace/orders/:id/messages', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string };
    const o = getOrder(id);
    if (!o) return reply.code(404).send({ success: false, error: 'not_found' });
    if (o.buyer_id !== actor && o.seller_id !== actor && !admin(req.headers.authorization)) {
      return reply.code(403).send({ success: false, error: 'not_participant' });
    }
    return reply.send({ success: true, data: { messages: listMessages(id, q.limit ? Number(q.limit) : 200) } });
  });

  // ============ STATS ============
  app.get('/marketplace/stats', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getMarketplaceStats() });
  });
}
