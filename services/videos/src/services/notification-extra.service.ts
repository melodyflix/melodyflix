// melodyflix videos - Section 20 Notifications and Alerts (20.3/20.5-20.9)
// SMS gateway, per-user preferences, AI-based send-time prediction,
// personalized alerts, digests, and DND schedule.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type NotificationChannel = 'push' | 'email' | 'sms' | 'in_app';
export type AlertCategory = 'content' | 'social' | 'system' | 'security' | 'marketing' | 'creator' | 'learning';
export type DigestFrequency = 'hourly' | 'daily' | 'weekly' | 'never';
export type SmsProvider = 'twilio' | 'vonage' | 'messagebird' | 'custom';

export function ensureNotificationExtraSchema(): void {
  const db = getDb();
  db.exec(`
    -- 20.3 SMS
    CREATE TABLE IF NOT EXISTS sms_configs (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, sender_id TEXT,
      api_key_ref TEXT, enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sms_cfg_provider ON sms_configs(provider, enabled);

    CREATE TABLE IF NOT EXISTS sms_messages (
      id TEXT PRIMARY KEY, to_phone TEXT NOT NULL, body TEXT NOT NULL,
      provider TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
      external_id TEXT, error TEXT, sent_at TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sms_to ON sms_messages(to_phone, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sms_status ON sms_messages(status, created_at DESC);

    -- 20.5 Preferences per user per category per channel
    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      channel TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, category, channel)
    );
    CREATE INDEX IF NOT EXISTS idx_npref_user ON notification_preferences(user_id);

    -- 20.6 AI send-time prediction
    CREATE TABLE IF NOT EXISTS notification_send_times (
      user_id TEXT PRIMARY KEY,
      best_hours TEXT NOT NULL DEFAULT '[]',
      timezone TEXT,
      engagement_score REAL NOT NULL DEFAULT 0.5,
      sample_count INTEGER NOT NULL DEFAULT 0,
      last_computed_at TEXT,
      updated_at TEXT NOT NULL
    );

    -- 20.7 Personalized alerts
    CREATE TABLE IF NOT EXISTS personalized_alerts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      kind TEXT NOT NULL,
      target_id TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 5,
      seen INTEGER NOT NULL DEFAULT 0,
      dismissed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pa_user ON personalized_alerts(user_id, seen, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pa_cat ON personalized_alerts(user_id, category, created_at DESC);

    -- 20.8 Digest subscriptions + queue
    CREATE TABLE IF NOT EXISTS digest_subscriptions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, frequency TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'email', categories TEXT NOT NULL DEFAULT '[]',
      last_sent_at TEXT, next_send_at TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_digest_user ON digest_subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_digest_next ON digest_subscriptions(enabled, next_send_at);

    CREATE TABLE IF NOT EXISTS digest_runs (
      id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL, user_id TEXT NOT NULL,
      sent_at TEXT NOT NULL, item_count INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_digest_run_sub ON digest_runs(subscription_id, sent_at DESC);

    -- 20.9 DND
    CREATE TABLE IF NOT EXISTS dnd_schedules (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT,
      start_minute INTEGER NOT NULL, end_minute INTEGER NOT NULL,
      days_of_week TEXT NOT NULL DEFAULT '[]',
      timezone TEXT, allow_categories TEXT NOT NULL DEFAULT '["security"]',
      enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dnd_user ON dnd_schedules(user_id, enabled);
  `);
}

// ================= 20.3 SMS =================
export interface SmsConfig {
  id: string; provider: SmsProvider; sender_id: string | null;
  api_key_ref: string | null; enabled: number;
  created_at: string; updated_at: string;
}

