// melodyflix videos - Section 12.9 Error Alerting
// Rule-based error alerting with severity, fingerprint dedup, cooldown,
// silences, acknowledgement, and resolution tracking.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type AlertSource = 'playback' | 'api' | 'cdn' | 'job' | 'system' | 'security';
export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';
export type AlertStatus = 'open' | 'acknowledged' | 'resolved' | 'silenced';

const SOURCES: AlertSource[] = ['playback','api','cdn','job','system','security'];
const SEVERITIES: AlertSeverity[] = ['info','warning','error','critical'];
const STATUSES: AlertStatus[] = ['open','acknowledged','resolved','silenced'];

export function ensureErrorAlertingSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'error',
      condition_type TEXT NOT NULL,
      threshold REAL NOT NULL DEFAULT 0,
      window_seconds INTEGER NOT NULL DEFAULT 300,
      cooldown_seconds INTEGER NOT NULL DEFAULT 300,
      webhook_url TEXT,
      channels TEXT NOT NULL DEFAULT '["log"]',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_rule_name ON alert_rules(name);
    CREATE INDEX IF NOT EXISTS idx_alert_rule_source ON alert_rules(source, enabled);

    CREATE TABLE IF NOT EXISTS alert_events (
      id TEXT PRIMARY KEY,
      rule_id TEXT,
      source TEXT NOT NULL,
      severity TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'open',
      occurrences INTEGER NOT NULL DEFAULT 1,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      acknowledged_by TEXT,
      acknowledged_at TEXT,
      resolved_by TEXT,
      resolved_at TEXT,
      resolution_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alert_event_status
      ON alert_events(status, severity, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alert_event_fp
      ON alert_events(fingerprint, status);
    CREATE INDEX IF NOT EXISTS idx_alert_event_source
      ON alert_events(source, last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS alert_silences (
      id TEXT PRIMARY KEY,
      fingerprint TEXT,
      source TEXT,
      reason TEXT,
      until_at TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alert_silence_fp ON alert_silences(fingerprint, until_at);
    CREATE INDEX IF NOT EXISTS idx_alert_silence_src ON alert_silences(source, until_at);
  `);
}

// ---------- Types ----------
export interface AlertRule {
  id: string;
  name: string;
  source: AlertSource;
  severity: AlertSeverity;
  condition_type: string;
  threshold: number;
  window_seconds: number;
  cooldown_seconds: number;
  webhook_url: string | null;
  channels: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface AlertEvent {
  id: string;
  rule_id: string | null;
  source: AlertSource;
  severity: AlertSeverity;
  fingerprint: string;
  title: string;
  message: string | null;
  payload: string;
  status: AlertStatus;
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface AlertSilence {
  id: string;
  fingerprint: string | null;
  source: AlertSource | null;
  reason: string | null;
  until_at: string;
  created_by: string | null;
  created_at: string;
}

// ---------- Rules ----------
export interface CreateRuleInput {
  name: string;
  source: AlertSource;
  severity?: AlertSeverity;
  condition_type: string;
  threshold?: number;
  window_seconds?: number;
  cooldown_seconds?: number;
  webhook_url?: string | null;
  channels?: string[];
  enabled?: boolean;
}

export function createRule(input: CreateRuleInput): AlertRule {
  if (!SOURCES.includes(input.source)) throw new Error('invalid_source');
  const severity = input.severity ?? 'error';
  if (!SEVERITIES.includes(severity)) throw new Error('invalid_severity');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO alert_rules
      (id, name, source, severity, condition_type, threshold, window_seconds, cooldown_seconds,
       webhook_url, channels, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.name, input.source, severity, input.condition_type,
    input.threshold ?? 0, input.window_seconds ?? 300, input.cooldown_seconds ?? 300,
    input.webhook_url ?? null, JSON.stringify(input.channels ?? ['log']),
    input.enabled === false ? 0 : 1, now, now);
  return getRule(id)!;
}

export function getRule(id: string): AlertRule | null {
  return (getDb().prepare('SELECT * FROM alert_rules WHERE id = ?').get(id) as AlertRule | undefined) ?? null;
}

export function listRules(filter?: { source?: AlertSource; enabledOnly?: boolean }): AlertRule[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter?.source) { where.push('source = ?'); args.push(filter.source); }
  if (filter?.enabledOnly) where.push('enabled = 1');
  const sql = `SELECT * FROM alert_rules ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY source, name`;
  return db.prepare(sql).all(...args) as AlertRule[];
}

export function updateRule(id: string, patch: Partial<CreateRuleInput>): AlertRule | null {
  const existing = getRule(id);
  if (!existing) return null;
  const fields: string[] = [];
  const args: any[] = [];
  if (patch.name !== undefined) { fields.push('name = ?'); args.push(patch.name); }
  if (patch.source !== undefined) { if (!SOURCES.includes(patch.source)) throw new Error('invalid_source'); fields.push('source = ?'); args.push(patch.source); }
  if (patch.severity !== undefined) { if (!SEVERITIES.includes(patch.severity)) throw new Error('invalid_severity'); fields.push('severity = ?'); args.push(patch.severity); }
  if (patch.condition_type !== undefined) { fields.push('condition_type = ?'); args.push(patch.condition_type); }
  if (patch.threshold !== undefined) { fields.push('threshold = ?'); args.push(patch.threshold); }
  if (patch.window_seconds !== undefined) { fields.push('window_seconds = ?'); args.push(patch.window_seconds); }
  if (patch.cooldown_seconds !== undefined) { fields.push('cooldown_seconds = ?'); args.push(patch.cooldown_seconds); }
  if (patch.webhook_url !== undefined) { fields.push('webhook_url = ?'); args.push(patch.webhook_url); }
  if (patch.channels !== undefined) { fields.push('channels = ?'); args.push(JSON.stringify(patch.channels)); }
  if (patch.enabled !== undefined) { fields.push('enabled = ?'); args.push(patch.enabled ? 1 : 0); }
  if (!fields.length) return existing;
  fields.push('updated_at = ?'); args.push(new Date().toISOString());
  args.push(id);
  getDb().prepare(`UPDATE alert_rules SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  return getRule(id);
}

export function deleteRule(id: string): boolean {
  return getDb().prepare('DELETE FROM alert_rules WHERE id = ?').run(id).changes > 0;
}

// ---------- Fire ----------
export interface FireAlertInput {
  source: AlertSource;
  severity?: AlertSeverity;
  fingerprint: string;
  title: string;
  message?: string | null;
  payload?: Record<string, unknown>;
  rule_id?: string | null;
}

function isSilenced(fingerprint: string, source: AlertSource): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const row = db.prepare(`
    SELECT 1 AS s FROM alert_silences
    WHERE until_at > ? AND (fingerprint = ? OR (fingerprint IS NULL AND source = ?))
    LIMIT 1
  `).get(now, fingerprint, source) as { s: number } | undefined;
  return !!row;
}

export interface FireResult {
  event: AlertEvent;
  deduped: boolean;
  silenced: boolean;
}

export function fireAlert(input: FireAlertInput): FireResult {
  if (!SOURCES.includes(input.source)) throw new Error('invalid_source');
  const severity = input.severity ?? 'error';
  if (!SEVERITIES.includes(severity)) throw new Error('invalid_severity');
  const db = getDb();
  const now = new Date().toISOString();

  const silenced = isSilenced(input.fingerprint, input.source);

  // Dedup: existing OPEN or ACKNOWLEDGED event with same fingerprint
  const existing = db.prepare(`
    SELECT * FROM alert_events
    WHERE fingerprint = ? AND status IN ('open','acknowledged')
    ORDER BY last_seen_at DESC LIMIT 1
  `).get(input.fingerprint) as AlertEvent | undefined;

  if (existing && !silenced) {
    db.prepare(`
      UPDATE alert_events
      SET occurrences = occurrences + 1, last_seen_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, existing.id);
    const updated = getEvent(existing.id)!;
    return { event: updated, deduped: true, silenced: false };
  }

  const id = randomUUID();
  const status: AlertStatus = silenced ? 'silenced' : 'open';
  db.prepare(`
    INSERT INTO alert_events
      (id, rule_id, source, severity, fingerprint, title, message, payload, status,
       occurrences, first_seen_at, last_seen_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
  `).run(id, input.rule_id ?? null, input.source, severity, input.fingerprint,
    input.title, input.message ?? null, JSON.stringify(input.payload ?? {}),
    status, now, now, now, now);
  return { event: getEvent(id)!, deduped: false, silenced };
}

// ---------- Events ----------
export function getEvent(id: string): AlertEvent | null {
  return (getDb().prepare('SELECT * FROM alert_events WHERE id = ?').get(id) as AlertEvent | undefined) ?? null;
}

export function listEvents(filter?: {
  status?: AlertStatus;
  severity?: AlertSeverity;
  source?: AlertSource;
  fingerprint?: string;
  limit?: number;
}): AlertEvent[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter?.status) { where.push('status = ?'); args.push(filter.status); }
  if (filter?.severity) { where.push('severity = ?'); args.push(filter.severity); }
  if (filter?.source) { where.push('source = ?'); args.push(filter.source); }
  if (filter?.fingerprint) { where.push('fingerprint = ?'); args.push(filter.fingerprint); }
  const sql = `SELECT * FROM alert_events ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY last_seen_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args) as AlertEvent[];
}

export function acknowledgeEvent(id: string, actor: string): AlertEvent | null {
  const e = getEvent(id);
  if (!e) return null;
  if (e.status === 'resolved') throw new Error('already_resolved');
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE alert_events SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = ?, updated_at = ?
    WHERE id = ?
  `).run(actor, now, now, id);
  return getEvent(id);
}

export function resolveEvent(id: string, actor: string, note?: string): AlertEvent | null {
  const e = getEvent(id);
  if (!e) return null;
  if (e.status === 'resolved') return e;
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE alert_events SET status = 'resolved', resolved_by = ?, resolved_at = ?, resolution_note = ?, updated_at = ?
    WHERE id = ?
  `).run(actor, now, note ?? null, now, id);
  return getEvent(id);
}

export function reopenEvent(id: string): AlertEvent | null {
  const e = getEvent(id);
  if (!e) return null;
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE alert_events SET status = 'open', resolved_by = NULL, resolved_at = NULL, resolution_note = NULL, updated_at = ?
    WHERE id = ?
  `).run(now, id);
  return getEvent(id);
}

// ---------- Silences ----------
export function createSilence(input: {
  fingerprint?: string | null;
  source?: AlertSource | null;
  reason?: string | null;
  until_at: string;
  created_by?: string | null;
}): AlertSilence {
  if (!input.fingerprint && !input.source) throw new Error('need_fingerprint_or_source');
  if (input.source && !SOURCES.includes(input.source)) throw new Error('invalid_source');
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO alert_silences (id, fingerprint, source, reason, until_at, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.fingerprint ?? null, input.source ?? null, input.reason ?? null,
    input.until_at, input.created_by ?? null, now);
  return db.prepare('SELECT * FROM alert_silences WHERE id = ?').get(id) as AlertSilence;
}

export function listSilences(activeOnly = true): AlertSilence[] {
  const db = getDb();
  if (activeOnly) {
    return db.prepare('SELECT * FROM alert_silences WHERE until_at > ? ORDER BY until_at ASC')
      .all(new Date().toISOString()) as AlertSilence[];
  }
  return db.prepare('SELECT * FROM alert_silences ORDER BY until_at DESC').all() as AlertSilence[];
}

export function deleteSilence(id: string): boolean {
  return getDb().prepare('DELETE FROM alert_silences WHERE id = ?').run(id).changes > 0;
}

// ---------- Stats ----------
export interface AlertingStats {
  total_events: number;
  open: number;
  acknowledged: number;
  resolved: number;
  silenced: number;
  by_severity: Record<string, number>;
  by_source: Record<string, number>;
  active_silences: number;
  total_rules: number;
}

export function getAlertingStats(): AlertingStats {
  const db = getDb();
  const rows = db.prepare('SELECT status, severity, source FROM alert_events').all() as
    { status: string; severity: string; source: string }[];
  const bySeverity: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let open = 0, ack = 0, res = 0, sil = 0;
  for (const r of rows) {
    bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    if (r.status === 'open') open++;
    else if (r.status === 'acknowledged') ack++;
    else if (r.status === 'resolved') res++;
    else if (r.status === 'silenced') sil++;
  }
  const rules = db.prepare('SELECT COUNT(*) AS c FROM alert_rules').get() as { c: number };
  const silences = db.prepare('SELECT COUNT(*) AS c FROM alert_silences WHERE until_at > ?')
    .get(new Date().toISOString()) as { c: number };
  return {
    total_events: rows.length,
    open, acknowledged: ack, resolved: res, silenced: sil,
    by_severity: bySeverity,
    by_source: bySource,
    active_silences: silences.c,
    total_rules: rules.c,
  };
}

// ---------- Rule evaluation (aggregate over telemetry errors) ----------
export interface RuleEvalResult {
  rule_id: string;
  matched: boolean;
  value: number;
  fired: FireResult | null;
}

export function evaluateRule(ruleId: string): RuleEvalResult {
  const rule = getRule(ruleId);
  if (!rule) throw new Error('rule_not_found');
  if (!rule.enabled) return { rule_id: ruleId, matched: false, value: 0, fired: null };

  const db = getDb();
  const since = new Date(Date.now() - rule.window_seconds * 1000).toISOString();
  let value = 0;

  if (rule.source === 'playback' && rule.condition_type === 'error_count') {
    const row = db.prepare('SELECT COUNT(*) AS c FROM playback_errors WHERE occurred_at >= ?')
      .get(since) as { c: number };
    value = row.c;
  } else if (rule.source === 'playback' && rule.condition_type === 'fatal_error_count') {
    const row = db.prepare('SELECT COUNT(*) AS c FROM playback_errors WHERE occurred_at >= ? AND fatal = 1')
      .get(since) as { c: number };
    value = row.c;
  } else if (rule.source === 'api' && rule.condition_type === 'error_count') {
    const row = db.prepare(
      "SELECT COUNT(*) AS c FROM alert_events WHERE source = 'api' AND created_at >= ?"
    ).get(since) as { c: number };
    value = row.c;
  } else {
    return { rule_id: ruleId, matched: false, value: 0, fired: null };
  }

  const matched = value >= rule.threshold && rule.threshold > 0;
  if (!matched) return { rule_id: ruleId, matched: false, value, fired: null };

  const fired = fireAlert({
    source: rule.source,
    severity: rule.severity,
    fingerprint: `rule:${rule.id}`,
    title: `Rule triggered: ${rule.name}`,
    message: `${rule.condition_type} = ${value} (threshold ${rule.threshold})`,
    payload: { rule_id: rule.id, value, threshold: rule.threshold, window_seconds: rule.window_seconds },
    rule_id: rule.id,
  });
  return { rule_id: ruleId, matched: true, value, fired };
}

export function evaluateAllRules(): RuleEvalResult[] {
  const rules = listRules({ enabledOnly: true });
  return rules.map(r => {
    try { return evaluateRule(r.id); }
    catch { return { rule_id: r.id, matched: false, value: 0, fired: null }; }
  });
}
