// melodyflix videos - Section 12.1 CDN routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  createProvider, getProvider, listProviders, updateProvider, deleteProvider,
  createRoute, listRoutes, deleteRoute,
  recordHealth, getLatestHealth, listHealth,
  resolveCdn, resolveAllCdns, getCdnStats,
} from '../services/cdn.service.js';

const KIND = ['cloudflare','fastly','cloudfront','bunny','akamai','custom'] as const;
const TIER = ['primary','secondary','fallback'] as const;

const ProviderSchema = z.object({
  kind: z.enum(KIND),
  name: z.string().min(2).max(100),
  base_url: z.string().url().max(500),
  tier: z.enum(TIER).optional(),
  regions: z.array(z.string().max(60)).max(50).optional(),
  api_key_ref: z.string().max(200).nullable().optional(),
});

const UpdateProviderSchema = ProviderSchema.partial().extend({
  enabled: z.boolean().optional(),
});

const RouteSchema = z.object({
  provider_id: z.string().min(1).max(100),
  video_id: z.string().max(100).nullable().optional(),
  region: z.string().max(60).nullable().optional(),
  path_prefix: z.string().max(200).nullable().optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  enabled: z.boolean().optional(),
});

const HealthSchema = z.object({
  status: z.string().min(1).max(40),
  latency_ms: z.number().int().min(0).max(3_600_000).optional(),
  error_rate: z.number().min(0).max(1).optional(),
});

function admin(auth: string | undefined): boolean {
  try { requireRole(auth, ['admin']); return true; } catch { return false; }
}

export async function cdnRoutes(app: FastifyInstance): Promise<void> {
  // ============ PROVIDERS ============
  app.post('/cdn/providers', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = ProviderSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createProvider(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/cdn/providers', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as { kind?: string; tier?: string; enabled?: string };
    const providers = listProviders({
      kind: q.kind as any,
      tier: q.tier as any,
      enabledOnly: q.enabled === '1' || q.enabled === 'true',
    });
    return reply.send({ success: true, data: { providers, total: providers.length } });
  });

  app.get('/cdn/providers/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const provider = getProvider(id);
    if (!provider) return reply.code(404).send({ success: false, error: 'not_found' });
    const latest = getLatestHealth(id);
    return reply.send({ success: true, data: { provider, latest_health: latest } });
  });

  app.patch('/cdn/providers/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const p = UpdateProviderSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    const provider = updateProvider(id, p.data as any);
    if (!provider) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: provider });
  });

  app.delete('/cdn/providers/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    try {
      const ok = deleteProvider(id);
      return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(409).send({ success: false, error: (e as Error).message }); }
  });

  // ============ ROUTES ============
  app.post('/cdn/routes', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = RouteSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createRoute(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/cdn/routes', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as { provider_id?: string; video_id?: string; region?: string; enabled?: string };
    const routes = listRoutes({
      provider_id: q.provider_id,
      video_id: q.video_id,
      region: q.region,
      enabledOnly: q.enabled === '1' || q.enabled === 'true',
    });
    return reply.send({ success: true, data: { routes, total: routes.length } });
  });

  app.delete('/cdn/routes/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const ok = deleteRoute(id);
    return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  // ============ HEALTH ============
  app.post('/cdn/providers/:id/health', async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = HealthSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: recordHealth(id, p.data.status, p.data.latency_ms, p.data.error_rate) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/cdn/providers/:id/health', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.max(1, Math.min(500, Number(q.limit))) : 100;
    return reply.send({ success: true, data: { entries: listHealth(id, limit) } });
  });

  // ============ RESOLUTION (public) ============
  app.get('/cdn/resolve/:videoId', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { region?: string; all?: string };
    if (q.all === '1' || q.all === 'true') {
      return reply.send({ success: true, data: { candidates: resolveAllCdns(videoId, q.region) } });
    }
    const resolved = resolveCdn(videoId, q.region);
    if (!resolved) return reply.code(404).send({ success: false, error: 'no_cdn_route' });
    return reply.send({ success: true, data: resolved });
  });

  // ============ STATS ============
  app.get('/cdn/stats', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getCdnStats() });
  });
}
