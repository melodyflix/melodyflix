// melodyflix videos - ad campaign routes (51.4 - 51.23)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  AD_FORMATS,
  listPods, createPod, deletePod,
  createCampaign, listCampaigns, getCampaign, updateCampaign, deleteCampaign,
  submitForReview, approveCampaign, rejectCampaign, setCampaignStatus,
  selectAds, trackAdEvent,
  getCampaignAnalytics, getCampaignDaily,
  getBillingReport, getBillingLedger,
  getUserConsent, setUserConsent,
  CONSENT_PURPOSES, CONSENT_POLICY_VERSION,
  setPurposeConsent, getPurposeConsent, getFullConsentSnapshot,
  setBulkConsent, withdrawAllConsent, getConsentLog,
  getConsentLogForPurpose, isPurposeAllowed, getConsentStats,
} from '../services/adcampaign.service.js';

// Fastify preHandler wrapper for shared-auth requireAuth
function authGuard(req: any, reply: any, done: (err?: Error) => void): void {
  try {
    const payload = requireAuth(req.headers.authorization);
    req.user = payload;
    done();
  } catch (err) {
    reply.code(401).send({ success: false, error: (err as Error).message });
  }
}

const FormatEnum = z.enum(['banner', 'overlay', 'pre-roll', 'mid-roll', 'post-roll', 'native', 'sponsored-card']);
const StatusEnum = z.enum(['draft', 'pending_review', 'approved', 'rejected', 'active', 'paused', 'completed', 'archived']);

const CampaignSchema = z.object({
  name: z.string().min(1).max(150),
  advertiser: z.string().min(1).max(150),
  format: FormatEnum,
  creative_url: z.string().min(1).max(500),
  click_url: z.string().min(1).max(500),
  thumbnail_url: z.string().max(500).nullable().optional(),
  cta_text: z.string().max(50).nullable().optional(),
  target_countries: z.array(z.string().max(3)).max(200).optional(),
  target_languages: z.array(z.string().max(10)).max(100).optional(),
  target_age_min: z.number().int().min(0).max(120).optional(),
  target_age_max: z.number().int().min(0).max(120).optional(),
  target_gender: z.enum(['any', 'male', 'female', 'other']).optional(),
  target_interests: z.array(z.string().max(50)).max(50).optional(),
  target_categories: z.array(z.string().max(50)).max(50).optional(),
  starts_at: z.string().datetime().nullable().optional(),
  ends_at: z.string().datetime().nullable().optional(),
  freq_cap_per_user: z.number().int().min(0).max(100).optional(),
  freq_cap_window_hours: z.number().int().min(1).max(720).optional(),
  freq_cap_per_session: z.number().int().min(0).max(50).optional(),
  is_skippable: z.boolean().optional(),
  skip_after_seconds: z.number().int().min(0).max(120).optional(),
  duration_seconds: z.number().int().min(0).max(3600).optional(),
  pod_id: z.string().nullable().optional(),
  requires_consent: z.boolean().optional(),
  consent_scope: z.enum(['any', 'personalized', 'non_personalized']).optional(),
  budget_total: z.number().min(0).max(10_000_000).optional(),
  cpm: z.number().min(0).max(10_000).optional(),
  cpc: z.number().min(0).max(10_000).optional(),
});

const UpdateSchema = CampaignSchema.partial().extend({
  status: StatusEnum.optional(),
  review_notes: z.string().max(1000).nullable().optional(),
});

const TrackSchema = z.object({
  campaign_id: z.string().min(1),
  event_type: z.enum(['impression', 'click', 'view', 'completion', 'skip']),
  video_id: z.string().nullable().optional(),
  session_id: z.string().max(100).nullable().optional(),
  country: z.string().max(3).nullable().optional(),
});

const SelectSchema = z.object({
  format: FormatEnum,
  limit: z.number().int().min(1).max(10).optional(),
  context: z.object({
    country: z.string().max(3).nullable().optional(),
    language: z.string().max(10).nullable().optional(),
    age: z.number().int().min(0).max(120).nullable().optional(),
    gender: z.enum(['male', 'female', 'other']).nullable().optional(),
    interests: z.array(z.string().max(50)).max(50).optional(),
    video_category: z.string().max(50).nullable().optional(),
    session_id: z.string().max(100).nullable().optional(),
  }).optional(),
});

const PodSchema = z.object({
  name: z.string().min(1).max(100),
  max_ads: z.number().int().min(1).max(10).optional(),
  max_duration_seconds: z.number().int().min(15).max(600).optional(),
  ad_break_type: z.string().max(30).optional(),
});

function requireAdmin(auth: string | undefined): { id: string } | null {
  try {
    const p = requireAuth(auth);
    if (p.role !== 'admin') return null;
    return { id: p.sub as string };
  } catch { return null; }
}

