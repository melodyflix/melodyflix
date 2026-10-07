// melodyflix videos - Section 18 Video Management
// Covers 18.3 Draft, 18.4 Schedule, 18.10 Auto-Delete, 18.11 Folders,
// 18.12 Bulk Edit, 18.13 Mass Delete, 18.14 Archive.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type VideoStatus = 'draft' | 'scheduled' | 'published' | 'archived' | 'deleted';
export type ArchiveReason = 'manual' | 'auto_age' | 'storage_pressure';
export type BulkEditField = 'title' | 'description' | 'category' | 'visibility' | 'tags' | 'status';

export function ensureVideoManagementSchema(): void {
  const db = getDb();
  db.exec(`
    -- 18.3 Draft state + 18.4 Schedule + 18.14 Archive sidecar metadata
    CREATE TABLE IF NOT EXISTS video_lifecycle (
      video_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'draft',
      draft_payload TEXT NOT NULL DEFAULT '{}',
      scheduled_at TEXT,
      scheduled_tz TEXT,
      published_at TEXT,
      archived_at TEXT,
      archive_reason TEXT,
      auto_delete_at TEXT,
      delete_after_days INTEGER,
      deleted_at TEXT,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vlife_status ON video_lifecycle(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_vlife_autodelete ON video_lifecycle(auto_delete_at);
    CREATE INDEX IF NOT EXISTS idx_vlife_scheduled ON video_lifecycle(status, scheduled_at);

    -- 18.11 Folders + collections
    CREATE TABLE IF NOT EXISTS video_folders (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      path TEXT NOT NULL DEFAULT '/',
      color TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_folder_owner_parent_name ON video_folders(owner_id, parent_id, name);
    CREATE INDEX IF NOT EXISTS idx_folder_owner ON video_folders(owner_id, parent_id);
    CREATE INDEX IF NOT EXISTS idx_folder_path ON video_folders(owner_id, path);

    CREATE TABLE IF NOT EXISTS video_folder_items (
      id TEXT PRIMARY KEY,
      folder_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      added_at TEXT NOT NULL,
      UNIQUE (folder_id, video_id)
    );
    CREATE INDEX IF NOT EXISTS idx_folder_item_folder ON video_folder_items(folder_id, added_at DESC);
    CREATE INDEX IF NOT EXISTS idx_folder_item_video ON video_folder_items(video_id);

    CREATE TABLE IF NOT EXISTS video_collections (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      is_public INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_coll_owner_name ON video_collections(owner_id, name);

    CREATE TABLE IF NOT EXISTS video_collection_items (
      id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      added_at TEXT NOT NULL,
      UNIQUE (collection_id, video_id)
    );
    CREATE INDEX IF NOT EXISTS idx_coll_item_coll ON video_collection_items(collection_id, position);

    -- 18.12 Bulk Edit jobs
    CREATE TABLE IF NOT EXISTS bulk_edit_jobs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      video_ids TEXT NOT NULL DEFAULT '[]',
      patch TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      processed INTEGER NOT NULL DEFAULT 0,
      succeeded INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      results TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bulkedit_owner ON bulk_edit_jobs(owner_id, created_at DESC);

    -- 18.13 Mass Delete jobs
    CREATE TABLE IF NOT EXISTS mass_delete_jobs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      video_ids TEXT NOT NULL DEFAULT '[]',
      mode TEXT NOT NULL DEFAULT 'soft',
      status TEXT NOT NULL DEFAULT 'pending',
      processed INTEGER NOT NULL DEFAULT 0,
      succeeded INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      results TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_massdel_owner ON mass_delete_jobs(owner_id, created_at DESC);

    -- 18.10 Auto-delete policies
    CREATE TABLE IF NOT EXISTS auto_delete_policies (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      scope_filter TEXT NOT NULL DEFAULT '{}',
      after_days INTEGER NOT NULL,
      apply_to TEXT NOT NULL DEFAULT 'drafts',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_autodel_owner_name ON auto_delete_policies(owner_id, name);
  `);
}

