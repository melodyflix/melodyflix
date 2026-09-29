// melodyflix videos - chat limits routes
import type { FastifyInstance } from 'fastify';
import { requireAuth, requireRole } from '@melodyflix/shared-auth';
import {
  getChatUsage, grantMessagePack, getChatLimitsStats,
  resetUserFreeCredits, CHAT_LIMIT_CONSTANTS,
} from '../services/chatlimits.service.js';

export async function chatLimitsRoutes(app: FastifyInstance) {
  // GET /api/v1/videos/chat-limits/me — my current usage
  app.get('/chat-limits/me', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const usage = getChatUsage(user.sub);
    return reply.send({ success: true, data: usage });
  });

  // GET /api/v1/videos/chat-limits/constants — public info for pricing page
  app.get('/chat-limits/constants', async (req, reply) => {
    return reply.send({ success: true, data: CHAT_LIMIT_CONSTANTS });
  });

  // POST /api/v1/videos/chat-limits/consume — check before sending message (internal use)
  // Called by live chat WS internally OR frontend to preview
  app.post('/chat-limits/consume', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { consumeMessageCredit } = await import('../services/chatlimits.service.js');
    try {
      const type = consumeMessageCredit(user.sub);
      const usage = getChatUsage(user.sub);
      return reply.send({ success: true, data: { consumed: type, usage } });
    } catch (err) {
      if ((err as Error).message === 'MESSAGE_LIMIT_REACHED') {
        return reply.code(402).send({
          success: false,
          error: 'MESSAGE_LIMIT_REACHED',
          data: { usage: getChatUsage(user.sub) },
        });
      }
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============ ADMIN ============

  // GET /api/v1/videos/admin/chat-limits/stats
  app.get('/chat-limits/stats', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: getChatLimitsStats() });
  });

  // POST /api/v1/videos/admin/chat-limits/:userId/grant — grant pack manually
  app.post('/chat-limits/:userId/grant', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { userId } = req.params as { userId: string };
    const { size, amount } = (req.body ?? {}) as { size?: number; amount?: number };
    try {
      grantMessagePack(userId, null, size ?? CHAT_LIMIT_CONSTANTS.MESSAGE_PACK_SIZE, amount ?? 0);
      return reply.send({ success: true, data: getChatUsage(userId) });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /api/v1/videos/admin/chat-limits/:userId/reset-free
  app.post('/chat-limits/:userId/reset-free', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { userId } = req.params as { userId: string };
    try {
      resetUserFreeCredits(userId);
      return reply.send({ success: true, data: getChatUsage(userId) });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });
}
