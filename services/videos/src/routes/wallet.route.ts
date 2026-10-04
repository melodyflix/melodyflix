// melodyflix videos — Wallet & Credits routes (Section 83)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  getOrCreateWallet, getWallet, freezeWallet,
  topUpWallet, spendFromWallet, refundToWallet, transferBetweenWallets,
  listTransactions, getWalletSummary,
  grantPromoCredit, listPromoCredits, consumePromoCredits,
  createGiftCard, redeemGiftCard, cancelGiftCard,
  listIssuedGiftCards, listRedeemedGiftCards, getGiftCardById,
} from '../services/wallet.service.js';

const TopUpSchema = z.object({
  amount_cents: z.number().int().positive().max(100_000_000),
  reference_id: z.string().max(200).nullable().optional(),
  description: z.string().max(200).optional(),
});

const SpendSchema = z.object({
  amount_cents: z.number().int().positive().max(100_000_000),
  reference_id: z.string().max(200).nullable().optional(),
  description: z.string().max(200).optional(),
});

const TransferSchema = z.object({
  to_user_id: z.string().uuid(),
  amount_cents: z.number().int().positive().max(500_000_00),
  note: z.string().max(200).optional(),
});

const GrantPromoSchema = z.object({
  user_id: z.string().uuid(),
  amount_cents: z.number().int().positive().max(10_000_000),
  reason: z.string().min(1).max(200),
  source: z.string().max(100).nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
});

const ConsumePromoSchema = z.object({
  amount_cents: z.number().int().positive(),
  reference: z.string().max(200).nullable().optional(),
});

