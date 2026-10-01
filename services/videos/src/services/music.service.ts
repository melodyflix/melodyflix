// melodyflix videos - music streaming service
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export interface Artist {
  id: string;
  channel_id: string | null;
  name: string;
  bio: string | null;
  avatar_url: string | null;
  verified: number;
  track_count: number;
  album_count: number;
  follower_count: number;
  created_at: string;
  updated_at: string;
}

export interface Album {
  id: string;
  artist_id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  release_date: string | null;
  album_type: 'album' | 'single' | 'ep' | 'compilation';
  track_count: number;
  created_at: string;
  updated_at: string;
}

export interface Track {
  id: string;
  artist_id: string;
  album_id: string | null;
  title: string;
  description: string | null;
  audio_url: string;
  cover_url: string | null;
  duration_seconds: number;
  genre: string | null;
  language: string | null;
  release_date: string | null;
  track_number: number;
  play_count: number;
  like_count: number;
  explicit: number;
  created_at: string;
  updated_at: string;
}

export interface Lyrics {
  track_id: string;
  plain_text: string;
  synced_lrc: string | null;
  language: string | null;
  updated_at: string;
}

export function ensureMusicSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS artists (
      id TEXT PRIMARY KEY,
      channel_id TEXT,
      name TEXT NOT NULL,
      bio TEXT,
      avatar_url TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      track_count INTEGER NOT NULL DEFAULT 0,
      album_count INTEGER NOT NULL DEFAULT 0,
      follower_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_artists_name ON artists(name);
    CREATE INDEX IF NOT EXISTS idx_artists_channel ON artists(channel_id);

    CREATE TABLE IF NOT EXISTS albums (
      id TEXT PRIMARY KEY,
      artist_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      cover_url TEXT,
      release_date TEXT,
      album_type TEXT NOT NULL DEFAULT 'album',
      track_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist_id);

    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      artist_id TEXT NOT NULL,
      album_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      audio_url TEXT NOT NULL,
      cover_url TEXT,
      duration_seconds REAL NOT NULL DEFAULT 0,
      genre TEXT,
      language TEXT,
      release_date TEXT,
      track_number INTEGER NOT NULL DEFAULT 1,
      play_count INTEGER NOT NULL DEFAULT 0,
      like_count INTEGER NOT NULL DEFAULT 0,
      explicit INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre);

    CREATE TABLE IF NOT EXISTS track_lyrics (
      track_id TEXT PRIMARY KEY,
      plain_text TEXT NOT NULL,
      synced_lrc TEXT,
      language TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS track_likes (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (track_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_tl_track ON track_likes(track_id);
  `);
}

// ---------- Artists ----------
export function createArtist(input: { name: string; bio?: string; avatar_url?: string; channel_id?: string }): Artist {
  const db = getDb();
  const now = new Date().toISOString();
  const artist: Artist = {
    id: randomUUID(),
    channel_id: input.channel_id ?? null,
    name: input.name.trim(),
    bio: input.bio?.trim() || null,
    avatar_url: input.avatar_url ?? null,
    verified: 0,
    track_count: 0,
    album_count: 0,
    follower_count: 0,
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO artists (id, channel_id, name, bio, avatar_url, verified, track_count, album_count, follower_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(artist.id, artist.channel_id, artist.name, artist.bio, artist.avatar_url, 0, 0, 0, 0, now, now);
  return artist;
}

export function getArtistById(id: string): Artist | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM artists WHERE id = ?').get(id) as Artist | undefined) ?? null;
}

export function listArtists(limit = 50, offset = 0): Artist[] {
  const db = getDb();
  return db.prepare('SELECT * FROM artists ORDER BY track_count DESC, name ASC LIMIT ? OFFSET ?')
    .all(limit, offset) as Artist[];
}

export function searchArtists(q: string, limit = 20): Artist[] {
  const db = getDb();
  return db.prepare('SELECT * FROM artists WHERE LOWER(name) LIKE ? ORDER BY name LIMIT ?')
    .all(`%${q.toLowerCase()}%`, limit) as Artist[];
}

export function updateArtist(id: string, updates: Partial<Artist>): Artist {
  const db = getDb();
  const existing = getArtistById(id);
  if (!existing) throw new Error('Artist not found');
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE artists SET name = ?, bio = ?, avatar_url = ?, verified = ?, updated_at = ?
    WHERE id = ?
  `).run(
    updates.name?.trim() || existing.name,
    updates.bio !== undefined ? (updates.bio?.trim() || null) : existing.bio,
    updates.avatar_url !== undefined ? updates.avatar_url : existing.avatar_url,
    updates.verified !== undefined ? updates.verified : existing.verified,
    now, id
  );
  return getArtistById(id)!;
}

// ---------- Albums ----------
export function createAlbum(input: {
  artist_id: string; title: string; description?: string;
  cover_url?: string; release_date?: string; album_type?: string;
}): Album {
  const db = getDb();
  if (!getArtistById(input.artist_id)) throw new Error('Artist not found');
  const now = new Date().toISOString();
  const album: Album = {
    id: randomUUID(),
    artist_id: input.artist_id,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    cover_url: input.cover_url ?? null,
    release_date: input.release_date ?? null,
    album_type: (input.album_type as any) ?? 'album',
    track_count: 0,
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO albums (id, artist_id, title, description, cover_url, release_date, album_type, track_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(album.id, album.artist_id, album.title, album.description, album.cover_url, album.release_date, album.album_type, 0, now, now);
  db.prepare('UPDATE artists SET album_count = album_count + 1 WHERE id = ?').run(album.artist_id);
  return album;
}

export function getAlbumById(id: string): Album | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM albums WHERE id = ?').get(id) as Album | undefined) ?? null;
}

export function listAlbumsByArtist(artistId: string): Album[] {
  const db = getDb();
  return db.prepare('SELECT * FROM albums WHERE artist_id = ? ORDER BY release_date DESC, created_at DESC')
    .all(artistId) as Album[];
}

export function listAllAlbums(limit = 50, offset = 0): Album[] {
  const db = getDb();
  return db.prepare('SELECT * FROM albums ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as Album[];
}

// ---------- Tracks ----------
export function createTrack(input: {
  artist_id: string; album_id?: string; title: string; description?: string;
  audio_url: string; cover_url?: string; duration_seconds?: number;
  genre?: string; language?: string; release_date?: string;
  track_number?: number; explicit?: boolean;
}): Track {
  const db = getDb();
  if (!getArtistById(input.artist_id)) throw new Error('Artist not found');
  if (input.album_id && !getAlbumById(input.album_id)) throw new Error('Album not found');
  const now = new Date().toISOString();
  const track: Track = {
    id: randomUUID(),
    artist_id: input.artist_id,
    album_id: input.album_id ?? null,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    audio_url: input.audio_url,
    cover_url: input.cover_url ?? null,
    duration_seconds: input.duration_seconds ?? 0,
    genre: input.genre ?? null,
    language: input.language ?? null,
    release_date: input.release_date ?? null,
    track_number: input.track_number ?? 1,
    play_count: 0,
    like_count: 0,
    explicit: input.explicit ? 1 : 0,
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO tracks (id, artist_id, album_id, title, description, audio_url, cover_url,
      duration_seconds, genre, language, release_date, track_number, play_count, like_count,
      explicit, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    track.id, track.artist_id, track.album_id, track.title, track.description,
    track.audio_url, track.cover_url, track.duration_seconds, track.genre, track.language,
    track.release_date, track.track_number, track.play_count, track.like_count,
    track.explicit, now, now
  );
  db.prepare('UPDATE artists SET track_count = track_count + 1 WHERE id = ?').run(track.artist_id);
  if (track.album_id) {
    db.prepare('UPDATE albums SET track_count = track_count + 1 WHERE id = ?').run(track.album_id);
  }
  return track;
}

export function getTrackById(id: string): Track | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM tracks WHERE id = ?').get(id) as Track | undefined) ?? null;
}

export function listTracksByArtist(artistId: string, limit = 100): Track[] {
  const db = getDb();
  return db.prepare('SELECT * FROM tracks WHERE artist_id = ? ORDER BY play_count DESC LIMIT ?')
    .all(artistId, limit) as Track[];
}

export function listTracksByAlbum(albumId: string): Track[] {
  const db = getDb();
  return db.prepare('SELECT * FROM tracks WHERE album_id = ? ORDER BY track_number ASC')
    .all(albumId) as Track[];
}

export function listAllTracks(limit = 100, offset = 0): Track[] {
  const db = getDb();
  return db.prepare('SELECT * FROM tracks ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as Track[];
}

export function listTrendingTracks(limit = 50): Track[] {
  const db = getDb();
  return db.prepare('SELECT * FROM tracks ORDER BY play_count DESC, like_count DESC LIMIT ?')
    .all(limit) as Track[];
}

export function incrementPlayCount(trackId: string): void {
  const db = getDb();
  db.prepare('UPDATE tracks SET play_count = play_count + 1 WHERE id = ?').run(trackId);
}

// ---------- Likes ----------
export function toggleTrackLike(trackId: string, userId: string): { liked: boolean; likeCount: number } {
  const db = getDb();
  const track = getTrackById(trackId);
  if (!track) throw new Error('Track not found');
  const existing = db.prepare('SELECT id FROM track_likes WHERE track_id = ? AND user_id = ?')
    .get(trackId, userId) as { id: string } | undefined;
  if (existing) {
    db.prepare('DELETE FROM track_likes WHERE id = ?').run(existing.id);
    db.prepare('UPDATE tracks SET like_count = MAX(like_count - 1, 0) WHERE id = ?').run(trackId);
  } else {
    db.prepare('INSERT INTO track_likes (id, track_id, user_id, created_at) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), trackId, userId, new Date().toISOString());
    db.prepare('UPDATE tracks SET like_count = like_count + 1 WHERE id = ?').run(trackId);
  }
  const updated = getTrackById(trackId)!;
  return { liked: !existing, likeCount: updated.like_count };
}

// ---------- Lyrics ----------
export function setLyrics(trackId: string, plainText: string, syncedLrc?: string, language?: string): Lyrics {
  const db = getDb();
  if (!getTrackById(trackId)) throw new Error('Track not found');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO track_lyrics (track_id, plain_text, synced_lrc, language, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(track_id) DO UPDATE SET
      plain_text = excluded.plain_text,
      synced_lrc = excluded.synced_lrc,
      language = excluded.language,
      updated_at = excluded.updated_at
  `).run(trackId, plainText, syncedLrc ?? null, language ?? null, now);
  return { track_id: trackId, plain_text: plainText, synced_lrc: syncedLrc ?? null, language: language ?? null, updated_at: now };
}

export function getLyrics(trackId: string): Lyrics | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM track_lyrics WHERE track_id = ?').get(trackId) as Lyrics | undefined) ?? null;
}

// ---------- Genres ----------
export function listGenres(): { genre: string; count: number }[] {
  const db = getDb();
  return db.prepare(`
    SELECT genre, COUNT(*) as count FROM tracks
    WHERE genre IS NOT NULL GROUP BY genre ORDER BY count DESC
  `).all() as { genre: string; count: number }[];
}

export function listTracksByGenre(genre: string, limit = 50): Track[] {
  const db = getDb();
  return db.prepare('SELECT * FROM tracks WHERE genre = ? ORDER BY play_count DESC LIMIT ?')
    .all(genre, limit) as Track[];
}

// ---------- Stats ----------
export interface MusicStats {
  total_artists: number;
  total_albums: number;
  total_tracks: number;
  total_plays: number;
}

export function getMusicStats(): MusicStats {
  const db = getDb();
  const a = (db.prepare('SELECT COUNT(*) as n FROM artists').get() as { n: number }).n;
  const al = (db.prepare('SELECT COUNT(*) as n FROM albums').get() as { n: number }).n;
  const t = (db.prepare('SELECT COUNT(*) as n FROM tracks').get() as { n: number }).n;
  const p = (db.prepare('SELECT COALESCE(SUM(play_count), 0) as s FROM tracks').get() as { s: number }).s;
  return { total_artists: a, total_albums: al, total_tracks: t, total_plays: p };
}
