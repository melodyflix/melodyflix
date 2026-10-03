// melodyflix live — Auto Highlight (7.6)
// Detects exciting moments in a live stream from signals:
//   - chat message rate spike
//   - superchat burst
//   - viewer count spike
//   - manual bookmark from broadcaster/moderator
// Produces "highlight" clips with offset (from stream start) + metadata.

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export function ensureHighlightSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS stream_highlights (
      id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      offset_seconds REAL NOT NULL,
      duration_seconds REAL NOT NULL DEFAULT 30,
      score REAL NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'auto'
        CHECK (source IN ('auto','manual','superchat','chat_spike','viewer_spike')),
      title TEXT,
      description TEXT,
      chat_rate_at T REAL NOT NULL DEFAULT 0,
      viewer_count_at INTEGER NOT NULL DEFAULT 0,
      superchat_total REAL NOT NULL DEFAULT 0,
      labels_json TEXT,
      is_public INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hl_stream_score
      ON stream_highlights(stream_id, score DESC, offset_seconds ASC);

    -- Rolling signal samples used to compute rates
    CREATE TABLE IF NOT EXISTS stream_signal_samples (
      id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL,
      sampled_at TEXT NOT NULL,
      offset_seconds REAL NOT NULL,
      chat_count INTEGER NOT NULL DEFAULT 0,
      viewer_count INTEGER NOT NULL DEFAULT 0,
      superchat_total REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_signal_stream_time
      ON stream_signal_samples(stream_id, sampled_at DESC);
  `);
}

export type HighlightSource = 'auto' | 'manual' | 'superchat' | 'chat_spike' | 'viewer_spike';

export interface StreamHighlight {
  id: string;
  stream_id: string;
  detected_at: string;
  offset_seconds: number;
  duration_seconds: number;
  score: number;
  source: HighlightSource;
  title: string | null;
  description: string | null;
  chat_rate_at: number;
  viewer_count_at: number;
  superchat_total: number;
  labels_json: string | null;
  is_public: number;
  created_at: string;
}

// ---------- Signal sampling ----------

export interface SignalSampleInput {
  streamId: string;
  offsetSeconds: number;
  chatCount: number;
  viewerCount: number;
  superchatTotal: number;
}

export function recordSignalSample(input: SignalSampleInput): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO stream_signal_samples
      (id, stream_id, sampled_at, offset_seconds, chat_count, viewer_count, superchat_total)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), input.streamId, now, input.offsetSeconds,
    Math.max(0, input.chatCount | 0),
    Math.max(0, input.viewerCount | 0),
    Math.max(0, input.superchatTotal),
  );
}

export interface SignalSampleRow {
  id: string;
  stream_id: string;
  sampled_at: string;
  offset_seconds: number;
  chat_count: number;
  viewer_count: number;
  superchat_total: number;
}

export function listSignalSamples(streamId: string, limit = 200): SignalSampleRow[] {
  const n = Math.min(Math.max(limit, 1), 1000);
  return getDb().prepare(
    'SELECT * FROM stream_signal_samples WHERE stream_id = ? ORDER BY sampled_at DESC LIMIT ?'
  ).all(streamId, n) as SignalSampleRow[];
}

// ---------- Highlights CRUD ----------

export interface CreateHighlightInput {
  streamId: string;
  offsetSeconds: number;
  durationSeconds?: number;
  score?: number;
  source?: HighlightSource;
  title?: string | null;
  description?: string | null;
  chatRateAt?: number;
  viewerCountAt?: number;
  superchatTotal?: number;
  labels?: string[];
  isPublic?: boolean;
}

export function createHighlight(input: CreateHighlightInput): StreamHighlight {
  const offset = Math.max(0, input.offsetSeconds);
  const dur = Math.max(5, Math.min(input.durationSeconds ?? 30, 300));
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO stream_highlights
      (id, stream_id, detected_at, offset_seconds, duration_seconds, score,
       source, title, description, chat_rate_at, viewer_count_at,
       superchat_total, labels_json, is_public, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.streamId, now, offset, dur,
    Math.max(0, input.score ?? 0),
    input.source ?? 'auto',
    input.title ?? null, input.description ?? null,
    input.chatRateAt ?? 0, input.viewerCountAt ?? 0,
    input.superchatTotal ?? 0,
    input.labels ? JSON.stringify(input.labels) : null,
    input.isPublic === false ? 0 : 1,
    now,
  );
  return getHighlight(id)!;
}

export function getHighlight(id: string): StreamHighlight | null {
  return (getDb().prepare('SELECT * FROM stream_highlights WHERE id = ?').get(id) as StreamHighlight | undefined) ?? null;
}

export function listHighlights(streamId: string, opts: { limit?: number; publicOnly?: boolean } = {}): StreamHighlight[] {
  const n = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const where: string[] = ['stream_id = ?'];
  if (opts.publicOnly) where.push('is_public = 1');
  return getDb().prepare(`
    SELECT * FROM stream_highlights
    WHERE ${where.join(' AND ')}
    ORDER BY score DESC, offset_seconds ASC LIMIT ?
  `).all(streamId, n) as StreamHighlight[];
}

export function updateHighlight(
  id: string,
  patch: { title?: string | null; description?: string | null; durationSeconds?: number; isPublic?: boolean; labels?: string[] },
): StreamHighlight | null {
  const cur = getHighlight(id);
  if (!cur) return null;
  const fields: string[] = [];
  const values: any[] = [];
  if (patch.title !== undefined) { fields.push('title = ?'); values.push(patch.title); }
  if (patch.description !== undefined) { fields.push('description = ?'); values.push(patch.description); }
  if (patch.durationSeconds !== undefined) {
    fields.push('duration_seconds = ?');
    values.push(Math.max(5, Math.min(patch.durationSeconds, 300)));
  }
  if (patch.isPublic !== undefined) { fields.push('is_public = ?'); values.push(patch.isPublic ? 1 : 0); }
  if (patch.labels !== undefined) { fields.push('labels_json = ?'); values.push(JSON.stringify(patch.labels)); }
  if (fields.length === 0) return cur;
  values.push(id);
  getDb().prepare(`UPDATE stream_highlights SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getHighlight(id);
}

export function deleteHighlight(id: string): boolean {
  return getDb().prepare('DELETE FROM stream_highlights WHERE id = ?').run(id).changes > 0;
}

// ---------- Auto-detection ----------
// Given recent signal samples, detect spikes and produce candidate highlights.

export interface AutoDetectOptions {
  lookbackSamples?: number;    // how many recent samples to consider (default 30)
  chatRateMultiplier?: number; // chat spike = chat_count >= baseline * mult (default 3)
  viewerRateMultiplier?: number; // viewer spike = viewer_count >= baseline * mult (default 2)
  superchatThreshold?: number;  // min superchat $ in a sample to auto-tag (default 5)
  minScore?: number;            // only emit candidates above this score (default 1)
  durationSeconds?: number;     // highlight duration (default 30)
  dedupeSeconds?: number;       // suppress new highlights within Ns of an existing one (default 20)
  publicByDefault?: boolean;
}

export interface DetectedHighlight {
  offsetSeconds: number;
  durationSeconds: number;
  score: number;
  source: HighlightSource;
  title: string | null;
  chatRateAt: number;
  viewerCountAt: number;
  superchatTotal: number;
  labels: string[];
}

// Pure function — no DB writes. Caller decides whether to persist.
export function detectHighlightsFromSamples(
  samples: SignalSampleRow[],
  opts: AutoDetectOptions = {},
): DetectedHighlight[] {
  const lookback = opts.lookbackSamples ?? 30;
  const chatMult = opts.chatRateMultiplier ?? 3;
  const viewerMult = opts.viewerRateMultiplier ?? 2;
  const scThreshold = opts.superchatThreshold ?? 5;
  const minScore = opts.minScore ?? 1;
  const dur = opts.durationSeconds ?? 30;

  // Samples are DESC in DB order; sort ASC for chronological processing
  const chron = [...samples].sort((a, b) => a.offset_seconds - b.offset_seconds);
  const recent = chron.slice(-lookback);
  if (recent.length < 3) return [];

  // Baseline = median of the sample counts
  const chatCounts = recent.map((s) => s.chat_count).sort((a, b) => a - b);
  const viewerCounts = recent.map((s) => s.viewer_count).sort((a, b) => a - b);
  const chatBase = Math.max(1, chatCounts[Math.floor(chatCounts.length / 2)] ?? 1);
  const viewerBase = Math.max(1, viewerCounts[Math.floor(viewerCounts.length / 2)] ?? 1);

  const out: DetectedHighlight[] = [];
  for (const s of recent) {
    const chatRatio = s.chat_count / chatBase;
    const viewerRatio = s.viewer_count / viewerBase;

    const labels: string[] = [];
    let source: HighlightSource | null = null;
    let score = 0;

    if (s.superchat_total >= scThreshold) {
      labels.push('superchat');
      source = 'superchat';
      score += Math.min(5, s.superchat_total / scThreshold);
    }
    if (chatRatio >= chatMult) {
      labels.push('chat_spike');
      source = source ?? 'chat_spike';
      score += Math.min(5, chatRatio - chatMult + 1);
    }
    if (viewerRatio >= viewerMult) {
      labels.push('viewer_spike');
      source = source ?? 'viewer_spike';
      score += Math.min(3, viewerRatio - viewerMult + 1);
    }

    if (!source || score < minScore) continue;

    out.push({
      offsetSeconds: s.offset_seconds,
      durationSeconds: dur,
      score: Number(score.toFixed(2)),
      source,
      title: null,
      chatRateAt: s.chat_count,
      viewerCountAt: s.viewer_count,
      superchatTotal: s.superchat_total,
      labels,
    });
  }

  return out;
}

// Persist a set of candidates, deduping against existing highlights within
// dedupeSeconds of the same offset.
export function persistDetectedHighlights(
  streamId: string,
  candidates: DetectedHighlight[],
  opts: AutoDetectOptions = {},
): StreamHighlight[] {
  const dedupeS = opts.dedupeSeconds ?? 20;
  const publicByDefault = opts.publicByDefault !== false;
  const db = getDb();
  const existing = listHighlights(streamId, { limit: 200 }).map((h) => h.offset_seconds);

  const created: StreamHighlight[] = [];
  for (const c of candidates) {
    const clash = existing.some((off) => Math.abs(off - c.offsetSeconds) <= dedupeS);
    if (clash) continue;
    created.push(createHighlight({
      streamId,
      offsetSeconds: c.offsetSeconds,
      durationSeconds: c.durationSeconds,
      score: c.score,
      source: c.source,
      title: c.title,
      chatRateAt: c.chatRateAt,
      viewerCountAt: c.viewerCountAt,
      superchatTotal: c.superchatTotal,
      labels: c.labels,
      isPublic: publicByDefault,
    }));
    existing.push(c.offsetSeconds);
  }
  return created;
}

// One-shot: read samples → detect → persist → return created
export function runAutoHighlight(streamId: string, opts: AutoDetectOptions = {}): StreamHighlight[] {
  const samples = listSignalSamples(streamId, (opts.lookbackSamples ?? 30) * 2);
  const candidates = detectHighlightsFromSamples(samples, opts);
  return persistDetectedHighlights(streamId, candidates, opts);
}

// Manual bookmark-style highlight
export function createManualHighlight(input: {
  streamId: string;
  offsetSeconds: number;
  title?: string | null;
  durationSeconds?: number;
  labels?: string[];
}): StreamHighlight {
  return createHighlight({
    streamId: input.streamId,
    offsetSeconds: input.offsetSeconds,
    durationSeconds: input.durationSeconds ?? 30,
    score: 10,
    source: 'manual',
    title: input.title ?? null,
    labels: input.labels,
  });
}

export interface HighlightStats {
  stream_id: string;
  total: number;
  auto: number;
  manual: number;
  by_source: { source: string; count: number }[];
  top_score: number;
}

export function getHighlightStats(streamId: string): HighlightStats {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as n FROM stream_highlights WHERE stream_id = ?')
    .get(streamId) as { n: number }).n;
  const auto = (db.prepare(`SELECT COUNT(*) as n FROM stream_highlights WHERE stream_id = ? AND source != 'manual'`)
    .get(streamId) as { n: number }).n;
  const manual = total - auto;
  const bySource = db.prepare(
    'SELECT source, COUNT(*) as count FROM stream_highlights WHERE stream_id = ? GROUP BY source'
  ).all(streamId) as { source: string; count: number }[];
  const top = (db.prepare('SELECT COALESCE(MAX(score), 0) as s FROM stream_highlights WHERE stream_id = ?')
    .get(streamId) as { s: number }).s;
  return {
    stream_id: streamId,
    total,
    auto,
    manual,
    by_source: bySource,
    top_score: top,
  };
}
