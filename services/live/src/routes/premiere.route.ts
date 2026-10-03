// melodyflix live — Premiere routes (7.2)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  createPremiere, getPremiere, getPremiereByStreamId, listPremieres,
  listUpcomingPremieres, updatePremiere, cancelPremiere, endPremiere,
  tickPremieres,
  postPremiereChat, listPremiereChat, pinPremiereChat,
  addRsvp, removeRsvp, isRsvped, countRsvps,
  listDueRsvps, markRsvpNotified,
  getPublicView,
} from '../services/premiere.service.js';

function userId(req: any): string | null {
  return req.user?.id ?? req.user?.sub ?? null;
}

function isOwner(premiereId: string, uid: string): boolean {
  const p = getPremiere(premiereId);
  return !!p && p.owner_id === uid;
}

export async function premiereRoutes(app: FastifyInstance) {
  // ---- Public discovery ----

  app.get('/premieres/upcoming', async (req, reply) => {
    const q = req.query as { limit?: string };
    const list = listUpcomingPremieres(q.limit ? parseInt(q.limit) : 20);
    return reply.send({ success: true, data: { premieres: list.map((p) => getPublicView(p.id)), count: list.length } });
  });

  app.get('/premieres', async (req, reply) => {
    const q = req.query as { status?: string; owner_id?: string; from?: string; to?: string; limit?: string };
    const list = listPremieres({
      owner_id: q.owner_id,
      status: q.status as any,
      from: q.from, to: q.to,
      limit: q.limit ? parseInt(q.limit) : 100,
    });
    return reply.send({ success: true, data: { premieres: list.map((p) => getPublicView(p.id)), count: list.length } });
  });

  // GET /premieres/:id — public view
  app.get('/premieres/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const view = getPublicView(id);
    if (!view) return reply.code(404).send({ success: false, error: 'Premiere not found' });
    return reply.send({ success: true, data: { premiere: view } });
  });

  // GET /premieres/by-stream/:streamId — lookup by backing stream
  app.get('/premieres/by-stream/:streamId', async (req, reply) => {
    const { streamId } = req.params as { streamId: string };
    const prm = getPremiereByStreamId(streamId);
    if (!prm) return reply.code(404).send({ success: false, error: 'Premiere not found' });
    return reply.send({ success: true, data: { premiere: getPublicView(prm.id) } });
  });

  // ---- Owner CRUD ----

  const CreateSchema = z.object({
    video_id: z.string().min(1),
    title: z.string().max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    scheduled_at: z.string(),
    countdown_minutes: z.number().int().min(1).max(60 * 24).optional(),
    duration_seconds: z.number().min(0).max(24 * 3600).nullable().optional(),
    chat_enabled: z.boolean().optional(),
    thumbnail_url: z.string().url().nullable().optional(),
  });

  app.post('/premieres', { preHandler: [requireAuth] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const prm = createPremiere({ owner_id: uid, ...parsed.data });
      return reply.code(201).send({ success: true, data: { premiere: getPublicView(prm.id) } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Create failed' });
    }
  });

  const UpdateSchema = z.object({
    title: z.string().max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    scheduled_at: z.string().optional(),
    countdown_minutes: z.number().int().min(1).max(60 * 24).optional(),
    chat_enabled: z.boolean().optional(),
    thumbnail_url: z.string().url().nullable().optional(),
  });

  app.patch('/premieres/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    if (!isOwner(id, uid)) return reply.code(403).send({ success: false, error: 'Owner only' });
    const parsed = UpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const updated = updatePremiere(id, uid, parsed.data);
      if (!updated) return reply.code(404).send({ success: false, error: 'Premiere not found' });
      return reply.send({ success: true, data: { premiere: getPublicView(id) } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Update failed' });
    }
  });

  app.post('/premieres/:id/cancel', { preHandler: [requireAuth] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const ok = cancelPremiere(id, uid);
      if (!ok) return reply.code(404).send({ success: false, error: 'Premiere not found' });
      return reply.send({ success: true, data: { cancelled: true } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Cancel failed' });
    }
  });

  app.post('/premieres/:id/end', { preHandler: [requireAuth] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const prm = endPremiere(id, uid);
      if (!prm) return reply.code(404).send({ success: false, error: 'Premiere not found' });
      return reply.send({ success: true, data: { premiere: getPublicView(id) } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'End failed' });
    }
  });

  // ---- Scheduler tick (can be called by worker or cron) ----
  app.post('/premieres/tick', async (req, reply) => {
    const body = (req.body ?? {}) as { at?: string };
    const result = tickPremieres(body.at);
    return reply.send({
      success: true,
      data: {
        changed: result.changed.map((p) => getPublicView(p.id)),
        count: result.changed.length,
      },
    });
  });

  // ---- Chat (works during countdown + live) ----

  const ChatPostSchema = z.object({
    content: z.string().min(1).max(500),
  });

  app.get('/premieres/:id/chat', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string };
    const chat = listPremiereChat(id, q.limit ? parseInt(q.limit) : 100);
    return reply.send({ success: true, data: { chat, count: chat.length } });
  });

  app.post('/premieres/:id/chat', { preHandler: [requireAuth] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const parsed = ChatPostSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const username = (req as any).user?.username ?? uid.slice(0, 8);
    try {
      const msg = postPremiereChat({
        premiereId: id, userId: uid, username, content: parsed.data.content,
      });
      return reply.code(201).send({ success: true, data: { message: msg } });
    } catch (e: any) {
      const msg = e?.message ?? 'Post failed';
      if (msg.includes('disabled')) return reply.code(403).send({ success: false, error: msg });
      if (msg.includes('closed')) return reply.code(410).send({ success: false, error: msg });
      return reply.code(400).send({ success: false, error: msg });
    }
  });

  app.post('/premieres/:id/chat/:msgId/pin', { preHandler: [requireAuth] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id, msgId } = req.params as { id: string; msgId: string };
    try {
      const ok = pinPremiereChat(msgId, id, uid);
      return reply.send({ success: true, data: { pinned: ok } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  // ---- RSVPs ----

  const RsvpSchema = z.object({
    remind_minutes_before: z.number().int().min(1).max(24 * 60).optional(),
  });

  app.post('/premieres/:id/rsvp', { preHandler: [requireAuth] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const parsed = RsvpSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const rsvp = addRsvp({ premiereId: id, userId: uid, remindMinutesBefore: parsed.data.remind_minutes_before });
      return reply.code(201).send({ success: true, data: { rsvp, count: countRsvps(id) } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'RSVP failed' });
    }
  });

  app.delete('/premieres/:id/rsvp', { preHandler: [requireAuth] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const removed = removeRsvp(id, uid);
    return reply.send({ success: true, data: { removed, count: countRsvps(id) } });
  });

  app.get('/premieres/:id/rsvp', { preHandler: [requireAuth] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: { rsvped: isRsvped(id, uid), count: countRsvps(id) } });
  });

  // ---- RSVP worker helpers ----

  app.get('/premieres/rsvp/due', async (req, reply) => {
    const q = req.query as { at?: string };
    const due = listDueRsvps(q.at);
    return reply.send({ success: true, data: { due, count: due.length } });
  });

  app.post('/premieres/rsvp/:rsvpId/notified', { preHandler: [requireAuth] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { rsvpId } = req.params as { rsvpId: string };
    markRsvpNotified(rsvpId);
    return reply.send({ success: true, data: { notified: true } });
  });
}
