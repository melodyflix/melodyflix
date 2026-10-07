// melodyflix videos - creator studio (9.1 - 9.11)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

// ============ Schema ============

export function ensureCreatorStudioSchema(): void {
  const db = getDb();
  db.exec(`
    -- 9.9 Subscriber Milestones
    CREATE TABLE IF NOT EXISTS channel_milestones (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      milestone_type TEXT NOT NULL,   -- subscribers | views | videos | revenue
      threshold INTEGER NOT NULL,
      achieved_at TEXT,
      notified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE (channel_id, milestone_type, threshold)
    );
    CREATE INDEX IF NOT EXISTS idx_milestones_channel ON channel_milestones(channel_id, milestone_type, threshold);

    -- 9.4 A/B Testing
    CREATE TABLE IF NOT EXISTS ab_tests (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      test_type TEXT NOT NULL,        -- thumbnail | title
      status TEXT NOT NULL DEFAULT 'running',  -- running | completed | cancelled
      winner_variant_id TEXT,
      starts_at TEXT NOT NULL,
      ends_at TEXT,
      min_impressions INTEGER NOT NULL DEFAULT 1000,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ab_tests_video ON ab_tests(video_id, status);

    CREATE TABLE IF NOT EXISTS ab_test_variants (
      id TEXT PRIMARY KEY,
      test_id TEXT NOT NULL,
      label TEXT NOT NULL,
      content TEXT NOT NULL,          -- URL for thumbnail, text for title
      impressions INTEGER NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      watch_seconds INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ab_variants_test ON ab_test_variants(test_id);

    CREATE TABLE IF NOT EXISTS publish_time_tests (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running','completed','cancelled')),
      winner_slot_id TEXT,
      created_by TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ptt_video ON publish_time_tests(video_id, status);
    CREATE INDEX IF NOT EXISTS idx_ptt_channel ON publish_time_tests(channel_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS publish_time_slots (
      id TEXT PRIMARY KEY,
      test_id TEXT NOT NULL,
      label TEXT NOT NULL,
      planned_at TEXT NOT NULL,
      published_at TEXT,
      views_1h INTEGER NOT NULL DEFAULT 0,
      views_24h INTEGER NOT NULL DEFAULT 0,
      likes INTEGER NOT NULL DEFAULT 0,
      comments INTEGER NOT NULL DEFAULT 0,
      score REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (test_id, planned_at)
    );
    CREATE INDEX IF NOT EXISTS idx_pts_test ON publish_time_slots(test_id);

    -- 9.7 End Screen / Cards
    CREATE TABLE IF NOT EXISTS video_end_screens (
      video_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      elements TEXT NOT NULL DEFAULT '[]',   -- JSON array of elements
      start_seconds REAL NOT NULL DEFAULT 0, -- when to show (usually end-20s)
      duration_seconds REAL NOT NULL DEFAULT 20,
      updated_at TEXT NOT NULL
    );

    -- 9.11 Competitor Analysis
    CREATE TABLE IF NOT EXISTS competitor_tracking (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      competitor_channel_id TEXT NOT NULL,
      competitor_name TEXT,
      subscriber_snapshot INTEGER NOT NULL DEFAULT 0,
      video_count_snapshot INTEGER NOT NULL DEFAULT 0,
      last_snapshot_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (channel_id, competitor_channel_id)
    );
  `);
}

// ============ 9.9 — Subscriber Milestones ============

export const DEFAULT_MILESTONE_THRESHOLDS = [
  { type: 'subscribers', value: 10 },
  { type: 'subscribers', value: 100 },
  { type: 'subscribers', value: 1000 },
  { type: 'subscribers', value: 10000 },
  { type: 'subscribers', value: 100000 },
  { type: 'subscribers', value: 1000000 },
  { type: 'views', value: 1000 },
  { type: 'views', value: 10000 },
  { type: 'views', value: 100000 },
  { type: 'views', value: 1000000 },
  { type: 'videos', value: 10 },
  { type: 'videos', value: 50 },
  { type: 'videos', value: 100 },
];

export interface ChannelMilestone {
  id: string;
  channel_id: string;
  milestone_type: string;
  threshold: number;
  achieved_at: string | null;
  notified: number;
  created_at: string;
}

export function listMilestones(channelId: string): ChannelMilestone[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM channel_milestones WHERE channel_id = ? ORDER BY milestone_type, threshold'
  ).all(channelId) as ChannelMilestone[];
}

// Get current counts and ensure all milestones exist
export interface MilestoneCheckResult {
  achieved: ChannelMilestone[];
  all: ChannelMilestone[];
  current: {
    subscribers: number;
    views: number;
    videos: number;
  };
}

function getCurrentCounts(channelId: string): { subscribers: number; views: number; videos: number } {
  const db = getDb();
  let subscribers = 0, views = 0, videos = 0;
  try {
    const c = db.prepare('SELECT subscriber_count FROM channels WHERE id = ?').get(channelId) as { subscriber_count: number } | undefined;
    subscribers = c?.subscriber_count ?? 0;
  } catch {}
  try {
    const v = db.prepare('SELECT COUNT(*) as n, COALESCE(SUM(view_count), 0) as v FROM videos WHERE channel_id = ?').get(channelId) as any;
    videos = v?.n ?? 0;
    views = v?.v ?? 0;
  } catch {}
  return { subscribers, views, videos };
}

