// melodyflix videos - distribution (31.1 - 31.4)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

// ---------- Platforms ----------

export type PlatformId = 'youtube' | 'facebook' | 'instagram' | 'twitter' | 'tiktok' | 'linkedin' | 'telegram';

export interface Platform {
  id: PlatformId;
  label: string;
  icon: string;
  supports_video: boolean;
  max_duration_seconds: number | null;
  max_file_size_mb: number | null;
}

export const PLATFORMS: Platform[] = [
  { id: 'youtube',   label: 'YouTube',   icon: '📺', supports_video: true,  max_duration_seconds: 43200, max_file_size_mb: 256000 },
  { id: 'facebook',  label: 'Facebook',  icon: '👍', supports_video: true,  max_duration_seconds: 14400, max_file_size_mb: 10240 },
  { id: 'instagram', label: 'Instagram', icon: '📸', supports_video: true,  max_duration_seconds: 3600,  max_file_size_mb: 4096 },
  { id: 'twitter',   label: 'X (Twitter)', icon: '🐦', supports_video: true, max_duration_seconds: 140,  max_file_size_mb: 512 },
  { id: 'tiktok',    label: 'TikTok',    icon: '🎵', supports_video: true,  max_duration_seconds: 600,   max_file_size_mb: 287 },
  { id: 'linkedin',  label: 'LinkedIn',  icon: '💼', supports_video: true,  max_duration_seconds: 900,   max_file_size_mb: 5120 },
  { id: 'telegram',  label: 'Telegram',  icon: '✈️', supports_video: true,  max_duration_seconds: null,  max_file_size_mb: 2048 },
];

// ---------- Schema ----------

