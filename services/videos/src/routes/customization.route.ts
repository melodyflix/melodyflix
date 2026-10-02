// melodyflix videos - player customization routes (30.1, 30.2, 30.4, 30.8)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import { getDb } from '@melodyflix/shared-db';
import {
  getCustomization, setCustomization, resetCustomization,
  buildCssFilter, FILTER_PRESETS, COLOR_GRADING_PRESETS,
} from '../services/customization.service.js';

const CustomizationSchema = z.object({
  accent_color: z.string().max(20).optional(),
  background_color: z.string().max(20).optional(),
  progress_color: z.string().max(20).optional(),
  logo_url: z.string().max(500).nullable().optional(),
  logo_position: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).optional(),
  logo_opacity: z.number().min(0).max(1).optional(),
  watermark_text: z.string().max(100).nullable().optional(),
  filter_preset: z.string().max(40).optional(),
  brightness: z.number().min(0.5).max(1.5).optional(),
  contrast: z.number().min(0.5).max(1.5).optional(),
  saturation: z.number().min(0).max(2).optional(),
  hue_rotate: z.number().min(-180).max(180).optional(),
  sepia: z.number().min(0).max(1).optional(),
  blur: z.number().min(0).max(5).optional(),
  color_grading_preset: z.string().max(40).optional(),
  tint_r: z.number().int().min(0).max(255).optional(),
  tint_g: z.number().int().min(0).max(255).optional(),
  tint_b: z.number().int().min(0).max(255).optional(),
  tint_alpha: z.number().min(0).max(0.5).optional(),
});

function checkChannelOwner(channelId: string, userId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT owner_id FROM channels WHERE id = ?').get(channelId) as { owner_id: string } | undefined;
  return row?.owner_id === userId;
}

export async function customizationRoutes(app: FastifyInstance) {
  // GET /customizations/presets — filter + color grading preset list (public)
  app.get('/customizations/presets', async (_req, reply) => {
    const filters = Object.keys(FILTER_PRESETS).map((k) => ({ id: k, label: k.charAt(0).toUpperCase() + k.slice(1) }));
    const grading = Object.entries(COLOR_GRADING_PRESETS).map(([k, v]) => ({ id: k, label: v.label }));
    return reply.send({ success: true, data: { filters, grading } });
  });

  // GET /channels/:channelId/customization — public read
  app.get('/channels/:channelId/customization', async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const c = getCustomization(channelId);
    return reply.send({
      success: true,
      data: { customization: c, css_filter: buildCssFilter(c) },
    });
  });

  // PUT /channels/:channelId/customization — owner only
  app.put('/channels/:channelId/customization', { preHandler: [requireAuth] }, async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your channel' });
    }
    const parsed = CustomizationSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    try {
      const c = setCustomization(channelId, parsed.data);
      return reply.send({
        success: true,
        data: { customization: c, css_filter: buildCssFilter(c) },
      });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /channels/:channelId/customization — owner only
  app.delete('/channels/:channelId/customization', { preHandler: [requireAuth] }, async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your channel' });
    }
    const c = resetCustomization(channelId);
    return reply.send({ success: true, data: { customization: c, css_filter: buildCssFilter(c) } });
  });
}
