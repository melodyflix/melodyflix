// melodyflix live - super chat routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole, verifyJwt, extractBearerToken } from '@melodyflix/shared-auth';
import {
  createSuperChat, listSuperChats, listActivePinned,
  getSuperChatStats, getStreamSuperChatStats,
  MIN_SUPER_CHAT_AMOUNT, PRESET_AMOUNTS, amountToStyle,
} from '../services/superchat.service.js';
import { getStreamById } from '../services/live.service.js';
import { broadcastToViewers } from '../services/ws.service.js';

const VIDEOS_URL = process.env.VIDEOS_SERVICE_URL ?? 'http://127.0.0.1:4003';

const CreateSuperChatSchema = z.object({
  content: z.string().min(1).max(200),
  amount: z.number().min(MIN_SUPER_CHAT_AMOUNT).max(1000000),
  currency: z.string().max(10).optional(),
  transaction_id: z.string().min(1),
});

async function verifyTransaction(token: string, transactionId: string): Promise<boolean> {
  try {
    const res = await fetch(`${VIDEOS_URL}/api/v1/videos/payment/my-transactions`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const data = await res.json();
    const tx = (data.data?.transactions ?? []).find((t: any) => t.id === transactionId);
    return !!(tx && tx.status === 'completed' && tx.purpose === 'super_chat');
  } catch {
    return false;
  }
}

function optionalUser(auth?: string) {
  const token = extractBearerToken(auth);
  if (!token) return null;
  return verifyJwt(token);
}

export async function superChatRoutes(app: FastifyInstance) {
  // GET /api/v1/live/superchat-config — public pricing info
  app.get('/superchat-config', async (req, reply) => {
    return reply.send({
      success: true,
      data: {
        min_amount: MIN_SUPER_CHAT_AMOUNT,
        presets: PRESET_AMOUNTS.map((amt) => ({ amount: amt, ...amountToStyle(amt) })),
      },
    });
  });

  // GET /api/v1/live/:streamId/superchats — recent super chats
  app.get('/:streamId/superchats', async (req, reply) => {
    const { streamId } = req.params as { streamId: string };
    const q = req.query as { limit?: string };
    const limit = Math.min(Number(q.limit ?? 50), 100);
    const superChats = listSuperChats(streamId, limit);
    const pinned = listActivePinned(streamId);
    return reply.send({ success: true, data: { superchats: superChats, pinned } });
  });

  // GET /api/v1/live/:streamId/superchats/stats — public stream stats
  app.get('/:streamId/superchats/stats', async (req, reply) => {
    const { streamId } = req.params as { streamId: string };
    const stats = getStreamSuperChatStats(streamId);
    return reply.send({ success: true, data: stats });
  });

  // POST /api/v1/live/:streamId/superchats — send a super chat
  app.post('/:streamId/superchats', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = CreateSuperChatSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    }

    const { streamId } = req.params as { streamId: string };
    const stream = getStreamById(streamId);
    if (!stream) return reply.code(404).send({ success: false, error: 'Stream not found' });

    // Verify transaction with videos service
    const token = extractBearerToken(req.headers.authorization)!;
    const ok = await verifyTransaction(token, parsed.data.transaction_id);
    if (!ok) {
      return reply.code(402).send({
        success: false,
        error: 'Payment verification failed. Please complete payment first.',
      });
    }

    try {
      const username = (user as any).username ?? user.sub.slice(0, 8);
      const sc = createSuperChat({
        stream_id: streamId,
        user_id: user.sub,
        username,
        content: parsed.data.content,
        amount: parsed.data.amount,
        currency: parsed.data.currency,
        transaction_id: parsed.data.transaction_id,
      });

      // Broadcast to all viewers of this stream via WS
      broadcastToViewers(streamId, {
        type: 'superchat',
        superchat: {
          id: sc.id,
          username: sc.username,
          content: sc.content,
          amount: sc.amount,
          currency: sc.currency,
          color: sc.color,
          pinned_until: sc.pinned_until,
          created_at: sc.created_at,
        },
      });

      return reply.code(201).send({ success: true, data: sc });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============ ADMIN ============

  // GET /api/v1/live/admin/superchat-stats
  app.get('/admin/superchat-stats', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: getSuperChatStats() });
  });

  // GET /api/v1/live/admin/superchats — recent all
  app.get('/admin/superchats', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { getDb } = await import('@melodyflix/shared-db');
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM super_chats ORDER BY created_at DESC LIMIT 100'
    ).all();
    return reply.send({ success: true, data: { superchats: rows } });
  });
}
