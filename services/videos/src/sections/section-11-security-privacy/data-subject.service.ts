// melodyflix videos - Section 11.10 Data Export/Delete (GDPR/CCPA-style)
// Users can request: (1) export of their personal data, (2) deletion of account.
// Deletion has a grace period (default 14 days) — user can cancel.
// Admin can process, approve, or reject requests.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type RequestType = 'export' | 'delete';
export type RequestStatus = 'pending' | 'processing' | 'ready' | 'completed' | 'rejected' | 'cancelled' | 'expired';
export type ExportFormat = 'json' | 'csv' | 'zip';

export interface DataSubjectRequest {
  id: string;
  user_id: string;
  request_type: RequestType;
  status: RequestStatus;
  reason: string | null;
  export_format: ExportFormat | null;
  download_url: string | null;
  download_expires_at: string | null;
  grace_until: string | null;
  processed_by: string | null;
  rejection_reason: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RequestEvent {
  id: string;
  request_id: string;
  actor_id: string | null;
  event_type: string;
  note: string | null;
  metadata: string | null;
  created_at: string;
}

const VALID_TYPES: RequestType[] = ['export', 'delete'];
const VALID_STATUSES: RequestStatus[] = ['pending', 'processing', 'ready', 'completed', 'rejected', 'cancelled', 'expired'];
const VALID_FORMATS: ExportFormat[] = ['json', 'csv', 'zip'];

const DEFAULT_GRACE_DAYS = 14;
const EXPORT_LINK_TTL_HOURS = 72;

export function ensureDataSubjectSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS data_subject_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      request_type TEXT NOT NULL CHECK (request_type IN ('export','delete')),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','processing','ready','completed','rejected','cancelled','expired')),
      reason TEXT,
      export_format TEXT CHECK (export_format IN ('json','csv','zip') OR export_format IS NULL),
      download_url TEXT,
      download_expires_at TEXT,
      grace_until TEXT,
      processed_by TEXT,
      rejection_reason TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dsr_user ON data_subject_requests(user_id);
    CREATE INDEX IF NOT EXISTS idx_dsr_status ON data_subject_requests(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_dsr_type ON data_subject_requests(request_type);
    CREATE INDEX IF NOT EXISTS idx_dsr_grace ON data_subject_requests(grace_until);

    CREATE TABLE IF NOT EXISTS request_events (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      actor_id TEXT,
      event_type TEXT NOT NULL,
      note TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_request_event_req ON request_events(request_id);
    CREATE INDEX IF NOT EXISTS idx_request_event_created ON request_events(created_at);
  `);
}

function rowToRequest(r: any): DataSubjectRequest {
  return r as DataSubjectRequest;
}

function logEvent(requestId: string, actorId: string | null, eventType: string, note?: string | null, metadata?: Record<string, unknown> | null): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO request_events (id, request_id, actor_id, event_type, note, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), requestId, actorId, eventType,
    note ?? null, metadata ? JSON.stringify(metadata) : null,
    new Date().toISOString(),
  );
}

function computeGraceUntil(days: number): string {
  return new Date(Date.now() + days * 86400_000).toISOString();
}

function computeDownloadExpiry(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

// ============================================================
// Requests CRUD
// ============================================================

export interface CreateRequestInput {
  user_id: string;
  request_type: RequestType;
  reason?: string | null;
  export_format?: ExportFormat;
  grace_days?: number;
}

/** Block duplicate open requests of same type per user. */
function hasOpenRequest(userId: string, type: RequestType): boolean {
  const db = getDb();
  const r = db.prepare(`
    SELECT id FROM data_subject_requests
    WHERE user_id = ? AND request_type = ?
      AND status IN ('pending','processing','ready')
    LIMIT 1
  `).get(userId, type) as { id: string } | undefined;
  return !!r;
}

export function createRequest(input: CreateRequestInput): DataSubjectRequest {
  if (!input.user_id) throw new Error('user_id is required');
  if (!VALID_TYPES.includes(input.request_type)) throw new Error(`Invalid request_type: ${input.request_type}`);
  if (input.reason !== undefined && input.reason !== null && input.reason.length > 1000) {
    throw new Error('reason max 1000 chars');
  }
  if (input.request_type === 'export' && input.export_format && !VALID_FORMATS.includes(input.export_format)) {
    throw new Error(`Invalid export_format: ${input.export_format}`);
  }

  if (hasOpenRequest(input.user_id, input.request_type)) {
    throw new Error(`An open ${input.request_type} request already exists for this user`);
  }

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  const exportFormat = input.request_type === 'export' ? (input.export_format ?? 'json') : null;
  const graceDays = input.grace_days ?? DEFAULT_GRACE_DAYS;
  const graceUntil = input.request_type === 'delete' ? computeGraceUntil(graceDays) : null;

  db.prepare(`
    INSERT INTO data_subject_requests
      (id, user_id, request_type, status, reason, export_format, download_url,
       download_expires_at, grace_until, processed_by, rejection_reason,
       completed_at, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?, NULL, NULL, ?, NULL, NULL, NULL, ?, ?)
  `).run(
    id, input.user_id, input.request_type, input.reason ?? null,
    exportFormat, graceUntil, now, now,
  );

  logEvent(id, input.user_id, 'created', `Request created: ${input.request_type}`, {
    request_type: input.request_type,
    export_format: exportFormat,
    grace_days: input.request_type === 'delete' ? graceDays : null,
  });

  return getRequest(id)!;
}

export function getRequest(id: string): DataSubjectRequest | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM data_subject_requests WHERE id = ?').get(id) as any;
  return r ? rowToRequest(r) : null;
}

export interface ListRequestsOpts {
  user_id?: string;
  request_type?: RequestType;
  status?: RequestStatus;
  limit?: number;
  offset?: number;
}

export function listRequests(opts: ListRequestsOpts = {}): { requests: DataSubjectRequest[]; total: number } {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];

  if (opts.user_id) { where.push('user_id = ?'); params.push(opts.user_id); }
  if (opts.request_type) { where.push('request_type = ?'); params.push(opts.request_type); }
  if (opts.status) { where.push('status = ?'); params.push(opts.status); }

  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const total = (db.prepare(`SELECT COUNT(*) as c FROM data_subject_requests ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT * FROM data_subject_requests ${w} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
  ).all(...params) as any[];

  return { requests: rows.map(rowToRequest), total };
}

export function listRequestEvents(requestId: string): RequestEvent[] {
  const db = getDb();
  return db.prepare('SELECT * FROM request_events WHERE request_id = ? ORDER BY created_at ASC')
    .all(requestId) as RequestEvent[];
}

// ============================================================
// State transitions
// ============================================================

const TERMINAL_STATUSES: RequestStatus[] = ['completed', 'rejected', 'cancelled', 'expired'];

function isTerminal(s: RequestStatus): boolean {
  return TERMINAL_STATUSES.includes(s);
}

interface UpdateFields {
  status?: RequestStatus;
  download_url?: string | null;
  download_expires_at?: string | null;
  processed_by?: string | null;
  rejection_reason?: string | null;
  completed_at?: string | null;
}

function applyUpdate(id: string, patch: UpdateFields, actorId: string | null, eventType: string, note?: string | null, metadata?: Record<string, unknown>): DataSubjectRequest {
  const db = getDb();
  const existing = getRequest(id);
  if (!existing) throw new Error('Request not found');
  if (isTerminal(existing.status) && patch.status && isTerminal(patch.status)) {
    throw new Error(`Request already in terminal status: ${existing.status}`);
  }

  const fields: string[] = [];
  const params: any[] = [];

  if (patch.status !== undefined) { fields.push('status = ?'); params.push(patch.status); }
  if (patch.download_url !== undefined) { fields.push('download_url = ?'); params.push(patch.download_url); }
  if (patch.download_expires_at !== undefined) { fields.push('download_expires_at = ?'); params.push(patch.download_expires_at); }
  if (patch.processed_by !== undefined) { fields.push('processed_by = ?'); params.push(patch.processed_by); }
  if (patch.rejection_reason !== undefined) { fields.push('rejection_reason = ?'); params.push(patch.rejection_reason); }
  if (patch.completed_at !== undefined) { fields.push('completed_at = ?'); params.push(patch.completed_at); }

  if (fields.length === 0) return existing;

  fields.push('updated_at = ?'); params.push(new Date().toISOString());
  params.push(id);

  db.prepare(`UPDATE data_subject_requests SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  logEvent(id, actorId, eventType, note ?? null, metadata ?? null);

  return getRequest(id)!;
}

/** User cancels their own pending request. */
export function cancelRequest(id: string, userId: string): DataSubjectRequest {
  const existing = getRequest(id);
  if (!existing) throw new Error('Request not found');
  if (existing.user_id !== userId) throw new Error('Not your request');
  if (existing.status !== 'pending') throw new Error(`Cannot cancel request in status ${existing.status}`);

  return applyUpdate(id, { status: 'cancelled', completed_at: new Date().toISOString() },
    userId, 'cancelled', 'Cancelled by user');
}

/** Admin marks as processing. */
export function startProcessing(id: string, adminId: string): DataSubjectRequest {
  const existing = getRequest(id);
  if (!existing) throw new Error('Request not found');
  if (existing.status !== 'pending') throw new Error(`Cannot start processing from status ${existing.status}`);

  return applyUpdate(id, { status: 'processing', processed_by: adminId },
    adminId, 'processing', 'Processing started');
}

/** Admin marks export as ready (provides download URL). */
export function markExportReady(id: string, adminId: string, downloadUrl: string): DataSubjectRequest {
  const existing = getRequest(id);
  if (!existing) throw new Error('Request not found');
  if (existing.request_type !== 'export') throw new Error('Not an export request');
  if (existing.status !== 'processing') throw new Error(`Expected processing status, got ${existing.status}`);

  const expiresAt = computeDownloadExpiry(EXPORT_LINK_TTL_HOURS);
  return applyUpdate(id, {
    status: 'ready',
    download_url: downloadUrl,
    download_expires_at: expiresAt,
  }, adminId, 'export_ready', 'Export ready for download', { download_url: downloadUrl, expires_at: expiresAt });
}

/** Admin rejects request (with reason). */
export function rejectRequest(id: string, adminId: string, reason: string): DataSubjectRequest {
  const existing = getRequest(id);
  if (!existing) throw new Error('Request not found');
  if (isTerminal(existing.status)) throw new Error(`Request already ${existing.status}`);
  if (!reason || reason.trim().length < 5 || reason.length > 1000) {
    throw new Error('reason must be 5-1000 chars');
  }

  return applyUpdate(id, {
    status: 'rejected',
    rejection_reason: reason.trim(),
    processed_by: adminId,
    completed_at: new Date().toISOString(),
  }, adminId, 'rejected', `Rejected: ${reason.trim()}`);
}

/** User marks export download as complete (or admin does). */
export function completeRequest(id: string, actorId: string | null): DataSubjectRequest {
  const existing = getRequest(id);
  if (!existing) throw new Error('Request not found');
  if (existing.status !== 'ready' && existing.status !== 'processing') {
    throw new Error(`Cannot complete from status ${existing.status}`);
  }

  return applyUpdate(id, { status: 'completed', completed_at: new Date().toISOString() },
    actorId, 'completed', 'Request completed');
}

// ============================================================
// Grace period & auto-expiry
// ============================================================

/** Cancel a delete request during grace period. */
export function undoDelete(id: string, userId: string): DataSubjectRequest {
  const existing = getRequest(id);
  if (!existing) throw new Error('Request not found');
  if (existing.user_id !== userId) throw new Error('Not your request');
  if (existing.request_type !== 'delete') throw new Error('Not a delete request');
  if (existing.status === 'completed') throw new Error('Cannot undo — deletion already executed');
  if (existing.status === 'cancelled') return existing;

  return applyUpdate(id, {
    status: 'cancelled',
    completed_at: new Date().toISOString(),
  }, userId, 'delete_undone', 'Deletion cancelled by user during grace period');
}

/** Find delete requests whose grace period has passed (ready to execute). */
export function listDueDeletions(): DataSubjectRequest[] {
  const db = getDb();
  const now = new Date().toISOString();
  return db.prepare(`
    SELECT * FROM data_subject_requests
    WHERE request_type = 'delete'
      AND status IN ('pending','processing')
      AND grace_until IS NOT NULL
      AND grace_until <= ?
    ORDER BY grace_until ASC
  `).all(now) as DataSubjectRequest[];
}

/** Expire export download links past their expiry. */
export function expireOldExports(): { expired: number } {
  const db = getDb();
  const now = new Date().toISOString();
  const rows = db.prepare(`
    SELECT id, user_id FROM data_subject_requests
    WHERE request_type = 'export'
      AND status = 'ready'
      AND download_expires_at IS NOT NULL
      AND download_expires_at <= ?
  `).all(now) as Array<{ id: string; user_id: string }>;

  if (rows.length === 0) return { expired: 0 };

  const stmt = db.prepare("UPDATE data_subject_requests SET status = 'expired', updated_at = ? WHERE id = ?");
  const nowIso = new Date().toISOString();
  for (const r of rows) {
    stmt.run(nowIso, r.id);
    logEvent(r.id, null, 'expired', 'Export link expired before download');
  }
  return { expired: rows.length };
}

// ============================================================
// Data export collection (metadata only — actual archive by storage layer)
// ============================================================

export interface ExportManifest {
  user_id: string;
  generated_at: string;
  tables: Array<{ table: string; row_count: number }>;
}

/** Scan user's data across tables (read-only count, no PII fetched). */
export function collectExportManifest(userId: string): ExportManifest {
  const db = getDb();

  // Tables holding user-specific rows (extend as schema grows)
  const candidateTables: Array<{ table: string; column: string }> = [
    { table: 'user_sessions', column: 'user_id' },
    { table: 'login_attempts', column: 'user_id' },
    { table: 'suspicious_alerts', column: 'user_id' },
    { table: 'appeals', column: 'user_id' },
    { table: 'sync_devices', column: 'user_id' },
    { table: 'sync_changes', column: 'user_id' },
    { table: 'video_history', column: 'user_id' },
    { table: 'video_likes', column: 'user_id' },
    { table: 'user_preferences', column: 'user_id' },
  ];

  const tables: Array<{ table: string; row_count: number }> = [];
  for (const t of candidateTables) {
    try {
      const exists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).get(t.table) as { name: string } | undefined;
      if (!exists) continue;

      const c = (db.prepare(`SELECT COUNT(*) as c FROM ${t.table} WHERE ${t.column} = ?`).get(userId) as { c: number }).c;
      tables.push({ table: t.table, row_count: c });
    } catch {
      // table or column missing — skip
    }
  }

  return {
    user_id: userId,
    generated_at: new Date().toISOString(),
    tables,
  };
}

// ============================================================
// Stats
// ============================================================

export interface RequestStats {
  total: number;
  by_type: Record<string, number>;
  by_status: Record<string, number>;
  pending_older_than_7d: number;
  due_deletions: number;
  window_days: number;
}

export function getRequestStats(windowDays = 30): RequestStats {
  const db = getDb();
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();

  const total = (db.prepare(
    'SELECT COUNT(*) as c FROM data_subject_requests WHERE created_at >= ?'
  ).get(since) as { c: number }).c;

  const byType: Record<string, number> = {};
  for (const r of db.prepare(
    'SELECT request_type, COUNT(*) as c FROM data_subject_requests WHERE created_at >= ? GROUP BY request_type'
  ).all(since) as Array<{ request_type: string; c: number }>) {
    byType[r.request_type] = r.c;
  }

  const byStatus: Record<string, number> = {};
  for (const r of db.prepare(
    'SELECT status, COUNT(*) as c FROM data_subject_requests WHERE created_at >= ? GROUP BY status'
  ).all(since) as Array<{ status: string; c: number }>) {
    byStatus[r.status] = r.c;
  }

  const pendingOld = (db.prepare(`
    SELECT COUNT(*) as c FROM data_subject_requests
    WHERE status = 'pending' AND created_at < ?
  `).get(sevenDaysAgo) as { c: number }).c;

  const dueDeletions = (db.prepare(`
    SELECT COUNT(*) as c FROM data_subject_requests
    WHERE request_type = 'delete'
      AND status IN ('pending','processing')
      AND grace_until IS NOT NULL
      AND grace_until <= ?
  `).get(new Date().toISOString()) as { c: number }).c;

  return {
    total,
    by_type: byType,
    by_status: byStatus,
    pending_older_than_7d: pendingOld,
    due_deletions: dueDeletions,
    window_days: windowDays,
  };
}

export function pruneOldRequests(olderThanDays = 730): { pruned: number } {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000).toISOString();
  const info = db.prepare(
    "DELETE FROM data_subject_requests WHERE status IN ('completed','rejected','cancelled','expired') AND updated_at < ?"
  ).run(cutoff);
  return { pruned: info.changes };
}
