// melodyflix videos - watch queue routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  listQueue, addToQueue, removeFromQueue, clearQueue, reorderQueue, getNextInQueue,
} from '../services/queue.service.js';

const AddSchema = z.object({
  video_id: z.string().min(1),
  at_top: z.boolean().optional(),
});

const ReorderSchema = z.object({
  video_ids: z.array(z.string().min(1)).max(500),
});

export async function queueRoutes(app: FastifyInstance) {
  // GET /queue
  app.get('/queue', async (req, reply) => {
    let uid: string;
    try { uid = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const items = listQueue(uid);
    return reply.send({ items, count: items.length });
  });

  // POST /queue  { video_id, at_top? }
  app.post('/queue', async (req, reply) => {
    let uid: string;
    try { uid = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = AddSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    const item = addToQueue(uid, parsed.data.video_id, parsed.data.at_top ?? false);
    const items = listQueue(uid);
    return reply.send({ item, items, count: items.length });
  });

  // DELETE /queue/:videoId
  app.delete('/queue/:videoId', async (req, reply) => {
    let uid: string;
    try { uid = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { videoId } = req.params as { videoId: string };
    const removed = removeFromQueue(uid, videoId);
    const items = listQueue(uid);
    return reply.send({ removed, items, count: items.length });
  });

  // PUT /queue/reorder  { video_ids: [...] }
  app.put('/queue/reorder', async (req, reply) => {
    let uid: string;
    try { uid = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = ReorderSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    const items = reorderQueue(uid, parsed.data.video_ids);
    return reply.send({ items, count: items.length });
  });

  // DELETE /queue  (clear all)
  app.delete('/queue', async (req, reply) => {
    let uid: string;
    try { uid = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const removed = clearQueue(uid);
    return reply.send({ removed });
  });

  // GET /queue/next?current=VIDEO_ID
  app.get('/queue/next', async (req, reply) => {
    let uid: string;
    try { uid = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { current?: string };
    const next = getNextInQueue(uid, q.current ?? '');
    return reply.send({ next });
  });
}
