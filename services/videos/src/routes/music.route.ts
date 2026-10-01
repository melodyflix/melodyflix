// melodyflix videos - music streaming HTTP routes (Fastify)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createArtist, getArtistById, listArtists, searchArtists, updateArtist,
  createAlbum, getAlbumById, listAlbumsByArtist, listAllAlbums,
  createTrack, getTrackById, listAllTracks, listTrendingTracks,
  listTracksByArtist, listTracksByAlbum, incrementPlayCount,
  toggleTrackLike, setLyrics, getLyrics,
  listGenres, listTracksByGenre, getMusicStats,
} from '../services/music.service.js';

// ---------- Zod Schemas ----------
const CreateArtistSchema = z.object({
  name: z.string().min(1).max(200),
  bio: z.string().max(5000).optional(),
  avatar_url: z.string().url().optional(),
  channel_id: z.string().optional(),
});

const UpdateArtistSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  bio: z.string().max(5000).nullable().optional(),
  avatar_url: z.string().url().nullable().optional(),
  verified: z.number().int().min(0).max(1).optional(),
});

const CreateAlbumSchema = z.object({
  artist_id: z.string().min(1),
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  cover_url: z.string().url().optional(),
  release_date: z.string().optional(),
  album_type: z.enum(['album', 'single', 'ep', 'compilation']).optional(),
});

const CreateTrackSchema = z.object({
  artist_id: z.string().min(1),
  album_id: z.string().optional(),
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  audio_url: z.string().url(),
  cover_url: z.string().url().optional(),
  duration_seconds: z.number().nonnegative().optional(),
  genre: z.string().max(50).optional(),
  language: z.string().max(20).optional(),
  release_date: z.string().optional(),
  track_number: z.number().int().positive().optional(),
  explicit: z.boolean().optional(),
});

const LikeSchema = z.object({
  user_id: z.string().min(1).optional(),
});

const LyricsSchema = z.object({
  plain_text: z.string().min(1),
  synced_lrc: z.string().optional(),
  language: z.string().max(20).optional(),
});

// ---------- Routes ----------
export async function musicRoutes(app: FastifyInstance) {
  // ============ Artists ============
  app.post('/artists', async (req, reply) => {
    const body = CreateArtistSchema.parse(req.body);
    return reply.code(201).send(createArtist(body));
  });

  app.get('/artists', async (req) => {
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(Number(q.limit) || 50, 200);
    const offset = Number(q.offset) || 0;
    return { artists: listArtists(limit, offset) };
  });

  app.get('/artists/search', async (req) => {
    const q = req.query as { q?: string; limit?: string };
    const term = (q.q || '').trim();
    if (!term) return { artists: [] };
    return { artists: searchArtists(term, Number(q.limit) || 20) };
  });

  app.get('/artists/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const artist = getArtistById(id);
    if (!artist) return reply.code(404).send({ error: 'Artist not found' });
    return artist;
  });

  app.put('/artists/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = UpdateArtistSchema.parse(req.body);
    try {
      return updateArtist(id, body);
    } catch (err: any) {
      return reply.code(404).send({ error: err.message });
    }
  });

  // ============ Albums ============
  app.post('/albums', async (req, reply) => {
    const body = CreateAlbumSchema.parse(req.body);
    try {
      return reply.code(201).send(createAlbum(body));
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.get('/albums', async (req) => {
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(Number(q.limit) || 50, 200);
    const offset = Number(q.offset) || 0;
    return { albums: listAllAlbums(limit, offset) };
  });

  app.get('/albums/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const album = getAlbumById(id);
    if (!album) return reply.code(404).send({ error: 'Album not found' });
    return album;
  });

  app.get('/artists/:id/albums', async (req) => {
    const { id } = req.params as { id: string };
    return { albums: listAlbumsByArtist(id) };
  });

  // ============ Tracks ============
  app.post('/tracks', async (req, reply) => {
    const body = CreateTrackSchema.parse(req.body);
    try {
      return reply.code(201).send(createTrack(body));
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.get('/tracks', async (req) => {
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(Number(q.limit) || 100, 500);
    const offset = Number(q.offset) || 0;
    return { tracks: listAllTracks(limit, offset) };
  });

  app.get('/tracks/trending', async (req) => {
    const q = req.query as { limit?: string };
    return { tracks: listTrendingTracks(Number(q.limit) || 50) };
  });

  app.get('/tracks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const track = getTrackById(id);
    if (!track) return reply.code(404).send({ error: 'Track not found' });
    return track;
  });

  app.get('/artists/:id/tracks', async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string };
    return { tracks: listTracksByArtist(id, Number(q.limit) || 100) };
  });

  app.get('/albums/:id/tracks', async (req) => {
    const { id } = req.params as { id: string };
    return { tracks: listTracksByAlbum(id) };
  });

  app.post('/tracks/:id/play', async (req, reply) => {
    const { id } = req.params as { id: string };
    const track = getTrackById(id);
    if (!track) return reply.code(404).send({ error: 'Track not found' });
    incrementPlayCount(id);
    return { ok: true };
  });

  // ============ Likes ============
  app.post('/tracks/:id/like', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = LikeSchema.parse(req.body || {});
    const headerUser = (req.headers['x-user-id'] as string) || undefined;
    const userId = body.user_id || headerUser;
    if (!userId) return reply.code(400).send({ error: 'user_id required' });
    try {
      return toggleTrackLike(id, userId);
    } catch (err: any) {
      return reply.code(404).send({ error: err.message });
    }
  });

  // ============ Lyrics ============
  app.get('/tracks/:id/lyrics', async (req, reply) => {
    const { id } = req.params as { id: string };
    const lyrics = getLyrics(id);
    if (!lyrics) return reply.code(404).send({ error: 'Lyrics not found' });
    return lyrics;
  });

  app.post('/tracks/:id/lyrics', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = LyricsSchema.parse(req.body);
    try {
      return setLyrics(id, body.plain_text, body.synced_lrc, body.language);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // ============ Genres ============
  app.get('/genres', async () => {
    return { genres: listGenres() };
  });

  app.get('/genres/:genre/tracks', async (req) => {
    const { genre } = req.params as { genre: string };
    const q = req.query as { limit?: string };
    return { tracks: listTracksByGenre(genre, Number(q.limit) || 50) };
  });

  // ============ Stats ============
  app.get('/stats', async () => {
    return getMusicStats();
  });
}
