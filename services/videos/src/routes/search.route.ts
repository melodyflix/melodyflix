// melodyflix videos - search route
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '@melodyflix/shared-auth';
import {
  searchVideos, countSearchResults,
  type SearchSort, type DurationFilter,
} from '../services/video.service.js';
import {
  ensureSearchSchema,
  correctTypo, getSearchSuggestions, normalizeQuery,
  recordSearchHistory, listSearchHistory, listDistinctHistory,
  deleteSearchHistoryEntry, clearSearchHistory,
  recordSearchQuery, recordSearchClick, getSearchAnalyticsSummary,
} from '../services/search.service.js';

const VALID_SORTS: SearchSort[] = ['relevance', 'date', 'views'];
const VALID_DURATIONS: DurationFilter[] = ['any', 'short', 'medium', 'long'];

// Ensure search enhancement tables exist (idempotent)
try { ensureSearchSchema(); } catch { /* will retry on first use */ }

export async function searchRoutes(app: FastifyInstance) {
  // GET /api/v1/videos/search?q=...&sort=...&channel=...&duration=...&limit=...&offset=...
  app.get('/search', async (req, reply) => {
    const q = req.query as {
      q?: string;
      sort?: string;
      channel?: string;
      duration?: string;
      limit?: string;
      offset?: string;
    };

    const query = (q.q ?? '').trim();
    const sort = (VALID_SORTS.includes(q.sort as SearchSort) ? q.sort : 'relevance') as SearchSort;
    const duration = (VALID_DURATIONS.includes(q.duration as DurationFilter) ? q.duration : 'any') as DurationFilter;
    const limit = Math.min(Number(q.limit ?? 50), 100);
    const offset = Number(q.offset ?? 0);

    const videos = searchVideos({
      query,
      sort,
      channelId: q.channel,
      duration,
      limit,
      offset,
    });

    const total = countSearchResults({
      query,
      channelId: q.channel,
      duration,
    });

    return reply.send({
      success: true,
      data: {
        videos,
        total,
        query,
        sort,
        duration,
      },
    });
  });

  // ============ 5.9 Search Suggestions ============

  // GET /search/suggest?q=prefix&limit=8
  app.get('/search/suggest', async (req, reply) => {
    const q = req.query as { q?: string; limit?: string };
    const me = (req as any).user?.id ?? (req as any).user?.sub ?? null;
    const suggestions = getSearchSuggestions(q.q ?? '', {
      userId: me,
      limit: q.limit ? parseInt(q.limit) : 8,
    });
    return reply.send({ success: true, data: { suggestions, count: suggestions.length } });
  });

  // ============ 5.8 Typo-Tolerant Search ============

  // POST /search/typo-correct { query }
  app.post('/search/typo-correct', async (req, reply) => {
    const body = req.body as { query?: string; max_distance?: number };
    if (!body?.query || typeof body.query !== 'string') {
      return reply.code(400).send({ success: false, error: 'query required' });
    }
    const maxDist = typeof body.max_distance === 'number'
      ? Math.max(1, Math.min(body.max_distance, 3))
      : 2;
    const result = correctTypo(body.query, maxDist);
    return reply.send({ success: true, data: result });
  });

  // ============ 5.10 Search History ============

  const HistorySchema = z.object({
    query: z.string().min(1).max(300),
    filters: z.record(z.any()).nullable().optional(),
    result_count: z.number().int().min(0).max(1_000_000).optional(),
  });

  app.get('/search/history', { preHandler: [authGuard] }, async (req, reply) => {
    const me = (req as any).user?.id ?? (req as any).user?.sub;
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const q = req.query as { limit?: string };
    const history = listSearchHistory(me, q.limit ? parseInt(q.limit) : 50);
    return reply.send({ success: true, data: { history, count: history.length } });
  });

  app.get('/search/history/distinct', { preHandler: [authGuard] }, async (req, reply) => {
    const me = (req as any).user?.id ?? (req as any).user?.sub;
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const q = req.query as { limit?: string };
    const queries = listDistinctHistory(me, q.limit ? parseInt(q.limit) : 10);
    return reply.send({ success: true, data: { queries, count: queries.length } });
  });

  app.post('/search/history', { preHandler: [authGuard] }, async (req, reply) => {
    const me = (req as any).user?.id ?? (req as any).user?.sub;
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = HistorySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    const row = recordSearchHistory({
      user_id: me,
      query: parsed.data.query,
      filters: parsed.data.filters ?? null,
      result_count: parsed.data.result_count ?? 0,
    });
    return reply.code(201).send({ success: true, data: { entry: row } });
  });

  app.delete('/search/history/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const me = (req as any).user?.id ?? (req as any).user?.sub;
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const removed = deleteSearchHistoryEntry(id, me);
    return reply.send({ success: true, data: { removed } });
  });

  app.delete('/search/history', { preHandler: [authGuard] }, async (req, reply) => {
    const me = (req as any).user?.id ?? (req as any).user?.sub;
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const cleared = clearSearchHistory(me);
    return reply.send({ success: true, data: { cleared } });
  });

  // ============ 5.11 Search Analytics ============

  const AnalyticsSchema = z.object({
    query: z.string().min(1).max(300),
    filters: z.record(z.any()).nullable().optional(),
    result_count: z.number().int().min(0).max(1_000_000).optional(),
  });

  const ClickSchema = z.object({
    query: z.string().min(1).max(300),
    video_id: z.string().min(1),
  });

  // POST /search/analytics — record a search (public, best-effort)
  app.post('/search/analytics', async (req, reply) => {
    const parsed = AnalyticsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    const me = (req as any).user?.id ?? (req as any).user?.sub ?? null;
    try {
      recordSearchQuery({
        user_id: me,
        query: parsed.data.query,
        filters: parsed.data.filters ?? null,
        result_count: parsed.data.result_count ?? 0,
      });
      return reply.code(202).send({ success: true, data: { recorded: true } });
    } catch (e: any) {
      return reply.code(500).send({ success: false, error: e?.message ?? 'Record failed' });
    }
  });

  // POST /search/analytics/click — attach click to last unclicked search
  app.post('/search/analytics/click', async (req, reply) => {
    const parsed = ClickSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    recordSearchClick(parsed.data.query, parsed.data.video_id);
    return reply.send({ success: true, data: { recorded: true } });
  });

  // GET /search/analytics/summary — aggregate stats (admin)
  app.get('/search/analytics/summary', { preHandler: [authGuard] }, async (req, reply) => {
    const me = (req as any).user;
    const roles = me?.roles ?? [];
    if (!Array.isArray(roles) || !roles.includes('admin')) {
      return reply.code(403).send({ success: false, error: 'Admin only' });
    }
    const q = req.query as { from?: string; to?: string; top?: string };
    const summary = getSearchAnalyticsSummary({
      from: q.from,
      to: q.to,
      topLimit: q.top ? parseInt(q.top) : undefined,
    });
    return reply.send({ success: true, data: summary });
  });

}
