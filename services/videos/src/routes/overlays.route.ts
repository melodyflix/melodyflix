// melodyflix videos - lower thirds + transitions routes (30.6, 30.7)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '@melodyflix/shared-auth';
import { getDb } from '@melodyflix/shared-db';
import {
  LOWER_THIRD_STYLES, LOWER_THIRD_ANIMATIONS, TRANSITION_PRESETS,
  listLowerThirds, createLowerThird, updateLowerThird, deleteLowerThird,
  getChannelTransition, setChannelTransition, resetChannelTransition,
  buildTransitionCss,
} from '../services/overlays.service.js';

const LowerThirdSchema = z.object({
  title: z.string().min(1).max(150),
  subtitle: z.string().max(200).nullable().optional(),
  accent_color: z.string().max(30).optional(),
  text_color: z.string().max(30).optional(),
  bg_color: z.string().max(50).optional(),
  position: z.enum(['left', 'center', 'right']).optional(),
  style: z.enum(['minimal', 'solid', 'glass', 'accent', 'bar']).optional(),
  animation: z.enum(['slide-up', 'slide-left', 'fade', 'pop']).optional(),
  start_seconds: z.number().min(0).max(86400).optional(),
  end_seconds: z.number().min(0).max(86400).optional(),
  is_enabled: z.boolean().optional(),
});

const TransitionSchema = z.object({
  intro_to_video: z.enum(['none', 'fade', 'slide-left', 'slide-right', 'zoom-in', 'dissolve', 'wipe', 'glitch']).optional(),
  video_to_outro: z.enum(['none', 'fade', 'slide-left', 'slide-right', 'zoom-in', 'dissolve', 'wipe', 'glitch']).optional(),
  duration_ms: z.number().int().min(200).max(2000).optional(),
});

function checkChannelOwner(channelId: string, userId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT owner_id FROM channels WHERE id = ?').get(channelId) as { owner_id: string } | undefined;
  return row?.owner_id === userId;
}

export async function overlaysRoutes(app: FastifyInstance) {
  // GET /overlays/presets — public styles + animations + transitions
  app.get('/overlays/presets', async (_req, reply) => {
    return reply.send({
      success: true,
      data: {
        lower_third_styles: LOWER_THIRD_STYLES,
        lower_third_animations: LOWER_THIRD_ANIMATIONS,
        transitions: TRANSITION_PRESETS,
      },
    });
  });

  // ============ Lower Thirds ============

  // GET /channels/:channelId/lower-thirds
  app.get('/channels/:channelId/lower-thirds', async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    return reply.send({ success: true, data: { lower_thirds: listLowerThirds(channelId) } });
  });

  // POST /channels/:channelId/lower-thirds (owner)
  app.post('/channels/:channelId/lower-thirds', { preHandler: [authGuard] }, async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    const parsed = LowerThirdSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    try {
      const lt = createLowerThird(channelId, parsed.data);
      return reply.send({ success: true, data: { lower_third: lt } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // PUT /channels/:channelId/lower-thirds/:id (owner)
  app.put('/channels/:channelId/lower-thirds/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const { channelId, id } = req.params as { channelId: string; id: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    const parsed = LowerThirdSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    try {
      const lt = updateLowerThird(id, parsed.data as any);
      return reply.send({ success: true, data: { lower_third: lt } });
    } catch (err) {
      return reply.code(404).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /channels/:channelId/lower-thirds/:id (owner)
  app.delete('/channels/:channelId/lower-thirds/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const { channelId, id } = req.params as { channelId: string; id: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    const ok = deleteLowerThird(id);
    return reply.send({ success: true, data: { removed: ok } });
  });

  // ============ Transitions ============

  // GET /channels/:channelId/transition
  app.get('/channels/:channelId/transition', async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const t = getChannelTransition(channelId);
    return reply.send({
      success: true,
      data: {
        transition: t,
        css_intro_to_video: buildTransitionCss(t.intro_to_video, t.duration_ms),
        css_video_to_outro: buildTransitionCss(t.video_to_outro, t.duration_ms),
      },
    });
  });

  // PUT /channels/:channelId/transition (owner)
  app.put('/channels/:channelId/transition', { preHandler: [authGuard] }, async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    const parsed = TransitionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    const t = setChannelTransition(channelId, parsed.data);
    return reply.send({
      success: true,
      data: {
        transition: t,
        css_intro_to_video: buildTransitionCss(t.intro_to_video, t.duration_ms),
        css_video_to_outro: buildTransitionCss(t.video_to_outro, t.duration_ms),
      },
    });
  });

  // DELETE /channels/:channelId/transition (owner)
  app.delete('/channels/:channelId/transition', { preHandler: [authGuard] }, async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) return reply.code(403).send({ success: false, error: 'Not your channel' });
    const t = resetChannelTransition(channelId);
    return reply.send({ success: true, data: { transition: t } });
  });
}
