// melodyflix videos — Content Ingest Engine (Section 37 core)
// Takes fetch jobs from content-source worker and creates:
//   - Videos (movies, news, podcasts, generic)
//   - Series + Seasons + Episodes (dramas, TV, web series)
//   - Tracks (music/songs)
// Auto-fills metadata from TMDB when tmdb_id is available.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';
import {
  getFetchJob, markJobImporting, markJobCompleted, markJobDuplicate,
  markJobFailed, getContentSource, applySourceDefaults,
  type FetchJob, type ExtractedMetadata, type ContentSource, type ContentKind,
} from './content-source.service.js';
import { createVideo, updateVideoStatus } from './video.service.js';
import { createSeries, createSeason, createEpisode } from './series.service.js';
import { createArtist, createAlbum, createTrack, searchArtists } from './music.service.js';
import { addGenre } from './genre.service.js';
import { addTag } from './tag.service.js';
import {
  getTmdbDetail, importMovieToVideo, importTvShowToSeries,
  type TmdbDetail,
} from './tmdb.service.js';
import { isIntegrationReady } from './integration-settings.service.js';

export interface IngestResult {
  job_id: string;
  status: 'completed' | 'failed' | 'skipped';
  content_kind: ContentKind;
  video_id?: string;
  series_id?: string;
  season_id?: string;
  episode_id?: string;
  track_id?: string;
  artist_id?: string;
  album_id?: string;
  error?: string;
}

interface JobMetadata {
  title?: string;
  description?: string | null;
  external_id?: string | null;
  release_date?: string | null;
  language?: string | null;
  thumbnail_url?: string | null;
  tags?: string[];
  category?: string | null;
  content_type?: string;
  enclosure_url?: string | null;
  enclosure_type?: string | null;
  tmdb_id?: number | null;
  media_type?: 'movie' | 'tv' | null;
  season_number?: number | null;
  episode_number?: number | null;
  publish_action?: string;
}

function parseJobMetadata(job: FetchJob): JobMetadata {
  if (!job.metadata_json) return {};
  try { return JSON.parse(job.metadata_json) as JobMetadata; }
  catch { return {}; }
}

// ============================================================
// Main dispatcher
// ============================================================

export async function ingestFetchJob(jobId: string): Promise<IngestResult> {
  const job = getFetchJob(jobId);
  if (!job) return { job_id: jobId, status: 'failed', content_kind: 'other', error: 'Job not found' };
  if (job.status === 'completed') {
    return { job_id: jobId, status: 'skipped', content_kind: 'other', error: 'Already completed' };
  }

  const source = getContentSource(job.source_id);
  if (!source) {
    markJobFailed(jobId, 'Source not found');
    return { job_id: jobId, status: 'failed', content_kind: 'other', error: 'Source not found' };
  }

  const meta = parseJobMetadata(job);
  markJobImporting(jobId);

  try {
    switch (source.content_kind) {
      case 'movie': return await ingestMovie(job, source, meta);
      case 'tv':
      case 'drama':
      case 'web_series': return await ingestSeriesLike(job, source, meta);
      case 'song': return await ingestMusic(job, source, meta);
      case 'news': return await ingestNews(job, source, meta);
      case 'podcast': return await ingestPodcast(job, source, meta);
      default: return await ingestGeneric(job, source, meta);
    }
  } catch (err) {
    const msg = (err as Error).message;
    markJobFailed(jobId, msg);
    return { job_id: jobId, status: 'failed', content_kind: source.content_kind, error: msg };
  }
}

// ============================================================
// Helpers
// ============================================================

function resolveChannelId(source: ContentSource): string {
  if (!source.default_channel_id) {
    throw new Error('Source has no default_channel_id — set it in admin panel');
  }
  return source.default_channel_id;
}

function resolveOwnerId(source: ContentSource): string {
  // Use approved_by as owner fallback (admin who approved the source)
  return source.approved_by ?? source.created_by;
}

function mapCategory(kind: ContentKind, meta: JobMetadata): string {
  if (meta.category) return meta.category;
  switch (kind) {
    case 'movie': return 'film';
    case 'tv':
    case 'drama':
    case 'web_series': return 'entertainment';
    case 'song': return 'music';
    case 'news': return 'news';
    case 'podcast': return 'entertainment';
    default: return 'other';
  }
}

