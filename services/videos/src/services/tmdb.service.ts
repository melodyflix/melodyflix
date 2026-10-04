// melodyflix videos — TMDB/IMDb Metadata Automation (Section 149)
// Reads TMDB/OMDb credentials from integration_settings (admin panel).
// All external calls go through helper fetchers with timeout + graceful errors.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';
import {
  getIntegrationConfigRaw, isIntegrationReady,
} from './integration-settings.service.js';

export type MediaType = 'movie' | 'tv';

export interface TmdbSearchResult {
  tmdb_id: number;
  media_type: MediaType;
  title: string;
  original_title: string | null;
  overview: string | null;
  release_date: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  vote_count: number;
  popularity: number;
  language: string;
}

export interface TmdbImportRecord {
  id: string;
  video_id: string | null;
  series_id: string | null;
  tmdb_id: number;
  media_type: MediaType;
  season_number: number | null;
  episode_number: number | null;
  poster_url: string | null;
  backdrop_url: string | null;
  trailer_key: string | null;
  imdb_id: string | null;
  imdb_rating: number | null;
  imported_by: string;
  imported_at: string;
  last_synced_at: string;
  metadata_json: string | null;
}

const DEFAULT_TIMEOUT_MS = 8000;
const TMDB_IMG_BASE = 'https://image.tmdb.org/t/p';

// ============================================================
// Schema
// ============================================================

