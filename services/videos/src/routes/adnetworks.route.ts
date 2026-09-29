// melodyflix videos - ad network management routes (admin)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  createAdNetwork, listAdNetworks, getAdNetworkById, updateAdNetwork, deleteAdNetwork,
} from '../services/vast.service.js';
import {
  createAd, listAds, getAdById, updateAd as updateAdSvc, deleteAd as deleteAdSvc, getAdStats,
  recordImpression, recordClick,
} from '../services/ads.service.js';

const CreateNetworkSchema = z.object({
  name: z.string().min(1).max(100),
  vast_tag_url: z.string().url(),
  type: z.enum(['pre-roll', 'mid-roll', 'post-roll']).optional(),
  weight: z.number().int().min(1).max(100).optional(),
  priority: z.number().int().min(0).max(100).optional(),
});

const UpdateNetworkSchema = CreateNetworkSchema.partial().extend({
  active: z.number().int().min(0).max(1).optional(),
});

export async function adNetworkRoutes(app: FastifyInstance) {
  // GET /api/v1/videos/admin/ad-networks
  app.get('/ad-networks', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const networks = listAdNetworks();
    return reply.send({ success: true, data: { networks } });
  });

  // POST /api/v1/videos/admin/ad-networks
  app.post('/ad-networks', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const parsed = CreateNetworkSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const adn = createAdNetwork(parsed.data);
      return reply.code(201).send({ success: true, data: adn });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // PATCH /api/v1/videos/admin/ad-networks/:id
  app.patch('/ad-networks/:id', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const parsed = UpdateNetworkSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const { id } = req.params as { id: string };
      const updated = updateAdNetwork(id, parsed.data);
      return reply.send({ success: true, data: updated });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /api/v1/videos/admin/ad-networks/:id
  app.delete('/ad-networks/:id', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    try {
      const { id } = req.params as { id: string };
      deleteAdNetwork(id);
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /api/v1/videos/ad-config/:videoId — public: which ad to serve
  app.get('/ad-config/:videoId', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    try {
      // This is for the frontend to know which ad tag to load
      const { pickAdWithFallback } = await import('../services/vast.service.js');
      const { pickAdForType } = await import('../services/ads.service.js');
      const selected = pickAdWithFallback('pre-roll', pickAdForType('pre-roll'));
      return reply.send({ success: true, data: selected });
    } catch (err) {
      return reply.send({ success: true, data: { source: 'internal' } });
    }
  });

  // ============ INTERNAL ADS ============

  // GET /api/v1/videos/admin/ads
  app.get('/ads', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const ads = listAds();
    const stats = getAdStats();
    return reply.send({ success: true, data: { ads, stats } });
  });

  // POST /api/v1/videos/admin/ads
  app.post('/ads', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const parsed = CreateAdSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const ad = createAd(parsed.data);
      return reply.code(201).send({ success: true, data: ad });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // PATCH /api/v1/videos/admin/ads/:id
  app.patch('/ads/:id', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const parsed = UpdateAdSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const { id } = req.params as { id: string };
      const updated = updateAdSvc(id, parsed.data);
      return reply.send({ success: true, data: updated });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /api/v1/videos/admin/ads/:id
  app.delete('/ads/:id', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    try {
      const { id } = req.params as { id: string };
      deleteAdSvc(id);
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /api/v1/videos/admin/ads/:id/impression
  app.post('/ads/:id/impression', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { video_id } = (req.body ?? {}) as { video_id?: string };
    const user = extractBearerToken(req.headers.authorization)
      ? (await import('@melodyflix/shared-auth')).verifyJwt(
          extractBearerToken(req.headers.authorization)!
        )
      : null;
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      ?? req.ip ?? null;
    try {
      recordImpression(id, user?.sub ?? null, video_id ?? null, ip);
      return reply.send({ success: true, data: { recorded: true } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /api/v1/videos/admin/ads/:id/click
  app.post('/ads/:id/click', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { video_id } = (req.body ?? {}) as { video_id?: string };
    const user = extractBearerToken(req.headers.authorization)
      ? (await import('@melodyflix/shared-auth')).verifyJwt(
          extractBearerToken(req.headers.authorization)!
        )
      : null;
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      ?? req.ip ?? null;
    try {
      recordClick(id, user?.sub ?? null, video_id ?? null, ip);
      return reply.send({ success: true, data: { recorded: true } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });
}
