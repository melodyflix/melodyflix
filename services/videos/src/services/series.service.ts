// melodyflix videos - series management service
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export interface Series {
  id: string;
  channel_id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  category: string;
  total_seasons: number;
  total_episodes: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Season {
  id: string;
  series_id: string;
  season_number: number;
  title: string | null;
  description: string | null;
  episode_count: number;
  created_at: string;
  updated_at: string;
}

export interface Episode {
  id: string;
  series_id: string;
  season_id: string;
  video_id: string;
  episode_number: number;
  title: string;
  description: string | null;
  skip_intro_seconds: number;
  skip_recap_seconds: number;
  skip_credits_seconds: number;
  air_date: string | null;
  created_at: string;
  updated_at: string;
}

export function ensureSeriesSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS series (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      cover_url TEXT,
      category TEXT DEFAULT 'other',
      total_seasons INTEGER NOT NULL DEFAULT 0,
      total_episodes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ongoing',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_series_channel ON series(channel_id);

    CREATE TABLE IF NOT EXISTS seasons (
      id TEXT PRIMARY KEY,
      series_id TEXT NOT NULL,
      season_number INTEGER NOT NULL,
      title TEXT,
      description TEXT,
      episode_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (series_id, season_number)
    );
    CREATE INDEX IF NOT EXISTS idx_seasons_series ON seasons(series_id);

    CREATE TABLE IF NOT EXISTS episodes (
      id TEXT PRIMARY KEY,
      series_id TEXT NOT NULL,
      season_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      episode_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      skip_intro_seconds REAL DEFAULT 0,
      skip_recap_seconds REAL DEFAULT 0,
      skip_credits_seconds REAL DEFAULT 0,
      air_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (season_id, episode_number)
    );
    CREATE INDEX IF NOT EXISTS idx_episodes_series ON episodes(series_id);
    CREATE INDEX IF NOT EXISTS idx_episodes_video ON episodes(video_id);

    CREATE TABLE IF NOT EXISTS series_release_calendar (
      id TEXT PRIMARY KEY,
      series_id TEXT NOT NULL,
      season_id TEXT NOT NULL,
      episode_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      planned_air_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned','released','delayed','cancelled')),
      note TEXT,
      episode_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (series_id, season_id, episode_number)
    );
    CREATE INDEX IF NOT EXISTS idx_release_series ON series_release_calendar(series_id, planned_air_date);
    CREATE INDEX IF NOT EXISTS idx_release_status ON series_release_calendar(status, planned_air_date);
  `);
}

// ---------- Series ----------

export interface CreateSeriesInput {
  channel_id: string;
  title: string;
  description?: string;
  cover_url?: string;
  category?: string;
}

export function createSeries(input: CreateSeriesInput): Series {
  const db = getDb();
  const now = new Date().toISOString();
  const series: Series = {
    id: randomUUID(),
    channel_id: input.channel_id,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    cover_url: input.cover_url ?? null,
    category: input.category ?? 'other',
    total_seasons: 0,
    total_episodes: 0,
    status: 'ongoing',
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO series (id, channel_id, title, description, cover_url, category,
      total_seasons, total_episodes, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    series.id, series.channel_id, series.title, series.description, series.cover_url,
    series.category, series.total_seasons, series.total_episodes, series.status,
    series.created_at, series.updated_at
  );
  return series;
}

export function getSeriesById(id: string): Series | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM series WHERE id = ?').get(id) as Series | undefined) ?? null;
}

export function listSeriesByChannel(channelId: string): Series[] {
  const db = getDb();
  return db.prepare('SELECT * FROM series WHERE channel_id = ? ORDER BY created_at DESC')
    .all(channelId) as Series[];
}

export function listAllSeries(limit = 50, offset = 0): Series[] {
  const db = getDb();
  return db.prepare('SELECT * FROM series ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as Series[];
}

export function updateSeries(id: string, channelId: string, updates: Partial<CreateSeriesInput> & { status?: string }): Series {
  const db = getDb();
  const existing = getSeriesById(id);
  if (!existing) throw new Error('Series not found');
  if (existing.channel_id !== channelId) throw new Error('Not authorized');
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE series SET title = ?, description = ?, cover_url = ?, category = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(
    updates.title?.trim() || existing.title,
    updates.description !== undefined ? (updates.description.trim() || null) : existing.description,
    updates.cover_url ?? existing.cover_url,
    updates.category ?? existing.category,
    updates.status ?? existing.status,
    now,
    id
  );
  return getSeriesById(id)!;
}

export function deleteSeries(id: string, channelId: string): void {
  const db = getDb();
  const existing = getSeriesById(id);
  if (!existing) throw new Error('Series not found');
  if (existing.channel_id !== channelId) throw new Error('Not authorized');
  db.prepare('DELETE FROM episodes WHERE series_id = ?').run(id);
  db.prepare('DELETE FROM seasons WHERE series_id = ?').run(id);
  db.prepare('DELETE FROM series WHERE id = ?').run(id);
}

// ---------- Seasons ----------

export function createSeason(seriesId: string, channelId: string, seasonNumber: number, title?: string, description?: string): Season {
  const db = getDb();
  const series = getSeriesById(seriesId);
  if (!series) throw new Error('Series not found');
  if (series.channel_id !== channelId) throw new Error('Not authorized');

  const now = new Date().toISOString();
  const season: Season = {
    id: randomUUID(),
    series_id: seriesId,
    season_number: seasonNumber,
    title: title?.trim() || `Season ${seasonNumber}`,
    description: description?.trim() || null,
    episode_count: 0,
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO seasons (id, series_id, season_number, title, description, episode_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(season.id, season.series_id, season.season_number, season.title, season.description, 0, now, now);

  // Update series.total_seasons
  db.prepare('UPDATE series SET total_seasons = total_seasons + 1, updated_at = ? WHERE id = ?')
    .run(now, seriesId);

  return season;
}

export function listSeasons(seriesId: string): Season[] {
  const db = getDb();
  return db.prepare('SELECT * FROM seasons WHERE series_id = ? ORDER BY season_number ASC')
    .all(seriesId) as Season[];
}

export function getSeasonById(id: string): Season | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM seasons WHERE id = ?').get(id) as Season | undefined) ?? null;
}

export function deleteSeason(seasonId: string, channelId: string): void {
  const db = getDb();
  const season = getSeasonById(seasonId);
  if (!season) throw new Error('Season not found');
  const series = getSeriesById(season.series_id);
  if (!series || series.channel_id !== channelId) throw new Error('Not authorized');

  const epCount = (db.prepare('SELECT COUNT(*) as n FROM episodes WHERE season_id = ?').get(seasonId) as { n: number }).n;
  db.prepare('DELETE FROM episodes WHERE season_id = ?').run(seasonId);
  db.prepare('DELETE FROM seasons WHERE id = ?').run(seasonId);
  db.prepare(`
    UPDATE series
    SET total_seasons = MAX(total_seasons - 1, 0),
        total_episodes = MAX(total_episodes - ?, 0),
        updated_at = ?
    WHERE id = ?
  `).run(epCount, new Date().toISOString(), season.series_id);
}

// ---------- Episodes ----------

export interface CreateEpisodeInput {
  series_id: string;
  season_id: string;
  video_id: string;
  episode_number: number;
  title: string;
  description?: string;
  skip_intro_seconds?: number;
  skip_recap_seconds?: number;
  skip_credits_seconds?: number;
  air_date?: string;
}

export function createEpisode(input: CreateEpisodeInput, channelId: string): Episode {
  const db = getDb();
  const series = getSeriesById(input.series_id);
  if (!series) throw new Error('Series not found');
  if (series.channel_id !== channelId) throw new Error('Not authorized');
  const season = getSeasonById(input.season_id);
  if (!season || season.series_id !== input.series_id) throw new Error('Invalid season');

  const now = new Date().toISOString();
  const ep: Episode = {
    id: randomUUID(),
    series_id: input.series_id,
    season_id: input.season_id,
    video_id: input.video_id,
    episode_number: input.episode_number,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    skip_intro_seconds: input.skip_intro_seconds ?? 0,
    skip_recap_seconds: input.skip_recap_seconds ?? 0,
    skip_credits_seconds: input.skip_credits_seconds ?? 0,
    air_date: input.air_date ?? null,
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO episodes (id, series_id, season_id, video_id, episode_number, title, description,
      skip_intro_seconds, skip_recap_seconds, skip_credits_seconds, air_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ep.id, ep.series_id, ep.season_id, ep.video_id, ep.episode_number, ep.title, ep.description,
    ep.skip_intro_seconds, ep.skip_recap_seconds, ep.skip_credits_seconds, ep.air_date,
    ep.created_at, ep.updated_at
  );

  db.prepare('UPDATE seasons SET episode_count = episode_count + 1, updated_at = ? WHERE id = ?')
    .run(now, input.season_id);
  db.prepare('UPDATE series SET total_episodes = total_episodes + 1, updated_at = ? WHERE id = ?')
    .run(now, input.series_id);

  return ep;
}

export function listEpisodes(seasonId: string): Episode[] {
  const db = getDb();
  return db.prepare('SELECT * FROM episodes WHERE season_id = ? ORDER BY episode_number ASC')
    .all(seasonId) as Episode[];
}

export function listAllEpisodesForSeries(seriesId: string): Episode[] {
  const db = getDb();
  return db.prepare('SELECT * FROM episodes WHERE series_id = ? ORDER BY season_id, episode_number ASC')
    .all(seriesId) as Episode[];
}

export function getEpisodeByVideo(videoId: string): Episode | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM episodes WHERE video_id = ?').get(videoId) as Episode | undefined) ?? null;
}

export function updateEpisode(episodeId: string, channelId: string, updates: Partial<CreateEpisodeInput>): Episode {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId) as Episode | undefined;
  if (!existing) throw new Error('Episode not found');
  const series = getSeriesById(existing.series_id);
  if (!series || series.channel_id !== channelId) throw new Error('Not authorized');

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE episodes SET title = ?, description = ?, episode_number = ?,
      skip_intro_seconds = ?, skip_recap_seconds = ?, skip_credits_seconds = ?, air_date = ?, updated_at = ?
    WHERE id = ?
  `).run(
    updates.title?.trim() || existing.title,
    updates.description !== undefined ? (updates.description?.trim() || null) : existing.description,
    updates.episode_number ?? existing.episode_number,
    updates.skip_intro_seconds ?? existing.skip_intro_seconds,
    updates.skip_recap_seconds ?? existing.skip_recap_seconds,
    updates.skip_credits_seconds ?? existing.skip_credits_seconds,
    updates.air_date ?? existing.air_date,
    now,
    episodeId
  );
  return db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId) as Episode;
}

