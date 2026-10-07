// melodyflix videos - Section 12.13 Automated Failover
// Multi-target failover: CDN, service, and region scope. Health-driven
// failover evaluation with history, restore, and stats.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type FailoverScope = 'cdn' | 'service' | 'region';
export type FailoverStatus = 'triggered' | 'restored' | 'failed';

const SCOPES: FailoverScope[] = ['cdn','service','region'];
const STATUSES: FailoverStatus[] = ['triggered','restored','failed'];

export function ensureFailoverSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS failover_policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      scope TEXT NOT NULL,
      primary_target TEXT NOT NULL,
      failover_targets TEXT NOT NULL DEFAULT '[]',
      unhealthy_threshold INTEGER NOT NULL DEFAULT 1,
      health_check_seconds INTEGER NOT NULL DEFAULT 30,
      auto_restore INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_failover_name ON failover_policies(name);
    CREATE INDEX IF NOT EXISTS idx_failover_scope ON failover_policies(scope, enabled);

    CREATE TABLE IF NOT EXISTS failover_events (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL,
      from_target TEXT NOT NULL,
      to_target TEXT,
      reason TEXT,
      status TEXT NOT NULL,
      triggered_at TEXT NOT NULL,
      restored_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_failover_event_policy
      ON failover_events(policy_id, triggered_at DESC);
    CREATE INDEX IF NOT EXISTS idx_failover_event_status
      ON failover_events(status, triggered_at DESC);

    CREATE TABLE IF NOT EXISTS failover_state (
      policy_id TEXT PRIMARY KEY,
      active_target TEXT NOT NULL,
      is_failed_over INTEGER NOT NULL DEFAULT 0,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      last_check_at TEXT,
      updated_at TEXT NOT NULL
    );
  `);
}

export interface FailoverPolicy {
  id: string;
  name: string;
  scope: FailoverScope;
  primary_target: string;
  failover_targets: string;
  unhealthy_threshold: number;
  health_check_seconds: number;
  auto_restore: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface FailoverEvent {
  id: string;
  policy_id: string;
  from_target: string;
  to_target: string | null;
  reason: string | null;
  status: FailoverStatus;
  triggered_at: string;
  restored_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FailoverState {
  policy_id: string;
  active_target: string;
  is_failed_over: number;
  consecutive_failures: number;
  last_check_at: string | null;
  updated_at: string;
}

// ---------- Policies ----------
export interface CreatePolicyInput {
  name: string;
  scope: FailoverScope;
  primary_target: string;
  failover_targets: string[];
  unhealthy_threshold?: number;
  health_check_seconds?: number;
  auto_restore?: boolean;
  enabled?: boolean;
}

export function createPolicy(input: CreatePolicyInput): FailoverPolicy {
  if (!SCOPES.includes(input.scope)) throw new Error('invalid_scope');
  if (!input.failover_targets.length) throw new Error('need_failover_targets');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO failover_policies
      (id, name, scope, primary_target, failover_targets, unhealthy_threshold,
       health_check_seconds, auto_restore, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.name, input.scope, input.primary_target,
    JSON.stringify(input.failover_targets), input.unhealthy_threshold ?? 1,
    input.health_check_seconds ?? 30, input.auto_restore === false ? 0 : 1,
    input.enabled === false ? 0 : 1, now, now);
  // init state
  db.prepare(`
    INSERT INTO failover_state (policy_id, active_target, is_failed_over, consecutive_failures, updated_at)
    VALUES (?, ?, 0, 0, ?)
  `).run(id, input.primary_target, now);
  return getPolicy(id)!;
}

export function getPolicy(id: string): FailoverPolicy | null {
  return (getDb().prepare('SELECT * FROM failover_policies WHERE id = ?').get(id) as FailoverPolicy | undefined) ?? null;
}

export function listPolicies(filter?: { scope?: FailoverScope; enabledOnly?: boolean }): FailoverPolicy[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter?.scope) { where.push('scope = ?'); args.push(filter.scope); }
  if (filter?.enabledOnly) where.push('enabled = 1');
  const sql = `SELECT * FROM failover_policies ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY scope, name`;
  return db.prepare(sql).all(...args) as FailoverPolicy[];
}

export function updatePolicy(id: string, patch: Partial<CreatePolicyInput>): FailoverPolicy | null {
  const existing = getPolicy(id);
  if (!existing) return null;
  const fields: string[] = [];
  const args: any[] = [];
  if (patch.name !== undefined) { fields.push('name = ?'); args.push(patch.name); }
  if (patch.scope !== undefined) { if (!SCOPES.includes(patch.scope)) throw new Error('invalid_scope'); fields.push('scope = ?'); args.push(patch.scope); }
  if (patch.primary_target !== undefined) { fields.push('primary_target = ?'); args.push(patch.primary_target); }
  if (patch.failover_targets !== undefined) { fields.push('failover_targets = ?'); args.push(JSON.stringify(patch.failover_targets)); }
  if (patch.unhealthy_threshold !== undefined) { fields.push('unhealthy_threshold = ?'); args.push(patch.unhealthy_threshold); }
  if (patch.health_check_seconds !== undefined) { fields.push('health_check_seconds = ?'); args.push(patch.health_check_seconds); }
  if (patch.auto_restore !== undefined) { fields.push('auto_restore = ?'); args.push(patch.auto_restore ? 1 : 0); }
  if (patch.enabled !== undefined) { fields.push('enabled = ?'); args.push(patch.enabled ? 1 : 0); }
  if (!fields.length) return existing;
  fields.push('updated_at = ?'); args.push(new Date().toISOString());
  args.push(id);
  getDb().prepare(`UPDATE failover_policies SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  return getPolicy(id);
}