export function upsertSmsConfig(provider: SmsProvider, senderId?: string | null, apiKeyRef?: string | null, enabled = true): SmsConfig {
  if (!['twilio','vonage','messagebird','custom'].includes(provider)) throw new Error('invalid_provider');
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM sms_configs WHERE provider = ?').get(provider) as SmsConfig | undefined;
  if (existing) {
    db.prepare('UPDATE sms_configs SET sender_id = ?, api_key_ref = ?, enabled = ?, updated_at = ? WHERE id = ?')
      .run(senderId ?? null, apiKeyRef ?? null, enabled ? 1 : 0, now, existing.id);
    return db.prepare('SELECT * FROM sms_configs WHERE id = ?').get(existing.id) as SmsConfig;
  }
  const id = randomUUID();
  db.prepare(`INSERT INTO sms_configs (id, provider, sender_id, api_key_ref, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, provider, senderId ?? null, apiKeyRef ?? null, enabled ? 1 : 0, now, now);
  return db.prepare('SELECT * FROM sms_configs WHERE id = ?').get(id) as SmsConfig;
}

export function listSmsConfigs(): SmsConfig[] {
  return getDb().prepare('SELECT * FROM sms_configs ORDER BY provider').all() as SmsConfig[];
}

export interface SendSmsInput {
  to_phone: string;
  body: string;
  provider?: SmsProvider;
}

export interface SmsMessage {
  id: string; to_phone: string; body: string; provider: string; status: string;
  external_id: string | null; error: string | null; sent_at: string | null; created_at: string;
}

export function sendSms(input: SendSmsInput): SmsMessage {
  if (!input.to_phone || input.to_phone.length > 40) throw new Error('invalid_phone');
  if (!input.body || input.body.length > 1600) throw new Error('invalid_body');
  const db = getDb();
  const provider = input.provider ?? (db.prepare('SELECT provider FROM sms_configs WHERE enabled = 1 LIMIT 1')
    .get() as { provider: string } | undefined)?.provider;
  if (!provider) throw new Error('no_sms_provider');
  const id = randomUUID();
  const now = new Date().toISOString();
  // Stub transport: mark queued; a real worker would call provider API
  db.prepare(`INSERT INTO sms_messages (id, to_phone, body, provider, status, created_at)
    VALUES (?, ?, ?, ?, 'queued', ?)`).run(id, input.to_phone, input.body, provider, now);
  return db.prepare('SELECT * FROM sms_messages WHERE id = ?').get(id) as SmsMessage;
}

export function markSmsSent(id: string, externalId?: string): SmsMessage | null {
  const db = getDb();
  const m = db.prepare('SELECT * FROM sms_messages WHERE id = ?').get(id) as SmsMessage | undefined;
  if (!m) return null;
  const now = new Date().toISOString();
  db.prepare('UPDATE sms_messages SET status = ?, external_id = ?, sent_at = ? WHERE id = ?')
    .run('sent', externalId ?? null, now, id);
  return db.prepare('SELECT * FROM sms_messages WHERE id = ?').get(id) as SmsMessage;
}

export function markSmsFailed(id: string, error: string): SmsMessage | null {
  const db = getDb();
  const m = db.prepare('SELECT * FROM sms_messages WHERE id = ?').get(id) as SmsMessage | undefined;
  if (!m) return null;
  db.prepare('UPDATE sms_messages SET status = ?, error = ? WHERE id = ?').run('failed', error, id);
  return db.prepare('SELECT * FROM sms_messages WHERE id = ?').get(id) as SmsMessage;
}

export function listSms(filter?: { to_phone?: string; status?: string; limit?: number }): SmsMessage[] {
  const db = getDb();
  const where: string[] = []; const args: any[] = [];
  if (filter?.to_phone) { where.push('to_phone = ?'); args.push(filter.to_phone); }
  if (filter?.status) { where.push('status = ?'); args.push(filter.status); }
  const sql = `SELECT * FROM sms_messages ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args) as SmsMessage[];
}

// ================= 20.5 Preferences =================
export interface PreferenceRow {
  user_id: string; category: AlertCategory; channel: NotificationChannel;
  enabled: number; updated_at: string;
}

const ALL_CATEGORIES: AlertCategory[] = ['content','social','system','security','marketing','creator','learning'];
const ALL_CHANNELS: NotificationChannel[] = ['push','email','sms','in_app'];