// ================= 18.3 Draft =================
export interface VideoLifecycle {
  video_id: string;
  status: VideoStatus;
  draft_payload: string;
  scheduled_at: string | null;
  scheduled_tz: string | null;
  published_at: string | null;
  archived_at: string | null;
  archive_reason: ArchiveReason | null;
  auto_delete_at: string | null;
  delete_after_days: number | null;
  deleted_at: string | null;
  updated_at: string;
  created_at: string;
}

function ensureLifecycle(videoId: string): VideoLifecycle {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM video_lifecycle WHERE video_id = ?').get(videoId) as VideoLifecycle | undefined;
  if (existing) return existing;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO video_lifecycle (video_id, status, updated_at, created_at)
    VALUES (?, 'draft', ?, ?)`).run(videoId, now, now);
  return db.prepare('SELECT * FROM video_lifecycle WHERE video_id = ?').get(videoId) as VideoLifecycle;
}

export function getLifecycle(videoId: string): VideoLifecycle { return ensureLifecycle(videoId); }

export interface DraftInput {
  draft_payload: Record<string, unknown>;
  delete_after_days?: number | null;
}

export function saveDraft(videoId: string, input: DraftInput): VideoLifecycle {
  ensureLifecycle(videoId);
  const now = new Date().toISOString();
  const autoDelete = input.delete_after_days
    ? new Date(Date.now() + input.delete_after_days * 86400_000).toISOString()
    : null;
  getDb().prepare(`UPDATE video_lifecycle
    SET status = 'draft', draft_payload = ?, delete_after_days = ?, auto_delete_at = ?, updated_at = ?
    WHERE video_id = ?`).run(JSON.stringify(input.draft_payload), input.delete_after_days ?? null,
    autoDelete, now, videoId);
  return getLifecycle(videoId);
}

export function publishFromDraft(videoId: string): VideoLifecycle {
  ensureLifecycle(videoId);
  const now = new Date().toISOString();
  getDb().prepare(`UPDATE video_lifecycle SET status = 'published', published_at = ?, updated_at = ?
    WHERE video_id = ?`).run(now, now, videoId);
  return getLifecycle(videoId);
}

// ================= 18.4 Schedule =================
export interface ScheduleInput {
  scheduled_at: string;
  scheduled_tz?: string | null;
}

export function scheduleVideo(videoId: string, input: ScheduleInput): VideoLifecycle {
  ensureLifecycle(videoId);
  if (new Date(input.scheduled_at) <= new Date()) throw new Error('scheduled_in_past');
  const now = new Date().toISOString();
  getDb().prepare(`UPDATE video_lifecycle
    SET status = 'scheduled', scheduled_at = ?, scheduled_tz = ?, updated_at = ?
    WHERE video_id = ?`).run(input.scheduled_at, input.scheduled_tz ?? null, now, videoId);
  return getLifecycle(videoId);
}

export function cancelSchedule(videoId: string): VideoLifecycle {
  ensureLifecycle(videoId);
  const now = new Date().toISOString();
  getDb().prepare(`UPDATE video_lifecycle SET status = 'draft', scheduled_at = NULL, scheduled_tz = NULL, updated_at = ?
    WHERE video_id = ?`).run(now, videoId);
  return getLifecycle(videoId);
}

export function listDueScheduled(now = new Date().toISOString()): VideoLifecycle[] {
  return getDb().prepare(`SELECT * FROM video_lifecycle
    WHERE status = 'scheduled' AND scheduled_at <= ? ORDER BY scheduled_at ASC`)
    .all(now) as VideoLifecycle[];
}

export function publishDueScheduled(): number {
  const due = listDueScheduled();
  const now = new Date().toISOString();
  const tx = getDb().prepare(`UPDATE video_lifecycle
    SET status = 'published', published_at = ?, updated_at = ? WHERE video_id = ?`);
  for (const v of due) tx.run(now, now, v.video_id);
  return due.length;
}

// ================= 18.14 Archive =================
export interface ArchiveInput {
  reason?: ArchiveReason;
}

export function archiveVideo(videoId: string, input: ArchiveInput = {}): VideoLifecycle {
  ensureLifecycle(videoId);
  const now = new Date().toISOString();
  getDb().prepare(`UPDATE video_lifecycle
    SET status = 'archived', archived_at = ?, archive_reason = ?, updated_at = ?
    WHERE video_id = ?`).run(now, input.reason ?? 'manual', now, videoId);
  return getLifecycle(videoId);
}

export function unarchiveVideo(videoId: string): VideoLifecycle {
  ensureLifecycle(videoId);
  const now = new Date().toISOString();
  getDb().prepare(`UPDATE video_lifecycle
    SET status = 'draft', archived_at = NULL, archive_reason = NULL, updated_at = ?
    WHERE video_id = ?`).run(now, videoId);
  return getLifecycle(videoId);
}

export function listArchived(ownerFilter?: string): VideoLifecycle[] {
  return getDb().prepare("SELECT * FROM video_lifecycle WHERE status = 'archived' ORDER BY archived_at DESC")
    .all() as VideoLifecycle[];
}

// ================= 18.10 Auto-Delete =================
export interface AutoDeletePolicy {
  id: string;
  owner_id: string;
  name: string;
  scope_filter: string;
  after_days: number;
  apply_to: string;
  enabled: number;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAutoDeleteInput {
  owner_id: string;
  name: string;
  after_days: number;
  apply_to?: 'drafts' | 'archived' | 'deleted' | 'all';
  scope_filter?: Record<string, unknown>;
  enabled?: boolean;
}

export function createAutoDeletePolicy(input: CreateAutoDeleteInput): AutoDeletePolicy {
  if (!input.name || input.name.length > 200) throw new Error('invalid_name');
  if (input.after_days < 1 || input.after_days > 3650) throw new Error('invalid_after_days');
  if (!['drafts','archived','deleted','all'].includes(input.apply_to ?? 'drafts')) throw new Error('invalid_apply_to');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`INSERT INTO auto_delete_policies
    (id, owner_id, name, scope_filter, after_days, apply_to, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.owner_id, input.name,
    JSON.stringify(input.scope_filter ?? {}), input.after_days,
    input.apply_to ?? 'drafts', input.enabled === false ? 0 : 1, now, now);
  return getAutoDeletePolicy(id)!;
}

