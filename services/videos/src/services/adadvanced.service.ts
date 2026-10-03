// melodyflix videos — Advanced Ad Features (51.11, 51.14, 51.17)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

// ============================================================
// 51.11 — Ad Revenue Dashboard
// Aggregate revenue across all campaigns / time windows
// ============================================================

export interface RevenueOverview {
  window_start: string;
  window_end: string;
  total_impressions: number;
  total_clicks: number;
  total_completions: number;
  total_revenue: number;
  gross_revenue: number;
  net_revenue: number;
  platform_fee: number;
  ctr: number;
  completion_rate: number;
  active_campaigns: number;
  pending_review: number;
}

export interface DailyRevenuePoint {
  date: string;
  impressions: number;
  clicks: number;
  revenue: number;
  spend: number;
}

export interface TopAdvertiser {
  advertiser: string;
  campaign_count: number;
  impressions: number;
  clicks: number;
  revenue: number;
  ctr: number;
}

const PLATFORM_FEE_RATE = 0.20; // 20% platform fee

export function getRevenueOverview(opts: { from?: string; to?: string } = {}): RevenueOverview {
  const db = getDb();
  const to = opts.to ?? new Date().toISOString();
  const from = opts.from ?? new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  const row = db.prepare(`
    SELECT
      COALESCE(SUM(impression_count), 0) as total_impressions,
      COALESCE(SUM(click_count), 0) as total_clicks,
      COALESCE(SUM(completion_count), 0) as total_completions,
      COALESCE(SUM(budget_spent), 0) as total_revenue,
      COUNT(*) as active_campaigns,
      COALESCE(SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END), 0) as pending_review
    FROM ad_campaigns
    WHERE (starts_at IS NULL OR starts_at <= ?)
      AND (ends_at IS NULL OR ends_at >= ?)
  `).get(to, from) as any;

  const impressions = row.total_impressions || 0;
  const clicks = row.total_clicks || 0;
  const completions = row.total_completions || 0;

  const gross = Number(row.total_revenue ?? 0);
  const platformFee = gross * PLATFORM_FEE_RATE;
  const net = gross - platformFee;

  return {
    window_start: from,
    window_end: to,
    total_impressions: impressions,
    total_clicks: clicks,
    total_completions: completions,
    total_revenue: gross,
    gross_revenue: gross,
    net_revenue: Number(net.toFixed(2)),
    platform_fee: Number(platformFee.toFixed(2)),
    ctr: impressions > 0 ? Number((clicks / impressions).toFixed(4)) : 0,
    completion_rate: impressions > 0 ? Number((completions / impressions).toFixed(4)) : 0,
    active_campaigns: row.active_campaigns ?? 0,
    pending_review: row.pending_review ?? 0,
  };
}

export function getDailyRevenue(opts: { from?: string; to?: string; days?: number } = {}): DailyRevenuePoint[] {
  const db = getDb();
  const to = opts.to ?? new Date().toISOString();
  const from = opts.from ?? new Date(Date.now() - (opts.days ?? 30) * 24 * 3600 * 1000).toISOString();

  // ad_impressions rows have revenue
  const rows = db.prepare(`
    SELECT
      substr(created_at, 1, 10) as date,
      COUNT(*) as impressions,
      COALESCE(SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END), 0) as clicks,
      COALESCE(SUM(revenue), 0) as revenue
    FROM ad_impressions
    WHERE created_at >= ? AND created_at <= ?
    GROUP BY substr(created_at, 1, 10)
    ORDER BY date ASC
  `).all(from, to) as { date: string; impressions: number; clicks: number; revenue: number }[];

  return rows.map((r) => ({
    date: r.date,
    impressions: r.impressions,
    clicks: r.clicks,
    revenue: Number(r.revenue.toFixed(2)),
    spend: Number(r.revenue.toFixed(2)),
  }));
}

export function getTopAdvertisers(opts: { from?: string; to?: string; limit?: number } = {}): TopAdvertiser[] {
  const db = getDb();
  const to = opts.to ?? new Date().toISOString();
  const from = opts.from ?? new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);

  const rows = db.prepare(`
    SELECT
      advertiser,
      COUNT(*) as campaign_count,
      COALESCE(SUM(impression_count), 0) as impressions,
      COALESCE(SUM(click_count), 0) as clicks,
      COALESCE(SUM(budget_spent), 0) as revenue
    FROM ad_campaigns
    WHERE (starts_at IS NULL OR starts_at <= ?)
      AND (ends_at IS NULL OR ends_at >= ?)
    GROUP BY advertiser
    ORDER BY revenue DESC
    LIMIT ?
  `).all(to, from, limit) as any[];

  return rows.map((r) => ({
    advertiser: r.advertiser,
    campaign_count: r.campaign_count,
    impressions: r.impressions,
    clicks: r.clicks,
    revenue: Number((r.revenue ?? 0).toFixed(2)),
    ctr: r.impressions > 0 ? Number((r.clicks / r.impressions).toFixed(4)) : 0,
  }));
}

