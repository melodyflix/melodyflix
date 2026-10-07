// melodyflix videos - Section 12.11 Deployment Rollback
// Deployment registry per service + auto/manual rollback to last known
// good version, with rollback rules and event history.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type DeployScope = 'videos' | 'auth' | 'channel' | 'notifications' | 'admin' | 'web';
export type DeployStatus = 'pending' | 'deploying' | 'active' | 'superseded' | 'failed' | 'rolled_back';
export type RollbackTrigger = 'auto' | 'manual';

const SCOPES: DeployScope[] = ['videos','auth','channel','notifications','admin','web'];
const STATUSES: DeployStatus[] = ['pending','deploying','active','superseded','failed','rolled_back'];
const TRIGGERS: RollbackTrigger[] = ['auto','manual'];

export function ensureRollbackSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS deployments (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      version TEXT NOT NULL,
      git_sha TEXT,
      image_tag TEXT,
      artifact_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      deployed_by TEXT,
      health_check_url TEXT,
      notes TEXT,
      activated_at TEXT,
      failed_at TEXT,
      rolled_back_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_deploy_scope_status ON deployments(scope, status, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_deploy_scope_version ON deployments(scope, version);

    CREATE TABLE IF NOT EXISTS rollback_rules (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      error_rate_threshold REAL NOT NULL DEFAULT 0.05,
      error_window_seconds INTEGER NOT NULL DEFAULT 300,
      min_requests INTEGER NOT NULL DEFAULT 100,
      auto_rollback INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_rollback_rule_scope ON rollback_rules(scope);

    CREATE TABLE IF NOT EXISTS rollback_events (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      from_deployment_id TEXT NOT NULL,
      to_deployment_id TEXT,
      reason TEXT,
      triggered_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rollback_scope_time ON rollback_events(scope, created_at DESC);
  `);
}

export interface Deployment {
  id: string;
  scope: DeployScope;
  version: string;
  git_sha: string | null;
  image_tag: string | null;
  artifact_url: string | null;
  status: DeployStatus;
  deployed_by: string | null;
  health_check_url: string | null;
  notes: string | null;
  activated_at: string | null;
  failed_at: string | null;
  rolled_back_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RollbackRule {
  id: string;
  scope: DeployScope;
  error_rate_threshold: number;
  error_window_seconds: number;
  min_requests: number;
  auto_rollback: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface RollbackEvent {
  id: string;
  scope: DeployScope;
  from_deployment_id: string;
  to_deployment_id: string | null;
  reason: string | null;
  triggered_by: RollbackTrigger;
  created_at: string;
}

// ---------- Deployments ----------
export interface CreateDeploymentInput {
  scope: DeployScope;
  version: string;
  git_sha?: string | null;
  image_tag?: string | null;
  artifact_url?: string | null;
  deployed_by?: string | null;
  health_check_url?: string | null;
  notes?: string | null;
}

export function createDeployment(input: CreateDeploymentInput): Deployment {
  if (!SCOPES.includes(input.scope)) throw new Error('invalid_scope');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO deployments
      (id, scope, version, git_sha, image_tag, artifact_url, status, deployed_by,
       health_check_url, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
  `).run(id, input.scope, input.version, input.git_sha ?? null, input.image_tag ?? null,
    input.artifact_url ?? null, input.deployed_by ?? null, input.health_check_url ?? null,
    input.notes ?? null, now, now);
  return getDeployment(id)!;
}

export function getDeployment(id: string): Deployment | null {
  return (getDb().prepare('SELECT * FROM deployments WHERE id = ?').get(id) as Deployment | undefined) ?? null;
}

export function listDeployments(filter?: { scope?: DeployScope; status?: DeployStatus; limit?: number }): Deployment[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter?.scope) { where.push('scope = ?'); args.push(filter.scope); }
  if (filter?.status) { where.push('status = ?'); args.push(filter.status); }
  const sql = `SELECT * FROM deployments ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args) as Deployment[];
}

export function getActiveDeployment(scope: DeployScope): Deployment | null {
  return (getDb().prepare(
    "SELECT * FROM deployments WHERE scope = ? AND status = 'active' ORDER BY activated_at DESC LIMIT 1"
  ).get(scope) as Deployment | undefined) ?? null;
}

export function getPreviousActive(scope: DeployScope, excludeId: string): Deployment | null {
  return (getDb().prepare(`
    SELECT * FROM deployments
    WHERE scope = ? AND id != ? AND status IN ('active','superseded')
    ORDER BY COALESCE(activated_at, created_at) DESC LIMIT 1
  `).get(scope, excludeId) as Deployment | undefined) ?? null;
}

export function activateDeployment(id: string): Deployment {
  const d = getDeployment(id);
  if (!d) throw new Error('deployment_not_found');
  if (d.status === 'active') return d;
  if (d.status === 'rolled_back' || d.status === 'failed') throw new Error('cannot_activate_' + d.status);
  const db = getDb();
  const now = new Date().toISOString();
  // mark current active as superseded
  db.prepare(`
    UPDATE deployments SET status = 'superseded', updated_at = ?
    WHERE scope = ? AND status = 'active'
  `).run(now, d.scope);
  db.prepare(`
    UPDATE deployments SET status = 'active', activated_at = ?, updated_at = ?
    WHERE id = ?
  `).run(now, now, id);
  return getDeployment(id)!;
}

export function markDeploymentFailed(id: string, reason?: string): Deployment {
  const d = getDeployment(id);
  if (!d) throw new Error('deployment_not_found');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE deployments SET status = 'failed', failed_at = ?, notes = COALESCE(?, notes), updated_at = ?
    WHERE id = ?
  `).run(now, reason ?? null, now, id);
  return getDeployment(id)!;
}

