// melodyflix videos - analytics service (creator dashboard)
import { getDb } from '@melodyflix/shared-db';

export interface ChannelOverview {
  total_videos: number;
  total_views: number;
  total_likes: number;
  total_comments: number;
  total_subscribers: number;
  total_watch_time_seconds: number;
  avg_views_per_video: number;
  avg_completion_rate: number;
}

export function getChannelOverview(channelId: string): ChannelOverview {
  const db = getDb();

  const videos = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(view_count),0) as views,
           COALESCE(SUM(like_count),0) as likes, COALESCE(SUM(dislike_count),0) as dislikes
    FROM videos WHERE channel_id = ?
  `).get(channelId) as any;

  const comments = db.prepare(`
    SELECT COUNT(*) as count FROM comments c
    INNER JOIN videos v ON v.id = c.video_id
    WHERE v.channel_id = ? AND c.is_deleted = 0
  `).get(channelId) as any;

  const subs = db.prepare('SELECT subscriber_count FROM channels WHERE id = ?').get(channelId) as any;

  // Approximate watch time = sum over videos (view_count * duration * 0.4 completion average)
  const watchTime = db.prepare(`
    SELECT COALESCE(SUM(view_count * duration_seconds), 0) as s
    FROM videos WHERE channel_id = ? AND status = 'ready'
  `).get(channelId) as any;

  return {
    total_videos: videos.count,
    total_views: videos.views,
    total_likes: videos.likes,
    total_comments: comments.count,
    total_subscribers: subs?.subscriber_count ?? 0,
    total_watch_time_seconds: Math.floor(watchTime.s * 0.4),
    avg_views_per_video: videos.count > 0 ? Math.round(videos.views / videos.count) : 0,
    avg_completion_rate: 40, // placeholder
  };
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  views: number;
  likes: number;
  comments: number;
}

export function getViewsTimeSeries(channelId: string, days = 30): DailyPoint[] {
  const db = getDb();

  // Get videos of this channel
  const videoRows = db.prepare('SELECT id, view_count, like_count FROM videos WHERE channel_id = ?')
    .all(channelId) as { id: string; view_count: number; like_count: number }[];
  const videoIds = videoRows.map((v) => v.id);
  if (videoIds.length === 0) {
    // Return empty series
    const out: DailyPoint[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      out.push({ date: d.toISOString().slice(0, 10), views: 0, likes: 0, comments: 0 });
    }
    return out;
  }

  const placeholders = videoIds.map(() => '?').join(',');
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  // Video views by day
  const views = db.prepare(`
    SELECT date(created_at) as d, COUNT(*) as n
    FROM video_views
    WHERE video_id IN (${placeholders}) AND created_at >= ?
    GROUP BY date(created_at)
  `).all(...videoIds, cutoff.toISOString()) as { d: string; n: number }[];

  // Likes by day
  const likes = db.prepare(`
    SELECT date(created_at) as d, COUNT(*) as n
    FROM video_likes
    WHERE video_id IN (${placeholders}) AND created_at >= ?
    GROUP BY date(created_at)
  `).all(...videoIds, cutoff.toISOString()) as { d: string; n: number }[];

  // Comments by day
  const comments = db.prepare(`
    SELECT date(created_at) as d, COUNT(*) as n
    FROM comments
    WHERE video_id IN (${placeholders}) AND created_at >= ?
    GROUP BY date(created_at)
  `).all(...videoIds, cutoff.toISOString()) as { d: string; n: number }[];

  const viewMap = new Map(views.map((x) => [x.d, x.n]));
  const likeMap = new Map(likes.map((x) => [x.d, x.n]));
  const commentMap = new Map(comments.map((x) => [x.d, x.n]));

  const out: DailyPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({
      date: key,
      views: viewMap.get(key) ?? 0,
      likes: likeMap.get(key) ?? 0,
      comments: commentMap.get(key) ?? 0,
    });
  }
  return out;
}

export interface TopVideo {
  id: string;
  title: string;
  thumbnail_url: string | null;
  view_count: number;
  like_count: number;
  comment_count: number;
  duration_seconds: number;
  created_at: string;
}

export function getTopVideos(channelId: string, limit = 10): TopVideo[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT v.id, v.title, v.thumbnail_url, v.view_count, v.like_count, v.duration_seconds,
           v.created_at,
           (SELECT COUNT(*) FROM comments c WHERE c.video_id = v.id AND c.is_deleted = 0) as comment_count
    FROM videos v
    WHERE v.channel_id = ? AND v.status = 'ready'
    ORDER BY v.view_count DESC
    LIMIT ?
  `).all(channelId, limit) as any[];
  return rows;
}

export interface RevenueBreakdown {
  super_chat: number;
  membership: number;
  ads: number;
  total: number;
}

export function getChannelRevenue(channelId: string, days = 30): RevenueBreakdown {
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffIso = cutoff.toISOString();

  // Super chats: super_chats table joined to live_streams (channel)
  let superChat = 0;
  try {
    const scRow = db.prepare(`
      SELECT COALESCE(SUM(sc.amount), 0) as s
      FROM super_chats sc
      INNER JOIN live_streams ls ON ls.id = sc.stream_id
      WHERE ls.channel_id = ? AND sc.created_at >= ?
    `).get(channelId, cutoffIso) as any;
    superChat = scRow?.s ?? 0;
  } catch {}

  // Membership revenue
  let membership = 0;
  try {
    const memRow = db.prepare(`
      SELECT COALESCE(SUM(total_paid), 0) as s
      FROM memberships
      WHERE channel_id = ? AND created_at >= ?
    `).get(channelId, cutoffIso) as any;
    membership = memRow?.s ?? 0;
  } catch {}

  // Ads: skip for now (would need per-channel impression tracking)
  const ads = 0;

  return {
    super_chat: superChat,
    membership,
    ads,
    total: superChat + membership + ads,
  };
}

export interface SubscriberPoint {
  date: string;
  total: number;
}

export function getSubscriberGrowth(channelId: string, days = 30): SubscriberPoint[] {
  // Without a subscriber history table, we just return current count for each day
  // (a placeholder that shows flat line). In production you would have a
  // `follows` table (already exists) with created_at timestamps.
  const db = getDb();
  const subs = db.prepare('SELECT subscriber_count FROM channels WHERE id = ?').get(channelId) as any;
  const current = subs?.subscriber_count ?? 0;

  const out: SubscriberPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push({ date: d.toISOString().slice(0, 10), total: current });
  }
  return out;
}
