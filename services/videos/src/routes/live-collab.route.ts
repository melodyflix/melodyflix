// melodyflix videos — Live Collaboration routes (Section 150)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, verifyJwt, extractBearerToken } from '@melodyflix/shared-auth';
import {
  createCollabRoom, getCollabRoom, getCollabRoomBySlug, listUserCollabRooms,
  startCollabRoom, endCollabRoom, setRoomRecording,
  listCollabParticipants, getCollabParticipant, addCollabParticipant,
  joinCollabRoom, leaveCollabRoom, updateCollabParticipant, removeCollabParticipant,
  createGuestInvite, getGuestInvite, listRoomInvites, redeemGuestInvite, revokeGuestInvite,
  createScene, getScene, listRoomScenes, updateScene, activateScene, getActiveScene, deleteScene,
  addWhiteboardStroke, getWhiteboardStroke, listWhiteboardStrokes,
  deleteWhiteboardStroke, clearWhiteboard,
  sendProductionMessage, listProductionChat, pinProductionMessage,
  listPinnedProduction, deleteProductionMessage,
  getPresenterLayout, assignPresenterSlot,
  buildCollabEvent,
} from '../services/live-collab.service.js';

const ROLES = ['host', 'cohost', 'guest', 'viewer'] as const;
const SCENE_LAYOUTS = ['grid', 'spotlight', 'side-by-side', 'pip', 'custom'] as const;
const SOURCE_KINDS = ['camera', 'screen', 'video', 'image', 'text'] as const;
const WB_TOOLS = ['pen', 'line', 'rect', 'ellipse', 'text', 'eraser'] as const;

const CreateRoomSchema = z.object({
  title: z.string().min(3).max(200),
  slug: z.string().min(2).max(80).optional(),
  metadata: z.record(z.string(), z.any()).nullable().optional(),
});

const StartRoomSchema = z.object({
  room_url: z.string().url().max(500).optional(),
});

const RecordingSchema = z.object({
  recording: z.boolean(),
});

const AddParticipantSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(ROLES).optional(),
  display_name: z.string().max(100).nullable().optional(),
  stream_slot: z.number().int().min(0).max(100).nullable().optional(),
});

const UpdateParticipantSchema = z.object({
  role: z.enum(ROLES).optional(),
  display_name: z.string().max(100).nullable().optional(),
  stream_slot: z.number().int().min(0).max(100).nullable().optional(),
  is_muted: z.boolean().optional(),
  is_video_on: z.boolean().optional(),
  is_screen_sharing: z.boolean().optional(),
  state: z.enum(['invited', 'joined', 'left', 'removed']).optional(),
});

const CreateInviteSchema = z.object({
  role: z.enum(ROLES).optional(),
  invited_email: z.string().email().max(200).nullable().optional(),
  invited_name: z.string().max(100).nullable().optional(),
  expires_in_days: z.number().int().min(1).max(30).optional(),
});

const RedeemInviteSchema = z.object({
  token: z.string().min(4).max(100),
});

const CreateSceneSchema = z.object({
  name: z.string().min(1).max(80),
  layout: z.enum(SCENE_LAYOUTS).optional(),
  sources: z.array(z.object({
    slot: z.number().int().min(0).max(50),
    kind: z.enum(SOURCE_KINDS),
    user_id: z.string().uuid().nullable().optional(),
    label: z.string().max(200).nullable().optional(),
    url: z.string().max(500).nullable().optional(),
    position: z.object({
      x: z.number(), y: z.number(), w: z.number(), h: z.number(),
    }),
  })).max(50).optional(),
  position: z.number().int().min(0).max(1000).optional(),
});

const UpdateSceneSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  layout: z.enum(SCENE_LAYOUTS).optional(),
  sources: z.array(z.object({
    slot: z.number().int().min(0).max(50),
    kind: z.enum(SOURCE_KINDS),
    user_id: z.string().uuid().nullable().optional(),
    label: z.string().max(200).nullable().optional(),
    url: z.string().max(500).nullable().optional(),
    position: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  })).max(50).optional(),
  position: z.number().int().min(0).max(1000).optional(),
});

const StrokeSchema = z.object({
  tool: z.enum(WB_TOOLS),
  points: z.array(z.object({ x: z.number(), y: z.number() })).max(5000),
  color: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
  width: z.number().min(0.5).max(50).optional(),
  text_content: z.string().max(500).nullable().optional(),
});

const ChatSchema = z.object({
  body: z.string().min(1).max(2000),
  mentions: z.array(z.string().uuid()).max(30).optional(),
});

