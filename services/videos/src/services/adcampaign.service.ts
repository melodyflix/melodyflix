// melodyflix videos - ad campaigns (51.4 - 51.23)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type AdFormat = 'banner' | 'overlay' | 'pre-roll' | 'mid-roll' | 'post-roll' | 'native' | 'sponsored-card';
export type AdStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'active' | 'paused' | 'completed' | 'archived';
export type TargetingGender = 'any' | 'male' | 'female' | 'other';

export interface AdCampaign {
  id: string;
  name: string;
  advertiser: string;
  format: AdFormat;
  // Creative
  creative_url: string;
  click_url: string;
  thumbnail_url: string | null;
  cta_text: string | null;
  // Targeting (51.9)
  target_countries: string;      // JSON array
  target_languages: string;      // JSON array
  target_age_min: number;
  target_age_max: number;
  target_gender: TargetingGender;
  target_interests: string;      // JSON array
  target_categories: string;     // JSON array (video categories)
  // Scheduling (51.10)
  starts_at: string | null;
  ends_at: string | null;
  // Frequency (51.8)
  freq_cap_per_user: number;     // max impressions per user
  freq_cap_window_hours: number; // window for cap
  freq_cap_per_session: number;
  // Ads behavior
  is_skippable: number;          // 0 = non-skippable (51.7)
  skip_after_seconds: number;
  duration_seconds: number;
  // Podding (51.18)
  pod_id: string | null;
  // Consent (51.19)
  requires_consent: number;
  consent_scope: string;         // 'personalized' | 'non_personalized' | 'any'
  // Budget (51.21)
  budget_total: number;          // in credits/currency
  budget_spent: number;
  cpm: number;                   // cost per 1000 impressions
  cpc: number;                   // cost per click
  // Review (51.22)
  status: AdStatus;
  review_notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
  // Metrics (51.15)
  impression_count: number;
  click_count: number;
  view_count: number;            // video-ads watched to threshold
  completion_count: number;
  // Meta
  created_by: string;
  created_at: string;
  updated_at: string;
}

export const AD_FORMATS: { id: AdFormat; label: string; description: string }[] = [
  { id: 'banner', label: 'Banner', description: 'Top/bottom banner ad (51.4)' },
  { id: 'overlay', label: 'Overlay', description: 'Semi-transparent overlay on video (51.5)' },
  { id: 'pre-roll', label: 'Pre-roll Video', description: 'Plays before video' },
  { id: 'mid-roll', label: 'Mid-roll Video', description: 'Plays during video' },
  { id: 'post-roll', label: 'Post-roll Video', description: 'Plays after video' },
  { id: 'native', label: 'Native', description: 'In-feed sponsored card' },
  { id: 'sponsored-card', label: 'Sponsored Card', description: 'Sidebar card' },
];

