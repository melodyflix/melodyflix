// melodyflix videos - Section 12.7 GDPR / Cookie Consent routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  upsertCategory, listCategories, getCategory, deleteCategory,
  upsertCookie, listCookies, deleteCookie,
  publishPolicy, getLatestPolicy, listPolicies,
  recordConsent, listConsents, getLatestConsent, revokeConsent,
  getEffectiveConsent, getConsentStats, isGdprRegion,
} from '../services/cookie-consent.service.js';

const KINDS = ['necessary','functional','analytics','marketing','custom'] as const;

const CategorySchema = z.object({
  slug: z.string().min(2).max(80),
  kind: z.enum(KINDS),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  required: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

const CookieSchema = z.object({
  name: z.string().min(1).max(120),
  category_id: z.string().min(1).max(100),
  provider: z.string().max(200).nullable().optional(),
  domain: z.string().max(200).nullable().optional(),
  duration: z.string().max(80).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  is_third_party: z.boolean().optional(),
});

const PolicySchema = z.object({
  version: z.string().min(1).max(40),
  body_md: z.string().min(1).max(200_000),
  published_at: z.string().datetime().optional(),
});

const ConsentSchema = z.object({
  visitor_id: z.string().min(4).max(200),
  user_id: z.string().max(100).nullable().optional(),
  policy_version: z.string().min(1).max(40),
  action: z.enum(['grant','update','revoke','withdraw']).optional(),
  granted_categories: z.array(z.string().max(80)).max(30),
  revoked_categories: z.array(z.string().max(80)).max(30).optional(),
  region: z.string().max(10).nullable().optional(),
  source: z.string().max(80).nullable().optional(),
});

const RevokeSchema = z.object({
  visitor_id: z.string().min(4).max(200),
  user_id: z.string().max(100).nullable().optional(),
  policy_version: z.string().min(1).max(40),
  revoke_categories: z.array(z.string().max(80)).min(1).max(30),
  region: z.string().max(10).nullable().optional(),
  source: z.string().max(80).nullable().optional(),
});

function admin(auth: string | undefined): boolean {
  try { requireRole(auth, ['admin']); return true; } catch { return false; }
}

function clientIp(req: any): string | null {
  const xf = req.headers?.['x-forwarded-for'];
  if (typeof xf === 'string') return xf.split(',')[0].trim();
  return req.ip ?? null;
}

export async function cookieConsentRoutes(app: FastifyInstance): Promise<void> {
  // ============ CATEGORIES ============
  app.post('/consent/categories', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = CategorySchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: upsertCategory(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/consent/categories', async (req, reply) => {
    const q = req.query as { enabled?: string };
    const enabledOnly = q.enabled === '1' || q.enabled === 'true';
    return reply.send({ success: true, data: { categories: listCategories(enabledOnly) } });
  });

  app.get('/consent/categories/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = getCategory(id);
    if (!c) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: c });
  });

  app.delete('/consent/categories/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    try {
      const ok = deleteCategory(id);
      return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(409).send({ success: false, error: (e as Error).message }); }
  });

  // ============ COOKIE DEFINITIONS ============
  app.post('/consent/cookies', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = CookieSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: upsertCookie(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/consent/cookies', async (req, reply) => {
    const q = req.query as { category_id?: string };
    return reply.send({ success: true, data: { cookies: listCookies(q.category_id) } });
  });

  app.delete('/consent/cookies/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const ok = deleteCookie(id);
    return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  // ============ POLICY VERSIONS ============
  app.post('/consent/policies', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = PolicySchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: publishPolicy(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/consent/policies', async (req, reply) => {
    const q = req.query as { limit?: string };
    return reply.send({ success: true, data: { policies: listPolicies(q.limit ? Number(q.limit) : 50) } });
  });

  app.get('/consent/policies/latest', async (req, reply) => {
    const p = getLatestPolicy();
    if (!p) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: p });
  });

  // ============ CONSENT RECORDS ============
  app.post('/consent/records', async (req, reply) => {
    const p = ConsentSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try {
      const rec = recordConsent({
        ...p.data,
        ip: clientIp(req),
        user_agent: (req.headers['user-agent'] as string | undefined) ?? null,
      });
      return reply.code(201).send({ success: true, data: rec });
    } catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/consent/revoke', async (req, reply) => {
    const p = RevokeSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try {
      const rec = revokeConsent({
        ...p.data,
        ip: clientIp(req),
        user_agent: (req.headers['user-agent'] as string | undefined) ?? null,
      });
      return reply.code(201).send({ success: true, data: rec });
    } catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/consent/records', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as { visitor_id?: string; user_id?: string; gdpr?: string; region?: string; limit?: string };
    const records = listConsents({
      visitor_id: q.visitor_id,
      user_id: q.user_id,
      gdpr: q.gdpr !== undefined ? (q.gdpr === '1' || q.gdpr === 'true') : undefined,
      region: q.region,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return reply.send({ success: true, data: { records, total: records.length } });
  });

  app.get('/consent/records/:visitorId/latest', async (req, reply) => {
    const { visitorId } = req.params as { visitorId: string };
    const rec = getLatestConsent(visitorId);
    if (!rec) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: rec });
  });

  app.get('/consent/effective/:visitorId', async (req, reply) => {
    const { visitorId } = req.params as { visitorId: string };
    return reply.send({ success: true, data: getEffectiveConsent(visitorId) });
  });

  // ============ REGION CHECK ============
  app.get('/consent/gdpr-check', async (req, reply) => {
    const q = req.query as { region?: string };
    return reply.send({ success: true, data: { region: q.region ?? null, gdpr: isGdprRegion(q.region) } });
  });

  // ============ STATS ============
  app.get('/consent/stats', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getConsentStats() });
  });
}
