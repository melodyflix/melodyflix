// melodyflix videos - Section 11.20 Incident Detection
// Correlates signals from all security services into incidents.
// Sources: waf_matches, rate_limit_events, vpn_checks, fraud_events,
// suspicious_alerts, ip_block hits. Aggregates per-IP/user over a window.
import { randomUUID, createHash } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'open' | 'investigating' | 'mitigated' | 'closed' | 'false_positive';
export type IncidentSource =
  | 'waf'
  | 'rate_limit'
  | 'vpn'
  | 'fraud'
  | 'suspicious_login'
  | 'ip_block'
  | 'manual';

export interface Incident {
  id: string;
  title: string;
  description: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  source: IncidentSource;
  actor_ip: string | null;
  actor_user_id: string | null;
  signal_count: number;
  score: number;
  fingerprint: string;            // dedupe hash
  assigned_to: string | null;
  first_seen_at: string;
  last_seen_at: string;
  mitigated_at: string | null;
  closed_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface IncidentSignal {
  id: string;
  incident_id: string;
  source: IncidentSource;
  source_id: string | null;
  signal_type: string;
  severity: IncidentSeverity;
  ip_address: string | null;
  user_id: string | null;
  details: string | null;
  created_at: string;
}

const VALID_SEVERITIES: IncidentSeverity[] = ['low', 'medium', 'high', 'critical'];
const VALID_STATUSES: IncidentStatus[] = ['open', 'investigating', 'mitigated', 'closed', 'false_positive'];

// Auto-dedupe window: signals within this window with same fingerprint merge
const DEDUPE_WINDOW_SECONDS = 3600; // 1 hour

// Severity weights for score → severity mapping
function scoreToSeverity(score: number): IncidentSeverity {
  if (score >= 80) return 'critical';
  if (score >= 55) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

export function ensureIncidentSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      severity TEXT NOT NULL DEFAULT 'low'
        CHECK (severity IN ('low','medium','high','critical')),
      status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','investigating','mitigated','closed','false_positive')),
      source TEXT NOT NULL,
      actor_ip TEXT,
      actor_user_id TEXT,
      signal_count INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      fingerprint TEXT NOT NULL,
      assigned_to TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      mitigated_at TEXT,
      closed_at TEXT,
      resolved_by TEXT,
      resolution_note TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inc_status ON incidents(status, severity);
    CREATE INDEX IF NOT EXISTS idx_inc_fingerprint ON incidents(fingerprint, status);
    CREATE INDEX IF NOT EXISTS idx_inc_ip ON incidents(actor_ip);
    CREATE INDEX IF NOT EXISTS idx_inc_user ON incidents(actor_user_id);
    CREATE INDEX IF NOT EXISTS idx_inc_created ON incidents(created_at DESC);

    CREATE TABLE IF NOT EXISTS incident_signals (
      id TEXT PRIMARY KEY,
      incident_id TEXT NOT NULL,
      source TEXT NOT NULL,
      source_id TEXT,
      signal_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      ip_address TEXT,
      user_id TEXT,
      details TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_incsig_incident ON incident_signals(incident_id);
    CREATE INDEX IF NOT EXISTS idx_incsig_source ON incident_signals(source, created_at DESC);
  `);
}

function rowToIncident(r: any): Incident { return r as Incident; }
function rowToSignal(r: any): IncidentSignal { return r as IncidentSignal; }

function computeFingerprint(source: IncidentSource, ip: string | null, userId: string | null, signalType: string): string {
  return createHash('sha256')
    .update(`${source}|${ip ?? ''}|${userId ?? ''}|${signalType}`)
    .digest('hex')
    .slice(0, 16);
}

function logSignal(incidentId: string, source: IncidentSource, sourceId: string | null, signalType: string, severity: IncidentSeverity, ip: string | null, userId: string | null, details?: Record<string, unknown> | null): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO incident_signals
      (id, incident_id, source, source_id, signal_type, severity, ip_address, user_id, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), incidentId, source, sourceId, signalType, severity,
    ip, userId, details ? JSON.stringify(details) : null,
    new Date().toISOString(),
  );
}

// ============================================================
// Severity scoring per source (weight added to incident score)
// ============================================================

const SEVERITY_WEIGHT: Record<IncidentSeverity, number> = {
  low: 5,
  medium: 15,
  high: 30,
  critical: 50,
};

// ============================================================
// Incident create / merge
// ============================================================

export interface RecordSignalInput {
  source: IncidentSource;
  source_id?: string | null;
  signal_type: string;
  severity: IncidentSeverity;
  ip_address?: string | null;
  user_id?: string | null;
  details?: Record<string, unknown> | null;
  /** Title override for the incident (default auto-generated). */
  title?: string;
  /** Description override. */
  description?: string | null;
}

/**
 * Record a signal → find or create an incident (dedupe by fingerprint
 * within DEDUPE_WINDOW_SECONDS).
 */
export function recordSignal(input: RecordSignalInput): Incident {
  if (!VALID_SEVERITIES.includes(input.severity)) throw new Error(`Invalid severity: ${input.severity}`);

  const db = getDb();
  const now = new Date().toISOString();
  const fingerprint = computeFingerprint(
    input.source,
    input.ip_address ?? null,
    input.user_id ?? null,
    input.signal_type,
  );

  // Look for an open/recent incident matching the fingerprint
  const windowStart = new Date(Date.now() - DEDUPE_WINDOW_SECONDS * 1000).toISOString();
  const existing = db.prepare(`
    SELECT * FROM incidents
    WHERE fingerprint = ?
      AND status IN ('open','investigating')
      AND last_seen_at >= ?
    ORDER BY last_seen_at DESC LIMIT 1
  `).get(fingerprint, windowStart) as any;

  const weight = SEVERITY_WEIGHT[input.severity];

  if (existing) {
    // Merge: update score + last_seen + signal_count, escalate severity
    const inc = rowToIncident(existing);
    const newScore = Math.min(100, inc.score + weight);
    const newSeverity = scoreToSeverity(newScore);
    const newCount = inc.signal_count + 1;

    db.prepare(`
      UPDATE incidents
      SET score = ?, severity = ?, signal_count = ?, last_seen_at = ?, updated_at = ?
      WHERE id = ?
    `).run(newScore, newSeverity, newCount, now, now, inc.id);

    logSignal(inc.id, input.source, input.source_id ?? null, input.signal_type,
      input.severity, input.ip_address ?? null, input.user_id ?? null, input.details ?? null);

    return getIncident(inc.id)!;
  }

  // Create new incident
  const id = randomUUID();
  const title = input.title ?? autoTitle(input);
  const description = input.description ?? null;
  const severity = scoreToSeverity(weight);

  db.prepare(`
    INSERT INTO incidents
      (id, title, description, severity, status, source, actor_ip, actor_user_id,
       signal_count, score, fingerprint, assigned_to, first_seen_at, last_seen_at,
       mitigated_at, closed_at, resolved_by, resolution_note, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'open', ?, ?, ?, 1, ?, ?, NULL, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?)
  `).run(
    id, title, description, severity, input.source,
    input.ip_address ?? null, input.user_id ?? null,
    weight, fingerprint, now, now,
    input.details ? JSON.stringify(input.details) : null,
    now, now,
  );

  logSignal(id, input.source, input.source_id ?? null, input.signal_type,
    input.severity, input.ip_address ?? null, input.user_id ?? null, input.details ?? null);

  return getIncident(id)!;
}

function autoTitle(input: RecordSignalInput): string {
  const target = input.ip_address ?? input.user_id ?? 'unknown';
  return `[${input.source}] ${input.signal_type} — ${target}`.slice(0, 200);
}

export function getIncident(id: string): Incident | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as any;
  return r ? rowToIncident(r) : null;
}

export interface ListIncidentsOpts {
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  source?: IncidentSource;
  actor_ip?: string;
  actor_user_id?: string;
  assigned_to?: string;
  limit?: number;
  offset?: number;
}

export function listIncidents(opts: ListIncidentsOpts = {}): { incidents: Incident[]; total: number } {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];

  if (opts.status) { where.push('status = ?'); params.push(opts.status); }
  if (opts.severity) { where.push('severity = ?'); params.push(opts.severity); }
  if (opts.source) { where.push('source = ?'); params.push(opts.source); }
  if (opts.actor_ip) { where.push('actor_ip = ?'); params.push(opts.actor_ip); }
  if (opts.actor_user_id) { where.push('actor_user_id = ?'); params.push(opts.actor_user_id); }
  if (opts.assigned_to) { where.push('assigned_to = ?'); params.push(opts.assigned_to); }

  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const total = (db.prepare(`SELECT COUNT(*) as c FROM incidents ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT * FROM incidents ${w} ORDER BY
      CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      last_seen_at DESC
     LIMIT ${limit} OFFSET ${offset}`
  ).all(...params) as any[];

  return { incidents: rows.map(rowToIncident), total };
}

export function listSignals(incidentId: string, limit = 200): IncidentSignal[] {
  const db = getDb();
  const lim = Math.min(Math.max(limit, 1), 500);
  return db.prepare(
    `SELECT * FROM incident_signals WHERE incident_id = ? ORDER BY created_at ASC LIMIT ${lim}`
  ).all(incidentId) as IncidentSignal[];
}

// ============================================================
// Workflow
// ============================================================

export interface UpdateIncidentInput {
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  assigned_to?: string | null;
  resolution_note?: string | null;
}

export function updateIncident(id: string, patch: UpdateIncidentInput, actorId: string | null): Incident {
  const db = getDb();
  const existing = getIncident(id);
  if (!existing) throw new Error('Incident not found');

  const fields: string[] = [];
  const params: any[] = [];
  const now = new Date().toISOString();

  if (patch.status !== undefined) {
    if (!VALID_STATUSES.includes(patch.status)) throw new Error(`Invalid status: ${patch.status}`);
    fields.push('status = ?'); params.push(patch.status);

    if (patch.status === 'mitigated') {
      fields.push('mitigated_at = ?'); params.push(now);
    } else if (patch.status === 'closed' || patch.status === 'false_positive') {
      fields.push('closed_at = ?'); params.push(now);
      fields.push('resolved_by = ?'); params.push(actorId);
    }
  }
  if (patch.severity !== undefined) {
    if (!VALID_SEVERITIES.includes(patch.severity)) throw new Error('Invalid severity');
    fields.push('severity = ?'); params.push(patch.severity);
  }
  if (patch.assigned_to !== undefined) {
    fields.push('assigned_to = ?'); params.push(patch.assigned_to);
  }
  if (patch.resolution_note !== undefined) {
    fields.push('resolution_note = ?'); params.push(patch.resolution_note);
  }

  if (fields.length === 0) return existing;
  fields.push('updated_at = ?'); params.push(now);
  params.push(id);

  db.prepare(`UPDATE incidents SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getIncident(id)!;
}

/** Create an incident manually (from an admin). */
export function createManualIncident(input: {
  title: string;
  description?: string;
  severity: IncidentSeverity;
  actor_ip?: string | null;
  actor_user_id?: string | null;
  created_by: string | null;
}): Incident {
  if (!input.title || input.title.trim().length < 5 || input.title.length > 200) {
    throw new Error('title must be 5-200 chars');
  }
  if (!VALID_SEVERITIES.includes(input.severity)) throw new Error('Invalid severity');

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const fingerprint = computeFingerprint('manual', input.actor_ip ?? null, input.actor_user_id ?? null, input.title);

  db.prepare(`
    INSERT INTO incidents
      (id, title, description, severity, status, source, actor_ip, actor_user_id,
       signal_count, score, fingerprint, assigned_to, first_seen_at, last_seen_at,
       mitigated_at, closed_at, resolved_by, resolution_note, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'open', 'manual', ?, ?, 0, ?, ?, NULL, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?)
  `).run(
    id, input.title.trim(), input.description ?? null, input.severity,
    input.actor_ip ?? null, input.actor_user_id ?? null,
    SEVERITY_WEIGHT[input.severity], fingerprint,
    now, now,
    JSON.stringify({ created_by: input.created_by }),
    now, now,
  );

  logSignal(id, 'manual', null, 'manual_create', input.severity,
    input.actor_ip ?? null, input.actor_user_id ?? null,
    { created_by: input.created_by });

  return getIncident(id)!;
}

/** Escalate an open incident to critical + assign to admin. */
export function escalateIncident(id: string, adminId: string, note?: string): Incident {
  const db = getDb();
  const existing = getIncident(id);
  if (!existing) throw new Error('Incident not found');
  if (['closed', 'false_positive'].includes(existing.status)) {
    throw new Error(`Cannot escalate incident in status ${existing.status}`);
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE incidents
    SET severity = 'critical', status = 'investigating',
        assigned_to = ?, resolution_note = COALESCE(?, resolution_note),
        updated_at = ?
    WHERE id = ?
  `).run(adminId, note ?? null, now, id);

  logSignal(id, 'manual', null, 'escalated', 'critical',
    existing.actor_ip, existing.actor_user_id, { by: adminId, note: note ?? null });

  return getIncident(id)!;
}

// ============================================================
// Correlation: pull recent signals from security services
// ============================================================

export interface CorrelateResult {
  incidents_created: number;
  incidents_merged: number;
  window_minutes: number;
  sources_scanned: number;
}

/**
 * Scan source tables (waf_matches, rate_limit_events, vpn_checks,
 * fraud_events, suspicious_alerts) for recent signals and feed them
 * into the incident system. Call periodically (e.g., every 5 min).
 */
export function correlateRecentSignals(windowMinutes = 15): CorrelateResult {
  const db = getDb();
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  let created = 0;
  let merged = 0;
  let sources = 0;

  const safeQuery = <T = any>(sql: string, params: any[] = []): T[] => {
    try {
      const tbl = sql.match(/FROM\s+(\w+)/i)?.[1];
      if (!tbl) return [];
      const exists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).get(tbl) as { name: string } | undefined;
      if (!exists) return [];
      return db.prepare(sql).all(...params) as T[];
    } catch { return []; }
  };

  // 1. WAF: block-level matches with critical severity
  const wafRows = safeQuery<{ id: string; rule_name: string; severity: string; ip_address: string | null; user_id: string | null; path: string | null; category: string }>(
    "SELECT id, rule_name, severity, ip_address, user_id, path, category FROM waf_matches WHERE action='block' AND created_at >= ?",
    [since],
  );
  if (wafRows.length > 0) sources++;
  for (const r of wafRows) {
    const sev = (['low','medium','high','critical'].includes(r.severity) ? r.severity : 'medium') as IncidentSeverity;
    const before = db.prepare("SELECT COUNT(*) as c FROM incidents").get() as { c: number };
    const inc = recordSignal({
      source: 'waf',
      source_id: r.id,
      signal_type: `waf:${r.category}`,
      severity: sev,
      ip_address: r.ip_address,
      user_id: r.user_id,
      details: { rule_name: r.rule_name, path: r.path },
    });
    const after = db.prepare("SELECT COUNT(*) as c FROM incidents").get() as { c: number };
    if (after.c > before.c) created++; else merged++;
    void inc;
  }

  // 2. Rate limit denies
  const rlRows = safeQuery<{ id: string; key: string; route: string | null; method: string | null; count: number; max_requests: number }>(
    "SELECT id, key, route, method, count, max_requests FROM rate_limit_events WHERE decision='deny' AND created_at >= ?",
    [since],
  );
  if (rlRows.length > 0) sources++;
  for (const r of rlRows) {
    // extract ip from key like "rule-id|ip:1.2.3.4" or "rule-id|ip:1.2.3.4|u:..."
    const ipMatch = r.key.match(/ip:([^|]+)/);
    const ip = ipMatch ? ipMatch[1] : null;
    const before = db.prepare("SELECT COUNT(*) as c FROM incidents").get() as { c: number };
    recordSignal({
      source: 'rate_limit',
      source_id: r.id,
      signal_type: 'rate_limit_exceeded',
      severity: 'medium',
      ip_address: ip,
      details: { route: r.route, method: r.method, count: r.count, max: r.max_requests },
    });
    const after = db.prepare("SELECT COUNT(*) as c FROM incidents").get() as { c: number };
    if (after.c > before.c) created++; else merged++;
  }

  // 3. VPN/Tor hits (only high risk)
  const vpnRows = safeQuery<{ id: string; ip: string; classification: string; risk_score: number; provider: string | null; user_id: string | null }>(
    "SELECT id, ip, classification, risk_score, provider, user_id FROM vpn_checks WHERE risk_score >= 50 AND created_at >= ?",
    [since],
  );
  if (vpnRows.length > 0) sources++;
  for (const r of vpnRows) {
    const before = db.prepare("SELECT COUNT(*) as c FROM incidents").get() as { c: number };
    recordSignal({
      source: 'vpn',
      source_id: r.id,
      signal_type: `vpn:${r.classification}`,
      severity: r.risk_score >= 80 ? 'high' : 'medium',
      ip_address: r.ip,
      user_id: r.user_id,
      details: { provider: r.provider, risk: r.risk_score },
    });
    const after = db.prepare("SELECT COUNT(*) as c FROM incidents").get() as { c: number };
    if (after.c > before.c) created++; else merged++;
  }

  // 4. Fraud events (block/review decisions)
  const fraudRows = safeQuery<{ id: string; user_id: string; action: string; decision: string; score: number; ip_address: string | null; severity: string }>(
    "SELECT id, user_id, action, decision, score, ip_address, severity FROM fraud_events WHERE decision IN ('review','block') AND created_at >= ?",
    [since],
  );
  if (fraudRows.length > 0) sources++;
  for (const r of fraudRows) {
    const sev = (['low','medium','high','critical'].includes(r.severity) ? r.severity : 'medium') as IncidentSeverity;
    const before = db.prepare("SELECT COUNT(*) as c FROM incidents").get() as { c: number };
    recordSignal({
      source: 'fraud',
      source_id: r.id,
      signal_type: `fraud:${r.action}`,
      severity: sev,
      ip_address: r.ip_address,
      user_id: r.user_id,
      details: { decision: r.decision, score: r.score },
    });
    const after = db.prepare("SELECT COUNT(*) as c FROM incidents").get() as { c: number };
    if (after.c > before.c) created++; else merged++;
  }

  // 5. Suspicious login alerts (level >= high)
  const slRows = safeQuery<{ id: string; user_id: string; level: string; score: number; reasons: string }>(
    "SELECT id, user_id, level, score, reasons FROM suspicious_alerts WHERE level IN ('high','critical') AND created_at >= ?",
    [since],
  );
  if (slRows.length > 0) sources++;
  for (const r of slRows) {
    const before = db.prepare("SELECT COUNT(*) as c FROM incidents").get() as { c: number };
    recordSignal({
      source: 'suspicious_login',
      source_id: r.id,
      signal_type: 'suspicious_login',
      severity: r.level as IncidentSeverity,
      user_id: r.user_id,
      details: { score: r.score, reasons: r.reasons },
    });
    const after = db.prepare("SELECT COUNT(*) as c FROM incidents").get() as { c: number };
    if (after.c > before.c) created++; else merged++;
  }

  return {
    incidents_created: created,
    incidents_merged: merged,
    window_minutes: windowMinutes,
    sources_scanned: sources,
  };
}

// ============================================================
// Stats & cleanup
// ============================================================

export interface IncidentStats {
  total: number;
  open: number;
  investigating: number;
  by_severity: Record<string, number>;
  by_source: Record<string, number>;
  by_status: Record<string, number>;
  created_24h: number;
  closed_24h: number;
  avg_open_hours: number | null;
  window_days: number;
}

export function getIncidentStats(windowDays = 30): IncidentStats {
  const db = getDb();
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString();

  const total = (db.prepare('SELECT COUNT(*) as c FROM incidents WHERE created_at >= ?').get(since) as { c: number }).c;
  const open = (db.prepare("SELECT COUNT(*) as c FROM incidents WHERE status = 'open'").get() as { c: number }).c;
  const investigating = (db.prepare("SELECT COUNT(*) as c FROM incidents WHERE status = 'investigating'").get() as { c: number }).c;

  const bySeverity: Record<string, number> = {};
  for (const r of db.prepare(
    'SELECT severity, COUNT(*) as c FROM incidents WHERE created_at >= ? GROUP BY severity'
  ).all(since) as Array<{ severity: string; c: number }>) bySeverity[r.severity] = r.c;

  const bySource: Record<string, number> = {};
  for (const r of db.prepare(
    'SELECT source, COUNT(*) as c FROM incidents WHERE created_at >= ? GROUP BY source'
  ).all(since) as Array<{ source: string; c: number }>) bySource[r.source] = r.c;

  const byStatus: Record<string, number> = {};
  for (const r of db.prepare(
    'SELECT status, COUNT(*) as c FROM incidents WHERE created_at >= ? GROUP BY status'
  ).all(since) as Array<{ status: string; c: number }>) byStatus[r.status] = r.c;

  const since24 = new Date(Date.now() - 86400_000).toISOString();
  const created24 = (db.prepare(
    'SELECT COUNT(*) as c FROM incidents WHERE created_at >= ?'
  ).get(since24) as { c: number }).c;
  const closed24 = (db.prepare(
    "SELECT COUNT(*) as c FROM incidents WHERE status IN ('closed','mitigated','false_positive') AND closed_at >= ?"
  ).get(since24) as { c: number }).c;

  // Avg open age
  const openAges = db.prepare(
    "SELECT first_seen_at FROM incidents WHERE status IN ('open','investigating')"
  ).all() as Array<{ first_seen_at: string }>;
  let avgHours: number | null = null;
  if (openAges.length > 0) {
    const now = Date.now();
    const sum = openAges.reduce((acc, r) => acc + (now - new Date(r.first_seen_at).getTime()), 0);
    avgHours = Math.round((sum / openAges.length / 3600_000) * 10) / 10;
  }

  return {
    total,
    open,
    investigating,
    by_severity: bySeverity,
    by_source: bySource,
    by_status: byStatus,
    created_24h: created24,
    closed_24h: closed24,
    avg_open_hours: avgHours,
    window_days: windowDays,
  };
}

export function pruneOldIncidents(olderThanDays = 365): { pruned: number } {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000).toISOString();
  const info = db.prepare(
    "DELETE FROM incidents WHERE status IN ('closed','false_positive') AND closed_at < ?"
  ).run(cutoff);
  return { pruned: info.changes };
}
