// melodyflix videos - video preview, trailer, highlight (Section 48)
//
// Real ffmpeg-based: scene detection, segment extraction, concat,
// thumbnail strips, auto chapters.

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export function ensurePreviewSchema(): void {
  const db = getDb();
  db.exec(`
    -- 48.1/48.3/48.4 generation jobs
    CREATE TABLE IF NOT EXISTS preview_jobs (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      kind TEXT NOT NULL,                  -- 'trailer' | 'teaser' | 'highlight'
      preset TEXT NOT NULL DEFAULT 'default',
      target_duration_seconds REAL NOT NULL DEFAULT 60,
      status TEXT NOT NULL DEFAULT 'pending', -- pending|analyzing|cutting|encoding|ready|failed
      progress INTEGER NOT NULL DEFAULT 0,
      output_url TEXT,
      output_duration_seconds REAL,
      output_size_bytes INTEGER,
      config_json TEXT NOT NULL DEFAULT '{}',
      error_text TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pj_video ON preview_jobs(video_id);
    CREATE INDEX IF NOT EXISTS idx_pj_status ON preview_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_pj_kind ON preview_jobs(kind);

    -- 48.2 user-trimmed preview clips
    CREATE TABLE IF NOT EXISTS preview_clips (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      user_id TEXT,
      start_seconds REAL NOT NULL,
      end_seconds REAL NOT NULL,
      label TEXT,
      hls_url TEXT,
      mp4_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pc_video ON preview_clips(video_id);
    CREATE INDEX IF NOT EXISTS idx_pc_user ON preview_clips(user_id);

    -- segment definitions (part of a job, or standalone)
    CREATE TABLE IF NOT EXISTS preview_segments (
      id TEXT PRIMARY KEY,
      job_id TEXT,
      video_id TEXT NOT NULL,
      start_seconds REAL NOT NULL,
      end_seconds REAL NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      reason TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ps_job ON preview_segments(job_id);
    CREATE INDEX IF NOT EXISTS idx_ps_video ON preview_segments(video_id);

    -- scene detection runs (BONUS)
    CREATE TABLE IF NOT EXISTS scene_analyses (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      threshold REAL NOT NULL DEFAULT 0.3,
      scene_count INTEGER NOT NULL DEFAULT 0,
      scenes_json TEXT NOT NULL DEFAULT '[]',
      duration_seconds REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      error_text TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sa_video ON scene_analyses(video_id);

    -- auto-generated chapters from scenes (BONUS)
    CREATE TABLE IF NOT EXISTS auto_chapters (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      scene_analysis_id TEXT,
      title TEXT NOT NULL,
      start_seconds REAL NOT NULL,
      end_seconds REAL,
      confidence REAL NOT NULL DEFAULT 0.7,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ac_video ON auto_chapters(video_id);

    -- thumbnail strips (BONUS)
    CREATE TABLE IF NOT EXISTS thumbnail_strips (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      sprite_url TEXT,
      vtt_url TEXT,
      columns INTEGER NOT NULL DEFAULT 10,
      rows INTEGER NOT NULL DEFAULT 10,
      thumb_width INTEGER NOT NULL DEFAULT 160,
      thumb_height INTEGER NOT NULL DEFAULT 90,
      interval_seconds REAL NOT NULL DEFAULT 10,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ts_video ON thumbnail_strips(video_id);
  `);
}

// ---------- 48.1 / 48.3 / 48.4 Preview jobs ----------

export type PreviewKind = 'trailer' | 'teaser' | 'highlight';
export type PreviewStatus = 'pending' | 'analyzing' | 'cutting' | 'encoding' | 'ready' | 'failed';

