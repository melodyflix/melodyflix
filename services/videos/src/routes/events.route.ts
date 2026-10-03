// melodyflix videos — Events & Ticketing routes (Section 23)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  createEvent, getEvent, listEvents, updateEvent, publishEvent, cancelEvent, deleteEvent,
  bookTicket, getTicket, getTicketByQr, markTicketPaid, cancelTicket, refundTicket,
  checkInTicket, listEventTickets, listMyTickets,
  getEventJoinInfo,
  setReminder, removeReminder, listMyReminders,
  listDueReminders, markReminderNotified,
  getEventStats,
} from '../services/events.service.js';

function userId(req: any): string | null {
  return req.user?.id ?? req.user?.sub ?? null;
}

function checkInternalSecret(req: any): boolean {
  const secret = req.headers['x-internal-secret'];
  const expected = process.env.MELODYFLIX_INTERNAL_SECRET ?? '';
  if (!expected) return true;
  return secret === expected;
}

export async function eventsRoutes(app: FastifyInstance) {
  // ---- Public discovery ----

  app.get('/events', async (req, reply) => {
    const q = req.query as { status?: string; type?: string; from?: string; to?: string; limit?: string };
    const events = listEvents({
      status: q.status as any,
      type: q.type as any,
      from: q.from, to: q.to,
      public_only: true,
      limit: q.limit ? parseInt(q.limit) : 100,
    });
    return reply.send({ success: true, data: { events, count: events.length } });
  });

  app.get('/events/upcoming', async (req, reply) => {
    const q = req.query as { limit?: string };
    const events = listEvents({
      from: new Date().toISOString(),
      status: 'published',
      public_only: true,
      limit: q.limit ? parseInt(q.limit) : 30,
    });
    return reply.send({ success: true, data: { events, count: events.length } });
  });

  app.get('/events/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ev = getEvent(id);
    if (!ev) return reply.code(404).send({ success: false, error: 'Event not found' });
    const me = userId(req as any);
    if (!ev.is_public && ev.owner_id !== me) {
      return reply.code(403).send({ success: false, error: 'Private event' });
    }
    return reply.send({ success: true, data: { event: ev } });
  });

  // Owner-scoped list
  app.get('/events/mine', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const q = req.query as { status?: string; limit?: string };
    const events = listEvents({
      owner_id: me,
      status: q.status as any,
      limit: q.limit ? parseInt(q.limit) : 100,
    });
    return reply.send({ success: true, data: { events, count: events.length } });
  });

  // ---- Owner CRUD ----

  const CreateSchema = z.object({
    channel_id: z.string().nullable().optional(),
    title: z.string().min(1).max(200),
    description: z.string().max(5000).nullable().optional(),
    cover_url: z.string().url().nullable().optional(),
    event_type: z.enum(['in_person', 'virtual', 'hybrid']).optional(),
    venue_name: z.string().max(200).nullable().optional(),
    venue_address: z.string().max(500).nullable().optional(),
    virtual_stream_id: z.string().nullable().optional(),
    virtual_join_url: z.string().url().nullable().optional(),
    starts_at: z.string(),
    ends_at: z.string().nullable().optional(),
    timezone: z.string().max(40).optional(),
    capacity: z.number().int().min(1).max(10_000_000).nullable().optional(),
    price_cents: z.number().int().min(0).max(10_000_000).optional(),
    currency: z.string().min(3).max(3).optional(),
    is_public: z.boolean().optional(),
  });

  app.post('/events', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const ev = createEvent({ owner_id: me, ...parsed.data });
      return reply.code(201).send({ success: true, data: { event: ev } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Create failed' });
    }
  });

  const UpdateSchema = CreateSchema.partial().omit({ channel_id: true });

  app.patch('/events/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const parsed = UpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const ev = updateEvent(id, me, parsed.data);
      if (!ev) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { event: ev } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  app.post('/events/:id/publish', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const ev = publishEvent(id, me);
      if (!ev) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { event: ev } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Publish failed' });
    }
  });

  app.post('/events/:id/cancel', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const ev = cancelEvent(id, me);
      if (!ev) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { event: ev } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Cancel failed' });
    }
  });

  app.delete('/events/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const ok = deleteEvent(id, me);
      if (!ok) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { deleted: true } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  // ---- Ticket booking ----

  const BookSchema = z.object({
    quantity: z.number().int().min(1).max(10).optional(),
    transaction_id: z.string().nullable().optional(),
    seat_label: z.string().max(40).nullable().optional(),
  });

  app.post('/events/:id/tickets', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const parsed = BookSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const ticket = bookTicket({ event_id: id, user_id: me, ...parsed.data });
      return reply.code(201).send({ success: true, data: { ticket } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Book failed' });
    }
  });

  app.get('/events/:id/tickets', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const ev = getEvent(id);
    if (!ev) return reply.code(404).send({ success: false, error: 'Not found' });
    if (ev.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your event' });
    const tickets = listEventTickets(id, 500);
    return reply.send({ success: true, data: { tickets, count: tickets.length } });
  });

  app.get('/events/tickets/mine', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const q = req.query as { limit?: string };
    const tickets = listMyTickets(me, q.limit ? parseInt(q.limit) : 100);
    return reply.send({ success: true, data: { tickets, count: tickets.length } });
  });

  app.get('/events/tickets/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const t = getTicket(id);
    if (!t) return reply.code(404).send({ success: false, error: 'Not found' });
    const ev = getEvent(t.event_id);
    if (t.user_id !== me && ev?.owner_id !== me) {
      return reply.code(403).send({ success: false, error: 'Not your ticket' });
    }
    return reply.send({ success: true, data: { ticket: t } });
  });

  app.post('/events/tickets/:id/pay', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const t = getTicket(id);
    if (!t) return reply.code(404).send({ success: false, error: 'Not found' });
    if (t.user_id !== me) return reply.code(403).send({ success: false, error: 'Not your ticket' });
    const body = req.body as { transaction_id?: string } | null;
    try {
      const updated = markTicketPaid(id, body?.transaction_id);
      return reply.send({ success: true, data: { ticket: updated } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Pay failed' });
    }
  });

  app.post('/events/tickets/:id/cancel', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const t = cancelTicket(id, me);
      if (!t) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { ticket: t } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Cancel failed' });
    }
  });

  app.post('/events/tickets/:id/refund', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const t = refundTicket(id, me);
      if (!t) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { ticket: t } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  // Check-in via QR (owner only)
  app.post('/events/check-in', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const body = req.body as { qr_token?: string };
    if (!body?.qr_token) return reply.code(400).send({ success: false, error: 'qr_token required' });
    try {
      const t = checkInTicket(body.qr_token, me);
      if (!t) return reply.code(404).send({ success: false, error: 'Ticket not found' });
      return reply.send({ success: true, data: { ticket: t } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Check-in failed' });
    }
  });

  // ---- 23.3 Virtual join ----

  app.get('/events/:id/join-info', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    const { id } = req.params as { id: string };
    try {
      const info = getEventJoinInfo(id, me);
      return reply.send({ success: true, data: info });
    } catch (e: any) {
      return reply.code(404).send({ success: false, error: e?.message ?? 'Not found' });
    }
  });

  // ---- 23.4 Reminders ----

  const ReminderSchema = z.object({
    remind_minutes_before: z.number().int().min(1).max(7 * 24 * 60).optional(),
  });

  app.post('/events/:id/reminders', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const parsed = ReminderSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const r = setReminder({ event_id: id, user_id: me, ...parsed.data });
      return reply.code(201).send({ success: true, data: { reminder: r } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Set failed' });
    }
  });

  app.delete('/events/:id/reminders', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const removed = removeReminder(id, me);
    return reply.send({ success: true, data: { removed } });
  });

  app.get('/events/reminders/mine', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const list = listMyReminders(me, 100);
    return reply.send({ success: true, data: { reminders: list, count: list.length } });
  });

  // Worker endpoints
  app.get('/events/reminders/due', async (req, reply) => {
    if (!checkInternalSecret(req)) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const q = req.query as { at?: string };
    const due = listDueReminders(q.at);
    return reply.send({ success: true, data: { due, count: due.length } });
  });

  app.post('/events/reminders/:reminderId/notified', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { reminderId } = req.params as { reminderId: string };
    markReminderNotified(reminderId);
    return reply.send({ success: true, data: { notified: true } });
  });

  // ---- Stats ----

  app.get('/events/:id/stats', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const ev = getEvent(id);
    if (!ev) return reply.code(404).send({ success: false, error: 'Not found' });
    if (ev.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your event' });
    return reply.send({ success: true, data: getEventStats(id) });
  });
}
