// melodyflix videos - Section 11.22 Breach Notification routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  createBreachIncident, getBreachIncident, listBreachIncidents, updateBreachIncident,
  addAffectedUsers, listAffectedUsers, listUserBreachNotifications,
  notifyRegulator, notifyAffectedUsers, closeBreach,
  listNotifications, listUpcomingDeadlines, getBreachStats,
} from './breach-notification.service.js';

const RISKS = ['low','medium','high','critical'] as const;
const STATUSES = ['draft','investigating','regulator_notified','users_notified','closed'] as const;
const CHANNELS = ['email','in_app','sms','push'] as const;

const CreateSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(4000).nullable().optional(),
  risk_level: z.enum(RISKS).optional(),
  detected_by: z.string().max(100).nullable().optional(),
  discovered_at: z.string().datetime().optional(),
  data_categories: z.array(z.string().max(80)).max(50).optional(),
  root_cause: z.string().max(2000).nullable().optional(),
});

const UpdateSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.string().max(4000).nullable().optional(),
  risk_level: z.enum(RISKS).optional(),
  status: z.enum(STATUSES).optional(),
  data_categories: z.array(z.string().max(80)).max(50).optional(),
  root_cause: z.string().max(2000).nullable().optional(),
  detected_by: z.string().max(100).nullable().optional(),
});

const AddUsersSchema = z.object({
  users: z.array(z.object({
    user_id: z.string().min(1).max(100),
    email: z.string().email().max(320).nullable().optional(),
  })).min(1).max(10000),
});

const NotifyRegulatorSchema = z.object({
  authority: z.string().min(2).max(200),
  body: z.string().max(8000).nullable().optional(),
  channel: z.enum(CHANNELS).optional(),
});

const NotifyUsersSchema = z.object({
  channel: z.enum(CHANNELS).optional(),
  subject: z.string().max(300).nullable().optional(),
  body: z.string().max(8000).nullable().optional(),
});

const ListQuerySchema = z.object({
  status: z.enum(STATUSES).optional(),
  risk_level: z.enum(RISKS).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

function getAuth(authorization: string | undefined): { ok: boolean; userId?: string; role?: string; error?: string } {
  try {
    const payload = requireAuth(authorization);
    return { ok: true, userId: payload.sub as string, role: payload.role as string };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function requireAdmin(authorization: string | undefined): { ok: boolean; userId?: string; error?: string } {
  const auth = getAuth(authorization);
  if (!auth.ok) return auth;
  if (auth.role !== 'admin') return { ok: false, error: 'Admin only' };
  return auth;
}

export async function breachNotificationRoutes(app: FastifyInstance): Promise<void> {
  // -------- Breach incidents (admin) --------
  app.post('/security/breach/incidents', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const parse = CreateSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: 'invalid_input', details: parse.error.flatten() });
    const inc = createBreachIncident(parse.data, auth.userId ?? null);
    return reply.code(201).send(inc);
  });

  app.get('/security/breach/incidents', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const q = ListQuerySchema.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });
    const { incidents, total } = listBreachIncidents(q.data);
    return { incidents, total };
  });

  app.get('/security/breach/incidents/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { id } = req.params as { id: string };
    const inc = getBreachIncident(id);
    if (!inc) return reply.code(404).send({ error: 'not_found' });
    return inc;
  });

  app.patch('/security/breach/incidents/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { id } = req.params as { id: string };
    const parse = UpdateSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: 'invalid_input' });
    const updated = updateBreachIncident(id, parse.data);
    if (!updated) return reply.code(404).send({ error: 'not_found' });
    return updated;
  });

  // -------- Affected users (admin) --------
  app.post('/security/breach/incidents/:id/affected-users', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { id } = req.params as { id: string };
    const parse = AddUsersSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: 'invalid_input', details: parse.error.flatten() });
    try {
      const r = addAffectedUsers(id, parse.data.users);
      return reply.code(201).send(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'error';
      if (msg === 'breach_not_found') return reply.code(404).send({ error: msg });
      return reply.code(500).send({ error: 'add_failed' });
    }
  });

  app.get('/security/breach/incidents/:id/affected-users', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { id } = req.params as { id: string };
    const users = listAffectedUsers(id);
    return { users, total: users.length };
  });

  // -------- Notifications (admin) --------
  app.post('/security/breach/incidents/:id/notify-regulator', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { id } = req.params as { id: string };
    const parse = NotifyRegulatorSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: 'invalid_input', details: parse.error.flatten() });
    try {
      const result = notifyRegulator(id, parse.data);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'error';
      if (msg === 'breach_not_found') return reply.code(404).send({ error: msg });
      return reply.code(500).send({ error: 'notify_failed' });
    }
  });

  app.post('/security/breach/incidents/:id/notify-users', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { id } = req.params as { id: string };
    const parse = NotifyUsersSchema.safeParse(req.body ?? {});
    if (!parse.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const result = notifyAffectedUsers(id, parse.data);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'error';
      if (msg === 'breach_not_found') return reply.code(404).send({ error: msg });
      return reply.code(500).send({ error: 'notify_failed' });
    }
  });

  app.post('/security/breach/incidents/:id/close', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { id } = req.params as { id: string };
    const inc = closeBreach(id, auth.userId ?? null);
    if (!inc) return reply.code(404).send({ error: 'not_found' });
    return inc;
  });

  app.get('/security/breach/incidents/:id/notifications', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { id } = req.params as { id: string };
    const items = listNotifications(id);
    return { notifications: items, total: items.length };
  });

  // -------- Deadlines + stats (admin) --------
  app.get('/security/breach/deadlines', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    return listUpcomingDeadlines();
  });

  app.get('/security/breach/stats/summary', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const q = req.query as { window_days?: string };
    const days = q.window_days ? Math.min(Math.max(parseInt(q.window_days, 10) || 90, 1), 3650) : 90;
    return getBreachStats(days);
  });

  // -------- User self-service --------
  app.get('/security/breach/my-notifications', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ error: auth.error });
    const items = listUserBreachNotifications(auth.userId!);
    return { notifications: items, total: items.length };
  });
}