export function setPreference(userId: string, category: AlertCategory, channel: NotificationChannel, enabled: boolean): PreferenceRow {
  if (!ALL_CATEGORIES.includes(category)) throw new Error('invalid_category');
  if (!ALL_CHANNELS.includes(channel)) throw new Error('invalid_channel');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO notification_preferences (user_id, category, channel, enabled, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, category, channel) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`)
    .run(userId, category, channel, enabled ? 1 : 0, now);
  return db.prepare('SELECT * FROM notification_preferences WHERE user_id = ? AND category = ? AND channel = ?')
    .get(userId, category, channel) as PreferenceRow;
}

export function getPreferences(userId: string): PreferenceRow[] {
  return getDb().prepare('SELECT * FROM notification_preferences WHERE user_id = ? ORDER BY category, channel')
    .all(userId) as PreferenceRow[];
}

export function getEffectivePreferences(userId: string): Record<string, Record<string, boolean>> {
  const rows = getPreferences(userId);
  const out: Record<string, Record<string, boolean>> = {};
  for (const c of ALL_CATEGORIES) {
    out[c] = {};
    for (const ch of ALL_CHANNELS) {
      const r = rows.find(x => x.category === c && x.channel === ch);
      // security default opt-in across all channels
      const def = c === 'security' ? true : (ch === 'push' || ch === 'in_app');
      out[c][ch] = r ? r.enabled === 1 : def;
    }
  }
  return out;
}

export function isChannelAllowed(userId: string, category: AlertCategory, channel: NotificationChannel): boolean {
  const prefs = getEffectivePreferences(userId);
  return !!prefs[category]?.[channel];
}

// ================= 20.6 AI-Based Timing =================
export interface SendTimePrediction {
  user_id: string; best_hours: string; timezone: string | null;
  engagement_score: number; sample_count: number;
  last_computed_at: string | null; updated_at: string;
}

export interface EngagementSample {
  user_id: string;
  hour_local: number; // 0-23
  engaged: boolean;
}

export function recordEngagementAndRecompute(samples: EngagementSample[]): SendTimePrediction[] {
  const db = getDb();
  const byUser = new Map<string, { hour: number; engaged: boolean }[]>();
  for (const s of samples) {
    if (s.hour_local < 0 || s.hour_local > 23) continue;
    if (!byUser.has(s.user_id)) byUser.set(s.user_id, []);
    byUser.get(s.user_id)!.push({ hour: s.hour_local, engaged: s.engaged });
  }
  const out: SendTimePrediction[] = [];
  for (const [userId, arr] of byUser) {
    // Count engagement per hour; pick top-3 hours
    const buckets: Record<number, { eng: number; total: number }> = {};
    for (let h = 0; h < 24; h++) buckets[h] = { eng: 0, total: 0 };
    for (const s of arr) {
      buckets[s.hour].total++;
      if (s.engaged) buckets[s.hour].eng++;
    }
    const scored = Object.entries(buckets).map(([h, v]) => ({ h: Number(h), rate: v.total ? v.eng / v.total : 0, total: v.total }));
    scored.sort((a, b) => b.rate - a.rate || b.total - a.total);
    const topHours = scored.slice(0, 3).filter(s => s.total > 0).map(s => s.h);
    const totalEng = arr.filter(s => s.engaged).length;
    const engagement = arr.length ? totalEng / arr.length : 0.5;
    out.push(upsertSendTime(userId, topHours, engagement, arr.length));
  }
  return out;
}

export function upsertSendTime(userId: string, bestHours: number[], engagementScore: number, sampleCount: number, timezone?: string | null): SendTimePrediction {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM notification_send_times WHERE user_id = ?').get(userId) as SendTimePrediction | undefined;
  if (existing) {
    db.prepare(`UPDATE notification_send_times SET best_hours = ?, engagement_score = ?, sample_count = ?,
      timezone = COALESCE(?, timezone), last_computed_at = ?, updated_at = ? WHERE user_id = ?`)
      .run(JSON.stringify(bestHours), engagementScore, sampleCount, timezone ?? null, now, now, userId);
  } else {
    db.prepare(`INSERT INTO notification_send_times (user_id, best_hours, timezone, engagement_score, sample_count, last_computed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(userId, JSON.stringify(bestHours), timezone ?? null,
      engagementScore, sampleCount, now, now);
  }
  return db.prepare('SELECT * FROM notification_send_times WHERE user_id = ?').get(userId) as SendTimePrediction;
}

export function getSendTime(userId: string): SendTimePrediction | null {
  return (getDb().prepare('SELECT * FROM notification_send_times WHERE user_id = ?').get(userId) as SendTimePrediction | undefined) ?? null;
}

