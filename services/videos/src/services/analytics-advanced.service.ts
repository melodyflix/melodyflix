// melodyflix videos - Section 26 Analytics (Part B)
// 26.9 Cohort, 26.10 Funnel, 26.13 Re-watch, 26.16 Scroll Depth,
// 26.17 Session Recording.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export function ensureAnalyticsAdvancedSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS cohorts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'signup_week',
      period_start TEXT NOT NULL, period_end TEXT NOT NULL,
      criteria TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cohort_kind ON cohorts(kind, period_start);

    CREATE TABLE IF NOT EXISTS cohort_members (
      id TEXT PRIMARY KEY, cohort_id TEXT NOT NULL, user_id TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      UNIQUE (cohort_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cohort_mem_cohort ON cohort_members(cohort_id);

    CREATE TABLE IF NOT EXISTS funnels (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      steps TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_funnel_name ON funnels(name);

    CREATE TABLE IF NOT EXISTS funnel_events (
      id TEXT PRIMARY KEY, funnel_id TEXT NOT NULL, user_id TEXT NOT NULL,
      step_index INTEGER NOT NULL, session_id TEXT, occurred_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_funnel_ev ON funnel_events(funnel_id, step_index, occurred_at);

    CREATE TABLE IF NOT EXISTS rewatch_segments (
      id TEXT PRIMARY KEY, video_id TEXT NOT NULL,
      start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL,
      rewatch_count INTEGER NOT NULL DEFAULT 0,
      unique_viewers INTEGER NOT NULL DEFAULT 0,
      computed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rw_video ON rewatch_segments(video_id, rewatch_count DESC);

    CREATE TABLE IF NOT EXISTS scroll_depth_events (
      id TEXT PRIMARY KEY, page_kind TEXT NOT NULL, page_id TEXT NOT NULL,
      user_id TEXT, session_id TEXT,
      max_percent INTEGER NOT NULL DEFAULT 0,
      viewport_height INTEGER, doc_height INTEGER,
      occurred_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scroll_page ON scroll_depth_events(page_kind, page_id, occurred_at DESC);

    CREATE TABLE IF NOT EXISTS session_recordings (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_id TEXT NOT NULL,
      started_at TEXT NOT NULL, ended_at TEXT,
      event_count INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0,
      storage_ref TEXT, events TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sessrec_session ON session_recordings(session_id);
    CREATE INDEX IF NOT EXISTS idx_sessrec_user ON session_recordings(user_id, started_at DESC);
  `);
}

// ================= 26.9 Cohort =================
export interface Cohort {
  id: string; name: string; kind: string;
  period_start: string; period_end: string;
  criteria: string; created_at: string; updated_at: string;
}

export interface CreateCohortInput {
  name: string; kind?: string;
  period_start: string; period_end: string;
  criteria?: Record<string, unknown>;
  user_ids?: string[];
}

export function createCohort(input: CreateCohortInput): Cohort {
  if (!input.name || input.name.length > 200) throw new Error('invalid_name');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare('INSERT INTO cohorts (id, name, kind, period_start, period_end, criteria, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, input.name, input.kind ?? 'signup_week', input.period_start, input.period_end,
      JSON.stringify(input.criteria ?? {}), now, now);
  if (input.user_ids?.length) {
    const ins = db.prepare('INSERT OR IGNORE INTO cohort_members (id, cohort_id, user_id, joined_at) VALUES (?, ?, ?, ?)');
    for (const u of input.user_ids) ins.run(randomUUID(), id, u, now);
  }
  return db.prepare('SELECT * FROM cohorts WHERE id = ?').get(id) as Cohort;
}

export function getCohort(id: string): Cohort | null {
  return (getDb().prepare('SELECT * FROM cohorts WHERE id = ?').get(id) as Cohort | undefined) ?? null;
}

export function listCohorts(): Cohort[] {
  return getDb().prepare('SELECT * FROM cohorts ORDER BY period_start DESC').all() as Cohort[];
}

export function addCohortMembers(cohortId: string, userIds: string[]): number {
  const db = getDb();
  const ins = db.prepare('INSERT OR IGNORE INTO cohort_members (id, cohort_id, user_id, joined_at) VALUES (?, ?, ?, ?)');
  const now = new Date().toISOString();
  let added = 0;
  for (const u of userIds) added += ins.run(randomUUID(), cohortId, u, now).changes;
  return added;
}

export function listCohortMembers(cohortId: string): { user_id: string; joined_at: string }[] {
  return getDb().prepare('SELECT user_id, joined_at FROM cohort_members WHERE cohort_id = ? ORDER BY joined_at')
    .all(cohortId) as { user_id: string; joined_at: string }[];
}

export function deleteCohort(id: string): boolean {
  const db = getDb();
  db.prepare('DELETE FROM cohort_members WHERE cohort_id = ?').run(id);
  return db.prepare('DELETE FROM cohorts WHERE id = ?').run(id).changes > 0;
}

// ================= 26.10 Funnel =================
export interface Funnel {
  id: string; name: string; steps: string; created_at: string; updated_at: string;
}

export function createFunnel(name: string, steps: string[]): Funnel {
  if (!name || name.length > 200) throw new Error('invalid_name');
  if (!steps?.length || steps.length > 20) throw new Error('invalid_steps');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare('INSERT INTO funnels (id, name, steps, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, JSON.stringify(steps), now, now);
  return db.prepare('SELECT * FROM funnels WHERE id = ?').get(id) as Funnel;
}

export function listFunnels(): Funnel[] {
  return getDb().prepare('SELECT * FROM funnels ORDER BY name').all() as Funnel[];
}

export function getFunnel(id: string): Funnel | null {
  return (getDb().prepare('SELECT * FROM funnels WHERE id = ?').get(id) as Funnel | undefined) ?? null;
}

export interface FunnelEventInput {
  funnel_id: string; user_id: string; step_index: number; session_id?: string | null;
}

export function recordFunnelEvent(input: FunnelEventInput) {
  const f = getFunnel(input.funnel_id);
  if (!f) throw new Error('funnel_not_found');
  const steps = JSON.parse(f.steps) as string[];
  if (input.step_index < 0 || input.step_index >= steps.length) throw new Error('invalid_step');
  const id = randomUUID();
  const now = new Date().toISOString();
  getDb().prepare('INSERT INTO funnel_events (id, funnel_id, user_id, step_index, session_id, occurred_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, input.funnel_id, input.user_id, input.step_index, input.session_id ?? null, now);
  return { id, funnel_id: input.funnel_id, user_id: input.user_id, step_index: input.step_index, occurred_at: now };
}

export interface FunnelAnalysis {
  funnel_id: string;
  steps: { index: number; name: string; users: number; conversion_from_prev: number; conversion_from_start: number }[];
  total_entered: number;
}

export function analyzeFunnel(funnelId: string): FunnelAnalysis {
  const db = getDb();
  const f = getFunnel(funnelId);
  if (!f) throw new Error('funnel_not_found');
  const steps = JSON.parse(f.steps) as string[];
  const counts: number[] = [];
  for (let i = 0; i < steps.length; i++) {
    const r = db.prepare('SELECT COUNT(DISTINCT user_id) AS c FROM funnel_events WHERE funnel_id = ? AND step_index = ?')
      .get(funnelId, i) as { c: number };
    counts.push(r.c);
  }
  const entered = counts[0] ?? 0;
  return {
    funnel_id: funnelId, total_entered: entered,
    steps: steps.map((name, i) => ({
      index: i, name, users: counts[i],
      conversion_from_prev: i === 0 ? 1 : (counts[i - 1] ? counts[i] / counts[i - 1] : 0),
      conversion_from_start: entered ? counts[i] / entered : 0,
    })),
  };
}

// ================= 26.13 Re-watch =================
export interface RewatchSegment {
  id: string; video_id: string; start_ms: number; end_ms: number;
  rewatch_count: number; unique_viewers: number; computed_at: string;
}

export interface RewatchSample {
  video_id: string; start_ms: number; end_ms: number; user_id: string;
}

export function computeRewatchSegments(videoId: string, samples: RewatchSample[]): RewatchSegment[] {
  const bucketMs = 10_000;
  const buckets = new Map<number, { count: number; users: Set<string> }>();
  for (const s of samples) {
    if (s.video_id !== videoId) continue;
    const start = Math.floor(s.start_ms / bucketMs) * bucketMs;
    const end = Math.floor(s.end_ms / bucketMs) * bucketMs;
    for (let b = start; b <= end; b += bucketMs) {
      if (!buckets.has(b)) buckets.set(b, { count: 0, users: new Set() });
      const e = buckets.get(b)!;
      e.count++;
      e.users.add(s.user_id);
    }
  }
  const db = getDb();
  db.prepare('DELETE FROM rewatch_segments WHERE video_id = ?').run(videoId);
  const now = new Date().toISOString();
  const out: RewatchSegment[] = [];
  for (const [b, v] of buckets) {
    if (v.count < 2) continue;
    const id = randomUUID();
    db.prepare('INSERT INTO rewatch_segments (id, video_id, start_ms, end_ms, rewatch_count, unique_viewers, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, videoId, b, b + bucketMs, v.count, v.users.size, now);
    out.push({ id, video_id: videoId, start_ms: b, end_ms: b + bucketMs, rewatch_count: v.count, unique_viewers: v.users.size, computed_at: now });
  }
  return out.sort((a, b) => b.rewatch_count - a.rewatch_count);
}

export function listRewatchSegments(videoId: string, limit = 50): RewatchSegment[] {
  return getDb().prepare('SELECT * FROM rewatch_segments WHERE video_id = ? ORDER BY rewatch_count DESC LIMIT ?')
    .all(videoId, Math.min(Math.max(limit, 1), 500)) as RewatchSegment[];
}

// ================= 26.16 Scroll Depth =================
export interface ScrollDepthEvent {
  id: string; page_kind: string; page_id: string; user_id: string | null;
  session_id: string | null; max_percent: number;
  viewport_height: number | null; doc_height: number | null; occurred_at: string;
}

export interface ScrollInput {
  page_kind: string; page_id: string;
  user_id?: string | null; session_id?: string | null;
  max_percent: number;
  viewport_height?: number | null; doc_height?: number | null;
}

export function recordScrollDepth(input: ScrollInput): ScrollDepthEvent {
  if (input.max_percent < 0 || input.max_percent > 100) throw new Error('invalid_percent');
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO scroll_depth_events (id, page_kind, page_id, user_id, session_id, max_percent, viewport_height, doc_height, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, input.page_kind, input.page_id, input.user_id ?? null, input.session_id ?? null,
      input.max_percent, input.viewport_height ?? null, input.doc_height ?? null, now);
  return db.prepare('SELECT * FROM scroll_depth_events WHERE id = ?').get(id) as ScrollDepthEvent;
}

export interface ScrollAggregate {
  page_kind: string; page_id: string;
  total: number; avg_percent: number;
  p25: number; p50: number; p75: number; p90: number;
  reach_50: number; reach_75: number; reach_100: number;
}

export function aggregateScrollDepth(pageKind: string, pageId: string): ScrollAggregate {
  const rows = getDb().prepare('SELECT max_percent FROM scroll_depth_events WHERE page_kind = ? AND page_id = ?')
    .all(pageKind, pageId) as { max_percent: number }[];
  const vals = rows.map(r => r.max_percent).sort((a, b) => a - b);
  const pct = (p: number) => vals.length ? vals[Math.min(vals.length - 1, Math.floor(vals.length * p))] : 0;
  const total = vals.length;
  const avg = total ? vals.reduce((s, v) => s + v, 0) / total : 0;
  const reach = (t: number) => total ? vals.filter(v => v >= t).length / total : 0;
  return {
    page_kind: pageKind, page_id: pageId, total, avg_percent: avg,
    p25: pct(0.25), p50: pct(0.5), p75: pct(0.75), p90: pct(0.9),
    reach_50: reach(50), reach_75: reach(75), reach_100: reach(100),
  };
}

// ================= 26.17 Session Recording =================
export interface SessionRecording {
  id: string; user_id: string; session_id: string;
  started_at: string; ended_at: string | null;
  event_count: number; duration_ms: number;
  storage_ref: string | null; events: string; created_at: string;
}

export interface SessionEvent {
  type: string;
  at: string;
  payload?: Record<string, unknown>;
}

export function startSessionRecording(userId: string, sessionId: string): SessionRecording {
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare('INSERT INTO session_recordings (id, user_id, session_id, started_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, sessionId, now, now);
  return db.prepare('SELECT * FROM session_recordings WHERE id = ?').get(id) as SessionRecording;
}

export function appendSessionEvents(sessionId: string, events: SessionEvent[]): SessionRecording | null {
  const db = getDb();
  const rec = db.prepare('SELECT * FROM session_recordings WHERE session_id = ?').get(sessionId) as SessionRecording | undefined;
  if (!rec) return null;
  if (rec.ended_at) throw new Error('session_ended');
  const list = JSON.parse(rec.events) as SessionEvent[];
  list.push(...events.map(e => ({ type: e.type, at: e.at, payload: e.payload ?? {} })));
  db.prepare('UPDATE session_recordings SET events = ?, event_count = ? WHERE id = ?')
    .run(JSON.stringify(list), list.length, rec.id);
  return db.prepare('SELECT * FROM session_recordings WHERE id = ?').get(rec.id) as SessionRecording;
}

export function endSessionRecording(sessionId: string, storageRef?: string | null): SessionRecording | null {
  const db = getDb();
  const rec = db.prepare('SELECT * FROM session_recordings WHERE session_id = ?').get(sessionId) as SessionRecording | undefined;
  if (!rec) return null;
  const now = new Date().toISOString();
  const duration = new Date(now).getTime() - new Date(rec.started_at).getTime();
  db.prepare('UPDATE session_recordings SET ended_at = ?, duration_ms = ?, storage_ref = ? WHERE id = ?')
    .run(now, duration, storageRef ?? null, rec.id);
  return db.prepare('SELECT * FROM session_recordings WHERE id = ?').get(rec.id) as SessionRecording;
}

export function getSessionRecording(sessionId: string): SessionRecording | null {
  return (getDb().prepare('SELECT * FROM session_recordings WHERE session_id = ?').get(sessionId) as SessionRecording | undefined) ?? null;
}

export function listSessionRecordings(filter?: { user_id?: string; limit?: number }) {
  const db = getDb();
  const where: string[] = []; const args: any[] = [];
  if (filter?.user_id) { where.push('user_id = ?'); args.push(filter.user_id); }
  const sql = 'SELECT id, user_id, session_id, started_at, ended_at, event_count, duration_ms, storage_ref, created_at FROM session_recordings ' +
    (where.length ? 'WHERE ' + where.join(' AND ') : '') + ' ORDER BY started_at DESC LIMIT ?';
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args);
}

// ================= Stats =================
export interface AnalyticsAdvancedStats {
  cohorts: number;
  cohort_members: number;
  funnels: number;
  funnel_events: number;
  rewatch_segments: number;
  scroll_events: number;
  session_recordings: number;
  sessions_ended: number;
}

export function getAnalyticsAdvancedStats(): AnalyticsAdvancedStats {
  const db = getDb();
  const c = db.prepare('SELECT COUNT(*) AS c FROM cohorts').get() as { c: number };
  const cm = db.prepare('SELECT COUNT(*) AS c FROM cohort_members').get() as { c: number };
  const f = db.prepare('SELECT COUNT(*) AS c FROM funnels').get() as { c: number };
  const fe = db.prepare('SELECT COUNT(*) AS c FROM funnel_events').get() as { c: number };
  const rw = db.prepare('SELECT COUNT(*) AS c FROM rewatch_segments').get() as { c: number };
  const sc = db.prepare('SELECT COUNT(*) AS c FROM scroll_depth_events').get() as { c: number };
  const sr = db.prepare('SELECT COUNT(*) AS c FROM session_recordings').get() as { c: number };
  const sre = db.prepare('SELECT COUNT(*) AS c FROM session_recordings WHERE ended_at IS NOT NULL').get() as { c: number };
  return {
    cohorts: c.c, cohort_members: cm.c, funnels: f.c, funnel_events: fe.c,
    rewatch_segments: rw.c, scroll_events: sc.c,
    session_recordings: sr.c, sessions_ended: sre.c,
  };
}
