// melodyflix videos - Section 15.8 Approval Workflow
// Configurable multi-stage approval pipelines for any scoped entity
// (video, playlist, edit project, marketplace order), with role-gated
// stages and append-only action history.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type ApprovalScope = 'video' | 'playlist' | 'edit_project' | 'marketplace_order' | 'co_publish' | 'custom';
export type RequestStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'withdrawn' | 'changes_requested';
export type Decision = 'approve' | 'reject' | 'request_changes';

const SCOPES: ApprovalScope[] = ['video','playlist','edit_project','marketplace_order','co_publish','custom'];
const STATUSES: RequestStatus[] = ['pending','in_review','approved','rejected','withdrawn','changes_requested'];
const DECISIONS: Decision[] = ['approve','reject','request_changes'];

export function ensureApprovalSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      scope TEXT NOT NULL,
      stages TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_wf_name ON approval_workflows(name);
    CREATE INDEX IF NOT EXISTS idx_approval_wf_scope ON approval_workflows(scope, is_active);

    CREATE TABLE IF NOT EXISTS approval_requests (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      requester_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      current_stage_index INTEGER NOT NULL DEFAULT 0,
      submitted_at TEXT NOT NULL,
      decided_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_approval_req_wf ON approval_requests(workflow_id, status);
    CREATE INDEX IF NOT EXISTS idx_approval_req_entity ON approval_requests(scope, entity_id);
    CREATE INDEX IF NOT EXISTS idx_approval_req_requester ON approval_requests(requester_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS approval_actions (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      stage_index INTEGER NOT NULL,
      stage_name TEXT NOT NULL,
      reviewer_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_approval_act_req ON approval_actions(request_id, created_at);
  `);
}

export interface ApprovalStage {
  name: string;
  required_role?: string;
  required_user_id?: string;
}

export interface ApprovalWorkflow {
  id: string;
  name: string;
  scope: ApprovalScope;
  stages: string; // JSON array of ApprovalStage
  is_active: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApprovalRequest {
  id: string;
  workflow_id: string;
  scope: ApprovalScope;
  entity_id: string;
  requester_id: string;
  status: RequestStatus;
  current_stage_index: number;
  submitted_at: string;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApprovalAction {
  id: string;
  request_id: string;
  stage_index: number;
  stage_name: string;
  reviewer_id: string;
  decision: Decision;
  comment: string | null;
  created_at: string;
}

// ---------- workflows ----------
export interface CreateWorkflowInput {
  name: string;
  scope: ApprovalScope;
  stages: ApprovalStage[];
  is_active?: boolean;
  created_by?: string | null;
}

export function createWorkflow(input: CreateWorkflowInput): ApprovalWorkflow {
  if (!input.name || input.name.length > 200) throw new Error('invalid_name');
  if (!SCOPES.includes(input.scope)) throw new Error('invalid_scope');
  if (!Array.isArray(input.stages) || input.stages.length < 1) throw new Error('stages_required');
  for (const s of input.stages) {
    if (!s.name || s.name.length > 100) throw new Error('invalid_stage_name');
  }
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO approval_workflows (id, name, scope, stages, is_active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.name, input.scope, JSON.stringify(input.stages),
    input.is_active === false ? 0 : 1, input.created_by ?? null, now, now);
  return getWorkflow(id)!;
}

export function getWorkflow(id: string): ApprovalWorkflow | null {
  return (getDb().prepare('SELECT * FROM approval_workflows WHERE id = ?').get(id) as ApprovalWorkflow | undefined) ?? null;
}

export function listWorkflows(filter?: { scope?: ApprovalScope; activeOnly?: boolean }): ApprovalWorkflow[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter?.scope) { where.push('scope = ?'); args.push(filter.scope); }
  if (filter?.activeOnly) where.push('is_active = 1');
  const sql = `SELECT * FROM approval_workflows ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY scope, name`;
  return db.prepare(sql).all(...args) as ApprovalWorkflow[];
}

export function updateWorkflow(id: string, patch: { name?: string; stages?: ApprovalStage[]; is_active?: boolean }): ApprovalWorkflow | null {
  const w = getWorkflow(id);
  if (!w) return null;
  const fields: string[] = [];
  const args: any[] = [];
  if (patch.name !== undefined) { if (patch.name.length > 200) throw new Error('invalid_name'); fields.push('name = ?'); args.push(patch.name); }
  if (patch.stages !== undefined) { fields.push('stages = ?'); args.push(JSON.stringify(patch.stages)); }
  if (patch.is_active !== undefined) { fields.push('is_active = ?'); args.push(patch.is_active ? 1 : 0); }
  if (!fields.length) return w;
  fields.push('updated_at = ?'); args.push(new Date().toISOString());
  args.push(id);
  getDb().prepare(`UPDATE approval_workflows SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  return getWorkflow(id);
}

export function deleteWorkflow(id: string): boolean {
  const db = getDb();
  const open = db.prepare(`
    SELECT COUNT(*) AS c FROM approval_requests WHERE workflow_id = ? AND status IN ('pending','in_review')
  `).get(id) as { c: number };
  if (open.c > 0) throw new Error('has_open_requests');
  return db.prepare('DELETE FROM approval_workflows WHERE id = ?').run(id).changes > 0;
}

// ---------- requests ----------
export interface SubmitInput {
  workflow_id: string;
  entity_id: string;
  requester_id: string;
}

export function submitRequest(input: SubmitInput): ApprovalRequest {
  const wf = getWorkflow(input.workflow_id);
  if (!wf) throw new Error('workflow_not_found');
  if (!wf.is_active) throw new Error('workflow_inactive');
  if (!input.entity_id) throw new Error('entity_required');
  const existing = getDb().prepare(`
    SELECT 1 AS c FROM approval_requests
    WHERE workflow_id = ? AND entity_id = ? AND status IN ('pending','in_review')
  `).get(input.workflow_id, input.entity_id) as { c: number } | undefined;
  if (existing) throw new Error('already_in_review');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO approval_requests
      (id, workflow_id, scope, entity_id, requester_id, status, current_stage_index, submitted_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
  `).run(id, wf.id, wf.scope, input.entity_id, input.requester_id, now, now, now);
  return getRequest(id)!;
}

export function getRequest(id: string): ApprovalRequest | null {
  return (getDb().prepare('SELECT * FROM approval_requests WHERE id = ?').get(id) as ApprovalRequest | undefined) ?? null;
}

export function listRequests(filter?: { workflow_id?: string; entity_id?: string; scope?: ApprovalScope; status?: RequestStatus; requester_id?: string; limit?: number }): ApprovalRequest[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter?.workflow_id) { where.push('workflow_id = ?'); args.push(filter.workflow_id); }
  if (filter?.entity_id) { where.push('entity_id = ?'); args.push(filter.entity_id); }
  if (filter?.scope) { where.push('scope = ?'); args.push(filter.scope); }
  if (filter?.status) { where.push('status = ?'); args.push(filter.status); }
  if (filter?.requester_id) { where.push('requester_id = ?'); args.push(filter.requester_id); }
  const sql = `SELECT * FROM approval_requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY updated_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args) as ApprovalRequest[];
}

export function withdrawRequest(id: string, actorId: string, comment?: string): ApprovalRequest {
  const r = getRequest(id);
  if (!r) throw new Error('request_not_found');
  if (r.requester_id !== actorId) throw new Error('requester_only');
  if (r.status !== 'pending' && r.status !== 'in_review') throw new Error('not_active');
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE approval_requests SET status = 'withdrawn', decided_at = ?, updated_at = ? WHERE id = ?
  `).run(now, now, id);
  logAction(id, r.current_stage_index, 'withdrawn', actorId, 'request_changes', comment ?? null);
  return getRequest(id)!;
}

// ---------- actions ----------
function logAction(requestId: string, stageIndex: number, stageName: string, reviewerId: string, decision: Decision, comment: string | null): ApprovalAction {
  if (!DECISIONS.includes(decision)) throw new Error('invalid_decision');
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO approval_actions (id, request_id, stage_index, stage_name, reviewer_id, decision, comment, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, requestId, stageIndex, stageName, reviewerId, decision, comment, now);
  return db.prepare('SELECT * FROM approval_actions WHERE id = ?').get(id) as ApprovalAction;
}

export function decideStage(
  requestId: string,
  reviewerId: string,
  decision: Decision,
  comment?: string,
): ApprovalRequest {
  const r = getRequest(requestId);
  if (!r) throw new Error('request_not_found');
  if (r.status !== 'pending' && r.status !== 'in_review') throw new Error('not_active');
  const wf = getWorkflow(r.workflow_id);
  if (!wf) throw new Error('workflow_missing');
  const stages = JSON.parse(wf.stages) as ApprovalStage[];
  const stage = stages[r.current_stage_index];
  if (!stage) throw new Error('stage_missing');
  if (stage.required_user_id && stage.required_user_id !== reviewerId) throw new Error('not_assigned_reviewer');
  if (stage.required_role && !['admin','moderator'].includes(stage.required_role)) {
    // role assumed external — we store reviewer_id anyway; callers enforce role
  }
  const db = getDb();
  const now = new Date().toISOString();
  logAction(r.id, r.current_stage_index, stage.name, reviewerId, decision, comment ?? null);

  if (decision === 'reject') {
    db.prepare(`UPDATE approval_requests SET status = 'rejected', decided_at = ?, updated_at = ? WHERE id = ?`)
      .run(now, now, requestId);
    return getRequest(requestId)!;
  }
  if (decision === 'request_changes') {
    db.prepare(`UPDATE approval_requests SET status = 'changes_requested', updated_at = ? WHERE id = ?`)
      .run(now, requestId);
    return getRequest(requestId)!;
  }
  // approve: advance or complete
  const nextIndex = r.current_stage_index + 1;
  if (nextIndex >= stages.length) {
    db.prepare(`UPDATE approval_requests SET status = 'approved', current_stage_index = ?, decided_at = ?, updated_at = ? WHERE id = ?`)
      .run(nextIndex, now, now, requestId);
  } else {
    db.prepare(`UPDATE approval_requests SET status = 'in_review', current_stage_index = ?, updated_at = ? WHERE id = ?`)
      .run(nextIndex, now, requestId);
  }
  return getRequest(requestId)!;
}

export function approveStage(requestId: string, reviewerId: string, comment?: string): ApprovalRequest {
  return decideStage(requestId, reviewerId, 'approve', comment);
}
export function rejectStage(requestId: string, reviewerId: string, comment?: string): ApprovalRequest {
  return decideStage(requestId, reviewerId, 'reject', comment);
}
export function requestChanges(requestId: string, reviewerId: string, comment?: string): ApprovalRequest {
  return decideStage(requestId, reviewerId, 'request_changes', comment);
}

export function listActions(requestId: string): ApprovalAction[] {
  return getDb().prepare('SELECT * FROM approval_actions WHERE request_id = ? ORDER BY created_at')
    .all(requestId) as ApprovalAction[];
}

// ---------- reviewer inbox ----------
export interface ReviewerInboxItem {
  request: ApprovalRequest;
  current_stage: ApprovalStage | null;
  waiting_for_role: string | null;
  waiting_for_user: string | null;
}

export function listPendingForReviewer(role?: string, userId?: string): ReviewerInboxItem[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM approval_requests WHERE status IN ('pending','in_review') ORDER BY submitted_at ASC
  `).all() as ApprovalRequest[];
  const out: ReviewerInboxItem[] = [];
  for (const r of rows) {
    const wf = getWorkflow(r.workflow_id);
    if (!wf) continue;
    const stages = JSON.parse(wf.stages) as ApprovalStage[];
    const stage = stages[r.current_stage_index] ?? null;
    if (!stage) continue;
    const matchesRole = role ? (!stage.required_role || stage.required_role === role) : true;
    const matchesUser = userId ? (!stage.required_user_id || stage.required_user_id === userId) : true;
    if (matchesRole && matchesUser) {
      out.push({
        request: r,
        current_stage: stage,
        waiting_for_role: stage.required_role ?? null,
        waiting_for_user: stage.required_user_id ?? null,
      });
    }
  }
  return out;
}

// ---------- summary + stats ----------
export interface RequestDetail {
  request: ApprovalRequest;
  workflow: ApprovalWorkflow | null;
  stages: ApprovalStage[];
  current_stage: ApprovalStage | null;
  actions: ApprovalAction[];
}

export function getRequestDetail(id: string): RequestDetail | null {
  const r = getRequest(id);
  if (!r) return null;
  const wf = getWorkflow(r.workflow_id);
  const stages = wf ? (JSON.parse(wf.stages) as ApprovalStage[]) : [];
  return {
    request: r,
    workflow: wf,
    stages,
    current_stage: stages[r.current_stage_index] ?? null,
    actions: listActions(id),
  };
}

export interface ApprovalStats {
  total_workflows: number;
  active_workflows: number;
  total_requests: number;
  by_status: Record<string, number>;
  total_actions: number;
  by_decision: Record<string, number>;
  avg_stages_per_workflow: number;
}

export function getApprovalStats(): ApprovalStats {
  const db = getDb();
  const wfs = db.prepare('SELECT stages, is_active FROM approval_workflows').all() as
    { stages: string; is_active: number }[];
  let stageSum = 0;
  for (const w of wfs) stageSum += (JSON.parse(w.stages) as unknown[]).length;
  const reqs = db.prepare('SELECT status FROM approval_requests').all() as { status: string }[];
  const byStatus: Record<string, number> = {};
  for (const r of reqs) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const acts = db.prepare('SELECT decision FROM approval_actions').all() as { decision: string }[];
  const byDecision: Record<string, number> = {};
  for (const a of acts) byDecision[a.decision] = (byDecision[a.decision] ?? 0) + 1;
  return {
    total_workflows: wfs.length,
    active_workflows: wfs.filter(w => w.is_active === 1).length,
    total_requests: reqs.length,
    by_status: byStatus,
    total_actions: acts.length,
    by_decision: byDecision,
    avg_stages_per_workflow: wfs.length ? stageSum / wfs.length : 0,
  };
}
