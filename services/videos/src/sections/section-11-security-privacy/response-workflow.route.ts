// melodyflix videos - Section 11.21 Response Workflow routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  createPlaybook, getPlaybook, listPlaybooks, updatePlaybook,
  addPlaybookStep, updatePlaybookStep, removePlaybookStep,
  startRun, getRun, listRunsForIncident, listRuns,
  executeStep, abortRun, getResponseStats,
} from './response-workflow.service.js';

const ACTIONS = ['block_ip','block_user','revoke_sessions','notify_admin','notify_user','create_ticket','escalate','manual'] as const;
const SEVERITIES = ['low','medium','high','critical'] as const;
const RUN_STATUSES = ['pending','running','completed','aborted','failed'] as const;

const StepSchema = z.object({
  step_order: z.number().int().min(1).max(1000).optional(),
  title: z.string().min(2).max(200),
  description: z.string().max(2000).nullable().optional(),
  action_type: z.enum(ACTIONS),
  action_config: z.record(z.string(), z.unknown()).nullable().optional(),
  timeout_seconds: z.number().int().min(1).max(86400).nullable().optional(),
  required: z.boolean().optional(),
});

const CreatePlaybookSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().max(2000).nullable().optional(),
  incident_source: z.string().max(50).optional(),
  min_severity: z.enum(SEVERITIES).optional(),
  steps: z.array(StepSchema).max(50).optional(),
});

const UpdatePlaybookSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  incident_source: z.string().max(50).optional(),
  min_severity: z.enum(SEVERITIES).optional(),
  is_active: z.boolean().optional(),
});

const UpdateStepSchema = StepSchema.partial();

const StartRunSchema = z.object({
  playbook_id: z.string().min(1).max(100),
  incident_id: z.string().min(1).max(100),
  notes: z.string().max(2000).optional(),
});

const ExecuteSchema = z.object({
  status: z.enum(['done','skipped','failed']),
  output: z.string().max(5000).nullable().optional(),
  error: z.string().max(5000).nullable().optional(),
});

const AbortSchema = z.object({
  reason: z.string().max(500).optional(),
});

const ListQuerySchema = z.object({
  source: z.string().max(50).optional(),
  active_only: z.enum(['true','false']).optional(),
  status: z.enum(RUN_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

function getAuth(authorization: string | undefined): { ok: boolean; userId?: string; role?: string; error?: string } {
  try {
    const payload = requireAuth(authorization);
    return { ok: true, userId: payload.sub as string, role: payload.role as string };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function requireAdmin(authorization: string | undefined): { ok: boolean; userId?: string; error?: string } {
  const auth = getAuth(authorization);
  if (!auth.ok) return auth;
  if (auth.role !== 'admin') return { ok: false, error: 'Admin only' };
  return auth;
}

export async function responseWorkflowRoutes(app: FastifyInstance): Promise<void> {
  // -------- Playbooks (admin) --------
  app.post('/security/response/playbooks', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const parse = CreatePlaybookSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: 'invalid_input', details: parse.error.flatten() });
    const pb = createPlaybook(parse.data, auth.userId ?? null);
    return reply.code(201).send(pb);
  });

  app.get('/security/response/playbooks', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const q = ListQuerySchema.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });
    const items = listPlaybooks({
      source: q.data.source,
      active_only: q.data.active_only === 'true',
    });
    return { playbooks: items, total: items.length };
  });

  app.get('/security/response/playbooks/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { id } = req.params as { id: string };
    const pb = getPlaybook(id);
    if (!pb) return reply.code(404).send({ error: 'not_found' });
    return pb;
  });

  app.patch('/security/response/playbooks/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { id } = req.params as { id: string };
    const parse = UpdatePlaybookSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: 'invalid_input' });
    const updated = updatePlaybook(id, parse.data);
    if (!updated) return reply.code(404).send({ error: 'not_found' });
    return updated;
  });

  app.post('/security/response/playbooks/:id/steps', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { id } = req.params as { id: string };
    if (!getPlaybook(id)) return reply.code(404).send({ error: 'playbook_not_found' });
    const parse = StepSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: 'invalid_input', details: parse.error.flatten() });
    const step = addPlaybookStep(id, parse.data);
    return reply.code(201).send(step);
  });

  app.patch('/security/response/steps/:stepId', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { stepId } = req.params as { stepId: string };
    const parse = UpdateStepSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: 'invalid_input' });
    const updated = updatePlaybookStep(stepId, parse.data);
    if (!updated) return reply.code(404).send({ error: 'not_found' });
    return updated;
  });

  app.delete('/security/response/steps/:stepId', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { stepId } = req.params as { stepId: string };
    const ok = removePlaybookStep(stepId);
    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // -------- Runs (admin) --------
  app.post('/security/response/runs', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const parse = StartRunSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: 'invalid_input', details: parse.error.flatten() });
    try {
      const run = startRun(parse.data.incident_id, parse.data.playbook_id, auth.userId ?? null, parse.data.notes);
      return reply.code(201).send(run);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'error';
      if (msg === 'playbook_not_found') return reply.code(404).send({ error: msg });
      return reply.code(500).send({ error: 'run_failed' });
    }
  });

  app.get('/security/response/runs', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const q = ListQuerySchema.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });
    const items = listRuns({ status: q.data.status, limit: q.data.limit });
    return { runs: items, total: items.length };
  });

  app.get('/security/response/runs/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { id } = req.params as { id: string };
    const run = getRun(id);
    if (!run) return reply.code(404).send({ error: 'not_found' });
    return run;
  });

  app.get('/security/response/incidents/:incidentId/runs', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { incidentId } = req.params as { incidentId: string };
    const runs = listRunsForIncident(incidentId);
    return { runs, total: runs.length };
  });

  app.post('/security/response/runs/:id/steps/:stepId/execute', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { id, stepId } = req.params as { id: string; stepId: string };
    const parse = ExecuteSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: 'invalid_input' });
    const log = executeStep(id, stepId, parse.data, auth.userId ?? null);
    if (!log) return reply.code(409).send({ error: 'run_or_step_not_executable' });
    return log;
  });

  app.post('/security/response/runs/:id/abort', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { id } = req.params as { id: string };
    const parse = AbortSchema.safeParse(req.body ?? {});
    if (!parse.success) return reply.code(400).send({ error: 'invalid_input' });
    const run = abortRun(id, auth.userId ?? null, parse.data.reason);
    if (!run) return reply.code(404).send({ error: 'not_found' });
    return run;
  });

  // -------- Stats (admin) --------
  app.get('/security/response/stats/summary', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const q = req.query as { window_days?: string };
    const days = q.window_days ? Math.min(Math.max(parseInt(q.window_days, 10) || 30, 1), 365) : 30;
    return getResponseStats(days);
  });
}
