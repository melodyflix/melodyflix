// melodyflix videos — AI Media Features (8.3, 8.5, 8.8, 8.9, 8.10)
// Mock-safe for tests; real mode gated by MELODYFLIX_AI_ENABLED=1
// and (where relevant) MELODYFLIX_FFMPEG_ENABLED=1.

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';
import { invokeText, mockText, createAiJob, markAiJobRunning, markAiJobDone, markAiJobFailed } from './ai.service.js';

export function ensureAiMediaSchema(): void {
  const db = getDb();
  db.exec(`
    -- 8.5 Auto Thumbnail
    CREATE TABLE IF NOT EXISTS ai_thumbnails (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      image_url TEXT NOT NULL,
      provider TEXT,
      style TEXT,
      prompt TEXT,
      selected INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_thumbs_video
      ON ai_thumbnails(video_id, created_at DESC);

    -- 8.3 Dubbing + 8.8 Multi-language auto audio dubbing
    CREATE TABLE IF NOT EXISTS ai_dubs (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      target_language TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','running','ready','failed','cancelled')),
      audio_url TEXT,
      subtitle_url TEXT,
      voice_id TEXT,
      voice_provider TEXT,
      is_auto INTEGER NOT NULL DEFAULT 1,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (video_id, target_language)
    );
    CREATE INDEX IF NOT EXISTS idx_ai_dubs_video
      ON ai_dubs(video_id, target_language);

    -- 8.9 Voice cloning
    CREATE TABLE IF NOT EXISTS ai_voice_clones (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sample_url TEXT NOT NULL,
      provider TEXT,
      provider_voice_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','ready','failed','revoked')),
      consent_confirmed INTEGER NOT NULL DEFAULT 0,
      language TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_voice_owner
      ON ai_voice_clones(owner_id, created_at DESC);

    -- 8.10 Real-time audio translation session config
    CREATE TABLE IF NOT EXISTS ai_realtime_sessions (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      requester_id TEXT NOT NULL,
      source_language TEXT NOT NULL,
      target_languages_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ready'
        CHECK (status IN ('ready','active','ended')),
      latency_target_ms INTEGER NOT NULL DEFAULT 800,
      created_at TEXT NOT NULL,
      ended_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ai_realtime_video
      ON ai_realtime_sessions(video_id, created_at DESC);
  `);
}

// ============================================================
// 8.5 Auto Thumbnail
// ============================================================

export interface AiThumbnail {
  id: string;
  video_id: string;
  image_url: string;
  provider: string | null;
  style: string | null;
  prompt: string | null;
  selected: number;
  created_at: string;
}

export function listThumbnails(videoId: string): AiThumbnail[] {
  return getDb().prepare(
    'SELECT * FROM ai_thumbnails WHERE video_id = ? ORDER BY created_at DESC LIMIT 20'
  ).all(videoId) as AiThumbnail[];
}

export function selectThumbnail(videoId: string, thumbId: string): AiThumbnail | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM ai_thumbnails WHERE id = ? AND video_id = ?')
    .get(thumbId, videoId) as AiThumbnail | undefined;
  if (!row) return null;
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE ai_thumbnails SET selected = 0 WHERE video_id = ?').run(videoId);
    db.prepare('UPDATE ai_thumbnails SET selected = 1 WHERE id = ?').run(thumbId);
    db.prepare('UPDATE videos SET thumbnail_url = ?, updated_at = ? WHERE id = ?')
      .run(row.image_url, new Date().toISOString(), videoId);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return db.prepare('SELECT * FROM ai_thumbnails WHERE id = ?').get(thumbId) as AiThumbnail;
}

