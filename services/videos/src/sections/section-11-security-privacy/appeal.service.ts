// melodyflix videos - Section 11.7 Appeal System
// Users can appeal moderation decisions (content removal, account suspension,
// strike, block, ban). Admins review appeals with full audit trail.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type AppealType = 'content_removal' | 'account_suspension' | 'strike' | 'block' | 'ban' | 'other';
export type AppealStatus = 'submitted' | 'under_review' | 'awaiting_user' | 'approved' | 'rejected' | 'withdrawn' | 'expired';
export type AppealPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Appeal {
  id: string;
  user_id: string;
  appeal_type: AppealType;
  target_id: string | null;
  target_type: string | null;
  subject: string;
  description: string;
  evidence_urls: string;
  status: AppealStatus;
  priority: AppealPriority;
  assigned_to: string | null;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  due_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppealEvent {
  id: string;
  appeal_id: string;
  actor_id: string | null;
  event_type: string;
  note: string | null;
  metadata: string | null;
  created_at: string;
}

export interface CreateAppealInput {
  user_id: string;
  appeal_type: AppealType;
  target_id?: string | null;
  target_type?: string | null;
  subject: string;
  description: string;
  evidence_urls?: string[];
  priority?: AppealPriority;
}

export interface UpdateAppealInput {
  status?: AppealStatus;
  priority?: AppealPriority;
  assigned_to?: string | null;
  resolution_note?: string | null;
  due_at?: string | null;
}

const VALID_TYPES: AppealType[] = ['content_removal', 'account_suspension', 'strike', 'block', 'ban', 'other'];
const VALID_STATUSES: AppealStatus[] = ['submitted', 'under_review', 'awaiting_user', 'approved', 'rejected', 'withdrawn', 'expired'];
const VALID_PRIORITIES: AppealPriority[] = ['low', 'normal', 'high', 'urgent'];

// Default SLA in hours per priority
const SLA_HOURS: Record<AppealPriority, number> = {
  low: 168,     // 7 days
  normal: 72,   // 3 days
  high: 24,     // 1 day
  urgent: 4,    // 4 hours
};

export function ensureAppealSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS appeals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      appeal_type TEXT NOT NULL,
      target_id TEXT,
      target_type TEXT,
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      evidence_urls TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'submitted',
      priority TEXT NOT NULL DEFAULT 'normal',
      assigned_to TEXT,
      resolution_note TEXT,
      resolved_by TEXT,
      resolved_at TEXT,
      due_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_appeal_user ON appeals(user_id);
    CREATE INDEX IF NOT EXISTS idx_appeal_status ON appeals(status);
    CREATE INDEX IF NOT EXISTS idx_appeal_assigned ON appeals(assigned_to);
    CREATE INDEX IF NOT EXISTS idx_appeal_type ON appeals(appeal_type);
    CREATE INDEX IF NOT EXISTS idx_appeal_target ON appeals(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_appeal_created ON appeals(created_at);

    CREATE TABLE IF NOT EXISTS appeal_events (
      id TEXT PRIMARY KEY,
      appeal_id TEXT NOT NULL,
      actor_id TEXT,
      event_type TEXT NOT NULL,
      note TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_appeal_event_appeal ON appeal_events(appeal_id);
    CREATE INDEX IF NOT EXISTS idx_appeal_event_created ON appeal_events(created_at);
  `);
}

function rowToAppeal(r: any): Appeal {
  return {
    ...r,
    evidence_urls: JSON.parse(r.evidence_urls || '[]'),
  };
}

// ============================================================
// Validation
// ============================================================

function validateAppeal(input: CreateAppealInput): void {
  if (!input.user_id || typeof input.user_id !== 'string') throw new Error('user_id is required');
  if (!VALID_TYPES.includes(input.appeal_type)) throw new Error(`Invalid appeal_type: ${input.appeal_type}`);
  if (!input.subject || input.subject.trim().length < 3 || input.subject.trim().length > 200) {
    throw new Error('subject must be 3-200 chars');
  }
  if (!input.description || input.description.trim().length < 10 || input.description.trim().length > 5000) {
    throw new Error('description must be 10-5000 chars');
  }
  if (input.priority && !VALID_PRIORITIES.includes(input.priority)) {
    throw new Error(`Invalid priority: ${input.priority}`);
  }
  if (input.evidence_urls && input.evidence_urls.length > 10) {
    throw new Error('At most 10 evidence URLs allowed');
  }
}

function computeDueAt(priority: AppealPriority, from = new Date()): string {
  const hours = SLA_HOURS[priority] ?? 72;
  return new Date(from.getTime() + hours * 3600_000).toISOString();
}

// ============================================================
// Events (audit trail)
// ============================================================

function logEvent(appealId: string, actorId: string | null, eventType: string, note?: string | null, metadata?: Record<string, unknown> | null): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO appeal_events (id, appeal_id, actor_id, event_type, note, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    appealId,
    actorId,
    eventType,
    note ?? null,
    metadata ? JSON.stringify(metadata) : null,
    new Date().toISOString(),
  );
}

// ============================================================
// CRUD
// ============================================================

export function createAppeal(input: CreateAppealInput): Appeal {
  validateAppeal(input);
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const priority = input.priority ?? 'normal';
  const dueAt = computeDueAt(priority);
  const evidence = JSON.stringify(input.evidence_urls ?? []);

  db.prepare(`
    INSERT INTO appeals
      (id, user_id, appeal_type, target_id, target_type, subject, description,
       evidence_urls, status, priority, assigned_to, resolution_note,
       resolved_by, resolved_at, due_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, NULL, NULL, NULL, NULL, ?, ?, ?)
  `).run(
    id,
    input.user_id,
    input.appeal_type,
    input.target_id ?? null,
    input.target_type ?? null,
    input.subject.trim(),
    input.description.trim(),
    evidence,
    priority,
    dueAt,
    now,
    now,
  );

  logEvent(id, input.user_id, 'submitted', 'Appeal submitted', {
    appeal_type: input.appeal_type,
    target_type: input.target_type ?? null,
    target_id: input.target_id ?? null,
  });

  return getAppeal(id)!;
}

export function getAppeal(id: string): Appeal | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM appeals WHERE id = ?').get(id) as any;
  return r ? rowToAppeal(r) : null;
}

export interface ListAppealsOpts {
  user_id?: string;
  status?: AppealStatus;
  appeal_type?: AppealType;
  assigned_to?: string;
  priority?: AppealPriority;
  overdue_only?: boolean;
  limit?: number;
  offset?: number;
}

export function listAppeals(opts: ListAppealsOpts = {}): { appeals: Appeal[]; total: number } {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];

  if (opts.user_id) { where.push('user_id = ?'); params.push(opts.user_id); }
  if (opts.status) { where.push('status = ?'); params.push(opts.status); }
  if (opts.appeal_type) { where.push('appeal_type = ?'); params.push(opts.appeal_type); }
  if (opts.assigned_to) { where.push('assigned_to = ?'); params.push(opts.assigned_to); }
  if (opts.priority) { where.push('priority = ?'); params.push(opts.priority); }
  if (opts.overdue_only) {
    where.push("due_at IS NOT NULL AND due_at < ? AND status NOT IN ('approved','rejected','withdrawn','expired')");
    params.push(new Date().toISOString());
  }

  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const total = (db.prepare(`SELECT COUNT(*) as c FROM appeals ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT * FROM appeals ${w} ORDER BY
      CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
      created_at ASC
     LIMIT ${limit} OFFSET ${offset}`
  ).all(...params) as any[];

  return { appeals: rows.map(rowToAppeal), total };
}

export function updateAppeal(id: string, patch: UpdateAppealInput, actorId: string | null): Appeal {
  const db = getDb();
  const existing = getAppeal(id);
  if (!existing) throw new Error('Appeal not found');

  const fields: string[] = [];
  const params: any[] = [];
  const changes: Record<string, { from: any; to: any }> = {};

  if (patch.status !== undefined) {
    if (!VALID_STATUSES.includes(patch.status)) throw new Error(`Invalid status: ${patch.status}`);
    if (existing.status !== patch.status) {
      changes.status = { from: existing.status, to: patch.status };
      fields.push('status = ?');
      params.push(patch.status);

      // If resolving, record resolver + time
      if (['approved', 'rejected', 'withdrawn', 'expired'].includes(patch.status)) {
        fields.push('resolved_by = ?');
        params.push(actorId);
        fields.push('resolved_at = ?');
        params.push(new Date().toISOString());
      }
    }
  }

  if (patch.priority !== undefined) {
    if (!VALID_PRIORITIES.includes(patch.priority)) throw new Error(`Invalid priority: ${patch.priority}`);
    if (existing.priority !== patch.priority) {
      changes.priority = { from: existing.priority, to: patch.priority };
      fields.push('priority = ?');
      params.push(patch.priority);
      // Recompute due date on priority change
      fields.push('due_at = ?');
      params.push(computeDueAt(patch.priority, new Date(existing.created_at)));
    }
  }

  if (patch.assigned_to !== undefined) {
    if (existing.assigned_to !== patch.assigned_to) {
      changes.assigned_to = { from: existing.assigned_to, to: patch.assigned_to };
      fields.push('assigned_to = ?');
      params.push(patch.assigned_to);
    }
  }

  if (patch.resolution_note !== undefined) {
    fields.push('resolution_note = ?');
    params.push(patch.resolution_note);
  }

  if (patch.due_at !== undefined) {
    fields.push('due_at = ?');
    params.push(patch.due_at);
  }

  if (fields.length === 0) return existing;

  fields.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);

  db.prepare(`UPDATE appeals SET ${fields.join(', ')} WHERE id = ?`).run(...params);

  if (Object.keys(changes).length > 0) {
    logEvent(id, actorId, 'updated', 'Appeal updated', changes);
  }

  return getAppeal(id)!;
}

export function assignAppeal(id: string, assigneeId: string | null, actorId: string | null): Appeal {
  const existing = getAppeal(id);
  if (!existing) throw new Error('Appeal not found');

  const appeal = updateAppeal(id, { assigned_to: assigneeId }, actorId);
  logEvent(id, actorId, assigneeId ? 'assigned' : 'unassigned',
    assigneeId ? `Assigned to ${assigneeId}` : 'Unassigned',
    { previous: existing.assigned_to, current: assigneeId });
  return appeal;
}

export function withdrawAppeal(id: string, userId: string): Appeal {
  const existing = getAppeal(id);
  if (!existing) throw new Error('Appeal not found');
  if (existing.user_id !== userId) throw new Error('Not your appeal');
  if (['approved', 'rejected', 'withdrawn', 'expired'].includes(existing.status)) {
    throw new Error(`Cannot withdraw appeal in status ${existing.status}`);
  }
  return updateAppeal(id, { status: 'withdrawn' }, userId);
}

export function listAppealEvents(appealId: string): AppealEvent[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM appeal_events WHERE appeal_id = ? ORDER BY created_at ASC'
  ).all(appealId) as any[];
  return rows.map((r) => ({ ...r }));
}

// ============================================================
// Stats & Analytics
// ============================================================

export interface AppealStats {
  total: number;
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  by_priority: Record<string, number>;
  overdue: number;
  avg_resolution_hours: number | null;
  window_days: number;
}

export function getAppealStats(windowDays = 30): AppealStats {
  const db = getDb();
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString();

  const total = (db.prepare(
    'SELECT COUNT(*) as c FROM appeals WHERE created_at >= ?'
  ).get(since) as { c: number }).c;

  const byStatus: Record<string, number> = {};
  for (const r of db.prepare(
    'SELECT status, COUNT(*) as c FROM appeals WHERE created_at >= ? GROUP BY status'
  ).all(since) as Array<{ status: string; c: number }>) {
    byStatus[r.status] = r.c;
  }

  const byType: Record<string, number> = {};
  for (const r of db.prepare(
    'SELECT appeal_type, COUNT(*) as c FROM appeals WHERE created_at >= ? GROUP BY appeal_type'
  ).all(since) as Array<{ appeal_type: string; c: number }>) {
    byType[r.appeal_type] = r.c;
  }

  const byPriority: Record<string, number> = {};
  for (const r of db.prepare(
    'SELECT priority, COUNT(*) as c FROM appeals WHERE created_at >= ? GROUP BY priority'
  ).all(since) as Array<{ priority: string; c: number }>) {
    byPriority[r.priority] = r.c;
  }

  const overdue = (db.prepare(
    `SELECT COUNT(*) as c FROM appeals
     WHERE due_at IS NOT NULL AND due_at < ?
       AND status NOT IN ('approved','rejected','withdrawn','expired')`
  ).get(new Date().toISOString()) as { c: number }).c;

  const resolved = db.prepare(
    `SELECT created_at, resolved_at FROM appeals
     WHERE resolved_at IS NOT NULL AND created_at >= ?`
  ).all(since) as Array<{ created_at: string; resolved_at: string }>;

  let avgHours: number | null = null;
  if (resolved.length > 0) {
    const sum = resolved.reduce((acc, r) => {
      const created = new Date(r.created_at).getTime();
      const done = new Date(r.resolved_at).getTime();
      return acc + (done - created);
    }, 0);
    avgHours = Math.round((sum / resolved.length / 3600_000) * 10) / 10;
  }

  return {
    total,
    by_status: byStatus,
    by_type: byType,
    by_priority: byPriority,
    overdue,
    avg_resolution_hours: avgHours,
    window_days: windowDays,
  };
}

export interface AdminWorkload {
  assigned_to: string | null;
  open_count: number;
  overdue_count: number;
}

export function getAdminWorkload(): AdminWorkload[] {
  const db = getDb();
  const openStatuses = "('submitted','under_review','awaiting_user')";
  const now = new Date().toISOString();
  const rows = db.prepare(`
    SELECT
      assigned_to,
      COUNT(*) as open_count,
      SUM(CASE WHEN due_at IS NOT NULL AND due_at < ? THEN 1 ELSE 0 END) as overdue_count
    FROM appeals
    WHERE status IN ${openStatuses}
    GROUP BY assigned_to
    ORDER BY open_count DESC
  `).all(now) as Array<{ assigned_to: string | null; open_count: number; overdue_count: number }>;
  return rows.map((r) => ({
    assigned_to: r.assigned_to,
    open_count: r.open_count,
    overdue_count: r.overdue_count ?? 0,
  }));
}

// ============================================================
// Maintenance
// ============================================================

/** Expire overdue appeals that are still open and past their SLA by N days. */
export function expireStaleAppeals(graceDays = 7): { expired: number } {
  const db = getDb();
  const cutoff = new Date(Date.now() - graceDays * 86400_000).toISOString();
  const rows = db.prepare(`
    SELECT id FROM appeals
    WHERE due_at IS NOT NULL AND due_at < ?
      AND status IN ('submitted','under_review','awaiting_user')
  `).all(cutoff) as Array<{ id: string }>;

  if (rows.length === 0) return { expired: 0 };

  const now = new Date().toISOString();
  const stmt = db.prepare(
    "UPDATE appeals SET status = 'expired', resolved_at = ?, updated_at = ? WHERE id = ?"
  );
  for (const r of rows) {
    stmt.run(now, now, r.id);
    logEvent(r.id, null, 'expired', 'Auto-expired after grace period');
  }
  return { expired: rows.length };
}

/** Prune very old resolved appeals (hard delete, default 1 year). */
export function pruneOldAppeals(olderThanDays = 365): { pruned: number } {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000).toISOString();
  const info = db.prepare(
    `DELETE FROM appeals
     WHERE status IN ('approved','rejected','withdrawn','expired')
       AND COALESCE(resolved_at, updated_at) < ?`
  ).run(cutoff);
  return { pruned: info.changes };
}
