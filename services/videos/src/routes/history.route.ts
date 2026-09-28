// melodyflix videos - watch history routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  recordHistory, listHistoryWithData, countHistory,
  removeHistoryEntry, clearHistory, getResumePosition,
} from '../services/comment.service.js';

const RecordSchema = z.object({
  position: z.number().min(0).optional(),
});

export async function historyRoutes(app: FastifyInstance) {
  // POST /api/v1/videos/:videoId/history — record/update watch
  app.post('/:videoId/history', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = RecordSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    }
    try {
      const { videoId } = req.params as { videoId: string };
      recordHistory(user.sub, videoId, parsed.data.position ?? 0);
      return reply.send({ success: true, data: { recorded: true } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /api/v1/videos/history/list
  app.get('/history/list', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(Number(q.limit ?? 100), 200);
    const offset = Number(q.offset ?? 0);
    const videos = listHistoryWithData(user.sub, limit, offset);
    return reply.send({
      success: true,
      data: { videos, total: countHistory(user.sub) },
    });
  });

  // GET /api/v1/videos/:videoId/resume — resume position
  app.get('/:videoId/resume', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const { videoId } = req.params as { videoId: string };
    return reply.send({
      success: true,
      data: { position: getResumePosition(user.sub, videoId) },
    });
  });

  // DELETE /api/v1/videos/:videoId/history — remove one
  app.delete('/:videoId/history', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const { videoId } = req.params as { videoId: string };
    const ok = removeHistoryEntry(user.sub, videoId);
    if (!ok) return reply.code(404).send({ success: false, error: 'History entry not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // DELETE /api/v1/videos/history/all — clear all
  app.delete('/history/all', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const count = clearHistory(user.sub);
    return reply.send({ success: true, data: { deleted: count } });
  });
}
