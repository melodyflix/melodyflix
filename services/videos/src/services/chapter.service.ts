// melodyflix videos - video chapters (auto from description + manual)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export interface Chapter {
  id: string;
  video_id: string;
  start_seconds: number;
  title: string;
  order_index: number;
  created_at: string;
}

export function ensureChapterSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_chapters (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      start_seconds INTEGER NOT NULL,
      title TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chapters_video ON video_chapters(video_id, order_index);
  `);
}

// Parse timestamps like "0:00 Intro" or "1:23:45 Topic" or "0:00 - Intro"
const TIMESTAMP_RE = /(?:^|\n)\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—:]?\s*(.+?)\s*$/gm;

export function parseChaptersFromDescription(description: string | null | undefined): { start_seconds: number; title: string }[] {
  if (!description) return [];
  const results: { start_seconds: number; title: string }[] = [];
  // Must have at least one timestamp pattern anywhere
  const lines = description.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—:]?\s*(.+?)\s*$/);
    if (!m) continue;
    const parts = m[1].split(':').map(Number);
    let seconds = 0;
    if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
    else if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    const title = m[2].trim();
    if (!title) continue;
    results.push({ start_seconds: seconds, title });
  }
  // Chapters may start anywhere (MelodyFlix choice); keep simple
  return results;
}

export function getChapters(videoId: string): Chapter[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM video_chapters WHERE video_id = ? ORDER BY order_index ASC, start_seconds ASC').all(videoId) as Chapter[];
  return rows;
}

// If no manual chapters exist, derive from video description (auto mode)
export function getEffectiveChapters(videoId: string): { chapters: Chapter[]; source: 'manual' | 'auto' | 'none' } {
  const manual = getChapters(videoId);
  if (manual.length > 0) return { chapters: manual, source: 'manual' };

  const db = getDb();
  const v = db.prepare('SELECT description FROM videos WHERE id = ?').get(videoId) as { description: string | null } | undefined;
  if (!v) return { chapters: [], source: 'none' };

  const parsed = parseChaptersFromDescription(v.description);
  if (parsed.length === 0) return { chapters: [], source: 'none' };

  // Return as pseudo-chapters (no DB insert — read-only auto)
  const now = new Date().toISOString();
  const chapters: Chapter[] = parsed.map((p, i) => ({
    id: 'auto-' + i,
    video_id: videoId,
    start_seconds: p.start_seconds,
    title: p.title,
    order_index: i,
    created_at: now,
  }));
  return { chapters, source: 'auto' };
}

export function replaceChapters(videoId: string, chapters: { start_seconds: number; title: string }[]): Chapter[] {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM video_chapters WHERE video_id = ?').run(videoId);
    const now = new Date().toISOString();
    const insert = db.prepare('INSERT INTO video_chapters (id, video_id, start_seconds, title, order_index, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    chapters.forEach((c, i) => {
      insert.run(randomUUID(), videoId, c.start_seconds, c.title, i, now);
    });
  });
  tx();
  return getChapters(videoId);
}

export function clearChapters(videoId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM video_chapters WHERE video_id = ?').run(videoId);
}