export function checkMilestones(channelId: string): MilestoneCheckResult {
  const db = getDb();
  const current = getCurrentCounts(channelId);

  // Ensure all default milestones exist
  const now = new Date().toISOString();
  const ins = db.prepare(
    'INSERT OR IGNORE INTO channel_milestones (id, channel_id, milestone_type, threshold, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  for (const m of DEFAULT_MILESTONE_THRESHOLDS) {
    ins.run(randomUUID(), channelId, m.type, m.value, now);
  }

  // Mark achieved
  const all = listMilestones(channelId);
  const achieved: ChannelMilestone[] = [];
  for (const m of all) {
    if (m.achieved_at) continue;
    let currVal = 0;
    if (m.milestone_type === 'subscribers') currVal = current.subscribers;
    else if (m.milestone_type === 'views') currVal = current.views;
    else if (m.milestone_type === 'videos') currVal = current.videos;

    if (currVal >= m.threshold) {
      db.prepare('UPDATE channel_milestones SET achieved_at = ? WHERE id = ?').run(now, m.id);
      achieved.push({ ...m, achieved_at: now });
    }
  }

  return {
    achieved,
    all: listMilestones(channelId),
    current,
  };
}

export function markMilestoneNotified(milestoneId: string): void {
  const db = getDb();
  db.prepare('UPDATE channel_milestones SET notified = 1 WHERE id = ?').run(milestoneId);
}

// ============ 9.10 — Growth Tips and Insights ============

export interface GrowthInsight {
  id: string;
  category: 'warning' | 'opportunity' | 'success' | 'tip';
  title: string;
  description: string;
  action_label: string | null;
  action_url: string | null;
  priority: number;  // 1 (highest) .. 5 (lowest)
}

// Rule-based insight engine — analyzes channel data and returns personalized tips
export function generateGrowthInsights(channelId: string): GrowthInsight[] {
  const db = getDb();
  const insights: GrowthInsight[] = [];
  const now = Date.now();
  const since30 = new Date(now - 30 * 86400_000).toISOString();
  const since7 = new Date(now - 7 * 86400_000).toISOString();

  // Video upload frequency
  let recentUploads = 0, olderUploads = 0, totalVideos = 0;
  try {
    recentUploads = (db.prepare('SELECT COUNT(*) as n FROM videos WHERE channel_id = ? AND created_at >= ?').get(channelId, since30) as { n: number }).n;
    olderUploads = (db.prepare('SELECT COUNT(*) as n FROM videos WHERE channel_id = ? AND created_at >= ? AND created_at < ?').get(channelId, new Date(now - 60 * 86400_000).toISOString(), since30) as { n: number }).n;
    totalVideos = (db.prepare('SELECT COUNT(*) as n FROM videos WHERE channel_id = ?').get(channelId) as { n: number }).n;
  } catch {}

  if (totalVideos === 0) {
    insights.push({
      id: 'no-videos',
      category: 'warning',
      title: 'Upload your first video',
      description: 'You haven\'t uploaded any videos yet. Regular uploads are the #1 growth driver.',
      action_label: 'Upload video',
      action_url: '/upload',
      priority: 1,
    });
  } else if (recentUploads === 0) {
    insights.push({
      id: 'no-recent-uploads',
      category: 'warning',
      title: 'You haven\'t uploaded in 30 days',
      description: `Your last upload was over a month ago. Creators who upload weekly grow 3× faster.`,
      action_label: 'Upload now',
      action_url: '/upload',
      priority: 1,
    });
  } else if (recentUploads < olderUploads * 0.5 && olderUploads > 0) {
    insights.push({
      id: 'upload-declining',
      category: 'warning',
      title: 'Your upload frequency is declining',
      description: `You uploaded ${olderUploads} videos in the previous 30 days, but only ${recentUploads} in the last 30. Consistency matters.`,
      action_label: 'Plan content',
      action_url: '/upload',
      priority: 2,
    });
  } else if (recentUploads >= 4) {
    insights.push({
      id: 'upload-streak',
      category: 'success',
      title: 'Great upload consistency! 🎉',
      description: `${recentUploads} uploads in the last 30 days. Keep the momentum!`,
      action_label: null,
      action_url: null,
      priority: 5,
    });
  }

  // Title length check
  let longTitles = 0;
  try {
    longTitles = (db.prepare('SELECT COUNT(*) as n FROM videos WHERE channel_id = ? AND LENGTH(title) > 70').get(channelId) as { n: number }).n;
  } catch {}
  if (longTitles > 0) {
    insights.push({
      id: 'long-titles',
      category: 'tip',
      title: `${longTitles} video${longTitles > 1 ? 's have' : ' has'} very long titles`,
      description: 'Titles over 70 characters get truncated on mobile. Keep them punchy and specific.',
      action_label: 'Review videos',
      action_url: '/my-videos',
      priority: 3,
    });
  }

  // No descriptions
  let emptyDescriptions = 0;
  try {
    emptyDescriptions = (db.prepare("SELECT COUNT(*) as n FROM videos WHERE channel_id = ? AND (description IS NULL OR LENGTH(TRIM(description)) < 20)").get(channelId) as { n: number }).n;
  } catch {}
  if (emptyDescriptions > 0 && totalVideos > 0) {
    const pct = Math.round((emptyDescriptions / totalVideos) * 100);
    insights.push({
      id: 'short-descriptions',
      category: 'tip',
      title: `${pct}% of your videos have short/no descriptions`,
      description: 'Descriptions help with search discovery. Add at least 150 words + relevant tags.',
      action_label: 'Edit videos',
      action_url: '/my-videos',
      priority: 3,
    });
  }

  // Missing thumbnails
  let missingThumbs = 0;
  try {
    missingThumbs = (db.prepare("SELECT COUNT(*) as n FROM videos WHERE channel_id = ? AND (thumbnail_url IS NULL OR thumbnail_url = '')").get(channelId) as { n: number }).n;
  } catch {}
  if (missingThumbs > 0) {
    insights.push({
      id: 'missing-thumbnails',
      category: 'warning',
      title: `${missingThumbs} video${missingThumbs > 1 ? 's have' : ' has'} no custom thumbnail`,
      description: 'Custom thumbnails increase CTR by up to 30%. Add them to stand out.',
      action_label: 'Add thumbnails',
      action_url: '/my-videos',
      priority: 2,
    });
  }

  // Subscriber growth check
  let subscribers = 0;
  try {
    subscribers = (db.prepare('SELECT subscriber_count FROM channels WHERE id = ?').get(channelId) as { subscriber_count: number } | undefined)?.subscriber_count ?? 0;
  } catch {}
  if (subscribers > 0 && subscribers < 100) {
    insights.push({
      id: 'early-stage',
      category: 'tip',
      title: 'You\'re in the early growth phase',
      description: 'Focus on niche content, engage with every comment, and consider posting 2-3 times per week.',
      action_label: null,
      action_url: null,
      priority: 4,
    });
  } else if (subscribers >= 1000) {
    insights.push({
      id: 'monetization-eligible',
      category: 'opportunity',
      title: 'You may be eligible for monetization',
      description: 'Your channel has 1000+ subscribers. Check the monetization requirements in Settings.',
      action_label: 'View monetization',
      action_url: '/channel/me',
      priority: 2,
    });
  }

  // Best time to upload hint
  let hasRecentActivity = false;
  try {
    hasRecentActivity = ((db.prepare('SELECT COUNT(*) as n FROM analytics_events WHERE channel_id = ? AND created_at >= ?').get(channelId, since7) as { n: number }).n) > 0;
  } catch {}
  if (!hasRecentActivity && totalVideos > 0) {
    insights.push({
      id: 'no-analytics',
      category: 'tip',
      title: 'No recent viewer activity',
      description: 'Consider promoting your content on social media or collaborating with other creators.',
      action_label: null,
      action_url: null,
      priority: 4,
    });
  }

  // Sort by priority
  return insights.sort((a, b) => a.priority - b.priority);
}

