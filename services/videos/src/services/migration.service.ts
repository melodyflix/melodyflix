// melodyflix videos — Content Migration (Section 44)
// 44.1 YouTube Import | 44.2 Vimeo Import
// 44.3 Bulk Migration | 44.4 Metadata Preservation

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type MigrationSource = 'youtube' | 'vimeo';
export type MigrationStatus =
  | 'pending'
  | 'fetching'
  | 'ready'
  | 'importing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface MigrationJob {
  id: string;
  owner_id: string;
  source: MigrationSource;
  source_url: string;
  source_video_id: string;
  title: string | null;
  description: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  author: string | null;
  status: MigrationStatus;
  error_message: string | null;
  metadata_json: string | null;
  channel_id: string | null;
  video_id: string | null;
  progress: number;
  created_at: string;
  updated_at: string;
}

export function ensureMigrationSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_jobs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('youtube','vimeo')),
      source_url TEXT NOT NULL,
      source_video_id TEXT NOT NULL,
      title TEXT,
      description TEXT,
      thumbnail_url TEXT,
      duration_seconds REAL,
      author TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','fetching','ready','importing','completed','failed','cancelled')),
      error_message TEXT,
      metadata_json TEXT,
      channel_id TEXT,
      video_id TEXT,
      progress INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_migration_owner_status
      ON migration_jobs(owner_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_migration_source
      ON migration_jobs(source, source_video_id);
  `);
}

// ---------- URL parsing (pure — easy to test) ----------

export interface ParsedSource {
  source: MigrationSource;
  video_id: string;
  canonical_url: string;
}

export function parseSourceUrl(rawUrl: string): ParsedSource {
  const url = (rawUrl ?? '').trim();
  if (!url) throw new Error('URL required');

  // YouTube patterns
  // - youtube.com/watch?v=ID
  // - youtu.be/ID
  // - youtube.com/shorts/ID
  // - youtube.com/embed/ID
  // - youtube.com/live/ID
  {
    const m = url.match(
      /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/
    );
    if (m) {
      return {
        source: 'youtube',
        video_id: m[1],
        canonical_url: `https://www.youtube.com/watch?v=${m[1]}`,
      };
    }
  }

  // Vimeo patterns
  // - vimeo.com/12345
  // - player.vimeo.com/video/12345
  {
    const m = url.match(/(?:vimeo\.com\/(?:video\/)?|player\.vimeo\.com\/video\/)(\d{6,12})/);
    if (m) {
      return {
        source: 'vimeo',
        video_id: m[1],
        canonical_url: `https://vimeo.com/${m[1]}`,
      };
    }
  }

  throw new Error('Unsupported URL — only YouTube and Vimeo supported');
}

// ---------- oEmbed metadata fetch ----------

export interface OembedResult {
  title: string | null;
  description: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  author: string | null;
  raw: any;
}

function oembedUrlFor(p: ParsedSource): string {
  if (p.source === 'youtube') {
    return `https://www.youtube.com/oembed?url=${encodeURIComponent(p.canonical_url)}&format=json`;
  }
  return `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(p.canonical_url)}`;
}

export function isMigrationFetchEnabled(): boolean {
  // Default: enabled (real network). Tests set MELODYFLIX_MIGRATION_MOCK=1
  return process.env.MELODYFLIX_MIGRATION_MOCK !== '1';
}