function applyMetadataToVideo(videoId: string, meta: JobMetadata, detail?: TmdbDetail): void {
  const db = getDb();
  const patch: Record<string, any> = {};
  if (detail) {
    if (detail.overview) patch.description = detail.overview.slice(0, 5000);
    if (detail.poster_url) patch.thumbnail_url = detail.poster_url;
    if (detail.runtime_minutes) patch.duration_seconds = detail.runtime_minutes * 60;
  } else {
    if (meta.description) patch.description = meta.description.slice(0, 5000);
    if (meta.thumbnail_url) patch.thumbnail_url = meta.thumbnail_url;
  }
  if (Object.keys(patch).length === 0) return;
  const fields = Object.keys(patch).map((k) => `${k} = ?`);
  fields.push('updated_at = ?');
  db.prepare(`UPDATE videos SET ${fields.join(', ')} WHERE id = ?`)
    .run(...Object.values(patch), new Date().toISOString(), videoId);
}

function applyGenres(videoId: string, detail?: TmdbDetail, meta?: JobMetadata): void {
  if (detail?.genres) {
    for (const g of detail.genres.slice(0, 5)) {
      try { addGenre(videoId, g.toLowerCase()); } catch { /* ignore */ }
    }
  }
  if (meta?.tags) {
    for (const t of meta.tags.slice(0, 10)) {
      try { addTag(videoId, t.toLowerCase()); } catch { /* ignore */ }
    }
  }
}

// ============================================================
// 37.1 — Movie
// ============================================================

async function ingestMovie(job: FetchJob, source: ContentSource, meta: JobMetadata): Promise<IngestResult> {
  const channelId = resolveChannelId(source);
  const ownerId = resolveOwnerId(source);

  // Priority 1: TMDB-driven import (rich metadata)
  if (meta.tmdb_id && isIntegrationReady('tmdb')) {
    // Create the placeholder video first
    const video = createVideo(ownerId, channelId, {
      title: meta.title ?? 'Untitled Movie',
      description: meta.description ?? undefined,
      visibility: 'public',
      category: 'film',
      content_type: 'movie',
    }, 0, 'tmdb-import');

    // Attach TMDB metadata
    await importMovieToVideo({
      tmdb_id: meta.tmdb_id,
      video_id: video.id,
      imported_by: ownerId,
      fetch_imdb: true,
    });

    // If the job has an enclosure URL (real file), mark as ready with that URL
    if (meta.enclosure_url) {
      updateVideoStatus(video.id, 'ready', { hls_master_url: meta.enclosure_url });
    }

    markJobCompleted(job.id, video.id, { kind: 'movie', tmdb_id: meta.tmdb_id });
    return { job_id: job.id, status: 'completed', content_kind: 'movie', video_id: video.id };
  }

  // Fallback: plain video entry (requires later upload)
  const video = createVideo(ownerId, channelId, {
    title: meta.title ?? 'Untitled Movie',
    description: meta.description ?? undefined,
    visibility: 'public',
    category: 'film',
    content_type: 'movie',
  }, 0, 'rss-import');

  applyMetadataToVideo(video.id, meta);
  applyGenres(video.id, undefined, meta);

  if (meta.enclosure_url) {
    updateVideoStatus(video.id, 'ready', { hls_master_url: meta.enclosure_url });
  }

  markJobCompleted(job.id, video.id, { kind: 'movie' });
  return { job_id: job.id, status: 'completed', content_kind: 'movie', video_id: video.id };
}

// ============================================================
// 37.2 / 37.4 — TV Series, Drama, Web Series
// ============================================================

