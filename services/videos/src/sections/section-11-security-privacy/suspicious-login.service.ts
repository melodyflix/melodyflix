// melodyflix videos - Section 11.9 Suspicious Login Alert
// Detects suspicious login events based on device/IP/geo novelty,
// impossible travel, and burst failures. Sends alerts to user.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type SuspicionLevel = 'low' | 'medium' | 'high' | 'critical';
export type AlertStatus = 'new' | 'acknowledged' | 'dismissed' | 'confirmed_fraud';
export type SuspicionReason =
  | 'new_device'
  | 'new_ip'
  | 'new_country'
  | 'impossible_travel'
  | 'brute_force'
  | 'tor_exit'
  | 'datacenter_ip'
  | 'unusual_time'
  | 'user_agent_anomaly';

export interface LoginAttempt {
  id: string;
  user_id: string;
  ip_address: string | null;
  user_agent: string | null;
  device_label: string | null;
  device_type: string | null;
  country: string | null;
  city: string | null;
  success: number;
  failed_reason: string | null;
  created_at: string;
}

export interface SuspiciousAlert {
  id: string;
  user_id: string;
  attempt_id: string | null;
  level: SuspicionLevel;
  score: number;
  reasons: string;               // JSON array of SuspicionReason
  details: string | null;        // JSON object with metadata
  status: AlertStatus;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EvaluateInput {
  user_id: string;
  ip_address?: string | null;
  user_agent?: string | null;
  device_label?: string | null;
  device_type?: string | null;
  country?: string | null;
  city?: string | null;
  success?: boolean;
  failed_reason?: string | null;
}

const VALID_LEVELS: SuspicionLevel[] = ['low', 'medium', 'high', 'critical'];
const VALID_STATUSES: AlertStatus[] = ['new', 'acknowledged', 'dismissed', 'confirmed_fraud'];

// Weights per reason (sum caps at 100)
const REASON_WEIGHTS: Record<SuspicionReason, number> = {
  new_device: 15,
  new_ip: 10,
  new_country: 30,
  impossible_travel: 40,
  brute_force: 25,
  tor_exit: 35,
  datacenter_ip: 15,
  unusual_time: 5,
  user_agent_anomaly: 10,
};

export function ensureSuspiciousLoginSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      device_label TEXT,
      device_type TEXT,
      country TEXT,
      city TEXT,
      success INTEGER NOT NULL DEFAULT 1,
      failed_reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_login_user ON login_attempts(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_login_ip ON login_attempts(ip_address);
    CREATE INDEX IF NOT EXISTS idx_login_failed ON login_attempts(user_id, success, created_at);

    CREATE TABLE IF NOT EXISTS suspicious_alerts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      attempt_id TEXT,
      level TEXT NOT NULL CHECK (level IN ('low','medium','high','critical')),
      score INTEGER NOT NULL,
      reasons TEXT NOT NULL DEFAULT '[]',
      details TEXT,
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','acknowledged','dismissed','confirmed_fraud')),
      acknowledged_by TEXT,
      acknowledged_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alert_user ON suspicious_alerts(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_alert_level ON suspicious_alerts(level, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alert_status ON suspicious_alerts(status, created_at DESC);
  `);
}

function rowToAlert(r: any): SuspiciousAlert {
  return r as SuspiciousAlert;
}

function rowToAttempt(r: any): LoginAttempt {
  return r as LoginAttempt;
}

// ============================================================
// Login attempt recording
// ============================================================

export function recordLoginAttempt(input: EvaluateInput): LoginAttempt {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO login_attempts
      (id, user_id, ip_address, user_agent, device_label, device_type,
       country, city, success, failed_reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.user_id,
    input.ip_address ?? null, input.user_agent ?? null,
    input.device_label ?? null, input.device_type ?? null,
    input.country ?? null, input.city ?? null,
    input.success === false ? 0 : 1,
    input.failed_reason ?? null,
    now,
  );

  return getAttempt(id)!;
}

export function getAttempt(id: string): LoginAttempt | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM login_attempts WHERE id = ?').get(id) as any;
  return r ? rowToAttempt(r) : null;
}

export interface ListAttemptsOpts {
  user_id?: string;
  success_only?: boolean;
  failed_only?: boolean;
  limit?: number;
  offset?: number;
}

export function listLoginAttempts(opts: ListAttemptsOpts = {}): { attempts: LoginAttempt[]; total: number } {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];

  if (opts.user_id) { where.push('user_id = ?'); params.push(opts.user_id); }
  if (opts.success_only) where.push('success = 1');
  if (opts.failed_only) where.push('success = 0');

  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);

  const total = (db.prepare(`SELECT COUNT(*) as c FROM login_attempts ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT * FROM login_attempts ${w} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
  ).all(...params) as any[];

  return { attempts: rows.map(rowToAttempt), total };
}

// ============================================================
// Detection logic
// ============================================================

/** Haversine distance (km) between two lat/lon points. */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Rough centroid lat/lon for countries we support. Extend as needed.
const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  BD: [23.685, 90.3563],
  IN: [20.5937, 78.9629],
  PK: [30.3753, 69.3451],
  US: [37.0902, -95.7129],
  GB: [55.3781, -3.436],
  CA: [56.1304, -106.3468],
  AU: [-25.2744, 133.7751],
  DE: [51.1657, 10.4515],
  FR: [46.2276, 2.2137],
  JP: [36.2048, 138.2529],
  CN: [35.8617, 104.1954],
  SG: [1.3521, 103.8198],
  AE: [23.4241, 53.8478],
  SA: [23.8859, 45.0792],
  MY: [4.2105, 101.9758],
  TH: [15.87, 100.9925],
};

function countryDistanceKm(c1: string, c2: string): number | null {
  const a = COUNTRY_CENTROIDS[c1.toUpperCase()];
  const b = COUNTRY_CENTROIDS[c2.toUpperCase()];
  if (!a || !b) return null;
  return haversineKm(a[0], a[1], b[0], b[1]);
}

interface PriorHistory {
  last_device_label: string | null;
  last_ip: string | null;
  last_country: string | null;
  last_success_at: string | null;
  recent_failures_10min: number;
  known_devices: Set<string>;
  known_ips: Set<string>;
  known_countries: Set<string>;
}

function gatherHistory(userId: string, excludeAttemptId?: string): PriorHistory {
  const db = getDb();
  const excludeClause = excludeAttemptId ? "AND id != ?" : "";
  const baseParams = excludeAttemptId ? [userId, excludeAttemptId] : [userId];

  // Known distinct values (any prior successful login, excluding current attempt)
  const devices = new Set<string>();
  const ips = new Set<string>();
  const countries = new Set<string>();

  for (const r of db.prepare(
    `SELECT DISTINCT device_label FROM login_attempts WHERE user_id = ? AND success = 1 AND device_label IS NOT NULL ${excludeClause}`
  ).all(...baseParams) as Array<{ device_label: string }>) {
    if (r.device_label) devices.add(r.device_label);
  }
  for (const r of db.prepare(
    `SELECT DISTINCT ip_address FROM login_attempts WHERE user_id = ? AND success = 1 AND ip_address IS NOT NULL ${excludeClause}`
  ).all(...baseParams) as Array<{ ip_address: string }>) {
    if (r.ip_address) ips.add(r.ip_address);
  }
  for (const r of db.prepare(
    `SELECT DISTINCT country FROM login_attempts WHERE user_id = ? AND success = 1 AND country IS NOT NULL ${excludeClause}`
  ).all(...baseParams) as Array<{ country: string }>) {
    if (r.country) countries.add(r.country);
  }

  // Last successful login (excluding current attempt)
  const last = db.prepare(
    `SELECT device_label, ip_address, country, created_at FROM login_attempts WHERE user_id = ? AND success = 1 ${excludeClause} ORDER BY created_at DESC LIMIT 1`
  ).get(...baseParams) as { device_label: string | null; ip_address: string | null; country: string | null; created_at: string } | undefined;

  // Recent failures (last 10 minutes)
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const recentFailures = (db.prepare(
    "SELECT COUNT(*) as c FROM login_attempts WHERE user_id = ? AND success = 0 AND created_at >= ?"
  ).get(userId, cutoff) as { c: number }).c;

  return {
    last_device_label: last?.device_label ?? null,
    last_ip: last?.ip_address ?? null,
    last_country: last?.country ?? null,
    last_success_at: last?.created_at ?? null,
    recent_failures_10min: recentFailures,
    known_devices: devices,
    known_ips: ips,
    known_countries: countries,
  };
}

export interface EvaluateResult {
  attempt: LoginAttempt;
  suspicion_score: number;
  level: SuspicionLevel;
  reasons: SuspicionReason[];
  alert: SuspiciousAlert | null;
}

function scoreToLevel(score: number): SuspicionLevel {
  if (score >= 70) return 'critical';
  if (score >= 45) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

export function evaluateLogin(input: EvaluateInput): EvaluateResult {
  const attempt = recordLoginAttempt(input);
  const history = gatherHistory(input.user_id, attempt.id);

  const reasons: SuspicionReason[] = [];
  let score = 0;

  // New device
  if (input.device_label && !history.known_devices.has(input.device_label) && history.known_devices.size > 0) {
    reasons.push('new_device');
    score += REASON_WEIGHTS.new_device;
  }

  // New IP
  if (input.ip_address && !history.known_ips.has(input.ip_address) && history.known_ips.size > 0) {
    reasons.push('new_ip');
    score += REASON_WEIGHTS.new_ip;
  }

  // New country
  if (input.country && !history.known_countries.has(input.country) && history.known_countries.size > 0) {
    reasons.push('new_country');
    score += REASON_WEIGHTS.new_country;
  }

  // Impossible travel: previous country vs current, within short window
  if (input.country && history.last_country && input.country !== history.last_country && history.last_success_at) {
    const distKm = countryDistanceKm(history.last_country, input.country);
    const elapsedMin = (Date.now() - new Date(history.last_success_at).getTime()) / 60_000;
    if (distKm !== null && elapsedMin > 0) {
      // Would need to travel at >900 km/h (commercial jet speed)
      const kmh = (distKm / elapsedMin) * 60;
      if (kmh > 900) {
        reasons.push('impossible_travel');
        score += REASON_WEIGHTS.impossible_travel;
      }
    }
  }

  // Brute force: 5+ failed attempts in 10 min, now success
  if (input.success !== false && history.recent_failures_10min >= 5) {
    reasons.push('brute_force');
    score += REASON_WEIGHTS.brute_force;
  }

  // Country-specific risk (Tor exit, datacenter IP, etc.)
  // Simplified: assume datacenter if UA looks like server-side client
  if (input.user_agent && /curl|python-requests|Go-http|wget|Postman/i.test(input.user_agent)) {
    reasons.push('user_agent_anomaly');
    score += REASON_WEIGHTS.user_agent_anomaly;
  }

  // Cap score at 100
  score = Math.min(score, 100);

  // No alert if user has no history (first login on fresh account)
  const hasHistory = history.known_devices.size + history.known_ips.size + history.known_countries.size > 0;
  const shouldAlert = hasHistory && reasons.length > 0 && score >= 20;

  let alert: SuspiciousAlert | null = null;
  if (shouldAlert) {
    alert = createAlert({
      user_id: input.user_id,
      attempt_id: attempt.id,
      level: scoreToLevel(score),
      score,
      reasons,
      details: {
        ip_address: input.ip_address ?? null,
        country: input.country ?? null,
        city: input.city ?? null,
        device_label: input.device_label ?? null,
        device_type: input.device_type ?? null,
        previous_country: history.last_country,
        previous_device: history.last_device_label,
        recent_failures: history.recent_failures_10min,
      },
    });
  }

  return {
    attempt,
    suspicion_score: score,
    level: scoreToLevel(score),
    reasons,
    alert,
  };
}

// ============================================================
// Alert CRUD
// ============================================================

interface CreateAlertInput {
  user_id: string;
  attempt_id: string | null;
  level: SuspicionLevel;
  score: number;
  reasons: SuspicionReason[];
  details: Record<string, unknown>;
}

export function createAlert(input: CreateAlertInput): SuspiciousAlert {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO suspicious_alerts
      (id, user_id, attempt_id, level, score, reasons, details,
       status, acknowledged_by, acknowledged_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'new', NULL, NULL, ?, ?)
  `).run(
    id, input.user_id, input.attempt_id, input.level, input.score,
    JSON.stringify(input.reasons),
    JSON.stringify(input.details),
    now, now,
  );

  return getAlert(id)!;
}

export function getAlert(id: string): SuspiciousAlert | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM suspicious_alerts WHERE id = ?').get(id) as any;
  return r ? rowToAlert(r) : null;
}

export interface ListAlertsOpts {
  user_id?: string;
  status?: AlertStatus;
  level?: SuspicionLevel;
  limit?: number;
  offset?: number;
}

export function listAlerts(opts: ListAlertsOpts = {}): { alerts: SuspiciousAlert[]; total: number } {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];

  if (opts.user_id) { where.push('user_id = ?'); params.push(opts.user_id); }
  if (opts.status) { where.push('status = ?'); params.push(opts.status); }
  if (opts.level) { where.push('level = ?'); params.push(opts.level); }

  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const total = (db.prepare(`SELECT COUNT(*) as c FROM suspicious_alerts ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT * FROM suspicious_alerts ${w} ORDER BY
      CASE level WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      created_at DESC
     LIMIT ${limit} OFFSET ${offset}`
  ).all(...params) as any[];

  return { alerts: rows.map(rowToAlert), total };
}

export function acknowledgeAlert(id: string, actorId: string | null, newStatus: AlertStatus): SuspiciousAlert {
  if (!VALID_STATUSES.includes(newStatus)) throw new Error(`Invalid status: ${newStatus}`);
  const db = getDb();
  const existing = getAlert(id);
  if (!existing) throw new Error('Alert not found');

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE suspicious_alerts
    SET status = ?, acknowledged_by = ?, acknowledged_at = ?, updated_at = ?
    WHERE id = ?
  `).run(newStatus, actorId ?? null, now, now, id);

  return getAlert(id)!;
}

// ============================================================
// Stats & Cleanup
// ============================================================

export interface SuspiciousStats {
  total_alerts: number;
  by_level: Record<string, number>;
  by_status: Record<string, number>;
  total_attempts: number;
  failed_attempts: number;
  unique_ips: number;
  unique_countries: number;
  window_days: number;
}

export function getSuspiciousStats(windowDays = 30): SuspiciousStats {
  const db = getDb();
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString();

  const totalAlerts = (db.prepare(
    'SELECT COUNT(*) as c FROM suspicious_alerts WHERE created_at >= ?'
  ).get(since) as { c: number }).c;

  const byLevel: Record<string, number> = {};
  for (const r of db.prepare(
    'SELECT level, COUNT(*) as c FROM suspicious_alerts WHERE created_at >= ? GROUP BY level'
  ).all(since) as Array<{ level: string; c: number }>) {
    byLevel[r.level] = r.c;
  }

  const byStatus: Record<string, number> = {};
  for (const r of db.prepare(
    'SELECT status, COUNT(*) as c FROM suspicious_alerts WHERE created_at >= ? GROUP BY status'
  ).all(since) as Array<{ status: string; c: number }>) {
    byStatus[r.status] = r.c;
  }

  const totalAttempts = (db.prepare(
    'SELECT COUNT(*) as c FROM login_attempts WHERE created_at >= ?'
  ).get(since) as { c: number }).c;

  const failedAttempts = (db.prepare(
    'SELECT COUNT(*) as c FROM login_attempts WHERE success = 0 AND created_at >= ?'
  ).get(since) as { c: number }).c;

  const uniqueIps = (db.prepare(
    'SELECT COUNT(DISTINCT ip_address) as c FROM login_attempts WHERE created_at >= ? AND ip_address IS NOT NULL'
  ).get(since) as { c: number }).c;

  const uniqueCountries = (db.prepare(
    'SELECT COUNT(DISTINCT country) as c FROM login_attempts WHERE created_at >= ? AND country IS NOT NULL'
  ).get(since) as { c: number }).c;

  return {
    total_alerts: totalAlerts,
    by_level: byLevel,
    by_status: byStatus,
    total_attempts: totalAttempts,
    failed_attempts: failedAttempts,
    unique_ips: uniqueIps,
    unique_countries: uniqueCountries,
    window_days: windowDays,
  };
}

export function pruneOldAttempts(olderThanDays = 90): { pruned: number } {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000).toISOString();
  const info = db.prepare('DELETE FROM login_attempts WHERE created_at < ?').run(cutoff);
  return { pruned: info.changes };
}

export function pruneOldAlerts(olderThanDays = 365): { pruned: number } {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000).toISOString();
  const info = db.prepare(
    "DELETE FROM suspicious_alerts WHERE created_at < ? AND status IN ('dismissed','confirmed_fraud')"
  ).run(cutoff);
  return { pruned: info.changes };
}
