// melodyflix videos - Section 19 Content Protection (Part B)
// 19.2 Dynamic Watermark, 19.10 Dynamic User-ID Watermark,
// 19.13 Watermark Tracing, 19.14 Leak Detection,
// 19.15 Piracy Monitoring, 19.16 Forensic Report.
import { randomUUID, createHmac, createHash } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type WatermarkPosition = 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right' | 'center' | 'random';
export type WatermarkStyle = 'plain' | 'semi_transparent' | 'logo_plus_text' | 'qr_code';
export type LeakSeverity = 'low' | 'medium' | 'high' | 'critical';
export type PiracyStatus = 'open' | 'investigating' | 'action_taken' | 'dismissed';

export function ensureWatermarkSchema(): void {
  const db = getDb();
  db.exec(`
    -- 19.2 Dynamic Watermark policy per video
    CREATE TABLE IF NOT EXISTS watermark_policies (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      style TEXT NOT NULL DEFAULT 'semi_transparent',
      position TEXT NOT NULL DEFAULT 'bottom_right',
      opacity REAL NOT NULL DEFAULT 0.35,
      size_percent INTEGER NOT NULL DEFAULT 8,
      include_user_id INTEGER NOT NULL DEFAULT 1,
      include_timestamp INTEGER NOT NULL DEFAULT 1,
      include_session_id INTEGER NOT NULL DEFAULT 1,
      include_ip_hash INTEGER NOT NULL DEFAULT 0,
      static_text TEXT,
      logo_url TEXT,
      rotate_every_seconds INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_wm_video ON watermark_policies(video_id);

    -- 19.13 Watermark tracing: emitted overlays with token & payload
    CREATE TABLE IF NOT EXISTS watermark_traces (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      user_id TEXT,
      token TEXT NOT NULL,
      payload TEXT NOT NULL,
      signature TEXT NOT NULL,
      emitted_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wmtr_session ON watermark_traces(session_id, emitted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wmtr_video ON watermark_traces(video_id, emitted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wmtr_token ON watermark_traces(token);

    -- 19.14 Leak detection events
    CREATE TABLE IF NOT EXISTS leak_events (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      session_id TEXT,
      token TEXT,
      suspected_user_id TEXT,
      severity TEXT NOT NULL DEFAULT 'medium',
      detector TEXT NOT NULL,
      evidence TEXT NOT NULL DEFAULT '{}',
      notes TEXT,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_leak_video ON leak_events(video_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_leak_severity ON leak_events(severity, resolved, created_at DESC);

    -- 19.15 Piracy monitoring targets + findings
    CREATE TABLE IF NOT EXISTS piracy_targets (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      url TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      confidence REAL NOT NULL DEFAULT 0.5,
      dmca_filed_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pirate_video ON piracy_targets(video_id, status, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pirate_platform ON piracy_targets(platform, status);

    -- 19.16 Forensic report snapshots
    CREATE TABLE IF NOT EXISTS forensic_reports (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      requested_by TEXT,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      summary TEXT NOT NULL DEFAULT '{}',
      signature TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_forensic_video ON forensic_reports(video_id, created_at DESC);
  `);
}

function sha256(v: string): string { return createHash('sha256').update(v).digest('hex'); }

// ================= 19.2 Dynamic Watermark =================
export interface WatermarkPolicy {
  id: string; video_id: string; enabled: number; style: WatermarkStyle;
  position: WatermarkPosition; opacity: number; size_percent: number;
  include_user_id: number; include_timestamp: number; include_session_id: number;
  include_ip_hash: number; static_text: string | null; logo_url: string | null;
  rotate_every_seconds: number; created_at: string; updated_at: string;
}

export interface UpsertWatermarkInput {
  style?: WatermarkStyle; position?: WatermarkPosition;
  opacity?: number; size_percent?: number;
  include_user_id?: boolean; include_timestamp?: boolean;
  include_session_id?: boolean; include_ip_hash?: boolean;
  static_text?: string | null; logo_url?: string | null;
  rotate_every_seconds?: number;
  enabled?: boolean;
}

