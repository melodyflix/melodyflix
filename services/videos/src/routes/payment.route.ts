// melodyflix videos - payment routes (admin + public)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '@melodyflix/shared-auth';
import {
  createGateway, listGateways, getGatewayById, updateGateway, deleteGateway,
  createTransaction, listTransactions, getPaymentStats, getDefaultGateway,
  updateTransactionStatus, getTransactionById,
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

    return reply.send({
      success: true,
      data: {
        transaction_id: tx.id,
        amount: tx.amount,
        currency: tx.currency,
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
}
