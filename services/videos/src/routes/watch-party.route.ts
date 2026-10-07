// melodyflix videos - Section 15.1 Watch Party routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  createParty, getParty, getPartyByCode, listMyParties, listActiveParties,
  startParty, endParty, setPlaybackState,
  joinParty, leaveParty, setRole, kickParticipant, listParticipants,
  createInvite, listInvites, redeemInvite, getInvite,
  sendMessage, listMessages, deleteMessage,
  listEvents, getPartyState, getWatchPartyStats,
} from '../services/watch-party.service.js';

const VISIBILITIES = ['public','private','invite'] as const;
const ROLES = ['host','moderator','viewer'] as const;

const CreateSchema = z.object({
  video_id: z.string().min(1).max(100),
  title: z.string().max(200).nullable().optional(),
  visibility: z.enum(VISIBILITIES).optional(),
  max_participants: z.number().int().min(2).max(1000).optional(),
});

const PlaybackSchema = z.object({
  is_playing: z.boolean().optional(),
  position_seconds: z.number().min(0).max(86400).optional(),
  playback_rate: z.number().min(0.25).max(4).optional(),
});

const RoleSchema = z.object({ role: z.enum(['moderator','viewer']) });

const InviteSchema = z.object({
  ttl_seconds: z.number().int().min(60).max(86400 * 7).optional(),
});

const MessageSchema = z.object({
  body: z.string().min(1).max(2000),
});

function user(auth: string | undefined): string | null {
  try {
    const p: any = requireRole(auth, ['admin','user','moderator']);
    return p?.sub ?? p?.id ?? null;
  } catch { return null; }
}
function admin(auth: string | undefined): boolean {
  try { requireRole(auth, ['admin']); return true; } catch { return false; }
}

export async function watchPartyRoutes(app: FastifyInstance): Promise<void> {
  // ============ PARTIES ============
  app.post('/party', async (req, reply) => {
    const uid = user(req.headers.authorization);
    if (!uid) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = CreateSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createParty({ host_id: uid, ...p.data }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/party/mine', async (req, reply) => {
    const uid = user(req.headers.authorization);
    if (!uid) return reply.code(403).send({ success: false, error: 'auth_required' });
    const q = req.query as { limit?: string };
    return reply.send({ success: true, data: { parties: listMyParties(uid, q.limit ? Number(q.limit) : 50) } });
  });

  app.get('/party/active', async (req, reply) => {
    const q = req.query as { visibility?: string; video_id?: string; limit?: string };
    return reply.send({ success: true, data: { parties: listActiveParties({
      visibility: q.visibility as any, video_id: q.video_id,
      limit: q.limit ? Number(q.limit) : undefined,
    }) } });
  });

  app.get('/party/code/:code', async (req, reply) => {
    const { code } = req.params as { code: string };
    const p = getPartyByCode(code);
    if (!p) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: p });
  });

  app.get('/party/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = getPartyState(id);
    if (!s) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: s });
  });

  app.post('/party/:id/start', async (req, reply) => {
    const uid = user(req.headers.authorization);
    if (!uid) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: startParty(id, uid) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/party/:id/end', async (req, reply) => {
    const uid = user(req.headers.authorization);
    if (!uid) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: endParty(id, uid) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  // ============ PLAYBACK ============
  app.post('/party/:id/playback', async (req, reply) => {
    const uid = user(req.headers.authorization);
    if (!uid) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const p = PlaybackSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: setPlaybackState(id, uid, p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  // ============ PARTICIPANTS ============
  app.post('/party/:id/join', async (req, reply) => {
    const uid = user(req.headers.authorization);
    if (!uid) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: joinParty(id, uid, 'viewer') }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/party/:id/leave', async (req, reply) => {
    const uid = user(req.headers.authorization);
    if (!uid) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const r = leaveParty(id, uid);
    return r ? reply.send({ success: true, data: r }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  app.get('/party/:id/participants', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { online?: string };
    return reply.send({ success: true, data: { participants: listParticipants(id, q.online === '1' || q.online === 'true') } });
  });

  app.patch('/party/:id/participants/:userId', async (req, reply) => {
    const uid = user(req.headers.authorization);
    if (!uid) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id, userId } = req.params as { id: string; userId: string };
    const p = RoleSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try {
      const r = setRole(id, uid, userId, p.data.role);
      return r ? reply.send({ success: true, data: r }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.delete('/party/:id/participants/:userId', async (req, reply) => {
    const uid = user(req.headers.authorization);
    if (!uid) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id, userId } = req.params as { id: string; userId: string };
    try {
      const ok = kickParticipant(id, uid, userId);
      return ok ? reply.send({ success: true, data: { kicked: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(403).send({ success: false, error: (e as Error).message }); }
  });

  // ============ INVITES ============
  app.post('/party/:id/invites', async (req, reply) => {
    const uid = user(req.headers.authorization);
    if (!uid) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const p = InviteSchema.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createInvite({ party_id: id, created_by: uid, ttl_seconds: p.data.ttl_seconds }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/party/:id/invites', async (req, reply) => {
    const uid = user(req.headers.authorization);
    if (!uid) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: { invites: listInvites(id) } });
  });

  app.get('/party/invites/:inviteId', async (req, reply) => {
    const { inviteId } = req.params as { inviteId: string };
    const i = getInvite(inviteId);
    if (!i) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: i });
  });

  app.post('/party/invites/redeem', async (req, reply) => {
    const uid = user(req.headers.authorization);
    if (!uid) return reply.code(403).send({ success: false, error: 'auth_required' });
    const body = req.body as { code?: string };
    if (!body?.code) return reply.code(400).send({ success: false, error: 'code_required' });
    try { return reply.send({ success: true, data: redeemInvite(body.code, uid) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  // ============ CHAT ============
  app.post('/party/:id/messages', async (req, reply) => {
    const uid = user(req.headers.authorization);
    if (!uid) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const p = MessageSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: sendMessage(id, uid, p.data.body) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/party/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string };
    return reply.send({ success: true, data: { messages: listMessages(id, q.limit ? Number(q.limit) : 100) } });
  });

  app.delete('/party/messages/:msgId', async (req, reply) => {
    const uid = user(req.headers.authorization);
    if (!uid) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { msgId } = req.params as { msgId: string };
    try {
      const ok = deleteMessage(msgId, uid);
      return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(403).send({ success: false, error: (e as Error).message }); }
  });

  // ============ EVENTS ============
  app.get('/party/:id/events', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string };
    return reply.send({ success: true, data: { events: listEvents(id, q.limit ? Number(q.limit) : 100) } });
  });

  // ============ STATS ============
  app.get('/party/stats', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getWatchPartyStats() });
  });
}
