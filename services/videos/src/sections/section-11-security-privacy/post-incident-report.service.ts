// melodyflix videos - Section 11.23 Post-Incident Report
// Structured post-mortem reports tied to incidents (11.20).
// Timeline events, root cause, lessons learned, and CAPA
// (Corrective And Preventive Actions) with owner + due date.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type ReportStatus = 'draft' | 'in_review' | 'published' | 'archived';
export type TimelineEventType =
  | 'detection' | 'escalation' | 'mitigation' | 'recovery'
  | 'communication' | 'root_cause' | 'note';
export type CapaKind = 'corrective' | 'preventive';
export type CapaStatus = 'open' | 'in_progress' | 'done' | 'wont_fix' | 'verified';

export interface PostIncidentReport {
  id: string;
  incident_id: string;
  title: string;
  summary: string | null;
  impact: string | null;
  root_cause: string | null;
  lessons_learned: string | null;
  status: ReportStatus;
  severity: string | null;
  author_id: string | null;
  reviewer_id: string | null;
  published_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  timeline_count?: number;
  capa_count?: number;
  capa_open?: number;
}

export interface TimelineEvent {
  id: string;
  report_id: string;
  event_type: TimelineEventType;
  happened_at: string;
  title: string;
  description: string | null;
  actor: string | null;
  created_at: string;
}

export interface CapaItem {
  id: string;
  report_id: string;
  kind: CapaKind;
  title: string;
  description: string | null;
  owner_id: string | null;
  due_at: string | null;
  status: CapaStatus;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
}

