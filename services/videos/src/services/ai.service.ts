// melodyflix videos — AI Features (Section 8)
// Provider-agnostic AI wrapper. Default = MOCK mode (deterministic results
// for tests). Enable real provider with MELODYFLIX_AI_ENABLED=1 and set
// AI_PROVIDER_URL + AI_PROVIDER_KEY (OpenAI-compatible chat completions).
//
// Every feature is a thin orchestration layer over:
//   - invokeText(prompt, opts) → LLM text (chat completions)
//   - mockText(feature, input) → deterministic mock
//   - Background job queue for long-running tasks (translation/dubbing)

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

// ============================================================
// Schema — job queue + per-feature result caches
// ============================================================

export function ensureAiSchema(): void {
  const db = getDb();
  db.exec(`
    -- Background jobs for AI tasks that need provider calls
    CREATE TABLE IF NOT EXISTS ai_jobs (
      id TEXT PRIMARY KEY,
      feature TEXT NOT NULL,
      subject_type TEXT NOT NULL,     -- 'video' | 'comment' | 'user' | 'prompt'
      subject_id TEXT NOT NULL,
      requester_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
      input_json TEXT,
      output_json TEXT,
      provider TEXT,
      model TEXT,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ai_jobs_feature
      ON ai_jobs(feature, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_jobs_subject
      ON ai_jobs(subject_type, subject_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_jobs_status
      ON ai_jobs(status, created_at);

    -- 8.1 Captions
    CREATE TABLE IF NOT EXISTS ai_captions (
      video_id TEXT PRIMARY KEY,
      language TEXT NOT NULL DEFAULT 'en',
      vtt_content TEXT NOT NULL,
      srt_content TEXT,
      word_count INTEGER NOT NULL DEFAULT 0,
      is_auto INTEGER NOT NULL DEFAULT 1,
      provider TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 8.2 Translation (per language per video)
    CREATE TABLE IF NOT EXISTS ai_translations (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      source_language TEXT NOT NULL,
      target_language TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'captions',
      content TEXT NOT NULL,
      provider TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (video_id, target_language, content_type)
    );
    CREATE INDEX IF NOT EXISTS idx_ai_trans_video
      ON ai_translations(video_id, target_language);

    -- 8.4 Video Summary
    CREATE TABLE IF NOT EXISTS ai_summaries (
      video_id TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      key_points_json TEXT,
      length_tokens INTEGER NOT NULL DEFAULT 0,
      language TEXT NOT NULL DEFAULT 'en',
      provider TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 8.7 Key Moments
    CREATE TABLE IF NOT EXISTS ai_key_moments (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      offset_seconds REAL NOT NULL,
      label TEXT NOT NULL,
      description TEXT,
      confidence REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_keymoments_video
      ON ai_key_moments(video_id, offset_seconds);

    -- 8.11-8.16 Content safety: shared flag store
    CREATE TABLE IF NOT EXISTS ai_content_flags (
      id TEXT PRIMARY KEY,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      feature TEXT NOT NULL,
      category TEXT,
      score REAL NOT NULL DEFAULT 0,
      severity TEXT NOT NULL DEFAULT 'low'
        CHECK (severity IN ('low','medium','high','critical')),
      evidence_json TEXT,
      action_taken TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_flags_subject
      ON ai_content_flags(subject_type, subject_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_flags_feature
      ON ai_content_flags(feature, severity, created_at DESC);

    -- 8.15/8.16: inline filter results per request
    CREATE TABLE IF NOT EXISTS ai_safety_checks (
      id TEXT PRIMARY KEY,
      feature TEXT NOT NULL,
      input_hash TEXT,
      verdict TEXT NOT NULL
        CHECK (verdict IN ('safe','review','blocked')),
      score REAL NOT NULL DEFAULT 0,
      categories_json TEXT,
      rationale TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_safety_feature
      ON ai_safety_checks(feature, created_at DESC);
  `);
}

// ============================================================
// Provider wrapper
// ============================================================