// ============ 9.1 — Creator Studio Dashboard Summary ============

export interface StudioSummary {
  channel_id: string;
  subscriber_count: number;
  total_views: number;
  total_videos: number;
  total_watch_time_seconds: number;
  avg_views_per_video: number;
  latest_video: { id: string; title: string; created_at: string; view_count: number } | null;
  top_video: { id: string; title: string; view_count: number } | null;
  next_milestone: { type: string; threshold: number; current: number; remaining: number } | null;
  total_insights: number;
  unacknowledged_milestones: number;
}

export function getStudioSummary(channelId: string): StudioSummary {
  const db = getDb();
  let subscribers = 0, totalVideos = 0, totalViews = 0;
  try {
    const c = db.prepare('SELECT subscriber_count FROM channels WHERE id = ?').get(channelId) as { subscriber_count: number } | undefined;
    subscribers = c?.subscriber_count ?? 0;
  } catch {}
  try {
    const v = db.prepare('SELECT COUNT(*) as n, COALESCE(SUM(view_count), 0) as v FROM videos WHERE channel_id = ?').get(channelId) as any;
    totalVideos = v?.n ?? 0;
    totalViews = v?.v ?? 0;
  } catch {}

  let latest: any = null, top: any = null;
  try {
    latest = db.prepare('SELECT id, title, created_at, view_count FROM videos WHERE channel_id = ? ORDER BY created_at DESC LIMIT 1').get(channelId) ?? null;
    top = db.prepare('SELECT id, title, view_count FROM videos WHERE channel_id = ? ORDER BY view_count DESC LIMIT 1').get(channelId) ?? null;
  } catch {}

  // Next milestone
  const checkResult = checkMilestones(channelId);
  const thresholds: Record<string, number> = {
    subscribers: checkResult.current.subscribers,
    views: checkResult.current.views,
    videos: checkResult.current.videos,
  };
  let nextMilestone: StudioSummary['next_milestone'] = null;
  for (const m of checkResult.all) {
    if (m.achieved_at) continue;
    const curr = thresholds[m.milestone_type] ?? 0;
    if (!nextMilestone || m.threshold < nextMilestone.threshold) {
      nextMilestone = { type: m.milestone_type, threshold: m.threshold, current: curr, remaining: Math.max(0, m.threshold - curr) };
    }
  }

  const insights = generateGrowthInsights(channelId);
  const unackMilestones = checkResult.all.filter((m) => m.achieved_at && !m.notified).length;

  return {
    channel_id: channelId,
    subscriber_count: subscribers,
    total_views: totalViews,
    total_videos: totalVideos,
    total_watch_time_seconds: 0, // can be filled from analytics
    avg_views_per_video: totalVideos > 0 ? totalViews / totalVideos : 0,
    latest_video: latest,
    top_video: top,
    next_milestone: nextMilestone,
    total_insights: insights.length,
    unacknowledged_milestones: unackMilestones,
  };
}

