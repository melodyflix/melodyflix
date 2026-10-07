// melodyflix notifications - HTTP routes
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  listNotifications, countUnread, markAsRead, markAllAsRead,
  deleteNotification, deleteAllForUser,
  listRetryRules, getRetryRule, upsertRetryRule, deleteRetryRule, computeBackoffSeconds,
  startDeliveryTracking, markDeliveryResult, recordRetryAttempt,
  listDeliveryAttempts, listUserDeliveryAttempts, listPendingRetries,
  getDeliveryStats,
} from '../services/notification.service.js';
import { z } from 'zod';

const UpsertRetryRuleSchema = z.object({
  notification_type: z.string().min(1).max(80),
  channel: z.enum(['in_app','email','push','sms']),
  max_attempts: z.number().int().min(1).max(20).optional(),
  initial_backoff_seconds: z.number().int().min(1).max(86400).optional(),
  backoff_multiplier: z.number().min(1).max(10).optional(),
  max_backoff_seconds: z.number().int().min(1).max(604800).optional(),
  enabled: z.boolean().optional(),
});

const StartTrackingSchema = z.object({
  notification_id: z.string().min(1).max(100),
  user_id: z.string().min(1).max(100),
  notification_type: z.string().max(80).optional(),
  channel: z.enum(['in_app','email','push','sms']).optional(),
});

const MarkResultSchema = z.object({
  status: z.enum(['sent','failed']),
  error: z.string().max(2000).nullable().optional(),
  notification_type: z.string().max(80).optional(),
});

