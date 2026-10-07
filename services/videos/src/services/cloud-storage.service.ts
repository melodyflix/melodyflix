// melodyflix videos - Section 49 Cloud Storage Management
// Provider-agnostic abstraction over S3/GCS/Azure/local, storage
// analytics, and automatic archiving policies (hot -> cool -> cold).
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type StorageProvider = 'aws_s3' | 'gcs' | 'azure_blob' | 'local';
export type StorageClass = 'hot' | 'cool' | 'cold' | 'archive';

export function ensureCloudStorageSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_backends (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL
        CHECK (provider IN ('aws_s3','gcs','azure_blob','local')),
      name TEXT NOT NULL,
      bucket TEXT,
      region TEXT,
      endpoint TEXT,
      default_class TEXT NOT NULL DEFAULT 'hot'
        CHECK (default_class IN ('hot','cool','cold','archive')),
      is_default INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      credentials_ref TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_backend_provider ON storage_backends(provider, enabled);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_backend_name ON storage_backends(name);

    CREATE TABLE IF NOT EXISTS storage_objects (
      id TEXT PRIMARY KEY,
      backend_id TEXT NOT NULL,
      key TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      content_type TEXT,
      storage_class TEXT NOT NULL DEFAULT 'hot'
        CHECK (storage_class IN ('hot','cool','cold','archive')),
      etag TEXT,
      url TEXT,
      video_id TEXT,
      owner_id TEXT,
      checksum TEXT,
      archived_at TEXT,
      last_accessed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (backend_id, key)
    );
    CREATE INDEX IF NOT EXISTS idx_sobj_backend ON storage_objects(backend_id, storage_class);
    CREATE INDEX IF NOT EXISTS idx_sobj_video ON storage_objects(video_id);
    CREATE INDEX IF NOT EXISTS idx_sobj_owner ON storage_objects(owner_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sobj_class ON storage_objects(storage_class, created_at);

    CREATE TABLE IF NOT EXISTS storage_analytics_daily (
      date TEXT NOT NULL,
      backend_id TEXT NOT NULL,
      object_count INTEGER NOT NULL DEFAULT 0,
      total_bytes INTEGER NOT NULL DEFAULT 0,
      hot_bytes INTEGER NOT NULL DEFAULT 0,
      cool_bytes INTEGER NOT NULL DEFAULT 0,
      cold_bytes INTEGER NOT NULL DEFAULT 0,
      archive_bytes INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (date, backend_id)
    );

    CREATE TABLE IF NOT EXISTS archiving_policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      from_class TEXT NOT NULL
        CHECK (from_class IN ('hot','cool','cold','archive')),
      to_class TEXT NOT NULL
        CHECK (to_class IN ('hot','cool','cold','archive')),
      older_than_days INTEGER NOT NULL,
      video_category TEXT,
      min_size_bytes INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_archpolicy_enabled ON archiving_policies(enabled, older_than_days);

    CREATE TABLE IF NOT EXISTS archiving_runs (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL,
      triggered_by TEXT,
      status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running','completed','failed')),
      objects_moved INTEGER NOT NULL DEFAULT 0,
      bytes_moved INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_archrun_policy ON archiving_runs(policy_id, started_at DESC);
  `);
}

// ============================================================
// 49.1 / 49.2 / 49.3 Backends (S3, GCS, Azure, local)
// ============================================================

export interface StorageBackend {
  id: string;
  provider: StorageProvider;
  name: string;
  bucket: string | null;
  region: string | null;
  endpoint: string | null;
  default_class: StorageClass;
  is_default: number;
  enabled: number;
  credentials_ref: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateBackendInput {
  provider: StorageProvider;
  name: string;
  bucket?: string | null;
  region?: string | null;
  endpoint?: string | null;
  default_class?: StorageClass;
  is_default?: boolean;
  credentials_ref?: string | null;
}

export function createBackend(input: CreateBackendInput): StorageBackend {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    if (input.is_default) {
      db.prepare('UPDATE storage_backends SET is_default = 0').run();
    }
    db.prepare(`
      INSERT INTO storage_backends
      (id, provider, name, bucket, region, endpoint, default_class, is_default, enabled, credentials_ref, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      id, input.provider, input.name.slice(0, 100),
      input.bucket ?? null, input.region ?? null, input.endpoint ?? null,
      input.default_class ?? 'hot', input.is_default ? 1 : 0,
      input.credentials_ref ?? null, now, now,
    );
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return getBackend(id)!;
}

export function getBackend(id: string): StorageBackend | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM storage_backends WHERE id = ?').get(id) as StorageBackend | undefined) ?? null;
}

export function getDefaultBackend(): StorageBackend | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM storage_backends WHERE is_default = 1 AND enabled = 1 LIMIT 1').get() as StorageBackend | undefined) ?? null;
}