// ============ 9.7 — End Screen / Cards ============

export type EndScreenElementType = 'video' | 'playlist' | 'channel' | 'subscribe' | 'link';

export interface EndScreenElement {
  id: string;
  type: EndScreenElementType;
  x: number;             // 0..1 (relative position)
  y: number;             // 0..1
  width: number;         // 0..1
  height: number;        // 0..1
  label: string;         // e.g. "Watch next"
  target_id: string | null;  // video id / playlist id / URL
  thumbnail_url: string | null;
}

export interface VideoEndScreen {
  video_id: string;
  channel_id: string;
  elements: EndScreenElement[];
  start_seconds: number;
  duration_seconds: number;
  updated_at: string;
}

export const END_SCREEN_TEMPLATES: { id: string; label: string; elements: Omit<EndScreenElement, 'id'>[] }[] = [
  {
    id: 'basic-subscribe',
    label: 'Basic — Subscribe only',
    elements: [
      { type: 'subscribe', x: 0.4, y: 0.4, width: 0.2, height: 0.2, label: 'Subscribe', target_id: null, thumbnail_url: null },
    ],
  },
  {
    id: 'watch-next',
    label: 'Watch next — 1 video',
    elements: [
      { type: 'video', x: 0.15, y: 0.3, width: 0.3, height: 0.4, label: 'Watch next', target_id: null, thumbnail_url: null },
    ],
  },
  {
    id: 'video-plus-sub',
    label: 'Video + Subscribe',
    elements: [
      { type: 'video', x: 0.1, y: 0.3, width: 0.3, height: 0.4, label: 'Watch next', target_id: null, thumbnail_url: null },
      { type: 'subscribe', x: 0.6, y: 0.4, width: 0.2, height: 0.2, label: 'Subscribe', target_id: null, thumbnail_url: null },
    ],
  },
  {
    id: 'four-up',
    label: '4-up grid (2 videos + subscribe + playlist)',
    elements: [
      { type: 'video', x: 0.05, y: 0.2, width: 0.22, height: 0.3, label: 'Video 1', target_id: null, thumbnail_url: null },
      { type: 'video', x: 0.30, y: 0.2, width: 0.22, height: 0.3, label: 'Video 2', target_id: null, thumbnail_url: null },
      { type: 'playlist', x: 0.05, y: 0.55, width: 0.22, height: 0.3, label: 'Playlist', target_id: null, thumbnail_url: null },
      { type: 'subscribe', x: 0.55, y: 0.5, width: 0.3, height: 0.3, label: 'Subscribe', target_id: null, thumbnail_url: null },
    ],
  },
];

export function getEndScreen(videoId: string): VideoEndScreen | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM video_end_screens WHERE video_id = ?').get(videoId) as any;
  if (!row) return null;
  return {
    ...row,
    elements: safeParseJson(row.elements, []),
  };
}

function safeParseJson<T>(s: any, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

export interface EndScreenInput {
  elements: Omit<EndScreenElement, 'id'>[];
  start_seconds?: number;
  duration_seconds?: number;
}

export function setEndScreen(videoId: string, channelId: string, input: EndScreenInput): VideoEndScreen {
  const db = getDb();
  const now = new Date().toISOString();

  const elements: EndScreenElement[] = (input.elements ?? []).slice(0, 4).map((el) => ({
    id: randomUUID(),
    type: el.type,
    x: Math.max(0, Math.min(1, el.x)),
    y: Math.max(0, Math.min(1, el.y)),
    width: Math.max(0.05, Math.min(1, el.width)),
    height: Math.max(0.05, Math.min(1, el.height)),
    label: String(el.label ?? '').slice(0, 60),
    target_id: el.target_id ?? null,
    thumbnail_url: el.thumbnail_url ?? null,
  }));

  const start = Math.max(0, input.start_seconds ?? 0);
  const dur = Math.max(5, Math.min(60, input.duration_seconds ?? 20));

  db.prepare(
    'INSERT INTO video_end_screens (video_id, channel_id, elements, start_seconds, duration_seconds, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(video_id) DO UPDATE SET elements = excluded.elements, start_seconds = excluded.start_seconds, duration_seconds = excluded.duration_seconds, updated_at = excluded.updated_at'
  ).run(videoId, channelId, JSON.stringify(elements), start, dur, now);

  return getEndScreen(videoId)!;
}

export function deleteEndScreen(videoId: string): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM video_end_screens WHERE video_id = ?').run(videoId);
  return res.changes > 0;
}