export function upsertWatermarkPolicy(videoId: string, patch: UpsertWatermarkInput): WatermarkPolicy {
  if (patch.opacity !== undefined && (patch.opacity < 0 || patch.opacity > 1)) throw new Error('invalid_opacity');
  if (patch.size_percent !== undefined && (patch.size_percent < 1 || patch.size_percent > 50)) throw new Error('invalid_size');
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM watermark_policies WHERE video_id = ?').get(videoId) as WatermarkPolicy | undefined;
  if (existing) {
    const fields: string[] = []; const args: any[] = [];
    const set = (k: string, v: any) => { fields.push(k + ' = ?'); args.push(v); };
    if (patch.style !== undefined) set('style', patch.style);
    if (patch.position !== undefined) set('position', patch.position);
    if (patch.opacity !== undefined) set('opacity', patch.opacity);
    if (patch.size_percent !== undefined) set('size_percent', patch.size_percent);
    if (patch.include_user_id !== undefined) set('include_user_id', patch.include_user_id ? 1 : 0);
    if (patch.include_timestamp !== undefined) set('include_timestamp', patch.include_timestamp ? 1 : 0);
    if (patch.include_session_id !== undefined) set('include_session_id', patch.include_session_id ? 1 : 0);
    if (patch.include_ip_hash !== undefined) set('include_ip_hash', patch.include_ip_hash ? 1 : 0);
    if (patch.static_text !== undefined) set('static_text', patch.static_text);
    if (patch.logo_url !== undefined) set('logo_url', patch.logo_url);
    if (patch.rotate_every_seconds !== undefined) set('rotate_every_seconds', patch.rotate_every_seconds);
    if (patch.enabled !== undefined) set('enabled', patch.enabled ? 1 : 0);
    if (!fields.length) return existing;
    fields.push('updated_at = ?'); args.push(now);
    args.push(existing.id);
    db.prepare(`UPDATE watermark_policies SET ${fields.join(', ')} WHERE id = ?`).run(...args);
    return db.prepare('SELECT * FROM watermark_policies WHERE id = ?').get(existing.id) as WatermarkPolicy;
  }
  const id = randomUUID();
  db.prepare(`INSERT INTO watermark_policies
    (id, video_id, enabled, style, position, opacity, size_percent,
     include_user_id, include_timestamp, include_session_id, include_ip_hash,
     static_text, logo_url, rotate_every_seconds, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, videoId,
    patch.enabled === false ? 0 : 1,
    patch.style ?? 'semi_transparent',
    patch.position ?? 'bottom_right',
    patch.opacity ?? 0.35,
    patch.size_percent ?? 8,
    patch.include_user_id === false ? 0 : 1,
    patch.include_timestamp === false ? 0 : 1,
    patch.include_session_id === false ? 0 : 1,
    patch.include_ip_hash ? 1 : 0,
    patch.static_text ?? null, patch.logo_url ?? null,
    patch.rotate_every_seconds ?? 0, now, now);
  return db.prepare('SELECT * FROM watermark_policies WHERE id = ?').get(id) as WatermarkPolicy;
}

export function getWatermarkPolicy(videoId: string): WatermarkPolicy | null {
  return (getDb().prepare('SELECT * FROM watermark_policies WHERE video_id = ?').get(videoId) as WatermarkPolicy | undefined) ?? null;
}

// ================= 19.10 / 19.13 Dynamic User-ID + Tracing =================
export interface WatermarkTrace {
  id: string; policy_id: string; video_id: string; session_id: string;
  user_id: string | null; token: string; payload: string; signature: string;
  emitted_at: string; expires_at: string;
}

export interface EmitTraceInput {
  video_id: string;
  session_id: string;
  user_id?: string | null;
  ip?: string | null;
  ttl_seconds?: number;
}

export function emitWatermarkTrace(input: EmitTraceInput): WatermarkTrace {
  const policy = getWatermarkPolicy(input.video_id);
  if (!policy) throw new Error('policy_not_found');
  if (!policy.enabled) throw new Error('policy_disabled');
  const db = getDb();
  const now = new Date();
  const ttl = Math.min(Math.max(input.ttl_seconds ?? 900, 60), 86400);
  const id = randomUUID();
  const payload: Record<string, unknown> = {
    vid: input.video_id,
    sid: input.session_id,
    ts: now.toISOString(),
  };
  if (policy.include_user_id && input.user_id) payload.uid = input.user_id;
  if (policy.include_session_id) payload.sid = input.session_id;
  if (policy.include_ip_hash && input.ip) payload.iph = sha256(input.ip).slice(0, 16);
  payload.pid = policy.id;
  const payloadJson = JSON.stringify(payload);
  const signature = sha256(payloadJson + '|' + id);
  const token = signature.slice(0, 16);
  db.prepare(`INSERT INTO watermark_traces
    (id, policy_id, video_id, session_id, user_id, token, payload, signature, emitted_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, policy.id, input.video_id, input.session_id,
    input.user_id ?? null, token, payloadJson, signature, now.toISOString(),
    new Date(now.getTime() + ttl * 1000).toISOString());
  return db.prepare('SELECT * FROM watermark_traces WHERE id = ?').get(id) as WatermarkTrace;
}

export function traceToken(token: string): WatermarkTrace | null {
  return (getDb().prepare('SELECT * FROM watermark_traces WHERE token = ?').get(token) as WatermarkTrace | undefined) ?? null;
}

export function listTraces(filter?: { video_id?: string; session_id?: string; user_id?: string; limit?: number }) {
  const db = getDb();
  const where: string[] = []; const args: any[] = [];
  if (filter?.video_id) { where.push('video_id = ?'); args.push(filter.video_id); }
  if (filter?.session_id) { where.push('session_id = ?'); args.push(filter.session_id); }
  if (filter?.user_id) { where.push('user_id = ?'); args.push(filter.user_id); }
  const sql = `SELECT * FROM watermark_traces ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY emitted_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args);
}

// ================= 19.14 Leak Detection =================
export interface LeakEvent {
  id: string; video_id: string; session_id: string | null; token: string | null;
  suspected_user_id: string | null; severity: LeakSeverity; detector: string;
  evidence: string; notes: string | null; resolved: number; created_at: string;
}

export interface ReportLeakInput {
  video_id: string;
  detector: string;
  severity?: LeakSeverity;
  token?: string | null;
  session_id?: string | null;
  suspected_user_id?: string | null;
  evidence?: Record<string, unknown>;
  notes?: string | null;
}

export function reportLeak(input: ReportLeakInput): LeakEvent {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO leak_events
    (id, video_id, session_id, token, suspected_user_id, severity, detector, evidence, notes, resolved, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`).run(id, input.video_id, input.session_id ?? null,
    input.token ?? null, input.suspected_user_id ?? null,
    input.severity ?? 'medium', input.detector,
    JSON.stringify(input.evidence ?? {}), input.notes ?? null, now);
  return db.prepare('SELECT * FROM leak_events WHERE id = ?').get(id) as LeakEvent;
}

