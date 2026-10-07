// melodyflix videos - Section 17 Administration and Automation
// Covers 17.2-17.7: audit log, announcements, rule engine,
// maintenance windows, bulk jobs, automated reports.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type AnnouncementAudience = 'all' | 'role' | 'users';
export type AnnouncementPriority = 'low' | 'normal' | 'high' | 'critical';
export type RuleTriggerType = 'event' | 'schedule' | 'metric';
export type RuleActionType = 'notify' | 'suspend' | 'unsuspend' | 'flag' | 'role_change' | 'webhook';
export type MaintenanceScope = 'platform' | 'videos' | 'auth' | 'channel' | 'notifications' | 'admin';
export type BulkActionType = 'suspend' | 'unsuspend' | 'role_change' | 'notify' | 'delete';
export type BulkStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ReportKind = 'daily' | 'weekly' | 'monthly' | 'custom';

export function ensureAdminAutomationSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, actor_role TEXT,
      action TEXT NOT NULL, resource_type TEXT, resource_id TEXT,
      changes TEXT NOT NULL DEFAULT '{}', ip TEXT, user_agent TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_actor ON admin_audit_log(actor_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON admin_audit_log(action, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_resource ON admin_audit_log(resource_type, resource_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_time ON admin_audit_log(created_at DESC);

    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
      audience TEXT NOT NULL DEFAULT 'all', audience_value TEXT,
      priority TEXT NOT NULL DEFAULT 'normal',
      scheduled_at TEXT, published_at TEXT, expires_at TEXT,
      is_published INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ann_pub ON announcements(is_published, published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ann_schedule ON announcements(scheduled_at, is_published);

    CREATE TABLE IF NOT EXISTS rule_actions (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, trigger_type TEXT NOT NULL,
      trigger_value TEXT, condition TEXT NOT NULL DEFAULT '{}',
      action_type TEXT NOT NULL, action_params TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1, last_fired_at TEXT,
      fire_count INTEGER NOT NULL DEFAULT 0, created_by TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_rule_name ON rule_actions(name);
    CREATE INDEX IF NOT EXISTS idx_rule_trigger ON rule_actions(trigger_type, enabled);

    CREATE TABLE IF NOT EXISTS rule_action_runs (
      id TEXT PRIMARY KEY, rule_id TEXT NOT NULL, triggered_by TEXT,
      payload TEXT NOT NULL DEFAULT '{}', result TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'ok', created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rule_run_rule ON rule_action_runs(rule_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS maintenance_windows (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
      scope TEXT NOT NULL DEFAULT 'platform',
      starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
      notify_users INTEGER NOT NULL DEFAULT 1, is_active INTEGER NOT NULL DEFAULT 0,
      created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_maint_time ON maintenance_windows(starts_at, ends_at, is_active);

    CREATE TABLE IF NOT EXISTS bulk_action_jobs (
      id TEXT PRIMARY KEY, action_type TEXT NOT NULL,
      target_filter TEXT NOT NULL DEFAULT '{}', user_ids TEXT NOT NULL DEFAULT '[]',
      params TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending',
      total INTEGER NOT NULL DEFAULT 0, processed INTEGER NOT NULL DEFAULT 0,
      succeeded INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
      results TEXT NOT NULL DEFAULT '[]', requested_by TEXT,
      started_at TEXT, finished_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bulk_status ON bulk_action_jobs(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS report_templates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'daily',
      metrics TEXT NOT NULL DEFAULT '[]', cron TEXT,
      recipients TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1,
      created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_report_tpl_name ON report_templates(name);

    CREATE TABLE IF NOT EXISTS report_instances (
      id TEXT PRIMARY KEY, template_id TEXT, kind TEXT NOT NULL,
      period_start TEXT NOT NULL, period_end TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}', generated_by TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_report_inst_tpl ON report_instances(template_id, created_at DESC);
  `);
}


// ================= 17.2 Audit Log =================
export interface AuditEntry {
  id: string; actor_id: string; actor_role: string | null;
  action: string; resource_type: string | null; resource_id: string | null;
  changes: string; ip: string | null; user_agent: string | null; created_at: string;
}

export interface LogAuditInput {
  actor_id: string; actor_role?: string | null; action: string;
  resource_type?: string | null; resource_id?: string | null;
  changes?: Record<string, unknown>; ip?: string | null; user_agent?: string | null;
}

export function logAudit(input: LogAuditInput): AuditEntry {
  if (!input.actor_id) throw new Error('actor_required');
  if (!input.action) throw new Error('action_required');
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO admin_audit_log
    (id, actor_id, actor_role, action, resource_type, resource_id, changes, ip, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.actor_id, input.actor_role ?? null,
    input.action, input.resource_type ?? null, input.resource_id ?? null,
    JSON.stringify(input.changes ?? {}), input.ip ?? null, input.user_agent ?? null, now);
  return db.prepare('SELECT * FROM admin_audit_log WHERE id = ?').get(id) as AuditEntry;
}

export interface ListAuditFilter {
  actor_id?: string; action?: string; resource_type?: string; resource_id?: string;
  from?: string; to?: string; limit?: number;
}

export function listAudit(filter: ListAuditFilter = {}): AuditEntry[] {
  const db = getDb();
  const where: string[] = []; const args: any[] = [];
  if (filter.actor_id) { where.push('actor_id = ?'); args.push(filter.actor_id); }
  if (filter.action) { where.push('action = ?'); args.push(filter.action); }
  if (filter.resource_type) { where.push('resource_type = ?'); args.push(filter.resource_type); }
  if (filter.resource_id) { where.push('resource_id = ?'); args.push(filter.resource_id); }
  if (filter.from) { where.push('created_at >= ?'); args.push(filter.from); }
  if (filter.to) { where.push('created_at <= ?'); args.push(filter.to); }
  const sql = `SELECT * FROM admin_audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter.limit ?? 100, 1), 1000));
  return db.prepare(sql).all(...args) as AuditEntry[];
}

export function getAuditEntry(id: string): AuditEntry | null {
  return (getDb().prepare('SELECT * FROM admin_audit_log WHERE id = ?').get(id) as AuditEntry | undefined) ?? null;
}

// ================= 17.3 Announcements =================
export interface Announcement {
  id: string; title: string; body: string;
  audience: AnnouncementAudience; audience_value: string | null;
  priority: AnnouncementPriority;
  scheduled_at: string | null; published_at: string | null; expires_at: string | null;
  is_published: number; created_by: string; created_at: string; updated_at: string;
}

export interface CreateAnnouncementInput {
  title: string; body: string;
  audience?: AnnouncementAudience; audience_value?: string | null;
  priority?: AnnouncementPriority;
  scheduled_at?: string | null; expires_at?: string | null;
  created_by: string;
}

export function createAnnouncement(input: CreateAnnouncementInput): Announcement {
  if (!input.title || input.title.length > 200) throw new Error('invalid_title');
  if (!input.body || input.body.length > 10000) throw new Error('invalid_body');
  if (!input.created_by) throw new Error('creator_required');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`INSERT INTO announcements
    (id, title, body, audience, audience_value, priority, scheduled_at, expires_at, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.title, input.body,
    input.audience ?? 'all', input.audience_value ?? null, input.priority ?? 'normal',
    input.scheduled_at ?? null, input.expires_at ?? null, input.created_by, now, now);
  return getAnnouncement(id)!;
}

export function getAnnouncement(id: string): Announcement | null {
  return (getDb().prepare('SELECT * FROM announcements WHERE id = ?').get(id) as Announcement | undefined) ?? null;
}

export function publishAnnouncement(id: string, actorId: string): Announcement {
  const a = getAnnouncement(id);
  if (!a) throw new Error('not_found');
  const now = new Date().toISOString();
  getDb().prepare('UPDATE announcements SET is_published = 1, published_at = ?, updated_at = ? WHERE id = ?')
    .run(now, now, id);
  logAudit({ actor_id: actorId, action: 'announcement.publish', resource_type: 'announcement', resource_id: id });
  return getAnnouncement(id)!;
}

export function listAnnouncements(filter?: { published?: boolean; audience?: AnnouncementAudience; active?: boolean; limit?: number }): Announcement[] {
  const db = getDb();
  const where: string[] = []; const args: any[] = [];
  if (filter?.published !== undefined) { where.push('is_published = ?'); args.push(filter.published ? 1 : 0); }
  if (filter?.audience) { where.push('audience = ?'); args.push(filter.audience); }
  if (filter?.active) {
    where.push("(is_published = 1 AND (expires_at IS NULL OR expires_at > ?))");
    args.push(new Date().toISOString());
  }
  const sql = `SELECT * FROM announcements ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY priority DESC, COALESCE(published_at, scheduled_at, created_at) DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args) as Announcement[];
}


// ================= 17.4 Rule-Based Actions =================
export interface RuleAction {
  id: string; name: string; trigger_type: RuleTriggerType;
  trigger_value: string | null; condition: string;
  action_type: RuleActionType; action_params: string;
  enabled: number; last_fired_at: string | null; fire_count: number;
  created_by: string | null; created_at: string; updated_at: string;
}

export interface CreateRuleInput {
  name: string; trigger_type: RuleTriggerType; trigger_value?: string | null;
  condition?: Record<string, unknown>; action_type: RuleActionType;
  action_params?: Record<string, unknown>; enabled?: boolean; created_by?: string | null;
}

export function createRule(input: CreateRuleInput): RuleAction {
  if (!input.name || input.name.length > 200) throw new Error('invalid_name');
  if (!['event','schedule','metric'].includes(input.trigger_type)) throw new Error('invalid_trigger');
  if (!['notify','suspend','unsuspend','flag','role_change','webhook'].includes(input.action_type)) throw new Error('invalid_action');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`INSERT INTO rule_actions
    (id, name, trigger_type, trigger_value, condition, action_type, action_params, enabled, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.name, input.trigger_type,
    input.trigger_value ?? null, JSON.stringify(input.condition ?? {}),
    input.action_type, JSON.stringify(input.action_params ?? {}),
    input.enabled === false ? 0 : 1, input.created_by ?? null, now, now);
  return getRule(id)!;
}

export function getRule(id: string): RuleAction | null {
  return (getDb().prepare('SELECT * FROM rule_actions WHERE id = ?').get(id) as RuleAction | undefined) ?? null;
}

export function listRules(filter?: { trigger_type?: RuleTriggerType; enabledOnly?: boolean }): RuleAction[] {
  const db = getDb();
  const where: string[] = []; const args: any[] = [];
  if (filter?.trigger_type) { where.push('trigger_type = ?'); args.push(filter.trigger_type); }
  if (filter?.enabledOnly) where.push('enabled = 1');
  const sql = `SELECT * FROM rule_actions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY name`;
  return db.prepare(sql).all(...args) as RuleAction[];
}

export function updateRule(id: string, patch: Partial<CreateRuleInput>): RuleAction | null {
  const r = getRule(id);
  if (!r) return null;
  const fields: string[] = []; const args: any[] = [];
  if (patch.name !== undefined) { fields.push('name = ?'); args.push(patch.name); }
  if (patch.trigger_type !== undefined) { fields.push('trigger_type = ?'); args.push(patch.trigger_type); }
  if (patch.trigger_value !== undefined) { fields.push('trigger_value = ?'); args.push(patch.trigger_value); }
  if (patch.condition !== undefined) { fields.push('condition = ?'); args.push(JSON.stringify(patch.condition)); }
  if (patch.action_type !== undefined) { fields.push('action_type = ?'); args.push(patch.action_type); }
  if (patch.action_params !== undefined) { fields.push('action_params = ?'); args.push(JSON.stringify(patch.action_params)); }
  if (patch.enabled !== undefined) { fields.push('enabled = ?'); args.push(patch.enabled ? 1 : 0); }
  if (!fields.length) return r;
  fields.push('updated_at = ?'); args.push(new Date().toISOString());
  args.push(id);
  getDb().prepare(`UPDATE rule_actions SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  return getRule(id);
}

export function deleteRule(id: string): boolean {
  return getDb().prepare('DELETE FROM rule_actions WHERE id = ?').run(id).changes > 0;
}

function evalCondition(condition: Record<string, unknown>, payload: Record<string, unknown>): boolean {
  const ops = (op: string, a: any, b: any): boolean => {
    switch (op) {
      case 'eq': return a === b;
      case 'neq': return a !== b;
      case 'gt': return Number(a) > Number(b);
      case 'gte': return Number(a) >= Number(b);
      case 'lt': return Number(a) < Number(b);
      case 'lte': return Number(a) <= Number(b);
      case 'contains': return String(a ?? '').includes(String(b ?? ''));
      case 'exists': return a !== undefined && a !== null;
      default: return false;
    }
  };
  const checkNode = (node: any): boolean => {
    if (!node || typeof node !== 'object') return false;
    if (Array.isArray(node.all)) return node.all.every(checkNode);
    if (Array.isArray(node.any)) return node.any.some(checkNode);
    if (node.field && node.op) return ops(String(node.op), payload[node.field], node.value);
    return false;
  };
  return checkNode(condition);
}

export interface FireRuleInput {
  rule_id: string; payload?: Record<string, unknown>; triggered_by?: string | null;
}
export interface FireRuleResult {
  fired: boolean; condition_met: boolean;
  action_type: RuleActionType | null; action_params: Record<string, unknown> | null; run_id?: string;
}

export function fireRule(input: FireRuleInput): FireRuleResult {
  const r = getRule(input.rule_id);
  if (!r) throw new Error('rule_not_found');
  if (!r.enabled) return { fired: false, condition_met: false, action_type: null, action_params: null };
  const cond = JSON.parse(r.condition) as Record<string, unknown>;
  const payload = input.payload ?? {};
  const met = Object.keys(cond).length === 0 ? true : evalCondition(cond, payload);
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  if (!met) {
    db.prepare(`INSERT INTO rule_action_runs (id, rule_id, triggered_by, payload, result, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'skipped', ?)`).run(id, r.id, input.triggered_by ?? null,
      JSON.stringify(payload), JSON.stringify({ reason: 'condition_not_met' }), now);
    return { fired: false, condition_met: false, action_type: null, action_params: null, run_id: id };
  }
  db.prepare(`INSERT INTO rule_action_runs (id, rule_id, triggered_by, payload, result, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'ok', ?)`).run(id, r.id, input.triggered_by ?? null,
    JSON.stringify(payload), JSON.stringify({ dispatched: r.action_type }), now);
  db.prepare(`UPDATE rule_actions SET last_fired_at = ?, fire_count = fire_count + 1, updated_at = ? WHERE id = ?`)
    .run(now, now, r.id);
  return { fired: true, condition_met: true, action_type: r.action_type, action_params: JSON.parse(r.action_params), run_id: id };
}

export function listRuleRuns(ruleId?: string, limit = 100) {
  const db = getDb();
  if (ruleId) {
    return db.prepare('SELECT * FROM rule_action_runs WHERE rule_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(ruleId, Math.min(Math.max(limit, 1), 500));
  }
  return db.prepare('SELECT * FROM rule_action_runs ORDER BY created_at DESC LIMIT ?')
    .all(Math.min(Math.max(limit, 1), 500));
}

// ================= 17.5 Scheduled Maintenance =================
export interface MaintenanceWindow {
  id: string; title: string; description: string | null;
  scope: MaintenanceScope; starts_at: string; ends_at: string;
  notify_users: number; is_active: number;
  created_by: string | null; created_at: string; updated_at: string;
}

export interface CreateMaintenanceInput {
  title: string; description?: string | null; scope?: MaintenanceScope;
  starts_at: string; ends_at: string;
  notify_users?: boolean; created_by?: string | null;
}

export function createMaintenance(input: CreateMaintenanceInput): MaintenanceWindow {
  if (!input.title || input.title.length > 200) throw new Error('invalid_title');
  if (!input.starts_at || !input.ends_at) throw new Error('time_required');
  if (new Date(input.ends_at) <= new Date(input.starts_at)) throw new Error('invalid_window');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`INSERT INTO maintenance_windows
    (id, title, description, scope, starts_at, ends_at, notify_users, is_active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`).run(id, input.title, input.description ?? null,
    input.scope ?? 'platform', input.starts_at, input.ends_at,
    input.notify_users === false ? 0 : 1, input.created_by ?? null, now, now);
  return getMaintenance(id)!;
}

export function getMaintenance(id: string): MaintenanceWindow | null {
  return (getDb().prepare('SELECT * FROM maintenance_windows WHERE id = ?').get(id) as MaintenanceWindow | undefined) ?? null;
}

export function listMaintenance(filter?: { active?: boolean; upcoming?: boolean; limit?: number }): MaintenanceWindow[] {
  const db = getDb();
  const where: string[] = []; const args: any[] = [];
  if (filter?.active) where.push('is_active = 1');
  if (filter?.upcoming) { where.push('starts_at > ?'); args.push(new Date().toISOString()); }
  const sql = `SELECT * FROM maintenance_windows ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY starts_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args) as MaintenanceWindow[];
}

export function activateMaintenance(id: string, actorId: string): MaintenanceWindow {
  if (!getMaintenance(id)) throw new Error('not_found');
  const now = new Date().toISOString();
  getDb().prepare('UPDATE maintenance_windows SET is_active = 1, updated_at = ? WHERE id = ?').run(now, id);
  logAudit({ actor_id: actorId, action: 'maintenance.activate', resource_type: 'maintenance', resource_id: id });
  return getMaintenance(id)!;
}

export function deactivateMaintenance(id: string, actorId: string): MaintenanceWindow {
  if (!getMaintenance(id)) throw new Error('not_found');
  const now = new Date().toISOString();
  getDb().prepare('UPDATE maintenance_windows SET is_active = 0, updated_at = ? WHERE id = ?').run(now, id);
  logAudit({ actor_id: actorId, action: 'maintenance.deactivate', resource_type: 'maintenance', resource_id: id });
  return getMaintenance(id)!;
}

export function getActiveMaintenance(): MaintenanceWindow | null {
  const now = new Date().toISOString();
  return (getDb().prepare(`SELECT * FROM maintenance_windows
    WHERE is_active = 1 AND starts_at <= ? AND ends_at >= ? ORDER BY starts_at DESC LIMIT 1`)
    .get(now, now) as MaintenanceWindow | undefined) ?? null;
}


// ================= 17.6 Bulk User Actions =================
export interface BulkJob {
  id: string; action_type: BulkActionType; target_filter: string;
  user_ids: string; params: string; status: BulkStatus;
  total: number; processed: number; succeeded: number; failed: number;
  results: string; requested_by: string | null;
  started_at: string | null; finished_at: string | null;
  created_at: string; updated_at: string;
}

export interface CreateBulkJobInput {
  action_type: BulkActionType; user_ids: string[];
  params?: Record<string, unknown>; requested_by?: string | null;
}

export function createBulkJob(input: CreateBulkJobInput): BulkJob {
  if (!['suspend','unsuspend','role_change','notify','delete'].includes(input.action_type)) throw new Error('invalid_action');
  if (!Array.isArray(input.user_ids) || input.user_ids.length === 0) throw new Error('user_ids_required');
  if (input.user_ids.length > 10000) throw new Error('too_many_users');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`INSERT INTO bulk_action_jobs
    (id, action_type, user_ids, params, status, total, requested_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`).run(id, input.action_type,
    JSON.stringify(input.user_ids), JSON.stringify(input.params ?? {}),
    input.user_ids.length, input.requested_by ?? null, now, now);
  return getBulkJob(id)!;
}

export function getBulkJob(id: string): BulkJob | null {
  return (getDb().prepare('SELECT * FROM bulk_action_jobs WHERE id = ?').get(id) as BulkJob | undefined) ?? null;
}

export function runBulkJob(id: string, actorId: string, outcomeFor?: (userId: string) => { ok: boolean; error?: string }): BulkJob {
  const job = getBulkJob(id);
  if (!job) throw new Error('job_not_found');
  if (job.status !== 'pending') throw new Error('job_not_pending');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare('UPDATE bulk_action_jobs SET status = ?, started_at = ?, updated_at = ? WHERE id = ?')
    .run('running', now, now, id);
  const ids = JSON.parse(job.user_ids) as string[];
  const results: { user_id: string; ok: boolean; error?: string }[] = [];
  let ok = 0, fail = 0;
  for (const uid of ids) {
    const r = outcomeFor ? outcomeFor(uid) : { ok: true };
    if (r.ok) ok++; else fail++;
    results.push({ user_id: uid, ok: r.ok, ...(r.error ? { error: r.error } : {}) });
  }
  const finished = new Date().toISOString();
  db.prepare(`UPDATE bulk_action_jobs SET status = 'completed', processed = ?, succeeded = ?,
    failed = ?, results = ?, finished_at = ?, updated_at = ? WHERE id = ?`)
    .run(ids.length, ok, fail, JSON.stringify(results), finished, finished, id);
  logAudit({
    actor_id: actorId, action: 'bulk.run', resource_type: 'bulk_job', resource_id: id,
    changes: { action_type: job.action_type, total: ids.length, ok, fail },
  });
  return getBulkJob(id)!;
}

export function listBulkJobs(filter?: { status?: BulkStatus; limit?: number }): BulkJob[] {
  const db = getDb();
  const where: string[] = []; const args: any[] = [];
  if (filter?.status) { where.push('status = ?'); args.push(filter.status); }
  const sql = `SELECT * FROM bulk_action_jobs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args) as BulkJob[];
}

// ================= 17.7 Automated Reports =================
export interface ReportTemplate {
  id: string; name: string; kind: ReportKind; metrics: string;
  cron: string | null; recipients: string; enabled: number;
  created_by: string | null; created_at: string; updated_at: string;
}

export interface CreateReportTemplateInput {
  name: string; kind?: ReportKind; metrics?: string[];
  cron?: string | null; recipients?: string[];
  enabled?: boolean; created_by?: string | null;
}

export function createReportTemplate(input: CreateReportTemplateInput): ReportTemplate {
  if (!input.name || input.name.length > 200) throw new Error('invalid_name');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`INSERT INTO report_templates
    (id, name, kind, metrics, cron, recipients, enabled, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.name, input.kind ?? 'daily',
    JSON.stringify(input.metrics ?? []), input.cron ?? null,
    JSON.stringify(input.recipients ?? []), input.enabled === false ? 0 : 1,
    input.created_by ?? null, now, now);
  return getReportTemplate(id)!;
}

export function getReportTemplate(id: string): ReportTemplate | null {
  return (getDb().prepare('SELECT * FROM report_templates WHERE id = ?').get(id) as ReportTemplate | undefined) ?? null;
}

export function listReportTemplates(enabledOnly = false): ReportTemplate[] {
  const sql = enabledOnly
    ? 'SELECT * FROM report_templates WHERE enabled = 1 ORDER BY name'
    : 'SELECT * FROM report_templates ORDER BY name';
  return getDb().prepare(sql).all() as ReportTemplate[];
}

export interface GenerateReportInput {
  template_id?: string | null; kind: ReportKind;
  period_start: string; period_end: string;
  data?: Record<string, unknown>; generated_by?: string | null;
}

export function generateReport(input: GenerateReportInput) {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO report_instances
    (id, template_id, kind, period_start, period_end, data, generated_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.template_id ?? null, input.kind,
    input.period_start, input.period_end, JSON.stringify(input.data ?? {}),
    input.generated_by ?? null, now);
  return db.prepare('SELECT * FROM report_instances WHERE id = ?').get(id) as any;
}

export function listReportInstances(filter?: { template_id?: string; kind?: ReportKind; limit?: number }) {
  const db = getDb();
  const where: string[] = []; const args: any[] = [];
  if (filter?.template_id) { where.push('template_id = ?'); args.push(filter.template_id); }
  if (filter?.kind) { where.push('kind = ?'); args.push(filter.kind); }
  const sql = `SELECT * FROM report_instances ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args);
}

// ================= Stats =================
export interface AdminAutomationStats {
  audit_entries: number;
  announcements_total: number; announcements_published: number;
  rules_total: number; rules_enabled: number; rules_fired_total: number;
  maintenance_total: number; maintenance_active_now: number;
  bulk_jobs_total: number; bulk_jobs_running: number;
  report_templates: number; report_instances: number;
}

export function getAdminAutomationStats(): AdminAutomationStats {
  const db = getDb();
  const audit = db.prepare('SELECT COUNT(*) AS c FROM admin_audit_log').get() as { c: number };
  const ann = db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(is_published),0) AS p FROM announcements').get() as { c: number; p: number };
  const rules = db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(enabled),0) AS e, COALESCE(SUM(fire_count),0) AS f FROM rule_actions').get() as { c: number; e: number; f: number };
  const maint = db.prepare('SELECT COUNT(*) AS c FROM maintenance_windows').get() as { c: number };
  const active = getActiveMaintenance();
  const bulk = db.prepare("SELECT COUNT(*) AS c FROM bulk_action_jobs").get() as { c: number };
  const running = db.prepare("SELECT COUNT(*) AS c FROM bulk_action_jobs WHERE status = 'running'").get() as { c: number };
  const tpl = db.prepare('SELECT COUNT(*) AS c FROM report_templates').get() as { c: number };
  const inst = db.prepare('SELECT COUNT(*) AS c FROM report_instances').get() as { c: number };
  return {
    audit_entries: audit.c,
    announcements_total: ann.c,
    announcements_published: ann.p,
    rules_total: rules.c,
    rules_enabled: rules.e,
    rules_fired_total: rules.f,
    maintenance_total: maint.c,
    maintenance_active_now: active ? 1 : 0,
    bulk_jobs_total: bulk.c,
    bulk_jobs_running: running.c,
    report_templates: tpl.c,
    report_instances: inst.c,
  };
}
