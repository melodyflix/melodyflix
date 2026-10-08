// melodyflix videos - chapter routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard, requireRole } from '@melodyflix/shared-auth';
import { getDb } from '@melodyflix/shared-db';
import { getEffectiveChapters, replaceChapters, clearChapters } from '../services/chapter.service.js';

const ChapterItem = z.object({
  start_seconds: z.number().int().min(0),
  title: z.string().min(1).max(150),
});

const SetChaptersSchema = z.object({
  chapters: z.array(ChapterItem).max(100),
});

function checkOwner(videoId: string, userId: string): boolean {
  const db = getDb();
  const v = db.prepare('SELECT owner_id FROM videos WHERE id = ?').get(videoId) as { owner_id: string } | undefined;
  return !!v && v.owner_id === userId;
}

export async function chapterRoutes(app: FastifyInstance) {
  // Get chapters for a video (public — manual first, then auto from description)
  app.get('/:id/chapters', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = getEffectiveChapters(id);
    return reply.send(result);
  });

  // Set (replace) manual chapters — owner only
  app.put('/:id/chapters', { preHandler: [authGuard] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ message: 'Unauthorized' });
    if (!checkOwner(id, userId)) return reply.code(403).send({ message: 'Not your video' });

    const parsed = SetChaptersSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ message: 'Invalid chapters', errors: parsed.error.issues });

    // Sort by start_seconds before saving
    const sorted = [...parsed.data.chapters].sort((a, b) => a.start_seconds - b.start_seconds);
    const saved = replaceChapters(id, sorted);
    return reply.send({ chapters: saved, source: 'manual' });
  });

  // Delete all manual chapters (fallback to auto) — owner only
  app.delete('/:id/chapters', { preHandler: [authGuard] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ message: 'Unauthorized' });
    if (!checkOwner(id, userId)) return reply.code(403).send({ message: 'Not your video' });

    clearChapters(id);
    return reply.send({ ok: true, source: 'auto' });
  });
// ============ ADMIN endpoints (bypass owner check) ============

  // GET /admin/chapters/:id — get chapters for any video
  app.get('/admin/chapters/:id', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const result = getEffectiveChapters(id);
    return reply.send(result);
  });

  // PUT /admin/chapters/:id — set chapters for any video
  app.put('/admin/chapters/:id', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const parsed = SetChaptersSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ message: 'Invalid chapters', errors: parsed.error.issues });
    const sorted = [...parsed.data.chapters].sort((a, b) => a.start_seconds - b.start_seconds);
    const saved = replaceChapters(id, sorted);
    return reply.send({ chapters: saved, source: 'manual' });
  });

  // DELETE /admin/chapters/:id — clear manual chapters
  app.delete('/admin/chapters/:id', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    clearChapters(id);
    return reply.send({ ok: true, source: 'auto' });
  });
}