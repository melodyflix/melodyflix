// melodyflix videos - audio track selector (45.8)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export interface AudioTrack {
  id: string;
  video_id: string;
  language: string;     // 'en', 'bn', 'hi', ...
  label: string;        // 'English', 'বাংলা (Bangla)'
  kind: string;         // 'main' | 'dub' | 'commentary' | 'descriptive'
  is_default: number;   // 1 for the primary track
  order_index: number;
  created_at: string;
}

export const AUDIO_TRACK_KINDS = [
  { id: 'main', label: 'Main Audio' },
  { id: 'dub', label: 'Dub / Alternate Language' },
  { id: 'commentary', label: 'Commentary' },
  { id: 'descriptive', label: 'Audio Description' },
];

export function ensureAudioTrackSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_audio_tracks (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      language TEXT NOT NULL,
      label TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'main',
      is_default INTEGER NOT NULL DEFAULT 0,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE (video_id, language, kind)
    );
    CREATE INDEX IF NOT EXISTS idx_audio_tracks_video ON video_audio_tracks(video_id, order_index);

    CREATE TABLE IF NOT EXISTS user_audio_preferences (
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, video_id)
    );
  `);
}

export function listAudioTracks(videoId: string): AudioTrack[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM video_audio_tracks WHERE video_id = ? ORDER BY is_default DESC, order_index ASC'
  ).all(videoId) as AudioTrack[];
}

export function getAudioTrack(trackId: string): AudioTrack | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM video_audio_tracks WHERE id = ?').get(trackId) as AudioTrack) ?? null;
}

export interface AddTrackInput {
  language: string;
  label?: string;
  kind?: string;
  is_default?: boolean;
}

export function addAudioTrack(videoId: string, input: AddTrackInput): AudioTrack {
  const db = getDb();
  const language = (input.language || '').trim().toLowerCase().slice(0, 10);
  if (!language) throw new Error('Language is required');
  const kind = AUDIO_TRACK_KINDS.find((k) => k.id === input.kind)?.id ?? 'main';
  const label = (input.label || language).trim().slice(0, 60);

  const isDefault = !!input.is_default;
  if (isDefault) {
    db.prepare('UPDATE video_audio_tracks SET is_default = 0 WHERE video_id = ?').run(videoId);
  }

  const existing = db.prepare(
    'SELECT id FROM video_audio_tracks WHERE video_id = ? AND language = ? AND kind = ?'
  ).get(videoId, language, kind) as { id: string } | undefined;

  const now = new Date().toISOString();
  if (existing) {
    db.prepare(
      'UPDATE video_audio_tracks SET label = ?, is_default = ? WHERE id = ?'
    ).run(label, isDefault ? 1 : 0, existing.id);
    return getAudioTrack(existing.id)!;
  }

  const maxRow = db.prepare('SELECT COALESCE(MAX(order_index), -1) as m FROM video_audio_tracks WHERE video_id = ?')
    .get(videoId) as { m: number };
  const nextIdx = (maxRow?.m ?? -1) + 1;

  const id = randomUUID();
  db.prepare(
    'INSERT INTO video_audio_tracks (id, video_id, language, label, kind, is_default, order_index, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, videoId, language, label, kind, isDefault ? 1 : 0, nextIdx, now);

  return getAudioTrack(id)!;
}

export function removeAudioTrack(trackId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM user_audio_preferences WHERE track_id = ?').run(trackId);
  db.prepare('DELETE FROM video_audio_tracks WHERE id = ?').run(trackId);
}

export function setDefaultTrack(trackId: string): void {
  const db = getDb();
  const t = getAudioTrack(trackId);
  if (!t) throw new Error('Track not found');
  db.prepare('UPDATE video_audio_tracks SET is_default = 0 WHERE video_id = ?').run(t.video_id);
  db.prepare('UPDATE video_audio_tracks SET is_default = 1 WHERE id = ?').run(trackId);
}

// ---------- Per-user preference ----------

export function setUserPreference(userId: string, videoId: string, trackId: string): void {
  const db = getDb();
  const t = getAudioTrack(trackId);
  if (!t || t.video_id !== videoId) throw new Error('Invalid track for this video');
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO user_audio_preferences (user_id, video_id, track_id, updated_at) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT(user_id, video_id) DO UPDATE SET track_id = excluded.track_id, updated_at = excluded.updated_at'
  ).run(userId, videoId, trackId, now);
}

export function getUserPreference(userId: string, videoId: string): string | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT track_id FROM user_audio_preferences WHERE user_id = ? AND video_id = ?'
  ).get(userId, videoId) as { track_id: string } | undefined;
  return row?.track_id ?? null;
}

// Seed a default "main" track for a video if it has none
export function ensureMainTrack(videoId: string, language = 'und'): AudioTrack | null {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM video_audio_tracks WHERE video_id = ? LIMIT 1')
    .get(videoId) as { id: string } | undefined;
  if (existing) return null;
  return addAudioTrack(videoId, {
    language,
    label: language === 'und' ? 'Default' : language,
    kind: 'main',
    is_default: true,
  });
}