export function nextBestSendAt(userId: string, from: Date = new Date()): string {
  const p = getSendTime(userId);
  if (!p) return from.toISOString();
  const hours = JSON.parse(p.best_hours) as number[];
  if (!hours.length) return from.toISOString();
  // find next hour in list within 24h
  const cur = from.getHours();
  const upcoming = hours.map(h => (h > cur ? h : h + 24)).sort((a, b) => a - b)[0];
  const delta = upcoming - cur;
  const out = new Date(from);
  out.setHours(from.getHours() + delta, 0, 0, 0);
  return out.toISOString();
}

// ================= 20.7 Personalized Alerts =================
export interface PersonalizedAlert {
  id: string; user_id: string; category: AlertCategory; kind: string;
  target_id: string | null; title: string; body: string;
  priority: number; seen: number; dismissed: number;
  created_at: string; expires_at: string | null;
}

export interface CreateAlertInput {
  user_id: string; category: AlertCategory; kind: string;
  title: string; body: string;
  target_id?: string | null;
  priority?: number;
  expires_at?: string | null;
}

export function createPersonalizedAlert(input: CreateAlertInput): PersonalizedAlert {
  if (!ALL_CATEGORIES.includes(input.category)) throw new Error('invalid_category');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`INSERT INTO personalized_alerts
    (id, user_id, category, kind, target_id, title, body, priority, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.user_id, input.category, input.kind,
    input.target_id ?? null, input.title, input.body,
    Math.min(Math.max(input.priority ?? 5, 1), 10), now, input.expires_at ?? null);
  return db.prepare('SELECT * FROM personalized_alerts WHERE id = ?').get(id) as PersonalizedAlert;
}

export function listAlerts(userId: string, filter?: { unseenOnly?: boolean; category?: AlertCategory; limit?: number }): PersonalizedAlert[] {
  const db = getDb();
  const where: string[] = ['user_id = ?', 'dismissed = 0'];
  const args: any[] = [userId];
  if (filter?.unseenOnly) where.push('seen = 0');
  if (filter?.category) { where.push('category = ?'); args.push(filter.category); }
  // hide expired
  where.push('(expires_at IS NULL OR expires_at > ?)');
  args.push(new Date().toISOString());
  const sql = `SELECT * FROM personalized_alerts WHERE ${where.join(' AND ')}
    ORDER BY priority ASC, created_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args) as PersonalizedAlert[];
}

export function markAlertSeen(id: string): boolean {
  return getDb().prepare('UPDATE personalized_alerts SET seen = 1 WHERE id = ?').run(id).changes > 0;
}

export function dismissAlert(id: string): boolean {
  return getDb().prepare('UPDATE personalized_alerts SET dismissed = 1 WHERE id = ?').run(id).changes > 0;
}

// ================= 20.8 Digest =================
export interface DigestSubscription {
  id: string; user_id: string; frequency: DigestFrequency;
  channel: string; categories: string; last_sent_at: string | null;
  next_send_at: string; enabled: number; created_at: string; updated_at: string;
}

const FREQ_MS: Record<DigestFrequency, number> = {
  hourly: 3600_000, daily: 86400_000, weekly: 604800_000, never: 0,
};

export interface CreateDigestInput {
  user_id: string;
  frequency: DigestFrequency;
  channel?: 'email' | 'push' | 'sms';
  categories?: AlertCategory[];
}

