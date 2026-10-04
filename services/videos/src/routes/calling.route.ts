// melodyflix videos — Voice & Video Calling routes (Section 146)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  createCall, getCall, getCallByRoom, listCallParticipants, getCallParticipant,
  acceptCall, declineCall, leaveCall, endCall, expireStaleRingingCalls,
  setScreenSharing,
  startRecording, stopRecording, listCallRecordings,
  listCallHistory, getMissedCallCount,
  isBlocked, blockUserFromCalls, unblockUserFromCalls, listCallBlocks,
  setDnd, getDnd, canRingUser,
  getIceServers, buildCallSignal,
} from '../services/calling.service.js';

const CreateCallSchema = z.object({
  call_type: z.enum(['voice', 'video']),
  participant_ids: z.array(z.string().uuid()).min(1).max(50),
  scope: z.enum(['direct', 'group']).optional(),
  metadata: z.record(z.string(), z.any()).nullable().optional(),
});

const ScreenShareSchema = z.object({
  sharing: z.boolean(),
});

const StopRecordingSchema = z.object({
  storage_url: z.string().url().max(1000),
  file_size_bytes: z.number().int().nonnegative().nullable().optional(),
});

const BlockSchema = z.object({
  user_id: z.string().uuid(),
  reason: z.string().max(500).nullable().optional(),
});

const DndSchema = z.object({
  is_enabled: z.boolean(),
  scope: z.enum(['all', 'unknown_only', 'nobody']).optional(),
  allow_from: z.array(z.string().uuid()).max(500).optional(),
});

function requireAuthPayload(auth: string | undefined): { sub: string; role: string } {
  const payload = requireAuth(auth);
  return { sub: payload.sub as string, role: (payload.role as string) ?? 'user' };
}

