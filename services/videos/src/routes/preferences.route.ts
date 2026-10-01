// melodyflix videos - user preferences routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  getPreferences, updatePreferences, resetPreferences,
} from '../services/preferences.service.js';

const UpdateSchema = z.object({
  autoplay_next: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
  autoplay_playlist: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
  default_quality: z.enum(['auto', '144', '240', '360', '480', '720', '1080', '1440', '2160']).optional(),
  default_speed: z.number().min(0.25).max(4).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  language: z.string().min(2).max(10).optional(),
  reduced_motion: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
  captions_on: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
});

function toBool01(v: unknown): number | undefined {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v ? 1 : 0;
  return undefined;
}

export async function preferencesRoutes(app: FastifyInstance) {
  // GET /preferences
  app.get('/preferences', async (req, reply) => {
    let uid: string;
    try { uid = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const prefs = getPreferences(uid);
    return reply.send(prefs);
  });

  // PUT /preferences
  app.put('/preferences', async (req, reply) => {
    let uid: string;
    try { uid = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });

    const d = parsed.data;
    const patch: any = {};
    if (d.autoplay_next !== undefined) patch.autoplay_next = toBool01(d.autoplay_next);
    if (d.autoplay_playlist !== undefined) patch.autoplay_playlist = toBool01(d.autoplay_playlist);
    if (d.default_quality !== undefined) patch.default_quality = d.default_quality;
    if (d.default_speed !== undefined) patch.default_speed = d.default_speed;
    if (d.theme !== undefined) patch.theme = d.theme;
    if (d.language !== undefined) patch.language = d.language;
    if (d.reduced_motion !== undefined) patch.reduced_motion = toBool01(d.reduced_motion);
    if (d.captions_on !== undefined) patch.captions_on = toBool01(d.captions_on);

    const prefs = updatePreferences(uid, patch);
    return reply.send(prefs);
  });

  // DELETE /preferences (reset to defaults)
  app.delete('/preferences', async (req, reply) => {
    let uid: string;
    try { uid = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const prefs = resetPreferences(uid);
    return reply.send(prefs);
  });
}
