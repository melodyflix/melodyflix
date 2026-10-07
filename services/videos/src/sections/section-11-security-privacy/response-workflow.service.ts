// melodyflix videos - Section 11.21 Response Workflow
// Playbook-driven incident response. Playbooks contain ordered steps;
// a "run" executes them against a specific incident with per-step logs.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type PlaybookAction =
  | 'block_ip' | 'block_user' | 'revoke_sessions'
  | 'notify_admin' | 'notify_user' | 'create_ticket'
  | 'escalate' | 'manual';

export type RunStatus = 'pending' | 'running' | 'completed' | 'aborted' | 'failed';
export type StepStatus = 'pending' | 'in_progress' | 'done' | 'skipped' | 'failed';

export interface Playbook {
  id: string;
  name: string;
  description: string | null;
  incident_source: string;
  min_severity: string;
  is_active: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  step_count?: number;
}

export interface PlaybookStep {
  id: string;
  playbook_id: string;
  step_order: number;
  title: string;
  description: string | null;
  action_type: PlaybookAction;
  action_config: string | null;
  timeout_seconds: number | null;
  required: number;
  created_at: string;
}

export interface ResponseRun {
  id: string;
  playbook_id: string;
  incident_id: string;
  status: RunStatus;
  started_by: string | null;
  started_at: string;
  completed_at: string | null;
  current_step_order: number;
  notes: string | null;
  step_count?: number;
  done_count?: number;
}

export interface ResponseRunLog {
  id: string;
  run_id: string;
  step_id: string;
  step_order: number;
  step_title: string;
  status: StepStatus;
  started_at: string | null;
  completed_at: string | null;
  output: string | null;
  error: string | null;
  executed_by: string | null;
}