// ============================================================
// 51.14 — Ad Block Detection
// ============================================================

export interface AdBlockEvent {
  id: string;
  user_id: string | null;
  session_id: string | null;
  video_id: string | null;
  detected: number;
  detection_method: string | null;
  user_agent: string | null;
  ip_hash: string | null;
  created_at: string;
}

export interface AdBlockStats {
  window_start: string;
  window_end: string;
  total_events: number;
  unique_users: number;
  detected_count: number;
  detection_rate: number;
  by_method: { detection_method: string; count: number }[];
}

export function ensureAdAdvancedSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ad_block_events (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      session_id TEXT,
      video_id TEXT,
      detected INTEGER NOT NULL DEFAULT 0,
      detection_method TEXT,
      user_agent TEXT,
      ip_hash TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_adblock_user_time
      ON ad_block_events(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_adblock_detected
      ON ad_block_events(detected, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_adblock_session
      ON ad_block_events(session_id);

    CREATE TABLE IF NOT EXISTS ssai_breaks (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      break_type TEXT NOT NULL DEFAULT 'mid-roll'
        CHECK (break_type IN ('pre-roll','mid-roll','post-roll')),
      at_seconds REAL NOT NULL DEFAULT 0,
      duration_seconds REAL NOT NULL DEFAULT 0,
      pod_id TEXT,
      manifest_segment TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ssai_video_time
      ON ssai_breaks(video_id, at_seconds, is_active);
  `);
}

export interface RecordAdBlockInput {
  user_id?: string | null;
  session_id?: string | null;
  video_id?: string | null;
  detected?: boolean;
  detection_method?: string | null;
  user_agent?: string | null;
  ip_hash?: string | null;
}

export function recordAdBlock(input: RecordAdBlockInput): AdBlockEvent {
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO ad_block_events
      (id, user_id, session_id, video_id, detected, detection_method,
       user_agent, ip_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.user_id ?? null, input.session_id ?? null, input.video_id ?? null,
    input.detected ? 1 : 0,
    input.detection_method ?? null,
    input.user_agent?.slice(0, 200) ?? null,
    input.ip_hash ?? null, now
  );
  return db.prepare('SELECT * FROM ad_block_events WHERE id = ?').get(id) as AdBlockEvent;
}

export function getAdBlockStats(opts: { from?: string; to?: string } = {}): AdBlockStats {
  const db = getDb();
  const to = opts.to ?? new Date().toISOString();
  const from = opts.from ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const row = db.prepare(`
    SELECT
      COUNT(*) as total_events,
      COUNT(DISTINCT user_id) as unique_users,
      COALESCE(SUM(CASE WHEN detected = 1 THEN 1 ELSE 0 END), 0) as detected_count
    FROM ad_block_events
    WHERE created_at >= ? AND created_at <= ?
  `).get(from, to) as any;

  const byMethod = db.prepare(`
    SELECT detection_method, COUNT(*) as count
    FROM ad_block_events
    WHERE created_at >= ? AND created_at <= ? AND detection_method IS NOT NULL
    GROUP BY detection_method ORDER BY count DESC
  `).all(from, to) as { detection_method: string; count: number }[];

  const total = row.total_events ?? 0;
  const detected = row.detected_count ?? 0;
  return {
    window_start: from,
    window_end: to,
    total_events: total,
    unique_users: row.unique_users ?? 0,
    detected_count: detected,
    detection_rate: total > 0 ? Number((detected / total).toFixed(4)) : 0,
    by_method: byMethod,
  };
}

export function listAdBlockEvents(opts: {
  detected_only?: boolean;
  user_id?: string;
  limit?: number;
} = {}): AdBlockEvent[] {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];
  if (opts.detected_only) where.push('detected = 1');
  if (opts.user_id) { where.push('user_id = ?'); params.push(opts.user_id); }
  const n = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  params.push(n);
  return db.prepare(`
    SELECT * FROM ad_block_events
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT ?
  `).all(...params) as AdBlockEvent[];
}

// ============================================================
// 51.17 — Server-Side Ad Insertion (SSAI)
// ============================================================

export interface SsaiBreak {
  id: string;
  video_id: string;
  break_type: 'pre-roll' | 'mid-roll' | 'post-roll';
  at_seconds: number;
  duration_seconds: number;
  pod_id: string | null;
  manifest_segment: string | null;
  is_active: number;
  created_at: string;
}

export interface CreateSsaiBreakInput {
  video_id: string;
  break_type?: 'pre-roll' | 'mid-roll' | 'post-roll';
  at_seconds: number;
  duration_seconds: number;
  pod_id?: string | null;
}

export function createSsaiBreak(input: CreateSsaiBreakInput): SsaiBreak {
  const db = getDb();
  const v = db.prepare('SELECT id FROM videos WHERE id = ?').get(input.video_id);
  if (!v) throw new Error('Video not found');
  if (input.at_seconds < 0) throw new Error('at_seconds must be >= 0');
  if (input.duration_seconds < 1 || input.duration_seconds > 300) {
    throw new Error('duration_seconds must be 1-300');
  }
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO ssai_breaks
      (id, video_id, break_type, at_seconds, duration_seconds, pod_id,
       is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    id, input.video_id, input.break_type ?? 'mid-roll',
    input.at_seconds, input.duration_seconds,
    input.pod_id ?? null, now
  );
  return db.prepare('SELECT * FROM ssai_breaks WHERE id = ?').get(id) as SsaiBreak;
}

export function listSsaiBreaks(videoId: string, activeOnly = true): SsaiBreak[] {
  const db = getDb();
  const where: string[] = ['video_id = ?'];
  if (activeOnly) where.push('is_active = 1');
  return db.prepare(`
    SELECT * FROM ssai_breaks
    WHERE ${where.join(' AND ')}
    ORDER BY at_seconds ASC
  `).all(videoId) as SsaiBreak[];
}

export function deleteSsaiBreak(id: string): boolean {
  return getDb().prepare('DELETE FROM ssai_breaks WHERE id = ?').run(id).changes > 0;
}

export function updateSsaiBreak(
  id: string,
  patch: { at_seconds?: number; duration_seconds?: number; pod_id?: string | null; is_active?: boolean }
): SsaiBreak | null {
  const db = getDb();
  const cur = db.prepare('SELECT * FROM ssai_breaks WHERE id = ?').get(id) as SsaiBreak | undefined;
  if (!cur) return null;
  const fields: string[] = [];
  const values: any[] = [];
  if (patch.at_seconds !== undefined) {
    if (patch.at_seconds < 0) throw new Error('at_seconds must be >= 0');
    fields.push('at_seconds = ?'); values.push(patch.at_seconds);
  }
  if (patch.duration_seconds !== undefined) {
    if (patch.duration_seconds < 1 || patch.duration_seconds > 300) throw new Error('duration_seconds must be 1-300');
    fields.push('duration_seconds = ?'); values.push(patch.duration_seconds);
  }
  if (patch.pod_id !== undefined) { fields.push('pod_id = ?'); values.push(patch.pod_id); }
  if (patch.is_active !== undefined) { fields.push('is_active = ?'); values.push(patch.is_active ? 1 : 0); }
  if (fields.length === 0) return cur;
  values.push(id);
  db.prepare(`UPDATE ssai_breaks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return db.prepare('SELECT * FROM ssai_breaks WHERE id = ?').get(id) as SsaiBreak;
}

// Build a VMAP (Video Multiple Ad Playlist) XML for a video, the response
// format that many SSAI clients accept.
export function buildVmapXml(videoId: string, adsByBreak: Record<string, any[]> = {}): string {
  const breaks = listSsaiBreaks(videoId);
  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push('<vmap:VMAP xmlns:vmap="http://www.iab.net/videosuite/vmap" version="1.0">');
  for (const b of breaks) {
    const ads = adsByBreak[b.id] ?? [];
    parts.push(`  <vmap:AdBreak timeOffset="${b.at_seconds.toFixed(1)}" breakType="${b.break_type === 'pre-roll' ? 'linear' : 'linear'}" breakId="${b.id}">`);
    parts.push(`    <vmap:AdSource id="${b.pod_id ?? b.id}" allowMultipleAds="${ads.length > 1 ? 'true' : 'false'}" followRedirects="true">`);
    if (ads.length > 0) {
      parts.push('      <vmap:AdTagURI templateType="vast3"><![CDATA[]]></vmap:AdTagURI>');
    } else {
      parts.push('      <vmap:AdTagURI templateType="vast3"><![CDATA[]]></vmap:AdTagURI>');
    }
    parts.push('    </vmap:AdSource>');
    parts.push('    <vmap:TrackingEvents></vmap:TrackingEvents>');
    parts.push('  </vmap:AdBreak>');
  }
  parts.push('</vmap:VMAP>');
  return parts.join('\n');
}

export interface SsaiManifestSummary {
  video_id: string;
  break_count: number;
  total_ad_seconds: number;
  breaks: SsaiBreak[];
}

export function getSsaiSummary(videoId: string): SsaiManifestSummary {
  const breaks = listSsaiBreaks(videoId);
  const totalAdSeconds = breaks.reduce((sum, b) => sum + b.duration_seconds, 0);
  return {
    video_id: videoId,
    break_count: breaks.length,
    total_ad_seconds: totalAdSeconds,
    breaks,
  };
}
