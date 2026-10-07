// melodyflix videos - Section 12.12 Multi-Region Replication
// Region registry, per-dataset replication policies, replica lag tracking,
// and region promotion (failover to another region).
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type ReplicationScope = 'videos' | 'users' | 'metadata' | 'analytics';
export type ReplicationMode = 'sync' | 'async';
export type ReplicaStatus = 'ok' | 'lagging' | 'error' | 'initializing';
export type ReplicationEventType = 'lag_warning' | 'lag_cleared' | 'error' | 'resync' | 'promote';

const SCOPES: ReplicationScope[] = ['videos','users','metadata','analytics'];
const MODES: ReplicationMode[] = ['sync','async'];
const STATUSES: ReplicaStatus[] = ['ok','lagging','error','initializing'];
const EVENT_TYPES: ReplicationEventType[] = ['lag_warning','lag_cleared','error','resync','promote'];

export function ensureMultiRegionSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS replication_regions (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      provider TEXT,
      latency_class TEXT,
      is_primary INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_region_code ON replication_regions(code);
    CREATE INDEX IF NOT EXISTS idx_region_active ON replication_regions(active, is_primary);

    CREATE TABLE IF NOT EXISTS replication_policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      scope TEXT NOT NULL,
      primary_region TEXT NOT NULL,
      replica_regions TEXT NOT NULL DEFAULT '[]',
      mode TEXT NOT NULL DEFAULT 'async',
      lag_threshold_seconds INTEGER NOT NULL DEFAULT 30,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_repl_policy_name ON replication_policies(name);
    CREATE INDEX IF NOT EXISTS idx_repl_policy_scope ON replication_policies(scope, enabled);

    CREATE TABLE IF NOT EXISTS replication_status (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL,
      region_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'initializing',
      lag_seconds INTEGER NOT NULL DEFAULT 0,
      bytes_replicated INTEGER NOT NULL DEFAULT 0,
      last_applied_at TEXT,
      last_checked_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (policy_id, region_code)
    );
    CREATE INDEX IF NOT EXISTS idx_repl_status_policy ON replication_status(policy_id, status);
    CREATE INDEX IF NOT EXISTS idx_repl_status_region ON replication_status(region_code, status);

    CREATE TABLE IF NOT EXISTS replication_events (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL,
      region_code TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT,
      lag_seconds INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_repl_event_policy ON replication_events(policy_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_repl_event_type ON replication_events(event_type, created_at DESC);
  `);
}

export interface ReplicationRegion {
  id: string;
  code: string;
  name: string;
  provider: string | null;
  latency_class: string | null;
  is_primary: number;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface ReplicationPolicy {
  id: string;
  name: string;
  scope: ReplicationScope;
  primary_region: string;
  replica_regions: string;
  mode: ReplicationMode;
  lag_threshold_seconds: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface ReplicationStatus {
  id: string;
  policy_id: string;
  region_code: string;
  status: ReplicaStatus;
  lag_seconds: number;
  bytes_replicated: number;
  last_applied_at: string | null;
  last_checked_at: string;
  updated_at: string;
}

export interface ReplicationEvent {
  id: string;
  policy_id: string;
  region_code: string;
  event_type: ReplicationEventType;
  message: string | null;
  lag_seconds: number | null;
  created_at: string;
}

export interface RegionInput {
  code: string;
  name: string;
  provider?: string | null;
  latency_class?: string | null;
  is_primary?: boolean;
  active?: boolean;
}

export function upsertRegion(input: RegionInput): ReplicationRegion {
  if (!input.code) throw new Error('code_required');
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM replication_regions WHERE code = ?')
    .get(input.code) as ReplicationRegion | undefined;
  if (existing) {
    db.prepare(`
      UPDATE replication_regions SET name = ?, provider = ?, latency_class = ?,
        is_primary = ?, active = ?, updated_at = ? WHERE id = ?
    `).run(input.name, input.provider ?? null, input.latency_class ?? null,
      input.is_primary === undefined ? existing.is_primary : (input.is_primary ? 1 : 0),
      input.active === undefined ? existing.active : (input.active ? 1 : 0),
      now, existing.id);
    if (input.is_primary) {
      db.prepare('UPDATE replication_regions SET is_primary = 0 WHERE code != ?').run(input.code);
    }
    return getRegion(input.code)!;
  }
  const id = randomUUID();
  db.prepare(`
    INSERT INTO replication_regions
      (id, code, name, provider, latency_class, is_primary, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.code, input.name, input.provider ?? null, input.latency_class ?? null,
    input.is_primary ? 1 : 0, input.active === false ? 0 : 1, now, now);
  if (input.is_primary) {
    db.prepare('UPDATE replication_regions SET is_primary = 0 WHERE code != ?').run(input.code);
  }
  return getRegion(input.code)!;
}

export function getRegion(code: string): ReplicationRegion | null {
  return (getDb().prepare('SELECT * FROM replication_regions WHERE code = ?').get(code) as ReplicationRegion | undefined) ?? null;
}

export function listRegions(activeOnly = false): ReplicationRegion[] {
  const db = getDb();
  const sql = activeOnly
    ? 'SELECT * FROM replication_regions WHERE active = 1 ORDER BY is_primary DESC, code'
    : 'SELECT * FROM replication_regions ORDER BY is_primary DESC, code';
  return db.prepare(sql).all() as ReplicationRegion[];
}

export function deleteRegion(code: string): boolean {
  const db = getDb();
  const used = db.prepare('SELECT COUNT(*) AS c FROM replication_policies WHERE primary_region = ? OR replica_regions LIKE ?')
    .get(code, `%"${code}"%`) as { c: number };
  if (used.c > 0) throw new Error('region_in_use');
  return db.prepare('DELETE FROM replication_regions WHERE code = ?').run(code).changes > 0;
}

export interface PolicyInput {
  name: string;
  scope: ReplicationScope;
  primary_region: string;
  replica_regions: string[];
  mode?: ReplicationMode;
  lag_threshold_seconds?: number;
  enabled?: boolean;
}

export function upsertPolicy(input: PolicyInput): ReplicationPolicy {
  if (!SCOPES.includes(input.scope)) throw new Error('invalid_scope');
  if (!getRegion(input.primary_region)) throw new Error('primary_region_not_found');
  for (const r of input.replica_regions) {
    if (!getRegion(r)) throw new Error('replica_region_not_found:' + r);
  }
  const mode = input.mode ?? 'async';
  if (!MODES.includes(mode)) throw new Error('invalid_mode');
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM replication_policies WHERE name = ?')
    .get(input.name) as ReplicationPolicy | undefined;
  let id: string;
  if (existing) {
    db.prepare(`
      UPDATE replication_policies SET scope = ?, primary_region = ?, replica_regions = ?,
        mode = ?, lag_threshold_seconds = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(input.scope, input.primary_region, JSON.stringify(input.replica_regions),
      mode, input.lag_threshold_seconds ?? existing.lag_threshold_seconds,
      input.enabled === undefined ? existing.enabled : (input.enabled ? 1 : 0),
      now, existing.id);
    id = existing.id;
  } else {
    id = randomUUID();
    db.prepare(`
      INSERT INTO replication_policies
        (id, name, scope, primary_region, replica_regions, mode, lag_threshold_seconds, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.name, input.scope, input.primary_region, JSON.stringify(input.replica_regions),
      mode, input.lag_threshold_seconds ?? 30, input.enabled === false ? 0 : 1, now, now);
  }
  for (const r of input.replica_regions) {
    const s = db.prepare('SELECT id FROM replication_status WHERE policy_id = ? AND region_code = ?')
      .get(id, r) as { id: string } | undefined;
    if (!s) {
      db.prepare(`
        INSERT INTO replication_status
          (id, policy_id, region_code, status, lag_seconds, bytes_replicated, last_checked_at, updated_at)
        VALUES (?, ?, ?, 'initializing', 0, 0, ?, ?)
      `).run(randomUUID(), id, r, now, now);
    }
  }
  return getPolicy(id)!;
}

export function getPolicy(id: string): ReplicationPolicy | null {
  return (getDb().prepare('SELECT * FROM replication_policies WHERE id = ?').get(id) as ReplicationPolicy | undefined) ?? null;
}

export function listPolicies(filter?: { scope?: ReplicationScope; enabledOnly?: boolean }): ReplicationPolicy[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter?.scope) { where.push('scope = ?'); args.push(filter.scope); }
  if (filter?.enabledOnly) where.push('enabled = 1');
  const sql = `SELECT * FROM replication_policies ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY scope, name`;
  return db.prepare(sql).all(...args) as ReplicationPolicy[];
}

export function deletePolicy(id: string): boolean {
  const db = getDb();
  db.prepare('DELETE FROM replication_status WHERE policy_id = ?').run(id);
  return db.prepare('DELETE FROM replication_policies WHERE id = ?').run(id).changes > 0;
}

export interface StatusInput {
  policy_id: string;
  region_code: string;
  lag_seconds: number;
  bytes_replicated?: number;
  last_applied_at?: string | null;
}

export function recordStatus(input: StatusInput): ReplicationStatus {
  const policy = getPolicy(input.policy_id);
  if (!policy) throw new Error('policy_not_found');
  const db = getDb();
  const now = new Date().toISOString();
  const row = db.prepare('SELECT * FROM replication_status WHERE policy_id = ? AND region_code = ?')
    .get(input.policy_id, input.region_code) as ReplicationStatus | undefined;
  if (!row) throw new Error('status_row_missing');

  const newStatus: ReplicaStatus = input.lag_seconds <= policy.lag_threshold_seconds ? 'ok' : 'lagging';
  const prevStatus = row.status;
  const lastApplied = input.last_applied_at !== undefined ? input.last_applied_at : row.last_applied_at;
  const bytes = input.bytes_replicated ?? row.bytes_replicated;

  db.prepare(`
    UPDATE replication_status SET status = ?, lag_seconds = ?, bytes_replicated = ?,
      last_applied_at = ?, last_checked_at = ?, updated_at = ?
    WHERE id = ?
  `).run(newStatus, input.lag_seconds, bytes, lastApplied, now, now, row.id);

  if (newStatus === 'lagging' && prevStatus !== 'lagging') {
    logEvent(input.policy_id, input.region_code, 'lag_warning',
      `lag ${input.lag_seconds}s > threshold ${policy.lag_threshold_seconds}s`, input.lag_seconds);
  } else if (newStatus === 'ok' && prevStatus === 'lagging') {
    logEvent(input.policy_id, input.region_code, 'lag_cleared',
      `lag recovered (${input.lag_seconds}s)`, input.lag_seconds);
  }
  return getStatusById(row.id)!;
}

export function markStatusError(policy_id: string, region_code: string, message?: string): ReplicationStatus | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM replication_status WHERE policy_id = ? AND region_code = ?')
    .get(policy_id, region_code) as ReplicationStatus | undefined;
  if (!row) return null;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE replication_status SET status = 'error', last_checked_at = ?, updated_at = ? WHERE id = ?
  `).run(now, now, row.id);
  logEvent(policy_id, region_code, 'error', message ?? null, row.lag_seconds);
  return getStatusById(row.id)!;
}

export function getStatusById(id: string): ReplicationStatus | null {
  return (getDb().prepare('SELECT * FROM replication_status WHERE id = ?').get(id) as ReplicationStatus | undefined) ?? null;
}

export function listStatus(filter?: { policy_id?: string; region_code?: string; status?: ReplicaStatus; limit?: number }): ReplicationStatus[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter?.policy_id) { where.push('policy_id = ?'); args.push(filter.policy_id); }
  if (filter?.region_code) { where.push('region_code = ?'); args.push(filter.region_code); }
  if (filter?.status) { where.push('status = ?'); args.push(filter.status); }
  const sql = `SELECT * FROM replication_status ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY lag_seconds DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 200, 1), 1000));
  return db.prepare(sql).all(...args) as ReplicationStatus[];
}

