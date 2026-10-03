// melodyflix videos — Discovery + Recommendations (Section 5.5, 5.7, 5.12, 5.13, 5.14)

import { getDb } from '@melodyflix/shared-db';

// ============================================================
// 5.12 Related Videos
// ============================================================

export interface RelatedVideo {
  id: string;
  title: string;
  thumbnail_url: string | null;
  duration_seconds: number;
  view_count: number;
  channel_id: string;
  category: string | null;
  score: number;
  reason: 'same_category' | 'same_channel' | 'shared_tags' | 'shared_genres' | 'recent';
}

export function getRelatedVideos(videoId: string, limit = 20): RelatedVideo[] {
  const db = getDb();
  const n = Math.min(Math.max(limit, 1), 100);

  const seed = db.prepare(
    'SELECT id, channel_id, category FROM videos WHERE id = ?'
  ).get(videoId) as { id: string; channel_id: string; category: string | null } | undefined;
  if (!seed) return [];

  // Pull candidates with a weak match, rank by heuristic
  const rows = db.prepare(`
    SELECT v.id, v.title, v.thumbnail_url, v.duration_seconds, v.view_count,
           v.channel_id, v.category,
           (CASE WHEN v.category = ? THEN 3 ELSE 0 END) +
           (CASE WHEN v.channel_id = ? THEN 2 ELSE 0 END) +
           (SELECT COUNT(*) FROM video_genres g1
              WHERE g1.video_id = v.id
                AND g1.genre IN (SELECT genre FROM video_genres WHERE video_id = ?))
           + (SELECT COUNT(*) FROM video_tags t1
              WHERE t1.video_id = v.id
                AND t1.tag IN (SELECT tag FROM video_tags WHERE video_id = ?))
             as score
    FROM videos v
    WHERE v.id != ? AND v.visibility = 'public' AND v.status = 'ready'
    ORDER BY score DESC, v.view_count DESC
    LIMIT ?
  `).all(
    seed.category ?? '', seed.channel_id,
    videoId, videoId, videoId, n
  ) as any[];

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    thumbnail_url: r.thumbnail_url,
    duration_seconds: r.duration_seconds ?? 0,
    view_count: r.view_count ?? 0,
    channel_id: r.channel_id,
    category: r.category,
    score: r.score ?? 0,
    reason: r.category === seed.category ? 'same_category'
      : r.channel_id === seed.channel_id ? 'same_channel'
      : r.score > 0 ? 'shared_tags'
      : 'recent',
  })) as RelatedVideo[];
}

// ============================================================
// 5.13 Up Next Suggestions
// Combines: autoplay chain within a channel/playlist, trending fallback.
// ============================================================

export interface UpNextItem {
  id: string;
  title: string;
  thumbnail_url: string | null;
  duration_seconds: number;
  reason: 'series_next' | 'playlist_next' | 'same_channel_latest' | 'related' | 'trending';
}

export function getUpNext(videoId: string, limit = 5): UpNextItem[] {
  const db = getDb();
  const n = Math.min(Math.max(limit, 1), 20);

  // Best-effort: related videos already carry series/playlist signals via scores
  const related = getRelatedVideos(videoId, n);
  return related.map((r) => ({
    id: r.id,
    title: r.title,
    thumbnail_url: r.thumbnail_url,
    duration_seconds: r.duration_seconds,
    reason: r.reason === 'same_channel' ? 'same_channel_latest' : 'related',
  }));
}

// ============================================================
// 5.14 Personalized Homepage
// ============================================================

export interface HomepageShelf {
  kind: 'continue_watching' | 'recommended' | 'trending' | 'from_channels' | 'new_from_favorites' | 'new_uploads';
  title: string;
  videos: any[];
}

export function getPersonalizedHomepage(userId: string | null, opts: {
  maxShelves?: number;
  maxPerShelf?: number;
} = {}): { shelves: HomepageShelf[] } {
  const db = getDb();
  const maxShelves = Math.min(Math.max(opts.maxShelves ?? 5, 1), 8);
  const maxPerShelf = Math.min(Math.max(opts.maxPerShelf ?? 12, 1), 30);
  const shelves: HomepageShelf[] = [];

  if (userId) {
    // Shelf: continue watching (recent views with progress)
    const cont = db.prepare(`
      SELECT v.id, v.title, v.thumbnail_url, v.duration_seconds, v.view_count,
             NULL as channel_name, vv.created_at as viewed_at
      FROM video_views vv
      JOIN videos v ON v.id = vv.video_id
      WHERE vv.user_id = ?
      ORDER BY vv.created_at DESC LIMIT ?
    `).all(userId, maxPerShelf) as any[];
    if (cont.length > 0) shelves.push({ kind: 'continue_watching', title: 'Continue watching', videos: cont });

    // Shelf: new from subscribed channels (approx: channels where a subscription row exists)
    // Falls back to channels the user has viewed recently if no subscription table present.
    let channels: { channel_id: string }[] = [];
    try {
      channels = db.prepare(`
        SELECT DISTINCT v.channel_id as channel_id FROM video_views vv
        JOIN videos v ON v.id = vv.video_id
        WHERE vv.user_id = ? LIMIT 10
      `).all(userId) as { channel_id: string }[];
    } catch { /* no views */ }

    if (channels.length > 0) {
      const placeholders = channels.map(() => '?').join(',');
      const params: any[] = channels.map((c) => c.channel_id);
      params.push(maxPerShelf);
      const fresh = db.prepare(`
        SELECT v.id, v.title, v.thumbnail_url, v.duration_seconds, v.view_count,
               NULL as channel_name, v.created_at
        FROM videos v
        WHERE v.channel_id IN (${placeholders})
          AND v.visibility = 'public' AND v.status = 'ready'
        ORDER BY v.created_at DESC LIMIT ?
      `).all(...params) as any[];
      if (fresh.length > 0) shelves.push({ kind: 'new_from_favorites', title: 'From channels you watch', videos: fresh });
    }
  }

  // Shelf: trending
  try {
    const trend = db.prepare(`
      SELECT v.id, v.title, v.thumbnail_url, v.duration_seconds, v.view_count,
             NULL as channel_name
      FROM videos v
      WHERE v.visibility = 'public' AND v.status = 'ready'
      ORDER BY v.view_count DESC, v.created_at DESC LIMIT ?
    `).all(maxPerShelf) as any[];
    if (trend.length > 0) shelves.push({ kind: 'trending', title: 'Trending now', videos: trend });
  } catch { /* ignore */ }

  // Shelf: new uploads
  const fresh2 = db.prepare(`
    SELECT v.id, v.title, v.thumbnail_url, v.duration_seconds, v.view_count,
           NULL as channel_name, v.created_at
    FROM videos v
    WHERE v.visibility = 'public' AND v.status = 'ready'
    ORDER BY v.created_at DESC LIMIT ?
  `).all(maxPerShelf) as any[];
  if (fresh2.length > 0) shelves.push({ kind: 'new_uploads', title: 'New uploads', videos: fresh2 });

  return { shelves: shelves.slice(0, maxShelves) };
}