export function getAutoDeletePolicy(id: string): AutoDeletePolicy | null {
  return (getDb().prepare('SELECT * FROM auto_delete_policies WHERE id = ?').get(id) as AutoDeletePolicy | undefined) ?? null;
}

export function listAutoDeletePolicies(ownerId?: string): AutoDeletePolicy[] {
  const db = getDb();
  if (ownerId) {
    return db.prepare('SELECT * FROM auto_delete_policies WHERE owner_id = ? ORDER BY name')
      .all(ownerId) as AutoDeletePolicy[];
  }
  return db.prepare('SELECT * FROM auto_delete_policies ORDER BY name').all() as AutoDeletePolicy[];
}

export function runAutoDeletePolicy(policyId: string): { policy_id: string; matched: number; deleted: number } {
  const pol = getAutoDeletePolicy(policyId);
  if (!pol) throw new Error('policy_not_found');
  if (!pol.enabled) return { policy_id: policyId, matched: 0, deleted: 0 };
  const db = getDb();
  const cutoff = new Date(Date.now() - pol.after_days * 86400_000).toISOString();
  const statuses: string[] = pol.apply_to === 'all' ? ['draft','archived','deleted'] : [pol.apply_to];
  const placeholders = statuses.map(() => '?').join(',');
  const candidates = db.prepare(`SELECT video_id FROM video_lifecycle
    WHERE status IN (${placeholders}) AND updated_at <= ?`).all(...statuses, cutoff) as { video_id: string }[];
  const now = new Date().toISOString();
  const upd = db.prepare(`UPDATE video_lifecycle SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE video_id = ?`);
  for (const c of candidates) upd.run(now, now, c.video_id);
  db.prepare('UPDATE auto_delete_policies SET last_run_at = ?, updated_at = ? WHERE id = ?').run(now, now, policyId);
  return { policy_id: policyId, matched: candidates.length, deleted: candidates.length };
}