export function ensureTmdbSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS tmdb_imports (
      id TEXT PRIMARY KEY,
      video_id TEXT,
      series_id TEXT,
      tmdb_id INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      season_number INTEGER,
      episode_number INTEGER,
      poster_url TEXT,
      backdrop_url TEXT,
      trailer_key TEXT,
      imdb_id TEXT,
      imdb_rating REAL,
      imported_by TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      last_synced_at TEXT NOT NULL,
      metadata_json TEXT,
      UNIQUE (media_type, tmdb_id, season_number, episode_number)
    );
    CREATE INDEX IF NOT EXISTS idx_tmdb_video ON tmdb_imports(video_id);
    CREATE INDEX IF NOT EXISTS idx_tmdb_series ON tmdb_imports(series_id);
    CREATE INDEX IF NOT EXISTS idx_tmdb_tmdb_id ON tmdb_imports(media_type, tmdb_id);
  `);
}

// ============================================================
// HTTP helpers
// ============================================================

function getTmdbConfig(): { api_key: string; base_url: string; language: string } {
  if (!isIntegrationReady('tmdb')) {
    throw new Error('TMDB is not configured. Set it up in admin panel > Integrations.');
  }
  const cfg = getIntegrationConfigRaw('tmdb');
  if (!cfg) throw new Error('TMDB config missing');
  return {
    api_key: String(cfg.api_key ?? ''),
    base_url: String(cfg.base_url ?? 'https://api.themoviedb.org/3'),
    language: String(cfg.language ?? 'en-US'),
  };
}

function getOmdbConfig(): { api_key: string; base_url: string } | null {
  if (!isIntegrationReady('omdb')) return null;
  const cfg = getIntegrationConfigRaw('omdb');
  if (!cfg || !cfg.api_key) return null;
  return {
    api_key: String(cfg.api_key),
    base_url: String(cfg.base_url ?? 'https://www.omdbapi.com'),
  };
}

async function tmdbGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const cfg = getTmdbConfig();
  const url = new URL(`${cfg.base_url}${path}`);
  url.searchParams.set('api_key', cfg.api_key);
  url.searchParams.set('language', cfg.language);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`TMDB API ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function omdbGet<T>(params: Record<string, string>): Promise<T | null> {
  const cfg = getOmdbConfig();
  if (!cfg) return null;
  const url = new URL(cfg.base_url);
  url.searchParams.set('apikey', cfg.api_key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildImageUrl(path: string | null | undefined, size = 'w500'): string | null {
  if (!path) return null;
  return `${TMDB_IMG_BASE}/${size}${path}`;
}

// ============================================================
// 149.1 — Search & Match
// ============================================================

interface TmdbSearchRaw {
  results: Array<{
    id: number;
    media_type?: string;
    title?: string;
    name?: string;
    original_title?: string;
    original_name?: string;
    overview?: string;
    release_date?: string;
    first_air_date?: string;
    poster_path?: string | null;
    backdrop_path?: string | null;
    vote_average?: number;
    vote_count?: number;
    popularity?: number;
    original_language?: string;
  }>;
}

export async function searchTmdb(query: string, opts: { type?: MediaType | 'multi'; year?: number; page?: number } = {}): Promise<TmdbSearchResult[]> {
  const q = (query ?? '').trim();
  if (q.length < 1 || q.length > 200) throw new Error('query must be 1-200 chars');
  const type = opts.type ?? 'multi';
  const path = type === 'multi' ? '/search/multi' : `/search/${type}`;
  const params: Record<string, string> = { query: q, page: String(opts.page ?? 1) };
  if (opts.year) params[type === 'tv' ? 'first_air_date_year' : 'year'] = String(opts.year);

  const raw = await tmdbGet<TmdbSearchRaw>(path, params);
  return (raw.results ?? [])
    .filter((r) => r.media_type !== 'person') // exclude people from multi search
    .map((r) => ({
      tmdb_id: r.id,
      media_type: (r.media_type === 'tv' ? 'tv' : 'movie') as MediaType,
      title: r.title ?? r.name ?? '',
      original_title: r.original_title ?? r.original_name ?? null,
      overview: r.overview ?? null,
      release_date: r.release_date ?? r.first_air_date ?? null,
      poster_path: r.poster_path ?? null,
      backdrop_path: r.backdrop_path ?? null,
      vote_average: r.vote_average ?? 0,
      vote_count: r.vote_count ?? 0,
      popularity: r.popularity ?? 0,
      language: r.original_language ?? 'en',
    }));
}

// ============================================================
// 149.2 / 149.3 — Movie / TV metadata detail
// ============================================================

interface TmdbDetailRaw {
  id: number;
  title?: string;
  name?: string;
  overview?: string;
  release_date?: string;
  first_air_date?: string;
  runtime?: number;
  episode_run_time?: number[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  original_language?: string;
  genres?: Array<{ id: number; name: string }>;
  credits?: {
    cast?: Array<{ id: number; name: string; character?: string; order?: number; profile_path?: string | null }>;
    crew?: Array<{ id: number; name: string; job?: string; department?: string }>;
  };
  videos?: {
    results?: Array<{ key: string; site: string; type: string; name?: string; official?: boolean }>;
  };
  external_ids?: { imdb_id?: string };
  images?: { posters?: Array<{ file_path: string }>; backdrops?: Array<{ file_path: string }> };
  seasons?: Array<{ season_number: number; name: string; episode_count: number; air_date?: string; poster_path?: string | null }>;
}

export interface TmdbDetail {
  tmdb_id: number;
  media_type: MediaType;
  title: string;
  overview: string | null;
  release_date: string | null;
  runtime_minutes: number | null;
  poster_url: string | null;
  backdrop_url: string | null;
  vote_average: number;
  vote_count: number;
  language: string;
  genres: string[];
  imdb_id: string | null;
  cast: Array<{ name: string; character: string | null; order: number }>;
  crew: Array<{ name: string; job: string | null; department: string | null }>;
  trailer_key: string | null;
  number_of_seasons: number | null;
  number_of_episodes: number | null;
  seasons: Array<{ season_number: number; name: string; episode_count: number; air_date: string | null; poster_url: string | null }> | null;
}

export async function getTmdbDetail(tmdbId: number, mediaType: MediaType): Promise<TmdbDetail> {
  if (!tmdbId || tmdbId <= 0) throw new Error('tmdb_id required');
  if (mediaType !== 'movie' && mediaType !== 'tv') throw new Error('media_type must be movie or tv');

  const raw = await tmdbGet<TmdbDetailRaw>(`/${mediaType}/${tmdbId}`, {
    append_to_response: 'credits,videos,external_ids,images',
  });

  const videos = raw.videos?.results ?? [];
  const trailer = videos.find((v) => v.site === 'YouTube' && v.type === 'Trailer' && v.official)
    ?? videos.find((v) => v.site === 'YouTube' && v.type === 'Trailer')
    ?? videos.find((v) => v.site === 'YouTube');

  const runtime = mediaType === 'movie'
    ? (raw.runtime ?? null)
    : (raw.episode_run_time?.[0] ?? null);

  return {
    tmdb_id: raw.id,
    media_type: mediaType,
    title: raw.title ?? raw.name ?? '',
    overview: raw.overview ?? null,
    release_date: raw.release_date ?? raw.first_air_date ?? null,
    runtime_minutes: runtime,
    poster_url: buildImageUrl(raw.poster_path, 'w500'),
    backdrop_url: buildImageUrl(raw.backdrop_path, 'w1280'),
    vote_average: raw.vote_average ?? 0,
    vote_count: raw.vote_count ?? 0,
    language: raw.original_language ?? 'en',
    genres: (raw.genres ?? []).map((g) => g.name),
    imdb_id: raw.external_ids?.imdb_id ?? null,
    cast: (raw.credits?.cast ?? []).slice(0, 30).map((c) => ({
      name: c.name, character: c.character ?? null, order: c.order ?? 0,
    })),
    crew: (raw.credits?.crew ?? []).slice(0, 40).map((c) => ({
      name: c.name, job: c.job ?? null, department: c.department ?? null,
    })),
    trailer_key: trailer?.key ?? null,
    number_of_seasons: raw.number_of_seasons ?? null,
    number_of_episodes: raw.number_of_episodes ?? null,
    seasons: raw.seasons
      ? raw.seasons.map((s) => ({
          season_number: s.season_number,
          name: s.name,
          episode_count: s.episode_count,
          air_date: s.air_date ?? null,
          poster_url: buildImageUrl(s.poster_path, 'w300'),
        }))
      : null,
  };
}

// ============================================================
// 149.7 — IMDb rating via OMDb
// ============================================================

export async function fetchImdbRating(imdbId: string): Promise<{ imdb_rating: number | null; imdb_votes: number | null; raw: any } | null> {
  if (!imdbId) return null;
  const cfg = getOmdbConfig();
  if (!cfg) return null;
  const data = await omdbGet<{ imdbRating?: string; imdbVotes?: string; Response?: string }>({ i: imdbId });
  if (!data || data.Response === 'False') return null;
  const rating = data.imdbRating && data.imdbRating !== 'N/A' ? parseFloat(data.imdbRating) : null;
  const votes = data.imdbVotes ? parseInt(data.imdbVotes.replace(/,/g, ''), 10) : null;
  return { imdb_rating: rating, imdb_votes: votes, raw: data };
}

// ============================================================
// 149.2 / 149.3 / 149.9 — Import into video / series
// ============================================================

export async function importMovieToVideo(input: {
  tmdb_id: number;
  video_id: string;
  imported_by: string;
  fetch_imdb?: boolean;
}): Promise<TmdbImportRecord> {
  const detail = await getTmdbDetail(input.tmdb_id, 'movie');
  return persistImport({
    detail,
    video_id: input.video_id,
    series_id: null,
    season_number: null,
    episode_number: null,
    imported_by: input.imported_by,
    fetch_imdb: input.fetch_imdb,
  });
}

export async function importTvShowToSeries(input: {
  tmdb_id: number;
  series_id: string;
  imported_by: string;
  fetch_imdb?: boolean;
}): Promise<TmdbImportRecord> {
  const detail = await getTmdbDetail(input.tmdb_id, 'tv');
  return persistImport({
    detail,
    video_id: null,
    series_id: input.series_id,
    season_number: null,
    episode_number: null,
    imported_by: input.imported_by,
    fetch_imdb: input.fetch_imdb,
  });
}

export async function importEpisodeToVideo(input: {
  tmdb_id: number;
  season_number: number;
  episode_number: number;
  video_id: string;
  imported_by: string;
}): Promise<TmdbImportRecord & { episode_detail: any }> {
  if (!input.season_number || input.season_number < 0) throw new Error('season_number required');
  if (!input.episode_number || input.episode_number < 0) throw new Error('episode_number required');

  const ep = await tmdbGet<any>(`/tv/${input.tmdb_id}/season/${input.season_number}/episode/${input.episode_number}`);

  const db = getDb();
  const existing = db.prepare(
    'SELECT * FROM tmdb_imports WHERE media_type = ? AND tmdb_id = ? AND season_number = ? AND episode_number = ?'
  ).get('tv', input.tmdb_id, input.season_number, input.episode_number) as TmdbImportRecord | undefined;

  const now = new Date().toISOString();
  const record: TmdbImportRecord = {
    id: existing?.id ?? randomUUID(),
    video_id: input.video_id,
    series_id: existing?.series_id ?? null,
    tmdb_id: input.tmdb_id,
    media_type: 'tv',
    season_number: input.season_number,
    episode_number: input.episode_number,
    poster_url: buildImageUrl(ep.still_path, 'w500'),
    backdrop_url: null,
    trailer_key: null,
    imdb_id: null,
    imdb_rating: null,
    imported_by: input.imported_by,
    imported_at: existing?.imported_at ?? now,
    last_synced_at: now,
    metadata_json: JSON.stringify({
      name: ep.name, overview: ep.overview, air_date: ep.air_date,
      vote_average: ep.vote_average, runtime: ep.runtime,
    }),
  };

  if (existing) {
    db.prepare(`
      UPDATE tmdb_imports SET video_id = ?, poster_url = ?, last_synced_at = ?, metadata_json = ?
      WHERE id = ?
    `).run(input.video_id, record.poster_url, now, record.metadata_json, existing.id);
  } else {
    db.prepare(`
      INSERT INTO tmdb_imports
        (id, video_id, series_id, tmdb_id, media_type, season_number, episode_number,
         poster_url, backdrop_url, trailer_key, imdb_id, imdb_rating,
         imported_by, imported_at, last_synced_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.video_id, record.series_id, record.tmdb_id, record.media_type,
      record.season_number, record.episode_number, record.poster_url, record.backdrop_url,
      record.trailer_key, record.imdb_id, record.imdb_rating,
      record.imported_by, record.imported_at, record.last_synced_at, record.metadata_json);
  }

  return { ...record, episode_detail: ep };
}

async function persistImport(input: {
  detail: TmdbDetail;
  video_id: string | null;
  series_id: string | null;
  season_number: number | null;
  episode_number: number | null;
  imported_by: string;
  fetch_imdb?: boolean;
}): Promise<TmdbImportRecord> {
  const { detail } = input;
  const db = getDb();

  let imdbRating: number | null = null;
  if (input.fetch_imdb && detail.imdb_id) {
    try {
      const imdb = await fetchImdbRating(detail.imdb_id);
      if (imdb) imdbRating = imdb.imdb_rating;
    } catch { /* ignore imdb failure */ }
  }

  const existing = db.prepare(
    'SELECT * FROM tmdb_imports WHERE media_type = ? AND tmdb_id = ? AND season_number IS NULL AND episode_number IS NULL'
  ).get(detail.media_type, detail.tmdb_id) as TmdbImportRecord | undefined;

  const now = new Date().toISOString();
  const record: TmdbImportRecord = {
    id: existing?.id ?? randomUUID(),
    video_id: input.video_id,
    series_id: input.series_id,
    tmdb_id: detail.tmdb_id,
    media_type: detail.media_type,
    season_number: null,
    episode_number: null,
    poster_url: detail.poster_url,
    backdrop_url: detail.backdrop_url,
    trailer_key: detail.trailer_key,
    imdb_id: detail.imdb_id,
    imdb_rating: imdbRating,
    imported_by: input.imported_by,
    imported_at: existing?.imported_at ?? now,
    last_synced_at: now,
    metadata_json: JSON.stringify(detail),
  };

  db.exec('BEGIN');
  try {
    if (existing) {
      db.prepare(`
        UPDATE tmdb_imports SET video_id = COALESCE(?, video_id),
          series_id = COALESCE(?, series_id),
          poster_url = ?, backdrop_url = ?, trailer_key = ?, imdb_id = ?,
          imdb_rating = ?, last_synced_at = ?, metadata_json = ?
        WHERE id = ?
      `).run(input.video_id, input.series_id, detail.poster_url, detail.backdrop_url,
        detail.trailer_key, detail.imdb_id, imdbRating, now, record.metadata_json, existing.id);
    } else {
      db.prepare(`
        INSERT INTO tmdb_imports
          (id, video_id, series_id, tmdb_id, media_type, season_number, episode_number,
           poster_url, backdrop_url, trailer_key, imdb_id, imdb_rating,
           imported_by, imported_at, last_synced_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(record.id, record.video_id, record.series_id, record.tmdb_id, record.media_type,
        record.poster_url, record.backdrop_url, record.trailer_key, record.imdb_id,
        record.imdb_rating, record.imported_by, record.imported_at, record.last_synced_at,
        record.metadata_json);
    }

    // 149.5 / 149.2 — Update videos table if linked
    if (input.video_id) {
      const setClauses: string[] = [];
      const params: any[] = [];
      if (detail.overview) { setClauses.push('description = ?'); params.push(detail.overview.slice(0, 5000)); }
      if (detail.poster_url) { setClauses.push('thumbnail_url = ?'); params.push(detail.poster_url); }
      if (detail.runtime_minutes) { setClauses.push('duration_seconds = ?'); params.push(detail.runtime_minutes * 60); }
      if (setClauses.length > 0) {
        setClauses.push('updated_at = ?');
        params.push(now, input.video_id);
        db.prepare(`UPDATE videos SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  return getImport(record.id)!;
}

// ============================================================
// 149.10 — Metadata Sync
// ============================================================

export async function resyncImport(importId: string): Promise<TmdbImportRecord> {
  const existing = getImport(importId);
  if (!existing) throw new Error('Import record not found');

  if (existing.media_type === 'movie') {
    const detail = await getTmdbDetail(existing.tmdb_id, 'movie');
    return persistImport({
      detail, video_id: existing.video_id, series_id: existing.series_id,
      season_number: null, episode_number: null,
      imported_by: existing.imported_by, fetch_imdb: true,
    });
  }

  // TV: refresh series-level + episode-level
  if (existing.season_number !== null && existing.episode_number !== null && existing.video_id) {
    const rec = await importEpisodeToVideo({
      tmdb_id: existing.tmdb_id,
      season_number: existing.season_number,
      episode_number: existing.episode_number,
      video_id: existing.video_id,
      imported_by: existing.imported_by,
    });
    return rec;
  }

  const detail = await getTmdbDetail(existing.tmdb_id, 'tv');
  return persistImport({
    detail, video_id: existing.video_id, series_id: existing.series_id,
    season_number: null, episode_number: null,
    imported_by: existing.imported_by, fetch_imdb: true,
  });
}

export function getImport(id: string): TmdbImportRecord | null {
  return (getDb().prepare('SELECT * FROM tmdb_imports WHERE id = ?').get(id) as TmdbImportRecord | undefined) ?? null;
}

export function getImportByTmdbId(tmdbId: number, mediaType: MediaType): TmdbImportRecord | null {
  return (getDb().prepare(
    'SELECT * FROM tmdb_imports WHERE tmdb_id = ? AND media_type = ? AND season_number IS NULL'
  ).get(tmdbId, mediaType) as TmdbImportRecord | undefined) ?? null;
}

export function getImportByVideo(videoId: string): TmdbImportRecord | null {
  return (getDb().prepare('SELECT * FROM tmdb_imports WHERE video_id = ?').get(videoId) as TmdbImportRecord | undefined) ?? null;
}

export function getImportBySeries(seriesId: string): TmdbImportRecord | null {
  return (getDb().prepare(
    'SELECT * FROM tmdb_imports WHERE series_id = ? AND season_number IS NULL'
  ).get(seriesId) as TmdbImportRecord | undefined) ?? null;
}

export function listImports(opts: { media_type?: MediaType; limit?: number; offset?: number } = {}): TmdbImportRecord[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const filters: string[] = [];
  const params: any[] = [];
  if (opts.media_type) { filters.push('media_type = ?'); params.push(opts.media_type); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  params.push(limit, offset);
  return db.prepare(
    `SELECT * FROM tmdb_imports ${where} ORDER BY imported_at DESC LIMIT ? OFFSET ?`
  ).all(...params) as TmdbImportRecord[];
}

export function deleteImport(id: string): boolean {
  const info = getDb().prepare('DELETE FROM tmdb_imports WHERE id = ?').run(id);
  return Number(info.changes ?? 0) > 0;
}

// ============================================================
// 149.8 — Multi-Language
// ============================================================

export async function getTmdbDetailInLanguage(tmdbId: number, mediaType: MediaType, language: string): Promise<TmdbDetail> {
  const raw = await tmdbGet<TmdbDetailRaw>(`/${mediaType}/${tmdbId}`, {
    append_to_response: 'credits,videos,external_ids',
    language,
  });
  const videos = raw.videos?.results ?? [];
  const trailer = videos.find((v) => v.site === 'YouTube' && v.type === 'Trailer') ?? videos.find((v) => v.site === 'YouTube');
  return {
    tmdb_id: raw.id, media_type: mediaType,
    title: raw.title ?? raw.name ?? '',
    overview: raw.overview ?? null,
    release_date: raw.release_date ?? raw.first_air_date ?? null,
    runtime_minutes: mediaType === 'movie' ? (raw.runtime ?? null) : (raw.episode_run_time?.[0] ?? null),
    poster_url: buildImageUrl(raw.poster_path, 'w500'),
    backdrop_url: buildImageUrl(raw.backdrop_path, 'w1280'),
    vote_average: raw.vote_average ?? 0, vote_count: raw.vote_count ?? 0,
    language,
    genres: (raw.genres ?? []).map((g) => g.name),
    imdb_id: raw.external_ids?.imdb_id ?? null,
    cast: (raw.credits?.cast ?? []).slice(0, 30).map((c) => ({ name: c.name, character: c.character ?? null, order: c.order ?? 0 })),
    crew: (raw.credits?.crew ?? []).slice(0, 40).map((c) => ({ name: c.name, job: c.job ?? null, department: c.department ?? null })),
    trailer_key: trailer?.key ?? null,
    number_of_seasons: raw.number_of_seasons ?? null,
    number_of_episodes: raw.number_of_episodes ?? null,
    seasons: raw.seasons ? raw.seasons.map((s) => ({
      season_number: s.season_number, name: s.name, episode_count: s.episode_count,
      air_date: s.air_date ?? null, poster_url: buildImageUrl(s.poster_path, 'w300'),
    })) : null,
  };
}

// ============================================================
// 149.4 — Cast/Crew extraction (returns normalized data for further processing)
// ============================================================

export interface NormalizedCastCrew {
  cast: Array<{ name: string; character: string | null; order: number }>;
  directors: string[];
  producers: string[];
  writers: string[];
  composers: string[];
}

export function normalizeCastCrew(detail: TmdbDetail): NormalizedCastCrew {
  const byJob = (job: string) => detail.crew.filter((c) => c.job === job).map((c) => c.name);
  return {
    cast: detail.cast,
    directors: byJob('Director'),
    producers: byJob('Producer').concat(byJob('Executive Producer')),
    writers: byJob('Writer').concat(byJob('Screenplay')).concat(byJob('Story')),
    composers: byJob('Original Music Composer').concat(byJob('Music')),
  };
}
