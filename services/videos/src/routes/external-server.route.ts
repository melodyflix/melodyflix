// melodyflix videos - external server + playback routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole, authGuard } from '@melodyflix/shared-auth';
import {
  ensureExternalServerSchema,
  createExternalServer, listExternalServers, getExternalServer,
  updateExternalServer, deleteExternalServer,
  setVideoExternalSource, removeVideoExternalSource, listVideoExternalSources,
  resolvePlaybackUrl, markVideoSourceAvailable, markVideoSourceUnavailable,
  listVideoSourceHealthLog, getExternalServerStats,
} from '../services/external-server.service.js';

export async function externalServerRoutes(app: FastifyInstance) {
  ensureExternalServerSchema();

  // ============ SERVER ADMIN ============

  // GET /admin/external-servers
  app.get('/admin/external-servers', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { enabled_only?: string };
    const servers = listExternalServers({ enabledOnly: q.enabled_only === '1' });
    return reply.send({ success: true, data: { servers } });
  });

  // GET /admin/external-servers/stats
  app.get('/admin/external-servers/stats', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: getExternalServerStats() });
  });

  // GET /admin/external-servers/:id
  app.get('/admin/external-servers/:id', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const s = getExternalServer(id);
    if (!s) return reply.code(404).send({ success: false, error: 'Server not found' });
    return reply.send({ success: true, data: s });
  });

  // POST /admin/external-servers
  app.post('/admin/external-servers', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const BodySchema = z.object({
      name: z.string().min(1).max(80),
      base_url: z.string().min(4).max(500),
      priority: z.number().int().min(1).max(10000).optional(),
      enabled: z.boolean().optional(),
      is_default: z.boolean().optional(),
      headers: z.record(z.string()).nullable().optional(),
      notes: z.string().max(500).nullable().optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const s = createExternalServer(parsed.data);
      return reply.code(201).send({ success: true, data: s });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // PATCH /admin/external-servers/:id
  app.patch('/admin/external-servers/:id', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const BodySchema = z.object({
      name: z.string().min(1).max(80).optional(),
      base_url: z.string().min(4).max(500).optional(),
      priority: z.number().int().min(1).max(10000).optional(),
      enabled: z.boolean().optional(),
      is_default: z.boolean().optional(),
      headers: z.record(z.string()).nullable().optional(),
      notes: z.string().max(500).nullable().optional(),
      health_status: z.enum(['unknown', 'healthy', 'degraded', 'down']).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const s = updateExternalServer(id, parsed.data);
      if (!s) return reply.code(404).send({ success: false, error: 'Server not found' });
      return reply.send({ success: true, data: s });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /admin/external-servers/:id
  app.delete('/admin/external-servers/:id', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const ok = deleteExternalServer(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Server not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // ============ VIDEO LINKS (ADMIN) ============

  // GET /admin/videos/:videoId/external-sources
  app.get('/admin/videos/:videoId/external-sources', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { videoId } = req.params as { videoId: string };
    return reply.send({ success: true, data: { sources: listVideoExternalSources(videoId) } });
  });

  // POST /admin/videos/:videoId/external-sources
  app.post('/admin/videos/:videoId/external-sources', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { videoId } = req.params as { videoId: string };
    const BodySchema = z.object({
      server_id: z.string().min(1),
      external_url: z.string().min(4).max(1000),
      quality: z.string().max(20).nullable().optional(),
      is_available: z.boolean().optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const s = setVideoExternalSource({ video_id: videoId, ...parsed.data });
      return reply.code(201).send({ success: true, data: s });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /admin/videos/:videoId/external-sources/:serverId
  app.delete('/admin/videos/:videoId/external-sources/:serverId', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { videoId, serverId } = req.params as { videoId: string; serverId: string };
    const ok = removeVideoExternalSource(videoId, serverId);
    if (!ok) return reply.code(404).send({ success: false, error: 'Source not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // POST /admin/videos/:videoId/external-sources/:serverId/mark-available
  app.post('/admin/videos/:videoId/external-sources/:serverId/mark-available', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { videoId, serverId } = req.params as { videoId: string; serverId: string };
    markVideoSourceAvailable(videoId, serverId);
    return reply.send({ success: true, data: { marked: 'available' } });
  });

  // POST /admin/videos/:videoId/external-sources/:serverId/mark-unavailable
  app.post('/admin/videos/:videoId/external-sources/:serverId/mark-unavailable', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { videoId, serverId } = req.params as { videoId: string; serverId: string };
    const { reason } = (req.body ?? {}) as { reason?: string };
    markVideoSourceUnavailable(videoId, serverId, reason ?? 'manual');
    return reply.send({ success: true, data: { marked: 'unavailable' } });
  });

  // GET /admin/videos/:videoId/source-health-log
  app.get('/admin/videos/:videoId/source-health-log', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { limit?: string };
    const limit = Math.min(Number(q.limit ?? 50), 500);
    return reply.send({ success: true, data: { entries: listVideoSourceHealthLog(videoId, limit) } });
  });

  // ============ PLAYBACK (USER-FACING) ============

  // GET /videos/:videoId/servers — which servers have this video (for UI switch list)
  app.get('/videos/:videoId/servers', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const sources = listVideoExternalSources(videoId).map((s) => ({
      server_id: s.server_id,
      server_name: s.server?.name ?? '',
      priority: s.server?.priority ?? 999,
      is_available: s.is_available,
      missing_reason: s.missing_reason,
    }));
    return reply.send({ success: true, data: { servers: sources } });
  });

  // GET /videos/:videoId/play?server=<id> — resolve best playback URL
  app.get('/videos/:videoId/play', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { server?: string };
    const resolved = resolvePlaybackUrl(videoId, { server_id: q.server });
    if (!resolved) return reply.code(404).send({ success: false, error: 'No playable source available' });
    return reply.send({ success: true, data: resolved });
  });
}
