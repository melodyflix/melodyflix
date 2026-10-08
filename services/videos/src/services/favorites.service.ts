// melodyflix videos - Favorites/Bookmarks (33.4)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type FavoriteKind = 'favorite' | 'bookmark';

export interface Favorite {
  id: string;
  user_id: string;
  video_id: string;
  kind: FavoriteKind;
  collection: string | null;   // optional grouping
  note: string | null;
  created_at: string;
}

export function ensureFavoritesSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS favorites (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'favorite',
      collection TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, video_id, kind)
    );
    CREATE INDEX IF NOT EXISTS idx_fav_user ON favorites(user_id);
    CREATE INDEX IF NOT EXISTS idx_fav_video ON favorites(video_id);
    CREATE INDEX IF NOT EXISTS idx_fav_kind ON favorites(kind);
    CREATE INDEX IF NOT EXISTS idx_fav_collection ON favorites(user_id, collection);
  `);
}

export function addFavorite(input: {
  user_id: string;
  video_id: string;
  kind?: FavoriteKind;
  collection?: string | null;
  note?: string | null;
}): Favorite {
  const db = getDb();
  const kind: FavoriteKind = input.kind ?? 'favorite';
  const collection = input.collection?.trim().slice(0, 100) || null;
  const note = input.note?.trim().slice(0, 500) || null;

  const existing = db.prepare(
    'SELECT * FROM favorites WHERE user_id = ? AND video_id = ? AND kind = ?'
  ).get(input.user_id, input.video_id, kind) as Favorite | undefined;

  if (existing) {
    // update collection/note if provided
    if (collection !== null || note !== null) {
      db.prepare('UPDATE favorites SET collection = COALESCE(?, collection), note = COALESCE(?, note) WHERE id = ?')
        .run(collection, note, existing.id);
      return db.prepare('SELECT * FROM favorites WHERE id = ?').get(existing.id) as Favorite;
    }
    return existing;
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO favorites (id, user_id, video_id, kind, collection, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, input.user_id, input.video_id, kind, collection, note, now);

  return db.prepare('SELECT * FROM favorites WHERE id = ?').get(id) as Favorite;
}

export function removeFavorite(userId: string, videoId: string, kind: FavoriteKind = 'favorite'): boolean {
  const db = getDb();
  const r = db.prepare('DELETE FROM favorites WHERE user_id = ? AND video_id = ? AND kind = ?')
    .run(userId, videoId, kind);
  return r.changes > 0;
}

export function isFavorited(userId: string, videoId: string, kind: FavoriteKind = 'favorite'): boolean {
  const db = getDb();
  const row = db.prepare('SELECT id FROM favorites WHERE user_id = ? AND video_id = ? AND kind = ?')
    .get(userId, videoId, kind);
  return !!row;
}

export function listFavorites(
  userId: string,
  opts: { kind?: FavoriteKind; collection?: string; limit?: number; offset?: number } = {},
): Favorite[] {
  const db = getDb();
  const kind = opts.kind ?? 'favorite';
  const limit = Math.min(opts.limit ?? 100, 500);
  const offset = opts.offset ?? 0;

  if (opts.collection !== undefined) {
    return db.prepare(
      'SELECT * FROM favorites WHERE user_id = ? AND kind = ? AND collection = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(userId, kind, opts.collection, limit, offset) as Favorite[];
  }
  return db.prepare(
    'SELECT * FROM favorites WHERE user_id = ? AND kind = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(userId, kind, limit, offset) as Favorite[];
}

export function listFavoritesWithData(
  userId: string,
  kind: FavoriteKind = 'favorite',
  limit = 100,
): any[] {
  const db = getDb();
  try {
    return db.prepare(`
      SELECT f.id as favorite_id, f.collection, f.note as favorite_note, f.created_at as favorited_at,
             v.id, v.title, v.description, v.thumbnail_url, v.duration_seconds, v.views,
             v.channel_id, v.created_at
      FROM favorites f
      INNER JOIN videos v ON v.id = f.video_id
      WHERE f.user_id = ? AND f.kind = ?
      ORDER BY f.created_at DESC
      LIMIT ?
    `).all(userId, kind, limit);
  } catch {
    // videos table might not exist in some envs
    return [];
  }
}

export function listCollections(userId: string, kind: FavoriteKind = 'favorite'): string[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT DISTINCT collection FROM favorites WHERE user_id = ? AND kind = ? AND collection IS NOT NULL ORDER BY collection"
  ).all(userId, kind) as { collection: string }[];
  return rows.map((r) => r.collection);
}

export function updateFavorite(
  userId: string,
  videoId: string,
  patch: { collection?: string | null; note?: string | null },
  kind: FavoriteKind = 'favorite',
): Favorite | null {
  const db = getDb();
  const existing = db.prepare(
    'SELECT * FROM favorites WHERE user_id = ? AND video_id = ? AND kind = ?'
  ).get(userId, videoId, kind) as Favorite | undefined;
  if (!existing) return null;

  const collection = patch.collection !== undefined
    ? (patch.collection === null ? null : patch.collection.trim().slice(0, 100) || null)
    : existing.collection;
  const note = patch.note !== undefined
    ? (patch.note === null ? null : patch.note.trim().slice(0, 500) || null)
    : existing.note;

  db.prepare('UPDATE favorites SET collection = ?, note = ? WHERE id = ?')
    .run(collection, note, existing.id);
  return db.prepare('SELECT * FROM favorites WHERE id = ?').get(existing.id) as Favorite;
}

export interface FavoriteStats {
  total: number;
  favorites: number;
  bookmarks: number;
  collections: number;
}

export function getFavoriteStats(userId: string): FavoriteStats {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as n FROM favorites WHERE user_id = ?').get(userId) as { n: number }).n;
  const fav = (db.prepare("SELECT COUNT(*) as n FROM favorites WHERE user_id = ? AND kind = 'favorite'").get(userId) as { n: number }).n;
  const bm = (db.prepare("SELECT COUNT(*) as n FROM favorites WHERE user_id = ? AND kind = 'bookmark'").get(userId) as { n: number }).n;
  const cols = (db.prepare(
    "SELECT COUNT(DISTINCT collection) as n FROM favorites WHERE user_id = ? AND collection IS NOT NULL"
  ).get(userId) as { n: number }).n;
  return { total, favorites: fav, bookmarks: bm, collections: cols };
}
