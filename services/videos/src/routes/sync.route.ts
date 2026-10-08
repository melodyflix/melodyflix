// melodyflix videos — Cross-Platform Sync routes (Section 34)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '@melodyflix/shared-auth';
import {
  registerDevice, getDevice, listDevices, touchDevice, deactivateDevice,
  pushChange, pushBatch, pullChanges,
  pushWatchProgress, getLatestWatchProgress,
  pushPlaylistSnapshot, pushSettings, getLatestSettings,
  getSyncSummary,
} from '../services/sync.service.js';

function userId(req: any): string | null {
  return req.user?.id ?? req.user?.sub ?? null;
}

const ScopeEnum = z.enum(['watch_progress','playlist','settings','favorites','history']);

export async function syncRoutes(app: FastifyInstance) {
  // ---- Devices ----

  const DeviceSchema = z.object({
    device_label: z.string().min(1).max(80),
    device_type: z.string().max(40).nullable().optional(),
    platform: z.string().max(40).nullable().optional(),
    app_version: z.string().max(40).nullable().optional(),
    device_id: z.string().nullable().optional(),
  });

  app.get('/sync/devices', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const devices = listDevices(me);
    return reply.send({ success: true, data: { devices, count: devices.length } });
  });

  app.post('/sync/devices', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = DeviceSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const device = registerDevice({ user_id: me, ...parsed.data });
      return reply.code(201).send({ success: true, data: { device } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Register failed' });
    }
  });

  app.get('/sync/devices/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const d = getDevice(id);
    if (!d) return reply.code(404).send({ success: false, error: 'Not found' });
    if (d.user_id !== me) return reply.code(403).send({ success: false, error: 'Not your device' });
    return reply.send({ success: true, data: { device: d } });
  });

  app.post('/sync/devices/:id/heartbeat', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const d = getDevice(id);
    if (!d || d.user_id !== me) return reply.code(404).send({ success: false, error: 'Not found' });
    const body = req.body as { cursor?: number } | null;
    touchDevice(id, body?.cursor);
    return reply.send({ success: true, data: { device: getDevice(id) } });
  });

  app.delete('/sync/devices/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const ok = deactivateDevice(id, me);
    return reply.send({ success: true, data: { deactivated: ok } });
  });

  // ---- Change log: push ----

  const PushSchema = z.object({
    scope: ScopeEnum,
    key: z.string().min(1).max(200),
    value: z.any(),
    device_id: z.string().nullable().optional(),
  });

  app.post('/sync/push', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = PushSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const change = pushChange({ user_id: me, ...parsed.data });
      return reply.code(201).send({ success: true, data: { change } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Push failed' });
    }
  });

  const BatchSchema = z.object({
    device_id: z.string().nullable().optional(),
    changes: z.array(z.object({
      scope: ScopeEnum,
      key: z.string().min(1).max(200),
      value: z.any(),
      deleted: z.boolean().optional(),
    })).min(1).max(500),
  });

  app.post('/sync/push/batch', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = BatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const result = pushBatch({ user_id: me, ...parsed.data });
    return reply.code(201).send({ success: true, data: result });
  });

  // ---- Change log: pull ----

  app.get('/sync/pull', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const q = req.query as { since?: string; scopes?: string; limit?: string; device_id?: string };
    const scopes = q.scopes ? q.scopes.split(',').filter((s): s is any => ['watch_progress','playlist','settings','favorites','history'].includes(s)) : undefined;
    const result = pullChanges({
      user_id: me,
      since_cursor: q.since ? parseInt(q.since) : 0,
      scopes,
      limit: q.limit ? parseInt(q.limit) : 200,
      device_id: q.device_id ?? null,
    });
    return reply.send({ success: true, data: result });
  });

  // ---- Shortcuts ----

  const ProgressSchema = z.object({
    video_id: z.string().min(1),
    position_seconds: z.number().min(0).max(24 * 3600),
    duration_seconds: z.number().min(0).max(24 * 3600).optional(),
    device_id: z.string().nullable().optional(),
  });

  app.post('/sync/watch-progress', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = ProgressSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const change = pushWatchProgress({ user_id: me, ...parsed.data });
    return reply.code(201).send({ success: true, data: { change } });
  });

  app.get('/sync/watch-progress/:videoId', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { videoId } = req.params as { videoId: string };
    const progress = getLatestWatchProgress(me, videoId);
    return reply.send({ success: true, data: { progress } });
  });

  const PlaylistSchema = z.object({
    playlist_id: z.string().min(1),
    value: z.any(),
    device_id: z.string().nullable().optional(),
  });

  app.post('/sync/playlists', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = PlaylistSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const change = pushPlaylistSnapshot({ user_id: me, ...parsed.data });
    return reply.code(201).send({ success: true, data: { change } });
  });

  const SettingsSchema = z.object({
    settings: z.any(),
    device_id: z.string().nullable().optional(),
  });

  app.post('/sync/settings', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = SettingsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const change = pushSettings({ user_id: me, ...parsed.data });
    return reply.code(201).send({ success: true, data: { change } });
  });

  app.get('/sync/settings', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const settings = getLatestSettings(me);
    return reply.send({ success: true, data: { settings } });
  });

  // ---- Summary ----

  app.get('/sync/summary', { preHandler: [authGuard] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    return reply.send({ success: true, data: getSyncSummary(me) });
  });
}