function isAiEnabled(): boolean {
  return process.env.MELODYFLIX_AI_ENABLED === '1';
}

function providerConfig() {
  return {
    url: process.env.AI_PROVIDER_URL ?? '',
    key: process.env.AI_PROVIDER_KEY ?? '',
    model: process.env.AI_MODEL ?? 'gpt-4o-mini',
  };
}

export interface TextInvokeOptions {
  system?: string;
  temperature?: number;
  max_tokens?: number;
  timeout_ms?: number;
}

export interface TextInvokeResult {
  text: string;
  provider: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
}

// Deterministic mock text — feature+input hash-based, so tests are stable.
export function mockText(feature: string, hint: string): string {
  const hash = simpleHash(feature + '::' + hint);
  const templates: Record<string, string[]> = {
    captions: [
      'WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nThis is an auto-generated caption.\n\n00:00:03.000 --> 00:00:06.000\nSecond line of the mock track.',
      'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nWelcome to the mock caption demo.',
    ],
    translation: [
      `[${hint}] translated text (mock) — meaning preserved.`,
    ],
    summary: [
      `Mock summary: this video covers ${hint}. It has three key sections and concludes with a demonstration.`,
    ],
    title_suggest: [
      `Amazing ${hint} — Full Guide`,
      `${hint} Explained in 5 Minutes`,
      `The Truth About ${hint}`,
    ],
    key_moments: [
      'intro at 0s; demo at 45s; conclusion at 120s',
    ],
    safety: [
      'SAFE: no policy violation detected in mock mode.',
    ],
  };
  const arr = templates[feature] ?? [`mock:${feature}:${hash}`];
  return arr[hash % arr.length];
}

function simpleHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export async function invokeText(
  feature: string,
  userPrompt: string,
  opts: TextInvokeOptions = {},
): Promise<TextInvokeResult> {
  const cfg = providerConfig();
  if (!isAiEnabled() || !cfg.url || !cfg.key) {
    return {
      text: mockText(feature, userPrompt.slice(0, 80)),
      provider: 'mock',
      model: 'mock-1',
      tokens_in: 0,
      tokens_out: 0,
    };
  }

  const body = JSON.stringify({
    model: cfg.model,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.max_tokens ?? 800,
    messages: [
      ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
      { role: 'user', content: userPrompt },
    ],
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout_ms ?? 25_000);
  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.key}`,
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`AI provider ${res.status}`);
    const json = await res.json() as any;
    const text = json?.choices?.[0]?.message?.content ?? '';
    return {
      text: typeof text === 'string' ? text : '',
      provider: 'openai-compatible',
      model: cfg.model,
      tokens_in: json?.usage?.prompt_tokens ?? 0,
      tokens_out: json?.usage?.completion_tokens ?? 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// Job queue (for provider-backed long tasks)
// ============================================================

export type AiJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type AiFeature =
  | 'caption' | 'translation' | 'dubbing' | 'summary'
  | 'thumbnail' | 'auto_tag' | 'key_moments'
  | 'audio_dubbing' | 'voice_clone' | 'realtime_translate'
  | 'content_filter' | 'inappropriate' | 'spam' | 'fake_account'
  | 'hallucination' | 'prompt_safety';

export interface AiJob {
  id: string;
  feature: AiFeature;
  subject_type: string;
  subject_id: string;
  requester_id: string;
  status: AiJobStatus;
  input_json: string | null;
  output_json: string | null;
  provider: string | null;
  model: string | null;
  tokens_in: number;
  tokens_out: number;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface CreateAiJobInput {
  feature: AiFeature;
  subject_type: string;
  subject_id: string;
  requester_id: string;
  input?: Record<string, any>;
}

export function createAiJob(input: CreateAiJobInput): AiJob {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO ai_jobs
      (id, feature, subject_type, subject_id, requester_id, status, input_json, created_at)
    VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)
  `).run(
    id, input.feature, input.subject_type, input.subject_id, input.requester_id,
    input.input ? JSON.stringify(input.input) : null, now,
  );
  return getAiJob(id)!;
}