function optionalUserId(auth: string | undefined): string | null {
  try { return requireAuth(auth).sub as string; } catch { return null; }
}

export async function adCampaignRoutes(app: FastifyInstance) {
  // ============ Meta ============
  app.get('/admin/ads/formats', async (_req, reply) => {
    return reply.send({ success: true, data: { formats: AD_FORMATS } });
  });

  // ============ Pods (51.18) ============
  app.get('/admin/ads/pods', async (_req, reply) => {
    return reply.send({ success: true, data: { pods: listPods() } });
  });
  app.post('/admin/ads/pods', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const parsed = PodSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    return reply.send({ success: true, data: { pod: createPod(parsed.data) } });
  });
  app.delete('/admin/ads/pods/:id', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: { removed: deletePod(id) } });
  });

  // ============ Campaigns CRUD (51.20) ============
  app.get('/admin/ads/campaigns', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const q = req.query as { status?: string; format?: string; advertiser?: string; limit?: string };
    return reply.send({
      success: true,
      data: {
        campaigns: listCampaigns({
          status: q.status as any,
          format: q.format as any,
          advertiser: q.advertiser,
          limit: q.limit ? parseInt(q.limit) : 100,
        }),
      },
    });
  });

  app.post('/admin/ads/campaigns', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const parsed = CampaignSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    try {
      return reply.send({ success: true, data: { campaign: createCampaign(parsed.data, admin.id) } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.get('/admin/ads/campaigns/:id', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { id } = req.params as { id: string };
    const c = getCampaign(id);
    if (!c) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.send({ success: true, data: { campaign: c, analytics: getCampaignAnalytics(id) } });
  });

  app.put('/admin/ads/campaigns/:id', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { id } = req.params as { id: string };
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    try {
      return reply.send({ success: true, data: { campaign: updateCampaign(id, parsed.data as any) } });
    } catch (err) {
      return reply.code(404).send({ success: false, error: (err as Error).message });
    }
  });

  app.delete('/admin/ads/campaigns/:id', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { id } = req.params as { id: string };
    if (!getCampaign(id)) return reply.code(404).send({ success: false, error: 'Not found' });
    deleteCampaign(id);
    return reply.send({ success: true, data: { deleted: true } });
  });

  // ============ Approval workflow (51.22) ============
  app.post('/admin/ads/campaigns/:id/submit', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: { campaign: submitForReview(id) } }); }
    catch (err) { return reply.code(404).send({ success: false, error: (err as Error).message }); }
  });

  app.post('/admin/ads/campaigns/:id/approve', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: { campaign: approveCampaign(id, admin.id) } }); }
    catch (err) { return reply.code(404).send({ success: false, error: (err as Error).message }); }
  });

  app.post('/admin/ads/campaigns/:id/reject', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { id } = req.params as { id: string };
    const q = req.body as { notes?: string };
    try { return reply.send({ success: true, data: { campaign: rejectCampaign(id, admin.id, q?.notes) } }); }
    catch (err) { return reply.code(404).send({ success: false, error: (err as Error).message }); }
  });

  app.post('/admin/ads/campaigns/:id/status', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { id } = req.params as { id: string };
    const parsed = z.object({ status: StatusEnum }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid status' });
    try { return reply.send({ success: true, data: { campaign: setCampaignStatus(id, parsed.data.status) } }); }
    catch (err) { return reply.code(404).send({ success: false, error: (err as Error).message }); }
  });

  // ============ Analytics (51.15) ============
  app.get('/admin/ads/campaigns/:id/analytics', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { id } = req.params as { id: string };
    try {
      return reply.send({
        success: true,
        data: {
          analytics: getCampaignAnalytics(id),
          daily: getCampaignDaily(id, 30),
          ledger: getBillingLedger(id, 200),
        },
      });
    } catch (err) {
      return reply.code(404).send({ success: false, error: (err as Error).message });
    }
  });

  // ============ Billing (51.23) ============
  app.get('/admin/ads/billing', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const q = req.query as { status?: string; advertiser?: string };
    return reply.send({
      success: true,
      data: { report: getBillingReport({ status: q.status as any, advertiser: q.advertiser }) },
    });
  });

  // ============ Ad Selection + Serving (51.7 - 51.10) ============
  app.post('/ads/select', async (req, reply) => {
    const parsed = SelectSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    const userId = optionalUserId(req.headers.authorization);
    const personalizedAllowed = userId ? (getUserConsent(userId).personalized_allowed === 1) : false;
    const ctx = {
      ...(parsed.data.context ?? {}),
      user_id: userId,
      personalized_allowed: personalizedAllowed,
    } as any;
    const picks = selectAds(ctx, parsed.data.format as any, parsed.data.limit ?? 1);
    return reply.send({
      success: true,
      data: {
        ads: picks.map((p) => ({
          campaign_id: p.campaign.id,
          format: p.campaign.format,
          creative_url: p.campaign.creative_url,
          click_url: p.campaign.click_url,
          thumbnail_url: p.campaign.thumbnail_url,
          cta_text: p.campaign.cta_text,
          is_skippable: p.campaign.is_skippable === 1,
          skip_after_seconds: p.campaign.skip_after_seconds,
          duration_seconds: p.campaign.duration_seconds,
          pod: p.pod,
          requires_consent: p.campaign.requires_consent === 1,
        })),
      },
    });
  });

  app.post('/ads/track', async (req, reply) => {
    const parsed = TrackSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    const userId = optionalUserId(req.headers.authorization);
    try {
      const res = trackAdEvent({ ...parsed.data, user_id: userId });
      return reply.send({ success: true, data: res });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============ Consent (51.19) ============
  app.get('/ads/consent', { preHandler: [authGuard] }, async (req, reply) => {
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    return reply.send({ success: true, data: getUserConsent(userId) });
  });

  app.put('/ads/consent', { preHandler: [authGuard] }, async (req, reply) => {
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = z.object({ personalized_allowed: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    return reply.send({ success: true, data: setUserConsent(userId, parsed.data.personalized_allowed) });
  });

  // ============ 51.19 EXTENDED CONSENT ============

  // GET /ads/consent/full — per-purpose snapshot
  app.get('/ads/consent/full', { preHandler: [authGuard] }, async (req, reply) => {
    const userId = (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    return reply.send({ success: true, data: getFullConsentSnapshot(userId) });
  });

  // PUT /ads/consent/purpose — set single purpose
  app.put('/ads/consent/purpose', { preHandler: [authGuard] }, async (req, reply) => {
    const userId = (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = z.object({
      purpose: z.enum(CONSENT_PURPOSES as [string, ...string[]]),
      allowed: z.boolean(),
      reason: z.string().max(500).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    const result = setPurposeConsent(userId, {
      purpose: parsed.data.purpose as any,
      allowed: parsed.data.allowed,
      reason: parsed.data.reason ?? null,
      source: 'user',
      ip_address: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? null,
      user_agent: req.headers['user-agent'] ?? null,
    });
    return reply.send({ success: true, data: result });
  });

  // PUT /ads/consent/bulk — set multiple purposes at once
  app.put('/ads/consent/bulk', { preHandler: [authGuard] }, async (req, reply) => {
    const userId = (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = z.object({
      purposes: z.record(z.string(), z.boolean()),
      reason: z.string().max(500).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    const snapshot = setBulkConsent(userId, {
      purposes: parsed.data.purposes as any,
      source: 'user',
      reason: parsed.data.reason ?? null,
      ip_address: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? null,
      user_agent: req.headers['user-agent'] ?? null,
    });
    return reply.send({ success: true, data: snapshot });
  });

  // POST /ads/consent/withdraw-all — GDPR withdrawal
  app.post('/ads/consent/withdraw-all', { preHandler: [authGuard] }, async (req, reply) => {
    const userId = (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = z.object({ reason: z.string().max(500).nullable().optional() }).safeParse(req.body ?? {});
    const snapshot = withdrawAllConsent(userId, parsed.success ? (parsed.data.reason ?? null) : null);
    return reply.send({ success: true, data: snapshot });
  });

  // GET /ads/consent/log — audit log
  app.get('/ads/consent/log', { preHandler: [authGuard] }, async (req, reply) => {
    const userId = (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(Number(q.limit), 1), 500) : 100;
    return reply.send({ success: true, data: { log: getConsentLog(userId, limit) } });
  });

  // GET /ads/consent/check/:purpose — quick check for a purpose
  app.get('/ads/consent/check/:purpose', { preHandler: [authGuard] }, async (req, reply) => {
    const userId = (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { purpose } = req.params as { purpose: string };
    if (!CONSENT_PURPOSES.includes(purpose as any)) {
      return reply.code(400).send({ success: false, error: 'invalid_purpose' });
    }
    return reply.send({ success: true, data: { purpose, allowed: isPurposeAllowed(userId, purpose as any) } });
  });

  // GET /ads/consent/stats — admin
  app.get('/ads/consent/stats', { preHandler: [authGuard] }, async (req, reply) => {
    const role = (req as any).user?.role;
    if (role !== 'admin' && role !== 'superadmin') {
      return reply.code(403).send({ success: false, error: 'admin_required' });
    }
    return reply.send({ success: true, data: getConsentStats() });
  });

  // GET /ads/consent/policy — public policy version + purpose list
  app.get('/ads/consent/policy', async (_req, reply) => {
    return reply.send({
      success: true,
      data: {
        policy_version: CONSENT_POLICY_VERSION,
        purposes: CONSENT_PURPOSES,
      },
    });
  });
}
