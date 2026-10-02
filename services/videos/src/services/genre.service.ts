// melodyflix videos - genre classification
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

// Predefined genre list (id + display label)
export const GENRES = [
  { id: 'action', label: 'Action' },
  { id: 'adventure', label: 'Adventure' },
  { id: 'animation', label: 'Animation' },
  { id: 'comedy', label: 'Comedy' },
  { id: 'crime', label: 'Crime' },
  { id: 'documentary', label: 'Documentary' },
  { id: 'drama', label: 'Drama' },
  { id: 'family', label: 'Family' },
  { id: 'fantasy', label: 'Fantasy' },
  { id: 'history', label: 'History' },
  { id: 'horror', label: 'Horror' },
  { id: 'music', label: 'Music' },
  { id: 'mystery', label: 'Mystery' },
  { id: 'news', label: 'News' },
  { id: 'reality', label: 'Reality' },
  { id: 'romance', label: 'Romance' },
  { id: 'sci-fi', label: 'Sci-Fi' },
  { id: 'sport', label: 'Sport' },
  { id: 'thriller', label: 'Thriller' },
  { id: 'education', label: 'Education' },
] as const;

const VALID_IDS = new Set(GENRES.map((g) => g.id));

export interface VideoGenre {
  id: string;
  video_id: string;
  genre: string;
  created_at: string;
}

export function ensureGenreSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_genres (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      genre TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (video_id, genre)
    );
    CREATE INDEX IF NOT EXISTS idx_video_genres_video ON video_genres(video_id);
    CREATE INDEX IF NOT EXISTS idx_video_genres_genre ON video_genres(genre);
  `);
}

export function isValidGenre(genre: string): boolean {
  return VALID_IDS.has(genre);
}

export function listGenresForVideo(videoId: string): VideoGenre[] {
  const db = getDb();
  return db.prepare('SELECT * FROM video_genres WHERE video_id = ? ORDER BY genre ASC').all(videoId) as VideoGenre[];
}

export function replaceGenres(videoId: string, genres: string[]): VideoGenre[] {
  const db = getDb();
  const cleaned = Array.from(new Set(genres.map((g) => g.trim().toLowerCase()).filter(isValidGenre)));

  db.prepare('DELETE FROM video_genres WHERE video_id = ?').run(videoId);
  const now = new Date().toISOString();
  const ins = db.prepare('INSERT INTO video_genres (id, video_id, genre, created_at) VALUES (?, ?, ?, ?)');
  for (const g of cleaned) {
    ins.run(randomUUID(), videoId, g, now);
  }
  return listGenresForVideo(videoId);
}

export function addGenre(videoId: string, genre: string): VideoGenre {
  const g = genre.trim().toLowerCase();
  if (!isValidGenre(g)) throw new Error('Invalid genre');
  const db = getDb();
  const existing = db.prepare('SELECT * FROM video_genres WHERE video_id = ? AND genre = ?').get(videoId, g) as VideoGenre | undefined;
  if (existing) return existing;
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO video_genres (id, video_id, genre, created_at) VALUES (?, ?, ?, ?)').run(id, videoId, g, now);
  return db.prepare('SELECT * FROM video_genres WHERE id = ?').get(id) as VideoGenre;
}

export function removeGenre(videoId: string, genre: string): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM video_genres WHERE video_id = ? AND genre = ?').run(videoId, genre.toLowerCase());
  return res.changes > 0;
}

export interface GenreWithCount {
  genre: string;
  label: string;
  video_count: number;
}

export function listGenresWithCounts(): GenreWithCount[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT genre, COUNT(*) as video_count FROM video_genres GROUP BY genre'
  ).all() as { genre: string; video_count: number }[];
  const counts = new Map(rows.map((r) => [r.genre, r.video_count]));
  return GENRES.map((g) => ({
    genre: g.id,
    label: g.label,
    video_count: counts.get(g.id) ?? 0,
  }));
}

export function listVideoIdsByGenre(genre: string, limit = 60): string[] {
  const g = genre.trim().toLowerCase();
  if (!isValidGenre(g)) return [];
  const db = getDb();
  const rows = db.prepare(
    'SELECT video_id FROM video_genres WHERE genre = ? LIMIT ?'
  ).all(g, Math.max(1, Math.min(200, limit))) as { video_id: string }[];
  return rows.map((r) => r.video_id);
}
