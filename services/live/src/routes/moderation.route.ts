// melodyflix live — moderation routes (7.8 Slow Mode, 7.9 Live Moderator)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import { getStreamById } from '../services/live.service.js';
import {
  getChatSettings, setChatSettings,
  checkSlowMode, recordChatPost,
  isModerator, addModerator, removeModerator, listModerators,
  muteUser, unmuteUser, listMutes, checkMute,
  banUser, unbanUser, isBanned, listBans,
  checkChatPermission,
} from '../services/moderation.service.js';

function userId(req: any): string | null {
  return req.user?.id ?? req.user?.sub ?? null;
}

function isOwner(streamId: string, uid: string): boolean {
  const s = getStreamById(streamId);
  return !!s && s.user_id === uid;
}

function canModerate(streamId: string, uid: string): boolean {
  return isOwner(streamId, uid) || isModerator(streamId, uid);
}

export async function moderationRoutes(app: FastifyInstance) {
  // ---- 7.8 Chat Settings / Slow Mode ----

  const SlowModeSchema = z.object({
    slow_mode_seconds: z.number().int().min(0).max(600),
    subscriber_bypass: z.boolean().optional(),
    followers_only: z.boolean().optional(),
  });

  app.get('/streams/:id/chat-settings', async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = getStreamById(id);
    if (!s) return reply.code(404).send({ success: false, error: 'Stream not found' });
    return reply.send({ success: true, data: { settings: getChatSettings(id) } });
  });

  app.put('/streams/:id/chat-settings', { preHandler: [requireAuth] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    if (!isOwner(id, uid)) return reply.code(403).send({ success: false, error: 'Not your stream' });
    const parsed = SlowModeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const settings = setChatSettings(id, parsed.data);
    return reply.send({ success: true, data: { settings } });
  });

  // Pre-post permission check (lightweight)
  app.get('/streams/:id/chat-permission', { preHandler: [requireAuth] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const q = req.query as { subscriber?: string; follower?: string };
    const perm = checkChatPermission({
      streamId: id,
      userId: uid,
      isSubscriber: q.subscriber === 'true',
      isFollowing: q.follower === 'true',
    });
    return reply.send({ success: true, data: perm });
  });

  // ---- 7.9 Moderators ----

  const ModSchema = z.object({ user_id: z.string().min(1) });

  app.get('/streams/:id/moderators', async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: { moderators: listModerators(id) } });
  });

  app.post('/streams/:id/moderators', { preHandler: [requireAuth] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    if (!isOwner(id, uid)) return reply.code(403).send({ success: false, error: 'Owner only' });
    const parsed = ModSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const mod = addModerator(id, uid, parsed.data.user_id);
      return reply.code(201).send({ success: true, data: { moderator: mod } });
    } catch (e: any) {
      const msg = e?.message ?? 'Add failed';
      if (msg.includes('Already')) return reply.code(409).send({ success: false, error: msg });
      return reply.code(400).send({ success: false, error: msg });
    }
  });

  app.delete('/streams/:id/moderators/:userId', { preHandler: [requireAuth] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id, userId: target } = req.params as { id: string; userId: string };
    if (!isOwner(id, uid)) return reply.code(403).send({ success: false, error: 'Owner only' });
    const removed = removeModerator(id, uid, target);
    return reply.send({ success: true, data: { removed } });
  });

  // ---- Mutes ----

  const MuteSchema = z.object({
    user_id: z.string().min(1),
    duration_seconds: z.number().int().min(0).max(30 * 24 * 3600).nullable().optional(),
    reason: z.string().max(200).nullable().optional(),
  });

  app.get('/streams/:id/mutes', { preHandler: [requireAuth] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    if (!canModerate(id, uid)) return reply.code(403).send({ success: false, error: 'Moderator only' });
    return reply.send({ success: true, data: { mutes: listMutes(id) } });
  });

  app.post('/streams/:id/mutes', { preHandler: [requireAuth] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    if (!canModerate(id, uid)) return reply.code(403).send({ success: false, error: 'Moderator only' });
    const parsed = MuteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const mute = muteUser({
      streamId: id, moderatorId: uid, targetUserId: parsed.data.user_id,
      durationSeconds: parsed.data.duration_seconds ?? null,
      reason: parsed.data.reason ?? null,
    });
    return reply.code(201).send({ success: true, data: { mute } });
  });

  app.delete('/streams/:id/mutes/:userId', { preHandler: [requireAuth] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id, userId: target } = req.params as { id: string; userId: string };
    if (!canModerate(id, uid)) return reply.code(403).send({ success: false, error: 'Moderator only' });
    const removed = unmuteUser(id, target);
    return reply.send({ success: true, data: { removed } });
  });

  app.get('/streams/:id/mutes/:userId', async (req, reply) => {
    const { id, userId: target } = req.params as { id: string; userId: string };
    return reply.send({ success: true, data: checkMute(id, target) });
  });

  // ---- Bans ----

  const BanSchema = z.object({
    user_id: z.string().min(1),
    reason: z.string().max(200).nullable().optional(),
  });

  app.get('/streams/:id/bans', { preHandler: [requireAuth] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    if (!canModerate(id, uid)) return reply.code(403).send({ success: false, error: 'Moderator only' });
    return reply.send({ success: true, data: { bans: listBans(id) } });
  });

  app.post('/streams/:id/bans', { preHandler: [requireAuth] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    if (!canModerate(id, uid)) return reply.code(403).send({ success: false, error: 'Moderator only' });
    const parsed = BanSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const ban = banUser({
      streamId: id, moderatorId: uid, targetUserId: parsed.data.user_id,
      reason: parsed.data.reason ?? null,
    });
    return reply.code(201).send({ success: true, data: { ban } });
  });

  app.delete('/streams/:id/bans/:userId', { preHandler: [requireAuth] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id, userId: target } = req.params as { id: string; userId: string };
    if (!canModerate(id, uid)) return reply.code(403).send({ success: false, error: 'Moderator only' });
    const removed = unbanUser(id, target);
    return reply.send({ success: true, data: { removed } });
  });

  // ---- Public ban check ----

  app.get('/streams/:id/bans/:userId/status', async (req, reply) => {
    const { id, userId: target } = req.params as { id: string; userId: string };
    return reply.send({ success: true, data: { banned: isBanned(id, target) } });
  });
}
