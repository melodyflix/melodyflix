// melodyflix videos — Download & Offline routes (Section 21)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  createDownload, getDownload, getDownloadByToken, listUserDownloads,
  deleteDownload, revokeDownload, purgeExpiredDownloads, syncDownloads,
  getDownloadRecommendation,
} from '../services/download.service.js';

const CreateDownloadSchema = z.object({
  video_id: z.string().uuid(),
  quality: z.enum(['144', '240', '360', '480', '720', '1080', '1440', '2160']).optional(),
  device_id: z.string().min(1).max(200).nullable().optional(),
  ttl_days: z.number().int().min(1).max(365).optional(),
});

const SyncSchema = z.object({
  device_id: z.string().min(1).max(200),
  client_ids: z.array(z.string().uuid()).max(500),
});

export async function downloadRoutes(app: FastifyInstance) {
  // POST /downloads — create download entry (21.1, 21.2)
  app.post('/downloads', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = CreateDownloadSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const dl = createDownload({ user_id: userId, ...parsed.data });
      return reply.code(201).send({ success: true, data: dl });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /downloads — list my downloads (optional ?status=ready&device_id=xyz&limit=50)
  app.get('/downloads', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { status?: string; device_id?: string; limit?: string };
    const status = (['pending', 'ready', 'expired', 'revoked'].includes(q.status ?? '')
      ? q.status as any : undefined);
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    const downloads = listUserDownloads(userId, { status, device_id: q.device_id, limit });
    return reply.send({ success: true, data: { downloads } });
  });

  // GET /downloads/recommendation — data saver + quality hint (21.4)
  app.get('/downloads/recommendation', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: getDownloadRecommendation(userId) });
  });

  // GET /downloads/:id
  app.get('/downloads/:id', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const dl = getDownload(id);
    if (!dl || dl.user_id !== userId) return reply.code(404).send({ success: false, error: 'Download not found' });
    return reply.send({ success: true, data: dl });
  });

  // GET /downloads/token/:token — resolve token (used by offline players)
  app.get('/downloads/token/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const dl = getDownloadByToken(token);
    if (!dl) return reply.code(404).send({ success: false, error: 'Invalid token' });
    if (dl.status !== 'ready') return reply.code(410).send({ success: false, error: `Download ${dl.status}` });
    if (new Date(dl.expires_at) < new Date()) return reply.code(410).send({ success: false, error: 'Download expired' });
    return reply.send({ success: true, data: dl });
  });

  // DELETE /downloads/:id
  app.delete('/downloads/:id', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const ok = deleteDownload(id, userId);
    if (!ok) return reply.code(404).send({ success: false, error: 'Download not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // POST /downloads/:id/revoke
  app.post('/downloads/:id/revoke', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const ok = revokeDownload(id, userId);
    if (!ok) return reply.code(404).send({ success: false, error: 'Download not found' });
    return reply.send({ success: true, data: { revoked: true } });
  });

  // POST /downloads/sync — offline sync (21.5)
  app.post('/downloads/sync', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = SyncSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const result = syncDownloads(userId, parsed.data.device_id, parsed.data.client_ids);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /downloads/purge — admin/cron: purge expired (21.3)
  // Note: no auth here intentionally — endpoint should be behind internal network.
  app.post('/downloads/purge', async (_req, reply) => {
    const purged = purgeExpiredDownloads();
    return reply.send({ success: true, data: { purged } });
  });
}
