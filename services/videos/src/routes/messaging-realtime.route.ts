// melodyflix videos — Real-time Messaging routes (Section 147)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, verifyJwt, extractBearerToken } from '@melodyflix/shared-auth';
import {
  registerConnection, unregisterConnection, heartbeat,
  getUserPresence, setPresenceStatus, getPresenceForUsers,
  listOnlineUsers, sweepStalePresence,
  startTyping, stopTyping, listTypingInThread,
  createReceipt, getReceipt, markDelivered, markRead, listMessageReceipts,
  getUnreadSummary, markThreadReadReceipts,
  createGroupChat, getGroupChat, getGroupChatBySlug, listUserGroupChats,
  listGroupMembers, addGroupMember, removeGroupMember,
  getGroupMember, isGroupMember, deleteGroupChat,
  reactToDMMessage, removeDMMessageReaction,
  getDMMessageReactionSummary, listDMMessageReactions,
  logMessageEdit, listMessageEdits,
  buildRealtimeEvent,
} from '../services/messaging-realtime.service.js';

const PresenceSchema = z.object({
  status: z.enum(['online', 'away', 'offline']),
});

const TypingSchema = z.object({
  thread_id: z.string().min(1).max(100),
});

const ReceiptSchema = z.object({
  message_id: z.string().min(1).max(100),
  recipient_id: z.string().uuid(),
});

const CreateGroupSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(2).max(60).optional(),
  avatar_url: z.string().url().max(500).nullable().optional(),
  is_public: z.boolean().optional(),
  member_ids: z.array(z.string().uuid()).max(500).optional(),
});

const AddMemberSchema = z.object({
  user_id: z.string().uuid(),
});

const ReactSchema = z.object({
  emoji: z.string().min(1).max(20),
});

const LogEditSchema = z.object({
  message_id: z.string().min(1).max(100),
  old_body: z.string().max(10000),
  new_body: z.string().max(10000),
});

function requireAuthPayload(auth: string | undefined): { sub: string; role: string } {
  const payload = requireAuth(auth);
  return { sub: payload.sub as string, role: (payload.role as string) ?? 'user' };
}

function optionalUser(authorization: string | undefined) {
  const token = extractBearerToken(authorization);
  if (!token) return null;
  try { return verifyJwt(token); } catch { return null; }
}