export function ensureDistributionSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_platform_accounts (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      account_name TEXT,
      access_token TEXT,
      is_connected INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (channel_id, platform)
    );

    CREATE TABLE IF NOT EXISTS distribution_jobs (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      title TEXT,
      description TEXT,
      tags TEXT,
      scheduled_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      external_url TEXT,
      error TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dist_jobs_video ON distribution_jobs(video_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_dist_jobs_scheduled ON distribution_jobs(status, scheduled_at);

    CREATE TABLE IF NOT EXISTS auto_share_rules (
      channel_id TEXT PRIMARY KEY,
      share_on_publish INTEGER NOT NULL DEFAULT 0,
      platforms TEXT NOT NULL DEFAULT '[]',
      auto_message TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS syndication_feeds (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_feeds_slug ON syndication_feeds(slug);
  `);
}

// ---------- Platform accounts (31.1) ----------

export interface PlatformAccount {
  id: string;
  channel_id: string;
  platform: PlatformId;
  account_name: string | null;
  is_connected: number;
  created_at: string;
  updated_at: string;
}

export function listPlatformAccounts(channelId: string): Omit<PlatformAccount, 'access_token'>[] {
  const db = getDb();
  return db.prepare(
    'SELECT id, channel_id, platform, account_name, is_connected, created_at, updated_at FROM channel_platform_accounts WHERE channel_id = ? ORDER BY platform ASC'
  ).all(channelId) as any[];
}

export function connectPlatform(channelId: string, platform: PlatformId, accountName: string, token: string): PlatformAccount {
  if (!PLATFORMS.find((p) => p.id === platform)) throw new Error('Unknown platform');
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM channel_platform_accounts WHERE channel_id = ? AND platform = ?').get(channelId, platform) as PlatformAccount | undefined;
  if (existing) {
    db.prepare('UPDATE channel_platform_accounts SET account_name = ?, access_token = ?, is_connected = 1, updated_at = ? WHERE id = ?')
      .run(accountName, token, now, existing.id);
    return { ...existing, account_name: accountName, is_connected: 1, updated_at: now };
  }
  const id = randomUUID();
  db.prepare(
    'INSERT INTO channel_platform_accounts (id, channel_id, platform, account_name, access_token, is_connected, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'
  ).run(id, channelId, platform, accountName, token, now, now);
  return { id, channel_id: channelId, platform, account_name: accountName, is_connected: 1, created_at: now, updated_at: now } as any;
}

export function disconnectPlatform(channelId: string, platform: PlatformId): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM channel_platform_accounts WHERE channel_id = ? AND platform = ?').run(channelId, platform);
  return res.changes > 0;
}

// ---------- Distribution jobs (31.1, 31.2) ----------

export type JobStatus = 'pending' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';

export interface DistributionJob {
  id: string;
  video_id: string;
  channel_id: string;
  platform: PlatformId;
  status: JobStatus;
  title: string | null;
  description: string | null;
  tags: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  external_url: string | null;
  error: string | null;
  retry_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface DistributionInput {
  video_id: string;
  channel_id: string;
  platform: PlatformId;
  title?: string;
  description?: string;
  tags?: string[];
  scheduled_at?: string | null;
}

export function createJob(input: DistributionInput, createdBy: string): DistributionJob {
  const db = getDb();
  if (!PLATFORMS.find((p) => p.id === input.platform)) throw new Error('Unknown platform');
  const isScheduled = !!input.scheduled_at;
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO distribution_jobs (id, video_id, channel_id, platform, status, title, description, tags, scheduled_at, created_by, created_at, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id, input.video_id, input.channel_id, input.platform,
    isScheduled ? 'scheduled' : 'pending',
    input.title?.slice(0, 200) ?? null,
    input.description?.slice(0, 2000) ?? null,
    input.tags ? JSON.stringify(input.tags.slice(0, 20)) : null,
    input.scheduled_at ?? null,
    createdBy, now, now,
  );
  return getJob(id)!;
}

export function getJob(id: string): DistributionJob | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM distribution_jobs WHERE id = ?').get(id) as DistributionJob) ?? null;
}

export function listJobsForVideo(videoId: string): DistributionJob[] {
  const db = getDb();
  return db.prepare('SELECT * FROM distribution_jobs WHERE video_id = ? ORDER BY created_at DESC').all(videoId) as DistributionJob[];
}

export function listJobsForChannel(channelId: string, limit = 100): DistributionJob[] {
  const db = getDb();
  return db.prepare('SELECT * FROM distribution_jobs WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(channelId, Math.max(1, Math.min(500, limit))) as DistributionJob[];
}

export function cancelJob(id: string): DistributionJob | null {
  const db = getDb();
  const j = getJob(id);
  if (!j) return null;
  if (j.status === 'published') throw new Error('Cannot cancel a published job');
  db.prepare("UPDATE distribution_jobs SET status = 'cancelled', updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  return getJob(id);
}

export function deleteJob(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM distribution_jobs WHERE id = ?').run(id);
}

// Simulate a job publish (no real API call — marks as published with fake URL)
export function simulatePublish(id: string): DistributionJob | null {
  const db = getDb();
  const j = getJob(id);
  if (!j) return null;
  if (j.status === 'published') return j;
  const now = new Date().toISOString();
  const fakeUrl = `https://${j.platform}.example.com/watch/${j.video_id.slice(0, 8)}`;
  db.prepare(
    "UPDATE distribution_jobs SET status = 'published', started_at = ?, completed_at = ?, external_url = ?, updated_at = ? WHERE id = ?"
  ).run(now, now, fakeUrl, now, id);
  return getJob(id);
}

// Process scheduled jobs whose time has come (call from a cron)
export function processScheduledJobs(): number {
  const db = getDb();
  const now = new Date().toISOString();
  const due = db.prepare(
    "SELECT id FROM distribution_jobs WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ? LIMIT 50"
  ).all(now) as { id: string }[];
  for (const r of due) simulatePublish(r.id);
  return due.length;
}

// ---------- Auto-share rules (31.3) ----------

export interface AutoShareRule {
  channel_id: string;
  share_on_publish: number;
  platforms: PlatformId[];
  auto_message: string | null;
  updated_at: string;
}

export function getAutoShareRule(channelId: string): AutoShareRule {
  const db = getDb();
  const row = db.prepare('SELECT * FROM auto_share_rules WHERE channel_id = ?').get(channelId) as any;
  if (row) {
    return { ...row, platforms: safeParsePlatforms(row.platforms) };
  }
  return {
    channel_id: channelId,
    share_on_publish: 0,
    platforms: [],
    auto_message: null,
    updated_at: new Date().toISOString(),
  };
}

function safeParsePlatforms(s: string): PlatformId[] {
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr)) {
      const valid = new Set(PLATFORMS.map((p) => p.id));
      return arr.filter((x: any) => valid.has(x));
    }
  } catch {}
  return [];
}

export interface AutoShareInput {
  share_on_publish?: boolean;
  platforms?: PlatformId[];
  auto_message?: string | null;
}