// ================= 18.11 Folders / Collections =================
export interface VideoFolder {
  id: string; owner_id: string; parent_id: string | null;
  name: string; path: string; color: string | null;
  created_at: string; updated_at: string;
}

export function createFolder(ownerId: string, name: string, parentId?: string | null, color?: string | null): VideoFolder {
  if (!name || name.length > 120) throw new Error('invalid_name');
  const db = getDb();
  let path = '/';
  if (parentId) {
    const parent = db.prepare('SELECT * FROM video_folders WHERE id = ? AND owner_id = ?').get(parentId, ownerId) as VideoFolder | undefined;
    if (!parent) throw new Error('parent_not_found');
    path = (parent.path === '/' ? '' : parent.path) + '/' + parent.name;
  }
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`INSERT INTO video_folders (id, owner_id, parent_id, name, path, color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, ownerId, parentId ?? null, name, path, color ?? null, now, now);
  return getFolder(id)!;
}

export function getFolder(id: string): VideoFolder | null {
  return (getDb().prepare('SELECT * FROM video_folders WHERE id = ?').get(id) as VideoFolder | undefined) ?? null;
}

export function listFolders(ownerId: string, parentId?: string | null): VideoFolder[] {
  const db = getDb();
  if (parentId === undefined) {
    return db.prepare('SELECT * FROM video_folders WHERE owner_id = ? ORDER BY path, name').all(ownerId) as VideoFolder[];
  }
  return db.prepare('SELECT * FROM video_folders WHERE owner_id = ? AND parent_id IS ? ORDER BY name')
    .all(ownerId, parentId) as VideoFolder[];
}

export function deleteFolder(id: string, actorId: string): boolean {
  const db = getDb();
  const f = getFolder(id);
  if (!f) return false;
  if (f.owner_id !== actorId) throw new Error('owner_only');
  const children = db.prepare('SELECT COUNT(*) AS c FROM video_folders WHERE parent_id = ?').get(id) as { c: number };
  if (children.c > 0) throw new Error('has_subfolders');
  db.prepare('DELETE FROM video_folder_items WHERE folder_id = ?').run(id);
  return db.prepare('DELETE FROM video_folders WHERE id = ?').run(id).changes > 0;
}

export function addVideoToFolder(folderId: string, videoId: string, actorId: string): boolean {
  const f = getFolder(folderId);
  if (!f) throw new Error('folder_not_found');
  if (f.owner_id !== actorId) throw new Error('owner_only');
  const db = getDb();
  const now = new Date().toISOString();
  const r = db.prepare(`INSERT OR IGNORE INTO video_folder_items (id, folder_id, video_id, added_at)
    VALUES (?, ?, ?, ?)`).run(randomUUID(), folderId, videoId, now);
  return r.changes > 0;
}

export function removeVideoFromFolder(folderId: string, videoId: string, actorId: string): boolean {
  const f = getFolder(folderId);
  if (!f) return false;
  if (f.owner_id !== actorId) throw new Error('owner_only');
  return getDb().prepare('DELETE FROM video_folder_items WHERE folder_id = ? AND video_id = ?')
    .run(folderId, videoId).changes > 0;
}

export function listFolderItems(folderId: string): string[] {
  return (getDb().prepare('SELECT video_id FROM video_folder_items WHERE folder_id = ? ORDER BY added_at DESC')
    .all(folderId) as { video_id: string }[]).map(r => r.video_id);
}

// Collections (flat named groups, optional public)
export interface VideoCollection {
  id: string; owner_id: string; name: string; description: string | null;
  is_public: number; created_at: string; updated_at: string;
}

export function createCollection(ownerId: string, name: string, description?: string | null, isPublic = false): VideoCollection {
  if (!name || name.length > 200) throw new Error('invalid_name');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`INSERT INTO video_collections (id, owner_id, name, description, is_public, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, ownerId, name, description ?? null, isPublic ? 1 : 0, now, now);
  return db.prepare('SELECT * FROM video_collections WHERE id = ?').get(id) as VideoCollection;
}

