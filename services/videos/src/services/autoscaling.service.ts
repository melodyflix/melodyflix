// melodyflix videos - Section 12.10 Auto Scaling
// Target-tracking scaling policies, cooldown windows, decision log,
// and per-service replica state.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type ScalingScope = 'videos' | 'auth' | 'channel' | 'notifications' | 'worker';
export type ScalingAction = 'scale_up' | 'scale_down' | 'no_op';

const SCOPES: ScalingScope[] = ['videos','auth','channel','notifications','worker'];
const ACTIONS: ScalingAction[] = ['scale_up','scale_down','no_op'];

export function ensureAutoscalingSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS scaling_policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      scope TEXT NOT NULL,
      min_replicas INTEGER NOT NULL DEFAULT 1,
      max_replicas INTEGER NOT NULL DEFAULT 10,
      target_cpu_percent REAL NOT NULL DEFAULT 70,
      target_rps_per_replica INTEGER NOT NULL DEFAULT 200,
      scale_up_cooldown_seconds INTEGER NOT NULL DEFAULT 60,
      scale_down_cooldown_seconds INTEGER NOT NULL DEFAULT 300,
      scale_up_step INTEGER NOT NULL DEFAULT 1,
      scale_down_step INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_scaling_policy_name ON scaling_policies(name);
    CREATE INDEX IF NOT EXISTS idx_scaling_policy_scope ON scaling_policies(scope, enabled);

    CREATE TABLE IF NOT EXISTS scaling_state (
      policy_id TEXT PRIMARY KEY,
      active_replicas INTEGER NOT NULL,
      last_action TEXT,
      last_action_at TEXT,
      cooldown_until TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scaling_events (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL,
      action TEXT NOT NULL,
      from_replicas INTEGER NOT NULL,
      to_replicas INTEGER NOT NULL,
      reason TEXT,
      metrics TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scaling_event_policy
      ON scaling_events(policy_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_scaling_event_action
      ON scaling_events(action, created_at DESC);
  `);
}

export interface ScalingPolicy {
  id: string;
  name: string;
  scope: ScalingScope;
  min_replicas: number;
  max_replicas: number;
  target_cpu_percent: number;
  target_rps_per_replica: number;
  scale_up_cooldown_seconds: number;
  scale_down_cooldown_seconds: number;
  scale_up_step: number;
  scale_down_step: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface ScalingState {
  policy_id: string;
  active_replicas: number;
  last_action: ScalingAction | null;
  last_action_at: string | null;
  cooldown_until: string | null;
  updated_at: string;
}

export interface ScalingEvent {
  id: string;
  policy_id: string;
  action: ScalingAction;
  from_replicas: number;
  to_replicas: number;
  reason: string | null;
  metrics: string;
  created_at: string;
}

// ---------- Policies ----------
export interface PolicyInput {
  name: string;
  scope: ScalingScope;
  min_replicas?: number;
  max_replicas?: number;
  target_cpu_percent?: number;
  target_rps_per_replica?: number;
  scale_up_cooldown_seconds?: number;
  scale_down_cooldown_seconds?: number;
  scale_up_step?: number;
  scale_down_step?: number;
  enabled?: boolean;
}

export function upsertPolicy(input: PolicyInput): ScalingPolicy {
  if (!SCOPES.includes(input.scope)) throw new Error('invalid_scope');
  const min = input.min_replicas ?? 1;
  const max = input.max_replicas ?? 10;
  if (min < 1 || max < min) throw new Error('invalid_replica_range');
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM scaling_policies WHERE name = ?')
    .get(input.name) as ScalingPolicy | undefined;
  if (existing) {
    db.prepare(`
      UPDATE scaling_policies SET
        scope = ?, min_replicas = ?, max_replicas = ?, target_cpu_percent = ?,
        target_rps_per_replica = ?, scale_up_cooldown_seconds = ?, scale_down_cooldown_seconds = ?,
        scale_up_step = ?, scale_down_step = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(input.scope, min, max, input.target_cpu_percent ?? existing.target_cpu_percent,
      input.target_rps_per_replica ?? existing.target_rps_per_replica,
      input.scale_up_cooldown_seconds ?? existing.scale_up_cooldown_seconds,
      input.scale_down_cooldown_seconds ?? existing.scale_down_cooldown_seconds,
      input.scale_up_step ?? existing.scale_up_step,
      input.scale_down_step ?? existing.scale_down_step,
      input.enabled === false ? 0 : existing.enabled, now, existing.id);
    return getPolicy(existing.id)!;
  }
  const id = randomUUID();
  db.prepare(`
    INSERT INTO scaling_policies
      (id, name, scope, min_replicas, max_replicas, target_cpu_percent, target_rps_per_replica,
       scale_up_cooldown_seconds, scale_down_cooldown_seconds, scale_up_step, scale_down_step,
       enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.name, input.scope, min, max,
    input.target_cpu_percent ?? 70, input.target_rps_per_replica ?? 200,
    input.scale_up_cooldown_seconds ?? 60, input.scale_down_cooldown_seconds ?? 300,
    input.scale_up_step ?? 1, input.scale_down_step ?? 1,
    input.enabled === false ? 0 : 1, now, now);
  db.prepare(`
    INSERT INTO scaling_state (policy_id, active_replicas, updated_at)
    VALUES (?, ?, ?)
  `).run(id, min, now);
  return getPolicy(id)!;
}

export function getPolicy(id: string): ScalingPolicy | null {
  return (getDb().prepare('SELECT * FROM scaling_policies WHERE id = ?').get(id) as ScalingPolicy | undefined) ?? null;
}

export function listPolicies(filter?: { scope?: ScalingScope; enabledOnly?: boolean }): ScalingPolicy[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter?.scope) { where.push('scope = ?'); args.push(filter.scope); }
  if (filter?.enabledOnly) where.push('enabled = 1');
  const sql = `SELECT * FROM scaling_policies ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY scope, name`;
  return db.prepare(sql).all(...args) as ScalingPolicy[];
}

export function deletePolicy(id: string): boolean {
  const db = getDb();
  db.prepare('DELETE FROM scaling_state WHERE policy_id = ?').run(id);
  return db.prepare('DELETE FROM scaling_policies WHERE id = ?').run(id).changes > 0;
}

// ---------- State ----------
export function getState(policyId: string): ScalingState | null {
  return (getDb().prepare('SELECT * FROM scaling_state WHERE policy_id = ?').get(policyId) as ScalingState | undefined) ?? null;
}

export function setReplicas(policyId: string, replicas: number, reason?: string, metrics?: Record<string, unknown>): ScalingEvent {
  const policy = getPolicy(policyId);
  if (!policy) throw new Error('policy_not_found');
  if (replicas < policy.min_replicas || replicas > policy.max_replicas) throw new Error('replicas_out_of_range');
  const db = getDb();
  const state = getState(policyId);
  if (!state) throw new Error('state_missing');
  const now = new Date().toISOString();
  const id = randomUUID();
  const from = state.active_replicas;
  const action: ScalingAction = replicas > from ? 'scale_up' : replicas < from ? 'scale_down' : 'no_op';
  db.prepare(`
    INSERT INTO scaling_events (id, policy_id, action, from_replicas, to_replicas, reason, metrics, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, policyId, action, from, replicas, reason ?? null, JSON.stringify(metrics ?? {}), now);
  db.prepare(`
    UPDATE scaling_state SET active_replicas = ?, last_action = ?, last_action_at = ?, updated_at = ?
    WHERE policy_id = ?
  `).run(replicas, action, now, now, policyId);
  return getEvent(id)!;
}

export function getEvent(id: string): ScalingEvent | null {
  return (getDb().prepare('SELECT * FROM scaling_events WHERE id = ?').get(id) as ScalingEvent | undefined) ?? null;
}

export function listEvents(filter?: { policy_id?: string; action?: ScalingAction; limit?: number }): ScalingEvent[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter?.policy_id) { where.push('policy_id = ?'); args.push(filter.policy_id); }
  if (filter?.action) { where.push('action = ?'); args.push(filter.action); }
  const sql = `SELECT * FROM scaling_events ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args) as ScalingEvent[];
}

// ---------- Evaluation ----------
export interface MetricsInput {
  cpu_percent?: number;
  rps?: number;
  memory_percent?: number;
  queue_depth?: number;
}

export interface Decision {
  policy_id: string;
  action: ScalingAction;
  current_replicas: number;
  desired_replicas: number;
  reason: string;
  cooldown_active: boolean;
  metrics: MetricsInput;
  applied: boolean;
  event?: ScalingEvent;
}

export function evaluatePolicy(policyId: string, metrics: MetricsInput = {}, apply = false): Decision {
  const policy = getPolicy(policyId);
  if (!policy) throw new Error('policy_not_found');
  const state = getState(policyId);
  if (!state) throw new Error('state_missing');
  const db = getDb();
  const now = new Date();
  const nowIso = now.toISOString();

  const current = state.active_replicas;
  const cooldownUntil = state.cooldown_until ? new Date(state.cooldown_until) : null;
  const cooldownActive = !!cooldownUntil && cooldownUntil > now;

  if (!policy.enabled) {
    return { policy_id: policyId, action: 'no_op', current_replicas: current, desired_replicas: current,
      reason: 'disabled', cooldown_active: false, metrics, applied: false };
  }
  if (cooldownActive) {
    return { policy_id: policyId, action: 'no_op', current_replicas: current, desired_replicas: current,
      reason: 'cooldown_active', cooldown_active: true, metrics, applied: false };
  }

  let desired = current;
  let reason = 'steady';
  let action: ScalingAction = 'no_op';

  if (metrics.cpu_percent !== undefined && metrics.cpu_percent > policy.target_cpu_percent) {
    desired = Math.min(policy.max_replicas, current + policy.scale_up_step);
    reason = `cpu_${metrics.cpu_percent.toFixed(1)}>target_${policy.target_cpu_percent}`;
  } else if (metrics.rps !== undefined) {
    const perReplica = current > 0 ? metrics.rps / current : metrics.rps;
    if (perReplica > policy.target_rps_per_replica) {
      desired = Math.min(policy.max_replicas, current + policy.scale_up_step);
      reason = `rps_per_replica_${perReplica.toFixed(0)}>target_${policy.target_rps_per_replica}`;
    } else if (perReplica * (current - policy.scale_down_step) >= policy.target_rps_per_replica * 0.5
      && current > policy.min_replicas
      && metrics.cpu_percent !== undefined && metrics.cpu_percent < policy.target_cpu_percent * 0.5) {
      desired = Math.max(policy.min_replicas, current - policy.scale_down_step);
      reason = `rps_headroom_and_low_cpu`;
    }
  } else if (metrics.cpu_percent !== undefined && metrics.cpu_percent < policy.target_cpu_percent * 0.5 && current > policy.min_replicas) {
    desired = Math.max(policy.min_replicas, current - policy.scale_down_step);
    reason = `cpu_${metrics.cpu_percent.toFixed(1)}<half_target`;
  }

  if (desired > current) action = 'scale_up';
  else if (desired < current) action = 'scale_down';

  let applied = false;
  let event: ScalingEvent | undefined;
  if (apply && action !== 'no_op') {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO scaling_events (id, policy_id, action, from_replicas, to_replicas, reason, metrics, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, policyId, action, current, desired, reason, JSON.stringify(metrics), nowIso);
    const cooldownSeconds = action === 'scale_up' ? policy.scale_up_cooldown_seconds : policy.scale_down_cooldown_seconds;
    const nextCooldown = new Date(now.getTime() + cooldownSeconds * 1000).toISOString();
    db.prepare(`
      UPDATE scaling_state SET active_replicas = ?, last_action = ?, last_action_at = ?,
        cooldown_until = ?, updated_at = ?
      WHERE policy_id = ?
    `).run(desired, action, nowIso, nextCooldown, nowIso, policyId);
    event = getEvent(id)!;
    applied = true;
  }

  return { policy_id: policyId, action, current_replicas: current, desired_replicas: desired,
    reason, cooldown_active: false, metrics, applied, event };
}

export function evaluateAllPolicies(metrics: MetricsInput = {}, apply = false): Decision[] {
  const policies = listPolicies({ enabledOnly: true });
  return policies.map(p => {
    try { return evaluatePolicy(p.id, metrics, apply); }
    catch { return { policy_id: p.id, action: 'no_op' as ScalingAction, current_replicas: 0,
      desired_replicas: 0, reason: 'error', cooldown_active: false, metrics, applied: false }; }
  });
}

// ---------- Stats ----------
export interface ScalingStats {
  total_policies: number;
  enabled_policies: number;
  by_scope: Record<string, number>;
  total_events: number;
  scale_up_events: number;
  scale_down_events: number;
  total_replicas: number;
}

export function getScalingStats(): ScalingStats {
  const db = getDb();
  const policies = db.prepare('SELECT scope, enabled FROM scaling_policies').all() as
    { scope: string; enabled: number }[];
  const byScope: Record<string, number> = {};
  for (const p of policies) byScope[p.scope] = (byScope[p.scope] ?? 0) + 1;
  const ev = db.prepare(`
    SELECT
      SUM(CASE WHEN action = 'scale_up' THEN 1 ELSE 0 END) AS up,
      SUM(CASE WHEN action = 'scale_down' THEN 1 ELSE 0 END) AS down,
      COUNT(*) AS total
    FROM scaling_events
  `).get() as { up: number | null; down: number | null; total: number };
  const totalRep = db.prepare('SELECT COALESCE(SUM(active_replicas), 0) AS s FROM scaling_state')
    .get() as { s: number };
  return {
    total_policies: policies.length,
    enabled_policies: policies.filter(p => p.enabled === 1).length,
    by_scope: byScope,
    total_events: ev.total,
    scale_up_events: ev.up ?? 0,
    scale_down_events: ev.down ?? 0,
    total_replicas: totalRep.s,
  };
}