export interface PreviewJob {
  id: string;
  video_id: string;
  kind: PreviewKind;
  preset: string;
  target_duration_seconds: number;
  status: PreviewStatus;
  progress: number;
  output_url: string | null;
  output_duration_seconds: number | null;
  output_size_bytes: number | null;
  config: Record<string, unknown>;
  error_text: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface PjRow {
  id: string; video_id: string; kind: string; preset: string;
  target_duration_seconds: number; status: string; progress: number;
  output_url: string | null; output_duration_seconds: number | null;
  output_size_bytes: number | null; config_json: string;
  error_text: string | null; created_by: string | null;
  created_at: string; updated_at: string;
}

function safeParse<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function pjRowToObj(row: PjRow): PreviewJob {
  return {
    id: row.id, video_id: row.video_id, kind: row.kind as PreviewKind,
    preset: row.preset, target_duration_seconds: row.target_duration_seconds,
    status: row.status as PreviewStatus, progress: row.progress,
    output_url: row.output_url,
    output_duration_seconds: row.output_duration_seconds,
    output_size_bytes: row.output_size_bytes,
    config: safeParse<Record<string, unknown>>(row.config_json, {}),
    error_text: row.error_text, created_by: row.created_by,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

const VALID_KINDS: PreviewKind[] = ['trailer', 'teaser', 'highlight'];
const PRESETS: Record<PreviewKind, { default_duration: number; min: number; max: number; segments: number }> = {
  trailer:   { default_duration: 90, min: 45, max: 180, segments: 12 },
  teaser:    { default_duration: 20, min: 10, max: 45,  segments: 5 },
  highlight: { default_duration: 120, min: 60, max: 600, segments: 20 },
};

export interface CreatePreviewJobInput {
  video_id: string;
  kind: PreviewKind;
  preset?: string;
  target_duration_seconds?: number;
  config?: Record<string, unknown>;
  created_by?: string;
}

export function createPreviewJob(input: CreatePreviewJobInput): PreviewJob {
  const db = getDb();
  if (!VALID_KINDS.includes(input.kind)) throw new Error(`invalid kind: ${input.kind}`);
  const spec = PRESETS[input.kind];
  const dur = input.target_duration_seconds ?? spec.default_duration;
  if (dur < spec.min || dur > spec.max) {
    throw new Error(`target_duration_seconds must be ${spec.min}-${spec.max} for ${input.kind}`);
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO preview_jobs (id, video_id, kind, preset, target_duration_seconds,
      status, progress, config_json, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)
  `).run(
    id, input.video_id, input.kind, input.preset ?? 'default', dur,
    JSON.stringify(input.config ?? {}), input.created_by ?? null, now, now,
  );
  return getPreviewJob(id)!;
}

export function getPreviewJob(id: string): PreviewJob | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM preview_jobs WHERE id = ?').get(id) as PjRow | undefined;
  return row ? pjRowToObj(row) : null;
}

export function listPreviewJobs(videoId: string, kind?: PreviewKind): PreviewJob[] {
  const db = getDb();
  const rows = kind
    ? db.prepare('SELECT * FROM preview_jobs WHERE video_id = ? AND kind = ? ORDER BY created_at DESC').all(videoId, kind) as PjRow[]
    : db.prepare('SELECT * FROM preview_jobs WHERE video_id = ? ORDER BY created_at DESC').all(videoId) as PjRow[];
  return rows.map(pjRowToObj);
}

export function updatePreviewJob(id: string, patch: {
  status?: PreviewStatus;
  progress?: number;
  output_url?: string | null;
  output_duration_seconds?: number | null;
  output_size_bytes?: number | null;
  error_text?: string | null;
  config?: Record<string, unknown>;
}): PreviewJob | null {
  const db = getDb();
  const cur = getPreviewJob(id);
  if (!cur) return null;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE preview_jobs SET status = ?, progress = ?, output_url = ?, output_duration_seconds = ?,
      output_size_bytes = ?, error_text = ?, config_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    patch.status ?? cur.status,
    Math.max(0, Math.min(100, patch.progress ?? cur.progress)),
    patch.output_url !== undefined ? patch.output_url : cur.output_url,
    patch.output_duration_seconds !== undefined ? patch.output_duration_seconds : cur.output_duration_seconds,
    patch.output_size_bytes !== undefined ? patch.output_size_bytes : cur.output_size_bytes,
    patch.error_text !== undefined ? patch.error_text : cur.error_text,
    patch.config !== undefined ? JSON.stringify({ ...cur.config, ...patch.config }) : JSON.stringify(cur.config),
    now, id,
  );
  return getPreviewJob(id);
}

export function deletePreviewJob(id: string): boolean {
  const db = getDb();
  db.prepare('DELETE FROM preview_segments WHERE job_id = ?').run(id);
  return db.prepare('DELETE FROM preview_jobs WHERE id = ?').run(id).changes > 0;
}

// ---------- Segments ----------

export interface PreviewSegment {
  id: string;
  job_id: string | null;
  video_id: string;
  start_seconds: number;
  end_seconds: number;
  score: number;
  reason: string | null;
  sort_order: number;
  created_at: string;
}

interface PsRow {
  id: string; job_id: string | null; video_id: string;
  start_seconds: number; end_seconds: number; score: number;
  reason: string | null; sort_order: number; created_at: string;
}

function psRowToObj(row: PsRow): PreviewSegment {
  return {
    id: row.id, job_id: row.job_id, video_id: row.video_id,
    start_seconds: row.start_seconds, end_seconds: row.end_seconds,
    score: row.score, reason: row.reason,
    sort_order: row.sort_order, created_at: row.created_at,
  };
}

export function addSegment(input: {
  job_id?: string | null;
  video_id: string;
  start_seconds: number;
  end_seconds: number;
  score?: number;
  reason?: string;
  sort_order?: number;
}): PreviewSegment {
  const db = getDb();
  if (input.end_seconds <= input.start_seconds) throw new Error('end must be > start');
  if (input.start_seconds < 0) throw new Error('start must be >= 0');
  const id = randomUUID();
  const now = new Date().toISOString();
  const order = input.sort_order ?? Math.round(input.start_seconds * 10);
  db.prepare(`
    INSERT INTO preview_segments (id, job_id, video_id, start_seconds, end_seconds, score, reason, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.job_id ?? null, input.video_id,
    input.start_seconds, input.end_seconds,
    input.score ?? 0, input.reason ?? null, order, now,
  );
  return psRowToObj(db.prepare('SELECT * FROM preview_segments WHERE id = ?').get(id) as PsRow);
}

export function listSegments(opts: { job_id?: string; video_id?: string }): PreviewSegment[] {
  const db = getDb();
  if (opts.job_id) {
    const rows = db.prepare('SELECT * FROM preview_segments WHERE job_id = ? ORDER BY sort_order').all(opts.job_id) as PsRow[];
    return rows.map(psRowToObj);
  }
  if (opts.video_id) {
    const rows = db.prepare('SELECT * FROM preview_segments WHERE video_id = ? ORDER BY sort_order').all(opts.video_id) as PsRow[];
    return rows.map(psRowToObj);
  }
  return [];
}

export function replaceJobSegments(jobId: string, videoId: string, segments: Array<{
  start_seconds: number; end_seconds: number; score?: number; reason?: string;
}>): PreviewSegment[] {
  const db = getDb();
  db.prepare('DELETE FROM preview_segments WHERE job_id = ?').run(jobId);
  const out: PreviewSegment[] = [];
  for (const s of segments) {
    out.push(addSegment({ job_id: jobId, video_id: videoId, ...s }));
  }
  return out;
}

/**
 * Auto-build a segment plan given a target duration.
 * Picks top-scored segments (by score) and expands to fit target.
 */
export function buildPlanFromScenes(
  scenes: Array<{ start: number; end: number; score: number }>,
  targetDuration: number,
  maxSegments: number,
): Array<{ start_seconds: number; end_seconds: number; score: number }> {
  if (!scenes.length || targetDuration <= 0) return [];
  const sorted = [...scenes].sort((a, b) => b.score - a.score);
  const picked: Array<{ start_seconds: number; end_seconds: number; score: number }> = [];
  let total = 0;
  for (const s of sorted) {
    if (picked.length >= maxSegments) break;
    const len = s.end - s.start;
    if (len <= 0) continue;
    const remaining = targetDuration - total;
    if (remaining <= 0) break;
    if (len <= remaining) {
      picked.push({ start_seconds: s.start, end_seconds: s.end, score: s.score });
      total += len;
    } else {
      // trim to fit remaining
      picked.push({ start_seconds: s.start, end_seconds: s.start + remaining, score: s.score });
      total += remaining;
      break;
    }
  }
  // sort by timeline for output
  return picked.sort((a, b) => a.start_seconds - b.start_seconds);
}

// ---------- ffmpeg command builders ----------

export interface ConcatClip {
  video_id: string;
  input_path: string;
  start_seconds: number;
  end_seconds: number;
}

/**
 * Build ffmpeg args for cutting + concatenating multiple segments
 * from the same source file. Uses filter_complex.
 */
export function buildConcatCommand(inputPath: string, segments: ConcatClip[], outputPath: string): string[] {
  const parts: string[] = [];
  const labels: string[] = [];
  segments.forEach((s, i) => {
    const dur = Math.max(0.1, s.end_seconds - s.start_seconds);
    parts.push(`[0:v]trim=start=${s.start_seconds}:duration=${dur},setpts=PTS-STARTPTS[v${i}]`);
    parts.push(`[0:a]atrim=start=${s.start_seconds}:duration=${dur},asetpts=PTS-STARTPTS[a${i}]`);
    labels.push(`[v${i}][a${i}]`);
  });
  const n = segments.length;
  const concat = `${labels.join('')}concat=n=${n}:v=1:a=1[outv][outa]`;
  const filter = [...parts, concat].join(';');
  return [
    '-y', '-i', inputPath,
    '-filter_complex', filter,
    '-map', '[outv]', '-map', '[outa]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
    '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart',
    outputPath,
  ];
}

/**
 * Build args for cutting a single clip (used by 48.2 preview clips).
 */
export function buildCutCommand(
  inputPath: string, startSeconds: number, endSeconds: number,
  outputPath: string, format: 'mp4' | 'hls' = 'mp4',
): string[] {
  const dur = Math.max(0.1, endSeconds - startSeconds);
  const base = ['-y', '-ss', String(startSeconds), '-i', inputPath, '-t', String(dur)];
  if (format === 'hls') {
    return [...base, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
      '-c:a', 'aac', '-b:a', '160k',
      '-hls_time', '4', '-hls_playlist_type', 'vod',
      '-hls_segment_filename', outputPath.replace('.m3u8', '_%03d.ts'),
      outputPath];
  }
  return [...base, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', outputPath];
}

// ---------- 48.2 Preview Clips (user-trimmed) ----------

export interface PreviewClip {
  id: string;
  video_id: string;
  user_id: string | null;
  start_seconds: number;
  end_seconds: number;
  label: string | null;
  hls_url: string | null;
  mp4_url: string | null;
  status: 'pending' | 'ready' | 'failed';
  created_at: string;
  updated_at: string;
}

interface PcRow {
  id: string; video_id: string; user_id: string | null;
  start_seconds: number; end_seconds: number; label: string | null;
  hls_url: string | null; mp4_url: string | null;
  status: string; created_at: string; updated_at: string;
}

function pcRowToObj(row: PcRow): PreviewClip {
  return {
    id: row.id, video_id: row.video_id, user_id: row.user_id,
    start_seconds: row.start_seconds, end_seconds: row.end_seconds,
    label: row.label, hls_url: row.hls_url, mp4_url: row.mp4_url,
    status: row.status as PreviewClip['status'],
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

export function createPreviewClip(input: {
  video_id: string;
  user_id?: string | null;
  start_seconds: number;
  end_seconds: number;
  label?: string;
}): PreviewClip {
  const db = getDb();
  if (input.end_seconds <= input.start_seconds) throw new Error('end must be > start');
  if (input.start_seconds < 0) throw new Error('start must be >= 0');
  const dur = input.end_seconds - input.start_seconds;
  if (dur > 600) throw new Error('preview clip cannot exceed 10 minutes');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO preview_clips (id, video_id, user_id, start_seconds, end_seconds,
      label, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    id, input.video_id, input.user_id ?? null,
    input.start_seconds, input.end_seconds,
    input.label ?? null, now, now,
  );
  return getPreviewClip(id)!;
}

export function getPreviewClip(id: string): PreviewClip | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM preview_clips WHERE id = ?').get(id) as PcRow | undefined;
  return row ? pcRowToObj(row) : null;
}

export function listPreviewClips(opts: { video_id?: string; user_id?: string; limit?: number }): PreviewClip[] {
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.video_id) { where.push('video_id = ?'); params.push(opts.video_id); }
  if (opts.user_id) { where.push('user_id = ?'); params.push(opts.user_id); }
  const sql = `SELECT * FROM preview_clips${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`;
  const rows = db.prepare(sql).all(...params, opts.limit ?? 100) as PcRow[];
  return rows.map(pcRowToObj);
}

export function updatePreviewClip(id: string, patch: {
  hls_url?: string | null; mp4_url?: string | null;
  status?: PreviewClip['status']; label?: string | null;
}): PreviewClip | null {
  const db = getDb();
  const cur = getPreviewClip(id);
  if (!cur) return null;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE preview_clips SET hls_url = ?, mp4_url = ?, status = ?, label = ?, updated_at = ?
    WHERE id = ?
  `).run(
    patch.hls_url !== undefined ? patch.hls_url : cur.hls_url,
    patch.mp4_url !== undefined ? patch.mp4_url : cur.mp4_url,
    patch.status ?? cur.status,
    patch.label !== undefined ? patch.label : cur.label,
    now, id,
  );
  return getPreviewClip(id);
}

export function deletePreviewClip(id: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM preview_clips WHERE id = ?').run(id).changes > 0;
}

// ---------- Scene analysis (BONUS) ----------

export interface SceneAnalysis {
  id: string;
  video_id: string;
  threshold: number;
  scene_count: number;
  scenes: Array<{ start: number; end: number; score: number }>;
  duration_seconds: number;
  status: 'pending' | 'running' | 'ready' | 'failed';
  error_text: string | null;
  created_at: string;
  updated_at: string;
}

interface SaRow {
  id: string; video_id: string; threshold: number; scene_count: number;
  scenes_json: string; duration_seconds: number; status: string;
  error_text: string | null; created_at: string; updated_at: string;
}

function saRowToObj(row: SaRow): SceneAnalysis {
  return {
    id: row.id, video_id: row.video_id, threshold: row.threshold,
    scene_count: row.scene_count,
    scenes: safeParse<SceneAnalysis['scenes']>(row.scenes_json, []),
    duration_seconds: row.duration_seconds,
    status: row.status as SceneAnalysis['status'],
    error_text: row.error_text,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

export function createSceneAnalysis(input: { video_id: string; threshold?: number }): SceneAnalysis {
  const db = getDb();
  const threshold = input.threshold ?? 0.3;
  if (threshold <= 0 || threshold > 1) throw new Error('threshold must be 0-1');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO scene_analyses (id, video_id, threshold, scene_count, scenes_json,
      duration_seconds, status, created_at, updated_at)
    VALUES (?, ?, ?, 0, '[]', 0, 'pending', ?, ?)
  `).run(id, input.video_id, threshold, now, now);
  return getSceneAnalysis(id)!;
}

export function getSceneAnalysis(id: string): SceneAnalysis | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM scene_analyses WHERE id = ?').get(id) as SaRow | undefined;
  return row ? saRowToObj(row) : null;
}

export function listSceneAnalyses(videoId: string): SceneAnalysis[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM scene_analyses WHERE video_id = ? ORDER BY created_at DESC')
    .all(videoId) as SaRow[];
  return rows.map(saRowToObj);
}

export function updateSceneAnalysis(id: string, patch: {
  status?: SceneAnalysis['status'];
  scenes?: SceneAnalysis['scenes'];
  scene_count?: number;
  duration_seconds?: number;
  error_text?: string | null;
}): SceneAnalysis | null {
  const db = getDb();
  const cur = getSceneAnalysis(id);
  if (!cur) return null;
  const now = new Date().toISOString();
  const scenes = patch.scenes ?? cur.scenes;
  db.prepare(`
    UPDATE scene_analyses SET status = ?, scenes_json = ?, scene_count = ?, duration_seconds = ?, error_text = ?, updated_at = ?
    WHERE id = ?
  `).run(
    patch.status ?? cur.status,
    JSON.stringify(scenes),
    patch.scene_count ?? scenes.length,
    patch.duration_seconds ?? cur.duration_seconds,
    patch.error_text !== undefined ? patch.error_text : cur.error_text,
    now, id,
  );
  return getSceneAnalysis(id);
}

/**
 * Build ffmpeg args for scene detection using the `select` filter.
 * Produces a metadata line per scene change.
 */
export function buildSceneDetectionCommand(inputPath: string, threshold: number): string[] {
  return [
    '-i', inputPath,
    '-filter:v', `select='gt(scene,${threshold})',showinfo`,
    '-f', 'null',
    '-',
  ];
}

/**
 * Parse ffmpeg showinfo output lines for scene change timestamps.
 * Lines look like: ... pts_time:12.345 ...
 */
export function parseSceneTimestamps(stderr: string, totalDuration: number): Array<{ start: number; end: number; score: number }> {
  const times: number[] = [0];
  const re = /pts_time:([0-9.]+)/g;
  let m: RegExpExecArray | null;
  const seen = new Set<number>();
  while ((m = re.exec(stderr)) !== null) {
    const t = parseFloat(m[1]);
    if (isFinite(t) && !seen.has(t) && t > 0) {
      seen.add(t);
      times.push(t);
    }
  }
  times.push(totalDuration);
  times.sort((a, b) => a - b);
  const scenes: Array<{ start: number; end: number; score: number }> = [];
  for (let i = 0; i < times.length - 1; i++) {
    const start = times[i];
    const end = times[i + 1];
    const len = end - start;
    // heuristic score: length × implicit novelty
    const score = Math.min(1, len / 10);
    scenes.push({ start, end, score });
  }
  return scenes;
}

// ---------- Auto chapters (BONUS) ----------

export interface AutoChapter {
  id: string;
  video_id: string;
  scene_analysis_id: string | null;
  title: string;
  start_seconds: number;
  end_seconds: number | null;
  confidence: number;
  created_at: string;
}

interface AChRow {
  id: string; video_id: string; scene_analysis_id: string | null;
  title: string; start_seconds: number; end_seconds: number | null;
  confidence: number; created_at: string;
}

function achRowToObj(row: AChRow): AutoChapter {
  return {
    id: row.id, video_id: row.video_id, scene_analysis_id: row.scene_analysis_id,
    title: row.title, start_seconds: row.start_seconds, end_seconds: row.end_seconds,
    confidence: row.confidence, created_at: row.created_at,
  };
}

export function addAutoChapter(input: {
  video_id: string; scene_analysis_id?: string | null;
  title: string; start_seconds: number; end_seconds?: number | null;
  confidence?: number;
}): AutoChapter {
  const db = getDb();
  if (!input.title?.trim()) throw new Error('title required');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO auto_chapters (id, video_id, scene_analysis_id, title, start_seconds, end_seconds, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.video_id, input.scene_analysis_id ?? null,
    input.title.trim(), input.start_seconds,
    input.end_seconds ?? null, input.confidence ?? 0.7, now,
  );
  return achRowToObj(db.prepare('SELECT * FROM auto_chapters WHERE id = ?').get(id) as AChRow);
}

export function listAutoChapters(videoId: string): AutoChapter[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM auto_chapters WHERE video_id = ? ORDER BY start_seconds')
    .all(videoId) as AChRow[];
  return rows.map(achRowToObj);
}

export function replaceAutoChapters(videoId: string, chapters: Array<{
  title: string; start_seconds: number; end_seconds?: number | null;
  scene_analysis_id?: string; confidence?: number;
}>): AutoChapter[] {
  const db = getDb();
  db.prepare('DELETE FROM auto_chapters WHERE video_id = ?').run(videoId);
  return chapters.map((c) => addAutoChapter({ video_id: videoId, ...c }));
}

export function deleteAutoChapter(id: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM auto_chapters WHERE id = ?').run(id).changes > 0;
}

// ---------- Thumbnail strips (BONUS) ----------

export interface ThumbnailStrip {
  id: string;
  video_id: string;
  sprite_url: string | null;
  vtt_url: string | null;
  columns: number;
  rows: number;
  thumb_width: number;
  thumb_height: number;
  interval_seconds: number;
  status: 'pending' | 'ready' | 'failed';
  created_at: string;
  updated_at: string;
}

interface TsRow {
  id: string; video_id: string; sprite_url: string | null; vtt_url: string | null;
  columns: number; rows: number; thumb_width: number; thumb_height: number;
  interval_seconds: number; status: string; created_at: string; updated_at: string;
}

function tsRowToObj(row: TsRow): ThumbnailStrip {
  return {
    id: row.id, video_id: row.video_id, sprite_url: row.sprite_url, vtt_url: row.vtt_url,
    columns: row.columns, rows: row.rows,
    thumb_width: row.thumb_width, thumb_height: row.thumb_height,
    interval_seconds: row.interval_seconds,
    status: row.status as ThumbnailStrip['status'],
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

export function createThumbnailStrip(input: {
  video_id: string;
  columns?: number;
  rows?: number;
  thumb_width?: number;
  thumb_height?: number;
  interval_seconds?: number;
}): ThumbnailStrip {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO thumbnail_strips (id, video_id, columns, rows, thumb_width, thumb_height,
      interval_seconds, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    id, input.video_id,
    input.columns ?? 10, input.rows ?? 10,
    input.thumb_width ?? 160, input.thumb_height ?? 90,
    input.interval_seconds ?? 10, now, now,
  );
  return getThumbnailStrip(id)!;
}

export function getThumbnailStrip(id: string): ThumbnailStrip | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM thumbnail_strips WHERE id = ?').get(id) as TsRow | undefined;
  return row ? tsRowToObj(row) : null;
}

export function listThumbnailStrips(videoId: string): ThumbnailStrip[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM thumbnail_strips WHERE video_id = ? ORDER BY created_at DESC')
    .all(videoId) as TsRow[];
  return rows.map(tsRowToObj);
}

export function updateThumbnailStrip(id: string, patch: {
  sprite_url?: string | null; vtt_url?: string | null;
  status?: ThumbnailStrip['status'];
}): ThumbnailStrip | null {
  const db = getDb();
  const cur = getThumbnailStrip(id);
  if (!cur) return null;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE thumbnail_strips SET sprite_url = ?, vtt_url = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(
    patch.sprite_url !== undefined ? patch.sprite_url : cur.sprite_url,
    patch.vtt_url !== undefined ? patch.vtt_url : cur.vtt_url,
    patch.status ?? cur.status, now, id,
  );
  return getThumbnailStrip(id);
}

/**
 * Build ffmpeg args for generating a thumbnail sprite (tiled mosaic).
 */
export function buildThumbnailSpriteCommand(
  inputPath: string, outputPath: string,
  columns: number, rows: number, intervalSeconds: number,
  thumbWidth: number, thumbHeight: number,
): string[] {
  const total = columns * rows;
  return [
    '-y', '-i', inputPath,
    '-vf', `fps=1/${intervalSeconds},scale=${thumbWidth}:${thumbHeight},tile=${columns}x${rows}`,
    '-frames:v', '1',
    '-q:v', '4',
    `-frames:v`, '1',
    outputPath,
  ];
  void total;
}

/**
 * Build WebVTT cue file for a thumbnail strip (used by player scrub preview).
 * Returns the .vtt content as a string.
 */
export function buildThumbVtt(strip: ThumbnailStrip, totalDuration: number): string {
  const lines: string[] = ['WEBVTT', ''];
  const total = strip.columns * strip.rows;
  const interval = strip.interval_seconds;
  for (let i = 0; i < total; i++) {
    const start = i * interval;
    if (totalDuration > 0 && start > totalDuration) break;
    const end = Math.min(start + interval, totalDuration || start + interval);
    const col = i % strip.columns;
    const row = Math.floor(i / strip.columns);
    const x = col * strip.thumb_width;
    const y = row * strip.thumb_height;
    const fmt = (t: number) => {
      const h = String(Math.floor(t / 3600)).padStart(2, '0');
      const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
      const s = (t % 60).toFixed(3).padStart(6, '0');
      return `${h}:${m}:${s}`;
    };
    lines.push(`${i + 1}`);
    lines.push(`${fmt(start)} --> ${fmt(end)}`);
    lines.push(`${strip.sprite_url ?? 'sprite.jpg'}#xywh=${x},${y},${strip.thumb_width},${strip.thumb_height}`);
    lines.push('');
  }
  return lines.join('\n');
}

// ---------- Worker: actual ffmpeg execution ----------

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

export interface WorkerResult {
  ok: boolean;
  outputUrl?: string;
  duration?: number;
  sizeBytes?: number;
  error?: string;
}

function runFfmpeg(args: string[]): Promise<{ ok: boolean; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    if (!existsSync('/usr/bin/ffmpeg')) {
      resolve({ ok: false, stderr: 'ffmpeg not found', stdout: '' });
      return;
    }
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let stdout = '';
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    proc.on('error', (e) => resolve({ ok: false, stderr: e.message, stdout }));
    proc.on('close', (code) => resolve({ ok: code === 0, stderr, stdout }));
  });
}

/**
 * Run scene detection on an input file using ffmpeg's scene filter.
 * Updates the scene_analyses record with parsed scenes.
 */
export async function runSceneDetection(
  analysisId: string, inputPath: string, totalDuration: number,
): Promise<SceneAnalysis | null> {
  const a = getSceneAnalysis(analysisId);
  if (!a) return null;
  updateSceneAnalysis(analysisId, { status: 'running' });
  const args = buildSceneDetectionCommand(inputPath, a.threshold);
  const r = await runFfmpeg(args);
  if (!r.ok) {
    return updateSceneAnalysis(analysisId, {
      status: 'failed',
      error_text: r.stderr.slice(-500),
    });
  }
  const scenes = parseSceneTimestamps(r.stderr, totalDuration);
  return updateSceneAnalysis(analysisId, {
    status: 'ready',
    scenes,
    scene_count: scenes.length,
    duration_seconds: totalDuration,
  });
}

/**
 * Execute a preview job: cut + concat segments → output file.
 * Caller is responsible for planning segments first (or use auto-plan).
 */
export async function runPreviewJob(
  jobId: string, inputPath: string, outputPath: string,
): Promise<PreviewJob | null> {
  const job = getPreviewJob(jobId);
  if (!job) return null;
  const segments = listSegments({ job_id: jobId });
  if (!segments.length) {
    return updatePreviewJob(jobId, { status: 'failed', error_text: 'no segments defined' });
  }
  updatePreviewJob(jobId, { status: 'cutting', progress: 10 });

  const clips: ConcatClip[] = segments.map((s) => ({
    video_id: job.video_id, input_path: inputPath,
    start_seconds: s.start_seconds, end_seconds: s.end_seconds,
  }));
  const args = buildConcatCommand(inputPath, clips, outputPath);
  updatePreviewJob(jobId, { status: 'encoding', progress: 40 });

  const r = await runFfmpeg(args);
  if (!r.ok) {
    return updatePreviewJob(jobId, {
      status: 'failed',
      error_text: r.stderr.slice(-500),
      progress: 0,
    });
  }
  // total duration = sum of segments
  const dur = segments.reduce((sum, s) => sum + (s.end_seconds - s.start_seconds), 0);
  return updatePreviewJob(jobId, {
    status: 'ready',
    progress: 100,
    output_url: outputPath,
    output_duration_seconds: Math.round(dur * 100) / 100,
  });
}

/**
 * Convenience: create + auto-plan a trailer/teaser/highlight job from
 * an existing scene analysis, then execute.
 */
export async function autoGeneratePreview(input: {
  video_id: string;
  kind: PreviewKind;
  target_duration_seconds?: number;
  inputPath: string;
  outputPath: string;
  created_by?: string;
}): Promise<PreviewJob> {
  const job = createPreviewJob({
    video_id: input.video_id,
    kind: input.kind,
    target_duration_seconds: input.target_duration_seconds,
    created_by: input.created_by,
  });
  // find latest scene analysis
  const analyses = listSceneAnalyses(input.video_id);
  const latest = analyses.find((a) => a.status === 'ready');
  if (latest && latest.scenes.length) {
    const spec = PRESETS[input.kind];
    const plan = buildPlanFromScenes(latest.scenes, job.target_duration_seconds, spec.segments);
    replaceJobSegments(job.id, input.video_id, plan);
  } else {
    // Fallback: even distribution across total duration
    const total = 300; // fallback assumption
    const n = PRESETS[input.kind].segments;
    const segLen = job.target_duration_seconds / n;
    const step = total / n;
    const plan: Array<{ start_seconds: number; end_seconds: number; score: number }> = [];
    for (let i = 0; i < n; i++) {
      plan.push({
        start_seconds: i * step,
        end_seconds: i * step + segLen,
        score: 0.5,
      });
    }
    replaceJobSegments(job.id, input.video_id, plan);
  }
  return (await runPreviewJob(job.id, input.inputPath, input.outputPath)) ?? job;
}

/**
 * Run a single preview clip cut (48.2).
 */
export async function runPreviewClip(
  clipId: string, inputPath: string, outputPath: string,
  format: 'mp4' | 'hls' = 'mp4',
): Promise<PreviewClip | null> {
  const clip = getPreviewClip(clipId);
  if (!clip) return null;
  const args = buildCutCommand(inputPath, clip.start_seconds, clip.end_seconds, outputPath, format);
  const r = await runFfmpeg(args);
  if (!r.ok) {
    return updatePreviewClip(clipId, { status: 'failed' });
  }
  return updatePreviewClip(clipId, {
    status: 'ready',
    ...(format === 'hls' ? { hls_url: outputPath } : { mp4_url: outputPath }),
  });
}

/**
 * Run thumbnail sprite generation (BONUS).
 */
export async function runThumbnailStrip(
  stripId: string, inputPath: string, outputPath: string,
): Promise<ThumbnailStrip | null> {
  const s = getThumbnailStrip(stripId);
  if (!s) return null;
  const args = buildThumbnailSpriteCommand(inputPath, outputPath, s.columns, s.rows, s.interval_seconds, s.thumb_width, s.thumb_height);
  const r = await runFfmpeg(args);
  if (!r.ok) {
    return updateThumbnailStrip(stripId, { status: 'failed' });
  }
  return updateThumbnailStrip(stripId, { status: 'ready', sprite_url: outputPath });
}

/**
 * Auto-derive chapters from a ready scene analysis (BONUS).
 * Names are simple "Chapter N — MM:SS"; caller can override titles.
 */
export function deriveAutoChapters(videoId: string, analysisId: string): AutoChapter[] {
  const a = getSceneAnalysis(analysisId);
  if (!a || a.status !== 'ready') return [];
  // coalesce tiny scenes into at least 20-second chapters
  const MIN_CHAPTER = 20;
  const coalesced: Array<{ start: number; end: number }> = [];
  let curStart = a.scenes[0]?.start ?? 0;
  for (let i = 0; i < a.scenes.length; i++) {
    const s = a.scenes[i];
    const next = a.scenes[i + 1];
    if (next && (next.end - curStart) < MIN_CHAPTER) continue;
    coalesced.push({ start: curStart, end: s.end });
    curStart = next?.start ?? s.end;
  }
  return replaceAutoChapters(videoId, coalesced.map((c, i) => ({
    title: `Chapter ${i + 1} — ${fmtTime(c.start)}`,
    start_seconds: c.start,
    end_seconds: c.end,
    scene_analysis_id: analysisId,
    confidence: 0.7,
  })));
}

function fmtTime(t: number): string {
  const m = String(Math.floor(t / 60)).padStart(2, '0');
  const s = String(Math.floor(t % 60)).padStart(2, '0');
  return `${m}:${s}`;
}
