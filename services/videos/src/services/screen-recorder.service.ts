// melodyflix videos - Section 9.6 Screen Recorder
// Server-side session manager for browser MediaRecorder uploads.
// The browser captures screen/camera/mic, streams metadata heartbeats,
// and finishes by linking to an existing video or creating a draft.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type RecordingSource = 'screen' | 'camera' | 'screen_camera' | 'audio_only';
export type RecordingStatus =
  | 'initialized' | 'recording' | 'paused' | 'uploading'
  | 'ready' | 'failed' | 'cancelled';

export interface RecordingSession {
  id: string;
  owner_id: string;
  channel_id: string;
  title: string;
  description: string | null;
  source_type: RecordingSource;
  resolution_w: number;
  resolution_h: number;
  fps: number;
  audio_enabled: number;
  mic_enabled: number;
  status: RecordingStatus;
  bytes_received: number;
  chunk_count: number;
  duration_seconds: number;
  started_at: string | null;
  ended_at: string | null;
  video_id: string | null;
  error: string | null;
  visibility: string;
  created_at: string;
  updated_at: string;
}

export function ensureScreenRecorderSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS screen_recording_sessions (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      source_type TEXT NOT NULL DEFAULT 'screen'
        CHECK (source_type IN ('screen','camera','screen_camera','audio_only')),
      resolution_w INTEGER NOT NULL DEFAULT 1920,
      resolution_h INTEGER NOT NULL DEFAULT 1080,
      fps INTEGER NOT NULL DEFAULT 30,
      audio_enabled INTEGER NOT NULL DEFAULT 1,
      mic_enabled INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'initialized'
        CHECK (status IN ('initialized','recording','paused','uploading','ready','failed','cancelled')),
      bytes_received INTEGER NOT NULL DEFAULT 0,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      duration_seconds REAL NOT NULL DEFAULT 0,
      started_at TEXT,
      ended_at TEXT,
      video_id TEXT,
      error TEXT,
      visibility TEXT NOT NULL DEFAULT 'public',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_srs_owner ON screen_recording_sessions(owner_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_srs_status ON screen_recording_sessions(status);

    CREATE TABLE IF NOT EXISTS screen_recording_chunks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      byte_size INTEGER NOT NULL,
      received_at TEXT NOT NULL,
      UNIQUE (session_id, chunk_index)
    );
    CREATE INDEX IF NOT EXISTS idx_src_session ON screen_recording_chunks(session_id, chunk_index);
  `);
}

export interface StartSessionInput {
  channel_id: string;
  title: string;
  description?: string | null;
  source_type?: RecordingSource;
  resolution_w?: number;
  resolution_h?: number;
  fps?: number;
  audio_enabled?: boolean;
  mic_enabled?: boolean;
  visibility?: string;
}

export function startSession(input: StartSessionInput, ownerId: string): RecordingSession {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const w = Math.min(Math.max(input.resolution_w ?? 1920, 240), 7680);
  const h = Math.min(Math.max(input.resolution_h ?? 1080, 240), 4320);
  const fps = Math.min(Math.max(input.fps ?? 30, 1), 120);
  db.prepare(`
    INSERT INTO screen_recording_sessions
    (id, owner_id, channel_id, title, description, source_type,
     resolution_w, resolution_h, fps, audio_enabled, mic_enabled,
     status, visibility, started_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'recording', ?, ?, ?, ?)
  `).run(
    id, ownerId, input.channel_id, input.title.trim().slice(0, 200),
    input.description?.slice(0, 2000) ?? null,
    input.source_type ?? 'screen',
    w, h, fps,
    input.audio_enabled === false ? 0 : 1,
    input.mic_enabled === true ? 1 : 0,
    input.visibility ?? 'public',
    now, now, now,
  );
  return getSession(id)!;
}

export function getSession(id: string): RecordingSession | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM screen_recording_sessions WHERE id = ?').get(id) as RecordingSession | undefined) ?? null;
}

export function listSessions(ownerId: string, opts: { status?: RecordingStatus; limit?: number } = {}): RecordingSession[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  if (opts.status) {
    return db.prepare(
      'SELECT * FROM screen_recording_sessions WHERE owner_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?'
    ).all(ownerId, opts.status, limit) as RecordingSession[];
  }
  return db.prepare(
    'SELECT * FROM screen_recording_sessions WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(ownerId, limit) as RecordingSession[];
}

export function listSessionsByChannel(channelId: string, limit = 50): RecordingSession[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM screen_recording_sessions WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(channelId, Math.min(Math.max(limit, 1), 200)) as RecordingSession[];
}

// Ownership check helper — returns null if session not found; throws 'forbidden' if wrong owner
function assertOwner(session: RecordingSession, ownerId: string): void {
  if (session.owner_id !== ownerId) throw new Error('forbidden');
}

export interface HeartbeatInput {
  bytes_received?: number;
  duration_seconds?: number;
}

export function heartbeat(id: string, ownerId: string, input: HeartbeatInput): RecordingSession | null {
  const db = getDb();
  const s = getSession(id);
  if (!s) return null;
  assertOwner(s, ownerId);
  if (s.status === 'cancelled' || s.status === 'ready' || s.status === 'failed') return s;
  const now = new Date().toISOString();
  const bytes = input.bytes_received !== undefined
    ? Math.max(s.bytes_received, input.bytes_received)
    : s.bytes_received;
  const dur = input.duration_seconds !== undefined
    ? Math.max(s.duration_seconds, input.duration_seconds)
    : s.duration_seconds;
  db.prepare(
    'UPDATE screen_recording_sessions SET bytes_received = ?, duration_seconds = ?, updated_at = ? WHERE id = ?'
  ).run(bytes, dur, now, id);
  return getSession(id);
}

export interface ChunkInput {
  chunk_index: number;
  byte_size: number;
}

export function recordChunk(id: string, ownerId: string, input: ChunkInput): { session: RecordingSession; accepted: boolean } | null {
  const db = getDb();
  const s = getSession(id);
  if (!s) return null;
  assertOwner(s, ownerId);
  if (s.status === 'cancelled' || s.status === 'ready' || s.status === 'failed') {
    return { session: s, accepted: false };
  }
  const now = new Date().toISOString();
  const chunkId = randomUUID();
  const r = db.prepare(
    'INSERT OR IGNORE INTO screen_recording_chunks (id, session_id, chunk_index, byte_size, received_at) VALUES (?, ?, ?, ?, ?)'
  ).run(chunkId, id, input.chunk_index, Math.max(0, Math.floor(input.byte_size)), now);
  const accepted = r.changes > 0;
  if (accepted) {
    db.prepare(
      'UPDATE screen_recording_sessions SET chunk_count = chunk_count + 1, bytes_received = bytes_received + ?, updated_at = ? WHERE id = ?'
    ).run(Math.max(0, Math.floor(input.byte_size)), now, id);
  }
  return { session: getSession(id)!, accepted };
}

export function pauseSession(id: string, ownerId: string): RecordingSession | null {
  const db = getDb();
  const s = getSession(id);
  if (!s) return null;
  assertOwner(s, ownerId);
  if (s.status !== 'recording') throw new Error('not_recording');
  const now = new Date().toISOString();
  db.prepare("UPDATE screen_recording_sessions SET status = 'paused', updated_at = ? WHERE id = ?")
    .run(now, id);
  return getSession(id);
}

export function resumeSession(id: string, ownerId: string): RecordingSession | null {
  const db = getDb();
  const s = getSession(id);
  if (!s) return null;
  assertOwner(s, ownerId);
  if (s.status !== 'paused') throw new Error('not_paused');
  const now = new Date().toISOString();
  db.prepare("UPDATE screen_recording_sessions SET status = 'recording', updated_at = ? WHERE id = ?")
    .run(now, id);
  return getSession(id);
}

export interface FinishSessionInput {
  title?: string;
  description?: string | null;
  duration_seconds?: number;
  link_to_video_id?: string | null;
  create_video?: boolean;
}

export interface FinishResult {
  session: RecordingSession;
  video_id: string | null;
  created_video: boolean;
}

export function finishSession(id: string, ownerId: string, input: FinishSessionInput = {}): FinishResult | null {
  const db = getDb();
  const s = getSession(id);
  if (!s) return null;
  assertOwner(s, ownerId);
  if (s.status === 'ready' || s.status === 'cancelled' || s.status === 'failed') {
    return { session: s, video_id: s.video_id, created_video: false };
  }
  const now = new Date().toISOString();
  const finalTitle = (input.title ?? s.title).trim().slice(0, 200);
  const finalDesc = input.description !== undefined ? input.description : s.description;
  const duration = input.duration_seconds ?? s.duration_seconds;

  let videoId: string | null = input.link_to_video_id ?? null;
  let created = false;

  if (!videoId && input.create_video !== false) {
    // create draft video linked to this recording
    videoId = randomUUID();
    db.prepare(`
      INSERT INTO videos (id, channel_id, owner_id, title, description, visibility, status,
                          duration_seconds, file_size_bytes, original_filename,
                          view_count, like_count, dislike_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'uploading', ?, ?, ?, 0, 0, 0, ?, ?)
    `).run(
      videoId, s.channel_id, ownerId, finalTitle, finalDesc ?? null,
      s.visibility ?? 'public', duration, s.bytes_received,
      `screen-recording-${id}.webm`, now, now,
    );
    created = true;
  }

  db.prepare(`
    UPDATE screen_recording_sessions SET
      status = 'ready', title = ?, description = ?, duration_seconds = ?,
      video_id = ?, ended_at = ?, updated_at = ?
    WHERE id = ?
  `).run(finalTitle, finalDesc ?? null, duration, videoId, now, now, id);

  return { session: getSession(id)!, video_id: videoId, created_video: created };
}

export function failSession(id: string, ownerId: string, reason: string): RecordingSession | null {
  const db = getDb();
  const s = getSession(id);
  if (!s) return null;
  assertOwner(s, ownerId);
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE screen_recording_sessions SET status = 'failed', error = ?, ended_at = ?, updated_at = ? WHERE id = ?"
  ).run(reason.slice(0, 2000), now, now, id);
  return getSession(id);
}

export function cancelSession(id: string, ownerId: string): RecordingSession | null {
  const db = getDb();
  const s = getSession(id);
  if (!s) return null;
  assertOwner(s, ownerId);
  if (s.status === 'ready') throw new Error('already_finished');
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE screen_recording_sessions SET status = 'cancelled', ended_at = ?, updated_at = ? WHERE id = ?"
  ).run(now, now, id);
  return getSession(id);
}

export interface RecorderStats {
  total_sessions: number;
  ready: number;
  in_progress: number;
  failed: number;
  cancelled: number;
  total_bytes: number;
  total_duration_seconds: number;
  avg_duration_seconds: number | null;
}

export function getRecorderStats(ownerId: string): RecorderStats {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) AS c FROM screen_recording_sessions WHERE owner_id = ?').get(ownerId) as { c: number }).c;
  const ready = (db.prepare("SELECT COUNT(*) AS c FROM screen_recording_sessions WHERE owner_id = ? AND status = 'ready'").get(ownerId) as { c: number }).c;
  const inProgress = (db.prepare("SELECT COUNT(*) AS c FROM screen_recording_sessions WHERE owner_id = ? AND status IN ('initialized','recording','paused','uploading')").get(ownerId) as { c: number }).c;
  const failed = (db.prepare("SELECT COUNT(*) AS c FROM screen_recording_sessions WHERE owner_id = ? AND status = 'failed'").get(ownerId) as { c: number }).c;
  const cancelled = (db.prepare("SELECT COUNT(*) AS c FROM screen_recording_sessions WHERE owner_id = ? AND status = 'cancelled'").get(ownerId) as { c: number }).c;
  const sums = db.prepare(
    "SELECT COALESCE(SUM(bytes_received),0) AS bytes, COALESCE(SUM(duration_seconds),0) AS dur, COUNT(*) AS n FROM screen_recording_sessions WHERE owner_id = ? AND status = 'ready'"
  ).get(ownerId) as { bytes: number; dur: number; n: number };
  return {
    total_sessions: total,
    ready,
    in_progress: inProgress,
    failed,
    cancelled,
    total_bytes: sums.bytes,
    total_duration_seconds: Math.round(sums.dur * 100) / 100,
    avg_duration_seconds: sums.n > 0 ? Math.round((sums.dur / sums.n) * 100) / 100 : null,
  };
}
