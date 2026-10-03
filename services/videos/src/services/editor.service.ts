// melodyflix videos — Online Video Editor (Section 9.5)
// Non-destructive edit projects: trim, crop preset, watermark.
// Actual media processing is delegated to an FFmpeg worker (opt-in via
// MELODYFLIX_FFMPEG_ENABLED=1). Default = metadata-only "ready to render"
// state so the UI flow works without FFmpeg.

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type EditorJobKind = 'trim' | 'crop' | 'watermark' | 'composite';
export type EditorJobStatus = 'draft' | 'queued' | 'processing' | 'ready' | 'failed' | 'cancelled';
export type CropPreset = 'original' | '16:9' | '9:16' | '1:1' | '4:5';
export type WatermarkPosition = 'tl' | 'tr' | 'bl' | 'br';

export interface EditorJob {
  id: string;
  video_id: string;
  owner_id: string;
  kind: EditorJobKind;
  status: EditorJobStatus;
  title: string | null;

  // Trim
  trim_start_s: number | null;
  trim_end_s: number | null;

  // Crop
  crop_preset: CropPreset;
  crop_x: number | null;
  crop_y: number | null;
  crop_w: number | null;
  crop_h: number | null;

  // Watermark
  watermark_url: string | null;
  watermark_position: WatermarkPosition;
  watermark_scale: number;   // 0.05 .. 0.5 relative width
  watermark_opacity: number; // 0 .. 1