async function ingestSeriesLike(job: FetchJob, source: ContentSource, meta: JobMetadata): Promise<IngestResult> {
  const channelId = resolveChannelId(source);
  const ownerId = resolveOwnerId(source);

  // TMDB-driven series
  if (meta.tmdb_id && meta.media_type === 'tv' && isIntegrationReady('tmdb')) {
    const series = createSeries({
      channel_id: channelId,
      title: meta.title ?? 'Untitled Series',
      description: meta.description ?? undefined,
      cover_url: meta.thumbnail_url ?? undefined,
      category: mapCategory(source.content_kind, meta),
    });

    await importTvShowToSeries({
      tmdb_id: meta.tmdb_id,
      series_id: series.id,
      imported_by: ownerId,
      fetch_imdb: true,
    });

    markJobCompleted(job.id, series.id, { kind: 'series', tmdb_id: meta.tmdb_id });
    return { job_id: job.id, status: 'completed', content_kind: source.content_kind, series_id: series.id };
  }

  // Plain series (no TMDB)
  const series = createSeries({
    channel_id: channelId,
    title: meta.title ?? 'Untitled Series',
    description: meta.description ?? undefined,
    cover_url: meta.thumbnail_url ?? undefined,
    category: mapCategory(source.content_kind, meta),
  });

  markJobCompleted(job.id, series.id, { kind: 'series' });
  return { job_id: job.id, status: 'completed', content_kind: source.content_kind, series_id: series.id };
}

// ============================================================
// 37.3 — Music / Song
// ============================================================

async function ingestMusic(job: FetchJob, source: ContentSource, meta: JobMetadata): Promise<IngestResult> {
  if (!meta.enclosure_url) throw new Error('Music job has no enclosure URL (audio)');

  const ownerId = resolveOwnerId(source);
  const artistName = (meta as any).artist ?? 'Unknown Artist';

  // Find existing artist by name (fuzzy) or create
  const existing = searchArtists(artistName, 5);
  let artist = existing.find((a) => a.name.toLowerCase() === artistName.toLowerCase());
  if (!artist) {
    artist = createArtist({ name: artistName });
  }

  const track = createTrack({
    artist_id: artist.id,
    title: meta.title ?? 'Untitled Track',
    description: meta.description ?? undefined,
    audio_url: meta.enclosure_url,
    cover_url: meta.thumbnail_url ?? undefined,
    genre: meta.category ?? undefined,
    language: meta.language ?? undefined,
    release_date: meta.release_date ?? undefined,
  });

  markJobCompleted(job.id, track.id, { kind: 'music', artist_id: artist.id });
  return {
    job_id: job.id, status: 'completed', content_kind: 'song',
    track_id: track.id, artist_id: artist.id,
  };
}

// ============================================================
// 37.6 — News Portal
// ============================================================

async function ingestNews(job: FetchJob, source: ContentSource, meta: JobMetadata): Promise<IngestResult> {
  // News items go to news_items (Section 72), not videos table.
  const db = getDb();
  const reporterId = resolveOwnerId(source);

  const title = meta.title ?? 'Untitled News';
  const slug = title.toLowerCase().trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .slice(0, 120) || 'news';

  // Check for duplicate slug
  const existing = db.prepare('SELECT id FROM news_items WHERE slug = ?').get(slug) as { id: string } | undefined;
  if (existing) {
    markJobDuplicate(job.id, `News slug collision: ${slug}`);
    return { job_id: job.id, status: 'skipped', content_kind: 'news' };
  }

  const newsId = randomUUID();
  const now = new Date().toISOString();
  const category = meta.category ?? 'general';
  const sources = meta.enclosure_url
    ? JSON.stringify([{ name: source.name, url: meta.enclosure_url, date: meta.release_date ?? null }])
    : null;

  db.prepare(`
    INSERT INTO news_items (id, title, slug, summary, body, category, reporter_id, editor_id,
      status, priority, is_breaking, breaking_expires_at, is_ticker, ticker_order,
      fact_check_status, sources_json, hero_image_url, tags, language, view_count,
      published_at, archived_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'draft', 'normal', 0, NULL, 0, 0,
      'unchecked', ?, ?, ?, ?, 0, NULL, NULL, ?, ?)
  `).run(
    newsId, title, slug, meta.description ?? '', meta.description ?? '',
    category, reporterId, sources,
    meta.thumbnail_url ?? null,
    meta.tags ? JSON.stringify(meta.tags.slice(0, 20)) : null,
    meta.language ?? 'en', now, now,
  );

  markJobCompleted(job.id, newsId, { kind: 'news' });
  return { job_id: job.id, status: 'completed', content_kind: 'news', video_id: newsId };
}