// ---------- Rollback ----------
export interface RollbackInput {
  scope: DeployScope;
  reason?: string;
  triggered_by?: RollbackTrigger;
}

export interface RollbackResult {
  rolled_back: boolean;
  from: Deployment | null;
  to: Deployment | null;
  event: RollbackEvent | null;
  reason: string;
}

export function rollback(input: RollbackInput): RollbackResult {
  if (!SCOPES.includes(input.scope)) throw new Error('invalid_scope');
  const trigger = input.triggered_by ?? 'manual';
  if (!TRIGGERS.includes(trigger)) throw new Error('invalid_trigger');
  const db = getDb();
  const current = getActiveDeployment(input.scope);
  if (!current) {
    return { rolled_back: false, from: null, to: null, event: null, reason: 'no_active_deployment' };
  }
  const previous = getPreviousActive(input.scope, current.id);
  if (!previous) {
    return { rolled_back: false, from: current, to: null, event: null, reason: 'no_previous_active' };
  }
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE deployments SET status = 'rolled_back', rolled_back_at = ?, updated_at = ?
    WHERE id = ?
  `).run(now, now, current.id);
  db.prepare(`
    UPDATE deployments SET status = 'active', activated_at = ?, updated_at = ?
    WHERE id = ?
  `).run(now, now, previous.id);
  const evId = randomUUID();
  db.prepare(`
    INSERT INTO rollback_events
      (id, scope, from_deployment_id, to_deployment_id, reason, triggered_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(evId, input.scope, current.id, previous.id, input.reason ?? null, trigger, now);
  return {
    rolled_back: true,
    from: getDeployment(current.id),
    to: getDeployment(previous.id),
    event: getRollbackEvent(evId),
    reason: 'ok',
  };
}

export function getRollbackEvent(id: string): RollbackEvent | null {
  return (getDb().prepare('SELECT * FROM rollback_events WHERE id = ?').get(id) as RollbackEvent | undefined) ?? null;
}

export function listRollbackEvents(filter?: { scope?: DeployScope; triggered_by?: RollbackTrigger; limit?: number }): RollbackEvent[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter?.scope) { where.push('scope = ?'); args.push(filter.scope); }
  if (filter?.triggered_by) { where.push('triggered_by = ?'); args.push(filter.triggered_by); }
  const sql = `SELECT * FROM rollback_events ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args) as RollbackEvent[];
}

// ---------- Rules ----------
export interface RuleInput {
  scope: DeployScope;
  error_rate_threshold?: number;
  error_window_seconds?: number;
  min_requests?: number;
  auto_rollback?: boolean;
  enabled?: boolean;
}

export function upsertRollbackRule(input: RuleInput): RollbackRule {
  if (!SCOPES.includes(input.scope)) throw new Error('invalid_scope');
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM rollback_rules WHERE scope = ?')
    .get(input.scope) as RollbackRule | undefined;
  if (existing) {
    db.prepare(`
      UPDATE rollback_rules SET error_rate_threshold = ?, error_window_seconds = ?,
        min_requests = ?, auto_rollback = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(input.error_rate_threshold ?? existing.error_rate_threshold,
      input.error_window_seconds ?? existing.error_window_seconds,
      input.min_requests ?? existing.min_requests,
      input.auto_rollback === undefined ? existing.auto_rollback : (input.auto_rollback ? 1 : 0),
      input.enabled === undefined ? existing.enabled : (input.enabled ? 1 : 0),
      now, existing.id);
    return getRollbackRule(input.scope)!;
  }
  const id = randomUUID();
  db.prepare(`
    INSERT INTO rollback_rules
      (id, scope, error_rate_threshold, error_window_seconds, min_requests, auto_rollback, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.scope, input.error_rate_threshold ?? 0.05,
    input.error_window_seconds ?? 300, input.min_requests ?? 100,
    input.auto_rollback === false ? 0 : 1, input.enabled === false ? 0 : 1, now, now);
  return getRollbackRule(input.scope)!;
}

export function getRollbackRule(scope: DeployScope): RollbackRule | null {
  return (getDb().prepare('SELECT * FROM rollback_rules WHERE scope = ?').get(scope) as RollbackRule | undefined) ?? null;
}

export function listRollbackRules(): RollbackRule[] {
  return getDb().prepare('SELECT * FROM rollback_rules ORDER BY scope').all() as RollbackRule[];
}

export function deleteRollbackRule(scope: DeployScope): boolean {
  return getDb().prepare('DELETE FROM rollback_rules WHERE scope = ?').run(scope).changes > 0;
}

// ---------- Auto-rollback evaluation ----------
export interface AutoRollbackResult {
  scope: DeployScope;
  evaluated: boolean;
  triggered: boolean;
  reason: string;
  result?: RollbackResult;
}

export function evaluateAutoRollback(scope: DeployScope, metrics: {
  error_rate: number;
  requests: number;
}): AutoRollbackResult {
  const rule = getRollbackRule(scope);
  if (!rule) return { scope, evaluated: false, triggered: false, reason: 'no_rule' };
  if (!rule.enabled || !rule.auto_rollback) return { scope, evaluated: false, triggered: false, reason: 'disabled' };
  if (metrics.requests < rule.min_requests) {
    return { scope, evaluated: true, triggered: false, reason: 'below_min_requests' };
  }
  if (metrics.error_rate < rule.error_rate_threshold) {
    return { scope, evaluated: true, triggered: false, reason: 'error_rate_ok' };
  }
  const result = rollback({
    scope,
    reason: `auto:error_rate_${metrics.error_rate.toFixed(4)}>=${rule.error_rate_threshold}`,
    triggered_by: 'auto',
  });
  return { scope, evaluated: true, triggered: result.rolled_back, reason: result.reason, result };
}

// ---------- Stats ----------
export interface RollbackStats {
  total_deployments: number;
  by_status: Record<string, number>;
  by_scope: Record<string, number>;
  active_per_scope: Record<string, number>;
  total_rollbacks: number;
  auto_rollbacks: number;
  manual_rollbacks: number;
  total_rules: number;
}

export function getRollbackStats(): RollbackStats {
  const db = getDb();
  const deps = db.prepare('SELECT scope, status FROM deployments').all() as
    { scope: string; status: string }[];
  const byStatus: Record<string, number> = {};
  const byScope: Record<string, number> = {};
  const activePerScope: Record<string, number> = {};
  for (const d of deps) {
    byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
    byScope[d.scope] = (byScope[d.scope] ?? 0) + 1;
    if (d.status === 'active') activePerScope[d.scope] = (activePerScope[d.scope] ?? 0) + 1;
  }
  const ev = db.prepare(`
    SELECT
      SUM(CASE WHEN triggered_by = 'auto' THEN 1 ELSE 0 END) AS a,
      SUM(CASE WHEN triggered_by = 'manual' THEN 1 ELSE 0 END) AS m,
      COUNT(*) AS total
    FROM rollback_events
  `).get() as { a: number | null; m: number | null; total: number };
  const rules = db.prepare('SELECT COUNT(*) AS c FROM rollback_rules').get() as { c: number };
  return {
    total_deployments: deps.length,
    by_status: byStatus,
    by_scope: byScope,
    active_per_scope: activePerScope,
    total_rollbacks: ev.total,
    auto_rollbacks: ev.a ?? 0,
    manual_rollbacks: ev.m ?? 0,
    total_rules: rules.c,
  };
}
