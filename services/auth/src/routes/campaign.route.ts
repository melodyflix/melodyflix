// melodyflix auth - email campaign routes (27.1)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  AUDIENCES, listCampaigns, getCampaign, createCampaign, updateCampaign,
  deleteCampaign, previewAudienceSize, sendCampaign, listRecipients,
  getCampaignStats, recordOpen, recordClick,
} from '../services/campaign.service.js';

const CampaignSchema = z.object({
  title: z.string().min(1).max(200),
  subject: z.string().min(1).max(200),
  body_html: z.string().min(1).max(100_000),
  body_text: z.string().max(50_000).nullable().optional(),
  audience: z.enum(['all', 'verified', 'unverified', 'subscribers', 'inactive']).optional(),
});

const UpdateSchema = CampaignSchema.partial().extend({
  status: z.enum(['draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed']).optional(),
  scheduled_at: z.string().datetime().nullable().optional(),
});

function requireAdmin(auth: string | undefined): { id: string } | null {
  try {
    const p = requireAuth(auth);
    if (p.role !== 'admin') return null;
    return { id: p.sub as string };
  } catch { return null; }
}

export async function campaignRoutes(app: FastifyInstance) {
  // GET /campaigns/audiences — list predefined audience types + sizes
  app.get('/campaigns/audiences', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const withSizes = AUDIENCES.map((a) => ({ ...a, size: previewAudienceSize(a.id) }));
    return reply.send({ success: true, data: { audiences: withSizes } });
  });

  // GET /campaigns
  app.get('/campaigns', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const q = req.query as { limit?: string };
    const limit = Math.min(Math.max(parseInt(q.limit ?? '50') || 50, 1), 200);
    return reply.send({ success: true, data: { campaigns: listCampaigns(limit) } });
  });

  // POST /campaigns
  app.post('/campaigns', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const parsed = CampaignSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    try {
      const campaign = createCampaign(parsed.data, admin.id);
      return reply.send({ success: true, data: { campaign } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /campaigns/:id
  app.get('/campaigns/:id', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { id } = req.params as { id: string };
    const campaign = getCampaign(id);
    if (!campaign) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.send({ success: true, data: { campaign, stats: getCampaignStats(id) } });
  });

  // PUT /campaigns/:id
  app.put('/campaigns/:id', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { id } = req.params as { id: string };
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    try {
      const campaign = updateCampaign(id, parsed.data as any);
      return reply.send({ success: true, data: { campaign } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /campaigns/:id
  app.delete('/campaigns/:id', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { id } = req.params as { id: string };
    if (!getCampaign(id)) return reply.code(404).send({ success: false, error: 'Not found' });
    deleteCampaign(id);
    return reply.send({ success: true, data: { deleted: true } });
  });

  // POST /campaigns/:id/send — actually send now
  app.post('/campaigns/:id/send', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { id } = req.params as { id: string };
    try {
      const result = await sendCampaign(id);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /campaigns/:id/recipients
  app.get('/campaigns/:id/recipients', async (req, reply) => {
    const admin = requireAdmin(req.headers.authorization);
    if (!admin) return reply.code(403).send({ success: false, error: 'Admin only' });
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string };
    const limit = Math.min(Math.max(parseInt(q.limit ?? '200') || 200, 1), 1000);
    return reply.send({ success: true, data: { recipients: listRecipients(id, limit) } });
  });

  // ---- Tracking endpoints (public) ----

  // GET /campaigns/:id/open.gif — tracking pixel
  app.get('/campaigns/:id/open.gif', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { u?: string };
    if (q.u) {
      try { recordOpen(id, q.u); } catch {}
    }
    // 1x1 transparent GIF
    const pixel = Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'base64'
    );
    reply.header('Content-Type', 'image/gif');
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return reply.send(pixel);
  });

  // GET /campaigns/:id/click.gif?u=...&to=<url> — click tracker redirect
  app.get('/campaigns/:id/click', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { u?: string; to?: string };
    if (q.u) {
      try { recordClick(id, q.u); } catch {}
    }
    const target = q.to || '/';
    return reply.redirect(target);
  });
}
