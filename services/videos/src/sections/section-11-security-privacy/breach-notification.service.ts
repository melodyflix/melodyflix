// melodyflix videos - Section 11.22 Breach Notification
// GDPR Art. 33/34 — track personal-data breaches, notify regulator
// within 72h, notify affected users when high risk. Deadline is
// computed from discovered_at.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type BreachRisk = 'low' | 'medium' | 'high' | 'critical';
export type BreachStatus = 'draft' | 'investigating' | 'regulator_notified' | 'users_notified' | 'closed';
export type NotifyChannel = 'email' | 'in_app' | 'sms' | 'push';
export type NotifyTarget = 'regulator' | 'user' | 'internal';
export type NotifyStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface BreachIncident {
  id: string;
  title: string;
  description: string | null;
  risk_level: BreachRisk;
  status: BreachStatus;
  detected_by: string | null;
  discovered_at: string;
  deadline_at: string;
  regulator_notified_at: string | null;
  users_notified_at: string | null;
  closed_at: string | null;
  data_categories: string | null;
  root_cause: string | null;
  affected_count: number;
  created_at: string;
  updated_at: string;
}

export interface BreachAffectedUser {
  id: string;
  breach_id: string;
  user_id: string;
  email: string | null;
  notified_at: string | null;
  notify_status: NotifyStatus;
  added_at: string;
}

export interface BreachNotificationRow {
  id: string;
  breach_id: string;
  target: NotifyTarget;
  target_ref: string | null;
  channel: NotifyChannel;
  subject: string | null;
  body: string | null;
  status: NotifyStatus;
  sent_at: string | null;
  error: string | null;
  created_at: string;
}

const HOUR_MS = 3_600_000;