export function getLaggingReplicas(lagThresholdOverride?: number): ReplicationStatus[] {
  const db = getDb();
  if (lagThresholdOverride !== undefined) {
    return db.prepare(`
      SELECT s.* FROM replication_status s
      JOIN replication_policies p ON p.id = s.policy_id
      WHERE s.lag_seconds > ? AND p.enabled = 1
      ORDER BY s.lag_seconds DESC
    `).all(lagThresholdOverride) as ReplicationStatus[];
  }
  return db.prepare(`
    SELECT s.* FROM replication_status s
    JOIN replication_policies p ON p.id = s.policy_id
    WHERE s.lag_seconds > p.lag_threshold_seconds AND p.enabled = 1
    ORDER BY s.lag_seconds DESC
  `).all() as ReplicationStatus[];
}

export interface PromoteResult {
  policy: ReplicationPolicy;
  event: ReplicationEvent;
  previous_primary: string;
  new_primary: string;
}

export function promoteRegion(policy_id: string, region_code: string, reason?: string): PromoteResult {
  const policy = getPolicy(policy_id);
  if (!policy) throw new Error('policy_not_found');
  const replicas = JSON.parse(policy.replica_regions) as string[];
  if (!replicas.includes(region_code)) throw new Error('not_a_replica');
  const newReplicas = [policy.primary_region, ...replicas.filter(r => r !== region_code)];
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE replication_policies SET primary_region = ?, replica_regions = ?, updated_at = ?
    WHERE id = ?
  `).run(region_code, JSON.stringify(newReplicas), now, policy_id);
  const s = db.prepare('SELECT id FROM replication_status WHERE policy_id = ? AND region_code = ?')
    .get(policy_id, policy.primary_region) as { id: string } | undefined;
  if (!s) {
    db.prepare(`
      INSERT INTO replication_status
        (id, policy_id, region_code, status, lag_seconds, bytes_replicated, last_checked_at, updated_at)
      VALUES (?, ?, ?, 'initializing', 0, 0, ?, ?)
    `).run(randomUUID(), policy_id, policy.primary_region, now, now);
  }
  db.prepare('DELETE FROM replication_status WHERE policy_id = ? AND region_code = ?')
    .run(policy_id, region_code);
  const ev = logEvent(policy_id, region_code, 'promote',
    reason ?? `promoted from ${policy.primary_region}`, null);
  return {
    policy: getPolicy(policy_id)!,
    event: ev,
    previous_primary: policy.primary_region,
    new_primary: region_code,
  };
}

export function logEvent(
  policy_id: string, region_code: string,
  event_type: ReplicationEventType, message: string | null, lag_seconds: number | null,
): ReplicationEvent {
  if (!EVENT_TYPES.includes(event_type)) throw new Error('invalid_event_type');
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO replication_events (id, policy_id, region_code, event_type, message, lag_seconds, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, policy_id, region_code, event_type, message, lag_seconds, now);
  return db.prepare('SELECT * FROM replication_events WHERE id = ?').get(id) as ReplicationEvent;
}

export function listEvents(filter?: { policy_id?: string; region_code?: string; event_type?: ReplicationEventType; limit?: number }): ReplicationEvent[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter?.policy_id) { where.push('policy_id = ?'); args.push(filter.policy_id); }
  if (filter?.region_code) { where.push('region_code = ?'); args.push(filter.region_code); }
  if (filter?.event_type) { where.push('event_type = ?'); args.push(filter.event_type); }
  const sql = `SELECT * FROM replication_events ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args) as ReplicationEvent[];
}

