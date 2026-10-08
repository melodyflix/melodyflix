// melodyflix videos - video server management routes (Section 52)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  ensureVideoServerSchema,
  createVideoServer, getVideoServer, listVideoServers, updateVideoServer, deleteVideoServer,
  recordHealthCheck, listHealthLog, listFailoverEvents,
  createReplica, updateReplicaStatus, getReplica, listReplicasForVideo, listReplicasForServer,
  deleteReplica, replicaCoverage,
  recordCapacity, latestCapacity, listCapacityHistory,
  resolveServer, listRoutingLog,
  failoverCandidates, recordManualFailover, recordRestore,
  pushConfigSync, markConfigSyncApplied, listConfigSync,
  getFleetStats,
} from '../services/video-server.service.js';

const RoleEnum = z.enum(['origin', 'edge', 'worker', 'backup']);
const HealthEnum = z.enum(['unknown', 'healthy', 'degraded', 'down']);
const ReplicaStatusEnum = z.enum(['pending', 'syncing', 'ready', 'stale', 'failed']);
const LbStrategyEnum = z.enum(['priority', 'least_load', 'geo', 'round_robin', 'weighted']);

export async function videoServerRoutes(app: FastifyInstance) {
  ensureVideoServerSchema();

  const isAdmin = async (req: any, reply: any) => {
    try { requireRole(req.headers.authorization, ['admin']); return true; }
    catch (err) { reply.code(403).send({ success: false, error: (err as Error).message }); return false; }
  };

  // ============ 52.1 Servers ============
  app.get('/admin/video-servers', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const q = req.query as { role?: string; region?: string; health?: string; enabled_only?: string };
    return reply.send({ success: true, data: { servers: listVideoServers({
      role: q.role as any, region: q.region, health: q.health as any,
      enabledOnly: q.enabled_only === '1',
    }) } });
  });

  app.get('/admin/video-servers/fleet-stats', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    return reply.send({ success: true, data: getFleetStats() });
  });

  app.get('/admin/video-servers/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const s = getVideoServer(id);
    if (!s) return reply.code(404).send({ success: false, error: 'Server not found' });
    return reply.send({ success: true, data: s });
  });

  app.post('/admin/video-servers', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const BodySchema = z.object({
      name: z.string().min(1).max(80),
      role: RoleEnum,
      base_url: z.string().min(4).max(500),
      streaming_url: z.string().max(500).optional(),
      region: z.string().max(40).nullable().optional(),
      api_key_hash: z.string().max(128).nullable().optional(),
      headers: z.record(z.string()).optional(),
      priority: z.number().int().min(1).max(10000).optional(),
      weight: z.number().int().min(1).max(1000).optional(),
      max_bandwidth_mbps: z.number().int().min(1).max(1000000).optional(),
      max_storage_gb: z.number().int().min(1).max(10000000).optional(),
      enabled: z.boolean().optional(),
      config: z.record(z.unknown()).optional(),
      notes: z.string().max(1000).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try { return reply.code(201).send({ success: true, data: createVideoServer(parsed.data) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.patch('/admin/video-servers/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const BodySchema = z.object({
      name: z.string().min(1).max(80).optional(),
      role: RoleEnum.optional(),
      region: z.string().max(40).nullable().optional(),
      base_url: z.string().min(4).max(500).optional(),
      streaming_url: z.string().max(500).nullable().optional(),
      api_key_hash: z.string().max(128).nullable().optional(),
      headers: z.record(z.string()).optional(),
      priority: z.number().int().min(1).max(10000).optional(),
      weight: z.number().int().min(1).max(1000).optional(),
      max_bandwidth_mbps: z.number().int().min(1).optional(),
      max_storage_gb: z.number().int().min(1).optional(),
      enabled: z.boolean().optional(),
      config: z.record(z.unknown()).optional(),
      notes: z.string().max(1000).nullable().optional(),
    });
    const parsed = BodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const s = updateVideoServer(id, parsed.data);
      if (!s) return reply.code(404).send({ success: false, error: 'Server not found' });
      return reply.send({ success: true, data: s });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.delete('/admin/video-servers/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const ok = deleteVideoServer(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Server not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // ============ 52.2 Health ============
  app.post('/admin/video-servers/:id/health', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const BodySchema = z.object({
      status: z.enum(['healthy', 'degraded', 'down', 'unknown']),
      check_type: z.string().max(40).optional(),
      latency_ms: z.number().int().min(0).optional(),
      http_code: z.number().int().optional(),
      error_text: z.string().max(500).optional(),
      cpu_pct: z.number().min(0).max(100).optional(),
      memory_pct: z.number().min(0).max(100).optional(),
      disk_pct: z.number().min(0).max(100).optional(),
      bandwidth_mbps: z.number().min(0).optional(),
      active_streams: z.number().int().min(0).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const r = recordHealthCheck({ server_id: id, ...parsed.data });
      return reply.send({ success: true, data: r });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.get('/admin/video-servers/:id/health', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(parseInt(q.limit), 500) : 50;
    return reply.send({ success: true, data: { log: listHealthLog(id, limit) } });
  });

  app.get('/admin/video-servers/failover/events', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const q = req.query as { server_id?: string; limit?: string };
    return reply.send({ success: true, data: { events: listFailoverEvents({
      server_id: q.server_id, limit: q.limit ? parseInt(q.limit) : undefined,
    }) } });
  });

  // ============ 52.3 Replication ============
  app.post('/admin/video-servers/:id/replicas', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const BodySchema = z.object({
      video_id: z.string().min(1),
      status: ReplicaStatusEnum.optional(),
      file_path: z.string().max(1000).optional(),
      file_size_bytes: z.number().int().min(0).optional(),
      hls_path: z.string().max(1000).optional(),
      checksum_sha256: z.string().length(64).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try { return reply.code(201).send({ success: true, data: createReplica({ server_id: id, ...parsed.data }) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.get('/admin/video-servers/:id/replicas', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const q = req.query as { status?: string };
    return reply.send({ success: true, data: { replicas: listReplicasForServer(id, q.status as any) } });
  });

  app.get('/admin/videos/:videoId/replicas', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { videoId } = req.params as { videoId: string };
    return reply.send({
      success: true,
      data: { replicas: listReplicasForVideo(videoId), coverage: replicaCoverage(videoId) },
    });
  });

  app.patch('/admin/replicas/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const BodySchema = z.object({
      status: ReplicaStatusEnum,
      checksum_sha256: z.string().length(64).optional(),
      hls_path: z.string().max(1000).optional(),
      file_size_bytes: z.number().int().min(0).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const r = updateReplicaStatus(id, parsed.data.status, parsed.data);
    if (!r) return reply.code(404).send({ success: false, error: 'Replica not found' });
    return reply.send({ success: true, data: r });
  });

  app.get('/admin/replicas/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const r = getReplica(id);
    if (!r) return reply.code(404).send({ success: false, error: 'Replica not found' });
    return reply.send({ success: true, data: r });
  });

  app.delete('/admin/replicas/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const ok = deleteReplica(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Replica not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // ============ 52.4 Capacity ============
  app.post('/admin/video-servers/:id/capacity', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const BodySchema = z.object({
      disk_used_gb: z.number().min(0).optional(),
      disk_total_gb: z.number().min(0).optional(),
      bandwidth_used_mbps: z.number().min(0).optional(),
      active_streams: z.number().int().min(0).optional(),
    });
    const parsed = BodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try { return reply.code(201).send({ success: true, data: recordCapacity({ server_id: id, ...parsed.data }) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.get('/admin/video-servers/:id/capacity', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string };
    return reply.send({
      success: true,
      data: { latest: latestCapacity(id), history: listCapacityHistory(id, q.limit ? parseInt(q.limit) : 50) },
    });
  });

  // ============ 52.5 Load balancing ============
  app.get('/videos/:videoId/route', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { strategy?: string; country?: string };
    const decision = resolveServer({
      video_id: videoId,
      strategy: q.strategy as any,
      client_country: q.country,
      client_ip: req.ip,
    });
    if (!decision.server) return reply.code(404).send({ success: false, error: 'No server available', data: decision });
    return reply.send({ success: true, data: decision });
  });

  app.get('/admin/routing-log', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const q = req.query as { video_id?: string; limit?: string };
    return reply.send({ success: true, data: { log: listRoutingLog(q.video_id, q.limit ? parseInt(q.limit) : 100) } });
  });

  // ============ 52.6 Failover ============
  app.get('/admin/video-servers/:id/failover-candidates', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: { candidates: failoverCandidates(id) } });
  });

  app.post('/admin/video-servers/:id/failover', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const BodySchema = z.object({
      reason: z.string().min(1).max(500),
      affected_streams: z.number().int().min(0).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const r = recordManualFailover({ server_id: id, ...parsed.data, triggered_by: 'admin' });
      return reply.send({ success: true, data: r });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.post('/admin/video-servers/:id/restore', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    try {
      const r = recordRestore(id, 'admin');
      return reply.send({ success: true, data: r });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // ============ 52.7 Config sync ============
  app.post('/admin/video-servers/:id/config-sync', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const BodySchema = z.object({
      config: z.record(z.unknown()),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const r = pushConfigSync({ server_id: id, config: parsed.data.config, created_by: 'admin' });
      return reply.code(201).send({ success: true, data: r });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.post('/admin/config-sync/:id/applied', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const { error } = (req.body ?? {}) as { error?: string };
    const r = markConfigSyncApplied(id, error);
    if (!r) return reply.code(404).send({ success: false, error: 'Sync record not found' });
    return reply.send({ success: true, data: r });
  });

  app.get('/admin/video-servers/:id/config-sync', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string };
    return reply.send({ success: true, data: { syncs: listConfigSync(id, q.limit ? parseInt(q.limit) : 20) } });
  });
}
