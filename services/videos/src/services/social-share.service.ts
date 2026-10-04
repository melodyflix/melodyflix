// melodyflix videos — Social Media Integration (Section 47)
// 47.1 Facebook  47.2 X/Twitter  47.3 Instagram  47.4 TikTok  47.5 LinkedIn
// Focus: share URLs, per-platform config (admin-toggleable), tracking, OG meta.
import { randomUUID, createHash } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type PlatformId = 'facebook' | 'twitter' | 'instagram' | 'tiktok' | 'linkedin';

export interface SocialPlatform {
  id: PlatformId;
  label: string;
  icon: string;
  is_enabled: number;
  share_url_template: string;
  max_title_length: number;
  tracking_enabled: number;
  display_order: number;
  updated_at: string;
}

export interface ShareEvent {
  id: string;
  user_id: string | null;
  video_id: string;
  platform: PlatformId;
  share_url: string;
  referrer: string | null;
  user_agent: string | null;
  ip_hash: string | null;
  created_at: string;
}

export interface VideoSocialMeta {
  video_id: string;
  og_title: string | null;
  og_description: string | null;
  og_image_url: string | null;
  og_type: string;
  twitter_card_type: string;
  embed_allowed: number;
  updated_at: string;
}

const DEFAULTS: Array<Omit<SocialPlatform, 'updated_at'>> = [
  {
    id: 'facebook', label: 'Facebook', icon: '👍', is_enabled: 1,
    share_url_template: 'https://www.facebook.com/sharer/sharer.php?u={url}',
    max_title_length: 200, tracking_enabled: 1, display_order: 1,
  },
  {
    id: 'twitter', label: 'X (Twitter)', icon: '🐦', is_enabled: 1,
    share_url_template: 'https://twitter.com/intent/tweet?url={url}&text={title}',
    max_title_length: 240, tracking_enabled: 1, display_order: 2,
  },
  {
    id: 'instagram', label: 'Instagram', icon: '📸', is_enabled: 1,
    // Instagram has no direct share URL — we return the video URL for manual copy/share
    share_url_template: '{url}',
    max_title_length: 200, tracking_enabled: 1, display_order: 3,
  },
  {
    id: 'tiktok', label: 'TikTok', icon: '🎵', is_enabled: 1,
    share_url_template: '{url}',
    max_title_length: 200, tracking_enabled: 1, display_order: 4,
  },
  {
    id: 'linkedin', label: 'LinkedIn', icon: '💼', is_enabled: 1,
    share_url_template: 'https://www.linkedin.com/sharing/share-offsite/?url={url}',
    max_title_length: 200, tracking_enabled: 1, display_order: 5,
  },
];