const CreateGiftCardSchema = z.object({
  initial_amount_cents: z.number().int().positive().max(10_000_000),
  expires_at: z.string().datetime().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

const RedeemGiftCardSchema = z.object({
  code: z.string().min(4).max(64),
});

function isAdmin(authorization: string | undefined): { ok: boolean; userId?: string } {
  try {
    const payload = requireAuth(authorization);
    return { ok: payload.role === 'admin', userId: payload.sub as string };
  } catch {
    return { ok: false };
  }
}

export async function walletRoutes(app: FastifyInstance) {
  // ============================================================
  // 83.1 — Wallet core
  // ============================================================

  // GET /wallet — my wallet
  app.get('/wallet', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const wallet = getOrCreateWallet(userId);
    return reply.send({ success: true, data: wallet });
  });

  // GET /wallet/summary — dashboard summary
  app.get('/wallet/summary', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: getWalletSummary(userId) });
  });

  // GET /wallet/:userId — lookup another user's wallet (basic info)
  app.get('/wallet/:userId', async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const wallet = getWallet(userId);
    if (!wallet) return reply.code(404).send({ success: false, error: 'Wallet not found' });
    // Return safe projection (no lifetime stats for other users)
    return reply.send({
      success: true,
      data: { user_id: wallet.user_id, currency: wallet.currency, is_frozen: wallet.is_frozen },
    });
  });

  // POST /wallet/topup
  app.post('/wallet/topup', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = TopUpSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const tx = topUpWallet(userId, parsed.data.amount_cents, {
        reference_id: parsed.data.reference_id ?? null,
        description: parsed.data.description,
      });
      return reply.code(201).send({ success: true, data: tx });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /wallet/spend
  app.post('/wallet/spend', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = SpendSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const tx = spendFromWallet(userId, parsed.data.amount_cents, {
        reference_id: parsed.data.reference_id ?? null,
        description: parsed.data.description,
      });
      return reply.code(201).send({ success: true, data: tx });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /wallet/transfer
  app.post('/wallet/transfer', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = TransferSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const result = transferBetweenWallets(userId, parsed.data.to_user_id, parsed.data.amount_cents, parsed.data.note);
      return reply.code(201).send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /wallet/freeze  (admin-only)
  app.post('/wallet/freeze', async (req, reply) => {
    const auth = isAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ success: false, error: 'Admin only' });
    const body = req.body as { user_id?: string; frozen?: boolean };
    if (!body.user_id || typeof body.frozen !== 'boolean') {
      return reply.code(400).send({ success: false, error: 'user_id and frozen required' });
    }
    try {
      const wallet = freezeWallet(body.user_id, body.frozen);
      return reply.send({ success: true, data: wallet });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // 83.4 — Transaction History
  // ============================================================

  // GET /wallet/transactions?kind=&limit=&offset=&from=&to=
  app.get('/wallet/transactions', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const q = req.query as any;
    const kinds = ['topup', 'spend', 'refund', 'promo_credit', 'gift_card_redeem',
      'payout', 'transfer_in', 'transfer_out', 'adjustment'];
    const kind = kinds.includes(q.kind) ? q.kind : undefined;
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    const offset = q.offset ? Math.max(parseInt(q.offset) || 0, 0) : 0;
    const result = listTransactions(userId, { kind, limit, offset, from: q.from, to: q.to });
    return reply.send({ success: true, data: result });
  });

  // ============================================================
  // 83.3 — Promotional Credits
  // ============================================================

  // GET /wallet/promo-credits?active_only=true
  app.get('/wallet/promo-credits', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { active_only?: string; limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    const credits = listPromoCredits(userId, { active_only: q.active_only === 'true', limit });
    return reply.send({ success: true, data: { credits } });
  });

  // POST /wallet/promo-credits/grant  (admin-only)
  app.post('/wallet/promo-credits/grant', async (req, reply) => {
    const auth = isAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ success: false, error: 'Admin only' });
    const parsed = GrantPromoSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const credit = grantPromoCredit({ ...parsed.data, created_by: auth.userId ?? null });
      return reply.code(201).send({ success: true, data: credit });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /wallet/promo-credits/consume
  app.post('/wallet/promo-credits/consume', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = ConsumePromoSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const result = consumePromoCredits(userId, parsed.data.amount_cents, parsed.data.reference ?? undefined);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // 83.2 — Gift Cards
  // ============================================================

  // POST /wallet/gift-cards — admin creates a gift card
  app.post('/wallet/gift-cards', async (req, reply) => {
    const auth = isAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ success: false, error: 'Admin only' });
    const parsed = CreateGiftCardSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const result = createGiftCard({ ...parsed.data, issued_by: auth.userId ?? null });
      return reply.code(201).send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /wallet/gift-cards/issued — list gift cards I issued (admin)
  app.get('/wallet/gift-cards/issued', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 100, 1), 500) : 100;
    const cards = listIssuedGiftCards(userId, limit);
    return reply.send({ success: true, data: { gift_cards: cards } });
  });

  // GET /wallet/gift-cards/redeemed — list gift cards I redeemed
  app.get('/wallet/gift-cards/redeemed', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 100, 1), 500) : 100;
    const cards = listRedeemedGiftCards(userId, limit);
    return reply.send({ success: true, data: { gift_cards: cards } });
  });

  // GET /wallet/gift-cards/:id — admin/issuer views a gift card
  app.get('/wallet/gift-cards/:id', async (req, reply) => {
    const auth = isAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { id } = req.params as { id: string };
    const card = getGiftCardById(id);
    if (!card) return reply.code(404).send({ success: false, error: 'Gift card not found' });
    return reply.send({ success: true, data: card });
  });

  // POST /wallet/gift-cards/redeem
  app.post('/wallet/gift-cards/redeem', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = RedeemGiftCardSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const result = redeemGiftCard(parsed.data.code, userId);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /wallet/gift-cards/:id/cancel — admin/issuer cancels
  app.post('/wallet/gift-cards/:id/cancel', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const ok = cancelGiftCard(id, userId);
    if (!ok) return reply.code(404).send({ success: false, error: 'Not found or not cancellable' });
    return reply.send({ success: true, data: { cancelled: true } });
  });
}