export async function fetchOembed(p: ParsedSource, timeoutMs = 8000): Promise<OembedResult> {
  if (!isMigrationFetchEnabled()) {
    // Mock mode — deterministic values for tests
    return {
      title: `Mock ${p.source} video ${p.video_id}`,
      description: `Mock description for ${p.video_id}`,
      thumbnail_url: `https://mock.example.com/${p.video_id}.jpg`,
      duration_seconds: 180,
      author: 'Mock Author',
      raw: { mock: true, source: p.source, video_id: p.video_id },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(oembedUrlFor(p), { signal: controller.signal });
    if (!res.ok) throw new Error(`oEmbed ${res.status}`);
    const raw = await res.json() as any;
    return {
      title: typeof raw.title === 'string' ? raw.title.slice(0, 300) : null,
      description: typeof raw.description === 'string' ? raw.description.slice(0, 5000) : null,
      thumbnail_url: typeof raw.thumbnail_url === 'string' ? raw.thumbnail_url : null,
      duration_seconds: typeof raw.duration === 'number' ? raw.duration : null,
      author: typeof raw.author_name === 'string' ? raw.author_name : null,
      raw,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Job lifecycle ----------

export interface CreateMigrationInput {
  owner_id: string;
  source_url: string;
  channel_id?: string | null;
}

export function createMigrationJob(input: CreateMigrationInput): MigrationJob {
  const parsed = parseSourceUrl(input.source_url);
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO migration_jobs
      (id, owner_id, source, source_url, source_video_id, status,
       channel_id, progress, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?)
  `).run(
    id, input.owner_id, parsed.source, parsed.canonical_url,
    parsed.video_id, input.channel_id ?? null, now, now
  );
  return getMigrationJob(id)!;
}

export interface BulkCreateResult {
  created: MigrationJob[];
  errors: { url: string; error: string }[];
}

export function bulkCreateMigrations(input: {
  owner_id: string;
  urls: string[];
  channel_id?: string | null;
}): BulkCreateResult {
  const result: BulkCreateResult = { created: [], errors: [] };
  const max = 100;
  const urls = input.urls.slice(0, max);
  for (const url of urls) {
    try {
      result.created.push(createMigrationJob({
        owner_id: input.owner_id,
        source_url: url,
        channel_id: input.channel_id ?? null,
      }));
    } catch (e: any) {
      result.errors.push({ url, error: e?.message ?? 'failed' });
    }
  }
  return result;
}

export function getMigrationJob(id: string): MigrationJob | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM migration_jobs WHERE id = ?')
    .get(id) as MigrationJob | undefined;
  return row ?? null;
}

export function listMigrationJobs(f: {
  owner_id?: string;
  status?: MigrationStatus;
  source?: MigrationSource;
  limit?: number;
} = {}): MigrationJob[] {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];
  if (f.owner_id) { where.push('owner_id = ?'); params.push(f.owner_id); }
  if (f.status)   { where.push('status = ?');   params.push(f.status); }
  if (f.source)   { where.push('source = ?');   params.push(f.source); }
  const n = Math.min(Math.max(f.limit ?? 100, 1), 500);
  params.push(n);
  const sql = `SELECT * FROM migration_jobs
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT ?`;
  return db.prepare(sql).all(...params) as MigrationJob[];
}

export function markMigrationFetching(id: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`UPDATE migration_jobs SET status = 'fetching', progress = 5,
    error_message = NULL, updated_at = ? WHERE id = ?`).run(now, id);
}

export function markMigrationReady(id: string, oembed: OembedResult): MigrationJob | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE migration_jobs
    SET status = 'ready',
        title = ?, description = ?, thumbnail_url = ?,
        duration_seconds = ?, author = ?,
        metadata_json = ?, progress = 25,
        updated_at = ?
    WHERE id = ?
  `).run(
    oembed.title, oembed.description, oembed.thumbnail_url,
    oembed.duration_seconds, oembed.author,
    JSON.stringify(oembed.raw), now, id
  );
  return getMigrationJob(id);
}

export function markMigrationImporting(id: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`UPDATE migration_jobs SET status = 'importing', progress = 50,
    updated_at = ? WHERE id = ?`).run(now, id);
}

export function markMigrationCompleted(id: string, videoId: string): MigrationJob | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`UPDATE migration_jobs
    SET status = 'completed', progress = 100, video_id = ?, updated_at = ?
    WHERE id = ?`).run(videoId, now, id);
  return getMigrationJob(id);
}

export function markMigrationFailed(id: string, errorMessage: string): MigrationJob | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`UPDATE migration_jobs
    SET status = 'failed', error_message = ?, updated_at = ?
    WHERE id = ?`).run(errorMessage.slice(0, 500), now, id);
  return getMigrationJob(id);
}

