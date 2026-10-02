// melodyflix videos - intro/outro routes (30.3, 30.5)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import { getDb } from '@melodyflix/shared-db';
import {
  INTRO_TEMPLATES, listChannelIntros, getChannelIntro, setChannelIntro,
  removeChannelIntro, getIntroBundle,
} from '../services/introoutro.service.js';

const SetSchema = z.object({
  kind: z.enum(['intro', 'outro']),
  video_url: z.string().min(1).max(500),
  thumbnail_url: z.string().max(500).nullable().optional(),
  duration_seconds: z.number().int().min(1).max(60).optional(),
  skip_after_seconds: z.number().int().min(0).max(60).optional(),
  is_enabled: z.boolean().optional(),
  template_id: z.string().max(40).nullable().optional(),
});

function checkChannelOwner(channelId: string, userId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT owner_id FROM channels WHERE id = ?').get(channelId) as { owner_id: string } | undefined;
  return row?.owner_id === userId;
}

export async function introOutroRoutes(app: FastifyInstance) {
  // GET /intros/templates — all predefined templates
  app.get('/intros/templates', async (_req, reply) => {
    return reply.send({ success: true, data: { templates: INTRO_TEMPLATES } });
  });

  // GET /channels/:channelId/intros — list intro + outro
  app.get('/channels/:channelId/intros', async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const intros = listChannelIntros(channelId);
    return reply.send({ success: true, data: { intros, bundle: getIntroBundle(channelId) } });
  });

  // GET /channels/:channelId/intros/:kind — single
  app.get('/channels/:channelId/intros/:kind', async (req, reply) => {
    const { channelId, kind } = req.params as { channelId: string; kind: string };
    if (kind !== 'intro' && kind !== 'outro') {
      return reply.code(400).send({ success: false, error: 'kind must be intro or outro' });
    }
    const intro = getChannelIntro(channelId, kind);
    return reply.send({ success: true, data: { intro } });
  });

  // PUT /channels/:channelId/intros — upsert (owner)
  app.put('/channels/:channelId/intros', { preHandler: [requireAuth] }, async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your channel' });
    }
    const parsed = SetSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    try {
      const intro = setChannelIntro(channelId, parsed.data);
      return reply.send({ success: true, data: { intro } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /channels/:channelId/intros/:kind — remove (owner)
  app.delete('/channels/:channelId/intros/:kind', { preHandler: [requireAuth] }, async (req, reply) => {
    const { channelId, kind } = req.params as { channelId: string; kind: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkChannelOwner(channelId, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your channel' });
    }
    if (kind !== 'intro' && kind !== 'outro') {
      return reply.code(400).send({ success: false, error: 'kind must be intro or outro' });
    }
    const removed = removeChannelIntro(channelId, kind);
    return reply.send({ success: true, data: { removed } });
  });
}
