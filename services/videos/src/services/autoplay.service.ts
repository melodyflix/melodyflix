// melodyflix videos — autoplay chain service
// Uses preferences (autoplay_next, autoplay_playlist) to select what plays next.
import { getDb } from '@melodyflix/shared-db';
import { getPreferences } from './preferences.service.js';
import { getEpisodeByVideo, listAllEpisodesForSeries, getSeriesById } from './series.service.js';
import { listPlaylistsContainingVideo, listPlaylistItems } from './comment.service.js';

export type AutoplayReason =
  | 'series_next'
  | 'playlist_next'
  | 'same_channel_latest'
  | 'trending_fallback';

export interface AutoplayNext {
  video_id: string;
  title: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  reason: AutoplayReason;
  source_id: string | null; // series_id | playlist_id | channel_id
  source_name: string | null;
}

interface VideoRow {
  id: string;
  title: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  channel_id: string | null;
}

function getVideo(videoId: string): VideoRow | null {
  return (getDb().prepare(
    'SELECT id, title, thumbnail_url, duration_seconds, channel_id FROM videos WHERE id = ?'
  ).get(videoId) as VideoRow | undefined) ?? null;
}

function getLatestChannelVideo(channelId: string, excludeVideoId: string): VideoRow | null {
  return (getDb().prepare(`
    SELECT id, title, thumbnail_url, duration_seconds, channel_id
    FROM videos
    WHERE channel_id = ? AND id != ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(channelId, excludeVideoId) as VideoRow | undefined) ?? null;
}

function getTrendingVideo(excludeVideoId: string): VideoRow | null {
  return (getDb().prepare(`
    SELECT id, title, thumbnail_url, duration_seconds, channel_id
    FROM videos
    WHERE id != ?
    ORDER BY view_count DESC, created_at DESC
    LIMIT 1
  `).get(excludeVideoId) as VideoRow | undefined) ?? null;
}

function toAutoplay(
  v: VideoRow,
  reason: AutoplayReason,
  sourceId: string | null,
  sourceName: string | null,
): AutoplayNext {
  return {
    video_id: v.id,
    title: v.title,
    thumbnail_url: v.thumbnail_url,
    duration_seconds: v.duration_seconds,
    reason,
    source_id: sourceId,
    source_name: sourceName,
  };
}

/**
 * Determines the next video to autoplay after `videoId` for `userId`.
 * Returns null when user has disabled both autoplay toggles.
 */
export function getAutoplayNext(videoId: string, userId: string | null): AutoplayNext | null {
  const current = getVideo(videoId);
  if (!current) throw new Error('Video not found');

  // Anonymous or logged-in: default ON if no prefs found
  let allowNext = true;
  let allowPlaylist = true;
  if (userId) {
    try {
      const prefs = getPreferences(userId);
      allowNext = prefs.autoplay_next === 1;
      allowPlaylist = prefs.autoplay_playlist === 1;
    } catch {
      // User has no prefs row yet — defaults apply
    }
  }

  // 1) Series chain (higher priority than playlist)
  if (allowNext) {
    const ep = getEpisodeByVideo(videoId);
    if (ep) {
      const series = getSeriesById(ep.series_id);
      const all = listAllEpisodesForSeries(ep.series_id);
      const currentIdx = all.findIndex((e) => e.id === ep.id);
      const next = currentIdx >= 0 ? all[currentIdx + 1] : undefined;
      if (next) {
        const v = getVideo(next.video_id);
        if (v) return toAutoplay(v, 'series_next', ep.series_id, series?.title ?? null);
      }
    }
  }

  // 2) Playlist chain (only if user enabled playlist autoplay)
  if (allowPlaylist && userId) {
    const pls = listPlaylistsContainingVideo(userId, videoId);
    for (const pl of pls) {
      const items = listPlaylistItems(pl.id);
      const idx = items.findIndex((it: any) => it.id === videoId);
      const next = idx >= 0 ? items[idx + 1] : undefined;
      if (next) {
        const v: VideoRow = {
          id: next.id,
          title: next.title,
          thumbnail_url: next.thumbnail_url ?? null,
          duration_seconds: next.duration_seconds ?? null,
          channel_id: next.channel_id ?? null,
        };
        return toAutoplay(v, 'playlist_next', pl.id, pl.name);
      }
    }
  }

  // 3) Same channel latest (if autoplay_next on)
  if (allowNext && current.channel_id) {
    const latest = getLatestChannelVideo(current.channel_id, videoId);
    if (latest) return toAutoplay(latest, 'same_channel_latest', current.channel_id, null);
  }

  // 4) Trending fallback (only if autoplay_next on)
  if (allowNext) {
    const t = getTrendingVideo(videoId);
    if (t) return toAutoplay(t, 'trending_fallback', null, null);
  }

  return null;
}