export function cancelMigration(id: string, ownerId: string): boolean {
  const job = getMigrationJob(id);
  if (!job) return false;
  if (job.owner_id !== ownerId) throw new Error('Not your job');
  if (job.status === 'completed') throw new Error('Cannot cancel completed job');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`UPDATE migration_jobs SET status = 'cancelled', updated_at = ? WHERE id = ?`)
    .run(now, id);
  return true;
}

export function deleteMigration(id: string, ownerId: string): boolean {
  const job = getMigrationJob(id);
  if (!job) return false;
  if (job.owner_id !== ownerId) throw new Error('Not your job');
  return getDb().prepare('DELETE FROM migration_jobs WHERE id = ?').run(id).changes > 0;
}

// Fetch metadata from oEmbed then move to 'ready'
export async function fetchMigrationMetadata(id: string): Promise<MigrationJob | null> {
  const job = getMigrationJob(id);
  if (!job) return null;
  if (job.status !== 'pending') throw new Error('Only pending jobs can be fetched');

  markMigrationFetching(id);
  try {
    const parsed: ParsedSource = {
      source: job.source,
      video_id: job.source_video_id,
      canonical_url: job.source_url,
    };
    const oembed = await fetchOembed(parsed);
    return markMigrationReady(id, oembed);
  } catch (e: any) {
    return markMigrationFailed(id, e?.message ?? 'metadata fetch failed');
  }
}

// ---------- 44.4 Metadata Preservation ----------

export interface PreservedMetadata {
  title: string | null;
  description: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  source_url: string;
  source: MigrationSource;
  author: string | null;
}

export function extractPreservedMetadata(jobId: string): PreservedMetadata | null {
  const job = getMigrationJob(jobId);
  if (!job) return null;
  return {
    title: job.title,
    description: job.description,
    thumbnail_url: job.thumbnail_url,
    duration_seconds: job.duration_seconds,
    source_url: job.source_url,
    source: job.source,
    author: job.author,
  };
}

// Applies preserved metadata to a target video row (44.4)
export function applyMetadataToVideo(jobId: string, videoId: string): {
  applied: boolean;
  fields: string[];
} {
  const job = getMigrationJob(jobId);
  if (!job) throw new Error('Job not found');
  const db = getDb();
  const video = db.prepare('SELECT id FROM videos WHERE id = ?').get(videoId);
  if (!video) throw new Error('Video not found');

  const updates: string[] = [];
  const params: any[] = [];

  // Only fill empty fields by default (preserve existing)
  if (job.title) {
    updates.push('title = ?');
    params.push(job.title);
  }
  if (job.description) {
    updates.push('description = ?');
    params.push(job.description);
  }
  if (job.thumbnail_url) {
    updates.push('thumbnail_url = ?');
    params.push(job.thumbnail_url);
  }
  if (job.duration_seconds !== null && job.duration_seconds !== undefined) {
    updates.push('duration_seconds = ?');
    params.push(job.duration_seconds);
  }

  if (updates.length === 0) return { applied: false, fields: [] };

  const now = new Date().toISOString();
  updates.push('updated_at = ?');
  params.push(now);
  params.push(videoId);

  db.prepare(`UPDATE videos SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  return {
    applied: true,
    fields: updates.filter((u) => !u.startsWith('updated_at')).map((u) => u.split(' ')[0]),
  };
}

// ---------- Stats ----------

export interface MigrationStats {
  total: number;
  pending: number;
  ready: number;
  importing: number;
  completed: number;
  failed: number;
}

export function migrationStats(ownerId: string): MigrationStats {
  const db = getDb();
  const r = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status='pending'   THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status='ready'     THEN 1 ELSE 0 END) as ready,
      SUM(CASE WHEN status='importing' THEN 1 ELSE 0 END) as importing,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status='failed'    THEN 1 ELSE 0 END) as failed
    FROM migration_jobs WHERE owner_id = ?
  `).get(ownerId) as any;
  return {
    total: r.total ?? 0,
    pending: r.pending ?? 0,
    ready: r.ready ?? 0,
    importing: r.importing ?? 0,
    completed: r.completed ?? 0,
    failed: r.failed ?? 0,
  };
}