export function listCollections(ownerId?: string, publicOnly = false): VideoCollection[] {
  const db = getDb();
  if (ownerId) return db.prepare('SELECT * FROM video_collections WHERE owner_id = ? ORDER BY name').all(ownerId) as VideoCollection[];
  if (publicOnly) return db.prepare('SELECT * FROM video_collections WHERE is_public = 1 ORDER BY name').all() as VideoCollection[];
  return db.prepare('SELECT * FROM video_collections ORDER BY name').all() as VideoCollection[];
}

export function addVideoToCollection(collectionId: string, videoId: string, actorId: string): boolean {
  const c = getDb().prepare('SELECT * FROM video_collections WHERE id = ?').get(collectionId) as VideoCollection | undefined;
  if (!c) throw new Error('collection_not_found');
  if (c.owner_id !== actorId) throw new Error('owner_only');
  const pos = (getDb().prepare('SELECT COALESCE(MAX(position), -1) AS p FROM video_collection_items WHERE collection_id = ?')
    .get(collectionId) as { p: number }).p + 1;
  const now = new Date().toISOString();
  const r = getDb().prepare(`INSERT OR IGNORE INTO video_collection_items
    (id, collection_id, video_id, position, added_at) VALUES (?, ?, ?, ?, ?)`)
    .run(randomUUID(), collectionId, videoId, pos, now);
  return r.changes > 0;
}

export function listCollectionItems(collectionId: string): string[] {
  return (getDb().prepare('SELECT video_id FROM video_collection_items WHERE collection_id = ? ORDER BY position')
    .all(collectionId) as { video_id: string }[]).map(r => r.video_id);
}


// ================= 18.12 Bulk Edit =================
export interface BulkEditJob {
  id: string; owner_id: string; video_ids: string; patch: string;
  status: string; processed: number; succeeded: number; failed: number;
  results: string; created_at: string; finished_at: string | null;
}

export interface CreateBulkEditInput {
  owner_id: string;
  video_ids: string[];
  patch: Record<string, unknown>;
}

function validatePatch(patch: Record<string, unknown>): void {
  const allowed: BulkEditField[] = ['title','description','category','visibility','tags','status'];
  for (const k of Object.keys(patch)) {
    if (!allowed.includes(k as BulkEditField)) throw new Error('field_not_allowed:' + k);
  }
  if (patch.title !== undefined && (typeof patch.title !== 'string' || (patch.title as string).length > 200)) throw new Error('invalid_title');
  if (patch.status !== undefined && !['draft','scheduled','published','archived','deleted'].includes(patch.status as string)) throw new Error('invalid_status');
}

export function createBulkEditJob(input: CreateBulkEditInput): BulkEditJob {
  if (!Array.isArray(input.video_ids) || input.video_ids.length === 0) throw new Error('video_ids_required');
  if (input.video_ids.length > 5000) throw new Error('too_many_videos');
  validatePatch(input.patch);
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`INSERT INTO bulk_edit_jobs
    (id, owner_id, video_ids, patch, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)`)
    .run(id, input.owner_id, JSON.stringify(input.video_ids), JSON.stringify(input.patch), now);
  return getBulkEditJob(id)!;
}

export function getBulkEditJob(id: string): BulkEditJob | null {
  return (getDb().prepare('SELECT * FROM bulk_edit_jobs WHERE id = ?').get(id) as BulkEditJob | undefined) ?? null;
}

