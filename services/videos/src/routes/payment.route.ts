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
  getThreeDSConfig, setThreeDSConfig, requiresThreeDS, createThreeDSSession,
  getThreeDSSession, listThreeDSSessions, listThreeDSSessionsByTransaction,
  completeThreeDSSession, getThreeDSStats,
  getCryptoConfig, setCryptoConfig, createCryptoPayment, getCryptoPaymentById,
  listCryptoPayments, listCryptoPaymentsByUser, confirmCryptoPayment,
  failCryptoPayment, expireCryptoPayments, getCryptoStats,
  getTaxConfig, setTaxConfig, upsertTaxRate, deleteTaxRate, listTaxRates,
  getTaxRateFor, calculateTax, recordTax, listTaxRecords, getTaxStats,
  detectCardBrand, luhnCheck, createCardToken, getCardToken,
  listCardTokensByUser, listAllCardTokens, setDefaultCardToken,
  revokeCardToken, markCardTokenUsed, getTokenizationStats, listTokenizationLog,
  CHARGEBACK_REASON_CODES, createChargeback, getChargebackById, listChargebacks,
  listChargebacksByUser, listChargebacksByTransaction, addChargebackEvidence,
  respondToChargeback, resolveChargeback, listChargebackEvents, getChargebackStats,
  getRiskConfig, setRiskConfig, listRiskRules, upsertRiskRule, deleteRiskRule,
  computeRiskScore, assessTransaction, getRiskAssessmentById, listRiskAssessments,
  listRiskAssessmentsByTransaction, getRiskStats,
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
  tax_country: z.string().min(2).max(2).optional(),
  tax_region: z.string().max(10).optional(),
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

    // Tax calculation (29.13)
    let tax = null;
    if (parsed.data.tax_country) {
      const taxableBase = parsed.data.amount + (crossBorder?.fee_amount ?? 0);
      tax = calculateTax(taxableBase, parsed.data.tax_country, parsed.data.tax_region);
      if (tax.applied) {
        try { recordTax(tx.id, tax); } catch {}
      }
    }

    // Risk assessment (29.17)
    let risk = null;
    try {
      const homeCountry = getCrossBorderConfig().home_country;
      risk = assessTransaction({
        user_id: user.sub,
        amount: tx.amount,
        currency: tx.currency,
        origin_country: parsed.data.origin_country,
        home_country: homeCountry,
        gateway_provider: gateway.provider,
        is_crypto: false,
      }, tx.id);
    } catch { /* risk assessment failure should not block checkout by default */ }

    if (risk && risk.decision === 'block') {
      return reply.code(403).send({
        success: false,
        error: 'Transaction blocked by risk scoring',
        risk,
      });
    }

    // 3DS — auto-create session when threshold+provider match
    const bodyReturnUrl = (req.body as { return_url?: string })?.return_url;
    let threeDs = null;
    if (requiresThreeDS(gateway.provider, tx.amount)) {
      try {
        threeDs = createThreeDSSession({
          transaction_id: tx.id,
          user_id: user.sub,
          amount: tx.amount,
          currency: tx.currency,
          gateway_provider: gateway.provider,
          return_url: bodyReturnUrl,
        });
      } catch (err) {
        return reply.code(500).send({ success: false, error: (err as Error).message });
      }
    }

    return reply.send({
      success: true,
      data: {
        transaction_id: tx.id,
        amount: tx.amount,
        currency: tx.currency,
        cross_border: crossBorder,
        tax: tax,
        risk: risk,
        requires_3ds: threeDs !== null,
        three_ds_session: threeDs,
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

  // ============ 3D SECURE (29.14) ============

  // GET /payment/3ds/config — public (client needs to know threshold)
  app.get('/payment/3ds/config', async (_req, reply) => {
    return reply.send({ success: true, data: getThreeDSConfig() });
  });

  // PUT /payment/admin/3ds/config — admin
  app.put('/payment/admin/3ds/config', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }

    const BodySchema = z.object({
      threshold_amount: z.number().min(0).optional(),
      supported_providers: z.array(z.string()).optional(),
      session_ttl_minutes: z.number().int().min(1).max(1440).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      return reply.send({ success: true, data: setThreeDSConfig(parsed.data) });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /payment/3ds/sessions/:id — owner or admin
  app.get('/payment/3ds/sessions/:id', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const session = getThreeDSSession(id);
    if (!session) return reply.code(404).send({ success: false, error: 'Session not found' });
    if (session.user_id !== user.sub && user.role !== 'admin') {
      return reply.code(403).send({ success: false, error: 'Not authorized' });
    }
    return reply.send({ success: true, data: session });
  });

  // GET /payment/3ds/by-transaction/:txId — owner or admin
  app.get('/payment/3ds/by-transaction/:txId', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { txId } = req.params as { txId: string };
    const tx = getTransactionById(txId);
    if (!tx) return reply.code(404).send({ success: false, error: 'Transaction not found' });
    if (tx.user_id !== user.sub && user.role !== 'admin') {
      return reply.code(403).send({ success: false, error: 'Not authorized' });
    }
    return reply.send({ success: true, data: { sessions: listThreeDSSessionsByTransaction(txId) } });
  });

  // POST /payment/3ds/sessions/:id/complete — owner submits 3DS outcome
  app.post('/payment/3ds/sessions/:id/complete', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const session = getThreeDSSession(id);
    if (!session) return reply.code(404).send({ success: false, error: 'Session not found' });
    if (session.user_id !== user.sub && user.role !== 'admin') {
      return reply.code(403).send({ success: false, error: 'Not authorized' });
    }

    const BodySchema = z.object({
      outcome: z.enum(['passed', 'failed']),
      notes: z.string().max(500).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const updated = completeThreeDSSession(id, parsed.data.outcome, parsed.data.notes);
    if (!updated) return reply.code(404).send({ success: false, error: 'Session not found' });
    return reply.send({ success: true, data: updated });
  });

  // ============ 3DS — ADMIN ============

  // GET /payment/admin/3ds/sessions — admin
  app.get('/payment/admin/3ds/sessions', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { limit?: string; offset?: string; status?: string };
    const limit = Math.min(Number(q.limit ?? 100), 500);
    const offset = Number(q.offset ?? 0);
    return reply.send({ success: true, data: { sessions: listThreeDSSessions(limit, offset, q.status) } });
  });

  // GET /payment/admin/3ds/stats — admin
  app.get('/payment/admin/3ds/stats', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: getThreeDSStats() });
  });

  // ============ CRYPTO (29.10) ============

  // GET /payment/crypto/config — public (safe fields only)
  app.get('/payment/crypto/config', async (_req, reply) => {
    return reply.send({ success: true, data: getCryptoConfig() });
  });

  // PUT /payment/admin/crypto/config — admin
  app.put('/payment/admin/crypto/config', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }

    const BodySchema = z.object({
      enabled: z.boolean().optional(),
      supported_coins: z.array(z.enum(['BTC', 'ETH', 'USDT', 'USDC', 'BNB'])).optional(),
      binance_pay_enabled: z.boolean().optional(),
      binance_merchant_id: z.string().max(200).nullable().optional(),
      binance_api_key: z.string().max(500).nullable().optional(),
      binance_api_secret: z.string().max(500).nullable().optional(),
      required_confirmations: z.record(z.number().int().min(0).max(100)).optional(),
      payment_ttl_minutes: z.number().int().min(5).max(1440).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      return reply.send({ success: true, data: setCryptoConfig(parsed.data) });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /payment/crypto/create — user creates crypto payment for a transaction
  app.post('/payment/crypto/create', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const BodySchema = z.object({
      transaction_id: z.string().min(1),
      coin: z.enum(['BTC', 'ETH', 'USDT', 'USDC', 'BNB']),
      amount_crypto: z.number().positive(),
      provider: z.enum(['binance_pay', 'wallet']).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const tx = getTransactionById(parsed.data.transaction_id);
    if (!tx) return reply.code(404).send({ success: false, error: 'Transaction not found' });
    if (tx.user_id !== user.sub) return reply.code(403).send({ success: false, error: 'Not authorized' });

    try {
      const cp = createCryptoPayment({
        transaction_id: parsed.data.transaction_id,
        user_id: user.sub,
        coin: parsed.data.coin,
        amount_crypto: parsed.data.amount_crypto,
        provider: parsed.data.provider,
      });
      return reply.code(201).send({ success: true, data: cp });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /payment/crypto/mine — user's crypto payments
  app.get('/payment/crypto/mine', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: { payments: listCryptoPaymentsByUser(user.sub) } });
  });

  // GET /payment/crypto/:id — owner or admin
  app.get('/payment/crypto/:id', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const cp = getCryptoPaymentById(id);
    if (!cp) return reply.code(404).send({ success: false, error: 'Crypto payment not found' });
    if (cp.user_id !== user.sub && user.role !== 'admin') {
      return reply.code(403).send({ success: false, error: 'Not authorized' });
    }
    return reply.send({ success: true, data: cp });
  });

  // ============ CRYPTO — ADMIN ============

  // GET /payment/admin/crypto/payments — admin list
  app.get('/payment/admin/crypto/payments', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { limit?: string; offset?: string; status?: string };
    const limit = Math.min(Number(q.limit ?? 100), 500);
    const offset = Number(q.offset ?? 0);
    return reply.send({ success: true, data: { payments: listCryptoPayments(limit, offset, q.status) } });
  });

  // POST /payment/admin/crypto/:id/confirm — admin confirms on-chain tx
  app.post('/payment/admin/crypto/:id/confirm', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const BodySchema = z.object({
      tx_hash: z.string().min(4),
      confirmations: z.number().int().min(0),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const r = confirmCryptoPayment(id, parsed.data.tx_hash, parsed.data.confirmations);
      if (!r) return reply.code(404).send({ success: false, error: 'Crypto payment not found' });
      return reply.send({ success: true, data: r });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /payment/admin/crypto/:id/fail — admin marks failed
  app.post('/payment/admin/crypto/:id/fail', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const { reason } = (req.body ?? {}) as { reason?: string };
    const r = failCryptoPayment(id, reason);
    if (!r) return reply.code(404).send({ success: false, error: 'Crypto payment not found' });
    return reply.send({ success: true, data: r });
  });

  // POST /payment/admin/crypto/expire-sweep — admin triggers expiry sweep
  app.post('/payment/admin/crypto/expire-sweep', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const n = expireCryptoPayments();
    return reply.send({ success: true, data: { expired: n } });
  });

  // GET /payment/admin/crypto/stats — admin
  app.get('/payment/admin/crypto/stats', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: getCryptoStats() });
  });

  // ============ TAX (29.13) ============

  // GET /payment/tax/config — public
  app.get('/payment/tax/config', async (_req, reply) => {
    return reply.send({ success: true, data: getTaxConfig() });
  });

  // PUT /payment/admin/tax/config — admin
  app.put('/payment/admin/tax/config', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }

    const BodySchema = z.object({
      enabled: z.boolean().optional(),
      default_rate_percent: z.number().min(0).max(100).optional(),
      apply_on_fees: z.boolean().optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      return reply.send({ success: true, data: setTaxConfig(parsed.data) });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /payment/tax/rates — public (?country=BD)
  app.get('/payment/tax/rates', async (req, reply) => {
    const q = req.query as { country?: string };
    return reply.send({ success: true, data: { rates: listTaxRates(q.country) } });
  });

  // PUT /payment/admin/tax/rates — admin upsert
  app.put('/payment/admin/tax/rates', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }

    const BodySchema = z.object({
      country: z.string().length(2),
      region: z.string().max(10).optional(),
      tax_type: z.enum(['VAT', 'GST', 'Sales', 'None']).optional(),
      rate_percent: z.number().min(0).max(100),
      inclusive: z.boolean().optional(),
      label: z.string().max(100).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      return reply.send({ success: true, data: upsertTaxRate(parsed.data) });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /payment/admin/tax/rates/:country/:type — admin (?region= optional)
  app.delete('/payment/admin/tax/rates/:country/:type', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { country, type } = req.params as { country: string; type: string };
    const q = req.query as { region?: string };
    const ok = deleteTaxRate(country, q.region ?? '', type as 'VAT' | 'GST' | 'Sales' | 'None');
    if (!ok) return reply.code(404).send({ success: false, error: 'Tax rate not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // POST /payment/tax/calculate — public tax calculator (no transaction)
  app.post('/payment/tax/calculate', async (req, reply) => {
    const BodySchema = z.object({
      amount: z.number().positive(),
      country: z.string().length(2),
      region: z.string().max(10).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const calc = calculateTax(parsed.data.amount, parsed.data.country, parsed.data.region);
      return reply.send({ success: true, data: calc });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /payment/admin/tax/records — admin (?transaction_id= optional)
  app.get('/payment/admin/tax/records', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { transaction_id?: string; limit?: string; offset?: string };
    const limit = Math.min(Number(q.limit ?? 100), 500);
    const offset = Number(q.offset ?? 0);
    return reply.send({ success: true, data: { records: listTaxRecords(q.transaction_id, limit, offset) } });
  });

  // GET /payment/admin/tax/stats — admin
  app.get('/payment/admin/tax/stats', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: getTaxStats() });
  });

  // ============ PCI TOKENIZATION (29.15) ============

  // GET /payment/cards/brands — public (list detectable brands)
  app.get('/payment/cards/brands', async (_req, reply) => {
    return reply.send({ success: true, data: { brands: ['visa','mastercard','amex','discover','jcb','diners','unionpay'] } });
  });

  // POST /payment/cards/validate — public, checks Luhn + returns brand (no storage)
  app.post('/payment/cards/validate', async (req, reply) => {
    const BodySchema = z.object({ pan: z.string().min(12).max(25) });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const pan = parsed.data.pan.replace(/\D/g, '');
    const valid = luhnCheck(pan);
    const brand = detectCardBrand(pan);
    return reply.send({
      success: true,
      data: { valid, brand, last4: pan.slice(-4) },
    });
  });

  // POST /payment/cards/tokenize — user submits PAN (discarded server-side)
  app.post('/payment/cards/tokenize', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const BodySchema = z.object({
      pan: z.string().min(12).max(25),
      exp_month: z.number().int().min(1).max(12),
      exp_year: z.number().int().min(2024).max(2100),
      cardholder_name: z.string().max(200).optional(),
      gateway_id: z.string().optional(),
      set_default: z.boolean().optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const token = createCardToken({
        user_id: user.sub,
        pan: parsed.data.pan,
        exp_month: parsed.data.exp_month,
        exp_year: parsed.data.exp_year,
        cardholder_name: parsed.data.cardholder_name,
        gateway_id: parsed.data.gateway_id,
        set_default: parsed.data.set_default,
        ip: req.ip,
        user_agent: req.headers['user-agent'],
      });
      return reply.code(201).send({ success: true, data: token });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /payment/cards/mine — user's stored tokens (masked)
  app.get('/payment/cards/mine', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: { cards: listCardTokensByUser(user.sub) } });
  });

  // GET /payment/cards/:token — owner or admin
  app.get('/payment/cards/:token', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { token } = req.params as { token: string };
    const card = getCardToken(token);
    if (!card) return reply.code(404).send({ success: false, error: 'Card not found' });
    if (card.user_id !== user.sub && user.role !== 'admin') {
      return reply.code(403).send({ success: false, error: 'Not authorized' });
    }
    return reply.send({ success: true, data: card });
  });

  // DELETE /payment/cards/:token — revoke (owner or admin)
  app.delete('/payment/cards/:token', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { token } = req.params as { token: string };
    const card = getCardToken(token);
    if (!card) return reply.code(404).send({ success: false, error: 'Card not found' });
    if (card.user_id !== user.sub && user.role !== 'admin') {
      return reply.code(403).send({ success: false, error: 'Not authorized' });
    }
    const updated = revokeCardToken(token);
    return reply.send({ success: true, data: updated });
  });

  // POST /payment/cards/:token/default — set default (owner only)
  app.post('/payment/cards/:token/default', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { token } = req.params as { token: string };
    try {
      const updated = setDefaultCardToken(token, user.sub);
      if (!updated) return reply.code(404).send({ success: false, error: 'Card not found' });
      return reply.send({ success: true, data: updated });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /payment/cards/:token/use — record a token use (owner or admin)
  app.post('/payment/cards/:token/use', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { token } = req.params as { token: string };
    const card = getCardToken(token);
    if (!card) return reply.code(404).send({ success: false, error: 'Card not found' });
    if (card.user_id !== user.sub && user.role !== 'admin') {
      return reply.code(403).send({ success: false, error: 'Not authorized' });
    }
    try {
      const updated = markCardTokenUsed(token, req.ip, req.headers['user-agent']);
      return reply.send({ success: true, data: updated });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============ PCI TOKENIZATION — ADMIN ============

  // GET /payment/admin/cards — admin list
  app.get('/payment/admin/cards', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { limit?: string; offset?: string; status?: string };
    const limit = Math.min(Number(q.limit ?? 100), 500);
    const offset = Number(q.offset ?? 0);
    return reply.send({ success: true, data: { cards: listAllCardTokens(limit, offset, q.status) } });
  });

  // GET /payment/admin/cards/stats — admin
  app.get('/payment/admin/cards/stats', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: getTokenizationStats() });
  });

  // GET /payment/admin/cards/log — admin (tokenization audit log)
  app.get('/payment/admin/cards/log', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { token_id?: string; limit?: string };
    const limit = Math.min(Number(q.limit ?? 100), 500);
    return reply.send({ success: true, data: { entries: listTokenizationLog(q.token_id, limit) } });
  });

  // ============ CHARGEBACKS (29.16) ============

  // GET /payment/chargebacks/reason-codes — public (client form)
  app.get('/payment/chargebacks/reason-codes', async (_req, reply) => {
    return reply.send({ success: true, data: { codes: CHARGEBACK_REASON_CODES } });
  });

  // GET /payment/chargebacks/mine — user's chargebacks
  app.get('/payment/chargebacks/mine', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: { chargebacks: listChargebacksByUser(user.sub) } });
  });

  // GET /payment/chargebacks/:id — owner or admin
  app.get('/payment/chargebacks/:id', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const cb = getChargebackById(id);
    if (!cb) return reply.code(404).send({ success: false, error: 'Chargeback not found' });
    if (cb.user_id !== user.sub && user.role !== 'admin') {
      return reply.code(403).send({ success: false, error: 'Not authorized' });
    }
    return reply.send({ success: true, data: cb });
  });

  // ============ CHARGEBACKS — ADMIN ============

  // GET /payment/admin/chargebacks — list (?status=)
  app.get('/payment/admin/chargebacks', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { limit?: string; offset?: string; status?: string };
    const limit = Math.min(Number(q.limit ?? 100), 500);
    const offset = Number(q.offset ?? 0);
    return reply.send({ success: true, data: { chargebacks: listChargebacks(limit, offset, q.status) } });
  });

  // POST /payment/admin/chargebacks — admin creates (or gateway webhook simulates)
  app.post('/payment/admin/chargebacks', async (req, reply) => {
    let admin;
    try { admin = requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }

    const BodySchema = z.object({
      transaction_id: z.string().min(1),
      reason_code: z.enum(CHARGEBACK_REASON_CODES),
      reason_text: z.string().max(500).optional(),
      due_days: z.number().int().min(1).max(120).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const cb = createChargeback({ ...parsed.data, actor: admin.sub });
      return reply.code(201).send({ success: true, data: cb });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /payment/admin/chargebacks/stats — stats
  app.get('/payment/admin/chargebacks/stats', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: getChargebackStats() });
  });

  // GET /payment/admin/chargebacks/by-transaction/:txId — lookup by tx
  app.get('/payment/admin/chargebacks/by-transaction/:txId', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { txId } = req.params as { txId: string };
    return reply.send({ success: true, data: { chargebacks: listChargebacksByTransaction(txId) } });
  });

  // GET /payment/admin/chargebacks/:id/events — admin, event trail
  app.get('/payment/admin/chargebacks/:id/events', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: { events: listChargebackEvents(id) } });
  });

  // POST /payment/admin/chargebacks/:id/evidence — admin adds evidence
  app.post('/payment/admin/chargebacks/:id/evidence', async (req, reply) => {
    let admin;
    try { admin = requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const BodySchema = z.object({
      label: z.string().min(1).max(100),
      value: z.string().min(1).max(2000),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const cb = addChargebackEvidence(id, parsed.data, admin.sub);
      if (!cb) return reply.code(404).send({ success: false, error: 'Chargeback not found' });
      return reply.send({ success: true, data: cb });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /payment/admin/chargebacks/:id/respond — mark under_review
  app.post('/payment/admin/chargebacks/:id/respond', async (req, reply) => {
    let admin;
    try { admin = requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const { notes } = (req.body ?? {}) as { notes?: string };
    try {
      const cb = respondToChargeback(id, admin.sub, notes);
      if (!cb) return reply.code(404).send({ success: false, error: 'Chargeback not found' });
      return reply.send({ success: true, data: cb });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /payment/admin/chargebacks/:id/resolve — final decision
  app.post('/payment/admin/chargebacks/:id/resolve', async (req, reply) => {
    let admin;
    try { admin = requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const BodySchema = z.object({
      outcome: z.enum(['merchant_won', 'merchant_lost', 'accepted']),
      notes: z.string().max(500).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const cb = resolveChargeback(id, parsed.data.outcome, admin.sub, parsed.data.notes);
      if (!cb) return reply.code(404).send({ success: false, error: 'Chargeback not found' });
      return reply.send({ success: true, data: cb });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============ RISK SCORING (29.17) ============

  // GET /payment/risk/config — public (client may show level thresholds)
  app.get('/payment/risk/config', async (_req, reply) => {
    return reply.send({ success: true, data: getRiskConfig() });
  });

  // PUT /payment/admin/risk/config — admin
  app.put('/payment/admin/risk/config', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }

    const BodySchema = z.object({
      enabled: z.boolean().optional(),
      low_max: z.number().int().min(0).max(1000).optional(),
      medium_max: z.number().int().min(0).max(1000).optional(),
      block_threshold: z.number().int().min(0).max(1000).optional(),
      auto_block: z.boolean().optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      return reply.send({ success: true, data: setRiskConfig(parsed.data) });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /payment/risk/rules — public summary (code + name only)
  app.get('/payment/risk/rules', async (_req, reply) => {
    const rules = listRiskRules().filter((r) => r.enabled).map((r) => ({
      code: r.code, name: r.name, description: r.description,
    }));
    return reply.send({ success: true, data: { rules } });
  });

  // GET /payment/admin/risk/rules — admin (full, with weights)
  app.get('/payment/admin/risk/rules', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: { rules: listRiskRules() } });
  });

  // PUT /payment/admin/risk/rules — admin upsert
  app.put('/payment/admin/risk/rules', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }

    const BodySchema = z.object({
      code: z.string().min(2).max(60),
      name: z.string().min(1).max(100),
      description: z.string().max(500).optional(),
      weight: z.number().int().min(0).max(500),
      enabled: z.boolean().optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      return reply.send({ success: true, data: upsertRiskRule(parsed.data) });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /payment/admin/risk/rules/:code — admin
  app.delete('/payment/admin/risk/rules/:code', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { code } = req.params as { code: string };
    const ok = deleteRiskRule(code);
    if (!ok) return reply.code(404).send({ success: false, error: 'Rule not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // POST /payment/risk/score — public preview (no persistence)
  app.post('/payment/risk/score', async (req, reply) => {
    const BodySchema = z.object({
      amount: z.number().positive(),
      currency: z.string().max(10),
      origin_country: z.string().length(2).optional(),
      is_crypto: z.boolean().optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    let userSub = 'anonymous';
    try {
      const u = requireAuth(req.headers.authorization);
      userSub = u.sub;
    } catch { /* anonymous allowed */ }

    try {
      const evalResult = computeRiskScore({
        user_id: userSub,
        amount: parsed.data.amount,
        currency: parsed.data.currency,
        origin_country: parsed.data.origin_country,
        home_country: getCrossBorderConfig().home_country,
        is_crypto: parsed.data.is_crypto,
      });
      return reply.send({ success: true, data: evalResult });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============ RISK — ADMIN ============

  // GET /payment/admin/risk/assessments — list (?level=&decision=)
  app.get('/payment/admin/risk/assessments', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { limit?: string; offset?: string; level?: string; decision?: string };
    const limit = Math.min(Number(q.limit ?? 100), 500);
    const offset = Number(q.offset ?? 0);
    return reply.send({
      success: true,
      data: { assessments: listRiskAssessments(limit, offset, { level: q.level, decision: q.decision }) },
    });
  });

  // GET /payment/admin/risk/assessments/by-tx/:txId — lookup by tx
  app.get('/payment/admin/risk/assessments/by-tx/:txId', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { txId } = req.params as { txId: string };
    return reply.send({ success: true, data: { assessments: listRiskAssessmentsByTransaction(txId) } });
  });

  // GET /payment/admin/risk/assessments/:id — single
  app.get('/payment/admin/risk/assessments/:id', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const a = getRiskAssessmentById(id);
    if (!a) return reply.code(404).send({ success: false, error: 'Assessment not found' });
    return reply.send({ success: true, data: a });
  });

  // GET /payment/admin/risk/stats — stats
  app.get('/payment/admin/risk/stats', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: getRiskStats() });
  });
}
