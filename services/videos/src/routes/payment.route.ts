// melodyflix videos - payment routes (admin + public)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '@melodyflix/shared-auth';
import {
  createGateway, listGateways, getGatewayById, updateGateway, deleteGateway,
  createTransaction, listTransactions, getPaymentStats, getDefaultGateway,
  updateTransactionStatus, getTransactionById,
  createRefund, getRefundById, listRefundsByTransaction, listRefundsByUser,
  listAllRefunds, updateRefundStatus, getRefundStats,
  SUPPORTED_CURRENCIES, setCurrencyRate, listCurrencyRates, deleteCurrencyRate,
  convertCurrency, getCurrencyRate,
  getCrossBorderConfig, setCrossBorderConfig, computeCrossBorderFee,
  logCrossBorder, listCrossBorderLog, getCrossBorderStats,
} from '../services/payment.service.js';
import { grantMessagePack } from '../services/chatlimits.service.js';
import { getDb } from '@melodyflix/shared-db';

const CreateGatewaySchema = z.object({
  provider: z.enum(['bkash','nagad','rocket','sslcommerz','stripe','paypal','razorpay']),
  display_name: z.string().min(1).max(100),
  api_key: z.string().max(500).optional(),
  api_secret: z.string().max(500).optional(),
  merchant_id: z.string().max(200).optional(),
  base_url: z.string().max(500).optional(),
  sandbox: z.boolean().optional(),
  active: z.boolean().optional(),
  is_default: z.boolean().optional(),
});

const UpdateGatewaySchema = CreateGatewaySchema.partial();

const CreateTransactionSchema = z.object({
  purpose: z.enum(['super_chat', 'membership', 'donation', 'ppv', 'message_pack']),
  amount: z.number().min(1).max(1000000),
  currency: z.string().max(10).optional(),
  reference_id: z.string().max(200).optional(),
  metadata: z.record(z.any()).optional(),
  gateway_id: z.string().optional(),
  origin_country: z.string().min(2).max(2).optional(),
});

