// melodyflix videos - Section 12.11 Deployment Rollback routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  createDeployment, getDeployment, listDeployments, getActiveDeployment,
  activateDeployment, markDeploymentFailed,
  rollback, listRollbackEvents, getRollbackEvent,
  upsertRollbackRule, listRollbackRules, getRollbackRule, deleteRollbackRule,
  evaluateAutoRollback, getRollbackStats,
} from '../services/rollback.service.js';

const SCOPES = ['videos','auth','channel','notifications','admin','web'] as const;
const STATUSES = ['pending','deploying','active','superseded','failed','rolled_back'] as const;
const TRIGGERS = ['auto','manual'] as const;

const DeploySchema = z.object({
  scope: z.enum(SCOPES),
  version: z.string().min(1).max(100),
  git_sha: z.string().max(80).nullable().optional(),
  image_tag: z.string().max(200).nullable().optional(),
  artifact_url: z.string().url().max(500).nullable().optional(),
  deployed_by: z.string().max(200).nullable().optional(),
  health_check_url: z.string().url().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const FailSchema = z.object({ reason: z.string().max(500).optional() });
const RollbackSchema = z.object({
  reason: z.string().max(500).optional(),
  triggered_by: z.enum(TRIGGERS).optional(),
});

const RuleSchema = z.object({
  scope: z.enum(SCOPES),
  error_rate_threshold: z.number().min(0).max(1).optional(),
  error_window_seconds: z.number().int().min(10).max(86_400).optional(),
  min_requests: z.number().int().min(0).max(10_000_000).optional(),
  auto_rollback: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

const AutoEvalSchema = z.object({
  error_rate: z.number().min(0).max(1),
  requests: z.number().int().min(0),
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

export async function rollbackRoutes(app: FastifyInstance): Promise<void> {
  // ============ DEPLOYMENTS ============
  app.post('/deployments', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = DeploySchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try {
      const actor = user(req.headers.authorization);
      const d = createDeployment({ ...p.data, deployed_by: p.data.deployed_by ?? actor });
      return reply.code(201).send({ success: true, data: d });
    } catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/deployments', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as { scope?: string; status?: string; limit?: string };
    const deps = listDeployments({
      scope: q.scope as any, status: q.status as any,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return reply.send({ success: true, data: { deployments: deps, total: deps.length } });
  });

  app.get('/deployments/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const d = getDeployment(id);
    if (!d) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: d });
  });

  app.get('/deployments/active/:scope', async (req, reply) => {
    const { scope } = req.params as { scope: string };
    const d = getActiveDeployment(scope as any);
    if (!d) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: d });
  });

  app.post('/deployments/:id/activate', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: activateDeployment(id) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/deployments/:id/fail', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const p = FailSchema.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: markDeploymentFailed(id, p.data.reason) }); }
    catch (e) { return reply.code(404).send({ success: false, error: (e as Error).message }); }
  });

  // ============ ROLLBACK ============
  app.post('/deployments/rollback/:scope', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { scope } = req.params as { scope: string };
    const p = RollbackSchema.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try {
      const res = rollback({ scope: scope as any, reason: p.data.reason, triggered_by: p.data.triggered_by ?? 'manual' });
      if (!res.rolled_back) return reply.code(409).send({ success: false, error: res.reason, data: res });
      return reply.code(201).send({ success: true, data: res });
    } catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/deployments/rollback-events', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as { scope?: string; triggered_by?: string; limit?: string };
    const events = listRollbackEvents({
      scope: q.scope as any,
      triggered_by: q.triggered_by as any,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return reply.send({ success: true, data: { events, total: events.length } });
  });

  app.get('/deployments/rollback-events/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const e = getRollbackEvent(id);
    if (!e) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: e });
  });

  // ============ RULES ============
  app.post('/deployments/rules', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = RuleSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: upsertRollbackRule(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/deployments/rules', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: { rules: listRollbackRules() } });
  });

  app.get('/deployments/rules/:scope', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { scope } = req.params as { scope: string };
    const r = getRollbackRule(scope as any);
    if (!r) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: r });
  });

  app.delete('/deployments/rules/:scope', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { scope } = req.params as { scope: string };
    const ok = deleteRollbackRule(scope as any);
    return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  // ============ AUTO EVAL ============
  app.post('/deployments/auto-rollback/:scope', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { scope } = req.params as { scope: string };
    const p = AutoEvalSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: evaluateAutoRollback(scope as any, p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  // ============ STATS ============
  app.get('/deployments/stats', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getRollbackStats() });
  });
}
