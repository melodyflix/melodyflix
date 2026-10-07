// melodyflix videos - Section 12.5 Smart TV Support routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  registerDevice, getDevice, heartbeat, listDevices, deleteDevice,
  upsertLayout, listLayouts, getDefaultLayout, getLayoutById, deleteLayout,
  upsertCompat, listCompat, deleteCompat, checkCompatibility, getSmartTvStats,
} from '../services/smart-tv.service.js';

const PLATFORMS = ['tizen','webos','android_tv','roku','firetv','apple_tv'] as const;

const RegisterSchema = z.object({
  device_id: z.string().min(4).max(200),
  platform: z.enum(PLATFORMS),
  model: z.string().max(200).nullable().optional(),
  os_version: z.string().max(80).nullable().optional(),
  app_version: z.string().max(80).nullable().optional(),
  capabilities: z.record(z.string(), z.unknown()).optional(),
  user_id: z.string().max(100).nullable().optional(),
});

const HeartbeatSchema = z.object({
  app_version: z.string().max(80).optional(),
});

const LayoutSchema = z.object({
  platform: z.enum(PLATFORMS),
  name: z.string().min(2).max(120),
  layout: z.record(z.string(), z.unknown()),
  is_default: z.boolean().optional(),
});

const CompatSchema = z.object({
  platform: z.enum(PLATFORMS),
  min_os_version: z.string().min(1).max(80),
  min_app_version: z.string().min(1).max(80),
  required_capabilities: z.array(z.string().max(80)).max(30).optional(),
  notes: z.string().max(500).nullable().optional(),
});

function admin(auth: string | undefined): boolean {
  try { requireRole(auth, ['admin']); return true; } catch { return false; }
}
function user(auth: string | undefined): string | null {
  try {
    const p: any = requireRole(auth, ['admin','user','moderator']);
    return p?.sub ?? p?.id ?? null;
  } catch { return null; }
}

export async function smartTvRoutes(app: FastifyInstance): Promise<void> {
  // ============ DEVICES ============
  app.post('/tv/devices', async (req, reply) => {
    const p = RegisterSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: registerDevice(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/tv/devices/:deviceId/heartbeat', async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    const p = HeartbeatSchema.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    const d = heartbeat(deviceId, p.data.app_version);
    if (!d) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: d });
  });

  app.get('/tv/devices', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as { platform?: string; user_id?: string; online_within?: string; limit?: string };
    const devices = listDevices({
      platform: q.platform as any,
      user_id: q.user_id,
      onlineWithinSeconds: q.online_within ? Number(q.online_within) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return reply.send({ success: true, data: { devices, total: devices.length } });
  });

  app.get('/tv/devices/:deviceId', async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    const d = getDevice(deviceId);
    if (!d) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: d });
  });

  app.delete('/tv/devices/:deviceId', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { deviceId } = req.params as { deviceId: string };
    const ok = deleteDevice(deviceId);
    return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  // ============ LAYOUTS ============
  app.post('/tv/layouts', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = LayoutSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: upsertLayout(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/tv/layouts', async (req, reply) => {
    const q = req.query as { platform?: string };
    return reply.send({ success: true, data: { layouts: listLayouts(q.platform as any) } });
  });

  app.get('/tv/layouts/default/:platform', async (req, reply) => {
    const { platform } = req.params as { platform: string };
    const l = getDefaultLayout(platform as any);
    if (!l) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: l });
  });

  app.get('/tv/layouts/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const l = getLayoutById(id);
    if (!l) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: l });
  });

  app.delete('/tv/layouts/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const ok = deleteLayout(id);
    return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  // ============ COMPATIBILITY ============
  app.post('/tv/compat', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = CompatSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: upsertCompat(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/tv/compat', async (req, reply) => {
    const q = req.query as { platform?: string };
    return reply.send({ success: true, data: { rules: listCompat(q.platform as any) } });
  });

  app.delete('/tv/compat/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const ok = deleteCompat(id);
    return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  app.post('/tv/compat/check', async (req, reply) => {
    const body = req.body as { platform?: string; os_version?: string; app_version?: string; capabilities?: Record<string, unknown> };
    if (!body?.platform || !body.os_version || !body.app_version) {
      return reply.code(400).send({ success: false, error: 'invalid_body' });
    }
    return reply.send({ success: true, data: checkCompatibility(
      body.platform as any, body.os_version, body.app_version, body.capabilities ?? {},
    ) });
  });

  // ============ STATS ============
  app.get('/tv/stats', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as { online_within?: string };
    return reply.send({ success: true, data: getSmartTvStats(q.online_within ? Number(q.online_within) : 300) });
  });
}