export interface ReplicationStats {
  total_regions: number;
  active_regions: number;
  total_policies: number;
  enabled_policies: number;
  by_scope: Record<string, number>;
  by_mode: Record<string, number>;
  total_replicas: number;
  lagging: number;
  errored: number;
  avg_lag_seconds: number;
}

export function getReplicationStats(): ReplicationStats {
  const db = getDb();
  const regions = db.prepare('SELECT active FROM replication_regions').all() as { active: number }[];
  const policies = db.prepare('SELECT scope, mode, enabled FROM replication_policies').all() as
    { scope: string; mode: string; enabled: number }[];
  const byScope: Record<string, number> = {};
  const byMode: Record<string, number> = {};
  for (const p of policies) {
    byScope[p.scope] = (byScope[p.scope] ?? 0) + 1;
    byMode[p.mode] = (byMode[p.mode] ?? 0) + 1;
  }
  const statuses = db.prepare('SELECT status, lag_seconds FROM replication_status').all() as
    { status: string; lag_seconds: number }[];
  let lagging = 0, errored = 0, sumLag = 0;
  for (const s of statuses) {
    if (s.status === 'lagging') lagging++;
    if (s.status === 'error') errored++;
    sumLag += s.lag_seconds;
  }
  return {
    total_regions: regions.length,
    active_regions: regions.filter(r => r.active === 1).length,
    total_policies: policies.length,
    enabled_policies: policies.filter(p => p.enabled === 1).length,
    by_scope: byScope,
    by_mode: byMode,
    total_replicas: statuses.length,
    lagging,
    errored,
    avg_lag_seconds: statuses.length ? sumLag / statuses.length : 0,
  };
}
