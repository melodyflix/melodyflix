// melodyflix videos - Section 26 Analytics (Part A)
// 26.5 Report Export, 26.6 Predictive, 26.7 Churn, 26.8 LTV.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type ExportFormat = 'csv' | 'json' | 'pdf_html';
export type ChurnRisk = 'low' | 'medium' | 'high';

export function ensureAnalyticsCoreSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS analytics_exports (
      id TEXT PRIMARY KEY,
      requested_by TEXT NOT NULL,
      kind TEXT NOT NULL,
      format TEXT NOT NULL,
      params TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'completed',
      row_count INTEGER NOT NULL DEFAULT 0,
      body TEXT NOT NULL DEFAULT '',
      filename TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_aexp_user ON analytics_exports(requested_by, created_at DESC);

    CREATE TABLE IF NOT EXISTS predictive_predictions (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, subject_id TEXT NOT NULL,
      horizon_days INTEGER NOT NULL DEFAULT 30,
      predicted_value REAL NOT NULL, confidence REAL NOT NULL DEFAULT 0.5,
      features TEXT NOT NULL DEFAULT '{}',
      model_version TEXT NOT NULL DEFAULT 'v1',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pred_kind ON predictive_predictions(kind, subject_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS churn_scores (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      risk TEXT NOT NULL DEFAULT 'low', score REAL NOT NULL DEFAULT 0,
      last_active_at TEXT, reasons TEXT NOT NULL DEFAULT '[]',
      computed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_churn_user ON churn_scores(user_id, computed_at DESC);

    CREATE TABLE IF NOT EXISTS ltv_snapshots (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      realized_cents INTEGER NOT NULL DEFAULT 0,
      predicted_cents INTEGER NOT NULL DEFAULT 0,
      lifetime_days INTEGER NOT NULL DEFAULT 0,
      method TEXT NOT NULL DEFAULT 'simple',
      computed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ltv_user ON ltv_snapshots(user_id, computed_at DESC);
  `);
}

// ================= 26.5 Export =================
export interface AnalyticsExport {
  id: string; requested_by: string; kind: string; format: ExportFormat;
  params: string; status: string; row_count: number; body: string;
  filename: string | null; created_at: string; completed_at: string | null;
}

function escCsv(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  return headers.join(',') + '\n' + rows.map(r => headers.map(h => escCsv(r[h])).join(',')).join('\n');
}
function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
}
function renderHtml(kind: string, rows: Record<string, unknown>[]): string {
  const headers = rows.length ? Array.from(new Set(rows.flatMap(r => Object.keys(r)))) : [];
  const th = headers.map(h => '<th>' + escHtml(h) + '</th>').join('');
  const trs = rows.map(r => '<tr>' + headers.map(h => '<td>' + escHtml(String(r[h] ?? '')) + '</td>').join('') + '</tr>').join('');
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + escHtml(kind) +
    '</title><style>body{font-family:sans-serif;padding:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:6px 8px;font-size:12px}th{background:#f5f5f5}</style></head><body><h1>' +
    escHtml(kind) + '</h1><table><thead><tr>' + th + '</tr></thead><tbody>' + trs + '</tbody></table></body></html>';
}

export interface ExportInput {
  requested_by: string; kind: string; format: ExportFormat;
  params?: Record<string, unknown>;
  rows: Record<string, unknown>[];
}

export function createExport(input: ExportInput): AnalyticsExport {
  if (!['csv','json','pdf_html'].includes(input.format)) throw new Error('invalid_format');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  let body = ''; let filename = '';
  if (input.format === 'csv') { body = toCsv(input.rows); filename = input.kind + '.csv'; }
  else if (input.format === 'json') { body = JSON.stringify(input.rows, null, 2); filename = input.kind + '.json'; }
  else { body = renderHtml(input.kind, input.rows); filename = input.kind + '.html'; }
  db.prepare('INSERT INTO analytics_exports (id, requested_by, kind, format, params, status, row_count, body, filename, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, input.requested_by, input.kind, input.format, JSON.stringify(input.params ?? {}), 'completed', input.rows.length, body, filename, now, now);
  return db.prepare('SELECT * FROM analytics_exports WHERE id = ?').get(id) as AnalyticsExport;
}

export function getExport(id: string): AnalyticsExport | null {
  return (getDb().prepare('SELECT * FROM analytics_exports WHERE id = ?').get(id) as AnalyticsExport | undefined) ?? null;
}

export function listExports(userId?: string, limit = 100): AnalyticsExport[] {
  const db = getDb();
  const cols = 'id, requested_by, kind, format, status, row_count, filename, created_at, completed_at';
  if (userId) {
    return db.prepare('SELECT ' + cols + ' FROM analytics_exports WHERE requested_by = ? ORDER BY created_at DESC LIMIT ?')
      .all(userId, Math.min(Math.max(limit, 1), 500)) as AnalyticsExport[];
  }
  return db.prepare('SELECT ' + cols + ' FROM analytics_exports ORDER BY created_at DESC LIMIT ?')
    .all(Math.min(Math.max(limit, 1), 500)) as AnalyticsExport[];
}

// ================= 26.6 Predictive =================
export interface PredictivePrediction {
  id: string; kind: string; subject_id: string; horizon_days: number;
  predicted_value: number; confidence: number; features: string;
  model_version: string; created_at: string;
}

export interface PredictInput {
  kind: string; subject_id: string; horizon_days?: number;
  history: { t: string; value: number }[];
  model_version?: string;
}

export function linearForecast(input: PredictInput): PredictivePrediction {
  if (!input.history.length) throw new Error('history_required');
  const sorted = [...input.history].sort((a, b) => a.t.localeCompare(b.t));
  const t0 = new Date(sorted[0].t).getTime();
  const pts = sorted.map(p => ({ x: (new Date(p.t).getTime() - t0) / 86400_000, y: p.value }));
  const n = pts.length;
  const sumX = pts.reduce((s, p) => s + p.x, 0);
  const sumY = pts.reduce((s, p) => s + p.y, 0);
  const sumXY = pts.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = pts.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const horizon = input.horizon_days ?? 30;
  const lastX = pts[pts.length - 1].x;
  const predicted = intercept + slope * (lastX + horizon);
  const residuals = pts.map(p => p.y - (intercept + slope * p.x));
  const meanRes = residuals.reduce((s, r) => s + r, 0) / n;
  const variance = residuals.reduce((s, r) => s + (r - meanRes) ** 2, 0) / Math.max(n - 1, 1);
  const stddev = Math.sqrt(variance);
  const meanY = Math.abs(sumY / n) || 1;
  const confidence = Math.max(0.1, Math.min(0.99, 1 - stddev / (meanY * 2)));
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO predictive_predictions (id, kind, subject_id, horizon_days, predicted_value, confidence, features, model_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, input.kind, input.subject_id, horizon, predicted, confidence, JSON.stringify({ slope, intercept, n }), input.model_version ?? 'linreg-v1', now);
  return db.prepare('SELECT * FROM predictive_predictions WHERE id = ?').get(id) as PredictivePrediction;
}

export function listPredictions(filter?: { kind?: string; subject_id?: string; limit?: number }) {
  const db = getDb();
  const where: string[] = []; const args: any[] = [];
  if (filter?.kind) { where.push('kind = ?'); args.push(filter.kind); }
  if (filter?.subject_id) { where.push('subject_id = ?'); args.push(filter.subject_id); }
  const sql = 'SELECT * FROM predictive_predictions ' + (where.length ? 'WHERE ' + where.join(' AND ') : '') + ' ORDER BY created_at DESC LIMIT ?';
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args) as PredictivePrediction[];
}

// ================= 26.7 Churn =================
export interface ChurnScore {
  id: string; user_id: string; risk: ChurnRisk; score: number;
  last_active_at: string | null; reasons: string; computed_at: string;
}

export interface ComputeChurnInput {
  user_id: string;
  last_active_at: string;
  days_active_last_30: number;
  logins_last_30: number;
  watched_minutes_last_30: number;
  subscribed: boolean;
}

export function computeChurnScore(input: ComputeChurnInput): ChurnScore {
  const now = new Date();
  const last = new Date(input.last_active_at);
  const daysInactive = Math.max(0, Math.round((now.getTime() - last.getTime()) / 86400_000));
  const reasons: string[] = [];
  let score = 0;
  if (daysInactive >= 30) { score += 0.5; reasons.push('inactive_30d'); }
  else if (daysInactive >= 14) { score += 0.3; reasons.push('inactive_14d'); }
  else if (daysInactive >= 7) { score += 0.15; reasons.push('inactive_7d'); }
  if (input.days_active_last_30 <= 3) { score += 0.2; reasons.push('few_active_days'); }
  if (input.logins_last_30 <= 2) { score += 0.15; reasons.push('few_logins'); }
  if (input.watched_minutes_last_30 < 30) { score += 0.2; reasons.push('low_watch'); }
  if (!input.subscribed) { score += 0.1; reasons.push('not_subscribed'); }
  score = Math.min(1, score);
  const risk: ChurnRisk = score >= 0.7 ? 'high' : score >= 0.4 ? 'medium' : 'low';
  const db = getDb();
  const id = randomUUID();
  const nowIso = now.toISOString();
  db.prepare('INSERT INTO churn_scores (id, user_id, risk, score, last_active_at, reasons, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, input.user_id, risk, score, input.last_active_at, JSON.stringify(reasons), nowIso);
  return db.prepare('SELECT * FROM churn_scores WHERE id = ?').get(id) as ChurnScore;
}

export function listChurnScores(filter?: { user_id?: string; risk?: ChurnRisk; limit?: number }) {
  const db = getDb();
  const where: string[] = []; const args: any[] = [];
  if (filter?.user_id) { where.push('user_id = ?'); args.push(filter.user_id); }
  if (filter?.risk) { where.push('risk = ?'); args.push(filter.risk); }
  const sql = 'SELECT * FROM churn_scores ' + (where.length ? 'WHERE ' + where.join(' AND ') : '') + ' ORDER BY computed_at DESC LIMIT ?';
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args) as ChurnScore[];
}

export interface ChurnSummary {
  total: number;
  low: number; medium: number; high: number;
  avg_score: number;
}

export function getChurnSummary(): ChurnSummary {
  const db = getDb();
  const rows = db.prepare('SELECT risk, score FROM churn_scores').all() as { risk: string; score: number }[];
  const low = rows.filter(r => r.risk === 'low').length;
  const medium = rows.filter(r => r.risk === 'medium').length;
  const high = rows.filter(r => r.risk === 'high').length;
  const avg = rows.length ? rows.reduce((s, r) => s + r.score, 0) / rows.length : 0;
  return { total: rows.length, low, medium, high, avg_score: avg };
}

// ================= 26.8 LTV =================
export interface LtvSnapshot {
  id: string; user_id: string; currency: string;
  realized_cents: number; predicted_cents: number;
  lifetime_days: number; method: string; computed_at: string;
}

export interface ComputeLtvInput {
  user_id: string;
  realized_cents: number;
  joined_at: string;
  monthly_churn_prob?: number;
  arpu_cents?: number;
}

export function computeLtv(input: ComputeLtvInput): LtvSnapshot {
  const now = new Date();
  const joined = new Date(input.joined_at);
  const lifetimeDays = Math.max(1, Math.round((now.getTime() - joined.getTime()) / 86400_000));
  const churn = Math.max(0.001, Math.min(0.9, input.monthly_churn_prob ?? 0.05));
  const arpu = input.arpu_cents ?? (input.realized_cents / Math.max(1, lifetimeDays / 30));
  const predictedMonths = 1 / churn;
  const predictedCents = Math.round(arpu * predictedMonths);
  const db = getDb();
  const id = randomUUID();
  db.prepare('INSERT INTO ltv_snapshots (id, user_id, currency, realized_cents, predicted_cents, lifetime_days, method, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, input.user_id, 'USD', input.realized_cents, predictedCents, lifetimeDays, 'arpu_over_churn', now.toISOString());
  return db.prepare('SELECT * FROM ltv_snapshots WHERE id = ?').get(id) as LtvSnapshot;
}

export function listLtv(filter?: { user_id?: string; limit?: number }) {
  const db = getDb();
  if (filter?.user_id) {
    return db.prepare('SELECT * FROM ltv_snapshots WHERE user_id = ? ORDER BY computed_at DESC LIMIT ?')
      .all(filter.user_id, Math.min(Math.max(filter?.limit ?? 100, 1), 500)) as LtvSnapshot[];
  }
  return db.prepare('SELECT * FROM ltv_snapshots ORDER BY computed_at DESC LIMIT ?')
    .all(Math.min(Math.max(filter?.limit ?? 100, 1), 500)) as LtvSnapshot[];
}

export interface LtvSummary {
  total_snapshots: number;
  unique_users: number;
  avg_realized_cents: number;
  avg_predicted_cents: number;
}

export function getLtvSummary(): LtvSummary {
  const db = getDb();
  const rows = db.prepare('SELECT user_id, realized_cents, predicted_cents FROM ltv_snapshots').all() as
    { user_id: string; realized_cents: number; predicted_cents: number }[];
  const users = new Set(rows.map(r => r.user_id));
  const avgR = rows.length ? rows.reduce((s, r) => s + r.realized_cents, 0) / rows.length : 0;
  const avgP = rows.length ? rows.reduce((s, r) => s + r.predicted_cents, 0) / rows.length : 0;
  return { total_snapshots: rows.length, unique_users: users.size, avg_realized_cents: avgR, avg_predicted_cents: avgP };
}

// ================= Stats =================
export interface AnalyticsCoreStats {
  exports_total: number;
  predictions_total: number;
  churn_scores_total: number;
  ltv_snapshots_total: number;
  predictions_by_kind: Record<string, number>;
}

export function getAnalyticsCoreStats(): AnalyticsCoreStats {
  const db = getDb();
  const ex = db.prepare('SELECT COUNT(*) AS c FROM analytics_exports').get() as { c: number };
  const pr = db.prepare('SELECT kind, COUNT(*) AS c FROM predictive_predictions GROUP BY kind').all() as { kind: string; c: number }[];
  const ch = db.prepare('SELECT COUNT(*) AS c FROM churn_scores').get() as { c: number };
  const lv = db.prepare('SELECT COUNT(*) AS c FROM ltv_snapshots').get() as { c: number };
  const byKind: Record<string, number> = {};
  let prTotal = 0;
  for (const p of pr) { byKind[p.kind] = p.c; prTotal += p.c; }
  return { exports_total: ex.c, predictions_total: prTotal, churn_scores_total: ch.c, ltv_snapshots_total: lv.c, predictions_by_kind: byKind };
}