export function setAutoShareRule(channelId: string, input: AutoShareInput): AutoShareRule {
  const db = getDb();
  const current = getAutoShareRule(channelId);
  const valid = new Set(PLATFORMS.map((p) => p.id));
  const platforms = input.platforms !== undefined
    ? input.platforms.filter((p) => valid.has(p))
    : current.platforms;
  const now = new Date().toISOString();
  const share = input.share_on_publish === undefined ? current.share_on_publish : (input.share_on_publish ? 1 : 0);
  const msg = input.auto_message !== undefined ? (input.auto_message ? String(input.auto_message).slice(0, 500) : null) : current.auto_message;

  db.prepare(
    'INSERT INTO auto_share_rules (channel_id, share_on_publish, platforms, auto_message, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?) ' +
    'ON CONFLICT(channel_id) DO UPDATE SET share_on_publish = excluded.share_on_publish, platforms = excluded.platforms, auto_message = excluded.auto_message, updated_at = excluded.updated_at'
  ).run(channelId, share, JSON.stringify(platforms), msg, now);

  return { channel_id: channelId, share_on_publish: share, platforms, auto_message: msg, updated_at: now };
}

// Called when a video is published — creates auto-share jobs
export function runAutoShare(videoId: string, channelId: string, videoTitle: string, videoDescription: string | null): number {
  const rule = getAutoShareRule(channelId);
  if (rule.share_on_publish !== 1 || rule.platforms.length === 0) return 0;
  let created = 0;
  for (const platform of rule.platforms) {
    try {
      createJob({
        video_id: videoId,
        channel_id: channelId,
        platform,
        title: videoTitle,
        description: rule.auto_message ?? videoDescription ?? undefined,
      }, 'auto-share');
      created++;
    } catch {}
  }
  return created;
}

// ---------- Syndication feeds (31.4) ----------

export interface SyndicationFeed {
  id: string;
  channel_id: string;
  slug: string;
  title: string;
  description: string | null;
  is_enabled: number;
  created_at: string;
  updated_at: string;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'feed';
}

export function getFeed(channelId: string): SyndicationFeed | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM syndication_feeds WHERE channel_id = ?').get(channelId) as SyndicationFeed) ?? null;
}

export function getFeedBySlug(slug: string): SyndicationFeed | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM syndication_feeds WHERE slug = ?').get(slug) as SyndicationFeed) ?? null;
}

export function createFeed(channelId: string, channelName: string, description?: string | null): SyndicationFeed {
  const db = getDb();
  const existing = getFeed(channelId);
  if (existing) return existing;

  let slug = slugify(channelName);
  // Ensure uniqueness
  let attempt = 0;
  while (getFeedBySlug(slug) && attempt < 10) {
    attempt++;
    slug = `${slugify(channelName)}-${attempt + 1}`;
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO syndication_feeds (id, channel_id, slug, title, description, is_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'
  ).run(id, channelId, slug, channelName, description ?? null, now, now);
  return getFeed(channelId)!;
}

export function updateFeed(channelId: string, patch: { is_enabled?: boolean; description?: string | null }): SyndicationFeed | null {
  const db = getDb();
  const f = getFeed(channelId);
  if (!f) return null;
  db.prepare('UPDATE syndication_feeds SET is_enabled = ?, description = ?, updated_at = ? WHERE id = ?')
    .run(
      patch.is_enabled === undefined ? f.is_enabled : (patch.is_enabled ? 1 : 0),
      patch.description !== undefined ? patch.description : f.description,
      new Date().toISOString(),
      f.id,
    );
  return getFeed(channelId);
}

export function deleteFeed(channelId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM syndication_feeds WHERE channel_id = ?').run(channelId);
}

// Build RSS XML for a feed
export function buildRssXml(feed: SyndicationFeed, origin = ''): string {
  const db = getDb();
  const base = origin.replace(/\/$/, '');
  const videos = db.prepare(
    "SELECT id, title, description, thumbnail_url, duration_seconds, created_at FROM videos WHERE channel_id = ? AND visibility = 'public' ORDER BY created_at DESC LIMIT 50"
  ).all(feed.channel_id) as any[];

  const esc = (s: any) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));

  const items = videos.map((v) => `
    <item>
      <title>${esc(v.title)}</title>
      <link>${base}/watch/${v.id}</link>
      <guid isPermaLink="true">${base}/watch/${v.id}</guid>
      <description>${esc(v.description || '')}</description>
      <pubDate>${new Date(v.created_at).toUTCString()}</pubDate>
      ${v.thumbnail_url ? `<enclosure url="${esc(v.thumbnail_url)}" type="image/jpeg"/>` : ''}
      <itunes:duration>${Math.floor(v.duration_seconds || 0)}</itunes:duration>
    </item>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>${esc(feed.title)}</title>
    <link>${base}/channel/${feed.channel_id}</link>
    <description>${esc(feed.description || feed.title)}</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <ttl>60</ttl>
    ${items}
  </channel>
</rss>`;
}