const PinSchema = z.object({
  pinned: z.boolean(),
});

const SlotSchema = z.object({
  slot: z.number().int().min(0).max(100),
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

export async function liveCollabRoutes(app: FastifyInstance) {
  // ============================================================
  // Rooms
  // ============================================================

  // POST /collab/rooms
  app.post('/collab/rooms', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = CreateRoomSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const room = createCollabRoom({ ...parsed.data, host_id: payload.sub });
      return reply.code(201).send({ success: true, data: room });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /collab/rooms — my rooms
  app.get('/collab/rooms', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    return reply.send({ success: true, data: { rooms: listUserCollabRooms(payload.sub, limit) } });
  });

  // GET /collab/rooms/slug/:slug
  app.get('/collab/rooms/slug/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const room = getCollabRoomBySlug(slug);
    if (!room) return reply.code(404).send({ success: false, error: 'Room not found' });
    return reply.send({ success: true, data: room });
  });

  // GET /collab/rooms/:id
  app.get('/collab/rooms/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const room = getCollabRoom(id);
    if (!room) return reply.code(404).send({ success: false, error: 'Room not found' });
    return reply.send({ success: true, data: room });
  });

  // POST /collab/rooms/:id/start
  app.post('/collab/rooms/:id/start', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = StartRoomSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const room = startCollabRoom(id, payload.sub, parsed.data.room_url);
      const event = buildCollabEvent({
        type: 'room.started', room_id: id, from_user: payload.sub,
        to_users: listCollabParticipants(id).map((p) => p.user_id),
        payload: { room_url: room.room_url },
      });
      return reply.send({ success: true, data: { room, event } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /collab/rooms/:id/end
  app.post('/collab/rooms/:id/end', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      const room = endCollabRoom(id, payload.sub);
      const event = buildCollabEvent({
        type: 'room.ended', room_id: id, from_user: payload.sub,
        to_users: listCollabParticipants(id).map((p) => p.user_id),
      });
      return reply.send({ success: true, data: { room, event } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /collab/rooms/:id/recording
  app.post('/collab/rooms/:id/recording', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = RecordingSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const room = setRoomRecording(id, payload.sub, parsed.data.recording);
      const event = buildCollabEvent({
        type: 'room.recording.toggled', room_id: id, from_user: payload.sub,
        to_users: listCollabParticipants(id).map((p) => p.user_id),
        payload: { recording: parsed.data.recording },
      });
      return reply.send({ success: true, data: { room, event } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // Participants
  // ============================================================

  // GET /collab/rooms/:id/participants
  app.get('/collab/rooms/:id/participants', async (req, reply) => {
    const { id } = req.params as { id: string };
    const room = getCollabRoom(id);
    if (!room) return reply.code(404).send({ success: false, error: 'Room not found' });
    return reply.send({ success: true, data: { participants: listCollabParticipants(id) } });
  });

  // POST /collab/rooms/:id/participants
  app.post('/collab/rooms/:id/participants', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = AddParticipantSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const p = addCollabParticipant({ room_id: id, invited_by: payload.sub, ...parsed.data });
      const event = buildCollabEvent({
        type: 'participant.joined', room_id: id, from_user: payload.sub,
        to_users: [parsed.data.user_id], payload: { role: p.role },
      });
      return reply.code(201).send({ success: true, data: { participant: p, event } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /collab/rooms/:id/join
  app.post('/collab/rooms/:id/join', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      const p = joinCollabRoom(id, payload.sub);
      const event = buildCollabEvent({
        type: 'participant.joined', room_id: id, from_user: payload.sub,
        to_users: listCollabParticipants(id).map((pp) => pp.user_id).filter((u) => u !== payload.sub),
      });
      return reply.send({ success: true, data: { participant: p, event } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /collab/rooms/:id/leave
  app.post('/collab/rooms/:id/leave', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      const p = leaveCollabRoom(id, payload.sub);
      const event = buildCollabEvent({
        type: 'participant.left', room_id: id, from_user: payload.sub,
        to_users: listCollabParticipants(id).map((pp) => pp.user_id),
      });
      return reply.send({ success: true, data: { participant: p, event } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // PATCH /collab/rooms/:id/participants/:userId
  app.patch('/collab/rooms/:id/participants/:userId', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = UpdateParticipantSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id, userId } = req.params as { id: string; userId: string };
    try {
      const p = updateCollabParticipant(id, payload.sub, userId, parsed.data);
      const event = buildCollabEvent({
        type: 'participant.updated', room_id: id, from_user: payload.sub,
        to_users: listCollabParticipants(id).map((pp) => pp.user_id),
        payload: { user_id: userId, patch: parsed.data },
      });
      return reply.send({ success: true, data: { participant: p, event } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /collab/rooms/:id/participants/:userId
  app.delete('/collab/rooms/:id/participants/:userId', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id, userId } = req.params as { id: string; userId: string };
    try {
      const ok = removeCollabParticipant(id, payload.sub, userId);
      if (!ok) return reply.code(404).send({ success: false, error: 'Participant not found' });
      const event = buildCollabEvent({
        type: 'participant.removed', room_id: id, from_user: payload.sub,
        to_users: [userId, ...listCollabParticipants(id).map((p) => p.user_id)],
      });
      return reply.send({ success: true, data: { removed: true, event } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // 150.3 — Guest invites
  // ============================================================

  // POST /collab/rooms/:id/invites
  app.post('/collab/rooms/:id/invites', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = CreateInviteSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const result = createGuestInvite({ room_id: id, created_by: payload.sub, ...parsed.data });
      const event = buildCollabEvent({
        type: 'guest.invited', room_id: id, from_user: payload.sub,
        payload: { invite_id: result.invite.id, role: result.invite.role },
      });
      return reply.code(201).send({ success: true, data: { ...result, event } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /collab/rooms/:id/invites
  app.get('/collab/rooms/:id/invites', async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: { invites: listRoomInvites(id) } });
  });

  // POST /collab/invites/redeem
  app.post('/collab/invites/redeem', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = RedeemInviteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const result = redeemGuestInvite(parsed.data.token, payload.sub);
      const event = buildCollabEvent({
        type: 'guest.redeemed', room_id: result.invite.room_id, from_user: payload.sub,
        payload: { invite_id: result.invite.id },
      });
      return reply.send({ success: true, data: { ...result, event } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /collab/invites/:id
  app.delete('/collab/invites/:id', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      const ok = revokeGuestInvite(id, payload.sub);
      if (!ok) return reply.code(404).send({ success: false, error: 'Invite not found' });
      return reply.send({ success: true, data: { revoked: true } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // 150.4 — Scenes
  // ============================================================

  // POST /collab/rooms/:id/scenes
  app.post('/collab/rooms/:id/scenes', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = CreateSceneSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const scene = createScene({ room_id: id, created_by: payload.sub, ...parsed.data });
      const event = buildCollabEvent({
        type: 'scene.created', room_id: id, from_user: payload.sub,
        to_users: listCollabParticipants(id).map((p) => p.user_id),
        payload: { scene_id: scene.id },
      });
      return reply.code(201).send({ success: true, data: { scene, event } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /collab/rooms/:id/scenes
  app.get('/collab/rooms/:id/scenes', async (req, reply) => {
    const { id } = req.params as { id: string };
    const scenes = listRoomScenes(id);
    const active = getActiveScene(id);
    return reply.send({ success: true, data: { scenes, active_scene_id: active?.id ?? null } });
  });

  // PATCH /collab/scenes/:id
  app.patch('/collab/scenes/:id', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = UpdateSceneSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const scene = updateScene(id, payload.sub, parsed.data);
      const event = buildCollabEvent({
        type: 'scene.updated', room_id: scene.room_id, from_user: payload.sub,
        to_users: listCollabParticipants(scene.room_id).map((p) => p.user_id),
        payload: { scene_id: id },
      });
      return reply.send({ success: true, data: { scene, event } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /collab/scenes/:id/activate
  app.post('/collab/scenes/:id/activate', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      const scene = activateScene(id, payload.sub);
      const event = buildCollabEvent({
        type: 'scene.activated', room_id: scene.room_id, from_user: payload.sub,
        to_users: listCollabParticipants(scene.room_id).map((p) => p.user_id),
        payload: { scene_id: id },
      });
      return reply.send({ success: true, data: { scene, event } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /collab/scenes/:id
  app.delete('/collab/scenes/:id', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      const scene = getScene(id);
      if (!scene) return reply.code(404).send({ success: false, error: 'Scene not found' });
      const ok = deleteScene(id, payload.sub);
      const event = buildCollabEvent({
        type: 'scene.deleted', room_id: scene.room_id, from_user: payload.sub,
        to_users: listCollabParticipants(scene.room_id).map((p) => p.user_id),
        payload: { scene_id: id },
      });
      return reply.send({ success: true, data: { deleted: ok, event } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // 150.2 — Whiteboard
  // ============================================================

  // POST /collab/rooms/:id/whiteboard/strokes
  app.post('/collab/rooms/:id/whiteboard/strokes', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = StrokeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const stroke = addWhiteboardStroke({
        room_id: id, user_id: payload.sub,
        tool: parsed.data.tool, points: parsed.data.points,
        color: parsed.data.color, width: parsed.data.width,
        text_content: parsed.data.text_content ?? null,
      });
      const event = buildCollabEvent({
        type: 'whiteboard.stroke', room_id: id, from_user: payload.sub,
        to_users: listCollabParticipants(id).map((p) => p.user_id).filter((u) => u !== payload.sub),
        payload: { stroke_id: stroke.id, sequence: stroke.sequence },
      });
      return reply.code(201).send({ success: true, data: { stroke, event } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /collab/rooms/:id/whiteboard/strokes?since_sequence=&include_deleted=&limit=
  app.get('/collab/rooms/:id/whiteboard/strokes', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { since_sequence?: string; include_deleted?: string; limit?: string };
    const strokes = listWhiteboardStrokes(id, {
      since_sequence: q.since_sequence ? parseInt(q.since_sequence) : undefined,
      include_deleted: q.include_deleted === 'true',
      limit: q.limit ? parseInt(q.limit) : undefined,
    });
    return reply.send({ success: true, data: { strokes } });
  });

  // DELETE /collab/whiteboard/strokes/:id
  app.delete('/collab/whiteboard/strokes/:id', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      const ok = deleteWhiteboardStroke(id, payload.sub);
      if (!ok) return reply.code(404).send({ success: false, error: 'Stroke not found' });
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /collab/rooms/:id/whiteboard/clear
  app.post('/collab/rooms/:id/whiteboard/clear', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      const cleared = clearWhiteboard(id, payload.sub);
      const event = buildCollabEvent({
        type: 'whiteboard.cleared', room_id: id, from_user: payload.sub,
        to_users: listCollabParticipants(id).map((p) => p.user_id),
      });
      return reply.send({ success: true, data: { cleared, event } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // 150.5 — Production Chat
  // ============================================================

  // POST /collab/rooms/:id/chat
  app.post('/collab/rooms/:id/chat', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = ChatSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const message = sendProductionMessage({
        room_id: id, user_id: payload.sub,
        body: parsed.data.body, mentions: parsed.data.mentions,
      });
      const event = buildCollabEvent({
        type: 'chat.message', room_id: id, from_user: payload.sub,
        to_users: listCollabParticipants(id).map((p) => p.user_id).filter((u) => u !== payload.sub),
        payload: { message_id: message.id },
      });
      return reply.code(201).send({ success: true, data: { message, event } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /collab/rooms/:id/chat
  app.get('/collab/rooms/:id/chat', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 100, 1), 500) : 100;
    const messages = listProductionChat(id, limit);
    const pinned = listPinnedProduction(id);
    return reply.send({ success: true, data: { messages, pinned } });
  });

  // POST /collab/chat/:id/pin
  app.post('/collab/chat/:id/pin', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = PinSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const message = pinProductionMessage(id, payload.sub, parsed.data.pinned);
      if (!message) return reply.code(404).send({ success: false, error: 'Message not found' });
      const event = buildCollabEvent({
        type: 'chat.pinned', room_id: message.room_id, from_user: payload.sub,
        to_users: listCollabParticipants(message.room_id).map((p) => p.user_id),
        payload: { message_id: id, pinned: parsed.data.pinned },
      });
      return reply.send({ success: true, data: { message, event } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /collab/chat/:id
  app.delete('/collab/chat/:id', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      const ok = deleteProductionMessage(id, payload.sub);
      if (!ok) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // 150.6 — Multi-Presenter Layout
  // ============================================================

  // GET /collab/rooms/:id/layout
  app.get('/collab/rooms/:id/layout', async (req, reply) => {
    const { id } = req.params as { id: string };
    const room = getCollabRoom(id);
    if (!room) return reply.code(404).send({ success: false, error: 'Room not found' });
    return reply.send({ success: true, data: getPresenterLayout(id) });
  });

  // POST /collab/rooms/:id/participants/:userId/slot
  app.post('/collab/rooms/:id/participants/:userId/slot', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = SlotSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id, userId } = req.params as { id: string; userId: string };
    try {
      const p = assignPresenterSlot(id, payload.sub, userId, parsed.data.slot);
      const event = buildCollabEvent({
        type: 'participant.updated', room_id: id, from_user: payload.sub,
        to_users: listCollabParticipants(id).map((pp) => pp.user_id),
        payload: { user_id: userId, stream_slot: parsed.data.slot },
      });
      return reply.send({ success: true, data: { participant: p, event } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });
}