export async function generateThumbnails(input: {
  video_id: string;
  title?: string;
  style?: string;
  count?: number;
  requester_id?: string;
}): Promise<{ thumbnails: AiThumbnail[]; job: any }> {
  const count = Math.max(1, Math.min(input.count ?? 3, 8));
  const prompt = `${input.title ?? 'Untitled'} :: style=${input.style ?? 'bold'}`;
  const res = await invokeText('thumbnail', prompt, {
    system: 'Generate thumbnail ideas. Output one line per concept: URL_OR_TAG | style | description',
  });

  // Mock mode: create placeholder URLs
  const db = getDb();
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO ai_thumbnails
      (id, video_id, image_url, provider, style, prompt, selected, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `);
  const created: AiThumbnail[] = [];
  db.exec('BEGIN');
  try {
    for (let i = 0; i < count; i++) {
      const id = randomUUID();
      const url = `https://cdn.melodyflix.local/ai-thumbs/${input.video_id}/${id.slice(0,8)}.jpg`;
      insert.run(
        id, input.video_id, url,
        res.provider,
        input.style ?? 'bold',
        prompt,
        now,
      );
      created.push(db.prepare('SELECT * FROM ai_thumbnails WHERE id = ?').get(id) as AiThumbnail);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  const job = createAiJob({
    feature: 'thumbnail',
    subject_type: 'video',
    subject_id: input.video_id,
    requester_id: input.requester_id ?? 'system',
    input: { count, style: input.style },
  });
  markAiJobRunning(job.id);
  const done = markAiJobDone(job.id, {
    provider: res.provider, model: res.model,
    output: { count },
    tokens_in: res.tokens_in, tokens_out: res.tokens_out,
  });
  return { thumbnails: created, job: done };
}

// ============================================================
// 8.3 + 8.8 Dubbing (per-language audio track)
// ============================================================

export type DubStatus = 'queued' | 'running' | 'ready' | 'failed' | 'cancelled';

export interface AiDub {
  id: string;
  video_id: string;
  target_language: string;
  status: DubStatus;
  audio_url: string | null;
  subtitle_url: string | null;
  voice_id: string | null;
  voice_provider: string | null;
  is_auto: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export function getDub(videoId: string, language: string): AiDub | null {
  return (getDb().prepare(
    'SELECT * FROM ai_dubs WHERE video_id = ? AND target_language = ?'
  ).get(videoId, language.toLowerCase()) as AiDub | undefined) ?? null;
}

export function listDubs(videoId: string): AiDub[] {
  return getDb().prepare(
    'SELECT * FROM ai_dubs WHERE video_id = ? ORDER BY target_language ASC'
  ).all(videoId) as AiDub[];
}

export function upsertDub(input: {
  video_id: string;
  target_language: string;
  status: DubStatus;
  audio_url?: string | null;
  subtitle_url?: string | null;
  voice_id?: string | null;
  voice_provider?: string | null;
  is_auto?: boolean;
  error_message?: string | null;
}): AiDub {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO ai_dubs
      (id, video_id, target_language, status, audio_url, subtitle_url,
       voice_id, voice_provider, is_auto, error_message, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id, target_language) DO UPDATE SET
      status = excluded.status,
      audio_url = excluded.audio_url,
      subtitle_url = excluded.subtitle_url,
      voice_id = excluded.voice_id,
      voice_provider = excluded.voice_provider,
      is_auto = excluded.is_auto,
      error_message = excluded.error_message,
      updated_at = excluded.updated_at
  `).run(
    id, input.video_id, input.target_language.toLowerCase(), input.status,
    input.audio_url ?? null, input.subtitle_url ?? null,
    input.voice_id ?? null, input.voice_provider ?? null,
    input.is_auto === false ? 0 : 1,
    input.error_message ?? null, now, now,
  );
  return getDub(input.video_id, input.target_language)!;
}

export async function requestDubbing(input: {
  video_id: string;
  target_language: string;
  voice_id?: string | null;
  requester_id?: string;
}): Promise<{ dub: AiDub; job: any }> {
  const lang = input.target_language.toLowerCase().slice(0, 8);
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,4})?$/.test(lang)) throw new Error('Invalid target_language');

  const dub = upsertDub({
    video_id: input.video_id,
    target_language: lang,
    status: 'queued',
    voice_id: input.voice_id ?? null,
    voice_provider: 'mock-tts',
    is_auto: true,
  });

  const job = createAiJob({
    feature: 'dubbing',
    subject_type: 'video',
    subject_id: input.video_id,
    requester_id: input.requester_id ?? 'system',
    input: { target_language: lang },
  });
  markAiJobRunning(job.id);

  // In mock mode: complete immediately
  if (process.env.MELODYFLIX_AI_ENABLED !== '1') {
    const ready = upsertDub({
      video_id: input.video_id,
      target_language: lang,
      status: 'ready',
      audio_url: `https://cdn.melodyflix.local/ai-dubs/${input.video_id}/${lang}.m4a`,
      subtitle_url: `https://cdn.melodyflix.local/ai-dubs/${input.video_id}/${lang}.vtt`,
      voice_id: input.voice_id ?? null,
      voice_provider: 'mock-tts',
    });
    const done = markAiJobDone(job.id, {
      provider: 'mock-tts', model: 'mock-1',
      output: { target_language: lang, audio_url: ready.audio_url },
    });
    return { dub: ready, job: done };
  }

  // Real mode: worker completes via /ai/worker/:id/done
  return { dub, job };
}

