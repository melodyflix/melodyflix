// melodyflix videos - Section 12.10 Auto Scaling routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  upsertPolicy, getPolicy, listPolicies, deletePolicy,
  getState, setReplicas, listEvents, getEvent,
  evaluatePolicy, evaluateAllPolicies, getScalingStats,
} from '../services/autoscaling.service.js';

const SCOPES = ['videos','auth','channel','notifications','worker'] as const;
const ACTIONS = ['scale_up','scale_down','no_op'] as const;

const PolicySchema = z.object({
  name: z.string().min(2).max(120),
  scope: z.enum(SCOPES),
  min_replicas: z.number().int().min(1).max(500).optional(),
  max_replicas: z.number().int().min(1).max(1000).optional(),
  target_cpu_percent: z.number().min(0).max(100).optional(),
  target_rps_per_replica: z.number().int().min(1).max(1_000_000).optional(),
  scale_up_cooldown_seconds: z.number().int().min(0).max(86_400).optional(),
  scale_down_cooldown_seconds: z.number().int().min(0).max(86_400).optional(),
  scale_up_step: z.number().int().min(1).max(50).optional(),
  scale_down_step: z.number().int().min(1).max(50).optional(),
  enabled: z.boolean().optional(),
});

const MetricsSchema = z.object({
  cpu_percent: z.number().min(0).max(1000).optional(),
  rps: z.number().min(0).optional(),
  memory_percent: z.number().min(0).max(1000).optional(),
  queue_depth: z.number().int().min(0).optional(),
  apply: z.boolean().optional(),
});

const ReplicasSchema = z.object({
  replicas: z.number().int().min(0).max(1000),
  reason: z.string().max(500).optional(),
});

function admin(auth: string | undefined): boolean {
  try { requireRole(auth, ['admin']); return true; } catch { return false; }
}

export async function autoscalingRoutes(app: FastifyInstance): Promise<void> {
  // ============ POLICIES ============
  app.post('/scaling/policies', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = PolicySchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: upsertPolicy(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/scaling/policies', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as { scope?: string; enabled?: string };
    const policies = listPolicies({ scope: q.scope as any, enabledOnly: q.enabled === '1' || q.enabled === 'true' });
    return reply.send({ success: true, data: { policies, total: policies.length } });
  });

  app.get('/scaling/policies/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const policy = getPolicy(id);
    if (!policy) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: { policy, state: getState(id) } });
  });

  app.delete('/scaling/policies/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const ok = deletePolicy(id);
    return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  // ============ STATE / MANUAL ============
  app.post('/scaling/policies/:id/replicas', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const p = ReplicasSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: setReplicas(id, p.data.replicas, p.data.reason) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  // ============ EVALUATION ============
  app.post('/scaling/policies/:id/evaluate', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const p = MetricsSchema.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    const { apply, ...metrics } = p.data;
    try { return reply.send({ success: true, data: evaluatePolicy(id, metrics, apply ?? false) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/scaling/evaluate-all', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = MetricsSchema.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    const { apply, ...metrics } = p.data;
    return reply.send({ success: true, data: { results: evaluateAllPolicies(metrics, apply ?? false) } });
  });

  // ============ EVENTS ============
  app.get('/scaling/events', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as { policy_id?: string; action?: string; limit?: string };
    const events = listEvents({
      policy_id: q.policy_id,
      action: q.action as any,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return reply.send({ success: true, data: { events, total: events.length } });
  });

  app.get('/scaling/events/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const e = getEvent(id);
    if (!e) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: e });
  });

  // ============ STATS ============
  app.get('/scaling/stats', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getScalingStats() });
  });
}
