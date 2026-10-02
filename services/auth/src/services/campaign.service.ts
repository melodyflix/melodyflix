// melodyflix auth - email campaign service (27.1)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';
import { sendEmail } from './email.service.js';

export type AudienceType = 'all' | 'verified' | 'unverified' | 'subscribers' | 'inactive';
export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'failed';

export interface EmailCampaign {
  id: string;
  title: string;
  subject: string;
  body_html: string;
  body_text: string | null;
  audience: AudienceType;
  status: CampaignStatus;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  open_count: number;
  click_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CampaignRecipient {
  id: string;
  campaign_id: string;
  user_id: string;
  email: string;
  status: 'pending' | 'sent' | 'failed' | 'opened' | 'clicked';
  error: string | null;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
}

export const AUDIENCES: { id: AudienceType; label: string; desc: string }[] = [
  { id: 'all', label: 'All users', desc: 'Every registered account' },
  { id: 'verified', label: 'Verified only', desc: 'Users who verified their email' },
  { id: 'unverified', label: 'Unverified', desc: 'Users who haven\'t verified yet' },
  { id: 'subscribers', label: 'Channel subscribers', desc: 'Users subscribed to at least one channel' },
  { id: 'inactive', label: 'Inactive (30d+)', desc: 'No activity for 30 days' },
];

export function ensureCampaignSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_campaigns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_html TEXT NOT NULL,
      body_text TEXT,
      audience TEXT NOT NULL DEFAULT 'all',
      status TEXT NOT NULL DEFAULT 'draft',
      scheduled_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      total_recipients INTEGER NOT NULL DEFAULT 0,
      sent_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      open_count INTEGER NOT NULL DEFAULT 0,
      click_count INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_campaigns_status ON email_campaigns(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS email_campaign_recipients (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      sent_at TEXT,
      opened_at TEXT,
      clicked_at TEXT,
      UNIQUE (campaign_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_recipients_campaign ON email_campaign_recipients(campaign_id, status);
  `);
}

// ---------- Audience resolution ----------

interface UserRow { id: string; email: string; email_verified: number }

export function resolveAudience(audience: AudienceType): UserRow[] {
  const db = getDb();
  if (audience === 'all') {
    return db.prepare('SELECT id, email, email_verified FROM users ORDER BY created_at ASC').all() as UserRow[];
  }
  if (audience === 'verified') {
    return db.prepare('SELECT id, email, email_verified FROM users WHERE email_verified = 1').all() as UserRow[];
  }
  if (audience === 'unverified') {
    return db.prepare('SELECT id, email, email_verified FROM users WHERE email_verified = 0').all() as UserRow[];
  }
  if (audience === 'subscribers') {
    // Users with at least one channel subscription
    try {
      return db.prepare(
        'SELECT DISTINCT u.id, u.email, u.email_verified FROM users u ' +
        'JOIN channel_subscriptions cs ON cs.user_id = u.id'
      ).all() as UserRow[];
    } catch {
      return [];
    }
  }
  if (audience === 'inactive') {
    // Users with no video_views / comments / reactions in last 30 days (best-effort)
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    try {
      return db.prepare(
        'SELECT id, email, email_verified FROM users WHERE created_at < ? ' +
        'AND id NOT IN (SELECT DISTINCT user_id FROM video_views WHERE created_at >= ? AND user_id IS NOT NULL)'
      ).all(cutoff, cutoff) as UserRow[];
    } catch {
      return db.prepare('SELECT id, email, email_verified FROM users WHERE created_at < ?').all(cutoff) as UserRow[];
    }
  }
  return [];
}

export function previewAudienceSize(audience: AudienceType): number {
  return resolveAudience(audience).length;
}

// ---------- CRUD ----------

export interface CampaignInput {
  title: string;
  subject: string;
  body_html: string;
  body_text?: string | null;
  audience?: AudienceType;
}

export function createCampaign(input: CampaignInput, createdBy: string): EmailCampaign {
  if (!input.title?.trim()) throw new Error('Title is required');
  if (!input.subject?.trim()) throw new Error('Subject is required');
  if (!input.body_html?.trim()) throw new Error('Body is required');

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO email_campaigns (id, title, subject, body_html, body_text, audience, status, created_by, created_at, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    input.title.trim().slice(0, 200),
    input.subject.trim().slice(0, 200),
    input.body_html.slice(0, 100_000),
    input.body_text?.slice(0, 50_000) ?? null,
    input.audience || 'all',
    'draft',
    createdBy,
    now,
    now,
  );
  return getCampaign(id)!;
}

export function getCampaign(id: string): EmailCampaign | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM email_campaigns WHERE id = ?').get(id) as EmailCampaign) ?? null;
}

export function listCampaigns(limit = 50): EmailCampaign[] {
  const db = getDb();
  return db.prepare('SELECT * FROM email_campaigns ORDER BY created_at DESC LIMIT ?')
    .all(Math.max(1, Math.min(200, limit))) as EmailCampaign[];
}

export function updateCampaign(id: string, patch: Partial<CampaignInput & { status: CampaignStatus; scheduled_at: string | null }>): EmailCampaign {
  const existing = getCampaign(id);
  if (!existing) throw new Error('Campaign not found');
  if (existing.status === 'sent' || existing.status === 'sending') {
    throw new Error('Cannot edit a sent campaign');
  }
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE email_campaigns SET title = ?, subject = ?, body_html = ?, body_text = ?, audience = ?, status = ?, scheduled_at = ?, updated_at = ? WHERE id = ?'
  ).run(
    patch.title?.trim().slice(0, 200) ?? existing.title,
    patch.subject?.trim().slice(0, 200) ?? existing.subject,
    patch.body_html ?? existing.body_html,
    patch.body_text !== undefined ? (patch.body_text?.slice(0, 50_000) ?? null) : existing.body_text,
    patch.audience ?? existing.audience,
    patch.status ?? existing.status,
    patch.scheduled_at !== undefined ? patch.scheduled_at : existing.scheduled_at,
    now,
    id,
  );
  return getCampaign(id)!;
}

export function deleteCampaign(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM email_campaign_recipients WHERE campaign_id = ?').run(id);
  db.prepare('DELETE FROM email_campaigns WHERE id = ?').run(id);
}

// ---------- Send ----------

function buildHtml(campaign: EmailCampaign, userEmail: string): string {
  const body = campaign.body_html
    .replace(/\{\{email\}\}/g, userEmail)
    .replace(/\{\{tracking_pixel\}\}/g, `<img src="/api/v1/auth/campaigns/${campaign.id}/open.gif?u=${encodeURIComponent(userEmail)}" width="1" height="1" alt="" />`);
  return body;
}

export interface SendResult {
  total: number;
  sent: number;
  failed: number;
}

export async function sendCampaign(campaignId: string): Promise<SendResult> {
  const db = getDb();
  const campaign = getCampaign(campaignId);
  if (!campaign) throw new Error('Campaign not found');
  if (campaign.status === 'sent' || campaign.status === 'sending') {
    throw new Error('Campaign already sent');
  }

  const audienceUsers = resolveAudience(campaign.audience);
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE email_campaigns SET status = 'sending', started_at = ?, total_recipients = ?, updated_at = ? WHERE id = ?"
  ).run(now, audienceUsers.length, now, campaignId);

  // Insert recipients (pending) if not already present
  const insertR = db.prepare(
    'INSERT OR IGNORE INTO email_campaign_recipients (id, campaign_id, user_id, email, status) VALUES (?, ?, ?, ?, ?)'
  );
  for (const u of audienceUsers) {
    insertR.run(randomUUID(), campaignId, u.id, u.email, 'pending');
  }

  let sent = 0;
  let failed = 0;

  // Send sequentially (SMTP rate-limit friendly)
  for (const u of audienceUsers) {
    try {
      const res = await sendEmail({
        to: u.email,
        subject: campaign.subject,
        html: buildHtml(campaign, u.email),
        text: campaign.body_text ?? undefined,
      } as any);
      const ok = (res as any)?.sent !== false;
      if (ok) sent++;
      else failed++;
      db.prepare(
        'UPDATE email_campaign_recipients SET status = ?, sent_at = ?, error = ? WHERE campaign_id = ? AND user_id = ?'
      ).run(ok ? 'sent' : 'failed', new Date().toISOString(), ok ? null : ((res as any)?.error ?? null), campaignId, u.id);
    } catch (err) {
      failed++;
      db.prepare(
        'UPDATE email_campaign_recipients SET status = ?, error = ? WHERE campaign_id = ? AND user_id = ?'
      ).run('failed', (err as Error).message.slice(0, 500), campaignId, u.id);
    }
  }

  const doneAt = new Date().toISOString();
  db.prepare(
    "UPDATE email_campaigns SET status = 'sent', completed_at = ?, sent_count = ?, failed_count = ?, updated_at = ? WHERE id = ?"
  ).run(doneAt, sent, failed, doneAt, campaignId);

  return { total: audienceUsers.length, sent, failed };
}

// ---------- Recipients + Stats ----------

export function listRecipients(campaignId: string, limit = 200): CampaignRecipient[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM email_campaign_recipients WHERE campaign_id = ? ORDER BY sent_at DESC LIMIT ?'
  ).all(campaignId, Math.max(1, Math.min(1000, limit))) as CampaignRecipient[];
}

export interface CampaignStats {
  total: number;
  sent: number;
  failed: number;
  pending: number;
  open_count: number;
  click_count: number;
  open_rate: number;
  click_rate: number;
}

export function getCampaignStats(campaignId: string): CampaignStats {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as n FROM email_campaign_recipients WHERE campaign_id = ?').get(campaignId) as { n: number }).n;
  const sent = (db.prepare("SELECT COUNT(*) as n FROM email_campaign_recipients WHERE campaign_id = ? AND status IN ('sent','opened','clicked')").get(campaignId) as { n: number }).n;
  const failed = (db.prepare("SELECT COUNT(*) as n FROM email_campaign_recipients WHERE campaign_id = ? AND status = 'failed'").get(campaignId) as { n: number }).n;
  const pending = (db.prepare("SELECT COUNT(*) as n FROM email_campaign_recipients WHERE campaign_id = ? AND status = 'pending'").get(campaignId) as { n: number }).n;
  const open = (db.prepare("SELECT COUNT(*) as n FROM email_campaign_recipients WHERE campaign_id = ? AND opened_at IS NOT NULL").get(campaignId) as { n: number }).n;
  const click = (db.prepare("SELECT COUNT(*) as n FROM email_campaign_recipients WHERE campaign_id = ? AND clicked_at IS NOT NULL").get(campaignId) as { n: number }).n;
  const open_rate = sent > 0 ? open / sent : 0;
  const click_rate = sent > 0 ? click / sent : 0;
  return { total, sent, failed, pending, open_count: open, click_count: click, open_rate, click_rate };
}

// Record open (tracking pixel)
export function recordOpen(campaignId: string, email: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE email_campaign_recipients SET status = CASE WHEN status = 'clicked' THEN 'clicked' ELSE 'opened' END, opened_at = COALESCE(opened_at, ?) WHERE campaign_id = ? AND email = ?"
  ).run(new Date().toISOString(), campaignId, email);
  db.prepare(
    "UPDATE email_campaigns SET open_count = (SELECT COUNT(*) FROM email_campaign_recipients WHERE campaign_id = ? AND opened_at IS NOT NULL) WHERE id = ?"
  ).run(campaignId, campaignId);
}

export function recordClick(campaignId: string, email: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE email_campaign_recipients SET status = 'clicked', opened_at = COALESCE(opened_at, ?), clicked_at = COALESCE(clicked_at, ?) WHERE campaign_id = ? AND email = ?"
  ).run(now, now, campaignId, email);
  db.prepare(
    "UPDATE email_campaigns SET click_count = (SELECT COUNT(*) FROM email_campaign_recipients WHERE campaign_id = ? AND clicked_at IS NOT NULL) WHERE id = ?"
  ).run(campaignId, campaignId);
}
