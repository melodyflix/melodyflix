// melodyflix live — Multi-Camera + Emergency Backup routes (7.5, 7.10)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '@melodyflix/shared-auth';
import { getStreamById } from '../services/live.service.js';
import {
  createCamera, getCamera, listCameras, getPrimaryCamera,
  updateCamera, deleteCamera, reorderCameras, switchToCamera,
  getBackupConfig, setBackupConfig, recordBackupEvent, listBackupEvents,
  cameraHeartbeat, listCameraHealth, performAutoFailover,
  getStreamingSummary,
} from '../services/multicam.service.js';

function userId(req: any): string | null {
  return req.user?.id ?? req.user?.sub ?? null;
}

function isOwner(streamId: string, uid: string): boolean {
  const s = getStreamById(streamId);
  return !!s && s.user_id === uid;
}

export async function multicamRoutes(app: FastifyInstance) {
  // ---- Cameras ----

  const CameraCreateSchema = z.object({
    label: z.string().min(1).max(60),
    role: z.enum(['primary', 'secondary', 'backup']).optional(),
    sort_order: z.number().int().min(0).max(100).optional(),
  });

  const CameraUpdateSchema = z.object({
    label: z.string().min(1).max(60).optional(),
    role: z.enum(['primary', 'secondary', 'backup']).optional(),
    is_active: z.boolean().optional(),
    is_muted: z.boolean().optional(),
    sort_order: z.number().int().min(0).max(100).optional(),
    bitrate_kbps: z.number().int().min(0).max(200_000).nullable().optional(),
  });

  // GET /streams/:id/cameras
  app.get('/streams/:id/cameras', async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = getStreamById(id);
    if (!s) return reply.code(404).send({ success: false, error: 'Stream not found' });
    const cameras = listCameras(id).map((c) => ({
      ...c,
      // Do not expose ingest keys on public list (owner check via query)
      ingest_key: undefined,
    }));
    return reply.send({ success: true, data: { cameras, count: cameras.length } });
  });

  // GET /streams/:id/cameras/mine — with ingest keys (owner only)
  app.get('/streams/:id/cameras/mine', { preHandler: [authGuard] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    if (!isOwner(id, uid)) return reply.code(403).send({ success: false, error: 'Owner only' });
    return reply.send({ success: true, data: { cameras: listCameras(id) } });
  });

  // POST /streams/:id/cameras
  app.post('/streams/:id/cameras', { preHandler: [authGuard] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    if (!isOwner(id, uid)) return reply.code(403).send({ success: false, error: 'Owner only' });
    const parsed = CameraCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const cam = createCamera({
        streamId: id,
        label: parsed.data.label,
        role: parsed.data.role,
        sortOrder: parsed.data.sort_order,
      });
      return reply.code(201).send({ success: true, data: { camera: cam } });
    } catch (e: any) {
      const msg = e?.message ?? 'Create failed';
      if (msg.startsWith('Max')) return reply.code(409).send({ success: false, error: msg });
      return reply.code(400).send({ success: false, error: msg });
    }
  });

  // PATCH /streams/:id/cameras/:camId
  app.patch('/streams/:id/cameras/:camId', { preHandler: [authGuard] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id, camId } = req.params as { id: string; camId: string };
    if (!isOwner(id, uid)) return reply.code(403).send({ success: false, error: 'Owner only' });
    const parsed = CameraUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const cam = updateCamera(id, camId, parsed.data);
      if (!cam) return reply.code(404).send({ success: false, error: 'Camera not found' });
      return reply.send({ success: true, data: { camera: cam } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Update failed' });
    }
  });

  // DELETE /streams/:id/cameras/:camId
  app.delete('/streams/:id/cameras/:camId', { preHandler: [authGuard] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id, camId } = req.params as { id: string; camId: string };
    if (!isOwner(id, uid)) return reply.code(403).send({ success: false, error: 'Owner only' });
    try {
      const removed = deleteCamera(id, camId);
      return reply.send({ success: true, data: { removed } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Delete failed' });
    }
  });

  // POST /streams/:id/cameras/switch — promote a camera to primary
  const SwitchSchema = z.object({
    camera_id: z.string().min(1),
    reason: z.string().max(200).optional(),
  });

  app.post('/streams/:id/cameras/switch', { preHandler: [authGuard] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    if (!isOwner(id, uid)) return reply.code(403).send({ success: false, error: 'Owner only' });
    const parsed = SwitchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const cam = switchToCamera(id, parsed.data.camera_id, parsed.data.reason ?? 'manual');
    if (!cam) return reply.code(404).send({ success: false, error: 'Camera not found' });
    return reply.send({ success: true, data: { camera: cam } });
  });

  // POST /streams/:id/cameras/reorder
  const ReorderSchema = z.object({
    ordered_ids: z.array(z.string().min(1)).min(1).max(20),
  });

  app.post('/streams/:id/cameras/reorder', { preHandler: [authGuard] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    if (!isOwner(id, uid)) return reply.code(403).send({ success: false, error: 'Owner only' });
    const parsed = ReorderSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const cameras = reorderCameras(id, parsed.data.ordered_ids);
    return reply.send({ success: true, data: { cameras } });
  });

  // ---- Heartbeat (called by ingest per camera) ----

  const HeartbeatSchema = z.object({
    camera_id: z.string().min(1),
    bitrate_kbps: z.number().int().min(0).max(200_000).optional(),
  });

  app.post('/streams/:id/cameras/heartbeat', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = HeartbeatSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const cam = cameraHeartbeat(id, parsed.data.camera_id, parsed.data.bitrate_kbps);
    if (!cam) return reply.code(404).send({ success: false, error: 'Camera not found' });
    return reply.send({ success: true, data: { camera: cam } });
  });

  // ---- Camera health ----

  app.get('/streams/:id/cameras/health', async (req, reply) => {
    const { id } = req.params as { id: string };
    const health = listCameraHealth(id);
    return reply.send({ success: true, data: { health } });
  });

  // ---- Backup config ----

  const BackupConfigSchema = z.object({
    enabled: z.boolean().optional(),
    health_timeout_seconds: z.number().int().min(5).max(300).optional(),
    fallback_slate_url: z.string().url().nullable().optional(),
    auto_switch_to_backup: z.boolean().optional(),
    switch_back_when_healthy: z.boolean().optional(),
    notify_webhook_url: z.string().url().nullable().optional(),
  });

  app.get('/streams/:id/backup-config', async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: { config: getBackupConfig(id) } });
  });

  app.put('/streams/:id/backup-config', { preHandler: [authGuard] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    if (!isOwner(id, uid)) return reply.code(403).send({ success: false, error: 'Owner only' });
    const parsed = BackupConfigSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const config = setBackupConfig(id, parsed.data);
    return reply.send({ success: true, data: { config } });
  });

  // ---- Backup events ----

  app.get('/streams/:id/backup-events', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string };
    const events = listBackupEvents(id, q.limit ? parseInt(q.limit) : 50);
    return reply.send({ success: true, data: { events, count: events.length } });
  });

  // ---- Manual failover trigger (for debugging / admin) ----

  app.post('/streams/:id/failover', { preHandler: [authGuard] }, async (req, reply) => {
    const uid = userId(req as any);
    if (!uid) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    if (!isOwner(id, uid)) return reply.code(403).send({ success: false, error: 'Owner only' });
    const result = performAutoFailover(id);
    return reply.send({ success: true, data: result });
  });

  // ---- Summary ----

  app.get('/streams/:id/streaming-summary', async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: getStreamingSummary(id) });
  });
}
