// melodyflix videos - advanced analytics (26.2 - 26.18)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

// ============ Schema ============

export function ensureAdvancedAnalyticsSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id TEXT PRIMARY KEY,
      channel_id TEXT,
      video_id TEXT,
      user_id TEXT,
      session_id TEXT,
      event_type TEXT NOT NULL,      -- view_start | view_end | progress | click | scroll | pause | seek | quality_change | fullscreen
      event_data TEXT,               -- JSON payload
      country TEXT,
      language TEXT,
      device_type TEXT,              -- desktop | mobile | tablet | tv | unknown
      browser TEXT,
      os TEXT,
      referrer TEXT,                 -- youtube, google, direct, social, embedded, ...
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      ip_hash TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_analytics_events_channel ON analytics_events(channel_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_video ON analytics_events(video_id, event_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_user ON analytics_events(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_session ON analytics_events(session_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS analytics_user_profiles (
      user_id TEXT PRIMARY KEY,
      birth_year INTEGER,
      gender TEXT,
      country TEXT,
      language TEXT,
      interests TEXT DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    -- Pre-computed daily rollups for speed
    CREATE TABLE IF NOT EXISTS analytics_daily_rollup (
      channel_id TEXT NOT NULL,
      video_id TEXT NOT NULL DEFAULT '',
      day TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      unique_viewers INTEGER NOT NULL DEFAULT 0,
      watch_time_seconds INTEGER NOT NULL DEFAULT 0,
      avg_view_duration REAL NOT NULL DEFAULT 0,
      completion_count INTEGER NOT NULL DEFAULT 0,
      rewatch_count INTEGER NOT NULL DEFAULT 0,
      click_count INTEGER NOT NULL DEFAULT 0,
      revenue REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (channel_id, video_id, day)
    );
    CREATE INDEX IF NOT EXISTS idx_rollup_channel_day ON analytics_daily_rollup(channel_id, day DESC);
  `);
}

// ============ Event ingestion ============

export type EventType =
  | 'view_start' | 'view_end' | 'progress' | 'pause' | 'resume' | 'seek'
  | 'click' | 'scroll' | 'quality_change' | 'fullscreen' | 'ad_impression' | 'ad_click'
  | 'share' | 'like' | 'subscribe' | 'comment';

export interface EventInput {
  event_type: EventType;
  channel_id?: string | null;
  video_id?: string | null;
  user_id?: string | null;
  session_id?: string | null;
  data?: any;
  country?: string | null;
  language?: string | null;
  device_type?: string | null;
  browser?: string | null;
  os?: string | null;
  referrer?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  ip_hash?: string | null;
}

export function trackEvent(input: EventInput): { id: string } {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO analytics_events (id, channel_id, video_id, user_id, session_id, event_type, event_data, country, language, device_type, browser, os, referrer, utm_source, utm_medium, utm_campaign, ip_hash, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    input.channel_id ?? null,
    input.video_id ?? null,
    input.user_id ?? null,
    input.session_id ?? null,
    input.event_type,
    input.data ? JSON.stringify(input.data).slice(0, 4000) : null,
    input.country ?? null,
    input.language ?? null,
    input.device_type ?? null,
    input.browser ?? null,
    input.os ?? null,
    input.referrer ?? null,
    input.utm_source ?? null,
    input.utm_medium ?? null,
    input.utm_campaign ?? null,
    input.ip_hash ?? null,
    now,
  );

  // Update daily rollup on view_start
  if (input.event_type === 'view_start' && input.channel_id && input.video_id) {
    const day = now.slice(0, 10);
    db.prepare(
      'INSERT INTO analytics_daily_rollup (channel_id, video_id, day, views) VALUES (?, ?, ?, 1) ' +
      'ON CONFLICT(channel_id, video_id, day) DO UPDATE SET views = views + 1'
    ).run(input.channel_id, input.video_id, day);
  }

  return { id };
}

// ============ 26.2 — Demographics ============

export interface DemographicSlice {
  key: string;
  label: string;
  count: number;
  percent: number;
}

function groupBy(arr: { key: string | null; n: number }[]): DemographicSlice[] {
  const total = arr.reduce((s, r) => s + r.n, 0);
  return arr
    .filter((r) => r.key !== null && r.n > 0)
    .map((r) => ({
      key: r.key!,
      label: r.key!,
      count: r.n,
      percent: total > 0 ? r.n / total : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

export interface DemographicsResult {
  by_country: DemographicSlice[];
  by_language: DemographicSlice[];
  by_device: DemographicSlice[];
  by_browser: DemographicSlice[];
  by_os: DemographicSlice[];
  by_age_group: DemographicSlice[];
  by_gender: DemographicSlice[];
  by_referrer: DemographicSlice[];
  total_events: number;
  unique_viewers: number;
}

export function getDemographics(channelId: string, days = 30): DemographicsResult {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  const q = (col: string) =>
    db.prepare(
      `SELECT ${col} as key, COUNT(DISTINCT COALESCE(user_id, session_id)) as n FROM analytics_events WHERE channel_id = ? AND created_at >= ? AND event_type = 'view_start' GROUP BY ${col}`
    ).all(channelId, since) as { key: string | null; n: number }[];

  const totalEvents = (db.prepare(
    "SELECT COUNT(*) as n FROM analytics_events WHERE channel_id = ? AND created_at >= ?"
  ).get(channelId, since) as { n: number }).n;

  const uniqueViewers = (db.prepare(
    "SELECT COUNT(DISTINCT COALESCE(user_id, session_id)) as n FROM analytics_events WHERE channel_id = ? AND created_at >= ? AND event_type = 'view_start'"
  ).get(channelId, since) as { n: number }).n;

  // Age groups: join with user_profiles
  const ageRows = db.prepare(
    "SELECT " +
    "CASE " +
    "WHEN p.birth_year IS NULL THEN 'unknown' " +
    "WHEN (strftime('%Y', 'now') - p.birth_year) < 18 THEN '<18' " +
    "WHEN (strftime('%Y', 'now') - p.birth_year) < 25 THEN '18-24' " +
    "WHEN (strftime('%Y', 'now') - p.birth_year) < 35 THEN '25-34' " +
    "WHEN (strftime('%Y', 'now') - p.birth_year) < 45 THEN '35-44' " +
    "WHEN (strftime('%Y', 'now') - p.birth_year) < 55 THEN '45-54' " +
    "WHEN (strftime('%Y', 'now') - p.birth_year) < 65 THEN '55-64' " +
    "ELSE '65+' END as key, " +
    "COUNT(DISTINCT e.user_id) as n " +
    "FROM analytics_events e LEFT JOIN analytics_user_profiles p ON p.user_id = e.user_id " +
    "WHERE e.channel_id = ? AND e.created_at >= ? AND e.event_type = 'view_start' AND e.user_id IS NOT NULL " +
    "GROUP BY key"
  ).all(channelId, since) as { key: string; n: number }[];

  const genderRows = db.prepare(
    "SELECT COALESCE(p.gender, 'unknown') as key, COUNT(DISTINCT e.user_id) as n " +
    "FROM analytics_events e LEFT JOIN analytics_user_profiles p ON p.user_id = e.user_id " +
    "WHERE e.channel_id = ? AND e.created_at >= ? AND e.event_type = 'view_start' AND e.user_id IS NOT NULL " +
    "GROUP BY key"
  ).all(channelId, since) as { key: string; n: number }[];

  return {
    by_country: groupBy(q('country')),
    by_language: groupBy(q('language')),
    by_device: groupBy(q('device_type')),
    by_browser: groupBy(q('browser')),
    by_os: groupBy(q('os')),
    by_age_group: groupBy(ageRows),
    by_gender: groupBy(genderRows),
    by_referrer: groupBy(q('referrer')),
    total_events: totalEvents,
    unique_viewers: uniqueViewers,
  };
}

// ============ 26.3 — Traffic Sources ============

export interface TrafficSource {
  source: string;
  visits: number;
  percent: number;
  utm_medium: string | null;
}

export interface TrafficReport {
  sources: TrafficSource[];
  by_utm_campaign: { campaign: string; visits: number }[];
  by_utm_medium: { medium: string; visits: number }[];
  by_utm_source: { source: string; visits: number }[];
}

export function getTrafficSources(channelId: string, days = 30): TrafficReport {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  const sources = db.prepare(
    "SELECT COALESCE(referrer, 'direct') as source, COUNT(*) as visits FROM analytics_events " +
    "WHERE channel_id = ? AND created_at >= ? AND event_type = 'view_start' GROUP BY source ORDER BY visits DESC LIMIT 30"
  ).all(channelId, since) as { source: string; visits: number }[];

  const total = sources.reduce((s, r) => s + r.visits, 0);
  const mapped: TrafficSource[] = sources.map((s) => ({
    source: s.source,
    visits: s.visits,
    percent: total > 0 ? s.visits / total : 0,
    utm_medium: null,
  }));

  const utmCampaign = db.prepare(
    "SELECT COALESCE(utm_campaign, '(none)') as campaign, COUNT(*) as visits FROM analytics_events " +
    "WHERE channel_id = ? AND created_at >= ? AND utm_campaign IS NOT NULL GROUP BY campaign ORDER BY visits DESC LIMIT 20"
  ).all(channelId, since) as { campaign: string; visits: number }[];

  const utmMedium = db.prepare(
    "SELECT COALESCE(utm_medium, '(none)') as medium, COUNT(*) as visits FROM analytics_events " +
    "WHERE channel_id = ? AND created_at >= ? AND utm_medium IS NOT NULL GROUP BY medium ORDER BY visits DESC LIMIT 20"
  ).all(channelId, since) as { medium: string; visits: number }[];

  const utmSource = db.prepare(
    "SELECT COALESCE(utm_source, '(none)') as source, COUNT(*) as visits FROM analytics_events " +
    "WHERE channel_id = ? AND created_at >= ? AND utm_source IS NOT NULL GROUP BY source ORDER BY visits DESC LIMIT 20"
  ).all(channelId, since) as { source: string; visits: number }[];

  return {
    sources: mapped,
    by_utm_campaign: utmCampaign,
    by_utm_medium: utmMedium,
    by_utm_source: utmSource,
  };
}

// ============ User profile upsert ============

export interface UserProfileInput {
  birth_year?: number;
  gender?: string;
  country?: string;
  language?: string;
  interests?: string[];
}

export function upsertUserProfile(userId: string, patch: UserProfileInput): void {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM analytics_user_profiles WHERE user_id = ?').get(userId) as any;

  db.prepare(
    'INSERT INTO analytics_user_profiles (user_id, birth_year, gender, country, language, interests, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(user_id) DO UPDATE SET ' +
    'birth_year = COALESCE(excluded.birth_year, analytics_user_profiles.birth_year), ' +
    'gender = COALESCE(excluded.gender, analytics_user_profiles.gender), ' +
    'country = COALESCE(excluded.country, analytics_user_profiles.country), ' +
    'language = COALESCE(excluded.language, analytics_user_profiles.language), ' +
    'interests = COALESCE(excluded.interests, analytics_user_profiles.interests), ' +
    'updated_at = excluded.updated_at'
  ).run(
    userId,
    patch.birth_year ?? (existing?.birth_year ?? null),
    patch.gender ?? (existing?.gender ?? null),
    patch.country ?? (existing?.country ?? null),
    patch.language ?? (existing?.language ?? null),
    patch.interests ? JSON.stringify(patch.interests) : (existing?.interests ?? '[]'),
    now,
  );
}

export function getUserProfile(userId: string): any {
  const db = getDb();
  return db.prepare('SELECT * FROM analytics_user_profiles WHERE user_id = ?').get(userId) ?? null;
}

// ============ 26.4 — Revenue Reports ============

export interface RevenuePoint {
  day: string;
  revenue: number;
  views: number;
  rpm: number;  // revenue per 1000 views
}

export interface RevenueReport {
  total_revenue: number;
  total_views: number;
  rpm: number;
  by_day: RevenuePoint[];
  by_source: { source: string; revenue: number }[];
  by_country: { country: string; revenue: number }[];
}

// Revenue comes from:
// - ad_billing_ledger (real ad revenue)
// - payments table (memberships, superchat, etc. — best-effort)
export function getRevenueReport(channelId: string, days = 30): RevenueReport {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  // Ad revenue daily
  let adDaily: { day: string; revenue: number }[] = [];
  try {
    adDaily = db.prepare(
      "SELECT substr(created_at, 1, 10) as day, COALESCE(SUM(amount), 0) as revenue " +
      "FROM ad_billing_ledger WHERE created_at >= ? " +
      "AND campaign_id IN (SELECT id FROM ad_campaigns WHERE created_by IN (SELECT owner_id FROM channels WHERE id = ?)) " +
      "GROUP BY day ORDER BY day ASC"
    ).all(since, channelId) as { day: string; revenue: number }[];
  } catch { adDaily = []; }

  // Views daily (from analytics_daily_rollup)
  const viewDaily = db.prepare(
    "SELECT day, COALESCE(SUM(views), 0) as views FROM analytics_daily_rollup WHERE channel_id = ? AND day >= ? GROUP BY day ORDER BY day ASC"
  ).all(channelId, since.slice(0, 10)) as { day: string; views: number }[];

  const viewMap = new Map(viewDaily.map((r) => [r.day, r.views]));
  const revenueMap = new Map(adDaily.map((r) => [r.day, r.revenue]));

  const days_ = Math.max(1, days);
  const byDay: RevenuePoint[] = [];
  for (let i = days_ - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    const revenue = revenueMap.get(d) ?? 0;
    const views = viewMap.get(d) ?? 0;
    byDay.push({ day: d, revenue, views, rpm: views > 0 ? (revenue / views) * 1000 : 0 });
  }

  const totalRevenue = byDay.reduce((s, p) => s + p.revenue, 0);
  const totalViews = byDay.reduce((s, p) => s + p.views, 0);

  // By country
  let byCountry: { country: string; revenue: number }[] = [];
  try {
    byCountry = db.prepare(
      "SELECT COALESCE(country, 'unknown') as country, COALESCE(SUM(revenue), 0) as revenue " +
      "FROM ad_impressions WHERE created_at >= ? GROUP BY country ORDER BY revenue DESC LIMIT 20"
    ).all(since) as { country: string; revenue: number }[];
  } catch { byCountry = []; }

  return {
    total_revenue: totalRevenue,
    total_views: totalViews,
    rpm: totalViews > 0 ? (totalRevenue / totalViews) * 1000 : 0,
    by_day: byDay,
    by_source: [
      { source: 'ads', revenue: totalRevenue },
    ],
    by_country: byCountry,
  };
}

// ============ 26.6 — Predictive Analytics ============

export interface ForecastPoint {
  day: string;
  predicted_views: number;
  predicted_revenue: number;
}

export interface PredictiveAnalytics {
  next_7_days: ForecastPoint[];
  next_30_days_summary: { predicted_views: number; predicted_revenue: number };
  trend: 'growing' | 'declining' | 'stable';
  growth_rate: number;  // % change over last 7 days vs previous 7 days
  confidence: number;    // 0..1 (how consistent the series is)
}

// Simple linear regression over last N days
function linearForecast(series: number[], horizon: number): number[] {
  const n = series.length;
  if (n < 2) return new Array(horizon).fill(series[0] ?? 0);
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += series[i];
    sumXY += i * series[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;
  return Array.from({ length: horizon }, (_, i) => {
    const y = intercept + slope * (n + i);
    return Math.max(0, y);
  });
}

export function getPredictiveAnalytics(channelId: string, lookbackDays = 30): PredictiveAnalytics {
  const db = getDb();
  const since = new Date(Date.now() - lookbackDays * 86400_000).toISOString().slice(0, 10);

  const viewRows = db.prepare(
    "SELECT day, COALESCE(SUM(views), 0) as views FROM analytics_daily_rollup WHERE channel_id = ? AND day >= ? GROUP BY day ORDER BY day ASC"
  ).all(channelId, since) as { day: string; views: number }[];

  const viewSeries: number[] = [];
  const map = new Map(viewRows.map((r) => [r.day, r.views]));
  for (let i = lookbackDays - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    viewSeries.push(map.get(d) ?? 0);
  }

  const forecast7 = linearForecast(viewSeries, 7);
  const forecast30 = linearForecast(viewSeries, 30);

  // RPM estimate (avg)
  const totalViews30 = viewSeries.reduce((a, b) => a + b, 0);
  const totalRev30 = getRevenueReport(channelId, lookbackDays).total_revenue;
  const rpm = totalViews30 > 0 ? totalRev30 / totalViews30 : 0;

  const next7: ForecastPoint[] = forecast7.map((v, i) => {
    const d = new Date(Date.now() + (i + 1) * 86400_000).toISOString().slice(0, 10);
    return { day: d, predicted_views: Math.round(v), predicted_revenue: v * rpm };
  });

  const sum30 = forecast30.reduce((a, b) => a + b, 0);

  // Growth: last 7 days vs prior 7 days
  const last7 = viewSeries.slice(-7).reduce((a, b) => a + b, 0);
  const prior7 = viewSeries.slice(-14, -7).reduce((a, b) => a + b, 0);
  const growth = prior7 > 0 ? (last7 - prior7) / prior7 : 0;

  // Confidence: 1 - normalized variance of residuals (simple)
  const n = viewSeries.length;
  let mean = viewSeries.reduce((a, b) => a + b, 0) / n;
  let variance = n > 1 ? viewSeries.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  const stdev = Math.sqrt(variance);
  const cv = mean > 0 ? stdev / mean : 1;
  const confidence = Math.max(0, Math.min(1, 1 - cv));

  const trend: 'growing' | 'declining' | 'stable' = growth > 0.05 ? 'growing' : growth < -0.05 ? 'declining' : 'stable';

  return {
    next_7_days: next7,
    next_30_days_summary: { predicted_views: Math.round(sum30), predicted_revenue: sum30 * rpm },
    trend,
    growth_rate: growth,
    confidence,
  };
}

// ============ 26.7 — Churn Rate Analysis ============

export interface ChurnAnalysis {
  total_subscribers: number;
  churned_30d: number;
  churn_rate_30d: number;
  retention_rate_30d: number;
  new_30d: number;
  net_growth_30d: number;
  monthly_series: { month: string; churned: number; new: number; net: number }[];
}

export function getChurnRate(channelId: string, days = 90): ChurnAnalysis {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  // Subscriptions events (try channel_subscriptions table)
  let total = 0, churned30 = 0, new30 = 0;
  let monthly: { month: string; churned: number; new: number; net: number }[] = [];

  try {
    total = (db.prepare('SELECT COUNT(*) as n FROM channel_subscriptions WHERE channel_id = ?').get(channelId) as { n: number }).n;
  } catch { total = 0; }

  try {
    const since30 = new Date(Date.now() - 30 * 86400_000).toISOString();
    new30 = (db.prepare(
      'SELECT COUNT(*) as n FROM channel_subscriptions WHERE channel_id = ? AND created_at >= ?'
    ).get(channelId, since30) as { n: number }).n;
  } catch { new30 = 0; }

  // churned: subscriptions where unsubscribed_at >= 30d ago (if column exists)
  try {
    const since30 = new Date(Date.now() - 30 * 86400_000).toISOString();
    churned30 = (db.prepare(
      'SELECT COUNT(*) as n FROM channel_subscriptions WHERE channel_id = ? AND unsubscribed_at IS NOT NULL AND unsubscribed_at >= ?'
    ).get(channelId, since30) as { n: number }).n;
  } catch { churned30 = 0; }

  // Monthly series
  try {
    monthly = db.prepare(
      "SELECT substr(created_at, 1, 7) as month, COUNT(*) as new, 0 as churned FROM channel_subscriptions " +
      "WHERE channel_id = ? AND created_at >= ? GROUP BY month ORDER BY month ASC"
    ).all(channelId, since) as any[];
  } catch { monthly = []; }

  monthly = monthly.map((m) => ({ ...m, net: m.new - m.churned }));

  const churnRate = total > 0 ? churned30 / total : 0;
  const retentionRate = 1 - churnRate;

  return {
    total_subscribers: total,
    churned_30d: churned30,
    churn_rate_30d: churnRate,
    retention_rate_30d: retentionRate,
    new_30d: new30,
    net_growth_30d: new30 - churned30,
    monthly_series: monthly,
  };
}

// ============ 26.8 — Lifetime Value (LTV) ============

export interface LtvResult {
  avg_ltv: number;
  total_ltv: number;
  cohort_count: number;
  by_cohort: { cohort_month: string; users: number; avg_ltv: number; total_ltv: number }[];
  arpu: number;         // average revenue per user (per month)
  avg_lifetime_months: number;
}

export function getLifetimeValue(channelId: string, months = 12): LtvResult {
  const db = getDb();
  const since = new Date(Date.now() - months * 30 * 86400_000).toISOString();

  // ARPU from ad revenue + subscription revenue attributed to this channel's viewers
  // For simplicity: total revenue / unique viewers (or subscribers)
  const revenue = getRevenueReport(channelId, months * 30).total_revenue;

  // Get unique subscribers/viewers per cohort month
  let cohorts: { cohort_month: string; users: number }[] = [];
  try {
    cohorts = db.prepare(
      "SELECT substr(created_at, 1, 7) as cohort_month, COUNT(*) as users " +
      "FROM channel_subscriptions WHERE channel_id = ? AND created_at >= ? GROUP BY cohort_month ORDER BY cohort_month ASC"
    ).all(channelId, since) as any[];
  } catch { cohorts = []; }

  const totalUsers = cohorts.reduce((s, c) => s + c.users, 0);
  const arpu = totalUsers > 0 ? revenue / totalUsers : 0;

  // Assume average lifetime of 12 months for subscribed users (industry standard)
  const avg_lifetime_months = 12;
  const avgLtv = arpu * avg_lifetime_months;

  const byCohort = cohorts.map((c) => ({
    cohort_month: c.cohort_month,
    users: c.users,
    avg_ltv: avgLtv,
    total_ltv: avgLtv * c.users,
  }));

  return {
    avg_ltv: avgLtv,
    total_ltv: avgLtv * totalUsers,
    cohort_count: cohorts.length,
    by_cohort: byCohort,
    arpu,
    avg_lifetime_months,
  };
}

// ============ 26.9 — Cohort Analysis ============

export interface CohortRow {
  cohort_month: string;
  users: number;
  periods: number[];  // retention % for month 0, 1, 2, ...
}

export interface CohortAnalysis {
  cohorts: CohortRow[];
  avg_retention: number[];  // average across cohorts per period
}

export function getCohortAnalysis(channelId: string, months = 12): CohortAnalysis {
  const db = getDb();
  const since = new Date(Date.now() - months * 30 * 86400_000).toISOString();

  // Get subscribers grouped by signup month
  let subs: { user_id: string; cohort_month: string }[] = [];
  try {
    subs = db.prepare(
      "SELECT user_id, substr(created_at, 1, 7) as cohort_month FROM channel_subscriptions WHERE channel_id = ? AND created_at >= ?"
    ).all(channelId, since) as any[];
  } catch { subs = []; }

  if (subs.length === 0) return { cohorts: [], avg_retention: [] };

  // For each cohort, count unique viewers per subsequent month
  const cohorts: CohortRow[] = [];
  const cohortMap = new Map<string, string[]>();
  for (const s of subs) {
    if (!cohortMap.has(s.cohort_month)) cohortMap.set(s.cohort_month, []);
    cohortMap.get(s.cohort_month)!.push(s.user_id);
  }

  const monthDiff = (a: string, b: string): number => {
    const [ay, am] = a.split('-').map(Number);
    const [by, bm] = b.split('-').map(Number);
    return (by - ay) * 12 + (bm - am);
  };

  const avgBuckets: Map<number, { sum: number; n: number }> = new Map();

  for (const [cohortMonth, userIds] of cohortMap.entries()) {
    const periods: number[] = [];
    const size = userIds.length;
    if (size === 0) continue;

    // Period 0 = all users in cohort
    periods.push(1);

    for (let p = 1; p < months; p++) {
      // count users active in this period (view_start events)
      const placeholders = userIds.map(() => '?').join(',');
      const startMonth = cohortMonth;
      const targetMonth = addMonths(startMonth, p);
      const start = `${targetMonth}-01`;
      const endMonth = addMonths(targetMonth, 1);
      const end = `${endMonth}-01`;

      const active = (db.prepare(
        `SELECT COUNT(DISTINCT user_id) as n FROM analytics_events WHERE channel_id = ? AND user_id IN (${placeholders}) AND created_at >= ? AND created_at < ? AND event_type = 'view_start'`
      ).get(channelId, ...userIds, start, end) as { n: number }).n;

      periods.push(size > 0 ? active / size : 0);
      const bucket = avgBuckets.get(p) ?? { sum: 0, n: 0 };
      bucket.sum += size > 0 ? active / size : 0;
      bucket.n += 1;
      avgBuckets.set(p, bucket);
    }

    cohorts.push({ cohort_month: cohortMonth, users: size, periods });
  }

  const maxPeriods = Math.max(...cohorts.map((c) => c.periods.length), 0);
  const avgRetention: number[] = [];
  for (let p = 0; p < maxPeriods; p++) {
    const b = avgBuckets.get(p);
    if (p === 0) avgRetention.push(1);
    else if (b && b.n > 0) avgRetention.push(b.sum / b.n);
    else avgRetention.push(0);
  }

  return { cohorts: cohorts.sort((a, b) => a.cohort_month.localeCompare(b.cohort_month)), avg_retention: avgRetention };
}

function addMonths(ym: string, count: number): string {
  const [y, m] = ym.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + count;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

// ============ 26.10 — Funnel Analysis ============

export interface FunnelStep {
  step: string;
  label: string;
  count: number;
  drop_from_prev: number;   // users who dropped
  conversion_from_start: number;  // %
}

export interface FunnelAnalysis {
  steps: FunnelStep[];
  total_sessions: number;
  conversion_rate: number;
}

export function getFunnelAnalysis(channelId: string, days = 30): FunnelAnalysis {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  // Funnel: view_start → engaged (progress>25%) → progress>75% → completion → click/subscribe
  const sessions = db.prepare(
    "SELECT DISTINCT session_id FROM analytics_events WHERE channel_id = ? AND created_at >= ? AND session_id IS NOT NULL AND event_type = 'view_start'"
  ).all(channelId, since) as { session_id: string }[];

  const totalSessions = sessions.length;
  if (totalSessions === 0) {
    return {
      steps: [
        { step: 'view_start', label: 'Started watching', count: 0, drop_from_prev: 0, conversion_from_start: 0 },
        { step: 'engaged', label: 'Watched 25%+', count: 0, drop_from_prev: 0, conversion_from_start: 0 },
        { step: 'committed', label: 'Watched 75%+', count: 0, drop_from_prev: 0, conversion_from_start: 0 },
        { step: 'completed', label: 'Completed', count: 0, drop_from_prev: 0, conversion_from_start: 0 },
        { step: 'converted', label: 'Liked/Subscribed', count: 0, drop_from_prev: 0, conversion_from_start: 0 },
      ],
      total_sessions: 0,
      conversion_rate: 0,
    };
  }

  const ids = sessions.map((s) => s.session_id);
  const ph = ids.map(() => '?').join(',');

  const engaged = (db.prepare(
    `SELECT COUNT(DISTINCT session_id) as n FROM analytics_events WHERE channel_id = ? AND session_id IN (${ph}) AND event_type = 'progress' AND CAST(json_extract(event_data, '$.percent') AS REAL) >= 25`
  ).get(channelId, ...ids) as { n: number }).n;

  const committed = (db.prepare(
    `SELECT COUNT(DISTINCT session_id) as n FROM analytics_events WHERE channel_id = ? AND session_id IN (${ph}) AND event_type = 'progress' AND CAST(json_extract(event_data, '$.percent') AS REAL) >= 75`
  ).get(channelId, ...ids) as { n: number }).n;

  const completed = (db.prepare(
    `SELECT COUNT(DISTINCT session_id) as n FROM analytics_events WHERE channel_id = ? AND session_id IN (${ph}) AND event_type = 'view_end' AND CAST(json_extract(event_data, '$.completed') AS INTEGER) = 1`
  ).get(channelId, ...ids) as { n: number }).n;

  const converted = (db.prepare(
    `SELECT COUNT(DISTINCT session_id) as n FROM analytics_events WHERE channel_id = ? AND session_id IN (${ph}) AND event_type IN ('like', 'subscribe')`
  ).get(channelId, ...ids) as { n: number }).n;

  const build = (step: string, label: string, count: number, prev: number): FunnelStep => ({
    step,
    label,
    count,
    drop_from_prev: Math.max(0, prev - count),
    conversion_from_start: totalSessions > 0 ? count / totalSessions : 0,
  });

  const steps = [
    build('view_start', 'Started watching', totalSessions, totalSessions),
    build('engaged', 'Watched 25%+', engaged, totalSessions),
    build('committed', 'Watched 75%+', committed, engaged),
    build('completed', 'Completed', completed, committed),
    build('converted', 'Liked/Subscribed', converted, completed),
  ];

  return {
    steps,
    total_sessions: totalSessions,
    conversion_rate: totalSessions > 0 ? converted / totalSessions : 0,
  };
}

// ============ 26.12 — Completion Rate ============

export interface CompletionRateReport {
  overall_completion_rate: number;
  by_video: { video_id: string; title: string | null; starts: number; completions: number; rate: number }[];
  by_day: { day: string; starts: number; completions: number; rate: number }[];
}

export function getCompletionRate(channelId: string, days = 30): CompletionRateReport {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  // Overall
  const starts = (db.prepare(
    "SELECT COUNT(*) as n FROM analytics_events WHERE channel_id = ? AND created_at >= ? AND event_type = 'view_start'"
  ).get(channelId, since) as { n: number }).n;

  const completions = (db.prepare(
    "SELECT COUNT(*) as n FROM analytics_events WHERE channel_id = ? AND created_at >= ? AND event_type = 'view_end' AND CAST(json_extract(event_data, '$.completed') AS INTEGER) = 1"
  ).get(channelId, since) as { n: number }).n;

  const overall = starts > 0 ? completions / starts : 0;

  // By video
  let byVideo: any[] = [];
  try {
    byVideo = db.prepare(
      "SELECT e.video_id, v.title, " +
      "SUM(CASE WHEN e.event_type = 'view_start' THEN 1 ELSE 0 END) as starts, " +
      "SUM(CASE WHEN e.event_type = 'view_end' AND CAST(json_extract(e.event_data, '$.completed') AS INTEGER) = 1 THEN 1 ELSE 0 END) as completions " +
      "FROM analytics_events e LEFT JOIN videos v ON v.id = e.video_id " +
      "WHERE e.channel_id = ? AND e.created_at >= ? AND e.video_id IS NOT NULL " +
      "GROUP BY e.video_id HAVING starts > 0 ORDER BY starts DESC LIMIT 50"
    ).all(channelId, since) as any[];
  } catch { byVideo = []; }

  const byVideoMapped = byVideo.map((r) => ({
    video_id: r.video_id,
    title: r.title ?? null,
    starts: r.starts,
    completions: r.completions,
    rate: r.starts > 0 ? r.completions / r.starts : 0,
  }));

  // By day
  const byDay = db.prepare(
    "SELECT substr(created_at, 1, 10) as day, " +
    "SUM(CASE WHEN event_type = 'view_start' THEN 1 ELSE 0 END) as starts, " +
    "SUM(CASE WHEN event_type = 'view_end' AND CAST(json_extract(event_data, '$.completed') AS INTEGER) = 1 THEN 1 ELSE 0 END) as completions " +
    "FROM analytics_events WHERE channel_id = ? AND created_at >= ? GROUP BY day ORDER BY day ASC"
  ).all(channelId, since) as any[];

  return {
    overall_completion_rate: overall,
    by_video: byVideoMapped,
    by_day: byDay.map((d) => ({ ...d, rate: d.starts > 0 ? d.completions / d.starts : 0 })),
  };
}

// ============ 26.13 — Re-watch Analytics ============

export interface RewatchReport {
  total_rewatches: number;
  rewatch_rate: number;   // rewatches / unique viewers
  top_rewatched: { video_id: string; title: string | null; rewatches: number; unique_viewers: number }[];
}

export function getRewatchAnalytics(channelId: string, days = 30): RewatchReport {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  // A rewatch = a user who had 2+ view_start events for same video
  const rows = db.prepare(
    "SELECT video_id, user_id, COUNT(*) as n FROM analytics_events " +
    "WHERE channel_id = ? AND created_at >= ? AND event_type = 'view_start' AND user_id IS NOT NULL AND video_id IS NOT NULL " +
    "GROUP BY video_id, user_id HAVING n >= 2"
  ).all(channelId, since) as { video_id: string; user_id: string; n: number }[];

  const totalRewatches = rows.reduce((s, r) => s + (r.n - 1), 0);

  const uniqueViewers = (db.prepare(
    "SELECT COUNT(DISTINCT user_id) as n FROM analytics_events WHERE channel_id = ? AND created_at >= ? AND event_type = 'view_start' AND user_id IS NOT NULL"
  ).get(channelId, since) as { n: number }).n;

  // Top rewatched videos
  const videoAgg = new Map<string, { rewatches: number; users: Set<string> }>();
  for (const r of rows) {
    if (!videoAgg.has(r.video_id)) videoAgg.set(r.video_id, { rewatches: 0, users: new Set() });
    videoAgg.get(r.video_id)!.rewatches += r.n - 1;
    videoAgg.get(r.video_id)!.users.add(r.user_id);
  }

  const top: { video_id: string; title: string | null; rewatches: number; unique_viewers: number }[] = [];
  for (const [vid, agg] of videoAgg.entries()) {
    let title: string | null = null;
    try {
      const v = db.prepare('SELECT title FROM videos WHERE id = ?').get(vid) as { title: string } | undefined;
      title = v?.title ?? null;
    } catch {}
    top.push({ video_id: vid, title, rewatches: agg.rewatches, unique_viewers: agg.users.size });
  }
  top.sort((a, b) => b.rewatches - a.rewatches);

  return {
    total_rewatches: totalRewatches,
    rewatch_rate: uniqueViewers > 0 ? totalRewatches / uniqueViewers : 0,
    top_rewatched: top.slice(0, 20),
  };
}

// ============ 26.14 — Drop-off Points ============

export interface DropOffBucket {
  percent_bucket: string;  // '0-10%', '10-20%', ...
  drops: number;
  percent_of_total: number;
}

export interface DropOffReport {
  buckets: DropOffBucket[];
  avg_watch_percent: number;
  worst_drop_bucket: string | null;
}

export function getDropOffPoints(channelId: string, days = 30): DropOffReport {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  // Get the max progress percent from each session
  const rows = db.prepare(
    "SELECT session_id, MAX(CAST(json_extract(event_data, '$.percent') AS REAL)) as max_pct " +
    "FROM analytics_events WHERE channel_id = ? AND created_at >= ? AND session_id IS NOT NULL AND event_type = 'progress' " +
    "GROUP BY session_id"
  ).all(channelId, since) as { session_id: string; max_pct: number }[];

  const total = rows.length;
  const buckets = Array.from({ length: 10 }, (_, i) => ({
    percent_bucket: `${i * 10}-${(i + 1) * 10}%`,
    drops: 0,
    percent_of_total: 0,
  }));

  let sum = 0;
  for (const r of rows) {
    const pct = Math.max(0, Math.min(100, r.max_pct ?? 0));
    sum += pct;
    const bucketIdx = Math.min(9, Math.floor(pct / 10));
    buckets[bucketIdx].drops++;
  }
  for (const b of buckets) {
    b.percent_of_total = total > 0 ? b.drops / total : 0;
  }

  const worst = buckets.reduce((a, b) => b.drops > a.drops ? b : a, buckets[0]);

  return {
    buckets,
    avg_watch_percent: total > 0 ? sum / total : 0,
    worst_drop_bucket: total > 0 ? worst.percent_bucket : null,
  };
}

// ============ 26.15 — Click Tracking ============

export interface ClickEvent {
  id: string;
  user_id: string | null;
  session_id: string | null;
  event_data: any;
  created_at: string;
}

export interface ClickTrackingReport {
  total_clicks: number;
  by_target: { target: string; clicks: number; percent: number }[];
  by_video: { video_id: string; clicks: number }[];
  recent: ClickEvent[];
}

export function getClickTracking(channelId: string, days = 30): ClickTrackingReport {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  const total = (db.prepare(
    "SELECT COUNT(*) as n FROM analytics_events WHERE channel_id = ? AND created_at >= ? AND event_type = 'click'"
  ).get(channelId, since) as { n: number }).n;

  // Target from event_data.target (e.g. 'subscribe-button', 'description-link')
  const byTargetRaw = db.prepare(
    "SELECT COALESCE(json_extract(event_data, '$.target'), 'unknown') as target, COUNT(*) as clicks " +
    "FROM analytics_events WHERE channel_id = ? AND created_at >= ? AND event_type = 'click' GROUP BY target ORDER BY clicks DESC LIMIT 30"
  ).all(channelId, since) as { target: string; clicks: number }[];

  const byTarget = byTargetRaw.map((r) => ({ ...r, percent: total > 0 ? r.clicks / total : 0 }));

  const byVideo = db.prepare(
    "SELECT video_id, COUNT(*) as clicks FROM analytics_events " +
    "WHERE channel_id = ? AND created_at >= ? AND event_type = 'click' AND video_id IS NOT NULL " +
    "GROUP BY video_id ORDER BY clicks DESC LIMIT 30"
  ).all(channelId, since) as { video_id: string; clicks: number }[];

  const recent = db.prepare(
    "SELECT id, user_id, session_id, event_data, created_at FROM analytics_events " +
    "WHERE channel_id = ? AND created_at >= ? AND event_type = 'click' ORDER BY created_at DESC LIMIT 50"
  ).all(channelId, since).map((r: any) => ({ ...r, event_data: safeParse(r.event_data) })) as ClickEvent[];

  return { total_clicks: total, by_target: byTarget, by_video: byVideo, recent };
}

function safeParse(s: any): any {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return s; }
}

// ============ 26.16 — Scroll Depth Analysis ============

export interface ScrollDepthBucket {
  depth_bucket: string;  // '0-10%', '10-20%', ...
  sessions: number;
  percent: number;
}

export interface ScrollDepthReport {
  total_sessions: number;
  avg_max_depth: number;
  buckets: ScrollDepthBucket[];
  reached_bottom_rate: number;
}

export function getScrollDepth(channelId: string, days = 30): ScrollDepthReport {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  const rows = db.prepare(
    "SELECT session_id, MAX(CAST(json_extract(event_data, '$.depth') AS REAL)) as max_depth " +
    "FROM analytics_events WHERE channel_id = ? AND created_at >= ? AND session_id IS NOT NULL AND event_type = 'scroll' " +
    "GROUP BY session_id"
  ).all(channelId, since) as { session_id: string; max_depth: number }[];

  const total = rows.length;
  const buckets = Array.from({ length: 10 }, (_, i) => ({
    depth_bucket: `${i * 10}-${(i + 1) * 10}%`,
    sessions: 0,
    percent: 0,
  }));

  let sum = 0;
  let bottomCount = 0;
  for (const r of rows) {
    const d = Math.max(0, Math.min(100, r.max_depth ?? 0));
    sum += d;
    if (d >= 90) bottomCount++;
    const idx = Math.min(9, Math.floor(d / 10));
    buckets[idx].sessions++;
  }
  for (const b of buckets) b.percent = total > 0 ? b.sessions / total : 0;

  return {
    total_sessions: total,
    avg_max_depth: total > 0 ? sum / total : 0,
    buckets,
    reached_bottom_rate: total > 0 ? bottomCount / total : 0,
  };
}

// ============ 26.17 — Session Recording ============

export interface SessionEvent {
  id: string;
  event_type: string;
  event_data: any;
  video_id: string | null;
  created_at: string;
}

export interface SessionTimeline {
  session_id: string;
  user_id: string | null;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  events: SessionEvent[];
  videos_watched: number;
  total_watch_seconds: number;
}

export function getSessionTimeline(sessionId: string): SessionTimeline | null {
  const db = getDb();
  const events = db.prepare(
    "SELECT id, event_type, event_data, video_id, user_id, created_at FROM analytics_events " +
    "WHERE session_id = ? ORDER BY created_at ASC"
  ).all(sessionId) as any[];

  if (events.length === 0) return null;

  const startedAt = events[0].created_at;
  const endedAt = events[events.length - 1].created_at;
  const duration = (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000;

  const videosWatched = new Set(events.filter((e) => e.video_id).map((e) => e.video_id)).size;

  const totalWatch = events
    .filter((e) => e.event_type === 'progress')
    .reduce((s, e) => Math.max(s, safeParse(e.event_data)?.time ?? 0), 0);

  return {
    session_id: sessionId,
    user_id: events[0].user_id,
    started_at: startedAt,
    ended_at: endedAt,
    duration_seconds: duration,
    events: events.map((e) => ({
      id: e.id,
      event_type: e.event_type,
      event_data: safeParse(e.event_data),
      video_id: e.video_id,
      created_at: e.created_at,
    })),
    videos_watched: videosWatched,
    total_watch_seconds: totalWatch,
  };
}

// ============ 26.18 — Heatmap Analysis ============

export interface HeatmapCell {
  bucket_start_seconds: number;
  bucket_end_seconds: number;
  views: number;
  clicks: number;
  avg_intensity: number;  // 0..100 normalized
}

export interface HeatmapReport {
  cells: HeatmapCell[];
  bucket_size_seconds: number;
  total_video_seconds: number;
  peak_bucket_start: number;
  peak_intensity: number;
}

export function getHeatmap(
  channelId: string,
  videoId: string,
  videoDurationSeconds: number,
  bucketSizeSeconds = 15,
  days = 30,
): HeatmapReport {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const size = Math.max(5, Math.min(60, bucketSizeSeconds));
  const bucketCount = Math.max(1, Math.ceil(videoDurationSeconds / size));

  const cells: HeatmapCell[] = Array.from({ length: bucketCount }, (_, i) => ({
    bucket_start_seconds: i * size,
    bucket_end_seconds: Math.min((i + 1) * size, videoDurationSeconds),
    views: 0,
    clicks: 0,
    avg_intensity: 0,
  }));

  // Count view progress events by time bucket
  const progressRows = db.prepare(
    "SELECT CAST(json_extract(event_data, '$.time') AS REAL) as t, 1 as cnt " +
    "FROM analytics_events WHERE channel_id = ? AND video_id = ? AND created_at >= ? AND event_type = 'progress'"
  ).all(channelId, videoId, since) as { t: number; cnt: number }[];

  for (const r of progressRows) {
    const t = Math.max(0, r.t ?? 0);
    const idx = Math.min(bucketCount - 1, Math.floor(t / size));
    cells[idx].views += r.cnt;
  }

  const clicks = db.prepare(
    "SELECT CAST(json_extract(event_data, '$.time') AS REAL) as t, COUNT(*) as cnt " +
    "FROM analytics_events WHERE channel_id = ? AND video_id = ? AND created_at >= ? AND event_type = 'click' " +
    "GROUP BY CAST(json_extract(event_data, '$.time') / ? AS INTEGER)"
  ).all(channelId, videoId, since, size) as { t: number; cnt: number }[];

  for (const c of clicks) {
    const t = Math.max(0, c.t ?? 0);
    const idx = Math.min(bucketCount - 1, Math.floor(t / size));
    cells[idx].clicks += c.cnt;
  }

  // Normalize intensity
  const maxViews = Math.max(...cells.map((c) => c.views + c.clicks * 3), 1);
  let peak = cells[0];
  for (const c of cells) {
    c.avg_intensity = ((c.views + c.clicks * 3) / maxViews) * 100;
    if (c.avg_intensity > (peak?.avg_intensity ?? 0)) peak = c;
  }

  return {
    cells,
    bucket_size_seconds: size,
    total_video_seconds: videoDurationSeconds,
    peak_bucket_start: peak?.bucket_start_seconds ?? 0,
    peak_intensity: peak?.avg_intensity ?? 0,
  };
}

// ============ Helper: Recent sessions list ============

export interface SessionSummary {
  session_id: string;
  user_id: string | null;
  started_at: string;
  ended_at: string;
  event_count: number;
  videos_watched: number;
}

export function listRecentSessions(channelId: string, days = 7, limit = 50): SessionSummary[] {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const rows = db.prepare(
    "SELECT session_id, MAX(user_id) as user_id, MIN(created_at) as started_at, MAX(created_at) as ended_at, " +
    "COUNT(*) as event_count, COUNT(DISTINCT video_id) as videos_watched " +
    "FROM analytics_events WHERE channel_id = ? AND created_at >= ? AND session_id IS NOT NULL " +
    "GROUP BY session_id ORDER BY started_at DESC LIMIT ?"
  ).all(channelId, since, Math.max(1, Math.min(500, limit))) as SessionSummary[];
  return rows;
}

// ============ 26.5 — Report Export (CSV / JSON) ============

export type ExportFormat = 'csv' | 'json';
export type ExportReportType =
  | 'overview' | 'demographics' | 'traffic' | 'revenue'
  | 'completion' | 'rewatch' | 'dropoff' | 'click' | 'scroll'
  | 'cohort' | 'funnel' | 'churn' | 'ltv' | 'predictive';

function csvEscape(v: any): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(rows: Record<string, any>[]): string {
  if (rows.length === 0) return '';
  const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const head = headers.join(',');
  const body = rows.map((r) => headers.map((h) => csvEscape(r[h])).join(',')).join('\n');
  return head + '\n' + body;
}

export interface ExportResult {
  content: string;
  mime: string;
  filename: string;
}

export function exportReport(
  reportType: ExportReportType,
  channelId: string,
  format: ExportFormat = 'csv',
  days = 30,
): ExportResult {
  let rows: Record<string, any>[] = [];
  let baseName = `${reportType}-${channelId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}`;

  switch (reportType) {
    case 'demographics': {
      const d = getDemographics(channelId, days);
      rows = [
        ...d.by_country.map((x) => ({ dimension: 'country', key: x.key, count: x.count, percent: x.percent.toFixed(4) })),
        ...d.by_language.map((x) => ({ dimension: 'language', key: x.key, count: x.count, percent: x.percent.toFixed(4) })),
        ...d.by_device.map((x) => ({ dimension: 'device', key: x.key, count: x.count, percent: x.percent.toFixed(4) })),
        ...d.by_browser.map((x) => ({ dimension: 'browser', key: x.key, count: x.count, percent: x.percent.toFixed(4) })),
        ...d.by_age_group.map((x) => ({ dimension: 'age_group', key: x.key, count: x.count, percent: x.percent.toFixed(4) })),
        ...d.by_gender.map((x) => ({ dimension: 'gender', key: x.key, count: x.count, percent: x.percent.toFixed(4) })),
        ...d.by_referrer.map((x) => ({ dimension: 'referrer', key: x.key, count: x.count, percent: x.percent.toFixed(4) })),
      ];
      break;
    }

    case 'traffic': {
      const t = getTrafficSources(channelId, days);
      rows = t.sources.map((s) => ({ source: s.source, visits: s.visits, percent: s.percent.toFixed(4) }));
      break;
    }

    case 'revenue': {
      const r = getRevenueReport(channelId, days);
      rows = r.by_day.map((p) => ({ day: p.day, views: p.views, revenue: p.revenue.toFixed(2), rpm: p.rpm.toFixed(4) }));
      break;
    }

    case 'completion': {
      const c = getCompletionRate(channelId, days);
      rows = c.by_video.map((v) => ({ video_id: v.video_id, title: v.title ?? '', starts: v.starts, completions: v.completions, rate: v.rate.toFixed(4) }));
      break;
    }

    case 'rewatch': {
      const r = getRewatchAnalytics(channelId, days);
      rows = r.top_rewatched.map((v) => ({ video_id: v.video_id, title: v.title ?? '', rewatches: v.rewatches, unique_viewers: v.unique_viewers }));
      break;
    }

    case 'dropoff': {
      const d = getDropOffPoints(channelId, days);
      rows = d.buckets.map((b) => ({ bucket: b.percent_bucket, drops: b.drops, percent_of_total: b.percent_of_total.toFixed(4) }));
      break;
    }

    case 'click': {
      const c = getClickTracking(channelId, days);
      rows = c.by_target.map((t) => ({ target: t.target, clicks: t.clicks, percent: t.percent.toFixed(4) }));
      break;
    }

    case 'scroll': {
      const s = getScrollDepth(channelId, days);
      rows = s.buckets.map((b) => ({ bucket: b.depth_bucket, sessions: b.sessions, percent: b.percent.toFixed(4) }));
      break;
    }

    case 'cohort': {
      const c = getCohortAnalysis(channelId, 12);
      rows = c.cohorts.map((r) => ({
        cohort_month: r.cohort_month,
        users: r.users,
        ...r.periods.reduce((acc: any, p, i) => { acc[`m${i}`] = p.toFixed(4); return acc; }, {}),
      }));
      break;
    }

    case 'funnel': {
      const f = getFunnelAnalysis(channelId, days);
      rows = f.steps.map((s) => ({ step: s.step, label: s.label, count: s.count, drop_from_prev: s.drop_from_prev, conversion: s.conversion_from_start.toFixed(4) }));
      break;
    }

    case 'churn': {
      const c = getChurnRate(channelId, 90);
      rows = c.monthly_series.map((m) => ({ month: m.month, churned: m.churned, new: m.new, net: m.net }));
      break;
    }

    case 'ltv': {
      const l = getLifetimeValue(channelId, 12);
      rows = l.by_cohort.map((c) => ({ cohort_month: c.cohort_month, users: c.users, avg_ltv: c.avg_ltv.toFixed(2), total_ltv: c.total_ltv.toFixed(2) }));
      break;
    }

    case 'predictive': {
      const p = getPredictiveAnalytics(channelId, 30);
      rows = p.next_7_days.map((d) => ({ day: d.day, predicted_views: d.predicted_views, predicted_revenue: d.predicted_revenue.toFixed(2) }));
      break;
    }

    case 'overview':
    default: {
      const r = getRevenueReport(channelId, days);
      const d = getDemographics(channelId, days);
      const c = getCompletionRate(channelId, days);
      rows = [
        { metric: 'total_views', value: r.total_views },
        { metric: 'total_revenue', value: r.total_revenue.toFixed(2) },
        { metric: 'rpm', value: r.rpm.toFixed(4) },
        { metric: 'unique_viewers', value: d.unique_viewers },
        { metric: 'total_events', value: d.total_events },
        { metric: 'completion_rate', value: c.overall_completion_rate.toFixed(4) },
      ];
      baseName = `overview-${channelId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}`;
      break;
    }
  }

  if (format === 'json') {
    return {
      content: JSON.stringify({ report: reportType, channel_id: channelId, generated_at: new Date().toISOString(), data: rows }, null, 2),
      mime: 'application/json; charset=utf-8',
      filename: `${baseName}.json`,
    };
  }

  return {
    content: toCsv(rows),
    mime: 'text/csv; charset=utf-8',
    filename: `${baseName}.csv`,
  };
}