export function deletePolicy(id: string): boolean {
  const db = getDb();
  db.prepare('DELETE FROM failover_state WHERE policy_id = ?').run(id);
  return db.prepare('DELETE FROM failover_policies WHERE id = ?').run(id).changes > 0;
}

// ---------- State ----------
export function getState(policyId: string): FailoverState | null {
  return (getDb().prepare('SELECT * FROM failover_state WHERE policy_id = ?').get(policyId) as FailoverState | undefined) ?? null;
}

// ---------- Trigger / Restore ----------
export interface TriggerInput {
  policy_id: string;
  reason?: string;
  to_target?: string;
}

export function triggerFailover(input: TriggerInput): FailoverEvent {
  const policy = getPolicy(input.policy_id);
  if (!policy) throw new Error('policy_not_found');
  const db = getDb();
  const state = getState(input.policy_id);
  if (!state) throw new Error('state_missing');
  if (state.is_failed_over) {
    throw new Error('already_failed_over');
  }
  const targets = JSON.parse(policy.failover_targets) as string[];
  const to = input.to_target ?? targets[0];
  if (!to) throw new Error('no_target');

  const now = new Date().toISOString();
  const id = randomUUID();
  const from = state.active_target;
  db.prepare(`
    INSERT INTO failover_events
      (id, policy_id, from_target, to_target, reason, status, triggered_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'triggered', ?, ?, ?)
  `).run(id, policy.id, from, to, input.reason ?? null, now, now, now);
  db.prepare(`
    UPDATE failover_state
    SET active_target = ?, is_failed_over = 1, last_check_at = ?, updated_at = ?
    WHERE policy_id = ?
  `).run(to, now, now, policy.id);
  return getEvent(id)!;
}

export function restorePrimary(policyId: string, reason?: string): FailoverEvent | null {
  const policy = getPolicy(policyId);
  if (!policy) throw new Error('policy_not_found');
  const db = getDb();
  const state = getState(policyId);
  if (!state || !state.is_failed_over) throw new Error('not_failed_over');

  const now = new Date().toISOString();
  // mark latest triggered event as restored
  const latest = db.prepare(`
    SELECT * FROM failover_events
    WHERE policy_id = ? AND status = 'triggered'
    ORDER BY triggered_at DESC LIMIT 1
  `).get(policyId) as FailoverEvent | undefined;
  if (latest) {
    db.prepare(`
      UPDATE failover_events
      SET status = 'restored', restored_at = ?, reason = COALESCE(reason, ?), updated_at = ?
      WHERE id = ?
    `).run(now, reason ?? null, now, latest.id);
  }
  db.prepare(`
    UPDATE failover_state
    SET active_target = ?, is_failed_over = 0, consecutive_failures = 0, last_check_at = ?, updated_at = ?
    WHERE policy_id = ?
  `).run(policy.primary_target, now, now, policyId);
  return latest ? getEvent(latest.id) : null;
}

export function getEvent(id: string): FailoverEvent | null {
  return (getDb().prepare('SELECT * FROM failover_events WHERE id = ?').get(id) as FailoverEvent | undefined) ?? null;
}