function adminOnly(authorization: string | undefined): { ok: boolean; error?: string } {
  try {
    const payload = requireAuth(authorization);
    if (payload.role !== 'admin' && payload.role !== 'superadmin') {
      return { ok: false, error: 'admin_required' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function notificationRoutes(app: FastifyInstance) {
  // GET /api/v1/notifications — list mine
  app.get('/', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(Number(q.limit ?? 50), 200);
    const offset = Number(q.offset ?? 0);
    const notifications = listNotifications(user.sub, limit, offset);
    return reply.send({
      success: true,
      data: {
        notifications,
        unread: countUnread(user.sub),
      },
    });
  });

  // GET /api/v1/notifications/unread-count
  app.get('/unread-count', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    return reply.send({ success: true, data: { count: countUnread(user.sub) } });
  });

  // POST /api/v1/notifications/:id/read
  app.post('/:id/read', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const { id } = req.params as { id: string };
    const ok = markAsRead(id, user.sub);
    if (!ok) return reply.code(404).send({ success: false, error: 'Notification not found' });
    return reply.send({ success: true, data: { read: true } });
  });

  // POST /api/v1/notifications/read-all
  app.post('/read-all', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const count = markAllAsRead(user.sub);
    return reply.send({ success: true, data: { marked: count } });
  });

  // DELETE /api/v1/notifications/:id
  app.delete('/:id', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const { id } = req.params as { id: string };
    const ok = deleteNotification(id, user.sub);
    if (!ok) return reply.code(404).send({ success: false, error: 'Notification not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // DELETE /api/v1/notifications — clear all
  app.delete('/', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const count = deleteAllForUser(user.sub);
    return reply.send({ success: true, data: { deleted: count } });
  });

  // ============ 90.2 RETRY RULES ============

  // GET /api/v1/notifications/admin/retry-rules
  app.get('/admin/retry-rules', async (req, reply) => {
    const a = adminOnly(req.headers.authorization);
    if (!a.ok) return reply.code(403).send({ success: false, error: a.error });
    return reply.send({ success: true, data: { rules: listRetryRules() } });
  });

  // POST /api/v1/notifications/admin/retry-rules  (upsert)
  app.post('/admin/retry-rules', async (req, reply) => {
    const a = adminOnly(req.headers.authorization);
    if (!a.ok) return reply.code(403).send({ success: false, error: a.error });
    const parsed = UpsertRetryRuleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    const rule = upsertRetryRule(parsed.data);
    return reply.code(201).send({ success: true, data: { rule } });
  });

  // GET /api/v1/notifications/admin/retry-rules/:type/:channel
  app.get('/admin/retry-rules/:type/:channel', async (req, reply) => {
    const a = adminOnly(req.headers.authorization);
    if (!a.ok) return reply.code(403).send({ success: false, error: a.error });
    const { type, channel } = req.params as { type: string; channel: string };
    const rule = getRetryRule(type, channel);
    if (!rule) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.send({ success: true, data: { rule } });
  });

  // DELETE /api/v1/notifications/admin/retry-rules/:id
  app.delete('/admin/retry-rules/:id', async (req, reply) => {
    const a = adminOnly(req.headers.authorization);
    if (!a.ok) return reply.code(403).send({ success: false, error: a.error });
    const { id } = req.params as { id: string };
    const ok = deleteRetryRule(id);
    return ok ? reply.send({ success: true, data: { removed: true } }) : reply.code(404).send({ success: false, error: 'Not found' });
  });

  // GET /api/v1/notifications/admin/retry-rules/preview?attempt=2&type=X&channel=email
  app.get('/admin/retry-rules-preview', async (req, reply) => {
    const a = adminOnly(req.headers.authorization);
    if (!a.ok) return reply.code(403).send({ success: false, error: a.error });
    const q = req.query as { attempt?: string; type?: string; channel?: string };
    const attempt = Math.max(1, Math.min(Number(q.attempt ?? 1), 20));
    const rule = getRetryRule(q.type ?? '*', q.channel ?? 'email');
    if (!rule) return reply.code(404).send({ success: false, error: 'rule_not_found' });
    return reply.send({ success: true, data: { rule, attempt, backoff_seconds: computeBackoffSeconds(attempt, rule) } });
  });

  // ============ 90.3 DELIVERY TRACKING ============

  // POST /api/v1/notifications/delivery/start
  app.post('/delivery/start', async (req, reply) => {
    const a = adminOnly(req.headers.authorization);
    if (!a.ok) return reply.code(403).send({ success: false, error: a.error });
    const parsed = StartTrackingSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    const attempt = startDeliveryTracking(parsed.data);
    return reply.code(201).send({ success: true, data: { attempt } });
  });

  // POST /api/v1/notifications/delivery/:attemptId/result
  app.post('/delivery/:attemptId/result', async (req, reply) => {
    const a = adminOnly(req.headers.authorization);
    if (!a.ok) return reply.code(403).send({ success: false, error: a.error });
    const { attemptId } = req.params as { attemptId: string };
    const parsed = MarkResultSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    const r = markDeliveryResult(attemptId, parsed.data);
    if (!r) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.send({ success: true, data: r });
  });

  // POST /api/v1/notifications/delivery/:attemptId/retry
  app.post('/delivery/:attemptId/retry', async (req, reply) => {
    const a = adminOnly(req.headers.authorization);
    if (!a.ok) return reply.code(403).send({ success: false, error: a.error });
    const { attemptId } = req.params as { attemptId: string };
    const next = recordRetryAttempt(attemptId);
    if (!next) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.code(201).send({ success: true, data: { attempt: next } });
  });

  // GET /api/v1/notifications/delivery/notification/:notificationId
  app.get('/delivery/notification/:notificationId', async (req, reply) => {
    const a = adminOnly(req.headers.authorization);
    if (!a.ok) return reply.code(403).send({ success: false, error: a.error });
    const { notificationId } = req.params as { notificationId: string };
    const attempts = listDeliveryAttempts(notificationId);
    return reply.send({ success: true, data: { attempts, total: attempts.length } });
  });

  // GET /api/v1/notifications/delivery/me  (user's own attempts)
  app.get('/delivery/me', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { limit?: string };
    const limit = Math.min(Math.max(Number(q.limit ?? 100), 1), 500);
    const attempts = listUserDeliveryAttempts(user.sub, limit);
    return reply.send({ success: true, data: { attempts, total: attempts.length } });
  });

  // GET /api/v1/notifications/delivery/pending-retries
  app.get('/delivery/pending-retries', async (req, reply) => {
    const a = adminOnly(req.headers.authorization);
    if (!a.ok) return reply.code(403).send({ success: false, error: a.error });
    const q = req.query as { limit?: string };
    const limit = Math.min(Math.max(Number(q.limit ?? 200), 1), 1000);
    const pending = listPendingRetries(limit);
    return reply.send({ success: true, data: { pending, total: pending.length } });
  });

  // GET /api/v1/notifications/delivery/stats
  app.get('/delivery/stats', async (req, reply) => {
    const a = adminOnly(req.headers.authorization);
    if (!a.ok) return reply.code(403).send({ success: false, error: a.error });
    const q = req.query as { window_days?: string };
    const days = Math.min(Math.max(Number(q.window_days ?? 30), 1), 365);
    return reply.send({ success: true, data: getDeliveryStats(days) });
  });
}
