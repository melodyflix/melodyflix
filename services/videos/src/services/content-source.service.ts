// melodyflix videos — Auto Content Upload (Section 37)
// 37.9 Content Source Management  37.19 Source Approval  37.20 Copyright Check
// 37.6 News Portal Integration    37.7 RSS/API Fetching   37.8 Scheduled Upload
// 37.13 Duplicate Detection       37.21 Publishing Rules  37.22 Failed Retry
import { randomUUID, createHash } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type SourceType = 'rss' | 'atom' | 'tmdb_list' | 'tmdb_search' | 'manual';
export type SourceStatus = 'pending_approval' | 'active' | 'paused' | 'rejected' | 'error';
export type ContentKind = 'movie' | 'tv' | 'drama' | 'song' | 'news' | 'web_series' | 'podcast' | 'other';
export type PublishPolicy = 'auto_publish' | 'draft_only' | 'requires_approval';
export type FetchJobStatus = 'queued' | 'fetching' | 'importing' | 'completed' | 'failed' | 'skipped_duplicate' | 'rejected';

export interface ContentSource {
  id: string;
  name: string;
  source_type: SourceType;
  status: SourceStatus;
  content_kind: ContentKind;
  url: string;                 // RSS URL or TMDB list URL
  fetch_interval_minutes: number;
  publish_policy: PublishPolicy;
  default_channel_id: string | null;
  auto_tags: string | null;    // JSON array
  auto_category: string | null;
  copyright_check_enabled: number;
  last_fetched_at: string | null;
  next_fetch_at: string | null;
  consecutive_failures: number;
  total_imports: number;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FetchJob {
  id: string;
  source_id: string;
  status: FetchJobStatus;
  external_id: string | null;
  source_url: string | null;
  title: string | null;
  content_hash: string | null;
  video_id: string | null;
  error_message: string | null;
  retry_count: number;
  metadata_json: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

const DEFAULT_FETCH_INTERVAL = 60;   // minutes
const MAX_CONSECUTIVE_FAILURES = 5;

export function ensureContentSourceSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_approval',
      content_kind TEXT NOT NULL DEFAULT 'other',
      url TEXT NOT NULL,
      fetch_interval_minutes INTEGER NOT NULL DEFAULT 60,
      publish_policy TEXT NOT NULL DEFAULT 'draft_only',
      default_channel_id TEXT,
      auto_tags TEXT,
      auto_category TEXT,
      copyright_check_enabled INTEGER NOT NULL DEFAULT 1,
      last_fetched_at TEXT,
      next_fetch_at TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      total_imports INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      approved_by TEXT,
      approved_at TEXT,
      rejection_reason TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cs_status ON content_sources(status);
    CREATE INDEX IF NOT EXISTS idx_cs_next_fetch ON content_sources(next_fetch_at, status);
    CREATE INDEX IF NOT EXISTS idx_cs_kind ON content_sources(content_kind);

    CREATE TABLE IF NOT EXISTS content_fetch_jobs (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      external_id TEXT,
      source_url TEXT,
      title TEXT,
      content_hash TEXT,
      video_id TEXT,
      error_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cfj_source ON content_fetch_jobs(source_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cfj_status ON content_fetch_jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_cfj_hash ON content_fetch_jobs(content_hash);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cfj_dedupe
      ON content_fetch_jobs(source_id, content_hash) WHERE content_hash IS NOT NULL;
  `);
}

// ============================================================
// 37.9 / 37.19 — Content Source management
// ============================================================

const SLUG_RE = /^[a-zA-Z0-9 _\-():./]+$/;

export function createContentSource(input: {
  name: string;
  source_type: SourceType;
  content_kind: ContentKind;
  url: string;
  created_by: string;
  fetch_interval_minutes?: number;
  publish_policy?: PublishPolicy;
  default_channel_id?: string | null;
  auto_tags?: string[];
  auto_category?: string | null;
  copyright_check_enabled?: boolean;
  notes?: string | null;
  auto_approve?: boolean;    // admin shortcut
}): ContentSource {
  const name = (input.name ?? '').trim();
  if (name.length < 1 || name.length > 120) throw new Error('name must be 1-120 chars');
  const url = (input.url ?? '').trim();
  if (url.length < 1 || url.length > 500) throw new Error('url must be 1-500 chars');
  if (!SLUG_RE.test(url)) throw new Error('url contains invalid characters');
  if (input.source_type === 'rss' || input.source_type === 'atom') {
    if (!/^https?:\/\//i.test(url)) throw new Error('RSS/Atom URL must be http(s)');
  }
  if (input.source_type === 'tmdb_list' || input.source_type === 'tmdb_search') {
    if (!/^(https?:\/\/|tmdb:)/i.test(url)) throw new Error('TMDB URL must be https:// or tmdb: prefix');
  }
  const interval = Math.max(5, Math.min(1440, input.fetch_interval_minutes ?? DEFAULT_FETCH_INTERVAL));
  const tags = input.auto_tags && input.auto_tags.length > 0
    ? JSON.stringify(input.auto_tags.slice(0, 20)) : null;

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const status: SourceStatus = input.auto_approve ? 'active' : 'pending_approval';
  const nextFetch = status === 'active' ? new Date(Date.now() + interval * 60_000).toISOString() : null;

  db.prepare(`
    INSERT INTO content_sources
      (id, name, source_type, status, content_kind, url, fetch_interval_minutes,
       publish_policy, default_channel_id, auto_tags, auto_category,
       copyright_check_enabled, last_fetched_at, next_fetch_at,
       consecutive_failures, total_imports, created_by, approved_by, approved_at,
       rejection_reason, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, 0, ?, ?, ?, NULL, ?, ?, ?)
  `).run(
    id, name, input.source_type, status, input.content_kind, url, interval,
    input.publish_policy ?? 'draft_only', input.default_channel_id ?? null,
    tags, input.auto_category ?? null,
    input.copyright_check_enabled === false ? 0 : 1,
    nextFetch, input.created_by,
    input.auto_approve ? input.created_by : null,
    input.auto_approve ? now : null,
    input.notes ?? null, now, now,
  );
  return getContentSource(id)!;
}

export function getContentSource(id: string): ContentSource | null {
  return (getDb().prepare('SELECT * FROM content_sources WHERE id = ?').get(id) as ContentSource | undefined) ?? null;
}

export function listContentSources(opts: {
  status?: SourceStatus;
  content_kind?: ContentKind;
  limit?: number;
  offset?: number;
} = {}): ContentSource[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const filters: string[] = [];
  const params: any[] = [];
  if (opts.status) { filters.push('status = ?'); params.push(opts.status); }
  if (opts.content_kind) { filters.push('content_kind = ?'); params.push(opts.content_kind); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  params.push(limit, offset);
  return db.prepare(
    `SELECT * FROM content_sources ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params) as ContentSource[];
}

export function updateContentSource(id: string, patch: {
  name?: string;
  fetch_interval_minutes?: number;
  publish_policy?: PublishPolicy;
  default_channel_id?: string | null;
  auto_tags?: string[] | null;
  auto_category?: string | null;
  copyright_check_enabled?: boolean;
  notes?: string | null;
}): ContentSource {
  const existing = getContentSource(id);
  if (!existing) throw new Error('Content source not found');
  const db = getDb();
  const fields: string[] = [];
  const params: any[] = [];
  if (patch.name !== undefined) { fields.push('name = ?'); params.push(patch.name.trim()); }
  if (patch.fetch_interval_minutes !== undefined) {
    const v = Math.max(5, Math.min(1440, patch.fetch_interval_minutes));
    fields.push('fetch_interval_minutes = ?'); params.push(v);
  }
  if (patch.publish_policy !== undefined) { fields.push('publish_policy = ?'); params.push(patch.publish_policy); }
  if (patch.default_channel_id !== undefined) { fields.push('default_channel_id = ?'); params.push(patch.default_channel_id); }
  if (patch.auto_tags !== undefined) {
    fields.push('auto_tags = ?');
    params.push(patch.auto_tags === null ? null : JSON.stringify(patch.auto_tags.slice(0, 20)));
  }
  if (patch.auto_category !== undefined) { fields.push('auto_category = ?'); params.push(patch.auto_category); }
  if (patch.copyright_check_enabled !== undefined) {
    fields.push('copyright_check_enabled = ?'); params.push(patch.copyright_check_enabled ? 1 : 0);
  }
  if (patch.notes !== undefined) { fields.push('notes = ?'); params.push(patch.notes); }
  if (fields.length === 0) return existing;
  fields.push('updated_at = ?'); params.push(new Date().toISOString());
  params.push(id);
  db.prepare(`UPDATE content_sources SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getContentSource(id)!;
}

// ============================================================
// 37.19 — Approval workflow
// ============================================================

export function approveSource(id: string, approvedBy: string): ContentSource {
  const src = getContentSource(id);
  if (!src) throw new Error('Content source not found');
  if (src.status !== 'pending_approval') throw new Error(`Cannot approve source in status ${src.status}`);
  const now = new Date().toISOString();
  const nextFetch = new Date(Date.now() + src.fetch_interval_minutes * 60_000).toISOString();
  getDb().prepare(`
    UPDATE content_sources SET status = 'active', approved_by = ?, approved_at = ?,
      rejection_reason = NULL, next_fetch_at = ?, updated_at = ? WHERE id = ?
  `).run(approvedBy, now, nextFetch, now, id);
  return getContentSource(id)!;
}

export function rejectSource(id: string, rejectedBy: string, reason: string): ContentSource {
  const src = getContentSource(id);
  if (!src) throw new Error('Content source not found');
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE content_sources SET status = 'rejected', approved_by = ?,
      rejection_reason = ?, updated_at = ? WHERE id = ?
  `).run(rejectedBy, reason.slice(0, 500), now, id);
  return getContentSource(id)!;
}

export function pauseSource(id: string): ContentSource {
  const src = getContentSource(id);
  if (!src) throw new Error('Content source not found');
  const now = new Date().toISOString();
  getDb().prepare("UPDATE content_sources SET status = 'paused', next_fetch_at = NULL, updated_at = ? WHERE id = ?")
    .run(now, id);
  return getContentSource(id)!;
}

export function resumeSource(id: string): ContentSource {
  const src = getContentSource(id);
  if (!src) throw new Error('Content source not found');
  const now = new Date().toISOString();
  const nextFetch = new Date(Date.now() + src.fetch_interval_minutes * 60_000).toISOString();
  getDb().prepare(
    "UPDATE content_sources SET status = 'active', next_fetch_at = ?, consecutive_failures = 0, updated_at = ? WHERE id = ?"
  ).run(nextFetch, now, id);
  return getContentSource(id)!;
}

export function deleteContentSource(id: string): boolean {
  const info = getDb().prepare('DELETE FROM content_sources WHERE id = ?').run(id);
  return Number(info.changes ?? 0) > 0;
}

// ============================================================
// 37.8 — Fetch scheduling
// ============================================================

export function markSourceFetched(id: string, opts: { success: boolean; importsCount?: number } = { success: true }): void {
  const src = getContentSource(id);
  if (!src) return;
  const now = new Date().toISOString();
  const nextFetch = new Date(Date.now() + src.fetch_interval_minutes * 60_000).toISOString();

  if (opts.success) {
    getDb().prepare(`
      UPDATE content_sources SET last_fetched_at = ?, next_fetch_at = ?,
        consecutive_failures = 0,
        total_imports = total_imports + ?,
        updated_at = ? WHERE id = ?
    `).run(now, nextFetch, opts.importsCount ?? 0, now, id);
  } else {
    const failures = src.consecutive_failures + 1;
    const newStatus: SourceStatus = failures >= MAX_CONSECUTIVE_FAILURES ? 'error' : src.status;
    getDb().prepare(`
      UPDATE content_sources SET last_fetched_at = ?, next_fetch_at = ?,
        consecutive_failures = ?, status = ?, updated_at = ? WHERE id = ?
    `).run(now, failures >= MAX_CONSECUTIVE_FAILURES ? null : nextFetch, failures, newStatus, now, id);
  }
}

/** Returns sources whose next_fetch_at is due (for cron/worker to iterate). */
export function listDueContentSources(limit = 50): ContentSource[] {
  return getDb().prepare(`
    SELECT * FROM content_sources
    WHERE status = 'active' AND next_fetch_at IS NOT NULL AND next_fetch_at <= ?
    ORDER BY next_fetch_at ASC
    LIMIT ?
  `).all(new Date().toISOString(), Math.min(Math.max(limit, 1), 200)) as ContentSource[];
}

// ============================================================
// 37.13 — Duplicate detection (content hash)
// ============================================================

export function computeContentHash(input: {
  title: string;
  source_url?: string | null;
  external_id?: string | null;
}): string {
  // Prefer external_id (strong unique); fallback to normalized title
  const basis = input.external_id
    ? `ext:${input.external_id}`
    : `ttl:${(input.title ?? '').trim().toLowerCase().replace(/\s+/g, ' ')}`;
  return createHash('sha256').update(basis).digest('hex');
}

export function isDuplicateContent(sourceId: string, contentHash: string): boolean {
  const db = getDb();
  const row = db.prepare(
    "SELECT 1 FROM content_fetch_jobs WHERE source_id = ? AND content_hash = ? LIMIT 1"
  ).get(sourceId, contentHash);
  return !!row;
}

/** Global duplicate check across all sources (e.g. same movie from different feeds). */
export function isDuplicateGlobally(contentHash: string): { duplicate: boolean; source_id: string | null; job_id: string | null } {
  const row = getDb().prepare(
    "SELECT source_id, id FROM content_fetch_jobs WHERE content_hash = ? AND status != 'failed' LIMIT 1"
  ).get(contentHash) as { source_id: string; id: string } | undefined;
  return { duplicate: !!row, source_id: row?.source_id ?? null, job_id: row?.id ?? null };
}

// ============================================================
// Fetch jobs
// ============================================================

export function createFetchJob(input: {
  source_id: string;
  external_id?: string | null;
  source_url?: string | null;
  title?: string | null;
  metadata?: Record<string, unknown> | null;
  skip_duplicate_check?: boolean;
}): FetchJob {
  const db = getDb();
  const src = getContentSource(input.source_id);
  if (!src) throw new Error('Content source not found');
  if (src.status !== 'active') throw new Error(`Source is ${src.status}, not active`);

  const contentHash = input.title || input.external_id
    ? computeContentHash({ title: input.title ?? '', external_id: input.external_id, source_url: input.source_url })
    : null;

  // Dedupe check within source
  if (contentHash && !input.skip_duplicate_check && isDuplicateContent(input.source_id, contentHash)) {
    const existing = db.prepare(
      "SELECT * FROM content_fetch_jobs WHERE source_id = ? AND content_hash = ? LIMIT 1"
    ).get(input.source_id, contentHash) as FetchJob;
    return existing;
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO content_fetch_jobs
      (id, source_id, status, external_id, source_url, title, content_hash, video_id,
       error_message, retry_count, metadata_json, started_at, completed_at, created_at)
    VALUES (?, ?, 'queued', ?, ?, ?, ?, NULL, NULL, 0, ?, ?, NULL, ?)
  `).run(id, input.source_id, input.external_id ?? null, input.source_url ?? null,
    input.title ?? null, contentHash,
    input.metadata ? JSON.stringify(input.metadata) : null, now, now);
  return getFetchJob(id)!;
}

export function getFetchJob(id: string): FetchJob | null {
  return (getDb().prepare('SELECT * FROM content_fetch_jobs WHERE id = ?').get(id) as FetchJob | undefined) ?? null;
}

export function listFetchJobs(opts: {
  source_id?: string;
  status?: FetchJobStatus;
  limit?: number;
  offset?: number;
} = {}): FetchJob[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const filters: string[] = [];
  const params: any[] = [];
  if (opts.source_id) { filters.push('source_id = ?'); params.push(opts.source_id); }
  if (opts.status) { filters.push('status = ?'); params.push(opts.status); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  params.push(limit, offset);
  return db.prepare(
    `SELECT * FROM content_fetch_jobs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params) as FetchJob[];
}

function updateJobStatus(id: string, status: FetchJobStatus, extras: Partial<{
  video_id: string | null;
  error_message: string | null;
  metadata_json: string | null;
  completed_at: string | null;
}> = {}): FetchJob {
  const db = getDb();
  const fields: string[] = ['status = ?'];
  const params: any[] = [status];
  if (extras.video_id !== undefined) { fields.push('video_id = ?'); params.push(extras.video_id); }
  if (extras.error_message !== undefined) { fields.push('error_message = ?'); params.push(extras.error_message); }
  if (extras.metadata_json !== undefined) { fields.push('metadata_json = ?'); params.push(extras.metadata_json); }
  if (extras.completed_at !== undefined) { fields.push('completed_at = ?'); params.push(extras.completed_at); }
  params.push(id);
  db.prepare(`UPDATE content_fetch_jobs SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getFetchJob(id)!;
}

export function markJobFetching(id: string): FetchJob {
  return updateJobStatus(id, 'fetching');
}

export function markJobImporting(id: string): FetchJob {
  return updateJobStatus(id, 'importing');
}

export function markJobCompleted(id: string, videoId: string, metadata?: Record<string, unknown>): FetchJob {
  return updateJobStatus(id, 'completed', {
    video_id: videoId,
    completed_at: new Date().toISOString(),
    metadata_json: metadata ? JSON.stringify(metadata) : undefined,
  });
}

export function markJobDuplicate(id: string, note?: string): FetchJob {
  return updateJobStatus(id, 'skipped_duplicate', {
    completed_at: new Date().toISOString(),
    error_message: note ?? null,
  });
}

export function markJobRejected(id: string, reason: string): FetchJob {
  return updateJobStatus(id, 'rejected', {
    completed_at: new Date().toISOString(),
    error_message: reason,
  });
}

export function markJobFailed(id: string, errorMessage: string): FetchJob {
  return updateJobStatus(id, 'failed', {
    completed_at: new Date().toISOString(),
    error_message: errorMessage.slice(0, 1000),
  });
}

// ============================================================
// 37.22 — Failed import retry
// ============================================================

const MAX_RETRIES = 3;

export function listRetryableJobs(limit = 50): FetchJob[] {
  return getDb().prepare(`
    SELECT * FROM content_fetch_jobs
    WHERE status = 'failed' AND retry_count < ?
    ORDER BY created_at ASC
    LIMIT ?
  `).all(MAX_RETRIES, Math.min(Math.max(limit, 1), 200)) as FetchJob[];
}

export function scheduleRetry(id: string): FetchJob {
  const job = getFetchJob(id);
  if (!job) throw new Error('Fetch job not found');
  if (job.status !== 'failed') throw new Error('Only failed jobs can be retried');
  if (job.retry_count >= MAX_RETRIES) throw new Error(`Max retries (${MAX_RETRIES}) exceeded`);

  const db = getDb();
  db.prepare(`
    UPDATE content_fetch_jobs SET status = 'queued', retry_count = retry_count + 1,
      error_message = NULL, completed_at = NULL
    WHERE id = ?
  `).run(id);
  return getFetchJob(id)!;
}

// ============================================================
// 37.14 — Pre-upload quality checks (structure)
// ============================================================

export interface QualityCheckResult {
  passed: boolean;
  warnings: string[];
  errors: string[];
}

export function runQualityCheck(input: {
  title?: string | null;
  source_url?: string | null;
  has_thumbnail?: boolean;
  has_description?: boolean;
  duration_seconds?: number | null;
}): QualityCheckResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!input.title || input.title.trim().length < 3) errors.push('Title missing or too short');
  if (!input.source_url) errors.push('Source URL missing');
  if (!input.has_thumbnail) warnings.push('No thumbnail — using fallback');
  if (!input.has_description) warnings.push('No description');
  if (input.duration_seconds != null && input.duration_seconds < 10) warnings.push('Duration under 10s');
  if (input.duration_seconds != null && input.duration_seconds > 6 * 3600) warnings.push('Duration over 6 hours');

  return { passed: errors.length === 0, warnings, errors };
}

// ============================================================
// 37.20 — Copyright check (structure; hookable to external service)
// ============================================================

export interface CopyrightCheckResult {
  safe: boolean;
  matches: Array<{ source: string; score: number; reference: string | null }>;
  notes: string[];
}

export function runCopyrightCheck(_input: {
  title: string;
  description?: string | null;
  source_url?: string | null;
}): CopyrightCheckResult {
  // Placeholder: in production, wire to a service like Audible Magic,
  // YouTube Content ID, or a fingerprint database. Returns safe by default.
  return { safe: true, matches: [], notes: ['Basic check passed — no external check configured'] };
}

// ============================================================
// 37.21 — Publishing rules
// ============================================================

export interface PublishDecision {
  action: 'publish' | 'draft' | 'reject';
  reason: string;
}

export function decidePublishAction(source: ContentSource, quality: QualityCheckResult, copyright: CopyrightCheckResult): PublishDecision {
  if (!copyright.safe) return { action: 'reject', reason: 'Copyright flagged: ' + copyright.matches.map((m) => m.source).join(', ') };
  if (!quality.passed) return { action: 'reject', reason: 'Quality failed: ' + quality.errors.join('; ') };

  if (source.publish_policy === 'auto_publish') return { action: 'publish', reason: 'Source policy: auto_publish' };
  if (source.publish_policy === 'requires_approval') return { action: 'draft', reason: 'Source policy: requires_approval' };
  return { action: 'draft', reason: 'Source policy: draft_only' };
}

// ============================================================
// 37.10 / 37.11 / 37.12 / 37.16 — Metadata helpers
// ============================================================

export interface ExtractedMetadata {
  title: string;
  description: string | null;
  external_id: string | null;
  release_date: string | null;
  language: string | null;
  thumbnail_url: string | null;
  tags: string[];
  category: string | null;
}

export function applySourceDefaults(metadata: ExtractedMetadata, source: ContentSource): ExtractedMetadata {
  const sourceTags = source.auto_tags
    ? (JSON.parse(source.auto_tags) as string[]).filter((t) => typeof t === 'string')
    : [];
  const mergedTags = Array.from(new Set([...metadata.tags, ...sourceTags])).slice(0, 20);
  return {
    ...metadata,
    tags: mergedTags,
    category: metadata.category ?? source.auto_category,
  };
}

// ============================================================
// Cleanup helper
// ============================================================

export function deleteFetchJob(id: string): boolean {
  const info = getDb().prepare('DELETE FROM content_fetch_jobs WHERE id = ?').run(id);
  return Number(info.changes ?? 0) > 0;
}

export function pruneOldJobs(olderThanDays = 30): number {
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000).toISOString();
  const info = getDb().prepare(`
    DELETE FROM content_fetch_jobs
    WHERE created_at < ? AND status IN ('completed','skipped_duplicate','rejected','failed')
  `).run(cutoff);
  return Number(info.changes ?? 0);
}
