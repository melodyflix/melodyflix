// melodyflix videos — Content Worker & RSS routes (Section 37 worker layer)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import { runContentWorker, processSource, getContentWorkerStats } from '../services/content-worker.service.js';
import { fetchRssFeed, parseRssXml, getFeedCache, ensureRssParserSchema } from '../services/rss-parser.service.js';
import { getContentSource } from '../services/content-source.service.js';

const RunWorkerSchema = z.object({
  max_sources: z.number().int().min(1).max(100).optional(),
  dry_run: z.boolean().optional(),
});

const ProcessOneSchema = z.object({
  source_id: z.string().uuid(),
});

const FetchRssSchema = z.object({
  url: z.string().url().max(500),
  use_cache_headers: z.boolean().optional(),
});

const ParseRssSchema = z.object({
  xml: z.string().min(1).max(5_000_000),
});

function requireAdmin(authorization: string | undefined): { ok: boolean; userId?: string; error?: string } {
  try {
    const payload = requireAuth(authorization);
    if (payload.role !== 'admin') return { ok: false, error: 'Admin only' };
    return { ok: true, userId: payload.sub as string };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function contentWorkerRoutes(app: FastifyInstance) {
  ensureRssParserSchema();

  // ============================================================
  // Worker control
  // ============================================================

  // POST /content-worker/run — trigger a worker cycle (admin)
  app.post('/content-worker/run', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const parsed = RunWorkerSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const result = await runContentWorker({
        max_sources: parsed.data.max_sources,
        dry_run: parsed.data.dry_run,
      });
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(500).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /content-worker/process-one — process a specific source (admin)
  app.post('/content-worker/process-one', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const parsed = ProcessOneSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const src = getContentSource(parsed.data.source_id);
    if (!src) return reply.code(404).send({ success: false, error: 'Source not found' });
    try {
      const result = await processSource(src);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(500).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /content-worker/stats — worker dashboard (admin)
  app.get('/content-worker/stats', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    return reply.send({ success: true, data: getContentWorkerStats() });
  });

  // ============================================================
  // RSS utilities
  // ============================================================

  // POST /content-worker/rss/fetch — fetch + parse a URL (admin)
  app.post('/content-worker/rss/fetch', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const parsed = FetchRssSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const feed = await fetchRssFeed(parsed.data.url, { use_cache_headers: parsed.data.use_cache_headers });
      return reply.send({ success: true, data: feed });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /content-worker/rss/parse — parse XML directly (admin)
  app.post('/content-worker/rss/parse', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const parsed = ParseRssSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const feed = parseRssXml(parsed.data.xml);
      return reply.send({ success: true, data: feed });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /content-worker/rss/cache?url=... (admin)
  app.get('/content-worker/rss/cache', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const q = req.query as { url?: string };
    if (!q.url) return reply.code(400).send({ success: false, error: 'url required' });
    const cache = getFeedCache(q.url);
    if (!cache) return reply.code(404).send({ success: false, error: 'No cache entry' });
    return reply.send({ success: true, data: cache });
  });
}