export function deleteEpisode(episodeId: string, channelId: string): void {
  const db = getDb();
  const ep = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId) as Episode | undefined;
  if (!ep) throw new Error('Episode not found');
  const series = getSeriesById(ep.series_id);
  if (!series || series.channel_id !== channelId) throw new Error('Not authorized');

  db.prepare('DELETE FROM episodes WHERE id = ?').run(episodeId);
  const now = new Date().toISOString();
  db.prepare('UPDATE seasons SET episode_count = MAX(episode_count - 1, 0), updated_at = ? WHERE id = ?')
    .run(now, ep.season_id);
  db.prepare('UPDATE series SET total_episodes = MAX(total_episodes - 1, 0), updated_at = ? WHERE id = ?')
    .run(now, ep.series_id);
}

// ---------- Navigation: Next / Prev ----------

export interface NextEpisodeResult {
  episode: Episode | null;
  video: any | null;
}

export function getNextEpisode(currentVideoId: string): NextEpisodeResult {
  const db = getDb();
  const cur = getEpisodeByVideo(currentVideoId);
  if (!cur) return { episode: null, video: null };

  // Same season, next episode
  const next = db.prepare(`
    SELECT * FROM episodes
    WHERE series_id = ? AND season_id = ? AND episode_number > ?
    ORDER BY episode_number ASC LIMIT 1
  `).get(cur.series_id, cur.season_id, cur.episode_number) as Episode | undefined;

  if (next) {
    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(next.video_id);
    return { episode: next, video };
  }

  // Next season, first episode
  const nextSeason = db.prepare(`
    SELECT e.* FROM episodes e
    INNER JOIN seasons s ON s.id = e.season_id
    WHERE e.series_id = ?
      AND s.season_number > (SELECT season_number FROM seasons WHERE id = ?)
    ORDER BY s.season_number ASC, e.episode_number ASC
    LIMIT 1
  `).get(cur.series_id, cur.season_id) as Episode | undefined;

  if (nextSeason) {
    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(nextSeason.video_id);
    return { episode: nextSeason, video };
  }

  return { episode: null, video: null };
}