export function ensureAdCampaignSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ad_pods (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      max_ads INTEGER NOT NULL DEFAULT 3,
      max_duration_seconds INTEGER NOT NULL DEFAULT 90,
      ad_break_type TEXT NOT NULL DEFAULT 'mid-roll',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ad_campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      advertiser TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'banner',
      creative_url TEXT NOT NULL,
      click_url TEXT NOT NULL,
      thumbnail_url TEXT,
      cta_text TEXT,
      target_countries TEXT NOT NULL DEFAULT '[]',
      target_languages TEXT NOT NULL DEFAULT '[]',
      target_age_min INTEGER NOT NULL DEFAULT 0,
      target_age_max INTEGER NOT NULL DEFAULT 120,
      target_gender TEXT NOT NULL DEFAULT 'any',
      target_interests TEXT NOT NULL DEFAULT '[]',
      target_categories TEXT NOT NULL DEFAULT '[]',
      starts_at TEXT,
      ends_at TEXT,
      freq_cap_per_user INTEGER NOT NULL DEFAULT 0,
      freq_cap_window_hours INTEGER NOT NULL DEFAULT 24,
      freq_cap_per_session INTEGER NOT NULL DEFAULT 0,
      is_skippable INTEGER NOT NULL DEFAULT 1,
      skip_after_seconds INTEGER NOT NULL DEFAULT 5,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      pod_id TEXT,
      requires_consent INTEGER NOT NULL DEFAULT 0,
      consent_scope TEXT NOT NULL DEFAULT 'any',
      budget_total REAL NOT NULL DEFAULT 0,
      budget_spent REAL NOT NULL DEFAULT 0,
      cpm REAL NOT NULL DEFAULT 0,
      cpc REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      review_notes TEXT,
      approved_by TEXT,
      approved_at TEXT,
      impression_count INTEGER NOT NULL DEFAULT 0,
      click_count INTEGER NOT NULL DEFAULT 0,
      view_count INTEGER NOT NULL DEFAULT 0,
      completion_count INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ad_campaigns_status ON ad_campaigns(status, format);
    CREATE INDEX IF NOT EXISTS idx_ad_campaigns_schedule ON ad_campaigns(starts_at, ends_at);

    CREATE TABLE IF NOT EXISTS ad_impressions (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      video_id TEXT,
      user_id TEXT,
      session_id TEXT,
      ip_hash TEXT,
      country TEXT,
      event_type TEXT NOT NULL DEFAULT 'impression',
      revenue REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ad_impressions_campaign ON ad_impressions(campaign_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ad_impressions_user ON ad_impressions(user_id, campaign_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS ad_user_consents (
      user_id TEXT PRIMARY KEY,
      personalized_allowed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ad_billing_ledger (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      entry_type TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ad_ledger_campaign ON ad_billing_ledger(campaign_id, created_at DESC);
  `);
}

// ============ Pods (51.18) ============

export interface AdPod {
  id: string;
  name: string;
  max_ads: number;
  max_duration_seconds: number;
  ad_break_type: string;
  created_at: string;
}

export function listPods(): AdPod[] {
  const db = getDb();
  return db.prepare('SELECT * FROM ad_pods ORDER BY created_at DESC').all() as AdPod[];
}

export function createPod(input: { name: string; max_ads?: number; max_duration_seconds?: number; ad_break_type?: string }): AdPod {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO ad_pods (id, name, max_ads, max_duration_seconds, ad_break_type, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    input.name.trim().slice(0, 100),
    Math.max(1, Math.min(10, input.max_ads ?? 3)),
    Math.max(15, Math.min(600, input.max_duration_seconds ?? 90)),
    input.ad_break_type ?? 'mid-roll',
    now,
  );
  return db.prepare('SELECT * FROM ad_pods WHERE id = ?').get(id) as AdPod;
}

export function deletePod(id: string): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM ad_pods WHERE id = ?').run(id);
  return res.changes > 0;
}

// ============ Campaigns (51.20) ============

export interface CampaignInput {
  name: string;
  advertiser: string;
  format: AdFormat;
  creative_url: string;
  click_url: string;
  thumbnail_url?: string | null;
  cta_text?: string | null;
  target_countries?: string[];
  target_languages?: string[];
  target_age_min?: number;
  target_age_max?: number;
  target_gender?: TargetingGender;
  target_interests?: string[];
  target_categories?: string[];
  starts_at?: string | null;
  ends_at?: string | null;
  freq_cap_per_user?: number;
  freq_cap_window_hours?: number;
  freq_cap_per_session?: number;
  is_skippable?: boolean;
  skip_after_seconds?: number;
  duration_seconds?: number;
  pod_id?: string | null;
  requires_consent?: boolean;
  consent_scope?: string;
  budget_total?: number;
  cpm?: number;
  cpc?: number;
}

export function createCampaign(input: CampaignInput, createdBy: string): AdCampaign {
  if (!input.name?.trim()) throw new Error('Name required');
  if (!input.advertiser?.trim()) throw new Error('Advertiser required');
  if (!input.creative_url?.trim()) throw new Error('Creative URL required');
  if (!input.click_url?.trim()) throw new Error('Click URL required');
  if (!AD_FORMATS.find((f) => f.id === input.format)) throw new Error('Unknown format');

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO ad_campaigns (
      id, name, advertiser, format, creative_url, click_url, thumbnail_url, cta_text,
      target_countries, target_languages, target_age_min, target_age_max, target_gender,
      target_interests, target_categories, starts_at, ends_at,
      freq_cap_per_user, freq_cap_window_hours, freq_cap_per_session,
      is_skippable, skip_after_seconds, duration_seconds, pod_id,
      requires_consent, consent_scope, budget_total, cpm, cpc,
      status, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name.trim().slice(0, 150),
    input.advertiser.trim().slice(0, 150),
    input.format,
    input.creative_url.slice(0, 500),
    input.click_url.slice(0, 500),
    input.thumbnail_url ? String(input.thumbnail_url).slice(0, 500) : null,
    input.cta_text ? String(input.cta_text).slice(0, 50) : null,
    JSON.stringify(input.target_countries ?? []),
    JSON.stringify(input.target_languages ?? []),
    Math.max(0, Math.min(120, input.target_age_min ?? 0)),
    Math.max(0, Math.min(120, input.target_age_max ?? 120)),
    input.target_gender ?? 'any',
    JSON.stringify(input.target_interests ?? []),
    JSON.stringify(input.target_categories ?? []),
    input.starts_at ?? null,
    input.ends_at ?? null,
    Math.max(0, input.freq_cap_per_user ?? 0),
    Math.max(1, Math.min(720, input.freq_cap_window_hours ?? 24)),
    Math.max(0, input.freq_cap_per_session ?? 0),
    input.is_skippable === false ? 0 : 1,
    Math.max(0, input.skip_after_seconds ?? 5),
    Math.max(0, input.duration_seconds ?? 0),
    input.pod_id ?? null,
    input.requires_consent ? 1 : 0,
    input.consent_scope ?? 'any',
    Math.max(0, input.budget_total ?? 0),
    Math.max(0, input.cpm ?? 0),
    Math.max(0, input.cpc ?? 0),
    'draft',
    createdBy,
    now, now,
  );
  return getCampaign(id)!;
}

export function getCampaign(id: string): AdCampaign | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM ad_campaigns WHERE id = ?').get(id) as AdCampaign) ?? null;
}

export function listCampaigns(filters: { status?: AdStatus; format?: AdFormat; advertiser?: string; limit?: number } = {}): AdCampaign[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: any[] = [];
  if (filters.status) { clauses.push('status = ?'); params.push(filters.status); }
  if (filters.format) { clauses.push('format = ?'); params.push(filters.format); }
  if (filters.advertiser) { clauses.push('advertiser LIKE ?'); params.push(`%${filters.advertiser}%`); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const limit = Math.max(1, Math.min(500, filters.limit ?? 100));
  return db.prepare(`SELECT * FROM ad_campaigns ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, limit) as AdCampaign[];
}

export function updateCampaign(id: string, patch: Partial<CampaignInput> & { status?: AdStatus; review_notes?: string | null }): AdCampaign {
  const db = getDb();
  const c = getCampaign(id);
  if (!c) throw new Error('Campaign not found');

  const now = new Date().toISOString();
  const json = (v: any, fallback: string) => v !== undefined ? JSON.stringify(v) : fallback;

  db.prepare(
    `UPDATE ad_campaigns SET
      name = ?, advertiser = ?, format = ?, creative_url = ?, click_url = ?,
      thumbnail_url = ?, cta_text = ?,
      target_countries = ?, target_languages = ?, target_age_min = ?, target_age_max = ?, target_gender = ?,
      target_interests = ?, target_categories = ?,
      starts_at = ?, ends_at = ?,
      freq_cap_per_user = ?, freq_cap_window_hours = ?, freq_cap_per_session = ?,
      is_skippable = ?, skip_after_seconds = ?, duration_seconds = ?, pod_id = ?,
      requires_consent = ?, consent_scope = ?,
      budget_total = ?, cpm = ?, cpc = ?,
      status = ?, review_notes = ?, updated_at = ?
      WHERE id = ?`
  ).run(
    patch.name?.trim().slice(0, 150) ?? c.name,
    patch.advertiser?.trim().slice(0, 150) ?? c.advertiser,
    patch.format ?? c.format,
    patch.creative_url?.slice(0, 500) ?? c.creative_url,
    patch.click_url?.slice(0, 500) ?? c.click_url,
    patch.thumbnail_url !== undefined ? (patch.thumbnail_url ? String(patch.thumbnail_url).slice(0, 500) : null) : c.thumbnail_url,
    patch.cta_text !== undefined ? (patch.cta_text ? String(patch.cta_text).slice(0, 50) : null) : c.cta_text,
    json(patch.target_countries, c.target_countries),
    json(patch.target_languages, c.target_languages),
    patch.target_age_min !== undefined ? Math.max(0, Math.min(120, patch.target_age_min)) : c.target_age_min,
    patch.target_age_max !== undefined ? Math.max(0, Math.min(120, patch.target_age_max)) : c.target_age_max,
    patch.target_gender ?? c.target_gender,
    json(patch.target_interests, c.target_interests),
    json(patch.target_categories, c.target_categories),
    patch.starts_at !== undefined ? patch.starts_at : c.starts_at,
    patch.ends_at !== undefined ? patch.ends_at : c.ends_at,
    patch.freq_cap_per_user !== undefined ? Math.max(0, patch.freq_cap_per_user) : c.freq_cap_per_user,
    patch.freq_cap_window_hours !== undefined ? Math.max(1, Math.min(720, patch.freq_cap_window_hours)) : c.freq_cap_window_hours,
    patch.freq_cap_per_session !== undefined ? Math.max(0, patch.freq_cap_per_session) : c.freq_cap_per_session,
    patch.is_skippable === undefined ? c.is_skippable : (patch.is_skippable ? 1 : 0),
    patch.skip_after_seconds !== undefined ? Math.max(0, patch.skip_after_seconds) : c.skip_after_seconds,
    patch.duration_seconds !== undefined ? Math.max(0, patch.duration_seconds) : c.duration_seconds,
    patch.pod_id !== undefined ? patch.pod_id : c.pod_id,
    patch.requires_consent === undefined ? c.requires_consent : (patch.requires_consent ? 1 : 0),
    patch.consent_scope ?? c.consent_scope,
    patch.budget_total !== undefined ? Math.max(0, patch.budget_total) : c.budget_total,
    patch.cpm !== undefined ? Math.max(0, patch.cpm) : c.cpm,
    patch.cpc !== undefined ? Math.max(0, patch.cpc) : c.cpc,
    patch.status ?? c.status,
    patch.review_notes !== undefined ? patch.review_notes : c.review_notes,
    now,
    id,
  );
  return getCampaign(id)!;
}

export function deleteCampaign(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM ad_impressions WHERE campaign_id = ?').run(id);
  db.prepare('DELETE FROM ad_billing_ledger WHERE campaign_id = ?').run(id);
  db.prepare('DELETE FROM ad_campaigns WHERE id = ?').run(id);
}

// ============ Approval workflow (51.22) ============

export function submitForReview(id: string): AdCampaign {
  return updateCampaign(id, { status: 'pending_review' });
}

export function approveCampaign(id: string, reviewerId: string): AdCampaign {
  const db = getDb();
  const c = getCampaign(id);
  if (!c) throw new Error('Campaign not found');
  const now = new Date().toISOString();
  db.prepare("UPDATE ad_campaigns SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?")
    .run(reviewerId, now, now, id);
  return getCampaign(id)!;
}

export function rejectCampaign(id: string, reviewerId: string, notes?: string): AdCampaign {
  const db = getDb();
  const c = getCampaign(id);
  if (!c) throw new Error('Campaign not found');
  const now = new Date().toISOString();
  db.prepare("UPDATE ad_campaigns SET status = 'rejected', approved_by = ?, approved_at = ?, review_notes = ?, updated_at = ? WHERE id = ?")
    .run(reviewerId, now, notes ?? null, now, id);
  return getCampaign(id)!;
}

export function setCampaignStatus(id: string, status: AdStatus): AdCampaign {
  return updateCampaign(id, { status });
}

// ============ Targeting + Eligibility (51.9, 51.10, 51.8, 51.19) ============

export interface TargetingContext {
  user_id?: string | null;
  session_id?: string | null;
  country?: string | null;
  language?: string | null;
  age?: number | null;
  gender?: TargetingGender | null;
  interests?: string[];
  video_category?: string | null;
  personalized_allowed?: boolean;
}

function safeJson<T = any>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

export function getUserConsent(userId: string): { personalized_allowed: number } {
  const db = getDb();
  const row = db.prepare('SELECT personalized_allowed FROM ad_user_consents WHERE user_id = ?').get(userId) as { personalized_allowed: number } | undefined;
  return row ?? { personalized_allowed: 0 };
}

export function setUserConsent(userId: string, personalizedAllowed: boolean): { personalized_allowed: number } {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO ad_user_consents (user_id, personalized_allowed, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(user_id) DO UPDATE SET personalized_allowed = excluded.personalized_allowed, updated_at = excluded.updated_at'
  ).run(userId, personalizedAllowed ? 1 : 0, now);
  return { personalized_allowed: personalizedAllowed ? 1 : 0 };
}

function passesTargeting(c: AdCampaign, ctx: TargetingContext): boolean {
  // Country
  const countries = safeJson<string[]>(c.target_countries, []);
  if (countries.length > 0 && ctx.country && !countries.includes(ctx.country)) return false;

  // Language
  const langs = safeJson<string[]>(c.target_languages, []);
  if (langs.length > 0 && ctx.language && !langs.includes(ctx.language)) return false;

  // Age
  if (typeof ctx.age === 'number') {
    if (ctx.age < c.target_age_min || ctx.age > c.target_age_max) return false;
  }

  // Gender
  if (c.target_gender !== 'any' && ctx.gender && ctx.gender !== c.target_gender) return false;

  // Interests (any match)
  const interests = safeJson<string[]>(c.target_interests, []);
  if (interests.length > 0) {
    const user = new Set(ctx.interests ?? []);
    if (!interests.some((i) => user.has(i))) return false;
  }

  // Video category
  const cats = safeJson<string[]>(c.target_categories, []);
  if (cats.length > 0 && ctx.video_category && !cats.includes(ctx.video_category)) return false;

  return true;
}

function passesSchedule(c: AdCampaign, now: Date = new Date()): boolean {
  if (c.starts_at && new Date(c.starts_at) > now) return false;
  if (c.ends_at && new Date(c.ends_at) < now) return false;
  return true;
}

function passesBudget(c: AdCampaign): boolean {
  if (c.budget_total > 0 && c.budget_spent >= c.budget_total) return false;
  return true;
}

function passesFrequency(c: AdCampaign, ctx: TargetingContext): boolean {
  const db = getDb();
  if (c.freq_cap_per_user > 0 && ctx.user_id) {
    const since = new Date(Date.now() - c.freq_cap_window_hours * 3600_000).toISOString();
    const n = (db.prepare(
      'SELECT COUNT(*) as n FROM ad_impressions WHERE campaign_id = ? AND user_id = ? AND created_at >= ?'
    ).get(c.id, ctx.user_id, since) as { n: number }).n;
    if (n >= c.freq_cap_per_user) return false;
  }
  if (c.freq_cap_per_session > 0 && ctx.session_id) {
    const n = (db.prepare(
      "SELECT COUNT(*) as n FROM ad_impressions WHERE campaign_id = ? AND session_id = ? AND event_type = 'impression'"
    ).get(c.id, ctx.session_id) as { n: number }).n;
    if (n >= c.freq_cap_per_session) return false;
  }
  return true;
}

function passesConsent(c: AdCampaign, ctx: TargetingContext): boolean {
  if (c.requires_consent !== 1) return true;
  if (c.consent_scope === 'non_personalized') return true; // always allowed
  // personalized: check user consent
  if (c.consent_scope === 'personalized') {
    return !!ctx.personalized_allowed;
  }
  // 'any' -> pass either way
  return true;
}

// ============ Ad Selection (51.7) ============

export interface AdSelection {
  campaign: AdCampaign;
  pod: AdPod | null;
  score: number;
}

export function selectAds(
  ctx: TargetingContext,
  format: AdFormat | 'pre-roll' | 'mid-roll' | 'post-roll' | 'banner' | 'overlay',
  limit = 1,
): AdSelection[] {
  const db = getDb();
  const candidates = db.prepare(
    "SELECT * FROM ad_campaigns WHERE status = 'approved' AND format = ? ORDER BY cpm DESC LIMIT 200"
  ).all(format) as AdCampaign[];

  const eligible = candidates.filter((c) =>
    passesSchedule(c) && passesBudget(c) && passesTargeting(c, ctx) &&
    passesFrequency(c, ctx) && passesConsent(c, ctx)
  );

  // Score: higher CPM → higher chance; slight penalty if non-skippable for better UX tie-break
  eligible.sort((a, b) => (b.cpm + b.cpc * 0.1) - (a.cpm + a.cpc * 0.1));

  return eligible.slice(0, Math.max(1, Math.min(10, limit))).map((c) => {
    const pod = c.pod_id ? (db.prepare('SELECT * FROM ad_pods WHERE id = ?').get(c.pod_id) as AdPod | undefined) ?? null : null;
    return { campaign: c, pod, score: c.cpm };
  });
}

// ============ Impression / Click Tracking (51.15) ============

export interface TrackInput {
  campaign_id: string;
  event_type: 'impression' | 'click' | 'view' | 'completion' | 'skip';
  video_id?: string | null;
  user_id?: string | null;
  session_id?: string | null;
  ip_hash?: string | null;
  country?: string | null;
}

export function trackAdEvent(input: TrackInput): { ok: boolean; revenue: number } {
  const db = getDb();
  const c = getCampaign(input.campaign_id);
  if (!c) throw new Error('Campaign not found');

  // Compute revenue
  let revenue = 0;
  if (input.event_type === 'impression') revenue = c.cpm / 1000;
  else if (input.event_type === 'click') revenue = c.cpc;

  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO ad_impressions (id, campaign_id, video_id, user_id, session_id, ip_hash, country, event_type, revenue, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id, input.campaign_id, input.video_id ?? null, input.user_id ?? null,
    input.session_id ?? null, input.ip_hash ?? null, input.country ?? null,
    input.event_type, revenue, now,
  );

  // Update counters + budget
  const counters: Record<string, string> = {
    impression: 'impression_count = impression_count + 1',
    click: 'click_count = click_count + 1',
    view: 'view_count = view_count + 1',
    completion: 'completion_count = completion_count + 1',
  };
  if (counters[input.event_type]) {
    db.prepare(`UPDATE ad_campaigns SET ${counters[input.event_type]}, budget_spent = budget_spent + ?, updated_at = ? WHERE id = ?`)
      .run(revenue, now, input.campaign_id);
  }

  if (revenue > 0) {
    db.prepare(
      'INSERT INTO ad_billing_ledger (id, campaign_id, entry_type, amount, note, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(randomUUID(), input.campaign_id, input.event_type, revenue, null, now);
  }

  // Auto-complete campaign if budget exhausted
  const fresh = getCampaign(input.campaign_id);
  if (fresh && fresh.budget_total > 0 && fresh.budget_spent >= fresh.budget_total && fresh.status === 'active') {
    db.prepare("UPDATE ad_campaigns SET status = 'completed', updated_at = ? WHERE id = ?").run(now, input.campaign_id);
  }

  return { ok: true, revenue };
}

// ============ Analytics (51.15) ============

export interface CampaignAnalytics {
  campaign_id: string;
  impressions: number;
  clicks: number;
  views: number;
  completions: number;
  ctr: number;
  view_rate: number;
  completion_rate: number;
  revenue: number;
  budget_remaining: number;
  avg_cpm_effective: number;
}

export function getCampaignAnalytics(id: string): CampaignAnalytics {
  const db = getDb();
  const c = getCampaign(id);
  if (!c) throw new Error('Campaign not found');

  const row = db.prepare(
    "SELECT " +
    "SUM(CASE WHEN event_type='impression' THEN 1 ELSE 0 END) as impressions, " +
    "SUM(CASE WHEN event_type='click' THEN 1 ELSE 0 END) as clicks, " +
    "SUM(CASE WHEN event_type='view' THEN 1 ELSE 0 END) as views, " +
    "SUM(CASE WHEN event_type='completion' THEN 1 ELSE 0 END) as completions, " +
    "COALESCE(SUM(revenue), 0) as revenue " +
    "FROM ad_impressions WHERE campaign_id = ?"
  ).get(id) as any;

  const imp = row?.impressions ?? 0;
  const clk = row?.clicks ?? 0;
  const vw = row?.views ?? 0;
  const cm = row?.completions ?? 0;
  const rev = row?.revenue ?? 0;

  return {
    campaign_id: id,
    impressions: imp,
    clicks: clk,
    views: vw,
    completions: cm,
    ctr: imp > 0 ? clk / imp : 0,
    view_rate: imp > 0 ? vw / imp : 0,
    completion_rate: vw > 0 ? cm / vw : 0,
    revenue: rev,
    budget_remaining: Math.max(0, c.budget_total - c.budget_spent),
    avg_cpm_effective: imp > 0 ? (rev / imp) * 1000 : 0,
  };
}

export interface DailySeriesPoint {
  day: string;
  impressions: number;
  clicks: number;
  revenue: number;
}

export function getCampaignDaily(id: string, days = 30): DailySeriesPoint[] {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const rows = db.prepare(
    "SELECT substr(created_at, 1, 10) as day, " +
    "SUM(CASE WHEN event_type='impression' THEN 1 ELSE 0 END) as impressions, " +
    "SUM(CASE WHEN event_type='click' THEN 1 ELSE 0 END) as clicks, " +
    "COALESCE(SUM(revenue), 0) as revenue " +
    "FROM ad_impressions WHERE campaign_id = ? AND created_at >= ? " +
    "GROUP BY day ORDER BY day ASC"
  ).all(id, since) as DailySeriesPoint[];
  return rows;
}

// ============ Billing Report (51.23) ============

export interface BillingSummary {
  campaign_id: string;
  name: string;
  advertiser: string;
  budget_total: number;
  budget_spent: number;
  impressions: number;
  clicks: number;
  total_revenue: number;
  cpm_effective: number;
  cpc_effective: number;
}

export function getBillingReport(filters: { status?: AdStatus; advertiser?: string } = {}): BillingSummary[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: any[] = [];
  if (filters.status) { clauses.push('status = ?'); params.push(filters.status); }
  if (filters.advertiser) { clauses.push('advertiser LIKE ?'); params.push(`%${filters.advertiser}%`); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';

  const rows = db.prepare(
    "SELECT id, name, advertiser, budget_total, budget_spent, impression_count, click_count FROM ad_campaigns " + where +
    " ORDER BY created_at DESC LIMIT 500"
  ).all(...params) as any[];

  return rows.map((r) => {
    const rev = (db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM ad_billing_ledger WHERE campaign_id = ?')
      .get(r.id) as { total: number }).total;
    return {
      campaign_id: r.id,
      name: r.name,
      advertiser: r.advertiser,
      budget_total: r.budget_total,
      budget_spent: r.budget_spent,
      impressions: r.impression_count,
      clicks: r.click_count,
      total_revenue: rev,
      cpm_effective: r.impression_count > 0 ? (rev / r.impression_count) * 1000 : 0,
      cpc_effective: r.click_count > 0 ? rev / r.click_count : 0,
    };
  });
}

export interface BillingLedgerEntry {
  id: string;
  campaign_id: string;
  entry_type: string;
  amount: number;
  note: string | null;
  created_at: string;
}

export function getBillingLedger(campaignId: string, limit = 200): BillingLedgerEntry[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM ad_billing_ledger WHERE campaign_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(campaignId, Math.max(1, Math.min(1000, limit))) as BillingLedgerEntry[];
}
