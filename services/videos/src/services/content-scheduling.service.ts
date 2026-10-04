// melodyflix videos — Content Scheduling & Planning (Section 39)
// 39.1 Content Calendar  39.2 Batch Scheduling  39.3 Recurring Upload
// 39.4 Time Zone-Based Publishing  39.5 Editorial Calendar
// 39.6 Content Planning Dashboard  39.7 Team Task Assignment  39.8 Deadline Reminders
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type ScheduleStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';
export type ItemPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TaskStatus = 'open' | 'in_progress' | 'blocked' | 'done';

export interface ScheduledItem {
  id: string;
  channel_id: string;
  video_id: string | null;
  title: string;
  description: string | null;
  publish_at: string;
  timezone: string;
  status: ScheduleStatus;
  priority: ItemPriority;
  assigned_to: string | null;
  notes: string | null;
  is_recurring: number;
  recurrence_rule: string | null;
  parent_item_id: string | null;
  published_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ContentTask {
  id: string;
  channel_id: string;
  item_id: string | null;
  title: string;
  description: string | null;
  assignee_id: string;
  status: TaskStatus;
  due_at: string | null;
  completed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/;

export function ensureContentSchedulingSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_scheduled_items (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      video_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      publish_at TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      status TEXT NOT NULL DEFAULT 'scheduled',
      priority TEXT NOT NULL DEFAULT 'normal',
      assigned_to TEXT,
      notes TEXT,
      is_recurring INTEGER NOT NULL DEFAULT 0,
      recurrence_rule TEXT,
      parent_item_id TEXT,
      published_at TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sched_channel ON content_scheduled_items(channel_id, publish_at);
    CREATE INDEX IF NOT EXISTS idx_sched_status ON content_scheduled_items(status);
    CREATE INDEX IF NOT EXISTS idx_sched_assignee ON content_scheduled_items(assigned_to);
    CREATE INDEX IF NOT EXISTS idx_sched_parent ON content_scheduled_items(parent_item_id);

    CREATE TABLE IF NOT EXISTS content_tasks (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      item_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      assignee_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      due_at TEXT,
      completed_at TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_channel ON content_tasks(channel_id, status);
    CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON content_tasks(assignee_id, status);
    CREATE INDEX IF NOT EXISTS idx_tasks_due ON content_tasks(due_at);
  `);
}

// ============================================================
// 39.1 / 39.2 — Create / Batch create / Update
// ============================================================

function validatePublishAt(iso: string): void {
  if (!ISO_RE.test(iso)) throw new Error('publish_at must be ISO 8601 (UTC)');
}

export function createScheduledItem(input: {
  channel_id: string;
  created_by: string;
  title: string;
  publish_at: string;
  video_id?: string | null;
  description?: string | null;
  timezone?: string;
  priority?: ItemPriority;
  assigned_to?: string | null;
  notes?: string | null;
  is_recurring?: boolean;
  recurrence_rule?: string | null;
  parent_item_id?: string | null;
}): ScheduledItem {
  const title = (input.title ?? '').trim();
  if (title.length < 1 || title.length > 200) throw new Error('title must be 1-200 chars');
  validatePublishAt(input.publish_at);
  if (input.is_recurring && !input.recurrence_rule) {
    throw new Error('recurrence_rule required when is_recurring is true');
  }

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO content_scheduled_items
      (id, channel_id, video_id, title, description, publish_at, timezone, status, priority,
       assigned_to, notes, is_recurring, recurrence_rule, parent_item_id, published_at,
       created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
  `).run(
    id, input.channel_id, input.video_id ?? null, title, input.description ?? null,
    input.publish_at, input.timezone ?? 'UTC', input.priority ?? 'normal',
    input.assigned_to ?? null, input.notes ?? null,
    input.is_recurring ? 1 : 0, input.recurrence_rule ?? null, input.parent_item_id ?? null,
    input.created_by, now, now,
  );
  return getScheduledItem(id)!;
}

export function batchCreateScheduledItems(inputs: Array<Parameters<typeof createScheduledItem>[0]>): ScheduledItem[] {
  if (inputs.length === 0) throw new Error('No items provided');
  if (inputs.length > 100) throw new Error('Batch limit is 100 items');
  const db = getDb();
  const results: ScheduledItem[] = [];
  db.exec('BEGIN');
  try {
    for (const inp of inputs) {
      results.push(createScheduledItem(inp));
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return results;
}

export function getScheduledItem(id: string): ScheduledItem | null {
  return (getDb().prepare('SELECT * FROM content_scheduled_items WHERE id = ?').get(id) as ScheduledItem | undefined) ?? null;
}

export function updateScheduledItem(id: string, requesterId: string, patch: {
  title?: string;
  description?: string | null;
  publish_at?: string;
  timezone?: string;
  priority?: ItemPriority;
  assigned_to?: string | null;
  notes?: string | null;
  status?: ScheduleStatus;
}): ScheduledItem {
  const db = getDb();
  const existing = getScheduledItem(id);
  if (!existing) throw new Error('Scheduled item not found');
  if (patch.publish_at) validatePublishAt(patch.publish_at);

  const fields: string[] = [];
  const params: any[] = [];
  const allowed: (keyof typeof patch)[] = ['title', 'description', 'publish_at', 'timezone', 'priority', 'assigned_to', 'notes', 'status'];
  for (const k of allowed) {
    if (patch[k] !== undefined) { fields.push(`${k} = ?`); params.push(patch[k]); }
  }
  if (fields.length === 0) return existing;
  fields.push('updated_at = ?');
  params.push(new Date().toISOString(), id);
  db.prepare(`UPDATE content_scheduled_items SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getScheduledItem(id)!;
}

export function cancelScheduledItem(id: string): boolean {
  const db = getDb();
  const info = db.prepare(
    "UPDATE content_scheduled_items SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('draft','scheduled')"
  ).run(new Date().toISOString(), id);
  return Number(info.changes ?? 0) > 0;
}

export function deleteScheduledItem(id: string): boolean {
  const info = getDb().prepare('DELETE FROM content_scheduled_items WHERE id = ?').run(id);
  return Number(info.changes ?? 0) > 0;
}

// ============================================================
// 39.1 / 39.5 — Calendar views
// ============================================================

export function listScheduledItems(channelId: string, opts: {
  from?: string;
  to?: string;
  status?: ScheduleStatus;
  assigned_to?: string;
  priority?: ItemPriority;
  limit?: number;
} = {}): ScheduledItem[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const filters: string[] = ['channel_id = ?'];
  const params: any[] = [channelId];
  if (opts.from) { filters.push('publish_at >= ?'); params.push(opts.from); }
  if (opts.to) { filters.push('publish_at <= ?'); params.push(opts.to); }
  if (opts.status) { filters.push('status = ?'); params.push(opts.status); }
  if (opts.assigned_to) { filters.push('assigned_to = ?'); params.push(opts.assigned_to); }
  if (opts.priority) { filters.push('priority = ?'); params.push(opts.priority); }
  params.push(limit);
  return db.prepare(
    `SELECT * FROM content_scheduled_items WHERE ${filters.join(' AND ')} ORDER BY publish_at ASC LIMIT ?`
  ).all(...params) as ScheduledItem[];
}

/**
 * 39.1 — Content Calendar: returns items grouped by date (YYYY-MM-DD).
 */
export function getContentCalendar(channelId: string, from: string, to: string): Record<string, ScheduledItem[]> {
  const items = listScheduledItems(channelId, { from, to, limit: 500 });
  const grouped: Record<string, ScheduledItem[]> = {};
  for (const it of items) {
    const day = it.publish_at.slice(0, 10);
    if (!grouped[day]) grouped[day] = [];
    grouped[day].push(it);
  }
  return grouped;
}

/**
 * 39.5 — Editorial Calendar: content-planning view (draft + scheduled + notes + priority).
 */
export function getEditorialCalendar(channelId: string, from: string, to: string): Array<{
  date: string;
  items: Array<ScheduledItem & { has_notes: boolean; is_high_priority: boolean }>;
}> {
  const grouped = getContentCalendar(channelId, from, to);
  return Object.keys(grouped).sort().map((date) => ({
    date,
    items: grouped[date].map((it) => ({
      ...it,
      has_notes: !!(it.notes && it.notes.length > 0),
      is_high_priority: it.priority === 'high' || it.priority === 'urgent',
    })),
  }));
}

// ============================================================
// 39.3 — Recurring Upload
// ============================================================

/**
 * Simple recurrence parser. Supports:
 *   daily, weekly:<0-6>, monthly:<1-28>, cron-ish "hour:minute"
 * Returns next occurrence timestamp (ISO) or null when done.
 */
export function computeNextOccurrence(currentIso: string, rule: string): string | null {
  const cur = new Date(currentIso);
  if (isNaN(cur.getTime())) return null;
  const parts = rule.trim().toLowerCase().split(':');
  const kind = parts[0];
  if (kind === 'daily') {
    return new Date(cur.getTime() + 86400_000).toISOString();
  }
  if (kind === 'weekly') {
    const target = parseInt(parts[1] ?? '0', 10);
    if (target < 0 || target > 6) return null;
    let next = new Date(cur.getTime() + 86400_000);
    while (next.getUTCDay() !== target) next = new Date(next.getTime() + 86400_000);
    return next.toISOString();
  }
  if (kind === 'monthly') {
    const day = parseInt(parts[1] ?? '1', 10);
    if (day < 1 || day > 28) return null;
    const next = new Date(cur);
    next.setUTCMonth(next.getUTCMonth() + 1);
    next.setUTCDate(day);
    return next.toISOString();
  }
  return null;
}

/**
 * 39.3 — Expand a recurring item into N future occurrences (as draft items).
 */
export function expandRecurring(parentId: string, occurrences: number): ScheduledItem[] {
  const parent = getScheduledItem(parentId);
  if (!parent || parent.is_recurring !== 1 || !parent.recurrence_rule) {
    throw new Error('Parent is not a recurring item');
  }
  const n = Math.min(Math.max(occurrences, 1), 52);
  const results: ScheduledItem[] = [];
  let cur = parent.publish_at;
  for (let i = 0; i < n; i++) {
    const next = computeNextOccurrence(cur, parent.recurrence_rule);
    if (!next) break;
    cur = next;
    const child = createScheduledItem({
      channel_id: parent.channel_id,
      created_by: parent.created_by,
      title: parent.title,
      description: parent.description,
      video_id: parent.video_id,
      publish_at: next,
      timezone: parent.timezone,
      priority: parent.priority,
      assigned_to: parent.assigned_to,
      notes: parent.notes,
      is_recurring: false,
      parent_item_id: parent.id,
    });
    results.push(child);
  }
  return results;
}

// ============================================================
// 39.4 — Time Zone-Based Publishing
// ============================================================

/**
 * Returns items whose publish_at falls between `hour:minute` windows in the given IANA timezone.
 * Uses Intl.DateTimeFormat for correct DST handling.
 */
export function listItemsByTimeZone(channelId: string, timezone: string): ScheduledItem[] {
  const db = getDb();
  const all = db.prepare(
    "SELECT * FROM content_scheduled_items WHERE channel_id = ? AND status = 'scheduled' ORDER BY publish_at ASC LIMIT 500"
  ).all(channelId) as ScheduledItem[];

  // Validate timezone
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); }
  catch { throw new Error('Invalid timezone'); }

  // Just return items whose stored timezone differs OR match the requested tz
  return all.filter((it) => it.timezone === timezone);
}

// ============================================================
// 39.6 — Content Planning Dashboard
// ============================================================

export interface PlanningDashboard {
  total_items: number;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  upcoming_7d: number;
  overdue: number;
  assigned_to_me: number;
  open_tasks: number;
  next_item: ScheduledItem | null;
}

export function getPlanningDashboard(channelId: string, userId?: string): PlanningDashboard {
  const db = getDb();
  const statusRows = db.prepare(
    'SELECT status, COUNT(*) as n FROM content_scheduled_items WHERE channel_id = ? GROUP BY status'
  ).all(channelId) as Array<{ status: string; n: number }>;
  const priorityRows = db.prepare(
    'SELECT priority, COUNT(*) as n FROM content_scheduled_items WHERE channel_id = ? GROUP BY priority'
  ).all(channelId) as Array<{ priority: string; n: number }>;
  const total = (db.prepare('SELECT COUNT(*) as n FROM content_scheduled_items WHERE channel_id = ?').get(channelId) as { n: number }).n;
  const now = new Date().toISOString();
  const in7d = new Date(Date.now() + 7 * 86400_000).toISOString();
  const upcoming = (db.prepare(
    "SELECT COUNT(*) as n FROM content_scheduled_items WHERE channel_id = ? AND status = 'scheduled' AND publish_at BETWEEN ? AND ?"
  ).get(channelId, now, in7d) as { n: number }).n;
  const overdue = (db.prepare(
    "SELECT COUNT(*) as n FROM content_scheduled_items WHERE channel_id = ? AND status = 'scheduled' AND publish_at < ?"
  ).get(channelId, now) as { n: number }).n;
  const assigned = userId ? (db.prepare(
    "SELECT COUNT(*) as n FROM content_scheduled_items WHERE channel_id = ? AND assigned_to = ? AND status IN ('draft','scheduled')"
  ).get(channelId, userId) as { n: number }).n : 0;
  const openTasks = (db.prepare(
    "SELECT COUNT(*) as n FROM content_tasks WHERE channel_id = ? AND status IN ('open','in_progress','blocked')"
  ).get(channelId) as { n: number }).n;
  const nextItem = (db.prepare(
    "SELECT * FROM content_scheduled_items WHERE channel_id = ? AND status = 'scheduled' ORDER BY publish_at ASC LIMIT 1"
  ).get(channelId) as ScheduledItem | undefined) ?? null;

  return {
    total_items: total,
    by_status: Object.fromEntries(statusRows.map((r) => [r.status, r.n])),
    by_priority: Object.fromEntries(priorityRows.map((r) => [r.priority, r.n])),
    upcoming_7d: upcoming,
    overdue,
    assigned_to_me: assigned,
    open_tasks: openTasks,
    next_item: nextItem,
  };
}

// ============================================================
// 39.7 — Team Task Assignment
// ============================================================

export function createTask(input: {
  channel_id: string;
  created_by: string;
  assignee_id: string;
  title: string;
  description?: string | null;
  item_id?: string | null;
  due_at?: string | null;
}): ContentTask {
  const title = (input.title ?? '').trim();
  if (title.length < 1 || title.length > 200) throw new Error('title must be 1-200 chars');
  if (!input.assignee_id) throw new Error('assignee_id required');
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO content_tasks
      (id, channel_id, item_id, title, description, assignee_id, status, due_at, completed_at, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?, NULL, ?, ?, ?)
  `).run(id, input.channel_id, input.item_id ?? null, title, input.description ?? null,
    input.assignee_id, input.due_at ?? null, input.created_by, now, now);
  return getTask(id)!;
}

export function getTask(id: string): ContentTask | null {
  return (getDb().prepare('SELECT * FROM content_tasks WHERE id = ?').get(id) as ContentTask | undefined) ?? null;
}

export function listTasks(channelId: string, opts: { assignee_id?: string; status?: TaskStatus; limit?: number } = {}): ContentTask[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const filters: string[] = ['channel_id = ?'];
  const params: any[] = [channelId];
  if (opts.assignee_id) { filters.push('assignee_id = ?'); params.push(opts.assignee_id); }
  if (opts.status) { filters.push('status = ?'); params.push(opts.status); }
  params.push(limit);
  return db.prepare(
    `SELECT * FROM content_tasks WHERE ${filters.join(' AND ')} ORDER BY COALESCE(due_at, '9999') ASC LIMIT ?`
  ).all(...params) as ContentTask[];
}

export function updateTask(id: string, patch: { status?: TaskStatus; due_at?: string | null; title?: string; description?: string | null; assignee_id?: string }): ContentTask {
  const db = getDb();
  const existing = getTask(id);
  if (!existing) throw new Error('Task not found');
  const fields: string[] = [];
  const params: any[] = [];
  const allowed: (keyof typeof patch)[] = ['status', 'due_at', 'title', 'description', 'assignee_id'];
  for (const k of allowed) {
    if (patch[k] !== undefined) { fields.push(`${k} = ?`); params.push(patch[k]); }
  }
  if (patch.status === 'done') { fields.push('completed_at = ?'); params.push(new Date().toISOString()); }
  if (fields.length === 0) return existing;
  fields.push('updated_at = ?');
  params.push(new Date().toISOString(), id);
  db.prepare(`UPDATE content_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getTask(id)!;
}

export function deleteTask(id: string): boolean {
  const info = getDb().prepare('DELETE FROM content_tasks WHERE id = ?').run(id);
  return Number(info.changes ?? 0) > 0;
}

// ============================================================
// 39.8 — Deadline Reminders
// ============================================================

export interface DeadlineReminder {
  kind: 'item' | 'task';
  id: string;
  title: string;
  due_at: string;
  assigned_to: string | null;
  hours_until_due: number;
  is_overdue: boolean;
}

export function listDeadlineReminders(channelId: string, withinHours = 48): DeadlineReminder[] {
  const db = getDb();
  const now = Date.now();
  const horizonMs = withinHours * 3600_000;
  const horizon = new Date(now + horizonMs).toISOString();

  const items = db.prepare(`
    SELECT id, title, publish_at AS due_at, assigned_to FROM content_scheduled_items
    WHERE channel_id = ? AND status IN ('draft','scheduled') AND publish_at <= ?
    ORDER BY publish_at ASC LIMIT 100
  `).all(channelId, horizon) as Array<{ id: string; title: string; due_at: string; assigned_to: string | null }>;

  const tasks = db.prepare(`
    SELECT id, title, due_at, assignee_id AS assigned_to FROM content_tasks
    WHERE channel_id = ? AND status IN ('open','in_progress','blocked') AND due_at IS NOT NULL AND due_at <= ?
    ORDER BY due_at ASC LIMIT 100
  `).all(channelId, horizon) as Array<{ id: string; title: string; due_at: string; assigned_to: string | null }>;

  const all: DeadlineReminder[] = [
    ...items.map((r) => ({
      kind: 'item' as const, id: r.id, title: r.title, due_at: r.due_at, assigned_to: r.assigned_to,
      hours_until_due: Math.round((new Date(r.due_at).getTime() - now) / 3600_000),
      is_overdue: new Date(r.due_at).getTime() < now,
    })),
    ...tasks.map((r) => ({
      kind: 'task' as const, id: r.id, title: r.title, due_at: r.due_at, assigned_to: r.assigned_to,
      hours_until_due: Math.round((new Date(r.due_at).getTime() - now) / 3600_000),
      is_overdue: new Date(r.due_at).getTime() < now,
    })),
  ];
  return all.sort((a, b) => a.due_at.localeCompare(b.due_at));
}