export async function callingRoutes(app: FastifyInstance) {
  // ============================================================
  // ICE / TURN config
  // ============================================================

  // GET /calls/ice-servers — public config for WebRTC clients
  app.get('/calls/ice-servers', async (_req, reply) => {
    return reply.send({ success: true, data: getIceServers() });
  });

  // ============================================================
  // Call lifecycle
  // ============================================================

  // POST /calls — create a new call
  app.post('/calls', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = CreateCallSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const result = createCall({
        initiator_id: payload.sub,
        call_type: parsed.data.call_type,
        participant_ids: parsed.data.participant_ids,
        scope: parsed.data.scope,
        metadata: parsed.data.metadata ?? null,
      });
      // Build invite signal for the WS layer to fan out
      const signal = buildCallSignal({
        type: 'call.invited',
        call_id: result.call.id,
        from_user: payload.sub,
        to_users: result.participants.filter((p) => p.user_id !== payload.sub).map((p) => p.user_id),
        payload: { call_type: result.call.call_type, scope: result.call.scope },
      });
      return reply.code(201).send({ success: true, data: { ...result, signal } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /calls/:id
  app.get('/calls/:id', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const call = getCall(id);
    if (!call) return reply.code(404).send({ success: false, error: 'Call not found' });
    const me = getCallParticipant(id, payload.sub);
    if (!me) return reply.code(403).send({ success: false, error: 'Not a participant' });
    return reply.send({ success: true, data: { call, participants: listCallParticipants(id) } });
  });

  // GET /calls/room/:roomId
  app.get('/calls/room/:roomId', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { roomId } = req.params as { roomId: string };
    const call = getCallByRoom(roomId);
    if (!call) return reply.code(404).send({ success: false, error: 'Call not found' });
    const me = getCallParticipant(call.id, payload.sub);
    if (!me) return reply.code(403).send({ success: false, error: 'Not a participant' });
    return reply.send({ success: true, data: { call, participants: listCallParticipants(call.id) } });
  });

  // POST /calls/:id/accept
  app.post('/calls/:id/accept', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      const call = acceptCall(id, payload.sub);
      const signal = buildCallSignal({
        type: 'call.accepted', call_id: id, from_user: payload.sub,
        to_users: listCallParticipants(id).map((p) => p.user_id).filter((u) => u !== payload.sub),
      });
      return reply.send({ success: true, data: { call, signal } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /calls/:id/decline
  app.post('/calls/:id/decline', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      const call = declineCall(id, payload.sub);
      const signal = buildCallSignal({
        type: 'call.declined', call_id: id, from_user: payload.sub,
        to_users: listCallParticipants(id).map((p) => p.user_id).filter((u) => u !== payload.sub),
      });
      return reply.send({ success: true, data: { call, signal } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /calls/:id/leave
  app.post('/calls/:id/leave', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      const call = leaveCall(id, payload.sub);
      const signal = buildCallSignal({
        type: 'call.left', call_id: id, from_user: payload.sub,
        to_users: listCallParticipants(id).map((p) => p.user_id).filter((u) => u !== payload.sub),
      });
      return reply.send({ success: true, data: { call, signal } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /calls/:id/end
  app.post('/calls/:id/end', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { reason?: string };
    try {
      const call = endCall(id, payload.sub, body.reason ?? 'hangup');
      const signal = buildCallSignal({
        type: 'call.ended', call_id: id, from_user: payload.sub,
        to_users: listCallParticipants(id).map((p) => p.user_id),
        payload: { reason: call.end_reason },
      });
      return reply.send({ success: true, data: { call, signal } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /calls/expire-stale — cron: mark ringing as missed (admin only)
  app.post('/calls/expire-stale', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (payload.role !== 'admin') return reply.code(403).send({ success: false, error: 'Admin only' });
    const body = (req.body ?? {}) as { timeout_seconds?: number };
    const timeout = Math.min(Math.max(body.timeout_seconds ?? 45, 10), 300);
    const expired = expireStaleRingingCalls(timeout);
    return reply.send({ success: true, data: { expired } });
  });

  // ============================================================
  // 146.6 — Screen Sharing
  // ============================================================

  // POST /calls/:id/screen-share
  app.post('/calls/:id/screen-share', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = ScreenShareSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const p = setScreenSharing(id, payload.sub, parsed.data.sharing);
      const signal = buildCallSignal({
        type: parsed.data.sharing ? 'call.screen_share.started' : 'call.screen_share.stopped',
        call_id: id, from_user: payload.sub,
        to_users: listCallParticipants(id).map((pp) => pp.user_id).filter((u) => u !== payload.sub),
      });
      return reply.send({ success: true, data: { participant: p, signal } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // 146.5 — Recording
  // ============================================================

  // POST /calls/:id/recording/start
  app.post('/calls/:id/recording/start', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      const call = startRecording(id, payload.sub);
      const signal = buildCallSignal({
        type: 'call.recording.started', call_id: id, from_user: payload.sub,
        to_users: listCallParticipants(id).map((p) => p.user_id).filter((u) => u !== payload.sub),
      });
      return reply.send({ success: true, data: { call, signal } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /calls/:id/recording/stop
  app.post('/calls/:id/recording/stop', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = StopRecordingSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const recording = stopRecording(id, payload.sub, {
        storage_url: parsed.data.storage_url,
        file_size_bytes: parsed.data.file_size_bytes ?? null,
      });
      const signal = buildCallSignal({
        type: 'call.recording.stopped', call_id: id, from_user: payload.sub,
        to_users: listCallParticipants(id).map((p) => p.user_id).filter((u) => u !== payload.sub),
        payload: { recording_id: recording.id },
      });
      return reply.code(201).send({ success: true, data: { recording, signal } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /calls/:id/recordings
  app.get('/calls/:id/recordings', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const p = getCallParticipant(id, payload.sub);
    if (!p) return reply.code(403).send({ success: false, error: 'Not a participant' });
    return reply.send({ success: true, data: { recordings: listCallRecordings(id) } });
  });

  // ============================================================
  // 146.7 — Call History
  // ============================================================

  // GET /calls/history?limit=&offset=&only_missed=true
  app.get('/calls/history', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { limit?: string; offset?: string; only_missed?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    const offset = q.offset ? Math.max(parseInt(q.offset) || 0, 0) : 0;
    const items = listCallHistory(payload.sub, { limit, offset, only_missed: q.only_missed === 'true' });
    return reply.send({ success: true, data: { items } });
  });

  // GET /calls/missed-count?since=
  app.get('/calls/missed-count', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { since?: string };
    return reply.send({ success: true, data: { count: getMissedCallCount(payload.sub, q.since) } });
  });

  // ============================================================
  // 146.8 — DND & Block
  // ============================================================

  // POST /calls/block
  app.post('/calls/block', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = BlockSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const block = blockUserFromCalls(payload.sub, parsed.data.user_id, parsed.data.reason ?? null);
      return reply.code(201).send({ success: true, data: block });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /calls/block/:userId
  app.delete('/calls/block/:userId', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { userId } = req.params as { userId: string };
    const ok = unblockUserFromCalls(payload.sub, userId);
    if (!ok) return reply.code(404).send({ success: false, error: 'Not blocked' });
    return reply.send({ success: true, data: { unblocked: true } });
  });

  // GET /calls/block
  app.get('/calls/block', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: { blocks: listCallBlocks(payload.sub) } });
  });

  // PUT /calls/dnd
  app.put('/calls/dnd', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = DndSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const dnd = setDnd(payload.sub, parsed.data);
    return reply.send({ success: true, data: dnd });
  });

  // GET /calls/dnd
  app.get('/calls/dnd', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const dnd = getDnd(payload.sub) ?? { user_id: payload.sub, is_enabled: 0, scope: 'nobody', allow_from: null, updated_at: '' };
    return reply.send({ success: true, data: dnd });
  });

  // GET /calls/can-ring/:userId
  app.get('/calls/can-ring/:userId', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { userId } = req.params as { userId: string };
    const result = canRingUser(userId, payload.sub);
    return reply.send({ success: true, data: result });
  });

  // GET /calls/blocked-by/:userId — did they block me?
  app.get('/calls/blocked-by/:userId', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { userId } = req.params as { userId: string };
    const blocked = isBlocked(payload.sub, userId);
    return reply.send({ success: true, data: { blocked } });
  });
}