// ============ 9.11 — Competitor Analysis ============

export interface CompetitorSnapshot {
  id: string;
  channel_id: string;
  competitor_channel_id: string;
  competitor_name: string | null;
  subscriber_snapshot: number;
  video_count_snapshot: number;
  last_snapshot_at: string | null;
  created_at: string;
}

export interface CompetitorAnalysis {
  competitor_channel_id: string;
  competitor_name: string | null;
  subscriber_count: number;
  video_count: number;
  avg_views_per_video: number;
  total_views: number;
  upload_frequency_days: number | null;   // avg days between uploads
  recent_uploads: { id: string; title: string; view_count: number; created_at: string }[];
  // Comparison vs own channel
  vs_own: {
    subscriber_diff: number;
    video_count_diff: number;
    avg_views_diff: number;
  } | null;
}

export function listTrackedCompetitors(channelId: string): CompetitorSnapshot[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM competitor_tracking WHERE channel_id = ? ORDER BY created_at DESC'
  ).all(channelId) as CompetitorSnapshot[];
}

export function trackCompetitor(channelId: string, competitorChannelId: string): CompetitorSnapshot {
  if (channelId === competitorChannelId) throw new Error('Cannot track your own channel');
  const db = getDb();
  const now = new Date().toISOString();

  // Check competitor exists
  const target = db.prepare('SELECT id, name, subscriber_count FROM channels WHERE id = ?').get(competitorChannelId) as any;
  if (!target) throw new Error('Competitor channel not found');

  const videoCount = (db.prepare('SELECT COUNT(*) as n FROM videos WHERE channel_id = ?').get(competitorChannelId) as { n: number }).n;

  const existing = db.prepare('SELECT id FROM competitor_tracking WHERE channel_id = ? AND competitor_channel_id = ?').get(channelId, competitorChannelId) as { id: string } | undefined;
  if (existing) {
    db.prepare('UPDATE competitor_tracking SET subscriber_snapshot = ?, video_count_snapshot = ?, last_snapshot_at = ?, competitor_name = ? WHERE id = ?')
      .run(target.subscriber_count ?? 0, videoCount, now, target.name, existing.id);
    return db.prepare('SELECT * FROM competitor_tracking WHERE id = ?').get(existing.id) as CompetitorSnapshot;
  }

  const id = randomUUID();
  db.prepare(
    'INSERT INTO competitor_tracking (id, channel_id, competitor_channel_id, competitor_name, subscriber_snapshot, video_count_snapshot, last_snapshot_at, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, channelId, competitorChannelId, target.name, target.subscriber_count ?? 0, videoCount, now, now);
  return db.prepare('SELECT * FROM competitor_tracking WHERE id = ?').get(id) as CompetitorSnapshot;
}

export function untrackCompetitor(channelId: string, competitorChannelId: string): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM competitor_tracking WHERE channel_id = ? AND competitor_channel_id = ?').run(channelId, competitorChannelId);
  return res.changes > 0;
}

export function getCompetitorAnalysis(channelId: string, competitorChannelId: string): CompetitorAnalysis | null {
  const db = getDb();
  const target = db.prepare('SELECT id, name, subscriber_count FROM channels WHERE id = ?').get(competitorChannelId) as any;
  if (!target) return null;

  const videoCount = (db.prepare('SELECT COUNT(*) as n FROM videos WHERE channel_id = ?').get(competitorChannelId) as { n: number }).n;
  const totalViews = (db.prepare('SELECT COALESCE(SUM(view_count), 0) as v FROM videos WHERE channel_id = ?').get(competitorChannelId) as { v: number }).v;

  const recent = db.prepare(
    'SELECT id, title, view_count, created_at FROM videos WHERE channel_id = ? ORDER BY created_at DESC LIMIT 10'
  ).all(competitorChannelId) as { id: string; title: string; view_count: number; created_at: string }[];

  // Upload frequency
  let uploadFreq: number | null = null;
  if (recent.length >= 2) {
    const dates = recent.map((v) => new Date(v.created_at).getTime());
    const diffs: number[] = [];
    for (let i = 1; i < dates.length; i++) diffs.push((dates[i - 1] - dates[i]) / 86400_000);
    uploadFreq = diffs.length > 0 ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null;
  }

  // Own metrics
  const ownSubs = (db.prepare('SELECT subscriber_count FROM channels WHERE id = ?').get(channelId) as any)?.subscriber_count ?? 0;
  const ownVideos = (db.prepare('SELECT COUNT(*) as n FROM videos WHERE channel_id = ?').get(channelId) as { n: number }).n;
  const ownViews = (db.prepare('SELECT COALESCE(SUM(view_count), 0) as v FROM videos WHERE channel_id = ?').get(channelId) as { v: number }).v;
  const ownAvg = ownVideos > 0 ? ownViews / ownVideos : 0;

  const theirAvg = videoCount > 0 ? totalViews / videoCount : 0;

  return {
    competitor_channel_id: competitorChannelId,
    competitor_name: target.name ?? null,
    subscriber_count: target.subscriber_count ?? 0,
    video_count: videoCount,
    avg_views_per_video: theirAvg,
    total_views: totalViews,
    upload_frequency_days: uploadFreq,
    recent_uploads: recent,
    vs_own: {
      subscriber_diff: (target.subscriber_count ?? 0) - ownSubs,
      video_count_diff: videoCount - ownVideos,
      avg_views_diff: theirAvg - ownAvg,
    },
  };
}

