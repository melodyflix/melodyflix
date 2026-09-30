// melodyflix videos - web push notification service
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';
import { createLogger } from '@melodyflix/shared-logger';

const logger = createLogger('push');

// Lazy-load web-push (it may not be present in some environments)
let webpush: any = null;
try {
  webpush = require('web-push');
} catch (err) {
  logger.warn('web-push package not available');
}

// VAPID keys are generated once and stored in DB (settings table)
export interface PushSubscription {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export function ensurePushSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_push_active ON push_subscriptions(active);

    CREATE TABLE IF NOT EXISTS push_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      vapid_public TEXT NOT NULL,
      vapid_private TEXT NOT NULL,
      vapid_subject TEXT NOT NULL DEFAULT 'mailto:admin@melodyflix.local',
      updated_at TEXT NOT NULL
    );
  `);
}

// ---------- VAPID keys ----------
export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

function generateVapid(): VapidKeys {
  if (!webpush) throw new Error('web-push not installed');
  const keys = webpush.generateVAPIDKeys();
  return {
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    subject: 'mailto:admin@melodyflix.local',
  };
}

export function getOrCreateVapidKeys(): VapidKeys {
  const db = getDb();
  const existing = db.prepare('SELECT vapid_public, vapid_private, vapid_subject FROM push_settings WHERE id = 1').get() as
    { vapid_public: string; vapid_private: string; vapid_subject: string } | undefined;

  if (existing) {
    return {
      publicKey: existing.vapid_public,
      privateKey: existing.vapid_private,
      subject: existing.vapid_subject,
    };
  }

  const keys = generateVapid();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO push_settings (id, vapid_public, vapid_private, vapid_subject, updated_at)
    VALUES (1, ?, ?, ?, ?)
  `).run(keys.publicKey, keys.privateKey, keys.subject, now);
  logger.info('VAPID keys generated');
  return keys;
}

export function getPublicKey(): string {
  return getOrCreateVapidKeys().publicKey;
}

// ---------- Subscribe ----------
export interface SubscribeInput {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string;
}

export function saveSubscription(input: SubscribeInput): PushSubscription {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').get(input.endpoint) as
    { id: string } | undefined;

  if (existing) {
    db.prepare(`
      UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth = ?, user_agent = ?, active = 1, updated_at = ?
      WHERE id = ?
    `).run(input.user_id, input.p256dh, input.auth, input.user_agent ?? null, now, existing.id);
    return db.prepare('SELECT * FROM push_subscriptions WHERE id = ?').get(existing.id) as PushSubscription;
  }

  const sub: PushSubscription = {
    id: randomUUID(),
    user_id: input.user_id,
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
    user_agent: input.user_agent ?? null,
    active: 1,
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sub.id, sub.user_id, sub.endpoint, sub.p256dh, sub.auth, sub.user_agent, 1, now, now);
  return sub;
}

export function unsubscribeEndpoint(userId: string, endpoint: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
    .run(userId, endpoint);
  return result.changes > 0;
}

export function listUserSubscriptions(userId: string): PushSubscription[] {
  const db = getDb();
  return db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ? AND active = 1')
    .all(userId) as PushSubscription[];
}

// ---------- Send ----------
export interface PushPayload {
  title: string;
  body?: string;
  url?: string;
  icon?: string;
  tag?: string;
  data?: Record<string, any>;
}

export interface SendResult {
  sent: number;
  failed: number;
  removed: number;
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<SendResult> {
  if (!webpush) return { sent: 0, failed: 0, removed: 0 };

  const subs = listUserSubscriptions(userId);
  if (subs.length === 0) return { sent: 0, failed: 0, removed: 0 };

  const vapid = getOrCreateVapidKeys();
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body ?? '',
    url: payload.url ?? '/',
    icon: payload.icon ?? '/icons/icon-192.png',
    tag: payload.tag ?? 'melodyflix',
    data: payload.data ?? {},
  });

  const db = getDb();
  let sent = 0, failed = 0, removed = 0;

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        body,
      );
      sent++;
    } catch (err: any) {
      failed++;
      // 404 or 410 means the subscription is dead
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        removed++;
      }
    }
  }));

  return { sent, failed, removed };
}

export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<SendResult> {
  const total: SendResult = { sent: 0, failed: 0, removed: 0 };
  for (const uid of userIds) {
    const r = await sendPushToUser(uid, payload);
    total.sent += r.sent;
    total.failed += r.failed;
    total.removed += r.removed;
  }
  return total;
}

// ---------- Stats ----------
export interface PushStats {
  total_subscriptions: number;
  active_subscriptions: number;
  unique_users: number;
}

export function getPushStats(): PushStats {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as n FROM push_subscriptions').get() as { n: number }).n;
  const active = (db.prepare('SELECT COUNT(*) as n FROM push_subscriptions WHERE active = 1').get() as { n: number }).n;
  const uniq = (db.prepare('SELECT COUNT(DISTINCT user_id) as n FROM push_subscriptions WHERE active = 1').get() as { n: number }).n;
  return { total_subscriptions: total, active_subscriptions: active, unique_users: uniq };
}