export function getAiJob(id: string): AiJob | null {
  return (getDb().prepare('SELECT * FROM ai_jobs WHERE id = ?').get(id) as AiJob | undefined) ?? null;
}

export function listAiJobs(opts: {
  feature?: AiFeature;
  subject_type?: string;
  subject_id?: string;
  status?: AiJobStatus;
  limit?: number;
} = {}): AiJob[] {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];
  if (opts.feature) { where.push('feature = ?'); params.push(opts.feature); }
  if (opts.subject_type) { where.push('subject_type = ?'); params.push(opts.subject_type); }
  if (opts.subject_id) { where.push('subject_id = ?'); params.push(opts.subject_id); }
  if (opts.status) { where.push('status = ?'); params.push(opts.status); }
  const n = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  params.push(n);
  return db.prepare(`
    SELECT * FROM ai_jobs
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT ?
  `).all(...params) as AiJob[];
}

export function listQueuedAiJobs(limit = 10): AiJob[] {
  const n = Math.min(Math.max(limit, 1), 50);
  return getDb().prepare(`
    SELECT * FROM ai_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?
  `).all(n) as AiJob[];
}

export function markAiJobRunning(id: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`UPDATE ai_jobs SET status = 'running', started_at = ? WHERE id = ?`).run(now, id);
}

export function markAiJobDone(id: string, opts: {
  provider?: string | null;
  model?: string | null;
  output: Record<string, any>;
  tokens_in?: number;
  tokens_out?: number;
}): AiJob | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE ai_jobs SET status = 'succeeded', output_json = ?, provider = ?, model = ?,
      tokens_in = ?, tokens_out = ?, finished_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify(opts.output),
    opts.provider ?? null, opts.model ?? null,
    opts.tokens_in ?? 0, opts.tokens_out ?? 0, now, id,
  );
  return getAiJob(id);
}

export function markAiJobFailed(id: string, errorMessage: string): AiJob | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`UPDATE ai_jobs
    SET status = 'failed', error_message = ?, finished_at = ? WHERE id = ?`)
    .run(errorMessage.slice(0, 500), now, id);
  return getAiJob(id);
}

