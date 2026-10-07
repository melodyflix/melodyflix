// melodyflix videos - Section 20 Notifications (20.3/20.5-20.9) routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  upsertSmsConfig, listSmsConfigs, sendSms, markSmsSent, markSmsFailed, listSms,
  setPreference, getPreferences, getEffectivePreferences, isChannelAllowed,
  recordEngagementAndRecompute, upsertSendTime, getSendTime, nextBestSendAt,
  createPersonalizedAlert, listAlerts, markAlertSeen, dismissAlert,
  upsertDigest, getDigest, listDueDigests, runDigest, listDigestRuns,
  createDnd, listDnd, deleteDnd, isDndActive,
  getNotificationExtraStats,
} from '../services/notification-extra.service.js';

const CATEGORIES = ['content','social','system','security','marketing','creator','learning'] as const;
const CHANNELS = ['push','email','sms','in_app'] as const;
const SMS_PROVIDERS = ['twilio','vonage','messagebird','custom'] as const;
const DIGEST_FREQ = ['hourly','daily','weekly','never'] as const;

const SmsConfigSchema = z.object({
  provider: z.enum(SMS_PROVIDERS),
  sender_id: z.string().max(40).nullable().optional(),
  api_key_ref: z.string().max(200).nullable().optional(),
  enabled: z.boolean().optional(),
});

const SmsSendSchema = z.object({
  to_phone: z.string().min(4).max(40),
  body: z.string().min(1).max(1600),
  provider: z.enum(SMS_PROVIDERS).optional(),
});

const SmsSentSchema = z.object({ external_id: z.string().max(200).optional() });
const SmsFailedSchema = z.object({ error: z.string().max(500) });

const PrefSchema = z.object({
  category: z.enum(CATEGORIES),
  channel: z.enum(CHANNELS),
  enabled: z.boolean(),
});

const EngagementSchema = z.object({
  samples: z.array(z.object({
    user_id: z.string().min(1).max(100),
    hour_local: z.number().int().min(0).max(23),
    engaged: z.boolean(),
  })).min(1).max(10000),
});

const SendTimeSchema = z.object({
  user_id: z.string().min(1).max(100),
  best_hours: z.array(z.number().int().min(0).max(23)).max(24),
  engagement_score: z.number().min(0).max(1),
  sample_count: z.number().int().min(0),
  timezone: z.string().max(60).nullable().optional(),
});

const AlertSchema = z.object({
  user_id: z.string().min(1).max(100),
  category: z.enum(CATEGORIES),
  kind: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  target_id: z.string().max(100).nullable().optional(),
  priority: z.number().int().min(1).max(10).optional(),
  expires_at: z.string().datetime().nullable().optional(),
});

const DigestSchema = z.object({
  frequency: z.enum(DIGEST_FREQ),
  channel: z.enum(['email','push','sms']).optional(),
  categories: z.array(z.enum(CATEGORIES)).optional(),
});

const DndSchema = z.object({
  label: z.string().max(80).nullable().optional(),
  start_minute: z.number().int().min(0).max(1439),
  end_minute: z.number().int().min(0).max(1439),
  days_of_week: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  timezone: z.string().max(60).nullable().optional(),
  allow_categories: z.array(z.enum(CATEGORIES)).optional(),
  enabled: z.boolean().optional(),
});

function admin(auth: string | undefined): boolean {
  try { requireRole(auth, ['admin']); return true; } catch { return false; }
}
function uid(auth: string | undefined): string | null {
  try { const p: any = requireRole(auth, ['admin','user','moderator']); return p?.sub ?? p?.id ?? null; } catch { return null; }
}

