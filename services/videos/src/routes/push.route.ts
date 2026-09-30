// melodyflix videos - push notification routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '@melodyflix/shared-auth';
import {
  getPublicKey, saveSubscription, unsubscribeEndpoint,
  listUserSubscriptions, sendPushToUser, sendPushToUsers,
  getPushStats,
} from '../services/push.service.js';

const SubscribeSchema = z.object({
  endpoint: z.string().min(10).max(2000),
  p256dh: z.string().min(10).max(500),
  auth: z.string().min(5).max(200),
  user_agent: z.string().max(500).optional(),
});

const UnsubscribeSchema = z.object({
  endpoint: z.string().min(10).max(2000),
});

const SendSchema = z.object({
  user_id: z.string().optional(),
  user_ids: z.array(z.string()).optional(),
  title: z.string().min(1).max(120),
  body: z.string().max(300).optional(),
  url: z.string().max(500).optional(),
  tag: z.string().max(50).optional(),
});

export async function pushRoutes(app: FastifyInstance) {
  // GET /api/v1/videos/push/public-key — client fetches this to subscribe
  app.get('/push/public-key', async (req, reply) => {
    return reply.send({ success: true, data: { publicKey: getPublicKey() } });
  });

  // POST /api/v1/videos/push/subscribe
  app.post('/push/subscribe', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = SubscribeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const sub = saveSubscription({ user_id: user.sub, ...parsed.data });
      return reply.code(201).send({ success: true, data: sub });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /api/v1/videos/push/unsubscribe
  app.post('/push/unsubscribe', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = UnsubscribeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const ok = unsubscribeEndpoint(user.sub, parsed.data.endpoint);
    return reply.send({ success: true, data: { unsubscribed: ok } });
  });

  // GET /api/v1/videos/push/my-subscriptions
  app.get('/push/my-subscriptions', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const subs = listUserSubscriptions(user.sub);
    return reply.send({ success: true, data: { subscriptions: subs } });
  });

  // POST /api/v1/videos/push/test — send test push to self
  app.post('/push/test', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const result = await sendPushToUser(user.sub, {
      title: '👋 Test notification',
      body: 'Push notifications are working!',
      url: '/',
      tag: 'test',
    });
    return reply.send({ success: true, data: result });
  });

  // ============ ADMIN ============

  // GET /api/v1/videos/admin/push/stats
  app.get('/push/stats', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: getPushStats() });
  });

  // POST /api/v1/videos/admin/push/send — broadcast to users
  app.post('/push/send', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }

    const parsed = SendSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const payload = {
      title: parsed.data.title,
      body: parsed.data.body,
      url: parsed.data.url,
      tag: parsed.data.tag,
    };

    let result;
    if (parsed.data.user_id) {
      result = await sendPushToUser(parsed.data.user_id, payload);
    } else if (parsed.data.user_ids && parsed.data.user_ids.length > 0) {
      result = await sendPushToUsers(parsed.data.user_ids, payload);
    } else {
      // Broadcast to all users with subscriptions
      const { getDb } = await import('@melodyflix/shared-db');
      const db = getDb();
      const rows = db.prepare('SELECT DISTINCT user_id FROM push_subscriptions WHERE active = 1').all() as { user_id: string }[];
      result = await sendPushToUsers(rows.map((r) => r.user_id), payload);
    }

    return reply.send({ success: true, data: result });
  });
}