export function cancelAiJob(id: string, requesterId: string): boolean {
  const db = getDb();
  const j = getAiJob(id);
  if (!j) return false;
  if (j.requester_id !== requesterId) throw new Error('Not your job');
  if (j.status === 'succeeded') throw new Error('Job already succeeded');
  db.prepare(`UPDATE ai_jobs SET status = 'cancelled', finished_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), id);
  return true;
}

// ============================================================
// 8.1 Auto Caption
// ============================================================

export interface AiCaption {
  video_id: string;
  language: string;
  vtt_content: string;
  srt_content: string | null;
  word_count: number;
  is_auto: number;
  provider: string | null;
  created_at: string;
  updated_at: string;
}

export function getCaption(videoId: string): AiCaption | null {
  return (getDb().prepare('SELECT * FROM ai_captions WHERE video_id = ?')
    .get(videoId) as AiCaption | undefined) ?? null;
}

export function saveCaption(input: {
  video_id: string;
  language?: string;
  vtt_content: string;
  srt_content?: string | null;
  is_auto?: boolean;
  provider?: string | null;
}): AiCaption {
  const db = getDb();
  const now = new Date().toISOString();
  const wordCount = input.vtt_content.split(/\s+/).filter(Boolean).length;
  const language = (input.language ?? 'en').toLowerCase().slice(0, 8);

  db.prepare(`
    INSERT INTO ai_captions
      (video_id, language, vtt_content, srt_content, word_count, is_auto, provider, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id) DO UPDATE SET
      language = excluded.language,
      vtt_content = excluded.vtt_content,
      srt_content = excluded.srt_content,
      word_count = excluded.word_count,
      is_auto = excluded.is_auto,
      provider = excluded.provider,
      updated_at = excluded.updated_at
  `).run(
    input.video_id, language, input.vtt_content,
    input.srt_content ?? null, wordCount,
    input.is_auto === false ? 0 : 1,
    input.provider ?? null, now, now,
  );
  return getCaption(input.video_id)!;
}

export async function generateCaption(input: {
  video_id: string;
  language?: string;
  transcript?: string;
  requester_id?: string;
}): Promise<{ caption: AiCaption; job: AiJob }> {
  const hint = input.transcript?.slice(0, 100) ?? input.video_id;
  const res = await invokeText('captions', hint, {
    system: 'You generate WebVTT captions from transcripts. Output only VTT.',
  });
  const vtt = res.text.startsWith('WEBVTT') ? res.text : `WEBVTT\n\n00:00:00.000 --> 00:00:03.000\n${res.text}`;
  const caption = saveCaption({
    video_id: input.video_id,
    language: input.language,
    vtt_content: vtt,
    is_auto: true,
    provider: res.provider,
  });
  const job = createAiJob({
    feature: 'caption',
    subject_type: 'video',
    subject_id: input.video_id,
    requester_id: input.requester_id ?? 'system',
    input: { language: input.language ?? 'en' },
  });
  markAiJobRunning(job.id);
  const done = markAiJobDone(job.id, {
    provider: res.provider, model: res.model,
    output: { video_id: input.video_id, word_count: caption.word_count },
    tokens_in: res.tokens_in, tokens_out: res.tokens_out,
  })!;
  return { caption, job: done };
}

// ============================================================
// 8.2 Translation
// ============================================================

export interface AiTranslation {
  id: string;
  video_id: string;
  source_language: string;
  target_language: string;
  content_type: string;
  content: string;
  provider: string | null;
  created_at: string;
}

export function getTranslation(videoId: string, targetLanguage: string, contentType = 'captions'): AiTranslation | null {
  return (getDb().prepare(`
    SELECT * FROM ai_translations
    WHERE video_id = ? AND target_language = ? AND content_type = ?
  `).get(videoId, targetLanguage.toLowerCase(), contentType) as AiTranslation | undefined) ?? null;
}

export function listTranslations(videoId: string): AiTranslation[] {
  return getDb().prepare(
    'SELECT * FROM ai_translations WHERE video_id = ? ORDER BY target_language ASC'
  ).all(videoId) as AiTranslation[];
}

export async function translateText(input: {
  video_id: string;
  source_language: string;
  target_language: string;
  content: string;
  content_type?: string;
  requester_id?: string;
}): Promise<{ translation: AiTranslation; job: AiJob }> {
  const target = input.target_language.toLowerCase().slice(0, 8);
  if (target === input.source_language.toLowerCase()) throw new Error('Target equals source');

  const res = await invokeText('translation', `${input.source_language}->${target} :: ${input.content.slice(0, 200)}`, {
    system: `Translate from ${input.source_language} to ${target}. Preserve timing markers for captions.`,
  });

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO ai_translations
      (id, video_id, source_language, target_language, content_type, content, provider, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id, target_language, content_type) DO UPDATE SET
      content = excluded.content,
      provider = excluded.provider,
      created_at = excluded.created_at
  `).run(
    id, input.video_id, input.source_language.toLowerCase(),
    target, input.content_type ?? 'captions',
    res.text, res.provider, now,
  );
  const translation = getTranslation(input.video_id, target, input.content_type ?? 'captions')!;

  const job = createAiJob({
    feature: 'translation',
    subject_type: 'video',
    subject_id: input.video_id,
    requester_id: input.requester_id ?? 'system',
    input: { target },
  });
  markAiJobRunning(job.id);
  const done = markAiJobDone(job.id, {
    provider: res.provider, model: res.model,
    output: { target_language: target },
    tokens_in: res.tokens_in, tokens_out: res.tokens_out,
  })!;
  return { translation, job: done };
}

// ============================================================
// 8.4 Video Summary
// ============================================================