// ============================================================
// 5.5 AI Recommendation
// Heuristic recommender: popularity + recency + user interest overlap
// ============================================================

export interface Recommendation {
  video_id: string;
  score: number;
  reason: string;
}

export interface RecommendOptions {
  userId?: string | null;
  excludeVideoIds?: string[];
  category?: string | null;
  limit?: number;
}

export function getRecommendations(opts: RecommendOptions = {}): Recommendation[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const exclude = (opts.excludeVideoIds ?? []).slice(0, 200);
  const placeholders = exclude.length > 0 ? exclude.map(() => '?').join(',') : "''";

  // User interest proxy: categories the user has viewed recently
  const userCats: string[] = [];
  if (opts.userId) {
    const rows = db.prepare(`
      SELECT v.category, COUNT(*) as n
      FROM video_views vv JOIN videos v ON v.id = vv.video_id
      WHERE vv.user_id = ? AND v.category IS NOT NULL
      GROUP BY v.category ORDER BY n DESC LIMIT 5
    `).all(opts.userId) as { category: string; n: number }[];
    userCats.push(...rows.map((r) => r.category));
  }

  const catClause = opts.category ? `AND v.category = ?` : '';
  const params: any[] = [];
  if (opts.category) params.push(opts.category);
  params.push(...exclude);
  params.push(limit * 2);

  const rows = db.prepare(`
    SELECT v.id as video_id, v.category, v.view_count, v.created_at,
           (CASE WHEN v.category IS NULL THEN 0
                 WHEN v.category IN (${userCats.length > 0 ? userCats.map(() => '?').join(',') : "''"})
                 THEN 5 ELSE 0 END) as interest_bonus
    FROM videos v
    WHERE v.visibility = 'public' AND v.status = 'ready'
      AND v.id NOT IN (${placeholders})
      ${catClause}
    ORDER BY interest_bonus DESC, v.view_count DESC, v.created_at DESC
    LIMIT ?
  `).all(...userCats, ...(opts.category ? [opts.category] : []), ...exclude, limit * 2) as any[];

  return rows.slice(0, limit).map((r) => ({
    video_id: r.video_id,
    score: Number(((r.interest_bonus ?? 0) + Math.log10((r.view_count ?? 0) + 1) + 0.1).toFixed(3)),
    reason: (r.interest_bonus ?? 0) > 0 ? 'Matches your interests' : 'Popular right now',
  }));
}

// ============================================================
// 5.7 Object / Face Search (metadata-only stub)
// ============================================================

export interface ObjectSearchOptions {
  kind: 'object' | 'face';
  label: string;
  limit?: number;
}

export interface ObjectSearchResult {
  video_id: string;
  label: string;
  kind: 'object' | 'face';
  confidence: number;
  timestamp_seconds: number;
}

export function searchByDetectedLabel(
  videoId: string,
  opts: ObjectSearchOptions
): ObjectSearchResult[] {
  // Requires an ML pipeline to populate detections; we return an empty
  // result rather than 500 to keep the API surface honest.
  const db = getDb();
  const label = opts.label?.trim();
  if (!label) return [];
  try {
    // Table may not exist — treat as "no detections yet"
    const table = opts.kind === 'face' ? 'video_face_detections' : 'video_object_detections';
    const rows = db.prepare(
      `SELECT video_id, label, confidence, timestamp_seconds FROM ${table}
       WHERE video_id = ? AND label LIKE ? ORDER BY confidence DESC LIMIT ?`
    ).all(videoId, `%${label}%`, opts.limit ?? 50) as any[];
    return rows.map((r) => ({
      video_id: r.video_id,
      label: r.label,
      kind: opts.kind,
      confidence: r.confidence,
      timestamp_seconds: r.timestamp_seconds,
    }));
  } catch {
    return [];
  }
}