export function getSeriesWithSeasons(seriesId: string): {
  series: Series;
  seasons: (Season & { episodes: Episode[] })[];
} | null {
  const series = getSeriesById(seriesId);
  if (!series) return null;
  const seasons = listSeasons(seriesId).map((s) => ({
    ...s,
    episodes: listEpisodes(s.id),
  }));
  return { series, seasons };
}

// ---------- 75.3 Release Calendar ----------

export interface ReleaseEntry {
  id: string;
  series_id: string;
  season_id: string;
  episode_number: number;
  title: string;
  planned_air_date: string;
  status: 'planned' | 'released' | 'delayed' | 'cancelled';
  note: string | null;
  episode_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleReleaseInput {
  series_id: string;
  season_id: string;
  episode_number: number;
  title: string;
  planned_air_date: string;
  note?: string | null;
}

export function scheduleRelease(input: ScheduleReleaseInput, channelId: string): ReleaseEntry {
  const db = getDb();
  const series = getSeriesById(input.series_id);
  if (!series) throw new Error('Series not found');
  if (series.channel_id !== channelId) throw new Error('Not authorized');
  const season = getSeasonById(input.season_id);
  if (!season || season.series_id !== input.series_id) throw new Error('Invalid season');
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO series_release_calendar
    (id, series_id, season_id, episode_number, title, planned_air_date, status, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?)
  `).run(id, input.series_id, input.season_id, input.episode_number, input.title.trim(),
    input.planned_air_date, input.note ?? null, now, now);
  return db.prepare('SELECT * FROM series_release_calendar WHERE id = ?').get(id) as ReleaseEntry;
}

export interface UpdateReleaseInput {
  title?: string;
  planned_air_date?: string;
  status?: 'planned' | 'released' | 'delayed' | 'cancelled';
  note?: string | null;
  episode_id?: string | null;
}

export function updateRelease(id: string, channelId: string, patch: UpdateReleaseInput): ReleaseEntry {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM series_release_calendar WHERE id = ?').get(id) as ReleaseEntry | undefined;
  if (!existing) throw new Error('Release entry not found');
  const series = getSeriesById(existing.series_id);
  if (!series || series.channel_id !== channelId) throw new Error('Not authorized');
  const f: string[] = [];
  const v: unknown[] = [];
  for (const k of ['title','planned_air_date','status','note','episode_id'] as const) {
    if (patch[k] !== undefined) { f.push(`${k} = ?`); v.push(patch[k]); }
  }
  if (!f.length) return existing;
  f.push('updated_at = ?'); v.push(new Date().toISOString());
  v.push(id);
  db.prepare(`UPDATE series_release_calendar SET ${f.join(', ')} WHERE id = ?`).run(...v);
  return db.prepare('SELECT * FROM series_release_calendar WHERE id = ?').get(id) as ReleaseEntry;
}

export function deleteRelease(id: string, channelId: string): void {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM series_release_calendar WHERE id = ?').get(id) as ReleaseEntry | undefined;
  if (!existing) return;
  const series = getSeriesById(existing.series_id);
  if (!series || series.channel_id !== channelId) throw new Error('Not authorized');
  db.prepare('DELETE FROM series_release_calendar WHERE id = ?').run(id);
}

export function listReleaseCalendar(seriesId: string): ReleaseEntry[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM series_release_calendar WHERE series_id = ? ORDER BY planned_air_date ASC'
  ).all(seriesId) as ReleaseEntry[];
}

export interface UpcomingRelease extends ReleaseEntry {
  series_title: string;
}

export function listUpcomingReleases(daysAhead = 90, limit = 100): UpcomingRelease[] {
  const db = getDb();
  const now = new Date();
  const until = new Date(now.getTime() + daysAhead * 86_400_000).toISOString();
  return db.prepare(`
    SELECT r.*, s.title AS series_title
    FROM series_release_calendar r
    JOIN series s ON s.id = r.series_id
    WHERE r.status IN ('planned','delayed')
      AND r.planned_air_date >= ?
      AND r.planned_air_date <= ?
    ORDER BY r.planned_air_date ASC
    LIMIT ?
  `).all(now.toISOString(), until, limit) as UpcomingRelease[];
}

export function listOverdueReleases(): UpcomingRelease[] {
  const db = getDb();
  const now = new Date().toISOString();
  return db.prepare(`
    SELECT r.*, s.title AS series_title
    FROM series_release_calendar r
    JOIN series s ON s.id = r.series_id
    WHERE r.status = 'planned' AND r.planned_air_date < ?
    ORDER BY r.planned_air_date ASC
  `).all(now) as UpcomingRelease[];
}

// ---------- 75.4 Missing Episode Detection ----------

export interface EpisodeGap {
  season_id: string;
  season_number: number;
  expected_from: number;
  expected_to: number;
  missing: number[];
  present_count: number;
  max_episode_number: number;
}

export interface MissingEpisodesReport {
  series_id: string;
  series_title: string;
  seasons: EpisodeGap[];
  total_missing: number;
}

export function detectMissingEpisodes(seriesId: string): MissingEpisodesReport {
  const db = getDb();
  const series = getSeriesById(seriesId);
  if (!series) throw new Error('Series not found');
  const seasons = listSeasons(seriesId);
  const gaps: EpisodeGap[] = [];
  for (const s of seasons) {
    const eps = listEpisodes(s.id);
    if (eps.length === 0) continue;
    const numbers = eps.map(e => e.episode_number).sort((a, b) => a - b);
    const maxNum = numbers[numbers.length - 1];
    const present = new Set(numbers);
    const missing: number[] = [];
    for (let i = 1; i <= maxNum; i++) {
      if (!present.has(i)) missing.push(i);
    }
    if (missing.length > 0) {
      gaps.push({
        season_id: s.id,
        season_number: s.season_number,
        expected_from: 1,
        expected_to: maxNum,
        missing,
        present_count: numbers.length,
        max_episode_number: maxNum,
      });
    }
  }
  return {
    series_id: seriesId,
    series_title: series.title,
    seasons: gaps,
    total_missing: gaps.reduce((sum, g) => sum + g.missing.length, 0),
  };
}

export function detectAllMissingEpisodes(): MissingEpisodesReport[] {
  const db = getDb();
  const all = db.prepare('SELECT id FROM series').all() as { id: string }[];
  const out: MissingEpisodesReport[] = [];
  for (const s of all) {
    const r = detectMissingEpisodes(s.id);
    if (r.total_missing > 0) out.push(r);
  }
  return out;
}