// ============================================================
// 37.7 — Podcast
// ============================================================

async function ingestPodcast(job: FetchJob, source: ContentSource, meta: JobMetadata): Promise<IngestResult> {
  // Podcasts go into videos table with content_type='podcast'
  const channelId = resolveChannelId(source);
  const ownerId = resolveOwnerId(source);

  if (!meta.enclosure_url) throw new Error('Podcast job has no enclosure URL');

  const video = createVideo(ownerId, channelId, {
    title: meta.title ?? 'Untitled Podcast Episode',
    description: meta.description ?? undefined,
    visibility: 'public',
    category: 'entertainment',
    content_type: 'podcast',
  }, 0, 'rss-podcast');

  updateVideoStatus(video.id, 'ready', { hls_master_url: meta.enclosure_url });
  applyMetadataToVideo(video.id, meta);
  applyGenres(video.id, undefined, meta);

  markJobCompleted(job.id, video.id, { kind: 'podcast' });
  return { job_id: job.id, status: 'completed', content_kind: 'podcast', video_id: video.id };
}

// ============================================================
// Fallback — generic
// ============================================================

async function ingestGeneric(job: FetchJob, source: ContentSource, meta: JobMetadata): Promise<IngestResult> {
  const channelId = resolveChannelId(source);
  const ownerId = resolveOwnerId(source);

  const video = createVideo(ownerId, channelId, {
    title: meta.title ?? 'Untitled Content',
    description: meta.description ?? undefined,
    visibility: 'public',
    category: mapCategory(source.content_kind, meta),
    content_type: source.content_kind,
  }, 0, 'generic-import');

  if (meta.enclosure_url) {
    updateVideoStatus(video.id, 'ready', { hls_master_url: meta.enclosure_url });
  }
  applyMetadataToVideo(video.id, meta);
  applyGenres(video.id, undefined, meta);

  markJobCompleted(job.id, video.id, { kind: 'generic' });
  return { job_id: job.id, status: 'completed', content_kind: source.content_kind, video_id: video.id };
}

// ============================================================
// Batch ingest — process multiple queued jobs
// ============================================================

export interface BatchIngestResult {
  processed: number;
  completed: number;
  failed: number;
  skipped: number;
  results: IngestResult[];
}

export async function ingestQueuedJobs(limit = 20): Promise<BatchIngestResult> {
  const db = getDb();
  const queued = db.prepare(
    "SELECT * FROM content_fetch_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?"
  ).all(Math.min(Math.max(limit, 1), 100)) as FetchJob[];

  const out: BatchIngestResult = {
    processed: 0, completed: 0, failed: 0, skipped: 0, results: [],
  };
  for (const job of queued) {
    const r = await ingestFetchJob(job.id);
    out.processed += 1;
    if (r.status === 'completed') out.completed += 1;
    else if (r.status === 'failed') out.failed += 1;
    else out.skipped += 1;
    out.results.push(r);
  }
  return out;
}

// ============================================================
// Per-kind counts (dashboard)
// ============================================================

export interface IngestStats {
  completed_today: number;
  failed_today: number;
  by_kind: Record<string, number>;
}

export function getIngestStats(): IngestStats {
  const db = getDb();
  const since = new Date(Date.now() - 86400_000).toISOString();
  const completed = (db.prepare(
    "SELECT COUNT(*) as n FROM content_fetch_jobs WHERE status = 'completed' AND completed_at >= ?"
  ).get(since) as { n: number }).n;
  const failed = (db.prepare(
    "SELECT COUNT(*) as n FROM content_fetch_jobs WHERE status = 'failed' AND completed_at >= ?"
  ).get(since) as { n: number }).n;

  const rows = db.prepare(`
    SELECT cs.content_kind, COUNT(*) as n
    FROM content_fetch_jobs cfj
    INNER JOIN content_sources cs ON cs.id = cfj.source_id
    WHERE cfj.status = 'completed' AND cfj.completed_at >= ?
    GROUP BY cs.content_kind
  `).all(since) as Array<{ content_kind: string; n: number }>;

  const byKind: Record<string, number> = {};
  for (const r of rows) byKind[r.content_kind] = r.n;

  return { completed_today: completed, failed_today: failed, by_kind: byKind };
}