export async function notificationExtraRoutes(app: FastifyInstance): Promise<void> {
  // ===== 20.3 SMS =====
  app.post('/notifications/sms/config', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = SmsConfigSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: upsertSmsConfig(p.data.provider, p.data.sender_id, p.data.api_key_ref, p.data.enabled ?? true) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/notifications/sms/config', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: { configs: listSmsConfigs() } });
  });

  app.post('/notifications/sms/send', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = SmsSendSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: sendSms(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/notifications/sms/:id/sent', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const p = SmsSentSchema.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    const m = markSmsSent(id, p.data.external_id);
    if (!m) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: m });
  });

  app.post('/notifications/sms/:id/failed', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const p = SmsFailedSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    const m = markSmsFailed(id, p.data.error);
    if (!m) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: m });
  });

  app.get('/notifications/sms', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as any;
    return reply.send({ success: true, data: { messages: listSms({ to_phone: q.to_phone, status: q.status, limit: q.limit ? Number(q.limit) : undefined }) } });
  });

  // ===== 20.5 Preferences =====
  app.get('/notifications/preferences', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    return reply.send({ success: true, data: { rows: getPreferences(actor), effective: getEffectivePreferences(actor) } });
  });

  app.post('/notifications/preferences', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = PrefSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: setPreference(actor, p.data.category, p.data.channel, p.data.enabled) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/notifications/preferences/check', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const q = req.query as { category?: string; channel?: string };
    if (!q.category || !q.channel) return reply.code(400).send({ success: false, error: 'missing_params' });
    return reply.send({ success: true, data: { allowed: isChannelAllowed(actor, q.category as any, q.channel as any) } });
  });

  // ===== 20.6 AI Send-Time =====
  app.post('/notifications/send-time/compute', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = EngagementSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    return reply.send({ success: true, data: { predictions: recordEngagementAndRecompute(p.data.samples) } });
  });

  app.post('/notifications/send-time', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = SendTimeSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    return reply.send({ success: true, data: upsertSendTime(p.data.user_id, p.data.best_hours, p.data.engagement_score, p.data.sample_count, p.data.timezone) });
  });

  app.get('/notifications/send-time/:userId', async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const p = getSendTime(userId);
    if (!p) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: { prediction: p, next_best_send_at: nextBestSendAt(userId) } });
  });

  // ===== 20.7 Personalized Alerts =====
  app.post('/notifications/alerts', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = AlertSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createPersonalizedAlert(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/notifications/alerts/mine', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const q = req.query as any;
    return reply.send({ success: true, data: { alerts: listAlerts(actor, {
      unseenOnly: q.unseen === '1' || q.unseen === 'true',
      category: q.category, limit: q.limit ? Number(q.limit) : undefined,
    }) } });
  });

  app.get('/notifications/alerts/user/:userId', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { userId } = req.params as { userId: string };
    const q = req.query as any;
    return reply.send({ success: true, data: { alerts: listAlerts(userId, {
      unseenOnly: q.unseen === '1' || q.unseen === 'true',
      category: q.category, limit: q.limit ? Number(q.limit) : undefined,
    }) } });
  });

  app.post('/notifications/alerts/:id/seen', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const ok = markAlertSeen(id);
    return ok ? reply.send({ success: true, data: { seen: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  app.post('/notifications/alerts/:id/dismiss', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const ok = dismissAlert(id);
    return ok ? reply.send({ success: true, data: { dismissed: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  // ===== 20.8 Digest =====
  app.post('/notifications/digest', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = DigestSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: upsertDigest({ user_id: actor, ...p.data }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/notifications/digest/mine', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const d = getDigest(actor);
    if (!d) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: d });
  });

  app.get('/notifications/digest/due', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: { due: listDueDigests() } });
  });

  app.post('/notifications/digest/:subscriptionId/run', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { subscriptionId } = req.params as { subscriptionId: string };
    try { return reply.send({ success: true, data: runDigest(subscriptionId) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/notifications/digest-runs', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as any;
    return reply.send({ success: true, data: { runs: listDigestRuns(q.subscription_id, q.limit ? Number(q.limit) : 100) } });
  });

  // ===== 20.9 DND =====
  app.post('/notifications/dnd', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = DndSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createDnd({ user_id: actor, ...p.data }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/notifications/dnd', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    return reply.send({ success: true, data: { schedules: listDnd(actor), active: isDndActive(actor).active } });
  });

  app.delete('/notifications/dnd/:id', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const ok = deleteDnd(id, actor);
    return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  app.get('/notifications/dnd/active', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const q = req.query as { category?: string };
    return reply.send({ success: true, data: isDndActive(actor, new Date(), q.category as any) });
  });

  // ===== Stats =====
  app.get('/notifications/extra-stats', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getNotificationExtraStats() });
  });
}