export function runBulkEditJob(id: string, actorId: string): BulkEditJob {
  const job = getBulkEditJob(id);
  if (!job) throw new Error('job_not_found');
  if (job.owner_id !== actorId) throw new Error('owner_only');
  if (job.status !== 'pending') throw new Error('job_not_pending');
  const ids = JSON.parse(job.video_ids) as string[];
  const patch = JSON.parse(job.patch) as Record<string, unknown>;
  const db = getDb();
  const results: { video_id: string; ok: boolean; error?: string }[] = [];
  let ok = 0, fail = 0;
  for (const vid of ids) {
    try {
      // If patch.status given, sync lifecycle; else just record in lifecycle sidecar that we touched
      const lc = ensureLifecycle(vid);
      const fields: string[] = [];
      const args: any[] = [];
      if (patch.status) { fields.push('status = ?'); args.push(patch.status); }
      if (Object.keys(patch).length) {
        // store remaining patch (title/desc/etc.) into draft_payload merge for later application to videos table
        const merged = { ...JSON.parse(lc.draft_payload), ...patch };
        fields.push('draft_payload = ?'); args.push(JSON.stringify(merged));
      }
      fields.push('updated_at = ?'); args.push(new Date().toISOString());
      args.push(vid);
      db.prepare(`UPDATE video_lifecycle SET ${fields.join(', ')} WHERE video_id = ?`).run(...args);
      ok++;
      results.push({ video_id: vid, ok: true });
    } catch (e) {
      fail++;
      results.push({ video_id: vid, ok: false, error: (e as Error).message });
    }
  }
  const finished = new Date().toISOString();
  db.prepare(`UPDATE bulk_edit_jobs SET status = 'completed', processed = ?, succeeded = ?, failed = ?,
    results = ?, finished_at = ? WHERE id = ?`).run(ids.length, ok, fail, JSON.stringify(results), finished, id);
  return getBulkEditJob(id)!;
}

export function listBulkEditJobs(ownerId?: string, limit = 100): BulkEditJob[] {
  const db = getDb();
  if (ownerId) {
    return db.prepare('SELECT * FROM bulk_edit_jobs WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(ownerId, Math.min(Math.max(limit, 1), 500)) as BulkEditJob[];
  }
  return db.prepare('SELECT * FROM bulk_edit_jobs ORDER BY created_at DESC LIMIT ?')
    .all(Math.min(Math.max(limit, 1), 500)) as BulkEditJob[];
}

// ================= 18.13 Mass Delete =================
export interface MassDeleteJob {
  id: string; owner_id: string; video_ids: string;
  mode: string; status: string; processed: number;
  succeeded: number; failed: number; results: string;
  created_at: string; finished_at: string | null;
}

export interface CreateMassDeleteInput {
  owner_id: string;
  video_ids: string[];
  mode?: 'soft' | 'hard';
}

export function createMassDeleteJob(input: CreateMassDeleteInput): MassDeleteJob {
  if (!Array.isArray(input.video_ids) || input.video_ids.length === 0) throw new Error('video_ids_required');
  if (input.video_ids.length > 10000) throw new Error('too_many_videos');
  const mode = input.mode ?? 'soft';
  if (!['soft','hard'].includes(mode)) throw new Error('invalid_mode');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`INSERT INTO mass_delete_jobs
    (id, owner_id, video_ids, mode, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)`)
    .run(id, input.owner_id, JSON.stringify(input.video_ids), mode, now);
  return getMassDeleteJob(id)!;
}

export function getMassDeleteJob(id: string): MassDeleteJob | null {
  return (getDb().prepare('SELECT * FROM mass_delete_jobs WHERE id = ?').get(id) as MassDeleteJob | undefined) ?? null;
}