export function ensureSocialShareSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_platforms (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      share_url_template TEXT NOT NULL,
      max_title_length INTEGER NOT NULL DEFAULT 200,
      tracking_enabled INTEGER NOT NULL DEFAULT 1,
      display_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS social_shares (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      video_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      share_url TEXT NOT NULL,
      referrer TEXT,
      user_agent TEXT,
      ip_hash TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ss_video ON social_shares(video_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ss_platform ON social_shares(platform);
    CREATE INDEX IF NOT EXISTS idx_ss_user ON social_shares(user_id, created_at);

    CREATE TABLE IF NOT EXISTS video_social_meta (
      video_id TEXT PRIMARY KEY,
      og_title TEXT,
      og_description TEXT,
      og_image_url TEXT,
      og_type TEXT NOT NULL DEFAULT 'video.other',
      twitter_card_type TEXT NOT NULL DEFAULT 'summary_large_image',
      embed_allowed INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
  `);

  // Seed defaults (idempotent — INSERT OR IGNORE so admin changes are preserved)
  const now = new Date().toISOString();
  const ins = db.prepare(`
    INSERT OR IGNORE INTO social_platforms
      (id, label, icon, is_enabled, share_url_template, max_title_length, tracking_enabled, display_order, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const p of DEFAULTS) {
    ins.run(p.id, p.label, p.icon, p.is_enabled, p.share_url_template, p.max_title_length, p.tracking_enabled, p.display_order, now);
  }
}

// ============================================================
// Platform config (admin-toggleable)
// ============================================================

export function listPlatforms(opts: { enabledOnly?: boolean } = {}): SocialPlatform[] {
  const db = getDb();
  const where = opts.enabledOnly ? 'WHERE is_enabled = 1' : '';
  return db.prepare(
    `SELECT * FROM social_platforms ${where} ORDER BY display_order ASC`
  ).all() as SocialPlatform[];
}

export function getPlatform(id: PlatformId): SocialPlatform | null {
  return (getDb().prepare('SELECT * FROM social_platforms WHERE id = ?').get(id) as SocialPlatform | undefined) ?? null;
}

export function updatePlatform(id: PlatformId, patch: {
  label?: string;
  icon?: string;
  is_enabled?: boolean;
  share_url_template?: string;
  max_title_length?: number;
  tracking_enabled?: boolean;
  display_order?: number;
}): SocialPlatform {
  const existing = getPlatform(id);
  if (!existing) throw new Error('Platform not found');
  const db = getDb();
  const fields: string[] = [];
  const params: any[] = [];
  if (patch.label !== undefined) { fields.push('label = ?'); params.push(patch.label); }
  if (patch.icon !== undefined) { fields.push('icon = ?'); params.push(patch.icon); }
  if (patch.is_enabled !== undefined) { fields.push('is_enabled = ?'); params.push(patch.is_enabled ? 1 : 0); }
  if (patch.share_url_template !== undefined) {
    if (!patch.share_url_template.includes('{url}')) throw new Error('share_url_template must contain {url}');
    fields.push('share_url_template = ?'); params.push(patch.share_url_template);
  }
  if (patch.max_title_length !== undefined) { fields.push('max_title_length = ?'); params.push(patch.max_title_length); }
  if (patch.tracking_enabled !== undefined) { fields.push('tracking_enabled = ?'); params.push(patch.tracking_enabled ? 1 : 0); }
  if (patch.display_order !== undefined) { fields.push('display_order = ?'); params.push(patch.display_order); }
  if (fields.length === 0) return existing;
  fields.push('updated_at = ?');
  params.push(new Date().toISOString(), id);
  db.prepare(`UPDATE social_platforms SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getPlatform(id)!;
}

// ============================================================
// Share URL generation
// ============================================================

function encode(s: string): string {
  return encodeURIComponent(s);
}

export function generateShareUrl(videoId: string, platform: PlatformId, opts: {
  baseUrl?: string;
  title?: string;
} = {}): { platform: PlatformId; share_url: string; video_url: string } {
  const p = getPlatform(platform);
  if (!p) throw new Error('Platform not found');
  if (p.is_enabled !== 1) throw new Error('Platform is disabled');

  const base = (opts.baseUrl ?? 'https://melodyflix.com').replace(/\/$/, '');
  const videoUrl = `${base}/watch/${videoId}`;

  let title = (opts.title ?? '').trim();
  if (title.length > p.max_title_length) title = title.slice(0, p.max_title_length - 1) + '…';

  const shareUrl = p.share_url_template
    .replace('{url}', encode(videoUrl))
    .replace('{title}', encode(title));

  return { platform, share_url: shareUrl, video_url: videoUrl };
}

// ============================================================
// Share tracking
// ============================================================

export function trackShare(input: {
  user_id?: string | null;
  video_id: string;
  platform: PlatformId;
  share_url: string;
  referrer?: string | null;
  user_agent?: string | null;
  ip?: string | null;
}): ShareEvent | null {
  const p = getPlatform(input.platform);
  if (!p || p.is_enabled !== 1 || p.tracking_enabled !== 1) return null;

  // Simple IP hash for privacy-safe counting
  let ipHash: string | null = null;
  if (input.ip) {
    ipHash = createHash('sha256').update(input.ip).digest('hex').slice(0, 16);
  }

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO social_shares
      (id, user_id, video_id, platform, share_url, referrer, user_agent, ip_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.user_id ?? null, input.video_id, input.platform, input.share_url,
    input.referrer ?? null, input.user_agent ?? null, ipHash, now);

  return db.prepare('SELECT * FROM social_shares WHERE id = ?').get(id) as ShareEvent;
}

export interface ShareStats {
  video_id: string;
  total: number;
  by_platform: Record<string, number>;
  last_shared_at: string | null;
}

export function getShareStats(videoId: string): ShareStats {
  const db = getDb();
  const rows = db.prepare(
    'SELECT platform, COUNT(*) as n, MAX(created_at) as last FROM social_shares WHERE video_id = ? GROUP BY platform'
  ).all(videoId) as Array<{ platform: string; n: number; last: string }>;

  const byPlatform: Record<string, number> = {};
  let total = 0;
  let lastSharedAt: string | null = null;
  for (const r of rows) {
    byPlatform[r.platform] = r.n;
    total += r.n;
    if (!lastSharedAt || r.last > lastSharedAt) lastSharedAt = r.last;
  }
  return { video_id: videoId, total, by_platform: byPlatform, last_shared_at: lastSharedAt };
}

export function listShareEvents(videoId: string, opts: { platform?: PlatformId; limit?: number } = {}): ShareEvent[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const filters: string[] = ['video_id = ?'];
  const params: any[] = [videoId];
  if (opts.platform) { filters.push('platform = ?'); params.push(opts.platform); }
  params.push(limit);
  return db.prepare(
    `SELECT * FROM social_shares WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT ?`
  ).all(...params) as ShareEvent[];
}

// ============================================================
// Video social metadata (OpenGraph / Twitter Card)
// ============================================================

export function getVideoSocialMeta(videoId: string): VideoSocialMeta | null {
  return (getDb().prepare('SELECT * FROM video_social_meta WHERE video_id = ?').get(videoId) as VideoSocialMeta | undefined) ?? null;
}

export function setVideoSocialMeta(videoId: string, patch: {
  og_title?: string | null;
  og_description?: string | null;
  og_image_url?: string | null;
  og_type?: string;
  twitter_card_type?: string;
  embed_allowed?: boolean;
}): VideoSocialMeta {
  const db = getDb();
  const existing = getVideoSocialMeta(videoId);
  const now = new Date().toISOString();
  if (!existing) {
    db.prepare(`
      INSERT INTO video_social_meta
        (video_id, og_title, og_description, og_image_url, og_type, twitter_card_type, embed_allowed, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      videoId,
      patch.og_title ?? null, patch.og_description ?? null, patch.og_image_url ?? null,
      patch.og_type ?? 'video.other', patch.twitter_card_type ?? 'summary_large_image',
      patch.embed_allowed === false ? 0 : 1, now,
    );
  } else {
    const fields: string[] = [];
    const params: any[] = [];
    const map: Array<[keyof typeof patch, string, (v: any) => any]> = [
      ['og_title', 'og_title', (v) => v],
      ['og_description', 'og_description', (v) => v],
      ['og_image_url', 'og_image_url', (v) => v],
      ['og_type', 'og_type', (v) => v],
      ['twitter_card_type', 'twitter_card_type', (v) => v],
      ['embed_allowed', 'embed_allowed', (v) => v ? 1 : 0],
    ];
    for (const [key, col, xform] of map) {
      if (patch[key] !== undefined) { fields.push(`${col} = ?`); params.push(xform(patch[key])); }
    }
    if (fields.length > 0) {
      fields.push('updated_at = ?');
      params.push(now, videoId);
      db.prepare(`UPDATE video_social_meta SET ${fields.join(', ')} WHERE video_id = ?`).run(...params);
    }
  }
  return getVideoSocialMeta(videoId)!;
}

/**
 * Build OpenGraph + Twitter Card tag object for a video.
 * Falls back to video fields when custom meta not set.
 */
export function buildSocialMetaTags(videoId: string, baseUrl = 'https://melodyflix.com'): {
  og: Record<string, string>;
  twitter: Record<string, string>;
  canonical_url: string;
} {
  const db = getDb();
  const v = db.prepare('SELECT id, title, description, thumbnail_url FROM videos WHERE id = ?')
    .get(videoId) as { id: string; title: string; description: string | null; thumbnail_url: string | null } | undefined;
  if (!v) throw new Error('Video not found');

  const custom = getVideoSocialMeta(videoId);
  const base = baseUrl.replace(/\/$/, '');
  const canonical = `${base}/watch/${videoId}`;

  const ogTitle = custom?.og_title ?? v.title;
  const ogDesc = custom?.og_description ?? (v.description ?? '');
  const ogImage = custom?.og_image_url ?? v.thumbnail_url ?? '';
  const ogType = custom?.og_type ?? 'video.other';

  const og: Record<string, string> = {
    'og:title': ogTitle,
    'og:description': ogDesc,
    'og:type': ogType,
    'og:url': canonical,
  };
  if (ogImage) og['og:image'] = ogImage;

  const twitter: Record<string, string> = {
    'twitter:card': custom?.twitter_card_type ?? 'summary_large_image',
    'twitter:title': ogTitle,
    'twitter:description': ogDesc,
  };
  if (ogImage) twitter['twitter:image'] = ogImage;

  return { og, twitter, canonical_url: canonical };
}

/**
 * Build an iframe embed snippet (used by "Embed" button).
 * Returns empty when embed_allowed = 0.
 */
export function buildEmbedSnippet(videoId: string, baseUrl = 'https://melodyflix.com', size: { width: number; height: number } = { width: 640, height: 360 }): {
  allowed: boolean;
  iframe_html: string | null;
  embed_url: string | null;
} {
  const meta = getVideoSocialMeta(videoId);
  const allowed = meta ? meta.embed_allowed === 1 : true;
  if (!allowed) return { allowed: false, iframe_html: null, embed_url: null };

  const base = baseUrl.replace(/\/$/, '');
  const embedUrl = `${base}/embed/${videoId}`;
  const html = `<iframe width="${size.width}" height="${size.height}" src="${embedUrl}" frameborder="0" allowfullscreen></iframe>`;
  return { allowed: true, iframe_html: html, embed_url: embedUrl };
}