// ============ 9.4 — A/B Testing ============

export type ABTestStatus = 'running' | 'completed' | 'cancelled';
export type ABTestType = 'thumbnail' | 'title' | 'description';

export interface ABTestVariant {
  id: string;
  test_id: string;
  label: string;
  content: string;
  impressions: number;
  clicks: number;
  watch_seconds: number;
  created_at: string;
}

export interface ABTest {
  id: string;
  channel_id: string;
  video_id: string;
  test_type: ABTestType;
  status: ABTestStatus;
  winner_variant_id: string | null;
  starts_at: string;
  ends_at: string | null;
  min_impressions: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  variants: ABTestVariant[];
}

export function getABTest(id: string): ABTest | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM ab_tests WHERE id = ?').get(id) as any;
  if (!row) return null;
  const variants = db.prepare('SELECT * FROM ab_test_variants WHERE test_id = ? ORDER BY created_at ASC').all(id) as ABTestVariant[];
  return { ...row, variants };
}

export function listABTestsForVideo(videoId: string): ABTest[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM ab_tests WHERE video_id = ? ORDER BY created_at DESC').all(videoId) as any[];
  return rows.map((r) => {
    const variants = db.prepare('SELECT * FROM ab_test_variants WHERE test_id = ? ORDER BY created_at ASC').all(r.id) as ABTestVariant[];
    return { ...r, variants };
  });
}

export function listABTestsForChannel(channelId: string, limit = 50): ABTest[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM ab_tests WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(channelId, Math.max(1, Math.min(200, limit))) as any[];
  return rows.map((r) => {
    const variants = db.prepare('SELECT * FROM ab_test_variants WHERE test_id = ? ORDER BY created_at ASC').all(r.id) as ABTestVariant[];
    return { ...r, variants };
  });
}

export interface CreateABTestInput {
  video_id: string;
  test_type: ABTestType;
  variants: { label: string; content: string }[];
  min_impressions?: number;
  ends_at?: string | null;
}