export interface AiSummary {
  video_id: string;
  summary: string;
  key_points_json: string | null;
  length_tokens: number;
  language: string;
  provider: string | null;
  created_at: string;
  updated_at: string;
}

export function getSummary(videoId: string): AiSummary | null {
  return (getDb().prepare('SELECT * FROM ai_summaries WHERE video_id = ?')
    .get(videoId) as AiSummary | undefined) ?? null;
}

export async function generateSummary(input: {
  video_id: string;
  transcript: string;
  language?: string;
  requester_id?: string;
}): Promise<{ summary: AiSummary; job: AiJob }> {
  const res = await invokeText('summary', input.transcript.slice(0, 400), {
    system: 'Summarize the video in 2-3 sentences. Then list 3-5 key points as bullets.',
  });
  const lines = res.text.split('\n');
  const keyPoints = lines.filter((l) => /^[-*]/.test(l.trim())).map((l) => l.replace(/^[-*]\s*/, '').trim());
  const body = lines.filter((l) => !/^[-*]/.test(l.trim())).join(' ').trim() || res.text;

  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO ai_summaries
      (video_id, summary, key_points_json, length_tokens, language, provider, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id) DO UPDATE SET
      summary = excluded.summary,
      key_points_json = excluded.key_points_json,
      length_tokens = excluded.length_tokens,
      language = excluded.language,
      provider = excluded.provider,
      updated_at = excluded.updated_at
  `).run(
    input.video_id, body,
    keyPoints.length > 0 ? JSON.stringify(keyPoints) : null,
    res.tokens_out || body.split(/\s+/).length,
    (input.language ?? 'en').toLowerCase().slice(0, 8),
    res.provider, now, now,
  );

  const job = createAiJob({
    feature: 'summary',
    subject_type: 'video',
    subject_id: input.video_id,
    requester_id: input.requester_id ?? 'system',
  });
  markAiJobRunning(job.id);
  const done = markAiJobDone(job.id, {
    provider: res.provider, model: res.model,
    output: { video_id: input.video_id, key_points: keyPoints },
    tokens_in: res.tokens_in, tokens_out: res.tokens_out,
  })!;
  return { summary: getSummary(input.video_id)!, job: done };
}

// ============================================================
// 8.7 Key Moments
// ============================================================

export interface AiKeyMoment {
  id: string;
  video_id: string;
  offset_seconds: number;
  label: string;
  description: string | null;
  confidence: number;
  created_at: string;
}

export function listKeyMoments(videoId: string): AiKeyMoment[] {
  return getDb().prepare(
    'SELECT * FROM ai_key_moments WHERE video_id = ? ORDER BY offset_seconds ASC'
  ).all(videoId) as AiKeyMoment[];
}

export async function detectKeyMoments(input: {
  video_id: string;
  transcript: string;
  requester_id?: string;
}): Promise<{ moments: AiKeyMoment[]; job: AiJob }> {
  const res = await invokeText('key_moments', input.transcript.slice(0, 400), {
    system: 'Return up to 8 key moments as lines "MM:SS | label | description".',
  });
  const parsed: { offset_seconds: number; label: string; description: string | null }[] = [];
  for (const line of res.text.split('\n')) {
    const m = line.match(/^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*[\|\-–—]\s*([^|\-–—]+)(?:[\|\-–—]\s*(.+))?$/);
    if (!m) continue;
    const h = m[3] ? parseInt(m[1]) : 0;
    const mm = m[3] ? parseInt(m[2]) : parseInt(m[1]);
    const ss = m[3] ? parseInt(m[3]) : parseInt(m[2]);
    parsed.push({
      offset_seconds: h * 3600 + mm * 60 + ss,
      label: m[4].trim().slice(0, 100),
      description: m[5]?.trim() ?? null,
    });
  }
  // Fallback: if mock pattern didn't yield, split on ';'
  if (parsed.length === 0) {
    for (const seg of res.text.split(/[;\n]/)) {
      const m = seg.match(/(\d+)s/);
      if (!m) continue;
      parsed.push({ offset_seconds: parseInt(m[1]), label: seg.trim().slice(0, 100), description: null });
    }
  }

  const db = getDb();
  const now = new Date().toISOString();
  db.prepare('DELETE FROM ai_key_moments WHERE video_id = ?').run(input.video_id);
  const insert = db.prepare(`
    INSERT INTO ai_key_moments
      (id, video_id, offset_seconds, label, description, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  db.exec('BEGIN');
  try {
    for (const p of parsed) {
      insert.run(randomUUID(), input.video_id, p.offset_seconds, p.label, p.description, 0.85, now);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  const job = createAiJob({
    feature: 'key_moments',
    subject_type: 'video',
    subject_id: input.video_id,
    requester_id: input.requester_id ?? 'system',
  });
  markAiJobRunning(job.id);
  const done = markAiJobDone(job.id, {
    provider: res.provider, model: res.model,
    output: { count: parsed.length },
    tokens_in: res.tokens_in, tokens_out: res.tokens_out,
  })!;
  return { moments: listKeyMoments(input.video_id), job: done };
}

// ============================================================
// 8.6 Auto Tag (reuses existing tag pipeline for persistence)
// ============================================================

export interface SuggestedTag {
  tag: string;
  score: number;
}

export async function suggestTags(input: {
  title: string;
  description?: string | null;
  existing_tags?: string[];
  max?: number;
}): Promise<{ suggestions: SuggestedTag[]; job: AiJob }> {
  const max = Math.min(Math.max(input.max ?? 8, 1), 20);
  const res = await invokeText(
    'auto_tag',
    `title: ${input.title}\ndescription: ${(input.description ?? '').slice(0, 200)}`,
    { system: 'Return comma-separated lowercase tags (max 8), no # prefix.' },
  );
  const existing = new Set((input.existing_tags ?? []).map((t) => t.toLowerCase()));
  const tokens = res.text.split(/[,\n]+/).map((s) => s.trim().toLowerCase().replace(/^#/, ''))
    .filter((t) => t.length >= 2 && t.length <= 30 && !existing.has(t));
  const uniq = Array.from(new Set(tokens)).slice(0, max);
  const suggestions = uniq.map((t, i) => ({ tag: t, score: Math.max(0.4, 1 - i * 0.1) }));

  const job = createAiJob({
    feature: 'auto_tag',
    subject_type: 'video',
    subject_id: input.title.slice(0, 40),
    requester_id: 'system',
  });
  markAiJobRunning(job.id);
  const done = markAiJobDone(job.id, {
    provider: res.provider, model: res.model,
    output: { count: suggestions.length },
    tokens_in: res.tokens_in, tokens_out: res.tokens_out,
  })!;
  return { suggestions, job: done };
}

// ============================================================
// Summary of this module
// ============================================================

export function getAiSummary(): {
  jobs_total: number;
  by_status: { status: string; count: number }[];
  captions: number;
  translations: number;
  summaries: number;
  key_moments: number;
  provider_enabled: boolean;
} {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as n FROM ai_jobs').get() as { n: number }).n;
  const byStatus = db.prepare(
    'SELECT status, COUNT(*) as count FROM ai_jobs GROUP BY status'
  ).all() as { status: string; count: number }[];
  const captions = (db.prepare('SELECT COUNT(*) as n FROM ai_captions').get() as { n: number }).n;
  const translations = (db.prepare('SELECT COUNT(*) as n FROM ai_translations').get() as { n: number }).n;
  const summaries = (db.prepare('SELECT COUNT(*) as n FROM ai_summaries').get() as { n: number }).n;
  const keyMoments = (db.prepare('SELECT COUNT(*) as n FROM ai_key_moments').get() as { n: number }).n;
  return {
    jobs_total: total,
    by_status: byStatus,
    captions, translations, summaries, key_moments: keyMoments,
    provider_enabled: isAiEnabled(),
  };
}
