// melodyflix videos - transcode admin routes (32.1-32.4, 32.8)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  DEFAULT_QUALITY_LADDER, listTranscodeCache, getTranscodeCacheStats,
  clearTranscodeCache, getCachedTranscode,
} from '../services/transcode.service.js';

export async function transcodeRoutes(app: FastifyInstance) {
  // GET /transcode/qualities — public: list available quality levels
  app.get('/transcode/qualities', async (_req, reply) => {
    return reply.send({ success: true, data: { qualities: DEFAULT_QUALITY_LADDER } });
  });

  // GET /transcode/codecs — public: list supported codecs
  app.get('/transcode/codecs', async (_req, reply) => {
    return reply.send({
      success: true,
      data: {
        codecs: [
          { id: 'h264', label: 'H.264 / AVC', note: 'Universal browser support' },
          { id: 'h265', label: 'H.265 / HEVC', note: 'Better compression, Safari/Edge/modern browsers' },
          { id: 'av1',  label: 'AV1',           note: 'Best compression, newest browsers' },
        ],
      },
    });
  });

  // GET /transcode/admin/cache — admin: list cache entries
  app.get('/transcode/admin/cache', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(Number(q.limit ?? 100), 500);
    const offset = Number(q.offset ?? 0);
    return reply.send({ success: true, data: { entries: listTranscodeCache(limit, offset) } });
  });

  // GET /transcode/admin/cache/stats — admin
  app.get('/transcode/admin/cache/stats', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: getTranscodeCacheStats() });
  });

  // GET /transcode/admin/cache/:key — admin: single entry
  app.get('/transcode/admin/cache/:key', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { key } = req.params as { key: string };
    const e = getCachedTranscode(key);
    if (!e) return reply.code(404).send({ success: false, error: 'Cache entry not found' });
    return reply.send({ success: true, data: e });
  });

  // DELETE /transcode/admin/cache — admin: clear all OR ?key=
  app.delete('/transcode/admin/cache', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { key?: string };
    const n = clearTranscodeCache(q.key);
    return reply.send({ success: true, data: { deleted: n } });
  });

  // POST /transcode/admin/cache/evict — admin: LRU evict to keep total entries <= limit
  app.post('/transcode/admin/cache/evict', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const BodySchema = z.object({ max_entries: z.number().int().min(1).max(100000) });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const all = listTranscodeCache(100000, 0);
    const excess = all.length - parsed.data.max_entries;
    if (excess <= 0) return reply.send({ success: true, data: { evicted: 0 } });

    // listTranscodeCache orders by last_used_at DESC; tail are oldest
    const oldest = all.slice(all.length - excess);
    let evicted = 0;
    for (const e of oldest) {
      evicted += clearTranscodeCache(e.cache_key);
    }
    return reply.send({ success: true, data: { evicted } });
  });
}