export function createABTest(channelId: string, input: CreateABTestInput, createdBy: string): ABTest {
  if (input.variants.length < 2 || input.variants.length > 4) {
    throw new Error('A/B test requires 2-4 variants');
  }
  const db = getDb();
  const now = new Date().toISOString();

  // Cancel any existing running test for same video+type
  const running = db.prepare("SELECT id FROM ab_tests WHERE video_id = ? AND test_type = ? AND status = 'running'").get(input.video_id, input.test_type) as { id: string } | undefined;
  if (running) {
    db.prepare("UPDATE ab_tests SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now, running.id);
  }

  const id = randomUUID();
  db.prepare(
    'INSERT INTO ab_tests (id, channel_id, video_id, test_type, status, starts_at, ends_at, min_impressions, created_by, created_at, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id, channelId, input.video_id, input.test_type, 'running',
    now, input.ends_at ?? null, Math.max(100, input.min_impressions ?? 1000),
    createdBy, now, now,
  );

  const insV = db.prepare('INSERT INTO ab_test_variants (id, test_id, label, content, created_at) VALUES (?, ?, ?, ?, ?)');
  for (const v of input.variants) {
    insV.run(randomUUID(), id, v.label.slice(0, 60), v.content.slice(0, 500), now);
  }

  return getABTest(id)!;
}

export function recordABImpression(variantId: string): void {
  const db = getDb();
  db.prepare('UPDATE ab_test_variants SET impressions = impressions + 1 WHERE id = ?').run(variantId);
}

export function recordABClick(variantId: string, watchSeconds = 0): void {
  const db = getDb();
  db.prepare('UPDATE ab_test_variants SET clicks = clicks + 1, watch_seconds = watch_seconds + ? WHERE id = ?')
    .run(Math.max(0, watchSeconds), variantId);
}

// Pick a variant for serving (weighted round-robin by fewest impressions)
export function pickABVariant(testId: string): ABTestVariant | null {
  const db = getDb();
  const variants = db.prepare('SELECT * FROM ab_test_variants WHERE test_id = ? ORDER BY impressions ASC').all(testId) as ABTestVariant[];
  return variants[0] ?? null;
}

// Compute score for each variant (CTR * avg_watch_factor)
export interface ABVariantScore {
  variant_id: string;
  label: string;
  impressions: number;
  clicks: number;
  ctr: number;
  avg_watch_seconds: number;
  score: number;   // ctr * (1 + log(1+avg_watch) / 10)
  is_significant: boolean;
}

export function getABTestScores(testId: string): { test: ABTest | null; scores: ABVariantScore[]; winner: ABVariantScore | null; is_ready: boolean } {
  const test = getABTest(testId);
  if (!test) return { test: null, scores: [], winner: null, is_ready: false };

  const scores: ABVariantScore[] = test.variants.map((v) => {
    const ctr = v.impressions > 0 ? v.clicks / v.impressions : 0;
    const avgWatch = v.clicks > 0 ? v.watch_seconds / v.clicks : 0;
    const score = ctr * (1 + Math.log(1 + avgWatch) / 10);
    // Simple statistical significance: at least min_impressions and CTR difference visible
    const isSig = v.impressions >= test.min_impressions;
    return {
      variant_id: v.id,
      label: v.label,
      impressions: v.impressions,
      clicks: v.clicks,
      ctr,
      avg_watch_seconds: avgWatch,
      score,
      is_significant: isSig,
    };
  });

  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const winner = sorted[0] ?? null;
  const allSignificant = scores.every((s) => s.is_significant);
  // 2nd place has lower score
  const isReady = allSignificant && sorted.length >= 2 && sorted[0].score > sorted[1].score * 1.05;

  return { test, scores: sorted, winner, is_ready: isReady };
}

export function completeABTest(testId: string, force = false): ABTest | null {
  const db = getDb();
  const test = getABTest(testId);
  if (!test) return null;

  const { winner, is_ready, scores } = getABTestScores(testId);
  if (!force && !is_ready) throw new Error('Test has not reached statistical significance yet');

  const now = new Date().toISOString();
  db.prepare("UPDATE ab_tests SET status = 'completed', winner_variant_id = ?, ends_at = ?, updated_at = ? WHERE id = ?")
    .run(winner?.variant_id ?? null, now, now, testId);

  // Apply winning variant to the video
  if (winner && test.test_type === 'thumbnail') {
    const v = test.variants.find((x) => x.id === winner.variant_id);
    if (v) {
      try {
        db.prepare('UPDATE videos SET thumbnail_url = ? WHERE id = ?').run(v.content, test.video_id);
      } catch {}
    }
  } else if (winner && test.test_type === 'title') {
    const v = test.variants.find((x) => x.id === winner.variant_id);
    if (v) {
      try {
        db.prepare('UPDATE videos SET title = ? WHERE id = ?').run(v.content, test.video_id);
      } catch {}
    }
  } else if (winner && test.test_type === 'description') {
    const v = test.variants.find((x) => x.id === winner.variant_id);
    if (v) {
      try {
        db.prepare('UPDATE videos SET description = ? WHERE id = ?').run(v.content, test.video_id);
      } catch {}
    }
  }

  return getABTest(testId);
}

export function cancelABTest(testId: string): ABTest | null {
  const db = getDb();
  const test = getABTest(testId);
  if (!test) return null;
  const now = new Date().toISOString();
  db.prepare("UPDATE ab_tests SET status = 'cancelled', ends_at = ?, updated_at = ? WHERE id = ?").run(now, now, testId);
  return getABTest(testId);
}

// ============================================================
// 61.4 Publishing-Time Testing
// Test multiple candidate publish times for the same video
// (typically used to learn best slot for a channel), record
// performance per slot, and pick a winner.
// ============================================================

export type PublishTimeStatus = 'running' | 'completed' | 'cancelled';

export interface PublishTimeSlot {
  id: string;
  test_id: string;
  label: string;
  planned_at: string;
  published_at: string | null;
  views_1h: number;
  views_24h: number;
  likes: number;
  comments: number;
  score: number;
  created_at: string;
  updated_at: string;
}

export interface PublishTimeTest {
  id: string;
  channel_id: string;
  video_id: string;
  status: PublishTimeStatus;
  winner_slot_id: string | null;
  created_by: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  slots: PublishTimeSlot[];
}

export interface CreatePublishTimeTestInput {
  video_id: string;
  slots: Array<{ label: string; planned_at: string }>;
  notes?: string | null;
}

export function createPublishTimeTest(
  channelId: string, input: CreatePublishTimeTestInput, createdBy: string
): PublishTimeTest {
  if (!input.slots || input.slots.length < 2 || input.slots.length > 8) {
    throw new Error('Publish-time test requires 2-8 slots');
  }
  const db = getDb();
  const now = new Date().toISOString();
  // Cancel any running test for same video
  const running = db.prepare(
    "SELECT id FROM publish_time_tests WHERE video_id = ? AND status = 'running'"
  ).get(input.video_id) as { id: string } | undefined;
  if (running) {
    db.prepare("UPDATE publish_time_tests SET status = 'cancelled', updated_at = ? WHERE id = ?")
      .run(now, running.id);
  }
  const id = randomUUID();
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO publish_time_tests (id, channel_id, video_id, status, created_by, notes, created_at, updated_at)
       VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`
    ).run(id, channelId, input.video_id, createdBy, input.notes ?? null, now, now);
    const ins = db.prepare(
      `INSERT INTO publish_time_slots (id, test_id, label, planned_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const s of input.slots) {
      ins.run(randomUUID(), id, s.label.slice(0, 60), s.planned_at, now, now);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return getPublishTimeTest(id)!;
}

export function getPublishTimeTest(id: string): PublishTimeTest | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM publish_time_tests WHERE id = ?').get(id) as Omit<PublishTimeTest,'slots'> | undefined;
  if (!row) return null;
  const slots = db.prepare(
    'SELECT * FROM publish_time_slots WHERE test_id = ? ORDER BY planned_at ASC'
  ).all(id) as PublishTimeSlot[];
  return { ...row, slots };
}

export function listPublishTimeTestsForChannel(channelId: string, limit = 50): PublishTimeTest[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM publish_time_tests WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(channelId, Math.max(1, Math.min(200, limit))) as Array<Omit<PublishTimeTest,'slots'>>;
  return rows.map(r => {
    const slots = db.prepare(
      'SELECT * FROM publish_time_slots WHERE test_id = ? ORDER BY planned_at ASC'
    ).all(r.id) as PublishTimeSlot[];
    return { ...r, slots };
  });
}

export function listPublishTimeTestsForVideo(videoId: string): PublishTimeTest[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM publish_time_tests WHERE video_id = ? ORDER BY created_at DESC'
  ).all(videoId) as Array<Omit<PublishTimeTest,'slots'>>;
  return rows.map(r => {
    const slots = db.prepare(
      'SELECT * FROM publish_time_slots WHERE test_id = ? ORDER BY planned_at ASC'
    ).all(r.id) as PublishTimeSlot[];
    return { ...r, slots };
  });
}

