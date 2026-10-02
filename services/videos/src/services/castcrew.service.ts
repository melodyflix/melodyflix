// melodyflix videos - cast & crew (actors, directors, etc.)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export const ROLES = [
  { id: 'actor', label: 'Actor', emoji: '🎭', isCast: true },
  { id: 'director', label: 'Director', emoji: '🎬', isCast: false },
  { id: 'producer', label: 'Producer', emoji: '💼', isCast: false },
  { id: 'writer', label: 'Writer', emoji: '✍️', isCast: false },
  { id: 'composer', label: 'Composer', emoji: '🎵', isCast: false },
  { id: 'cinematographer', label: 'Cinematographer', emoji: '📷', isCast: false },
  { id: 'editor', label: 'Editor', emoji: '✂️', isCast: false },
  { id: 'animator', label: 'Animator', emoji: '🎨', isCast: false },
  { id: 'voice_actor', label: 'Voice Actor', emoji: '🎙️', isCast: true },
  { id: 'presenter', label: 'Presenter', emoji: '📢', isCast: true },
  { id: 'researcher', label: 'Researcher', emoji: '🔍', isCast: false },
  { id: 'other', label: 'Other', emoji: '👤', isCast: false },
] as const;

const VALID_ROLE_IDS = new Set(ROLES.map((r) => r.id));

export interface Person {
  id: string;
  video_id: string;
  name: string;
  role: string;
  character_name: string | null;
  order_index: number;
  created_at: string;
}

export function ensureCastCrewSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_people (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      character_name TEXT,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_video_people_video ON video_people(video_id, role, order_index);
    CREATE INDEX IF NOT EXISTS idx_video_people_name ON video_people(name);
  `);
}

export function isValidRole(role: string): boolean {
  return VALID_ROLE_IDS.has(role);
}

export function listPeopleForVideo(videoId: string): Person[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM video_people WHERE video_id = ? ORDER BY role ASC, order_index ASC, name ASC'
  ).all(videoId) as Person[];
}

export interface PersonInput {
  name: string;
  role: string;
  character_name?: string | null;
}

export function replaceCastCrew(videoId: string, people: PersonInput[]): Person[] {
  const db = getDb();
  const cleaned = people
    .map((p) => ({
      name: (p.name || '').trim().slice(0, 120),
      role: (p.role || '').trim().toLowerCase(),
      character_name: p.character_name ? p.character_name.trim().slice(0, 120) : null,
    }))
    .filter((p) => p.name.length > 0 && isValidRole(p.role));

  db.prepare('DELETE FROM video_people WHERE video_id = ?').run(videoId);
  const now = new Date().toISOString();
  const ins = db.prepare(
    'INSERT INTO video_people (id, video_id, name, role, character_name, order_index, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  cleaned.forEach((p, idx) => {
    ins.run(randomUUID(), videoId, p.name, p.role, p.character_name, idx, now);
  });

  return listPeopleForVideo(videoId);
}

export function addPerson(videoId: string, person: PersonInput): Person {
  const name = (person.name || '').trim().slice(0, 120);
  const role = (person.role || '').trim().toLowerCase();
  if (!name) throw new Error('Name is required');
  if (!isValidRole(role)) throw new Error('Invalid role');

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const maxRow = db.prepare('SELECT COALESCE(MAX(order_index), -1) as m FROM video_people WHERE video_id = ? AND role = ?')
    .get(videoId, role) as { m: number };
  const nextIdx = (maxRow?.m ?? -1) + 1;

  db.prepare(
    'INSERT INTO video_people (id, video_id, name, role, character_name, order_index, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, videoId, name, role, person.character_name?.trim() || null, nextIdx, now);

  return db.prepare('SELECT * FROM video_people WHERE id = ?').get(id) as Person;
}

export function removePerson(videoId: string, personId: string): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM video_people WHERE id = ? AND video_id = ?').run(personId, videoId);
  return res.changes > 0;
}

export interface VideoCredits {
  id: string;
  title: string;
  thumbnail_url: string | null;
  role: string;
  character_name: string | null;
  created_at: string;
}

// Find all videos where a person with matching name appears (fuzzy: case-insensitive exact)
export function listVideosByPerson(name: string, limit = 50): VideoCredits[] {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const db = getDb();
  return db.prepare(
    'SELECT v.id, v.title, v.thumbnail_url, p.role, p.character_name, p.created_at ' +
    'FROM video_people p JOIN videos v ON v.id = p.video_id ' +
    'WHERE LOWER(p.name) = LOWER(?) ' +
    'ORDER BY p.created_at DESC LIMIT ?'
  ).all(trimmed, Math.max(1, Math.min(200, limit))) as VideoCredits[];
}