export function upsertDigest(input: CreateDigestInput): DigestSubscription {
  if (!['hourly','daily','weekly','never'].includes(input.frequency)) throw new Error('invalid_frequency');
  const db = getDb();
  const now = new Date();
  const next = input.frequency === 'never'
    ? new Date(now.getTime() + 100 * 365 * 86400_000)
    : new Date(now.getTime() + FREQ_MS[input.frequency]);
  const nowIso = now.toISOString();
  const existing = db.prepare('SELECT * FROM digest_subscriptions WHERE user_id = ?').get(input.user_id) as DigestSubscription | undefined;
  if (existing) {
    db.prepare(`UPDATE digest_subscriptions SET frequency = ?, channel = ?, categories = ?,
      next_send_at = ?, updated_at = ? WHERE id = ?`)
      .run(input.frequency, input.channel ?? existing.channel,
        JSON.stringify(input.categories ?? JSON.parse(existing.categories)),
        next.toISOString(), nowIso, existing.id);
    return db.prepare('SELECT * FROM digest_subscriptions WHERE id = ?').get(existing.id) as DigestSubscription;
  }
  const id = randomUUID();
  db.prepare(`INSERT INTO digest_subscriptions
    (id, user_id, frequency, channel, categories, next_send_at, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(id, input.user_id, input.frequency,
    input.channel ?? 'email', JSON.stringify(input.categories ?? ALL_CATEGORIES),
    next.toISOString(), nowIso, nowIso);
  return db.prepare('SELECT * FROM digest_subscriptions WHERE id = ?').get(id) as DigestSubscription;
}

export function getDigest(userId: string): DigestSubscription | null {
  return (getDb().prepare('SELECT * FROM digest_subscriptions WHERE user_id = ?').get(userId) as DigestSubscription | undefined) ?? null;
}

export function listDueDigests(now = new Date().toISOString()): DigestSubscription[] {
  return getDb().prepare(`SELECT * FROM digest_subscriptions
    WHERE enabled = 1 AND frequency != 'never' AND next_send_at <= ?`).all(now) as DigestSubscription[];
}

export interface DigestRun {
  id: string; subscription_id: string; user_id: string;
  sent_at: string; item_count: number; payload: string;
}

export function runDigest(subscriptionId: string, now = new Date()): DigestRun {
  const db = getDb();
  const sub = db.prepare('SELECT * FROM digest_subscriptions WHERE id = ?').get(subscriptionId) as DigestSubscription | undefined;
  if (!sub) throw new Error('sub_not_found');
  if (!sub.enabled || sub.frequency === 'never') throw new Error('sub_disabled');
  const cats = JSON.parse(sub.categories) as string[];
  const since = sub.last_sent_at ?? new Date(Date.now() - FREQ_MS[sub.frequency]).toISOString();
  const placeholders = cats.map(() => '?').join(',');
  const items = cats.length ? db.prepare(`SELECT * FROM personalized_alerts
    WHERE user_id = ? AND category IN (${placeholders}) AND created_at > ? AND dismissed = 0
    ORDER BY priority ASC, created_at DESC LIMIT 100`).all(sub.user_id, ...cats, since) : [];
  const nowIso = now.toISOString();
  const runId = randomUUID();
  db.prepare(`INSERT INTO digest_runs (id, subscription_id, user_id, sent_at, item_count, payload)
    VALUES (?, ?, ?, ?, ?, ?)`).run(runId, sub.id, sub.user_id, nowIso, items.length, JSON.stringify(items));
  const next = new Date(now.getTime() + FREQ_MS[sub.frequency]);
  db.prepare('UPDATE digest_subscriptions SET last_sent_at = ?, next_send_at = ?, updated_at = ? WHERE id = ?')
    .run(nowIso, next.toISOString(), nowIso, sub.id);
  return db.prepare('SELECT * FROM digest_runs WHERE id = ?').get(runId) as DigestRun;
}

export function listDigestRuns(subscriptionId?: string, limit = 100): DigestRun[] {
  const db = getDb();
  if (subscriptionId) {
    return db.prepare('SELECT * FROM digest_runs WHERE subscription_id = ? ORDER BY sent_at DESC LIMIT ?')
      .all(subscriptionId, Math.min(Math.max(limit, 1), 500)) as DigestRun[];
  }
  return db.prepare('SELECT * FROM digest_runs ORDER BY sent_at DESC LIMIT ?')
    .all(Math.min(Math.max(limit, 1), 500)) as DigestRun[];
}

// ================= 20.9 DND =================
export interface DndSchedule {
  id: string; user_id: string; label: string | null;
  start_minute: number; end_minute: number;
  days_of_week: string; timezone: string | null;
  allow_categories: string; enabled: number;
  created_at: string; updated_at: string;
}

export interface CreateDndInput {
  user_id: string; label?: string | null;
  start_minute: number; end_minute: number;
  days_of_week?: number[]; timezone?: string | null;
  allow_categories?: AlertCategory[];
  enabled?: boolean;
}

export function createDnd(input: CreateDndInput): DndSchedule {
  if (input.start_minute < 0 || input.start_minute > 1439) throw new Error('invalid_start');
  if (input.end_minute < 0 || input.end_minute > 1439) throw new Error('invalid_end');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`INSERT INTO dnd_schedules
    (id, user_id, label, start_minute, end_minute, days_of_week, timezone, allow_categories, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.user_id, input.label ?? null,
    input.start_minute, input.end_minute, JSON.stringify(input.days_of_week ?? [0,1,2,3,4,5,6]),
    input.timezone ?? null, JSON.stringify(input.allow_categories ?? ['security']),
    input.enabled === false ? 0 : 1, now, now);
  return db.prepare('SELECT * FROM dnd_schedules WHERE id = ?').get(id) as DndSchedule;
}

export function listDnd(userId: string): DndSchedule[] {
  return getDb().prepare('SELECT * FROM dnd_schedules WHERE user_id = ? ORDER BY start_minute').all(userId) as DndSchedule[];
}

export function deleteDnd(id: string, userId: string): boolean {
  return getDb().prepare('DELETE FROM dnd_schedules WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

export function isDndActive(userId: string, at: Date = new Date(), category?: AlertCategory): { active: boolean; schedule_id?: string } {
  const rows = listDnd(userId).filter(r => r.enabled === 1);
  const minute = at.getHours() * 60 + at.getMinutes();
  const dow = at.getDay();
  for (const r of rows) {
    const days = JSON.parse(r.days_of_week) as number[];
    if (!days.includes(dow)) continue;
    const inWindow = r.start_minute <= r.end_minute
      ? (minute >= r.start_minute && minute < r.end_minute)
      : (minute >= r.start_minute || minute < r.end_minute);
    if (!inWindow) continue;
    if (category && (JSON.parse(r.allow_categories) as string[]).includes(category)) continue;
    return { active: true, schedule_id: r.id };
  }
  return { active: false };
}

// ================= Stats =================
export interface NotificationExtraStats {
  sms_configs: number;
  sms_queued: number;
  sms_sent: number;
  sms_failed: number;
  preference_rows: number;
  users_with_send_time: number;
  alerts_total: number;
  alerts_unseen: number;
  digest_subs_active: number;
  digest_due: number;
  digest_runs: number;
  dnd_schedules: number;
}

export function getNotificationExtraStats(): NotificationExtraStats {
  const db = getDb();
  const cfg = db.prepare('SELECT COUNT(*) AS c FROM sms_configs').get() as { c: number };
  const q = db.prepare("SELECT COUNT(*) AS c FROM sms_messages WHERE status = 'queued'").get() as { c: number };
  const s = db.prepare("SELECT COUNT(*) AS c FROM sms_messages WHERE status = 'sent'").get() as { c: number };
  const f = db.prepare("SELECT COUNT(*) AS c FROM sms_messages WHERE status = 'failed'").get() as { c: number };
  const prefs = db.prepare('SELECT COUNT(*) AS c FROM notification_preferences').get() as { c: number };
  const st = db.prepare('SELECT COUNT(*) AS c FROM notification_send_times').get() as { c: number };
  const al = db.prepare('SELECT COUNT(*) AS c FROM personalized_alerts WHERE dismissed = 0').get() as { c: number };
  const alUnseen = db.prepare('SELECT COUNT(*) AS c FROM personalized_alerts WHERE seen = 0 AND dismissed = 0').get() as { c: number };
  const dsub = db.prepare("SELECT COUNT(*) AS c FROM digest_subscriptions WHERE enabled = 1 AND frequency != 'never'").get() as { c: number };
  const due = listDueDigests().length;
  const dr = db.prepare('SELECT COUNT(*) AS c FROM digest_runs').get() as { c: number };
  const dnd = db.prepare('SELECT COUNT(*) AS c FROM dnd_schedules WHERE enabled = 1').get() as { c: number };
  return {
    sms_configs: cfg.c, sms_queued: q.c, sms_sent: s.c, sms_failed: f.c,
    preference_rows: prefs.c, users_with_send_time: st.c,
    alerts_total: al.c, alerts_unseen: alUnseen.c,
    digest_subs_active: dsub.c, digest_due: due, digest_runs: dr.c,
    dnd_schedules: dnd.c,
  };
}