export function ensurePostIncidentReportSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS post_incident_reports (
      id TEXT PRIMARY KEY,
      incident_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      impact TEXT,
      root_cause TEXT,
      lessons_learned TEXT,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','in_review','published','archived')),
      severity TEXT,
      author_id TEXT,
      reviewer_id TEXT,
      published_at TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pir_incident ON post_incident_reports(incident_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pir_status ON post_incident_reports(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS post_incident_timeline (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      event_type TEXT NOT NULL
        CHECK (event_type IN ('detection','escalation','mitigation','recovery','communication','root_cause','note')),
      happened_at TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      actor TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pir_timeline_report ON post_incident_timeline(report_id, happened_at ASC);

    CREATE TABLE IF NOT EXISTS post_incident_capa (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      kind TEXT NOT NULL
        CHECK (kind IN ('corrective','preventive')),
      title TEXT NOT NULL,
      description TEXT,
      owner_id TEXT,
      due_at TEXT,
      status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','in_progress','done','wont_fix','verified')),
      verified_at TEXT,
      verified_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pir_capa_report ON post_incident_capa(report_id, status);
    CREATE INDEX IF NOT EXISTS idx_pir_capa_owner ON post_incident_capa(owner_id, status);
  `);
}

// ---------- Reports ----------

export interface CreateReportInput {
  incident_id: string;
  title: string;
  summary?: string | null;
  impact?: string | null;
  root_cause?: string | null;
  lessons_learned?: string | null;
  severity?: string | null;
}

export function createReport(input: CreateReportInput, authorId: string | null): PostIncidentReport {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO post_incident_reports
     (id, incident_id, title, summary, impact, root_cause, lessons_learned,
      status, severity, author_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
  ).run(
    id, input.incident_id, input.title,
    input.summary ?? null, input.impact ?? null,
    input.root_cause ?? null, input.lessons_learned ?? null,
    input.severity ?? null, authorId, now, now,
  );
  return getReport(id)!;
}

export function getReport(id: string): (PostIncidentReport & { timeline: TimelineEvent[]; capa: CapaItem[] }) | null {
  const db = getDb();
  const r = db.prepare(`SELECT * FROM post_incident_reports WHERE id = ?`).get(id) as PostIncidentReport | undefined;
  if (!r) return null;
  const timeline = db.prepare(
    `SELECT * FROM post_incident_timeline WHERE report_id = ? ORDER BY happened_at ASC`,
  ).all(id) as TimelineEvent[];
  const capa = db.prepare(
    `SELECT * FROM post_incident_capa WHERE report_id = ? ORDER BY created_at ASC`,
  ).all(id) as CapaItem[];
  return { ...r, timeline, capa };
}

export interface ListReportsOpts {
  incident_id?: string;
  status?: ReportStatus;
  limit?: number;
}

export function listReports(opts: ListReportsOpts = {}): { reports: PostIncidentReport[]; total: number } {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const cond: string[] = [];
  const params: unknown[] = [];
  if (opts.incident_id) { cond.push('incident_id = ?'); params.push(opts.incident_id); }
  if (opts.status) { cond.push('status = ?'); params.push(opts.status); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const rows = db.prepare(
    `SELECT r.*,
       (SELECT COUNT(*) FROM post_incident_timeline t WHERE t.report_id = r.id) AS timeline_count,
       (SELECT COUNT(*) FROM post_incident_capa c WHERE c.report_id = r.id) AS capa_count,
       (SELECT COUNT(*) FROM post_incident_capa c WHERE c.report_id = r.id AND c.status IN ('open','in_progress')) AS capa_open
     FROM post_incident_reports r ${where}
     ORDER BY r.created_at DESC LIMIT ?`,
  ).all(...params, limit) as PostIncidentReport[];
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM post_incident_reports ${where}`).get(...params) as { c: number }).c;
  return { reports: rows, total };
}

export interface UpdateReportInput {
  title?: string;
  summary?: string | null;
  impact?: string | null;
  root_cause?: string | null;
  lessons_learned?: string | null;
  severity?: string | null;
  status?: ReportStatus;
  reviewer_id?: string | null;
}

export function updateReport(id: string, patch: UpdateReportInput): PostIncidentReport | null {
  const db = getDb();
  if (!getReport(id)) return null;
  const f: string[] = [];
  const v: unknown[] = [];
  for (const k of ['title','summary','impact','root_cause','lessons_learned','severity','status','reviewer_id'] as const) {
    if (patch[k] !== undefined) { f.push(`${k} = ?`); v.push(patch[k]); }
  }
  if (!f.length) return db.prepare(`SELECT * FROM post_incident_reports WHERE id = ?`).get(id) as PostIncidentReport;
  f.push('updated_at = ?'); v.push(new Date().toISOString());
  v.push(id);
  db.prepare(`UPDATE post_incident_reports SET ${f.join(', ')} WHERE id = ?`).run(...v);
  return db.prepare(`SELECT * FROM post_incident_reports WHERE id = ?`).get(id) as PostIncidentReport;
}

export function publishReport(id: string, _userId: string | null): PostIncidentReport | null {
  const db = getDb();
  if (!getReport(id)) return null;
  const now = new Date().toISOString();
  db.prepare(`UPDATE post_incident_reports SET status = 'published', published_at = COALESCE(published_at, ?), updated_at = ? WHERE id = ?`)
    .run(now, now, id);
  return db.prepare(`SELECT * FROM post_incident_reports WHERE id = ?`).get(id) as PostIncidentReport;
}

export function archiveReport(id: string): PostIncidentReport | null {
  const db = getDb();
  if (!getReport(id)) return null;
  const now = new Date().toISOString();
  db.prepare(`UPDATE post_incident_reports SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?`)
    .run(now, now, id);
  return db.prepare(`SELECT * FROM post_incident_reports WHERE id = ?`).get(id) as PostIncidentReport;
}

// ---------- Timeline ----------

export interface AddTimelineInput {
  event_type: TimelineEventType;
  happened_at: string;
  title: string;
  description?: string | null;
  actor?: string | null;
}

export function addTimelineEvent(reportId: string, input: AddTimelineInput): TimelineEvent {
  const db = getDb();
  if (!getReport(reportId)) throw new Error('report_not_found');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO post_incident_timeline
     (id, report_id, event_type, happened_at, title, description, actor, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, reportId, input.event_type, input.happened_at, input.title,
    input.description ?? null, input.actor ?? null, now);
  return db.prepare(`SELECT * FROM post_incident_timeline WHERE id = ?`).get(id) as TimelineEvent;
}

export function removeTimelineEvent(eventId: string): boolean {
  const db = getDb();
  return db.prepare(`DELETE FROM post_incident_timeline WHERE id = ?`).run(eventId).changes > 0;
}

// ---------- CAPA ----------

export interface AddCapaInput {
  kind: CapaKind;
  title: string;
  description?: string | null;
  owner_id?: string | null;
  due_at?: string | null;
}

export function addCapa(reportId: string, input: AddCapaInput): CapaItem {
  const db = getDb();
  if (!getReport(reportId)) throw new Error('report_not_found');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO post_incident_capa
     (id, report_id, kind, title, description, owner_id, due_at, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
  ).run(id, reportId, input.kind, input.title, input.description ?? null,
    input.owner_id ?? null, input.due_at ?? null, now, now);
  return db.prepare(`SELECT * FROM post_incident_capa WHERE id = ?`).get(id) as CapaItem;
}

export interface UpdateCapaInput {
  title?: string;
  description?: string | null;
  owner_id?: string | null;
  due_at?: string | null;
  status?: CapaStatus;
}

export function updateCapa(capaId: string, patch: UpdateCapaInput, verifiedBy: string | null = null): CapaItem | null {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM post_incident_capa WHERE id = ?`).get(capaId) as CapaItem | undefined;
  if (!existing) return null;
  const f: string[] = [];
  const v: unknown[] = [];
  for (const k of ['title','description','owner_id','due_at','status'] as const) {
    if (patch[k] !== undefined) { f.push(`${k} = ?`); v.push(patch[k]); }
  }
  if (patch.status === 'verified') {
    f.push('verified_at = ?'); v.push(new Date().toISOString());
    f.push('verified_by = ?'); v.push(verifiedBy);
  }
  if (!f.length) return existing;
  f.push('updated_at = ?'); v.push(new Date().toISOString());
  v.push(capaId);
  db.prepare(`UPDATE post_incident_capa SET ${f.join(', ')} WHERE id = ?`).run(...v);
  return db.prepare(`SELECT * FROM post_incident_capa WHERE id = ?`).get(capaId) as CapaItem;
}

export function removeCapa(capaId: string): boolean {
  const db = getDb();
  return db.prepare(`DELETE FROM post_incident_capa WHERE id = ?`).run(capaId).changes > 0;
}

export function listCapaByOwner(ownerId: string): Array<CapaItem & { report_title: string; incident_id: string }> {
  const db = getDb();
  return db.prepare(
    `SELECT c.*, r.title AS report_title, r.incident_id AS incident_id
     FROM post_incident_capa c
     JOIN post_incident_reports r ON r.id = c.report_id
     WHERE c.owner_id = ?
     ORDER BY (c.status IN ('done','verified','wont_fix')) ASC, c.due_at ASC`,
  ).all(ownerId) as Array<CapaItem & { report_title: string; incident_id: string }>;
}

// ---------- Export + stats ----------

export function exportReportJSON(id: string): Record<string, unknown> | null {
  const r = getReport(id);
  if (!r) return null;
  return {
    exported_at: new Date().toISOString(),
    report: {
      id: r.id, incident_id: r.incident_id, title: r.title,
      status: r.status, severity: r.severity,
      summary: r.summary, impact: r.impact,
      root_cause: r.root_cause, lessons_learned: r.lessons_learned,
      author_id: r.author_id, reviewer_id: r.reviewer_id,
      published_at: r.published_at, created_at: r.created_at,
    },
    timeline: r.timeline.map(t => ({
      happened_at: t.happened_at, event_type: t.event_type,
      title: t.title, description: t.description, actor: t.actor,
    })),
    capa: r.capa.map(c => ({
      kind: c.kind, title: c.title, description: c.description,
      owner_id: c.owner_id, due_at: c.due_at, status: c.status,
      verified_at: c.verified_at, verified_by: c.verified_by,
    })),
    counts: {
      timeline: r.timeline.length,
      capa: r.capa.length,
      capa_open: r.capa.filter(c => c.status === 'open' || c.status === 'in_progress').length,
    },
  };
}

export interface PIRStats {
  total: number;
  draft: number;
  in_review: number;
  published: number;
  archived: number;
  capa_total: number;
  capa_open: number;
  capa_overdue: number;
  avg_publish_hours: number | null;
  window_days: number;
}

export function getReportStats(windowDays = 180): PIRStats {
  const db = getDb();
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM post_incident_reports WHERE created_at >= ?`).get(since) as { c: number }).c;
  const draft = (db.prepare(`SELECT COUNT(*) AS c FROM post_incident_reports WHERE status = 'draft' AND created_at >= ?`).get(since) as { c: number }).c;
  const inRev = (db.prepare(`SELECT COUNT(*) AS c FROM post_incident_reports WHERE status = 'in_review' AND created_at >= ?`).get(since) as { c: number }).c;
  const pub = (db.prepare(`SELECT COUNT(*) AS c FROM post_incident_reports WHERE status = 'published' AND created_at >= ?`).get(since) as { c: number }).c;
  const arc = (db.prepare(`SELECT COUNT(*) AS c FROM post_incident_reports WHERE status = 'archived' AND created_at >= ?`).get(since) as { c: number }).c;
  const capaTotal = (db.prepare(`SELECT COUNT(*) AS c FROM post_incident_capa WHERE created_at >= ?`).get(since) as { c: number }).c;
  const capaOpen = (db.prepare(`SELECT COUNT(*) AS c FROM post_incident_capa WHERE status IN ('open','in_progress')`).get() as { c: number }).c;
  const capaOverdue = (db.prepare(
    `SELECT COUNT(*) AS c FROM post_incident_capa
     WHERE status IN ('open','in_progress') AND due_at IS NOT NULL AND due_at < ?`,
  ).get(new Date().toISOString()) as { c: number }).c;
  const avg = (db.prepare(
    `SELECT AVG((julianday(published_at) - julianday(created_at)) * 24.0) AS avg_h
     FROM post_incident_reports WHERE published_at IS NOT NULL AND created_at >= ?`,
  ).get(since) as { avg_h: number | null }).avg_h;
  return {
    total, draft, in_review: inRev, published: pub, archived: arc,
    capa_total: capaTotal, capa_open: capaOpen, capa_overdue: capaOverdue,
    avg_publish_hours: avg ?? null, window_days: windowDays,
  };
}