export async function messagingRealtimeRoutes(app: FastifyInstance) {
  // ============================================================
  // 147.1 — Connection lifecycle (called by WS layer)
  // ============================================================

  // POST /realtime/connect — register a new connection
  app.post('/realtime/connect', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const presence = registerConnection(payload.sub);
    const event = buildRealtimeEvent({
      type: 'presence.changed', actor_id: payload.sub,
      target_user_ids: [], payload: { status: 'online' },
    });
    return reply.code(201).send({ success: true, data: { presence, event } });
  });

  // POST /realtime/disconnect
  app.post('/realtime/disconnect', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const presence = unregisterConnection(payload.sub);
    const event = buildRealtimeEvent({
      type: 'presence.changed', actor_id: payload.sub,
      target_user_ids: [], payload: { status: presence?.status ?? 'offline' },
    });
    return reply.send({ success: true, data: { presence, event } });
  });

  // POST /realtime/heartbeat
  app.post('/realtime/heartbeat', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    heartbeat(payload.sub);
    return reply.send({ success: true, data: { ok: true } });
  });

  // ============================================================
  // 147.4 — Presence
  // ============================================================

  // GET /realtime/presence/me
  app.get('/realtime/presence/me', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: getUserPresence(payload.sub) });
  });

  // PUT /realtime/presence — set status
  app.put('/realtime/presence', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = PresenceSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const presence = setPresenceStatus(payload.sub, parsed.data.status);
    const event = buildRealtimeEvent({
      type: 'presence.changed', actor_id: payload.sub,
      target_user_ids: [], payload: { status: parsed.data.status },
    });
    return reply.send({ success: true, data: { presence, event } });
  });

  // POST /realtime/presence/batch — get presence for multiple users
  app.post('/realtime/presence/batch', async (req, reply) => {
    const body = req.body as { user_ids?: string[] };
    if (!Array.isArray(body.user_ids) || body.user_ids.length === 0) {
      return reply.code(400).send({ success: false, error: 'user_ids array required' });
    }
    if (body.user_ids.length > 200) return reply.code(400).send({ success: false, error: 'max 200 users' });
    const presences = getPresenceForUsers(body.user_ids);
    return reply.send({ success: true, data: { presences } });
  });

  // GET /realtime/presence/online?limit=
  app.get('/realtime/presence/online', async (req, reply) => {
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 100, 1), 500) : 100;
    return reply.send({ success: true, data: { users: listOnlineUsers(limit) } });
  });

  // POST /realtime/presence/sweep — cron: mark stale offline
  app.post('/realtime/presence/sweep', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (payload.role !== 'admin') return reply.code(403).send({ success: false, error: 'Admin only' });
    const body = req.body as { threshold_minutes?: number };
    const threshold = Math.min(Math.max(body.threshold_minutes ?? 5, 1), 60);
    const swept = sweepStalePresence(threshold);
    return reply.send({ success: true, data: { swept } });
  });

  // ============================================================
  // 147.2 — Typing Indicators
  // ============================================================

  // POST /realtime/typing/start
  app.post('/realtime/typing/start', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = TypingSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const indicator = startTyping(parsed.data.thread_id, payload.sub);
    const event = buildRealtimeEvent({
      type: 'typing.started', actor_id: payload.sub,
      target_user_ids: [], payload: { thread_id: parsed.data.thread_id, expires_at: indicator.expires_at },
    });
    return reply.send({ success: true, data: { indicator, event } });
  });

  // POST /realtime/typing/stop
  app.post('/realtime/typing/stop', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = TypingSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    stopTyping(parsed.data.thread_id, payload.sub);
    const event = buildRealtimeEvent({
      type: 'typing.stopped', actor_id: payload.sub,
      target_user_ids: [], payload: { thread_id: parsed.data.thread_id },
    });
    return reply.send({ success: true, data: { event } });
  });

  // GET /realtime/typing/:threadId
  app.get('/realtime/typing/:threadId', async (req, reply) => {
    const { threadId } = req.params as { threadId: string };
    return reply.send({ success: true, data: { typing: listTypingInThread(threadId) } });
  });

  // ============================================================
  // 147.3 / 147.5 — Receipts
  // ============================================================

  // POST /realtime/receipts — create a receipt
  app.post('/realtime/receipts', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = ReceiptSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const receipt = createReceipt(parsed.data.message_id, parsed.data.recipient_id);
    return reply.code(201).send({ success: true, data: receipt });
  });

  // GET /realtime/receipts/:messageId — all receipts for a message
  app.get('/realtime/receipts/:messageId', async (req, reply) => {
    const { messageId } = req.params as { messageId: string };
    return reply.send({ success: true, data: { receipts: listMessageReceipts(messageId) } });
  });

  // POST /realtime/receipts/delivered
  app.post('/realtime/receipts/delivered', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = ReceiptSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const receipt = markDelivered(parsed.data.message_id, parsed.data.recipient_id);
    if (!receipt) return reply.code(404).send({ success: false, error: 'Receipt not found' });
    const event = buildRealtimeEvent({
      type: 'message.delivered', actor_id: payload.sub,
      target_user_ids: [], payload: { message_id: parsed.data.message_id, recipient_id: parsed.data.recipient_id },
    });
    return reply.send({ success: true, data: { receipt, event } });
  });

  // POST /realtime/receipts/read
  app.post('/realtime/receipts/read', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = ReceiptSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const receipt = markRead(parsed.data.message_id, parsed.data.recipient_id);
    if (!receipt) return reply.code(404).send({ success: false, error: 'Receipt not found' });
    const event = buildRealtimeEvent({
      type: 'message.read', actor_id: payload.sub,
      target_user_ids: [], payload: { message_id: parsed.data.message_id, recipient_id: parsed.data.recipient_id },
    });
    return reply.send({ success: true, data: { receipt, event } });
  });

  // POST /realtime/receipts/thread/:threadId/read-all
  app.post('/realtime/receipts/thread/:threadId/read-all', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { threadId } = req.params as { threadId: string };
    const count = markThreadReadReceipts(threadId, payload.sub);
    return reply.send({ success: true, data: { marked_read: count } });
  });

  // GET /realtime/unread-summary
  app.get('/realtime/unread-summary', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: getUnreadSummary(payload.sub) });
  });

  // ============================================================
  // 147.6 — Group Chat
  // ============================================================

  // POST /realtime/groups
  app.post('/realtime/groups', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = CreateGroupSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const group = createGroupChat({ ...parsed.data, owner_id: payload.sub });
      return reply.code(201).send({ success: true, data: group });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /realtime/groups — my groups
  app.get('/realtime/groups', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: { groups: listUserGroupChats(payload.sub) } });
  });

  // GET /realtime/groups/slug/:slug
  app.get('/realtime/groups/slug/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const group = getGroupChatBySlug(slug);
    if (!group) return reply.code(404).send({ success: false, error: 'Group not found' });
    return reply.send({ success: true, data: group });
  });

  // GET /realtime/groups/:id
  app.get('/realtime/groups/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const group = getGroupChat(id);
    if (!group) return reply.code(404).send({ success: false, error: 'Group not found' });
    return reply.send({ success: true, data: group });
  });

  // GET /realtime/groups/:id/members
  app.get('/realtime/groups/:id/members', async (req, reply) => {
    const { id } = req.params as { id: string };
    const group = getGroupChat(id);
    if (!group) return reply.code(404).send({ success: false, error: 'Group not found' });
    return reply.send({ success: true, data: { members: listGroupMembers(id) } });
  });

  // POST /realtime/groups/:id/members
  app.post('/realtime/groups/:id/members', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = AddMemberSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const member = addGroupMember(id, payload.sub, parsed.data.user_id);
      const event = buildRealtimeEvent({
        type: 'group.member.added', actor_id: payload.sub,
        target_user_ids: [parsed.data.user_id], payload: { group_id: id, user_id: parsed.data.user_id },
      });
      return reply.code(201).send({ success: true, data: { member, event } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /realtime/groups/:id/members/:userId
  app.delete('/realtime/groups/:id/members/:userId', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id, userId } = req.params as { id: string; userId: string };
    try {
      const ok = removeGroupMember(id, payload.sub, userId);
      if (!ok) return reply.code(404).send({ success: false, error: 'Member not found' });
      const event = buildRealtimeEvent({
        type: 'group.member.removed', actor_id: payload.sub,
        target_user_ids: [userId], payload: { group_id: id, user_id: userId },
      });
      return reply.send({ success: true, data: { removed: true, event } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /realtime/groups/:id/is-member
  app.get('/realtime/groups/:id/is-member', async (req, reply) => {
    const user = optionalUser(req.headers.authorization);
    if (!user) return reply.send({ success: true, data: { is_member: false } });
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: { is_member: isGroupMember(id, user.sub as string) } });
  });

  // DELETE /realtime/groups/:id — owner only
  app.delete('/realtime/groups/:id', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      const ok = deleteGroupChat(id, payload.sub);
      if (!ok) return reply.code(404).send({ success: false, error: 'Group not found' });
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // 147.7 — DM Message Reactions
  // ============================================================

  // POST /realtime/dm/:messageId/react
  app.post('/realtime/dm/:messageId/react', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = ReactSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { messageId } = req.params as { messageId: string };
    try {
      const reaction = reactToDMMessage(messageId, payload.sub, parsed.data.emoji);
      const summary = getDMMessageReactionSummary(messageId, payload.sub);
      const event = buildRealtimeEvent({
        type: 'message.reacted', actor_id: payload.sub,
        target_user_ids: [], payload: { message_id: messageId, emoji: parsed.data.emoji },
      });
      return reply.code(201).send({ success: true, data: { reaction, summary, event } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /realtime/dm/:messageId/react/:emoji
  app.delete('/realtime/dm/:messageId/react/:emoji', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { messageId, emoji } = req.params as { messageId: string; emoji: string };
    const ok = removeDMMessageReaction(messageId, payload.sub, emoji);
    if (!ok) return reply.code(404).send({ success: false, error: 'Reaction not found' });
    return reply.send({ success: true, data: { removed: true } });
  });

  // GET /realtime/dm/:messageId/reactions
  app.get('/realtime/dm/:messageId/reactions', async (req, reply) => {
    const user = optionalUser(req.headers.authorization);
    const { messageId } = req.params as { messageId: string };
    const summary = getDMMessageReactionSummary(messageId, user?.sub ?? null);
    const reactions = listDMMessageReactions(messageId);
    return reply.send({ success: true, data: { summary, reactions } });
  });

  // ============================================================
  // 147.8 — Message Edit/Delete Broadcast
  // ============================================================

  // POST /realtime/dm/edits — log an edit (WS layer calls this + broadcasts)
  app.post('/realtime/dm/edits', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = LogEditSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const edit = logMessageEdit(parsed.data.message_id, payload.sub, parsed.data.old_body, parsed.data.new_body);
      const event = buildRealtimeEvent({
        type: 'message.edited', actor_id: payload.sub,
        target_user_ids: [], payload: { message_id: parsed.data.message_id },
      });
      return reply.code(201).send({ success: true, data: { edit, event } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /realtime/dm/:messageId/edits
  app.get('/realtime/dm/:messageId/edits', async (req, reply) => {
    const { messageId } = req.params as { messageId: string };
    return reply.send({ success: true, data: { edits: listMessageEdits(messageId) } });
  });

  // POST /realtime/dm/:messageId/delete-broadcast — log deletion as event
  app.post('/realtime/dm/:messageId/delete-broadcast', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { messageId } = req.params as { messageId: string };
    const event = buildRealtimeEvent({
      type: 'message.deleted', actor_id: payload.sub,
      target_user_ids: [], payload: { message_id: messageId },
    });
    return reply.send({ success: true, data: { event } });
  });
}
