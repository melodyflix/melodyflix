// melodyflix videos - Section 12.13 Automated Failover routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  createPolicy, getPolicy, listPolicies, updatePolicy, deletePolicy,
  getState, triggerFailover, restorePrimary,
  getEvent, listEvents, evaluatePolicy, evaluateAllPolicies, getFailoverStats,
} from '../services/failover.service.js';

const SCOPES = ['cdn','service','region'] as const;
const STATUSES = ['triggered','restored','failed'] as const;

const PolicySchema = z.object({
  name: z.string().min(2).max(120),
  scope: z.enum(SCOPES),
  primary_target: z.string().min(1).max(200),
  failover_targets: z.array(z.string().min(1).max(200)).min(1).max(20),
  unhealthy_threshold: z.number().int().min(1).max(100).optional(),
  health_check_seconds: z.number().int().min(5).max(3600).optional(),
  auto_restore: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

const UpdatePolicySchema = PolicySchema.partial();

const TriggerSchema = z.object({
  reason: z.string().max(500).optional(),
  to_target: z.string().max(200).optional(),
});

const RestoreSchema = z.object({ reason: z.string().max(500).optional() });

function admin(auth: string | undefined): boolean {
  try { requireRole(auth, ['admin']); return true; } catch { return false; }
}

export async function failoverRoutes(app: FastifyInstance): Promise<void> {
  // ============ POLICIES ============
  app.post('/failover/policies', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = PolicySchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createPolicy(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/failover/policies', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as { scope?: string; enabled?: string };
    const policies = listPolicies({ scope: q.scope as any, enabledOnly: q.enabled === '1' || q.enabled === 'true' });
    return reply.send({ success: true, data: { policies, total: policies.length } });
  });

  app.get('/failover/policies/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const p = getPolicy(id);
    if (!p) return reply.code(404).send({ success: false, error: 'not_found' });
    const s = getState(id);
    return reply.send({ success: true, data: { policy: p, state: s } });
  });

  app.patch('/failover/policies/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const p = UpdatePolicySchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    const r = updatePolicy(id, p.data as any);
    if (!r) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: r });
  });

  app.delete('/failover/policies/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const ok = deletePolicy(id);
    return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  // ============ TRIGGER / RESTORE ============
  app.post('/failover/policies/:id/trigger', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const p = TriggerSchema.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: triggerFailover({ policy_id: id, ...p.data }) }); }
    catch (e) { return reply.code(409).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/failover/policies/:id/restore', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const p = RestoreSchema.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try {
      const ev = restorePrimary(id, p.data.reason);
      return reply.send({ success: true, data: { restored: true, event: ev, state: getState(id) } });
    } catch (e) { return reply.code(409).send({ success: false, error: (e as Error).message }); }
  });

  // ============ EVALUATION ============
  app.post('/failover/policies/:id/evaluate', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: evaluatePolicy(id) }); }
    catch (e) { return reply.code(404).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/failover/evaluate-all', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: { results: evaluateAllPolicies() } });
  });

  // ============ EVENTS ============
  app.get('/failover/events', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as { policy_id?: string; status?: string; limit?: string };
    const events = listEvents({ policy_id: q.policy_id, status: q.status as any, limit: q.limit ? Number(q.limit) : undefined });
    return reply.send({ success: true, data: { events, total: events.length } });
  });

  app.get('/failover/events/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const e = getEvent(id);
    if (!e) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: e });
  });

  // ============ STATS ============
  app.get('/failover/stats', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getFailoverStats() });
  });
}
