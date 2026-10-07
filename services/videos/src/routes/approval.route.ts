// melodyflix videos - Section 15.8 Approval Workflow routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  createWorkflow, getWorkflow, listWorkflows, updateWorkflow, deleteWorkflow,
  submitRequest, getRequest, listRequests, withdrawRequest,
  approveStage, rejectStage, requestChanges,
  listActions, listPendingForReviewer,
  getRequestDetail, getApprovalStats,
} from '../services/approval.service.js';

const SCOPES = ['video','playlist','edit_project','marketplace_order','co_publish','custom'] as const;
const STATUSES = ['pending','in_review','approved','rejected','withdrawn','changes_requested'] as const;
const DECISIONS = ['approve','reject','request_changes'] as const;

const StageSchema = z.object({
  name: z.string().min(1).max(100),
  required_role: z.string().max(40).optional(),
  required_user_id: z.string().max(100).optional(),
});

const WorkflowSchema = z.object({
  name: z.string().min(1).max(200),
  scope: z.enum(SCOPES),
  stages: z.array(StageSchema).min(1).max(20),
  is_active: z.boolean().optional(),
});

const UpdateWorkflowSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  stages: z.array(StageSchema).min(1).max(20).optional(),
  is_active: z.boolean().optional(),
});

const SubmitSchema = z.object({
  workflow_id: z.string().min(1).max(100),
  entity_id: z.string().min(1).max(200),
});

const DecideSchema = z.object({
  decision: z.enum(DECISIONS),
  comment: z.string().max(2000).optional(),
});

const WithdrawSchema = z.object({ comment: z.string().max(2000).optional() });

function uid(auth: string | undefined): string | null {
  try {
    const p: any = requireRole(auth, ['admin','user','moderator']);
    return p?.sub ?? p?.id ?? null;
  } catch { return null; }
}
function admin(auth: string | undefined): boolean {
  try { requireRole(auth, ['admin']); return true; } catch { return false; }
}
function role(auth: string | undefined): string | null {
  try {
    const p: any = requireRole(auth, ['admin','user','moderator']);
    return p?.role ?? null;
  } catch { return null; }
}

export async function approvalRoutes(app: FastifyInstance): Promise<void> {
  // ============ WORKFLOWS ============
  app.post('/approval-workflows', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = WorkflowSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createWorkflow({ ...p.data, created_by: actor }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/approval-workflows', async (req, reply) => {
    const q = req.query as { scope?: string; active?: string };
    return reply.send({ success: true, data: { workflows: listWorkflows({
      scope: q.scope as any, activeOnly: q.active === '1' || q.active === 'true',
    }) } });
  });

  app.get('/approval-workflows/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const w = getWorkflow(id);
    if (!w) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: w });
  });

  app.patch('/approval-workflows/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const p = UpdateWorkflowSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    const w = updateWorkflow(id, p.data);
    return w ? reply.send({ success: true, data: w }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  app.delete('/approval-workflows/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    try {
      const ok = deleteWorkflow(id);
      return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(409).send({ success: false, error: (e as Error).message }); }
  });

  // ============ REQUESTS ============
  app.post('/approval-requests', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = SubmitSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: submitRequest({ ...p.data, requester_id: actor }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/approval-requests', async (req, reply) => {
    const q = req.query as { workflow_id?: string; entity_id?: string; scope?: string; status?: string; requester_id?: string; box?: string; limit?: string };
    const filter: any = {
      workflow_id: q.workflow_id, entity_id: q.entity_id, scope: q.scope as any,
      status: q.status as any, limit: q.limit ? Number(q.limit) : undefined,
    };
    if (q.box === 'mine') filter.requester_id = uid(req.headers.authorization) ?? undefined;
    else if (q.requester_id) filter.requester_id = q.requester_id;
    return reply.send({ success: true, data: { requests: listRequests(filter) } });
  });

  app.get('/approval-requests/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const d = getRequestDetail(id);
    if (!d) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: d });
  });

  app.get('/approval-requests/:id/actions', async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: { actions: listActions(id) } });
  });

  app.post('/approval-requests/:id/withdraw', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const p = WithdrawSchema.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: withdrawRequest(id, actor, p.data.comment) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  // ============ DECIDE ============
  app.post('/approval-requests/:id/decide', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const p = DecideSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try {
      let r;
      if (p.data.decision === 'approve') r = approveStage(id, actor, p.data.comment);
      else if (p.data.decision === 'reject') r = rejectStage(id, actor, p.data.comment);
      else r = requestChanges(id, actor, p.data.comment);
      return reply.send({ success: true, data: r });
    } catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  // ============ INBOX ============
  app.get('/approval-inbox', async (req, reply) => {
    const auth = req.headers.authorization;
    const actor = uid(auth);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const r = role(auth);
    return reply.send({ success: true, data: { items: listPendingForReviewer(r ?? undefined, actor) } });
  });

  // ============ STATS ============
  app.get('/approval-stats', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getApprovalStats() });
  });
}
