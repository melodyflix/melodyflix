// melodyflix videos - promotional banner routes (27.4)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, verifyJwt, extractBearerToken } from '@melodyflix/shared-auth';
import {
  listActiveBanners, listAllBanners, createBanner, updateBanner,
  deleteBanner, dismissBanner, getBanner, clearDismissals,
} from '../services/banner.service.js';

const BannerSchema = z.object({
  title: z.string().min(1).max(200),
  message: z.string().max(500).nullable().optional(),
  cta_label: z.string().max(50).nullable().optional(),
  cta_url: z.string().max(500).nullable().optional(),
  bg_color: z.string().max(20).optional(),
  text_color: z.string().max(20).optional(),
  placement: z.enum(['top', 'bottom', 'home', 'watch']).optional(),
  is_active: z.boolean().optional(),
  priority: z.number().int().min(0).max(100).optional(),
  starts_at: z.string().datetime().nullable().optional(),
  ends_at: z.string().datetime().nullable().optional(),
  dismissible: z.boolean().optional(),
});

const UpdateSchema = BannerSchema.partial();

function optionalUser(authorization: string | undefined): { id: string; role?: string } | null {
  const token = extractBearerToken(authorization);
  if (!token) return null;
  try {
    const p = verifyJwt(token);
    return { id: p.sub as string, role: p.role as string | undefined };
  } catch { return null; }
}

function requireAdmin(authorization: string | undefined): { id: string; role: string } | null {
  const u = optionalUser(authorization);
  if (!u) return null;
  if (u.role !== 'admin') return null;
  return { id: u.id, role: u.role };
}

export async function bannerRoutes(app: FastifyInstance) {
  // GET /banners — public active banners (filters dismissed for signed-in user)
  app.get('/banners', async (req, reply) => {
    const q = req.query as { placement?: string };
    const user = optionalUser(req.headers.authorization);
    const banners = listActiveBanners({ placement: q.placement, userId: user?.id ?? null });
    return reply.send({ success: true, data: { banners } });
  });

  // POST /banners/:id/dismiss — signed-in user dismisses a banner
  app.post('/banners/:id/dismiss', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const b = getBanner(id);
    if (!b) return reply.code(404).send({ success: false, error: 'Banner not found' });
    if (b.dismissible !== 1) return reply.code(400).send({ success: false, error: 'Banner is not dismissible' });
    dismissBanner(userId, id);
    return reply.send({ success: true, data: { dismissed: true } });
  });

  // ---- Admin endpoints ----

  // GET /admin/banners — list all
  app.get('/admin/banners', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const banners = listAllBanners();
    return reply.send({ success: true, data: { banners } });
  });

  // POST /admin/banners — create
  app.post('/admin/banners', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const parsed = BannerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    try {
      const banner = createBanner(parsed.data, admin.id);
      return reply.send({ success: true, data: { banner } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // PUT /admin/banners/:id — update
  app.put('/admin/banners/:id', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { id } = req.params as { id: string };
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    try {
      const banner = updateBanner(id, parsed.data);
      return reply.send({ success: true, data: { banner } });
    } catch (err) {
      return reply.code(404).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /admin/banners/:id/clear-dismissals — reset dismissal tracking
  app.post('/admin/banners/:id/clear-dismissals', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { id } = req.params as { id: string };
    if (!getBanner(id)) return reply.code(404).send({ success: false, error: 'Banner not found' });
    clearDismissals(id);
    return reply.send({ success: true, data: { ok: true } });
  });

  // DELETE /admin/banners/:id
  app.delete('/admin/banners/:id', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { id } = req.params as { id: string };
    if (!getBanner(id)) return reply.code(404).send({ success: false, error: 'Banner not found' });
    deleteBanner(id);
    return reply.send({ success: true, data: { deleted: true } });
  });
}