export async function paymentRoutes(app: FastifyInstance) {
  // ============ ADMIN ============

  app.get('/payment/gateways', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: { gateways: listGateways() } });
  });

  app.post('/payment/gateways', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const parsed = CreateGatewaySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const gw = createGateway(parsed.data);
      return reply.code(201).send({ success: true, data: gw });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.patch('/payment/gateways/:id', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const parsed = UpdateGatewaySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const { id } = req.params as { id: string };
      return reply.send({ success: true, data: updateGateway(id, parsed.data) });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  app.delete('/payment/gateways/:id', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    try {
      const { id } = req.params as { id: string };
      deleteGateway(id);
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  app.get('/payment/transactions', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(Number(q.limit ?? 100), 500);
    const offset = Number(q.offset ?? 0);
    return reply.send({
      success: true,
      data: { transactions: listTransactions(limit, offset), stats: getPaymentStats() },
    });
  });

  // ============ PUBLIC ============

  // GET /api/v1/videos/payment/available
  app.get('/payment/available', async (req, reply) => {
    const gateways = listGateways()
      .filter((g) => g.active === 1)
      .map((g) => ({
        id: g.id,
        provider: g.provider,
        display_name: g.display_name,
        sandbox: g.sandbox,
        is_default: g.is_default,
      }));
    return reply.send({ success: true, data: { gateways } });
  });

  // POST /api/v1/videos/payment/checkout
  app.post('/payment/checkout', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = CreateTransactionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    let gateway = parsed.data.gateway_id ? getGatewayById(parsed.data.gateway_id) : getDefaultGateway();
    if (!gateway || !gateway.active) {
      return reply.code(400).send({ success: false, error: 'No active payment gateway configured' });
    }

    // Cross-border fee (if origin_country supplied and differs from home)
    let crossBorder: ReturnType<typeof computeCrossBorderFee> | null = null;
    if (parsed.data.origin_country) {
      try {
        crossBorder = computeCrossBorderFee(parsed.data.amount, parsed.data.origin_country);
      } catch (err) {
        return reply.code(400).send({ success: false, error: (err as Error).message });
      }
    }

    const tx = createTransaction({
      gateway_id: gateway.id,
      user_id: user.sub,
      purpose: parsed.data.purpose,
      reference_id: parsed.data.reference_id,
      amount: parsed.data.amount,
      currency: parsed.data.currency ?? 'BDT',
      metadata: parsed.data.metadata,
      status: 'pending',
    });

    // Record cross-border info if applicable
    if (crossBorder) {
      const db = getDb();
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE payment_transactions
        SET origin_country = ?, target_country = ?, is_cross_border = ?, cross_border_fee = ?, updated_at = ?
        WHERE id = ?
      `).run(
        crossBorder.origin_country,
        crossBorder.target_country,
        crossBorder.is_cross_border ? 1 : 0,
        crossBorder.fee_amount,
        now,
        tx.id,
      );
      if (crossBorder.is_cross_border) {
        logCrossBorder({
          transaction_id: tx.id,
          origin_country: crossBorder.origin_country,
          target_country: crossBorder.target_country,
          fee_amount: crossBorder.fee_amount,
          fee_percent: crossBorder.fee_percent,
        });
      }
    }

    return reply.send({
      success: true,
      data: {
        transaction_id: tx.id,
        amount: tx.amount,
        currency: tx.currency,
        cross_border: crossBorder,
        gateway: {
          provider: gateway.provider,
          display_name: gateway.display_name,
          sandbox: gateway.sandbox === 1,
          merchant_id: gateway.merchant_id,
          base_url: gateway.base_url,
        },
      },
    });
  });

  // POST /api/v1/videos/payment/verify — called after gateway success callback
  // NOTE: real verification would call gateway's API to confirm the transaction.
  app.post('/payment/verify', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const { transaction_id, status, external_id } = req.body as {
      transaction_id: string;
      status?: string;
      external_id?: string;
    };
    if (!transaction_id) return reply.code(400).send({ success: false, error: 'transaction_id required' });

    const tx = getTransactionById(transaction_id);
    if (!tx) return reply.code(404).send({ success: false, error: 'Transaction not found' });
    if (tx.user_id !== user.sub) return reply.code(403).send({ success: false, error: 'Not authorized' });

    // Admin approves the payment manually OR gateway callback sets status='completed'
    const newStatus = status ?? 'pending';
    const updated = updateTransactionStatus(transaction_id, newStatus, external_id);

    // If completed and purpose is message_pack → grant messages
    if (newStatus === 'completed' && tx.purpose === 'message_pack') {
      try { grantMessagePack(tx.user_id, tx.id); } catch {}
    }

    return reply.send({ success: true, data: updated });
  });

  // POST /api/v1/videos/admin/payment/transactions/:id/complete — admin manual approve
  app.post('/payment/transactions/:id/complete', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const tx = getTransactionById(id);
    if (!tx) return reply.code(404).send({ success: false, error: 'Transaction not found' });
    const updated = updateTransactionStatus(id, 'completed');
    if (tx.purpose === 'message_pack') {
      try { grantMessagePack(tx.user_id, id); } catch {}
    }
    return reply.send({ success: true, data: updated });
  });

  // GET /api/v1/videos/payment/my-transactions
  app.get('/payment/my-transactions', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM payment_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
    ).all(user.sub);
    return reply.send({ success: true, data: { transactions: rows } });
  });

  // ============ REFUNDS (29.5) ============

  // POST /payment/refunds/request — user requests a refund
  app.post('/payment/refunds/request', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const BodySchema = z.object({
      transaction_id: z.string().min(1),
      amount: z.number().positive(),
      reason: z.string().max(500).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const tx = getTransactionById(parsed.data.transaction_id);
    if (!tx) return reply.code(404).send({ success: false, error: 'Transaction not found' });
    if (tx.user_id !== user.sub) return reply.code(403).send({ success: false, error: 'Not authorized' });

    try {
      const refund = createRefund({
        transaction_id: parsed.data.transaction_id,
        user_id: user.sub,
        amount: parsed.data.amount,
        reason: parsed.data.reason,
      });
      return reply.code(201).send({ success: true, data: refund });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /payment/refunds/mine — user's own refunds
  app.get('/payment/refunds/mine', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: { refunds: listRefundsByUser(user.sub) } });
  });

  // GET /payment/refunds/:id — owner or admin
  app.get('/payment/refunds/:id', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const refund = getRefundById(id);
    if (!refund) return reply.code(404).send({ success: false, error: 'Refund not found' });
    if (refund.user_id !== user.sub && user.role !== 'admin') {
      return reply.code(403).send({ success: false, error: 'Not authorized' });
    }
    return reply.send({ success: true, data: refund });
  });

  // GET /payment/refunds/by-transaction/:txId — owner or admin
  app.get('/payment/refunds/by-transaction/:txId', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { txId } = req.params as { txId: string };
    const tx = getTransactionById(txId);
    if (!tx) return reply.code(404).send({ success: false, error: 'Transaction not found' });
    if (tx.user_id !== user.sub && user.role !== 'admin') {
      return reply.code(403).send({ success: false, error: 'Not authorized' });
    }
    return reply.send({ success: true, data: { refunds: listRefundsByTransaction(txId) } });
  });

  // ============ REFUNDS — ADMIN ============

  // GET /payment/admin/refunds
  app.get('/payment/admin/refunds', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { limit?: string; offset?: string; status?: string };
    const limit = Math.min(Number(q.limit ?? 100), 500);
    const offset = Number(q.offset ?? 0);
    return reply.send({
      success: true,
      data: { refunds: listAllRefunds(limit, offset, q.status), stats: getRefundStats() },
    });
  });

  // POST /payment/admin/refunds/:id/approve
  app.post('/payment/admin/refunds/:id/approve', async (req, reply) => {
    let admin;
    try { admin = requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const { notes } = (req.body ?? {}) as { notes?: string };
    const r = updateRefundStatus(id, 'approved', admin.sub, notes);
    if (!r) return reply.code(404).send({ success: false, error: 'Refund not found' });
    return reply.send({ success: true, data: r });
  });

  // POST /payment/admin/refunds/:id/reject
  app.post('/payment/admin/refunds/:id/reject', async (req, reply) => {
    let admin;
    try { admin = requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const { notes } = (req.body ?? {}) as { notes?: string };
    const r = updateRefundStatus(id, 'rejected', admin.sub, notes);
    if (!r) return reply.code(404).send({ success: false, error: 'Refund not found' });
    return reply.send({ success: true, data: r });
  });

  // POST /payment/admin/refunds/:id/complete — mark refund fully executed (post to gateway)
  app.post('/payment/admin/refunds/:id/complete', async (req, reply) => {
    let admin;
    try { admin = requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const { external_refund_id, notes } = (req.body ?? {}) as { external_refund_id?: string; notes?: string };
    const r = updateRefundStatus(id, 'completed', admin.sub, notes, external_refund_id);
    if (!r) return reply.code(404).send({ success: false, error: 'Refund not found' });
    return reply.send({ success: true, data: r });
  });

  // GET /payment/admin/refunds/stats
  app.get('/payment/admin/refunds/stats', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: getRefundStats() });
  });

  // ============ CURRENCIES (29.8) ============

  // GET /payment/currencies — public, supported currencies
  app.get('/payment/currencies', async (_req, reply) => {
    return reply.send({ success: true, data: { currencies: SUPPORTED_CURRENCIES } });
  });

  // GET /payment/currencies/rates — public, list rates (optionally base)
  app.get('/payment/currencies/rates', async (req, reply) => {
    const q = req.query as { base?: string };
    return reply.send({ success: true, data: { rates: listCurrencyRates(q.base) } });
  });

  // GET /payment/currencies/convert?amount=&from=&to= — public
  app.get('/payment/currencies/convert', async (req, reply) => {
    const q = req.query as { amount?: string; from?: string; to?: string };
    const amount = Number(q.amount);
    if (!q.from || !q.to) return reply.code(400).send({ success: false, error: 'from and to are required' });
    if (!Number.isFinite(amount) || amount < 0) return reply.code(400).send({ success: false, error: 'amount must be non-negative number' });
    try {
      const result = convertCurrency(amount, q.from, q.to);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // PUT /payment/admin/currencies/rates — upsert rate (admin)
  app.put('/payment/admin/currencies/rates', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }

    const BodySchema = z.object({
      base: z.string().min(3).max(3),
      quote: z.string().min(3).max(3),
      rate: z.number().positive(),
      source: z.string().max(50).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const r = setCurrencyRate(parsed.data.base, parsed.data.quote, parsed.data.rate, parsed.data.source);
      return reply.send({ success: true, data: r });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /payment/admin/currencies/rates/:base/:quote — admin, single rate lookup
  app.get('/payment/admin/currencies/rates/:base/:quote', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { base, quote } = req.params as { base: string; quote: string };
    const rate = getCurrencyRate(base, quote);
    if (rate === null) return reply.code(404).send({ success: false, error: 'No rate available' });
    return reply.send({ success: true, data: { base: base.toUpperCase(), quote: quote.toUpperCase(), rate } });
  });

  // DELETE /payment/admin/currencies/rates/:base/:quote — admin
  app.delete('/payment/admin/currencies/rates/:base/:quote', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { base, quote } = req.params as { base: string; quote: string };
    const ok = deleteCurrencyRate(base, quote);
    if (!ok) return reply.code(404).send({ success: false, error: 'Rate not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // ============ CROSS-BORDER (29.12) ============

  // GET /payment/cross-border/config — public (for clients to know fee)
  app.get('/payment/cross-border/config', async (_req, reply) => {
    return reply.send({ success: true, data: getCrossBorderConfig() });
  });

  // PUT /payment/admin/cross-border/config — admin
  app.put('/payment/admin/cross-border/config', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }

    const BodySchema = z.object({
      home_country: z.string().min(2).max(2).optional(),
      fee_percent: z.number().min(0).max(100).optional(),
      blocked_countries: z.array(z.string().min(2).max(2)).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      return reply.send({ success: true, data: setCrossBorderConfig(parsed.data) });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /payment/admin/cross-border/stats — admin
  app.get('/payment/admin/cross-border/stats', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: getCrossBorderStats() });
  });

  // GET /payment/admin/cross-border/log — admin
  app.get('/payment/admin/cross-border/log', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(Number(q.limit ?? 100), 500);
    const offset = Number(q.offset ?? 0);
    return reply.send({ success: true, data: { entries: listCrossBorderLog(limit, offset) } });
  });
}