export function runMassDeleteJob(id: string, actorId: string): MassDeleteJob {
  const job = getMassDeleteJob(id);
  if (!job) throw new Error('job_not_found');
  if (job.owner_id !== actorId) throw new Error('owner_only');
  if (job.status !== 'pending') throw new Error('job_not_pending');
  const ids = JSON.parse(job.video_ids) as string[];
  const db = getDb();
  const now = new Date().toISOString();
  const results: { video_id: string; ok: boolean; mode: string }[] = [];
  let ok = 0, fail = 0;
  for (const vid of ids) {
    try {
      ensureLifecycle(vid);
      if (job.mode === 'hard') {
        db.prepare('DELETE FROM video_lifecycle WHERE video_id = ?').run(vid);
        db.prepare('DELETE FROM video_folder_items WHERE video_id = ?').run(vid);
        db.prepare('DELETE FROM video_collection_items WHERE video_id = ?').run(vid);
      } else {
        db.prepare(`UPDATE video_lifecycle SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE video_id = ?`)
          .run(now, now, vid);
      }
      ok++;
      results.push({ video_id: vid, ok: true, mode: job.mode });
    } catch (e) {
      fail++;
      results.push({ video_id: vid, ok: false, mode: job.mode });
    }
  }
  const finished = new Date().toISOString();
  db.prepare(`UPDATE mass_delete_jobs SET status = 'completed', processed = ?, succeeded = ?, failed = ?,
    results = ?, finished_at = ? WHERE id = ?`).run(ids.length, ok, fail, JSON.stringify(results), finished, id);
  return getMassDeleteJob(id)!;
}

export function listMassDeleteJobs(ownerId?: string, limit = 100): MassDeleteJob[] {
  const db = getDb();
  if (ownerId) {
    return db.prepare('SELECT * FROM mass_delete_jobs WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(ownerId, Math.min(Math.max(limit, 1), 500)) as MassDeleteJob[];
  }
  return db.prepare('SELECT * FROM mass_delete_jobs ORDER BY created_at DESC LIMIT ?')
    .all(Math.min(Math.max(limit, 1), 500)) as MassDeleteJob[];
}

// ================= Stats =================
export interface VideoManagementStats {
  by_status: Record<string, number>;
  total_lifecycles: number;
  drafts: number;
  scheduled: number;
  published: number;
  archived: number;
  deleted: number;
  due_scheduled: number;
  folders: number;
  folder_items: number;
  collections: number;
  collection_items: number;
  bulk_edit_jobs: number;
  mass_delete_jobs: number;
  auto_delete_policies: number;
  auto_delete_policies_enabled: number;
}

export function getVideoManagementStats(): VideoManagementStats {
  const db = getDb();
  const rows = db.prepare('SELECT status, COUNT(*) AS c FROM video_lifecycle GROUP BY status').all() as
    { status: string; c: number }[];
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const r of rows) { byStatus[r.status] = r.c; total += r.c; }
  const due = listDueScheduled().length;
  const folders = db.prepare('SELECT COUNT(*) AS c FROM video_folders').get() as { c: number };
  const folderItems = db.prepare('SELECT COUNT(*) AS c FROM video_folder_items').get() as { c: number };
  const colls = db.prepare('SELECT COUNT(*) AS c FROM video_collections').get() as { c: number };
  const collItems = db.prepare('SELECT COUNT(*) AS c FROM video_collection_items').get() as { c: number };
  const bulkEdit = db.prepare('SELECT COUNT(*) AS c FROM bulk_edit_jobs').get() as { c: number };
  const massDel = db.prepare('SELECT COUNT(*) AS c FROM mass_delete_jobs').get() as { c: number };
  const pol = db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(enabled),0) AS e FROM auto_delete_policies').get() as { c: number; e: number };
  return {
    by_status: byStatus,
    total_lifecycles: total,
    drafts: byStatus.draft ?? 0,
    scheduled: byStatus.scheduled ?? 0,
    published: byStatus.published ?? 0,
    archived: byStatus.archived ?? 0,
    deleted: byStatus.deleted ?? 0,
    due_scheduled: due,
    folders: folders.c,
    folder_items: folderItems.c,
    collections: colls.c,
    collection_items: collItems.c,
    bulk_edit_jobs: bulkEdit.c,
    mass_delete_jobs: massDel.c,
    auto_delete_policies: pol.c,
    auto_delete_policies_enabled: pol.e,
  };
}
