// melodyflix notifications - HTTP routes
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  listNotifications, countUnread, markAsRead, markAllAsRead,
  deleteNotification, deleteAllForUser,
} from '../services/notification.service.js';

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
}