export function detectLeakFromToken(token: string, detector: string, notes?: string): LeakEvent {
  const t = traceToken(token);
  if (!t) throw new Error('token_not_found');
  return reportLeak({
    video_id: t.video_id, session_id: t.session_id, token,
    suspected_user_id: t.user_id, detector, notes,
    evidence: { emitted_at: t.emitted_at, payload: JSON.parse(t.payload) },
  });
}

export function resolveLeak(id: string): boolean {
  return getDb().prepare('UPDATE leak_events SET resolved = 1 WHERE id = ?').run(id).changes > 0;
}

export function listLeaks(filter?: { video_id?: string; severity?: LeakSeverity; resolved?: boolean; limit?: number }) {
  const db = getDb();
  const where: string[] = []; const args: any[] = [];
  if (filter?.video_id) { where.push('video_id = ?'); args.push(filter.video_id); }
  if (filter?.severity) { where.push('severity = ?'); args.push(filter.severity); }
  if (filter?.resolved !== undefined) { where.push('resolved = ?'); args.push(filter.resolved ? 1 : 0); }
  const sql = `SELECT * FROM leak_events ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args);
}

// ================= 19.15 Piracy Monitoring =================
export interface PiracyTarget {
  id: string; video_id: string; platform: string; url: string;
  first_seen_at: string; last_seen_at: string; status: PiracyStatus;
  confidence: number; dmca_filed_at: string | null; notes: string | null;
  created_at: string; updated_at: string;
}

export interface AddPiracyInput {
  video_id: string; platform: string; url: string;
  confidence?: number; notes?: string | null;
}

export function addPiracyTarget(input: AddPiracyInput): PiracyTarget {
  if (!input.platform || input.platform.length > 80) throw new Error('invalid_platform');
  if (!input.url || input.url.length > 2000) throw new Error('invalid_url');
  if (input.confidence !== undefined && (input.confidence < 0 || input.confidence > 1)) throw new Error('invalid_confidence');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`INSERT INTO piracy_targets
    (id, video_id, platform, url, first_seen_at, last_seen_at, status, confidence, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`).run(id, input.video_id, input.platform, input.url,
    now, now, input.confidence ?? 0.5, input.notes ?? null, now, now);
  return db.prepare('SELECT * FROM piracy_targets WHERE id = ?').get(id) as PiracyTarget;
}

export function updatePiracyStatus(id: string, status: PiracyStatus, notes?: string | null): PiracyTarget {
  if (!['open','investigating','action_taken','dismissed'].includes(status)) throw new Error('invalid_status');
  const db = getDb();
  const t = db.prepare('SELECT * FROM piracy_targets WHERE id = ?').get(id) as PiracyTarget | undefined;
  if (!t) throw new Error('not_found');
  const now = new Date().toISOString();
  db.prepare('UPDATE piracy_targets SET status = ?, notes = COALESCE(?, notes), last_seen_at = ?, updated_at = ? WHERE id = ?')
    .run(status, notes ?? null, now, now, id);
  return db.prepare('SELECT * FROM piracy_targets WHERE id = ?').get(id) as PiracyTarget;
}

export function fileDmca(id: string, notes?: string | null): PiracyTarget {
  const db = getDb();
  const t = db.prepare('SELECT * FROM piracy_targets WHERE id = ?').get(id) as PiracyTarget | undefined;
  if (!t) throw new Error('not_found');
  const now = new Date().toISOString();
  db.prepare('UPDATE piracy_targets SET dmca_filed_at = ?, status = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?')
    .run(now, 'action_taken', notes ?? null, now, id);
  return db.prepare('SELECT * FROM piracy_targets WHERE id = ?').get(id) as PiracyTarget;
}

export function listPiracyTargets(filter?: { video_id?: string; platform?: string; status?: PiracyStatus; limit?: number }) {
  const db = getDb();
  const where: string[] = []; const args: any[] = [];
  if (filter?.video_id) { where.push('video_id = ?'); args.push(filter.video_id); }
  if (filter?.platform) { where.push('platform = ?'); args.push(filter.platform); }
  if (filter?.status) { where.push('status = ?'); args.push(filter.status); }
  const sql = `SELECT * FROM piracy_targets ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY last_seen_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args);
}