export function listEvents(filter?: { policy_id?: string; status?: FailoverStatus; limit?: number }): FailoverEvent[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter?.policy_id) { where.push('policy_id = ?'); args.push(filter.policy_id); }
  if (filter?.status) { where.push('status = ?'); args.push(filter.status); }
  const sql = `SELECT * FROM failover_events ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY triggered_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args) as FailoverEvent[];
}

// ---------- Health-driven evaluation ----------
export interface EvalResult {
  policy_id: string;
  checked: boolean;
  trigger: boolean;
  restored: boolean;
  reason: string | null;
  active_target: string;
  is_failed_over: boolean;
}

function checkTargetHealthy(scope: FailoverScope, target: string): boolean {
  const db = getDb();
  if (scope === 'cdn') {
    // cdn_providers.name or id -> look up latest cdn_health
    const prov = db.prepare('SELECT id FROM cdn_providers WHERE id = ? OR name = ? LIMIT 1')
      .get(target, target) as { id: string } | undefined;
    if (!prov) return false;
    const h = db.prepare('SELECT status FROM cdn_health WHERE provider_id = ? ORDER BY checked_at DESC LIMIT 1')
      .get(prov.id) as { status: string } | undefined;
    if (!h) return false;
    return h.status === 'ok' || h.status === 'healthy';
  }
  // For service/region we don't have a health probe here yet;
  // treat as healthy (no auto-trigger) unless explicitly marked down.
  return true;
}

export function evaluatePolicy(policyId: string): EvalResult {
  const policy = getPolicy(policyId);
  if (!policy) throw new Error('policy_not_found');
  const state = getState(policyId);
  if (!state) throw new Error('state_missing');
  if (!policy.enabled) {
    return { policy_id: policyId, checked: false, trigger: false, restored: false,
      reason: 'disabled', active_target: state.active_target, is_failed_over: state.is_failed_over === 1 };
  }
  const db = getDb();
  const now = new Date().toISOString();

  // If failed over: check if primary is healthy again
  if (state.is_failed_over) {
    const primaryHealthy = checkTargetHealthy(policy.scope, policy.primary_target);
    db.prepare('UPDATE failover_state SET last_check_at = ?, updated_at = ? WHERE policy_id = ?')
      .run(now, now, policyId);
    if (primaryHealthy && policy.auto_restore) {
      restorePrimary(policyId, 'primary_healthy');
      return { policy_id: policyId, checked: true, trigger: false, restored: true,
        reason: 'primary_healthy', active_target: policy.primary_target, is_failed_over: false };
    }
    return { policy_id: policyId, checked: true, trigger: false, restored: false,
      reason: primaryHealthy ? 'auto_restore_disabled' : 'primary_still_down',
      active_target: state.active_target, is_failed_over: true };
  }

  // Not failed over: check primary
  const healthy = checkTargetHealthy(policy.scope, policy.primary_target);
  const fails = healthy ? 0 : state.consecutive_failures + 1;
  const shouldTrigger = fails >= policy.unhealthy_threshold;
  db.prepare(`
    UPDATE failover_state
    SET consecutive_failures = ?, last_check_at = ?, updated_at = ?
    WHERE policy_id = ?
  `).run(fails, now, now, policyId);
  if (shouldTrigger) {
    try {
      triggerFailover({ policy_id: policyId, reason: `unhealthy:${fails}` });
      const st = getState(policyId)!;
      return { policy_id: policyId, checked: true, trigger: true, restored: false,
        reason: 'triggered', active_target: st.active_target, is_failed_over: true };
    } catch (e) {
      return { policy_id: policyId, checked: true, trigger: false, restored: false,
        reason: (e as Error).message, active_target: state.active_target, is_failed_over: false };
    }
  }
  return { policy_id: policyId, checked: true, trigger: false, restored: false,
    reason: healthy ? 'healthy' : `unhealthy:${fails}/${policy.unhealthy_threshold}`,
    active_target: state.active_target, is_failed_over: false };
}

export function evaluateAllPolicies(): EvalResult[] {
  const policies = listPolicies({ enabledOnly: true });
  return policies.map(p => {
    try { return evaluatePolicy(p.id); }
    catch { return { policy_id: p.id, checked: false, trigger: false, restored: false,
      reason: 'error', active_target: '', is_failed_over: false }; }
  });
}

// ---------- Stats ----------
export interface FailoverStats {
  total_policies: number;
  enabled_policies: number;
  by_scope: Record<string, number>;
  currently_failed_over: number;
  total_events: number;
  triggered_events: number;
  restored_events: number;
}

export function getFailoverStats(): FailoverStats {
  const db = getDb();
  const policies = db.prepare('SELECT scope, enabled FROM failover_policies').all() as
    { scope: string; enabled: number }[];
  const byScope: Record<string, number> = {};
  for (const p of policies) byScope[p.scope] = (byScope[p.scope] ?? 0) + 1;
  const stateRow = db.prepare('SELECT COUNT(*) AS c FROM failover_state WHERE is_failed_over = 1')
    .get() as { c: number };
  const ev = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'triggered' THEN 1 ELSE 0 END) AS t,
      SUM(CASE WHEN status = 'restored' THEN 1 ELSE 0 END) AS r,
      COUNT(*) AS total
    FROM failover_events
  `).get() as { t: number | null; r: number | null; total: number };
  return {
    total_policies: policies.length,
    enabled_policies: policies.filter(p => p.enabled === 1).length,
    by_scope: byScope,
    currently_failed_over: stateRow.c,
    total_events: ev.total,
    triggered_events: ev.t ?? 0,
    restored_events: ev.r ?? 0,
  };
}

// re-export type alias for existing PARTIAL reference
export type FailoverReason = string;
