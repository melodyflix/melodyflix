// melodyflix videos - Page Builder billing routes (Section 43 Phase 4)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole, requireAuth } from '@melodyflix/shared-auth';
import {
  ensureBuilderBillingSchema,
  getPricingConfig, setPricingConfig, computeComplexity,
  createBuilderOrder, getBuilderOrder, listBuilderOrdersByUser,
  listAllBuilderOrders, markOrderPaid, cancelOrder,
  verifyDownloadToken, recordDownload, exportPage,
  createListing, getListing, listListings, updateListing, deleteListing,
  createMarketplacePurchase, markMarketplacePurchasePaid,
  listMyPurchases, hasPurchased,
} from '../services/builder-billing.service.js';

export async function builderBillingRoutes(app: FastifyInstance) {
  ensureBuilderBillingSchema();

  const isAdmin = async (req: any, reply: any) => {
    try { requireRole(req.headers.authorization, ['admin']); return true; }
    catch (err) { reply.code(403).send({ success: false, error: (err as Error).message }); return false; }
  };
  const authUser = (req: any): string | null => {
    try { return requireAuth(req.headers.authorization).sub; } catch { return null; }
  };

  // ============ 43.17 Pricing config ============
  app.get('/builder/pricing', async (_req, reply) => {
    return reply.send({ success: true, data: getPricingConfig() });
  });

  app.put('/builder/admin/pricing', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const BodySchema = z.object({
      base_price: z.number().min(0).optional(),
      per_page: z.number().min(0).optional(),
      per_element: z.number().min(0).optional(),
      per_premium_widget: z.number().min(0).optional(),
      complexity_multiplier: z.number().min(0.1).max(100).optional(),
      currency: z.string().length(3).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    return reply.send({ success: true, data: setPricingConfig(parsed.data) });
  });

  // Quote complexity for a page
  app.get('/builder/pages/:pageId/quote', async (req, reply) => {
    const { pageId } = req.params as { pageId: string };
    return reply.send({ success: true, data: computeComplexity([pageId]) });
  });

  // ============ 43.18 / 43.19 Orders ============
  app.post('/builder/pages/:pageId/order', async (req, reply) => {
    const userId = authUser(req);
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { pageId } = req.params as { pageId: string };
    try {
      const order = createBuilderOrder(userId, pageId);
      return reply.code(201).send({ success: true, data: order });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.get('/builder/orders/mine', async (req, reply) => {
    const userId = authUser(req);
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    return reply.send({ success: true, data: { orders: listBuilderOrdersByUser(userId) } });
  });

  app.get('/builder/orders/:id', async (req, reply) => {
    const userId = authUser(req);
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const order = getBuilderOrder(id);
    if (!order) return reply.code(404).send({ success: false, error: 'Order not found' });
    if (order.user_id !== userId) {
      // allow admin
      try { requireRole(req.headers.authorization, ['admin']); }
      catch { return reply.code(403).send({ success: false, error: 'Not authorized' }); }
    }
    return reply.send({ success: true, data: order });
  });

  app.post('/builder/orders/:id/cancel', async (req, reply) => {
    const userId = authUser(req);
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const order = getBuilderOrder(id);
    if (!order) return reply.code(404).send({ success: false, error: 'Order not found' });
    if (order.user_id !== userId) return reply.code(403).send({ success: false, error: 'Not authorized' });
    try { return reply.send({ success: true, data: cancelOrder(id) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // ============ ADMIN ORDERS ============
  app.get('/builder/admin/orders', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const q = req.query as { limit?: string; offset?: string };
    return reply.send({ success: true, data: { orders: listAllBuilderOrders(Number(q.limit ?? 100), Number(q.offset ?? 0)) } });
  });

  // Admin marks paid (or webhook from payment service calls this)
  app.post('/builder/admin/orders/:id/mark-paid', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const { payment_transaction_id } = (req.body ?? {}) as { payment_transaction_id?: string };
    const order = markOrderPaid(id, payment_transaction_id);
    if (!order) return reply.code(404).send({ success: false, error: 'Order not found' });
    return reply.send({ success: true, data: order });
  });

  // ============ 43.20 DOWNLOAD ============
  app.get('/builder/download/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const q = req.query as { format?: string };
    const format = q.format === 'html' ? 'html' : 'json';
    const check = verifyDownloadToken(token);
    if (!check.valid || !check.order) {
      return reply.code(403).send({ success: false, error: check.reason ?? 'invalid token' });
    }
    try {
      const exported = exportPage(check.order.page_id, format);
      recordDownload(check.order.id);
      reply
        .header('Content-Type', format === 'html' ? 'text/html; charset=utf-8' : 'application/json')
        .header('Content-Disposition', `attachment; filename="page-${check.order.page_id}.${format}"`);
      return reply.send(format === 'html' ? (exported.payload as { html: string }).html : JSON.stringify(exported, null, 2));
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/builder/orders/:id/download-token/verify', async (req, reply) => {
    const { token } = (req.body ?? {}) as { token?: string };
    if (!token) return reply.code(400).send({ success: false, error: 'token required' });
    return reply.send({ success: true, data: verifyDownloadToken(token) });
  });

  // ============ 43.21 MARKETPLACE ============
  app.get('/builder/marketplace', async (req, reply) => {
    const q = req.query as { category?: string; seller_id?: string; limit?: string; offset?: string };
    return reply.send({ success: true, data: { listings: listListings({
      category: q.category, seller_id: q.seller_id,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    }) } });
  });

  app.get('/builder/marketplace/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const l = getListing(id);
    if (!l) return reply.code(404).send({ success: false, error: 'Listing not found' });
    return reply.send({ success: true, data: l });
  });

  app.post('/builder/marketplace', async (req, reply) => {
    const userId = authUser(req);
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const BodySchema = z.object({
      template_id: z.string().min(1),
      title: z.string().min(1).max(120),
      description: z.string().max(2000).optional(),
      price: z.number().min(0),
      currency: z.string().length(3).optional(),
      category: z.string().max(60).optional(),
      thumbnail_url: z.string().max(500).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const l = createListing({ seller_id: userId, ...parsed.data });
      return reply.code(201).send({ success: true, data: l });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.patch('/builder/marketplace/:id', async (req, reply) => {
    const userId = authUser(req);
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const cur = getListing(id);
    if (!cur) return reply.code(404).send({ success: false, error: 'Listing not found' });
    let isAdminUser = false;
    try { requireRole(req.headers.authorization, ['admin']); isAdminUser = true; } catch {}
    if (cur.seller_id !== userId && !isAdminUser) return reply.code(403).send({ success: false, error: 'Not your listing' });
    const BodySchema = z.object({
      title: z.string().min(1).max(120).optional(),
      description: z.string().max(2000).nullable().optional(),
      price: z.number().min(0).optional(),
      category: z.string().max(60).nullable().optional(),
      thumbnail_url: z.string().max(500).nullable().optional(),
      is_active: z.boolean().optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const updated = updateListing(id, parsed.data);
    return reply.send({ success: true, data: updated });
  });

  app.delete('/builder/marketplace/:id', async (req, reply) => {
    const userId = authUser(req);
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const cur = getListing(id);
    if (!cur) return reply.code(404).send({ success: false, error: 'Listing not found' });
    let isAdminUser = false;
    try { requireRole(req.headers.authorization, ['admin']); isAdminUser = true; } catch {}
    if (cur.seller_id !== userId && !isAdminUser) return reply.code(403).send({ success: false, error: 'Not your listing' });
    deleteListing(id);
    return reply.send({ success: true, data: { deleted: true } });
  });

  // --- Marketplace purchases ---
  app.post('/builder/marketplace/:id/purchase', async (req, reply) => {
    const userId = authUser(req);
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const p = createMarketplacePurchase(userId, id);
      return reply.code(201).send({ success: true, data: p });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.post('/builder/admin/marketplace-purchases/:id/mark-paid', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const { transaction_id } = (req.body ?? {}) as { transaction_id?: string };
    const p = markMarketplacePurchasePaid(id, transaction_id);
    if (!p) return reply.code(404).send({ success: false, error: 'Purchase not found' });
    return reply.send({ success: true, data: p });
  });

  app.get('/builder/marketplace/purchases/mine', async (req, reply) => {
    const userId = authUser(req);
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    return reply.send({ success: true, data: { purchases: listMyPurchases(userId) } });
  });

  app.get('/builder/marketplace/:id/purchased', async (req, reply) => {
    const userId = authUser(req);
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: { purchased: hasPurchased(userId, id) } });
  });
}