// ================= 19.16 Forensic Report =================
export interface ForensicReport {
  id: string; video_id: string; requested_by: string | null;
  period_start: string; period_end: string; payload: string; summary: string;
  signature: string; created_at: string;
}

export interface BuildForensicInput {
  video_id: string; period_start: string; period_end: string;
  requested_by?: string | null;
}

export function buildForensicReport(input: BuildForensicInput): ForensicReport {
  const db = getDb();
  const now = new Date().toISOString();
  const leaks = db.prepare(`SELECT * FROM leak_events WHERE video_id = ? AND created_at BETWEEN ? AND ? ORDER BY created_at DESC`)
    .all(input.video_id, input.period_start, input.period_end) as LeakEvent[];
  const piracy = db.prepare(`SELECT * FROM piracy_targets WHERE video_id = ? AND (created_at BETWEEN ? AND ? OR last_seen_at BETWEEN ? AND ?)`)
    .all(input.video_id, input.period_start, input.period_end, input.period_start, input.period_end) as PiracyTarget[];
  const traces = db.prepare(`SELECT COUNT(*) AS c FROM watermark_traces WHERE video_id = ? AND emitted_at BETWEEN ? AND ?`)
    .get(input.video_id, input.period_start, input.period_end) as { c: number };
  const validations = db.prepare(`SELECT COUNT(*) AS c, SUM(CASE WHEN result='fail' THEN 1 ELSE 0 END) AS f
    FROM playback_session_validations WHERE video_id = ? AND created_at BETWEEN ? AND ?`)
    .get(input.video_id, input.period_start, input.period_end) as { c: number; f: number | null };

  const summary = {
    video_id: input.video_id,
    period: { start: input.period_start, end: input.period_end },
    leaks_total: leaks.length,
    leaks_by_severity: leaks.reduce<Record<string, number>>((acc, l) => { acc[l.severity] = (acc[l.severity] ?? 0) + 1; return acc; }, {}),
    piracy_targets: piracy.length,
    piracy_by_platform: piracy.reduce<Record<string, number>>((acc, p) => { acc[p.platform] = (acc[p.platform] ?? 0) + 1; return acc; }, {}),
    dmca_filed: piracy.filter(p => p.dmca_filed_at).length,
    watermark_traces: traces.c,
    session_validations: validations.c,
    session_failures: validations.f ?? 0,
  };
  const payload = JSON.stringify({ leaks, piracy, traces: traces.c, validations });
  const signature = sha256(payload + '|' + input.video_id + '|' + now);
  const id = randomUUID();
  db.prepare(`INSERT INTO forensic_reports
    (id, video_id, requested_by, period_start, period_end, payload, summary, signature, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.video_id, input.requested_by ?? null,
    input.period_start, input.period_end, payload, JSON.stringify(summary), signature, now);
  return db.prepare('SELECT * FROM forensic_reports WHERE id = ?').get(id) as ForensicReport;
}

export function listForensicReports(videoId?: string, limit = 100) {
  const db = getDb();
  if (videoId) {
    return db.prepare('SELECT * FROM forensic_reports WHERE video_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(videoId, Math.min(Math.max(limit, 1), 500));
  }
  return db.prepare('SELECT * FROM forensic_reports ORDER BY created_at DESC LIMIT ?')
    .all(Math.min(Math.max(limit, 1), 500));
}

export function verifyForensicReport(id: string): { valid: boolean; reason: string } {
  const db = getDb();
  const r = db.prepare('SELECT * FROM forensic_reports WHERE id = ?').get(id) as ForensicReport | undefined;
  if (!r) return { valid: false, reason: 'not_found' };
  const expected = sha256(r.payload + '|' + r.video_id + '|' + r.created_at);
  return expected === r.signature ? { valid: true, reason: 'ok' } : { valid: false, reason: 'signature_mismatch' };
}

// ================= Stats =================
export interface WatermarkStats {
  watermark_policies: number;
  watermark_policies_enabled: number;
  traces_total: number;
  traces_last_24h: number;
  leaks_total: number;
  leaks_unresolved: number;
  leaks_by_severity: Record<string, number>;
  piracy_targets_total: number;
  piracy_targets_open: number;
  piracy_dmca_filed: number;
  forensic_reports: number;
}

export function getWatermarkStats(): WatermarkStats {
  const db = getDb();
  const wp = db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(enabled),0) AS e FROM watermark_policies').get() as { c: number; e: number };
  const tr = db.prepare('SELECT COUNT(*) AS c FROM watermark_traces').get() as { c: number };
  const tr24 = db.prepare('SELECT COUNT(*) AS c FROM watermark_traces WHERE emitted_at >= ?')
    .get(new Date(Date.now() - 86400_000).toISOString()) as { c: number };
  const lk = db.prepare('SELECT COUNT(*) AS c, SUM(CASE WHEN resolved = 0 THEN 1 ELSE 0 END) AS u FROM leak_events').get() as { c: number; u: number | null };
  const sev = db.prepare('SELECT severity, COUNT(*) AS c FROM leak_events GROUP BY severity').all() as { severity: string; c: number }[];
  const bySev: Record<string, number> = {};
  for (const s of sev) bySev[s.severity] = s.c;
  const pt = db.prepare("SELECT COUNT(*) AS c FROM piracy_targets").get() as { c: number };
  const ptOpen = db.prepare("SELECT COUNT(*) AS c FROM piracy_targets WHERE status = 'open'").get() as { c: number };
  const ptDmca = db.prepare('SELECT COUNT(*) AS c FROM piracy_targets WHERE dmca_filed_at IS NOT NULL').get() as { c: number };
  const fr = db.prepare('SELECT COUNT(*) AS c FROM forensic_reports').get() as { c: number };
  return {
    watermark_policies: wp.c, watermark_policies_enabled: wp.e,
    traces_total: tr.c, traces_last_24h: tr24.c,
    leaks_total: lk.c, leaks_unresolved: lk.u ?? 0, leaks_by_severity: bySev,
    piracy_targets_total: pt.c, piracy_targets_open: ptOpen.c, piracy_dmca_filed: ptDmca.c,
    forensic_reports: fr.c,
  };
}