  // Render output
  output_video_id: string | null;
  output_path: string | null;
  output_size_bytes: number;
  error_message: string | null;
  progress: number;

  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export function ensureEditorSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_editor_jobs (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'trim'
        CHECK (kind IN ('trim','crop','watermark','composite')),
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','queued','processing','ready','failed','cancelled')),
      title TEXT,
      trim_start_s REAL,
      trim_end_s REAL,
      crop_preset TEXT NOT NULL DEFAULT 'original'
        CHECK (crop_preset IN ('original','16:9','9:16','1:1','4:5')),
      crop_x INTEGER,
      crop_y INTEGER,
      crop_w INTEGER,
      crop_h INTEGER,
      watermark_url TEXT,
      watermark_position TEXT NOT NULL DEFAULT 'br'
        CHECK (watermark_position IN ('tl','tr','bl','br')),
      watermark_scale REAL NOT NULL DEFAULT 0.15,
      watermark_opacity REAL NOT NULL DEFAULT 0.85,
      output_video_id TEXT,
      output_path TEXT,
      output_size_bytes INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      progress INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_editor_owner
      ON video_editor_jobs(owner_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_editor_video
      ON video_editor_jobs(video_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_editor_status
      ON video_editor_jobs(status, created_at);
  `);
}

function isFfmpegEnabled(): boolean {
  return process.env.MELODYFLIX_FFMPEG_ENABLED === '1';
}

export interface CreateEditorJobInput {
  video_id: string;
  owner_id: string;
  kind?: EditorJobKind;
  title?: string | null;
  trim_start_s?: number | null;
  trim_end_s?: number | null;
  crop_preset?: CropPreset;
  crop_x?: number | null;
  crop_y?: number | null;
  crop_w?: number | null;
  crop_h?: number | null;
  watermark_url?: string | null;
  watermark_position?: WatermarkPosition;
  watermark_scale?: number;
  watermark_opacity?: number;
}

export function createEditorJob(input: CreateEditorJobInput): EditorJob {
  const db = getDb();

  // Ownership check (video table lives in this service)
  const v = db.prepare('SELECT id, owner_id, duration_seconds FROM videos WHERE id = ?')
    .get(input.video_id) as { id: string; owner_id: string; duration_seconds: number | null } | undefined;
  if (!v) throw new Error('Video not found');
  if (v.owner_id !== input.owner_id) throw new Error('Not your video');

  const duration = v.duration_seconds ?? 0;

  // Validate trim
  let ts = input.trim_start_s ?? null;
  let te = input.trim_end_s ?? null;
  if (ts !== null && ts < 0) throw new Error('trim_start_s must be >= 0');
  if (te !== null && duration > 0 && te > duration + 0.5) throw new Error('trim_end_s exceeds video duration');
  if (ts !== null && te !== null && te <= ts) throw new Error('trim_end_s must be > trim_start_s');

  // Validate crop preset / manual
  const preset: CropPreset = input.crop_preset ?? 'original';
  if (preset !== 'original' && preset !== '16:9' && preset !== '9:16' && preset !== '1:1' && preset !== '4:5') {
    throw new Error('Invalid crop_preset');
  }

  // Watermark validation
  if (input.watermark_url) {
    if (!/^https?:\/\//i.test(input.watermark_url)) throw new Error('watermark_url must be http(s)');
  }
  const scale = input.watermark_scale === undefined ? 0.15 : Math.max(0.05, Math.min(input.watermark_scale, 0.5));
  const opacity = input.watermark_opacity === undefined ? 0.85 : Math.max(0, Math.min(input.watermark_opacity, 1));

  // Auto-derive kind when not supplied
  let kind: EditorJobKind = input.kind ?? 'trim';
  if (!input.kind) {
    const hasTrim = ts !== null && te !== null;
    const hasCrop = preset !== 'original';
    const hasWm = !!input.watermark_url;
    const count = [hasTrim, hasCrop, hasWm].filter(Boolean).length;
    if (count > 1) kind = 'composite';
    else if (hasCrop) kind = 'crop';
    else if (hasWm) kind = 'watermark';
    else kind = 'trim';
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO video_editor_jobs
      (id, video_id, owner_id, kind, status, title,
       trim_start_s, trim_end_s,
       crop_preset, crop_x, crop_y, crop_w, crop_h,
       watermark_url, watermark_position, watermark_scale, watermark_opacity,
       output_video_id, output_path, output_size_bytes, error_message, progress,
       created_at, updated_at, started_at, finished_at)
    VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            NULL, NULL, 0, NULL, 0, ?, ?, NULL, NULL)
  `).run(
    id, input.video_id, input.owner_id, kind,
    input.title ?? null,
    ts, te,
    preset, input.crop_x ?? null, input.crop_y ?? null, input.crop_w ?? null, input.crop_h ?? null,
    input.watermark_url ?? null, input.watermark_position ?? 'br', scale, opacity,
    now, now
  );
  return getEditorJob(id)!;
}

export function getEditorJob(id: string): EditorJob | null {
  return (getDb().prepare('SELECT * FROM video_editor_jobs WHERE id = ?').get(id) as EditorJob | undefined) ?? null;
}

export interface ListEditorJobsOpts {
  owner_id?: string;
  video_id?: string;
  status?: EditorJobStatus;
  limit?: number;
}

export function listEditorJobs(opts: ListEditorJobsOpts = {}): EditorJob[] {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];
  if (opts.owner_id) { where.push('owner_id = ?'); params.push(opts.owner_id); }
  if (opts.video_id) { where.push('video_id = ?'); params.push(opts.video_id); }
  if (opts.status) { where.push('status = ?'); params.push(opts.status); }
  const n = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  params.push(n);
  const sql = `SELECT * FROM video_editor_jobs
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT ?`;
  return db.prepare(sql).all(...params) as EditorJob[];
}

export interface UpdateEditorJobInput {
  title?: string | null;
  trim_start_s?: number | null;
  trim_end_s?: number | null;
  crop_preset?: CropPreset;
  crop_x?: number | null;
  crop_y?: number | null;
  crop_w?: number | null;
  crop_h?: number | null;
  watermark_url?: string | null;
  watermark_position?: WatermarkPosition;
  watermark_scale?: number;
  watermark_opacity?: number;
}

export function updateEditorJob(id: string, ownerId: string, patch: UpdateEditorJobInput): EditorJob | null {
  const job = getEditorJob(id);
  if (!job) return null;
  if (job.owner_id !== ownerId) throw new Error('Not your job');
  if (job.status === 'processing' || job.status === 'ready') throw new Error('Cannot edit a processing or completed job');

  const fields: string[] = [];
  const values: any[] = [];
  const map: Record<string, any> = {
    title: patch.title,
    trim_start_s: patch.trim_start_s,
    trim_end_s: patch.trim_end_s,
    crop_preset: patch.crop_preset,
    crop_x: patch.crop_x,
    crop_y: patch.crop_y,
    crop_w: patch.crop_w,
    crop_h: patch.crop_h,
    watermark_url: patch.watermark_url,
    watermark_position: patch.watermark_position,
    watermark_scale: patch.watermark_scale === undefined
      ? undefined : Math.max(0.05, Math.min(patch.watermark_scale, 0.5)),
    watermark_opacity: patch.watermark_opacity === undefined
      ? undefined : Math.max(0, Math.min(patch.watermark_opacity, 1)),
  };
  for (const [k, v] of Object.entries(map)) {
    if (v === undefined) continue;
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (fields.length === 0) return job;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  getDb().prepare(`UPDATE video_editor_jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getEditorJob(id);
}

export function deleteEditorJob(id: string, ownerId: string): boolean {
  const job = getEditorJob(id);
  if (!job) return false;
  if (job.owner_id !== ownerId) throw new Error('Not your job');
  if (job.status === 'processing') throw new Error('Cannot delete while processing');
  return getDb().prepare('DELETE FROM video_editor_jobs WHERE id = ?').run(id).changes > 0;
}

// ---------- Queue / render lifecycle ----------

export function queueEditorJob(id: string, ownerId: string): EditorJob | null {
  const job = getEditorJob(id);
  if (!job) return null;
  if (job.owner_id !== ownerId) throw new Error('Not your job');
  if (job.status !== 'draft' && job.status !== 'failed' && job.status !== 'cancelled') {
    throw new Error('Only draft / failed / cancelled jobs can be queued');
  }
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`UPDATE video_editor_jobs SET status = 'queued', progress = 0, error_message = NULL, updated_at = ? WHERE id = ?`)
    .run(now, id);
  return getEditorJob(id);
}

export function cancelEditorJob(id: string, ownerId: string): EditorJob | null {
  const job = getEditorJob(id);
  if (!job) return null;
  if (job.owner_id !== ownerId) throw new Error('Not your job');
  if (job.status === 'ready') throw new Error('Job is already complete');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`UPDATE video_editor_jobs SET status = 'cancelled', updated_at = ? WHERE id = ?`)
    .run(now, id);
  return getEditorJob(id);
}

// Worker: due jobs (queued)
export function listQueuedEditorJobs(limit = 10): EditorJob[] {
  const n = Math.min(Math.max(limit, 1), 50);
  return getDb().prepare(`
    SELECT * FROM video_editor_jobs
    WHERE status = 'queued'
    ORDER BY created_at ASC LIMIT ?
  `).all(n) as EditorJob[];
}

export function markEditorProcessing(id: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`UPDATE video_editor_jobs SET status = 'processing', started_at = ?, progress = 5, updated_at = ? WHERE id = ?`)
    .run(now, now, id);
}

export interface MarkEditorReadyInput {
  outputPath: string;
  outputSizeBytes?: number;
  outputVideoId?: string | null;
}

export function markEditorReady(id: string, input: MarkEditorReadyInput): EditorJob | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE video_editor_jobs
    SET status = 'ready', progress = 100, output_path = ?, output_size_bytes = ?,
        output_video_id = ?, finished_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.outputPath, input.outputSizeBytes ?? 0,
    input.outputVideoId ?? null, now, now, id,
  );
  return getEditorJob(id);
}

export function markEditorFailed(id: string, errorMessage: string): EditorJob | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE video_editor_jobs
    SET status = 'failed', error_message = ?, finished_at = ?, updated_at = ?
    WHERE id = ?
  `).run(errorMessage.slice(0, 500), now, now, id);
  return getEditorJob(id);
}

export function setEditorProgress(id: string, progress: number): void {
  const p = Math.max(0, Math.min(progress, 100));
  getDb().prepare(`UPDATE video_editor_jobs SET progress = ?, updated_at = ? WHERE id = ?`)
    .run(p, new Date().toISOString(), id);
}

// ---------- FFmpeg filter builder (pure) ----------

export interface BuildFfmpegArgsInput {
  inputPath: string;
  outputPath: string;
  job: EditorJob;
}

export function buildFfmpegArgs(input: BuildFfmpegArgsInput): { args: string[]; ffmpegEnabled: boolean } {
  const { inputPath, outputPath, job } = input;
  const args: string[] = ['-y', '-loglevel', 'warning', '-i', inputPath];

  const filters: string[] = [];

  // Trim
  if (job.trim_start_s !== null && job.trim_end_s !== null) {
    args.push('-ss', String(job.trim_start_s));
    args.push('-to', String(job.trim_end_s));
  } else if (job.trim_start_s !== null) {
    args.push('-ss', String(job.trim_start_s));
  } else if (job.trim_end_s !== null) {
    args.push('-to', String(job.trim_end_s));
  }

  // Crop preset (assume source dimensions unknown; use scale + crop expression)
  const cropFilters: Record<string, string> = {
    '16:9': 'crop=in_w:in_w*9/16',
    '9:16': 'crop=in_h*9/16:in_h',
    '1:1': 'crop=min(in_w\\,in_h):min(in_w\\,in_h)',
    '4:5': 'crop=in_h*4/5:in_h',
  };
  if (job.crop_preset !== 'original') {
    if (job.crop_w && job.crop_h) {
      const x = job.crop_x ?? 0;
      const y = job.crop_y ?? 0;
      filters.push(`crop=${job.crop_w}:${job.crop_h}:${x}:${y}`);
    } else {
      filters.push(cropFilters[job.crop_preset] ?? '');
    }
  }

  // Watermark overlay (needs second input — we'd add it as a separate -i in real impl)
  if (job.watermark_url) {
    args.push('-i', job.watermark_url);
    const posMap: Record<WatermarkPosition, string> = {
      tl: '10:10',
      tr: 'W-w-10:10',
      bl: '10:H-h-10',
      br: 'W-w-10:H-h-10',
    };
    const overlayFilter = `overlay=${posMap[job.watermark_position]}`;
    filters.push(overlayFilter);
  }

  if (filters.length > 0) {
    args.push('-vf', filters.join(','));
  }

  args.push('-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart');
  args.push(outputPath);

  return { args, ffmpegEnabled: isFfmpegEnabled() };
}

// Mock-safe render: default mode produces metadata only; real mode spawns
// ffmpeg in the editor worker (separate process). This function is a
// non-blocking, test-friendly stub.
export async function renderEditorJob(id: string): Promise<EditorJob | null> {
  const job = getEditorJob(id);
  if (!job) return null;
  if (job.status !== 'queued' && job.status !== 'draft') {
    throw new Error('Job is not ready to render');
  }

  // In real deployment this enqueues an external worker. In mock mode we
  // simply mark the job ready with a synthetic output path.
  if (!isFfmpegEnabled()) {
    markEditorProcessing(id);
    setEditorProgress(id, 100);
    return markEditorReady(id, {
      outputPath: `/mock/editor/${id}.mp4`,
      outputSizeBytes: 0,
      outputVideoId: null,
    });
  }

  // Real mode: worker picks up `queued` jobs (see editor-worker)
  return queueEditorJob(id, job.owner_id);
}

// ---------- Summary ----------

export interface EditorSummary {
  owner_id: string;
  total: number;
  draft: number;
  queued: number;
  processing: number;
  ready: number;
  failed: number;
  ffmpeg_enabled: boolean;
}

export function getEditorSummary(ownerId: string): EditorSummary {
  const db = getDb();
  const r = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status='draft'      THEN 1 ELSE 0 END) as draft,
      SUM(CASE WHEN status='queued'     THEN 1 ELSE 0 END) as queued,
      SUM(CASE WHEN status='processing' THEN 1 ELSE 0 END) as processing,
      SUM(CASE WHEN status='ready'      THEN 1 ELSE 0 END) as ready,
      SUM(CASE WHEN status='failed'     THEN 1 ELSE 0 END) as failed
    FROM video_editor_jobs WHERE owner_id = ?
  `).get(ownerId) as any;
  return {
    owner_id: ownerId,
    total: r.total ?? 0,
    draft: r.draft ?? 0,
    queued: r.queued ?? 0,
    processing: r.processing ?? 0,
    ready: r.ready ?? 0,
    failed: r.failed ?? 0,
    ffmpeg_enabled: isFfmpegEnabled(),
  };
}