export function ensureResponseWorkflowSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS response_playbooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      incident_source TEXT NOT NULL DEFAULT 'any',
      min_severity TEXT NOT NULL DEFAULT 'low'
        CHECK (min_severity IN ('low','medium','high','critical')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_response_playbooks_source
      ON response_playbooks(incident_source, is_active);

    CREATE TABLE IF NOT EXISTS response_playbook_steps (
      id TEXT PRIMARY KEY,
      playbook_id TEXT NOT NULL,
      step_order INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      action_type TEXT NOT NULL
        CHECK (action_type IN ('block_ip','block_user','revoke_sessions','notify_admin','notify_user','create_ticket','escalate','manual')),
      action_config TEXT,
      timeout_seconds INTEGER,
      required INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      UNIQUE (playbook_id, step_order)
    );
    CREATE INDEX IF NOT EXISTS idx_response_steps_playbook
      ON response_playbook_steps(playbook_id, step_order);

    CREATE TABLE IF NOT EXISTS response_runs (
      id TEXT PRIMARY KEY,
      playbook_id TEXT NOT NULL,
      incident_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','running','completed','aborted','failed')),
      started_by TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      current_step_order INTEGER NOT NULL DEFAULT 0,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_response_runs_incident
      ON response_runs(incident_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_response_runs_playbook
      ON response_runs(playbook_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS response_run_logs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      step_order INTEGER NOT NULL,
      step_title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','in_progress','done','skipped','failed')),
      started_at TEXT,
      completed_at TEXT,
      output TEXT,
      error TEXT,
      executed_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_response_logs_run
      ON response_run_logs(run_id, step_order);
  `);
}

// ---------- Playbooks ----------

export interface CreatePlaybookInput {
  name: string;
  description?: string | null;
  incident_source?: string;
  min_severity?: string;
  steps?: AddStepInput[];
}

export interface AddStepInput {
  step_order?: number;
  title: string;
  description?: string | null;
  action_type: PlaybookAction;
  action_config?: Record<string, unknown> | null;
  timeout_seconds?: number | null;
  required?: boolean;
}

export function createPlaybook(input: CreatePlaybookInput, createdBy: string | null): Playbook & { steps: PlaybookStep[] } {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO response_playbooks
     (id, name, description, incident_source, min_severity, is_active, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  ).run(
    id, input.name, input.description ?? null,
    input.incident_source ?? 'any',
    input.min_severity ?? 'low',
    createdBy, now, now,
  );
  if (input.steps?.length) {
    let order = 1;
    for (const s of input.steps) {
      addPlaybookStep(id, { ...s, step_order: s.step_order ?? order });
      order++;
    }
  }
  return getPlaybook(id)!;
}

export function getPlaybook(id: string): (Playbook & { steps: PlaybookStep[] }) | null {
  const db = getDb();
  const pb = db.prepare(`SELECT * FROM response_playbooks WHERE id = ?`).get(id) as Playbook | undefined;
  if (!pb) return null;
  const steps = db.prepare(
    `SELECT * FROM response_playbook_steps WHERE playbook_id = ? ORDER BY step_order ASC`,
  ).all(id) as PlaybookStep[];
  return { ...pb, steps };
}

export function listPlaybooks(opts: { source?: string; active_only?: boolean } = {}): Playbook[] {
  const db = getDb();
  const cond: string[] = [];
  const params: unknown[] = [];
  if (opts.source) { cond.push('incident_source = ?'); params.push(opts.source); }
  if (opts.active_only) cond.push('is_active = 1');
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  return db.prepare(
    `SELECT p.*, (SELECT COUNT(*) FROM response_playbook_steps s WHERE s.playbook_id = p.id) AS step_count
     FROM response_playbooks p ${where} ORDER BY p.created_at DESC`,
  ).all(...params) as Playbook[];
}

export interface UpdatePlaybookInput {
  name?: string;
  description?: string | null;
  incident_source?: string;
  min_severity?: string;
  is_active?: boolean;
}

export function updatePlaybook(id: string, patch: UpdatePlaybookInput): (Playbook & { steps: PlaybookStep[] }) | null {
  const db = getDb();
  const existing = db.prepare(`SELECT id FROM response_playbooks WHERE id = ?`).get(id);
  if (!existing) return null;
  const f: string[] = [];
  const v: unknown[] = [];
  if (patch.name !== undefined) { f.push('name = ?'); v.push(patch.name); }
  if (patch.description !== undefined) { f.push('description = ?'); v.push(patch.description); }
  if (patch.incident_source !== undefined) { f.push('incident_source = ?'); v.push(patch.incident_source); }
  if (patch.min_severity !== undefined) { f.push('min_severity = ?'); v.push(patch.min_severity); }
  if (patch.is_active !== undefined) { f.push('is_active = ?'); v.push(patch.is_active ? 1 : 0); }
  if (!f.length) return getPlaybook(id);
  f.push('updated_at = ?'); v.push(new Date().toISOString());
  v.push(id);
  db.prepare(`UPDATE response_playbooks SET ${f.join(', ')} WHERE id = ?`).run(...v);
  return getPlaybook(id);
}

export function addPlaybookStep(playbookId: string, input: AddStepInput): PlaybookStep {
  const db = getDb();
  let order = input.step_order;
  if (order === undefined) {
    const row = db.prepare(
      `SELECT COALESCE(MAX(step_order),0) AS m FROM response_playbook_steps WHERE playbook_id = ?`,
    ).get(playbookId) as { m: number };
    order = row.m + 1;
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO response_playbook_steps
     (id, playbook_id, step_order, title, description, action_type, action_config, timeout_seconds, required, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, playbookId, order, input.title, input.description ?? null,
    input.action_type,
    input.action_config ? JSON.stringify(input.action_config) : null,
    input.timeout_seconds ?? null,
    input.required === false ? 0 : 1,
    now,
  );
  db.prepare(`UPDATE response_playbooks SET updated_at = ? WHERE id = ?`).run(now, playbookId);
  return db.prepare(`SELECT * FROM response_playbook_steps WHERE id = ?`).get(id) as PlaybookStep;
}

export function updatePlaybookStep(stepId: string, patch: Partial<AddStepInput>): PlaybookStep | null {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM response_playbook_steps WHERE id = ?`).get(stepId) as PlaybookStep | undefined;
  if (!existing) return null;
  const f: string[] = [];
  const v: unknown[] = [];
  if (patch.step_order !== undefined) { f.push('step_order = ?'); v.push(patch.step_order); }
  if (patch.title !== undefined) { f.push('title = ?'); v.push(patch.title); }
  if (patch.description !== undefined) { f.push('description = ?'); v.push(patch.description); }
  if (patch.action_type !== undefined) { f.push('action_type = ?'); v.push(patch.action_type); }
  if (patch.action_config !== undefined) {
    f.push('action_config = ?');
    v.push(patch.action_config ? JSON.stringify(patch.action_config) : null);
  }
  if (patch.timeout_seconds !== undefined) { f.push('timeout_seconds = ?'); v.push(patch.timeout_seconds); }
  if (patch.required !== undefined) { f.push('required = ?'); v.push(patch.required ? 1 : 0); }
  if (!f.length) return existing;
  v.push(stepId);
  db.prepare(`UPDATE response_playbook_steps SET ${f.join(', ')} WHERE id = ?`).run(...v);
  return db.prepare(`SELECT * FROM response_playbook_steps WHERE id = ?`).get(stepId) as PlaybookStep;
}

export function removePlaybookStep(stepId: string): boolean {
  const db = getDb();
  const r = db.prepare(`DELETE FROM response_playbook_steps WHERE id = ?`).run(stepId);
  return r.changes > 0;
}

// ---------- Runs ----------

export function startRun(
  incidentId: string,
  playbookId: string,
  startedBy: string | null,
  notes?: string,
): ResponseRun & { logs: ResponseRunLog[] } {
  const db = getDb();
  const pb = db.prepare(`SELECT id FROM response_playbooks WHERE id = ?`).get(playbookId);
  if (!pb) throw new Error('playbook_not_found');
  const steps = db.prepare(
    `SELECT * FROM response_playbook_steps WHERE playbook_id = ? ORDER BY step_order ASC`,
  ).all(playbookId) as PlaybookStep[];
  const now = new Date().toISOString();
  const runId = randomUUID();
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO response_runs
       (id, playbook_id, incident_id, status, started_by, started_at, current_step_order, notes)
       VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`,
    ).run(runId, playbookId, incidentId, startedBy, now, steps[0]?.step_order ?? 0, notes ?? null);
    for (const s of steps) {
      db.prepare(
        `INSERT INTO response_run_logs (id, run_id, step_id, step_order, step_title, status)
         VALUES (?, ?, ?, ?, ?, 'pending')`,
      ).run(randomUUID(), runId, s.id, s.step_order, s.title);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return getRun(runId)!;
}

export function getRun(id: string): (ResponseRun & { logs: ResponseRunLog[] }) | null {
  const db = getDb();
  const r = db.prepare(`SELECT * FROM response_runs WHERE id = ?`).get(id) as ResponseRun | undefined;
  if (!r) return null;
  const logs = db.prepare(
    `SELECT * FROM response_run_logs WHERE run_id = ? ORDER BY step_order ASC`,
  ).all(id) as ResponseRunLog[];
  return { ...r, logs };
}

export function listRunsForIncident(incidentId: string): ResponseRun[] {
  const db = getDb();
  return db.prepare(
    `SELECT r.*,
       (SELECT COUNT(*) FROM response_run_logs l WHERE l.run_id = r.id) AS step_count,
       (SELECT COUNT(*) FROM response_run_logs l WHERE l.run_id = r.id AND l.status = 'done') AS done_count
     FROM response_runs r WHERE incident_id = ? ORDER BY started_at DESC`,
  ).all(incidentId) as ResponseRun[];
}

export function listRuns(opts: { status?: RunStatus; limit?: number } = {}): ResponseRun[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const base = `SELECT r.*,
       (SELECT COUNT(*) FROM response_run_logs l WHERE l.run_id = r.id) AS step_count,
       (SELECT COUNT(*) FROM response_run_logs l WHERE l.run_id = r.id AND l.status = 'done') AS done_count
     FROM response_runs r`;
  if (opts.status) {
    return db.prepare(`${base} WHERE status = ? ORDER BY started_at DESC LIMIT ?`)
      .all(opts.status, limit) as ResponseRun[];
  }
  return db.prepare(`${base} ORDER BY started_at DESC LIMIT ?`).all(limit) as ResponseRun[];
}

export interface ExecuteStepInput {
  status: 'done' | 'skipped' | 'failed';
  output?: string | null;
  error?: string | null;
}

export function executeStep(
  runId: string, stepId: string, input: ExecuteStepInput, executedBy: string | null,
): ResponseRunLog | null {
  const db = getDb();
  const run = db.prepare(`SELECT * FROM response_runs WHERE id = ?`).get(runId) as ResponseRun | undefined;
  if (!run) return null;
  if (run.status !== 'running' && run.status !== 'pending') return null;
  const log = db.prepare(
    `SELECT * FROM response_run_logs WHERE run_id = ? AND step_id = ?`,
  ).get(runId, stepId) as ResponseRunLog | undefined;
  if (!log) return null;
  if (log.status !== 'pending' && log.status !== 'in_progress') return null;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE response_run_logs SET
       status = ?, started_at = COALESCE(started_at, ?), completed_at = ?,
       output = ?, error = ?, executed_by = ?
     WHERE id = ?`,
  ).run(input.status, now, now, input.output ?? null, input.error ?? null, executedBy, log.id);

  const next = db.prepare(
    `SELECT step_order FROM response_run_logs WHERE run_id = ? AND status = 'pending' ORDER BY step_order ASC LIMIT 1`,
  ).get(runId) as { step_order: number } | undefined;
  if (next) {
    db.prepare(`UPDATE response_runs SET current_step_order = ? WHERE id = ?`).run(next.step_order, runId);
  } else {
    const failed = db.prepare(
      `SELECT COUNT(*) AS c FROM response_run_logs WHERE run_id = ? AND status = 'failed'`,
    ).get(runId) as { c: number };
    const finalStatus = failed.c > 0 ? 'failed' : 'completed';
    db.prepare(`UPDATE response_runs SET status = ?, completed_at = ? WHERE id = ?`)
      .run(finalStatus, now, runId);
  }
  return db.prepare(`SELECT * FROM response_run_logs WHERE id = ?`).get(log.id) as ResponseRunLog;
}

export function abortRun(runId: string, _adminId: string | null, reason?: string): (ResponseRun & { logs: ResponseRunLog[] }) | null {
  const db = getDb();
  const run = db.prepare(`SELECT * FROM response_runs WHERE id = ?`).get(runId) as ResponseRun | undefined;
  if (!run) return null;
  if (run.status === 'completed' || run.status === 'aborted') return getRun(runId);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE response_runs SET status = 'aborted', completed_at = ?, notes = COALESCE(?, notes) WHERE id = ?`,
  ).run(now, reason ? `ABORT: ${reason}` : null, runId);
  db.prepare(
    `UPDATE response_run_logs SET status = 'skipped', completed_at = ? WHERE run_id = ? AND status = 'pending'`,
  ).run(now, runId);
  return getRun(runId);
}

export interface ResponseStats {
  active_runs: number;
  completed_runs: number;
  failed_runs: number;
  aborted_runs: number;
  playbooks_active: number;
  avg_completion_seconds: number | null;
}

export function getResponseStats(windowDays = 30): ResponseStats {
  const db = getDb();
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const active = db.prepare(`SELECT COUNT(*) AS c FROM response_runs WHERE status IN ('pending','running')`).get() as { c: number };
  const completed = db.prepare(`SELECT COUNT(*) AS c FROM response_runs WHERE status = 'completed' AND started_at >= ?`).get(since) as { c: number };
  const failed = db.prepare(`SELECT COUNT(*) AS c FROM response_runs WHERE status = 'failed' AND started_at >= ?`).get(since) as { c: number };
  const aborted = db.prepare(`SELECT COUNT(*) AS c FROM response_runs WHERE status = 'aborted' AND started_at >= ?`).get(since) as { c: number };
  const pbs = db.prepare(`SELECT COUNT(*) AS c FROM response_playbooks WHERE is_active = 1`).get() as { c: number };
  const avg = db.prepare(
    `SELECT AVG((julianday(completed_at) - julianday(started_at)) * 86400.0) AS avg_s
     FROM response_runs WHERE status = 'completed' AND completed_at IS NOT NULL AND started_at >= ?`,
  ).get(since) as { avg_s: number | null };
  return {
    active_runs: active.c,
    completed_runs: completed.c,
    failed_runs: failed.c,
    aborted_runs: aborted.c,
    playbooks_active: pbs.c,
    avg_completion_seconds: avg.avg_s ?? null,
  };
}