// ============================================================
// 8.9 Voice cloning
// ============================================================

export type VoiceCloneStatus = 'pending' | 'ready' | 'failed' | 'revoked';

export interface AiVoiceClone {
  id: string;
  owner_id: string;
  name: string;
  sample_url: string;
  provider: string | null;
  provider_voice_id: string | null;
  status: VoiceCloneStatus;
  consent_confirmed: number;
  language: string | null;
  created_at: string;
  updated_at: string;
}

export function getVoiceClone(id: string): AiVoiceClone | null {
  return (getDb().prepare('SELECT * FROM ai_voice_clones WHERE id = ?')
    .get(id) as AiVoiceClone | undefined) ?? null;
}

export function listVoiceClones(ownerId: string): AiVoiceClone[] {
  return getDb().prepare(
    'SELECT * FROM ai_voice_clones WHERE owner_id = ? ORDER BY created_at DESC LIMIT 100'
  ).all(ownerId) as AiVoiceClone[];
}

export interface CreateVoiceCloneInput {
  owner_id: string;
  name: string;
  sample_url: string;
  language?: string | null;
  consent_confirmed: boolean;
}

export async function createVoiceClone(input: CreateVoiceCloneInput): Promise<{ clone: AiVoiceClone; job: any }> {
  if (!input.consent_confirmed) throw new Error('Consent confirmation required');
  if (!input.name?.trim() || input.name.length > 60) throw new Error('Name must be 1-60 chars');
  if (!/^https?:\/\//i.test(input.sample_url)) throw new Error('sample_url must be http(s)');

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  // Mock mode: mark ready immediately
  const isMock = process.env.MELODYFLIX_AI_ENABLED !== '1';
  const status: VoiceCloneStatus = isMock ? 'ready' : 'pending';
  const voiceId = isMock ? `mock-voice-${id.slice(0,8)}` : null;

  db.prepare(`
    INSERT INTO ai_voice_clones
      (id, owner_id, name, sample_url, provider, provider_voice_id, status,
       consent_confirmed, language, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'mock-tts', ?, ?, 1, ?, ?, ?)
  `).run(
    id, input.owner_id, input.name.trim(), input.sample_url,
    voiceId, status,
    input.language?.toLowerCase().slice(0, 8) ?? null,
    now, now,
  );

  const job = createAiJob({
    feature: 'voice_clone',
    subject_type: 'user',
    subject_id: input.owner_id,
    requester_id: input.owner_id,
    input: { name: input.name },
  });
  markAiJobRunning(job.id);
  const done = markAiJobDone(job.id, {
    provider: 'mock-tts', model: 'mock-1',
    output: { voice_id: voiceId, status },
  });
  return { clone: getVoiceClone(id)!, job: done };
}

export function revokeVoiceClone(id: string, ownerId: string): AiVoiceClone | null {
  const db = getDb();
  const cur = getVoiceClone(id);
  if (!cur) return null;
  if (cur.owner_id !== ownerId) throw new Error('Not your voice clone');
  db.prepare(`UPDATE ai_voice_clones SET status = 'revoked', updated_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), id);
  return getVoiceClone(id);
}

// ============================================================
// 8.10 Real-Time Audio Translation
// ============================================================

export interface AiRealtimeSession {
  id: string;
  video_id: string;
  requester_id: string;
  source_language: string;
  target_languages_json: string;
  status: 'ready' | 'active' | 'ended';
  latency_target_ms: number;
  created_at: string;
  ended_at: string | null;
}

export interface CreateRealtimeInput {
  video_id: string;
  requester_id: string;
  source_language: string;
  target_languages: string[];
  latency_target_ms?: number;
}

const LANG_RE = /^[a-z]{2,3}(-[a-z0-9]{2,4})?$/;

export function createRealtimeSession(input: CreateRealtimeInput): AiRealtimeSession {
  const src = input.source_language.toLowerCase().trim();
  if (!LANG_RE.test(src)) throw new Error('Invalid source_language');
  const targets = input.target_languages
    .map((l) => l.toLowerCase().trim())
    .filter((l) => LANG_RE.test(l) && l !== src);
  if (targets.length < 1 || targets.length > 6) throw new Error('1-6 valid target languages required');
  const latency = Math.max(300, Math.min(input.latency_target_ms ?? 800, 4000));

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO ai_realtime_sessions
      (id, video_id, requester_id, source_language, target_languages_json,
       status, latency_target_ms, created_at, ended_at)
    VALUES (?, ?, ?, ?, ?, 'ready', ?, ?, NULL)
  `).run(
    id, input.video_id, input.requester_id, src,
    JSON.stringify(targets), latency, now,
  );
  return getRealtimeSession(id)!;
}

export function getRealtimeSession(id: string): AiRealtimeSession | null {
  return (getDb().prepare('SELECT * FROM ai_realtime_sessions WHERE id = ?')
    .get(id) as AiRealtimeSession | undefined) ?? null;
}

export function listRealtimeSessions(videoId: string): AiRealtimeSession[] {
  return getDb().prepare(
    'SELECT * FROM ai_realtime_sessions WHERE video_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(videoId) as AiRealtimeSession[];
}

export function updateRealtimeSessionStatus(id: string, status: 'ready' | 'active' | 'ended'): AiRealtimeSession | null {
  const db = getDb();
  const cur = getRealtimeSession(id);
  if (!cur) return null;
  const now = new Date().toISOString();
  db.prepare(`UPDATE ai_realtime_sessions SET status = ?, ended_at = ? WHERE id = ?`)
    .run(status, status === 'ended' ? now : null, id);
  return getRealtimeSession(id);
}

// Summary
export interface AiMediaSummary {
  thumbnails_total: number;
  dubs_total: number;
  dubs_ready: number;
  voice_clones_total: number;
  voice_clones_ready: number;
  realtime_sessions_active: number;
}

export function getAiMediaSummary(): AiMediaSummary {
  const db = getDb();
  const t = (db.prepare('SELECT COUNT(*) as n FROM ai_thumbnails').get() as { n: number }).n;
  const dAll = (db.prepare('SELECT COUNT(*) as n FROM ai_dubs').get() as { n: number }).n;
  const dReady = (db.prepare("SELECT COUNT(*) as n FROM ai_dubs WHERE status='ready'").get() as { n: number }).n;
  const vAll = (db.prepare('SELECT COUNT(*) as n FROM ai_voice_clones').get() as { n: number }).n;
  const vReady = (db.prepare("SELECT COUNT(*) as n FROM ai_voice_clones WHERE status='ready'").get() as { n: number }).n;
  const active = (db.prepare("SELECT COUNT(*) as n FROM ai_realtime_sessions WHERE status='active'").get() as { n: number }).n;
  return {
    thumbnails_total: t,
    dubs_total: dAll,
    dubs_ready: dReady,
    voice_clones_total: vAll,
    voice_clones_ready: vReady,
    realtime_sessions_active: active,
  };
}
