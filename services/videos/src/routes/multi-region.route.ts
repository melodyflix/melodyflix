// melodyflix videos - Section 12.12 Multi-Region Replication routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  upsertRegion, listRegions, getRegion, deleteRegion,
  upsertPolicy, getPolicy, listPolicies, deletePolicy,
  recordStatus, listStatus, getLaggingReplicas, markStatusError,
  promoteRegion, listEvents, getReplicationStats,
} from '../services/multi-region.service.js';

const SCOPES = ['videos','users','metadata','analytics'] as const;
const MODES = ['sync','async'] as const;

const RegionSchema = z.object({
  code: z.string().min(2).max(20),
  name: z.string().min(2).max(120),
  provider: z.string().max(80).nullable().optional(),
  latency_class: z.string().max(40).nullable().optional(),
  is_primary: z.boolean().optional(),
  active: z.boolean().optional(),
});

const PolicySchema = z.object({
  name: z.string().min(2).max(120),
  scope: z.enum(SCOPES),
  primary_region: z.string().min(2).max(20),
  replica_regions: z.array(z.string().min(2).max(20)).min(1).max(20),
  mode: z.enum(MODES).optional(),
  lag_threshold_seconds: z.number().int().min(1).max(86400).optional(),
  enabled: z.boolean().optional(),
});

const StatusSchema = z.object({
  region_code: z.string().min(2).max(20),
  lag_seconds: z.number().int().min(0).max(86400000),
  bytes_replicated: z.number().int().min(0).max(10000000000000).optional(),
  last_applied_at: z.string().datetime().nullable().optional(),
});

const ErrorSchema = z.object({
  region_code: z.string().min(2).max(20),
  message: z.string().max(500).optional(),
});

const PromoteSchema = z.object({
  region_code: z.string().min(2).max(20),
  reason: z.string().max(500).optional(),
});

function admin(auth: string | undefined): boolean {
  try { requireRole(auth, ['admin']); return true; } catch { return false; }
}

export async function multiRegionRoutes(app: FastifyInstance): Promise<void> {
  app.post('/replication/regions', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = RegionSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: upsertRegion(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/replication/regions', async (req, reply) => {
    const q = req.query as { active?: string };
    return reply.send({ success: true, data: { regions: listRegions(q.active === '1' || q.active === 'true') } });
  });

  app.get('/replication/regions/:code', async (req, reply) => {
    const { code } = req.params as { code: string };
    const r = getRegion(code);
    if (!r) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: r });
  });

  app.delete('/replication/regions/:code', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { code } = req.params as { code: string };
    try {
      const ok = deleteRegion(code);
      return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(409).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/replication/policies', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = PolicySchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: upsertPolicy(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/replication/policies', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as { scope?: string; enabled?: string };
    const policies = listPolicies({ scope: q.scope as any, enabledOnly: q.enabled === '1' || q.enabled === 'true' });
    return reply.send({ success: true, data: { policies, total: policies.length } });
  });

  app.get('/replication/policies/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const p = getPolicy(id);
    if (!p) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: { policy: p, status: listStatus({ policy_id: id }) } });
  });

  app.delete('/replication/policies/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const ok = deletePolicy(id);
    return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  app.post('/replication/policies/:id/status', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const p = StatusSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: recordStatus({ policy_id: id, ...p.data }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/replication/policies/:id/error', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const p = ErrorSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    const r = markStatusError(id, p.data.region_code, p.data.message);
    if (!r) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: r });
  });

  app.get('/replication/status', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as { policy_id?: string; region_code?: string; status?: string; limit?: string };
    const rows = listStatus({
      policy_id: q.policy_id, region_code: q.region_code, status: q.status as any,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return reply.send({ success: true, data: { statuses: rows, total: rows.length } });
  });

  app.get('/replication/lagging', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as { override?: string };
    const rows = getLaggingReplicas(q.override ? Number(q.override) : undefined);
    return reply.send({ success: true, data: { lagging: rows, total: rows.length } });
  });

  app.post('/replication/policies/:id/promote', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const p = PromoteSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: promoteRegion(id, p.data.region_code, p.data.reason) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/replication/events', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as { policy_id?: string; region_code?: string; event_type?: string; limit?: string };
    const events = listEvents({
      policy_id: q.policy_id, region_code: q.region_code,
      event_type: q.event_type as any, limit: q.limit ? Number(q.limit) : undefined,
    });
    return reply.send({ success: true, data: { events, total: events.length } });
  });

  app.get('/replication/stats', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getReplicationStats() });
  });
}