export function listBackends(provider?: StorageProvider): StorageBackend[] {
  const db = getDb();
  if (provider) {
    return db.prepare('SELECT * FROM storage_backends WHERE provider = ? ORDER BY is_default DESC, created_at ASC').all(provider) as StorageBackend[];
  }
  return db.prepare('SELECT * FROM storage_backends ORDER BY is_default DESC, created_at ASC').all() as StorageBackend[];
}

export interface UpdateBackendInput {
  name?: string;
  bucket?: string | null;
  region?: string | null;
  endpoint?: string | null;
  default_class?: StorageClass;
  is_default?: boolean;
  enabled?: boolean;
  credentials_ref?: string | null;
}

export function updateBackend(id: string, patch: UpdateBackendInput): StorageBackend | null {
  const db = getDb();
  if (!getBackend(id)) return null;
  const f: string[] = [];
  const v: unknown[] = [];
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    if (patch.is_default) {
      db.prepare('UPDATE storage_backends SET is_default = 0').run();
      f.push('is_default = 1');
    } else if (patch.is_default === false) {
      f.push('is_default = 0');
    }
    for (const k of ['name','bucket','region','endpoint','default_class','credentials_ref'] as const) {
      if (patch[k] !== undefined) { f.push(`${k} = ?`); v.push(patch[k]); }
    }
    if (patch.enabled !== undefined) { f.push('enabled = ?'); v.push(patch.enabled ? 1 : 0); }
    if (f.length) {
      f.push('updated_at = ?'); v.push(now);
      v.push(id);
      db.prepare(`UPDATE storage_backends SET ${f.join(', ')} WHERE id = ?`).run(...v);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return getBackend(id);
}

export function deleteBackend(id: string): boolean {
  const db = getDb();
  const count = (db.prepare('SELECT COUNT(*) AS c FROM storage_objects WHERE backend_id = ?').get(id) as { c: number }).c;
  if (count > 0) throw new Error('backend_has_objects');
  return db.prepare('DELETE FROM storage_backends WHERE id = ?').run(id).changes > 0;
}

// ============================================================
// Object registry
// ============================================================

export interface StorageObject {
  id: string;
  backend_id: string;
  key: string;
  size_bytes: number;
  content_type: string | null;
  storage_class: StorageClass;
  etag: string | null;
  url: string | null;
  video_id: string | null;
  owner_id: string | null;
  checksum: string | null;
  archived_at: string | null;
  last_accessed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RegisterObjectInput {
  backend_id: string;
  key: string;
  size_bytes: number;
  content_type?: string | null;
  storage_class?: StorageClass;
  etag?: string | null;
  url?: string | null;
  video_id?: string | null;
  owner_id?: string | null;
  checksum?: string | null;
}

export function registerObject(input: RegisterObjectInput): StorageObject {
  const db = getDb();
  const b = getBackend(input.backend_id);
  if (!b) throw new Error('backend_not_found');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO storage_objects
    (id, backend_id, key, size_bytes, content_type, storage_class, etag, url,
     video_id, owner_id, checksum, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.backend_id, input.key.slice(0, 500),
    Math.max(0, Math.floor(input.size_bytes)),
    input.content_type ?? null,
    input.storage_class ?? b.default_class,
    input.etag ?? null, input.url ?? null,
    input.video_id ?? null, input.owner_id ?? null, input.checksum ?? null,
    now, now,
  );
  return db.prepare('SELECT * FROM storage_objects WHERE id = ?').get(id) as StorageObject;
}

export function getObject(backendId: string, key: string): StorageObject | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM storage_objects WHERE backend_id = ? AND key = ?').get(backendId, key) as StorageObject | undefined) ?? null;
}

export function touchAccess(backendId: string, key: string): void {
  const db = getDb();
  db.prepare('UPDATE storage_objects SET last_accessed_at = ?, updated_at = ? WHERE backend_id = ? AND key = ?')
    .run(new Date().toISOString(), new Date().toISOString(), backendId, key);
}

export function deleteObject(backendId: string, key: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM storage_objects WHERE backend_id = ? AND key = ?').run(backendId, key).changes > 0;
}

export interface ListObjectsOpts {
  backend_id?: string;
  video_id?: string;
  owner_id?: string;
  storage_class?: StorageClass;
  limit?: number;
}

export function listObjects(opts: ListObjectsOpts = {}): StorageObject[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
  const cond: string[] = [];
  const v: unknown[] = [];
  if (opts.backend_id) { cond.push('backend_id = ?'); v.push(opts.backend_id); }
  if (opts.video_id) { cond.push('video_id = ?'); v.push(opts.video_id); }
  if (opts.owner_id) { cond.push('owner_id = ?'); v.push(opts.owner_id); }
  if (opts.storage_class) { cond.push('storage_class = ?'); v.push(opts.storage_class); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM storage_objects ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...v, limit) as StorageObject[];
}

export function changeStorageClass(backendId: string, key: string, newClass: StorageClass): StorageObject | null {
  const db = getDb();
  const obj = getObject(backendId, key);
  if (!obj) return null;
  const now = new Date().toISOString();
  const archivedAt = newClass === 'archive' || newClass === 'cold' ? now : null;
  db.prepare(
    'UPDATE storage_objects SET storage_class = ?, archived_at = COALESCE(?, archived_at), updated_at = ? WHERE id = ?'
  ).run(newClass, archivedAt, now, obj.id);
  return getObject(backendId, key);
}

// ============================================================
// 49.4 Storage Analytics
// ============================================================

export interface BackendAnalytics {
  backend_id: string;
  name: string;
  provider: StorageProvider;
  object_count: number;
  total_bytes: number;
  by_class: Record<StorageClass, { count: number; bytes: number }>;
  oldest_object_at: string | null;
  newest_object_at: string | null;
}

export function getBackendAnalytics(backendId: string): BackendAnalytics | null {
  const db = getDb();
  const b = getBackend(backendId);
  if (!b) return null;
  const rows = db.prepare(
    'SELECT storage_class, COUNT(*) AS c, COALESCE(SUM(size_bytes),0) AS bytes FROM storage_objects WHERE backend_id = ? GROUP BY storage_class'
  ).all(backendId) as Array<{ storage_class: StorageClass; c: number; bytes: number }>;
  const by_class: BackendAnalytics['by_class'] = {
    hot: { count: 0, bytes: 0 }, cool: { count: 0, bytes: 0 },
    cold: { count: 0, bytes: 0 }, archive: { count: 0, bytes: 0 },
  };
  let totalBytes = 0, totalCount = 0;
  for (const r of rows) {
    by_class[r.storage_class] = { count: r.c, bytes: r.bytes };
    totalBytes += r.bytes; totalCount += r.c;
  }
  const oldest = db.prepare('SELECT MIN(created_at) AS m FROM storage_objects WHERE backend_id = ?').get(backendId) as { m: string | null };
  const newest = db.prepare('SELECT MAX(created_at) AS m FROM storage_objects WHERE backend_id = ?').get(backendId) as { m: string | null };
  return {
    backend_id: backendId, name: b.name, provider: b.provider,
    object_count: totalCount, total_bytes: totalBytes, by_class,
    oldest_object_at: oldest.m, newest_object_at: newest.m,
  };
}

export interface GlobalStorageStats {
  total_backends: number;
  total_objects: number;
  total_bytes: number;
  by_provider: Record<string, { backends: number; objects: number; bytes: number }>;
  by_class: Record<StorageClass, { objects: number; bytes: number }>;
}

export function getGlobalStorageStats(): GlobalStorageStats {
  const db = getDb();
  const backends = (db.prepare('SELECT COUNT(*) AS c FROM storage_backends WHERE enabled = 1').get() as { c: number }).c;
  const objects = (db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(size_bytes),0) AS b FROM storage_objects').get() as { c: number; b: number });
  const byProv = db.prepare(`
    SELECT b.provider AS provider, COUNT(DISTINCT b.id) AS bc,
           COUNT(o.id) AS oc, COALESCE(SUM(o.size_bytes),0) AS bytes
    FROM storage_backends b
    LEFT JOIN storage_objects o ON o.backend_id = b.id
    GROUP BY b.provider
  `).all() as Array<{ provider: string; bc: number; oc: number; bytes: number }>;
  const by_provider: GlobalStorageStats['by_provider'] = {};
  for (const r of byProv) by_provider[r.provider] = { backends: r.bc, objects: r.oc, bytes: r.bytes };
  const byCls = db.prepare(
    'SELECT storage_class, COUNT(*) AS c, COALESCE(SUM(size_bytes),0) AS b FROM storage_objects GROUP BY storage_class'
  ).all() as Array<{ storage_class: StorageClass; c: number; b: number }>;
  const by_class: GlobalStorageStats['by_class'] = {
    hot: { objects: 0, bytes: 0 }, cool: { objects: 0, bytes: 0 },
    cold: { objects: 0, bytes: 0 }, archive: { objects: 0, bytes: 0 },
  };
  for (const r of byCls) by_class[r.storage_class] = { objects: r.c, bytes: r.b };
  return {
    total_backends: backends, total_objects: objects.c, total_bytes: objects.b,
    by_provider, by_class,
  };
}

export function snapshotAnalytics(date = new Date().toISOString().slice(0, 10)): { snapshots: number } {
  const db = getDb();
  const backends = listBackends();
  const now = new Date().toISOString();
  let n = 0;
  for (const b of backends) {
    const a = getBackendAnalytics(b.id);
    if (!a) continue;
    db.prepare(`
      INSERT INTO storage_analytics_daily
      (date, backend_id, object_count, total_bytes, hot_bytes, cool_bytes, cold_bytes, archive_bytes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date, backend_id) DO UPDATE SET
        object_count = excluded.object_count, total_bytes = excluded.total_bytes,
        hot_bytes = excluded.hot_bytes, cool_bytes = excluded.cool_bytes,
        cold_bytes = excluded.cold_bytes, archive_bytes = excluded.archive_bytes,
        updated_at = excluded.updated_at
    `).run(
      date, b.id, a.object_count, a.total_bytes,
      a.by_class.hot.bytes, a.by_class.cool.bytes, a.by_class.cold.bytes, a.by_class.archive.bytes,
      now,
    );
    n++;
  }
  return { snapshots: n };
}

export interface AnalyticsTrendPoint {
  date: string;
  object_count: number;
  total_bytes: number;
}

export function getAnalyticsTrend(backendId: string, days = 30): AnalyticsTrendPoint[] {
  const db = getDb();
  return db.prepare(
    'SELECT date, object_count, total_bytes FROM storage_analytics_daily WHERE backend_id = ? ORDER BY date DESC LIMIT ?'
  ).all(backendId, Math.min(Math.max(days, 1), 365)) as AnalyticsTrendPoint[];
}

// ============================================================
// 49.5 Automatic Archiving
// ============================================================

export interface ArchivingPolicy {
  id: string;
  name: string;
  description: string | null;
  from_class: StorageClass;
  to_class: StorageClass;
  older_than_days: number;
  video_category: string | null;
  min_size_bytes: number;
  enabled: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePolicyInput {
  name: string;
  description?: string | null;
  from_class: StorageClass;
  to_class: StorageClass;
  older_than_days: number;
  video_category?: string | null;
  min_size_bytes?: number;
}

export function createPolicy(input: CreatePolicyInput, createdBy: string | null): ArchivingPolicy {
  const db = getDb();
  if (input.from_class === input.to_class) throw new Error('from_and_to_class_same');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO archiving_policies
    (id, name, description, from_class, to_class, older_than_days, video_category,
     min_size_bytes, enabled, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(
    id, input.name.slice(0, 100), input.description ?? null,
    input.from_class, input.to_class, Math.max(1, input.older_than_days),
    input.video_category ?? null, Math.max(0, input.min_size_bytes ?? 0),
    createdBy, now, now,
  );
  return db.prepare('SELECT * FROM archiving_policies WHERE id = ?').get(id) as ArchivingPolicy;
}

export function listPolicies(enabledOnly = false): ArchivingPolicy[] {
  const db = getDb();
  if (enabledOnly) return db.prepare('SELECT * FROM archiving_policies WHERE enabled = 1 ORDER BY older_than_days DESC').all() as ArchivingPolicy[];
  return db.prepare('SELECT * FROM archiving_policies ORDER BY created_at DESC').all() as ArchivingPolicy[];
}

export function updatePolicy(id: string, patch: Partial<CreatePolicyInput> & { enabled?: boolean }): ArchivingPolicy | null {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM archiving_policies WHERE id = ?').get(id);
  if (!existing) return null;
  const f: string[] = []; const v: unknown[] = [];
  for (const k of ['name','description','from_class','to_class','older_than_days','video_category','min_size_bytes'] as const) {
    if (patch[k] !== undefined) { f.push(`${k} = ?`); v.push(patch[k]); }
  }
  if (patch.enabled !== undefined) { f.push('enabled = ?'); v.push(patch.enabled ? 1 : 0); }
  if (!f.length) return db.prepare('SELECT * FROM archiving_policies WHERE id = ?').get(id) as ArchivingPolicy;
  f.push('updated_at = ?'); v.push(new Date().toISOString());
  v.push(id);
  db.prepare(`UPDATE archiving_policies SET ${f.join(', ')} WHERE id = ?`).run(...v);
  return db.prepare('SELECT * FROM archiving_policies WHERE id = ?').get(id) as ArchivingPolicy;
}

export function deletePolicy(id: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM archiving_policies WHERE id = ?').run(id).changes > 0;
}

export interface ArchivingRun {
  id: string;
  policy_id: string;
  triggered_by: string | null;
  status: 'running' | 'completed' | 'failed';
  objects_moved: number;
  bytes_moved: number;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface RunArchiveOutcome {
  run: ArchivingRun;
  candidates: number;
}

export function runArchivePolicy(policyId: string, triggeredBy: string | null): RunArchiveOutcome {
  const db = getDb();
  const policy = db.prepare('SELECT * FROM archiving_policies WHERE id = ?').get(policyId) as ArchivingPolicy | undefined;
  if (!policy) throw new Error('policy_not_found');
  if (policy.enabled !== 1) throw new Error('policy_disabled');
  const now = new Date().toISOString();
  const runId = randomUUID();
  db.prepare(`
    INSERT INTO archiving_runs (id, policy_id, triggered_by, status, started_at)
    VALUES (?, ?, ?, 'running', ?)
  `).run(runId, policyId, triggeredBy, now);

  const cutoff = new Date(Date.now() - policy.older_than_days * 86_400_000).toISOString();
  const cond: string[] = ['storage_class = ?', 'created_at <= ?', 'size_bytes >= ?'];
  const v: unknown[] = [policy.from_class, cutoff, policy.min_size_bytes];
  if (policy.video_category) {
    cond.push("video_id IN (SELECT id FROM videos WHERE category = ?)");
    v.push(policy.video_category);
  }
  const candidates = db.prepare(
    `SELECT id FROM storage_objects WHERE ${cond.join(' AND ')}`
  ).all(...v) as Array<{ id: string }>;

  let moved = 0, bytes = 0;
  try {
    const sel = db.prepare(`SELECT id, size_bytes FROM storage_objects WHERE ${cond.join(' AND ')}`);
    const rows = sel.all(...v) as Array<{ id: string; size_bytes: number }>;
    db.exec('BEGIN');
    try {
      const upd = db.prepare('UPDATE storage_objects SET storage_class = ?, archived_at = ?, updated_at = ? WHERE id = ?');
      for (const r of rows) {
        upd.run(policy.to_class, now, now, r.id);
        moved++; bytes += r.size_bytes;
      }
      db.prepare(`
        UPDATE archiving_runs SET status = 'completed', objects_moved = ?, bytes_moved = ?, completed_at = ?
        WHERE id = ?
      `).run(moved, bytes, new Date().toISOString(), runId);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  } catch (e) {
    db.prepare("UPDATE archiving_runs SET status = 'failed', error = ?, completed_at = ? WHERE id = ?")
      .run((e as Error).message, new Date().toISOString(), runId);
    throw e;
  }
  return {
    run: db.prepare('SELECT * FROM archiving_runs WHERE id = ?').get(runId) as ArchivingRun,
    candidates: candidates.length,
  };
}

export function listArchiveRuns(policyId?: string, limit = 50): ArchivingRun[] {
  const db = getDb();
  if (policyId) {
    return db.prepare('SELECT * FROM archiving_runs WHERE policy_id = ? ORDER BY started_at DESC LIMIT ?')
      .all(policyId, Math.min(Math.max(limit, 1), 200)) as ArchivingRun[];
  }
  return db.prepare('SELECT * FROM archiving_runs ORDER BY started_at DESC LIMIT ?')
    .all(Math.min(Math.max(limit, 1), 200)) as ArchivingRun[];
}

export function runAllActivePolicies(triggeredBy: string | null): { runs: number; objects_moved: number; bytes_moved: number } {
  const policies = listPolicies(true);
  let runs = 0, objects = 0, bytes = 0;
  for (const p of policies) {
    try {
      const r = runArchivePolicy(p.id, triggeredBy);
      runs++;
      objects += r.run.objects_moved;
      bytes += r.run.bytes_moved;
    } catch { /* skip and continue */ }
  }
  return { runs, objects_moved: objects, bytes_moved: bytes };
}