export interface UpdateSlotInput {
  published_at?: string | null;
  views_1h?: number;
  views_24h?: number;
  likes?: number;
  comments?: number;
}

export function recordPublishSlotMetrics(slotId: string, input: UpdateSlotInput): PublishTimeSlot | null {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM publish_time_slots WHERE id = ?').get(slotId) as PublishTimeSlot | undefined;
  if (!existing) return null;
  const v1h = input.views_1h ?? existing.views_1h;
  const v24h = input.views_24h ?? existing.views_24h;
  const lks = input.likes ?? existing.likes;
  const cms = input.comments ?? existing.comments;
  // Simple score: 24h views + 5*likes + 3*comments
  const score = v24h + 5 * lks + 3 * cms;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE publish_time_slots SET
       published_at = COALESCE(?, published_at),
       views_1h = ?, views_24h = ?, likes = ?, comments = ?, score = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    input.published_at ?? null,
    v1h, v24h, lks, cms, score, now, slotId,
  );
  return db.prepare('SELECT * FROM publish_time_slots WHERE id = ?').get(slotId) as PublishTimeSlot;
}

export interface PublishTimeScores {
  test: PublishTimeTest | null;
  slots: PublishTimeSlot[];
  winner: PublishTimeSlot | null;
  is_ready: boolean;
}

export function getPublishTimeScores(testId: string): PublishTimeScores {
  const test = getPublishTimeTest(testId);
  if (!test) return { test: null, slots: [], winner: null, is_ready: false };
  const withMetrics = test.slots.filter(s => s.published_at !== null);
  const isReady = withMetrics.length >= 2 && withMetrics.every(s => s.views_24h > 0);
  const winner = withMetrics.length > 0
    ? withMetrics.reduce((a, b) => (b.score > a.score ? b : a))
    : null;
  return { test, slots: test.slots, winner, is_ready: isReady };
}

export function completePublishTimeTest(testId: string, force = false): PublishTimeTest | null {
  const test = getPublishTimeTest(testId);
  if (!test) return null;
  const { winner, is_ready } = getPublishTimeScores(testId);
  if (!force && !is_ready) throw new Error('Publish-time test has not collected enough data');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE publish_time_tests SET status = 'completed', winner_slot_id = ?, updated_at = ? WHERE id = ?"
  ).run(winner?.id ?? null, now, testId);
  return getPublishTimeTest(testId);
}

export function cancelPublishTimeTest(testId: string): PublishTimeTest | null {
  const test = getPublishTimeTest(testId);
  if (!test) return null;
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("UPDATE publish_time_tests SET status = 'cancelled', updated_at = ? WHERE id = ?")
    .run(now, testId);
  return getPublishTimeTest(testId);
}

export interface BestPublishHour {
  hour_utc: number;
  slot_count: number;
  avg_score: number;
}

export function getBestPublishHours(channelId: string, limit = 24): BestPublishHour[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      CAST(strftime('%H', s.planned_at) AS INTEGER) AS hour_utc,
      COUNT(*) AS slot_count,
      AVG(s.score) AS avg_score
    FROM publish_time_slots s
    JOIN publish_time_tests t ON t.id = s.test_id
    WHERE t.channel_id = ? AND s.published_at IS NOT NULL
    GROUP BY hour_utc
    ORDER BY avg_score DESC
    LIMIT ?
  `).all(channelId, Math.max(1, Math.min(24, limit))) as Array<{ hour_utc: number; slot_count: number; avg_score: number | null }>;
  return rows.map(r => ({
    hour_utc: r.hour_utc,
    slot_count: r.slot_count,
    avg_score: r.avg_score ?? 0,
  }));
}