export function ensureBreachNotificationSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS breach_incidents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      risk_level TEXT NOT NULL DEFAULT 'medium'
        CHECK (risk_level IN ('low','medium','high','critical')),
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','investigating','regulator_notified','users_notified','closed')),
      detected_by TEXT,
      discovered_at TEXT NOT NULL,
      deadline_at TEXT NOT NULL,
      regulator_notified_at TEXT,
      users_notified_at TEXT,
      closed_at TEXT,
      data_categories TEXT,
      root_cause TEXT,
      affected_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_breach_status ON breach_incidents(status, discovered_at DESC);
    CREATE INDEX IF NOT EXISTS idx_breach_deadline ON breach_incidents(deadline_at, status);

    CREATE TABLE IF NOT EXISTS breach_affected_users (
      id TEXT PRIMARY KEY,
      breach_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      email TEXT,
      notified_at TEXT,
      notify_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (notify_status IN ('pending','sent','failed','skipped')),
      added_at TEXT NOT NULL,
      UNIQUE (breach_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_breach_affected_breach ON breach_affected_users(breach_id, notify_status);
    CREATE INDEX IF NOT EXISTS idx_breach_affected_user ON breach_affected_users(user_id);

    CREATE TABLE IF NOT EXISTS breach_notifications (
      id TEXT PRIMARY KEY,
      breach_id TEXT NOT NULL,
      target TEXT NOT NULL
        CHECK (target IN ('regulator','user','internal')),
      target_ref TEXT,
      channel TEXT NOT NULL
        CHECK (channel IN ('email','in_app','sms','push')),
      subject TEXT,
      body TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','sent','failed','skipped')),
      sent_at TEXT,
      error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_breach_notif_breach ON breach_notifications(breach_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_breach_notif_user ON breach_notifications(target_ref, target);
  `);
}

// ---------- Incidents ----------

export interface CreateBreachInput {
  title: string;
  description?: string | null;
  risk_level?: BreachRisk;
  detected_by?: string | null;
  discovered_at?: string;
  data_categories?: string[];
  root_cause?: string | null;
}

export function createBreachIncident(input: CreateBreachInput, createdBy: string | null): BreachIncident {
  const db = getDb();
  const id = randomUUID();
  const discovered = input.discovered_at ?? new Date().toISOString();
  const deadline = new Date(new Date(discovered).getTime() + 72 * HOUR_MS).toISOString();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO breach_incidents
     (id, title, description, risk_level, status, detected_by, discovered_at, deadline_at,
      data_categories, root_cause, affected_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    id, input.title, input.description ?? null, input.risk_level ?? 'medium',
    input.detected_by ?? createdBy, discovered, deadline,
    input.data_categories ? JSON.stringify(input.data_categories) : null,
    input.root_cause ?? null, now, now,
  );
  return getBreachIncident(id)!;
}

export function getBreachIncident(id: string): BreachIncident | null {
  const db = getDb();
  return (db.prepare(`SELECT * FROM breach_incidents WHERE id = ?`).get(id) as BreachIncident | undefined) ?? null;
}

export interface ListBreachesOpts {
  status?: BreachStatus;
  risk_level?: BreachRisk;
  limit?: number;
}

export function listBreachIncidents(opts: ListBreachesOpts = {}): { incidents: BreachIncident[]; total: number } {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const cond: string[] = [];
  const params: unknown[] = [];
  if (opts.status) { cond.push('status = ?'); params.push(opts.status); }
  if (opts.risk_level) { cond.push('risk_level = ?'); params.push(opts.risk_level); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const rows = db.prepare(
    `SELECT * FROM breach_incidents ${where} ORDER BY discovered_at DESC LIMIT ?`,
  ).all(...params, limit) as BreachIncident[];
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM breach_incidents ${where}`).get(...params) as { c: number }).c;
  return { incidents: rows, total };
}

export interface UpdateBreachInput {
  title?: string;
  description?: string | null;
  risk_level?: BreachRisk;
  status?: BreachStatus;
  data_categories?: string[];
  root_cause?: string | null;
  detected_by?: string | null;
}

export function updateBreachIncident(id: string, patch: UpdateBreachInput): BreachIncident | null {
  const db = getDb();
  if (!getBreachIncident(id)) return null;
  const f: string[] = [];
  const v: unknown[] = [];
  if (patch.title !== undefined) { f.push('title = ?'); v.push(patch.title); }
  if (patch.description !== undefined) { f.push('description = ?'); v.push(patch.description); }
  if (patch.risk_level !== undefined) { f.push('risk_level = ?'); v.push(patch.risk_level); }
  if (patch.status !== undefined) { f.push('status = ?'); v.push(patch.status); }
  if (patch.data_categories !== undefined) {
    f.push('data_categories = ?'); v.push(JSON.stringify(patch.data_categories));
  }
  if (patch.root_cause !== undefined) { f.push('root_cause = ?'); v.push(patch.root_cause); }
  if (patch.detected_by !== undefined) { f.push('detected_by = ?'); v.push(patch.detected_by); }
  if (!f.length) return getBreachIncident(id);
  f.push('updated_at = ?'); v.push(new Date().toISOString());
  v.push(id);
  db.prepare(`UPDATE breach_incidents SET ${f.join(', ')} WHERE id = ?`).run(...v);
  return getBreachIncident(id);
}

// ---------- Affected users ----------

export function addAffectedUsers(
  breachId: string,
  users: Array<{ user_id: string; email?: string | null }>,
): { added: number; skipped: number } {
  const db = getDb();
  if (!getBreachIncident(breachId)) throw new Error('breach_not_found');
  const now = new Date().toISOString();
  let added = 0;
  let skipped = 0;
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO breach_affected_users
     (id, breach_id, user_id, email, notify_status, added_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
  );
  for (const u of users) {
    const r = stmt.run(randomUUID(), breachId, u.user_id, u.email ?? null, now);
    if (r.changes > 0) added++; else skipped++;
  }
  db.prepare(`UPDATE breach_incidents SET affected_count = (SELECT COUNT(*) FROM breach_affected_users WHERE breach_id = ?), updated_at = ? WHERE id = ?`)
    .run(breachId, now, breachId);
  return { added, skipped };
}

export function listAffectedUsers(breachId: string, limit = 500): BreachAffectedUser[] {
  const db = getDb();
  return db.prepare(
    `SELECT * FROM breach_affected_users WHERE breach_id = ? ORDER BY added_at ASC LIMIT ?`,
  ).all(breachId, limit) as BreachAffectedUser[];
}

export function listUserBreachNotifications(userId: string): Array<BreachAffectedUser & { breach_title: string; breach_risk: string; breach_status: string }> {
  const db = getDb();
  return db.prepare(
    `SELECT a.*, b.title AS breach_title, b.risk_level AS breach_risk, b.status AS breach_status
     FROM breach_affected_users a
     JOIN breach_incidents b ON b.id = a.breach_id
     WHERE a.user_id = ?
     ORDER BY b.discovered_at DESC`,
  ).all(userId) as Array<BreachAffectedUser & { breach_title: string; breach_risk: string; breach_status: string }>;
}

// ---------- Notifications ----------

export interface NotifyInput {
  target: NotifyTarget;
  target_ref?: string | null;
  channel: NotifyChannel;
  subject?: string | null;
  body?: string | null;
}

export function recordNotification(breachId: string, input: NotifyInput, status: NotifyStatus = 'sent'): BreachNotificationRow {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO breach_notifications
     (id, breach_id, target, target_ref, channel, subject, body, status, sent_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, breachId, input.target, input.target_ref ?? null, input.channel,
    input.subject ?? null, input.body ?? null, status,
    status === 'sent' ? now : null, now,
  );
  return db.prepare(`SELECT * FROM breach_notifications WHERE id = ?`).get(id) as BreachNotificationRow;
}

export function listNotifications(breachId: string): BreachNotificationRow[] {
  const db = getDb();
  return db.prepare(
    `SELECT * FROM breach_notifications WHERE breach_id = ? ORDER BY created_at DESC`,
  ).all(breachId) as BreachNotificationRow[];
}

// ---------- Actions ----------

export interface NotifyRegulatorInput {
  authority: string;
  body?: string | null;
  channel?: NotifyChannel;
}

export function notifyRegulator(breachId: string, input: NotifyRegulatorInput): { incident: BreachIncident; notification: BreachNotificationRow } {
  const db = getDb();
  const inc = getBreachIncident(breachId);
  if (!inc) throw new Error('breach_not_found');
  const now = new Date().toISOString();
  const notif = recordNotification(breachId, {
    target: 'regulator',
    target_ref: input.authority,
    channel: input.channel ?? 'email',
    subject: `Personal data breach notification: ${inc.title}`,
    body: input.body ?? null,
  }, 'sent');
  db.prepare(
    `UPDATE breach_incidents
     SET regulator_notified_at = ?, status = CASE WHEN status IN ('draft','investigating') THEN 'regulator_notified' ELSE status END, updated_at = ?
     WHERE id = ?`,
  ).run(now, now, breachId);
  return { incident: getBreachIncident(breachId)!, notification: notif };
}

export interface NotifyUsersInput {
  channel?: NotifyChannel;
  subject?: string | null;
  body?: string | null;
}

export function notifyAffectedUsers(breachId: string, input: NotifyUsersInput = {}): { sent: number; failed: number } {
  const db = getDb();
  const inc = getBreachIncident(breachId);
  if (!inc) throw new Error('breach_not_found');
  const users = listAffectedUsers(breachId, 100000).filter(u => u.notify_status === 'pending');
  const now = new Date().toISOString();
  let sent = 0;
  let failed = 0;
  for (const u of users) {
    try {
      recordNotification(breachId, {
        target: 'user',
        target_ref: u.user_id,
        channel: input.channel ?? 'email',
        subject: input.subject ?? `Important security notice: ${inc.title}`,
        body: input.body ?? null,
      }, 'sent');
      db.prepare(
        `UPDATE breach_affected_users SET notify_status = 'sent', notified_at = ? WHERE id = ?`,
      ).run(now, u.id);
      sent++;
    } catch (e) {
      db.prepare(
        `UPDATE breach_affected_users SET notify_status = 'failed' WHERE id = ?`,
      ).run(u.id);
      failed++;
    }
  }
  const finalStatus = inc.status === 'closed' ? 'closed' : 'users_notified';
  db.prepare(
    `UPDATE breach_incidents
     SET users_notified_at = COALESCE(users_notified_at, ?), status = ?, updated_at = ?
     WHERE id = ?`,
  ).run(sent > 0 ? now : null, finalStatus, now, breachId);
  return { sent, failed };
}

export function closeBreach(breachId: string, _adminId: string | null): BreachIncident | null {
  const db = getDb();
  if (!getBreachIncident(breachId)) return null;
  const now = new Date().toISOString();
  db.prepare(`UPDATE breach_incidents SET status = 'closed', closed_at = ?, updated_at = ? WHERE id = ?`)
    .run(now, now, breachId);
  return getBreachIncident(breachId);
}

// ---------- Reporting ----------

export interface BreachDeadline {
  id: string;
  title: string;
  risk_level: BreachRisk;
  status: BreachStatus;
  discovered_at: string;
  deadline_at: string;
  hours_remaining: number;
  overdue: boolean;
}

export function listUpcomingDeadlines(): { upcoming: BreachDeadline[]; overdue: BreachDeadline[] } {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, title, risk_level, status, discovered_at, deadline_at
     FROM breach_incidents
     WHERE regulator_notified_at IS NULL
       AND status NOT IN ('closed','users_notified')
     ORDER BY deadline_at ASC`,
  ).all() as Array<Pick<BreachIncident, 'id'|'title'|'risk_level'|'status'|'discovered_at'|'deadline_at'>>;
  const now = Date.now();
  const upcoming: BreachDeadline[] = [];
  const overdue: BreachDeadline[] = [];
  for (const r of rows) {
    const remaining = (new Date(r.deadline_at).getTime() - now) / HOUR_MS;
    const item: BreachDeadline = { ...r, hours_remaining: Math.round(remaining * 100) / 100, overdue: remaining < 0 };
    if (item.overdue) overdue.push(item); else upcoming.push(item);
  }
  return { upcoming, overdue };
}

export interface BreachStats {
  total: number;
  open: number;
  regulator_notified: number;
  users_notified: number;
  closed: number;
  overdue_regulator: number;
  window_days: number;
  by_risk: Record<BreachRisk, number>;
}

export function getBreachStats(windowDays = 90): BreachStats {
  const db = getDb();
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM breach_incidents WHERE discovered_at >= ?`).get(since) as { c: number }).c;
  const openRow = (db.prepare(`SELECT COUNT(*) AS c FROM breach_incidents WHERE status IN ('draft','investigating') AND discovered_at >= ?`).get(since) as { c: number }).c;
  const regRow = (db.prepare(`SELECT COUNT(*) AS c FROM breach_incidents WHERE regulator_notified_at IS NOT NULL AND discovered_at >= ?`).get(since) as { c: number }).c;
  const usrRow = (db.prepare(`SELECT COUNT(*) AS c FROM breach_incidents WHERE users_notified_at IS NOT NULL AND discovered_at >= ?`).get(since) as { c: number }).c;
  const closedRow = (db.prepare(`SELECT COUNT(*) AS c FROM breach_incidents WHERE status = 'closed' AND discovered_at >= ?`).get(since) as { c: number }).c;
  const overdueRow = (db.prepare(
    `SELECT COUNT(*) AS c FROM breach_incidents
     WHERE regulator_notified_at IS NULL AND deadline_at < ?
       AND status NOT IN ('closed')`,
  ).get(new Date().toISOString()) as { c: number }).c;
  const by_risk: Record<BreachRisk, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  const riskRows = db.prepare(
    `SELECT risk_level, COUNT(*) AS c FROM breach_incidents WHERE discovered_at >= ? GROUP BY risk_level`,
  ).all(since) as Array<{ risk_level: BreachRisk; c: number }>;
  for (const r of riskRows) by_risk[r.risk_level] = r.c;
  return {
    total, open: openRow, regulator_notified: regRow, users_notified: usrRow,
    closed: closedRow, overdue_regulator: overdueRow, window_days: windowDays, by_risk,
  };
}
