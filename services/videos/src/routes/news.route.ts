// melodyflix videos — News Management routes (Section 72)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, verifyJwt, extractBearerToken } from '@melodyflix/shared-auth';
import {
  createNewsItem, getNewsItem, getNewsItemBySlug, updateNewsItem,
  approveNewsItem, rejectNewsItem, publishNewsItem, archiveNewsItem,
  submitForFactCheck, logFactCheck, listFactCheckLog,
  getTickerItems, setTickerVisibility,
  getActiveBreaking, expireBreakingNews, promoteToBreaking,
  listPublishedNews, listReporterArticles, listPendingReview, listPendingFactCheck,
  incrementNewsView, deleteNewsItem,
  type NewsSource,
} from '../services/news.service.js';

const PRIORITIES = ['low', 'normal', 'high', 'breaking'] as const;
const STATUSES = ['draft', 'pending_review', 'approved', 'published', 'archived', 'rejected'] as const;
const VERDICTS = ['verified', 'disputed', 'unverifiable', 'needs_more_sources'] as const;

const SourceSchema = z.object({
  name: z.string().min(1).max(200),
  url: z.string().max(500).nullable().optional(),
  date: z.string().max(50).nullable().optional(),
});

const CreateSchema = z.object({
  title: z.string().min(5).max(250),
  summary: z.string().max(500).optional(),
  body: z.string().max(50000).optional(),
  category: z.string().max(60).optional(),
  priority: z.enum(PRIORITIES).optional(),
  sources: z.array(SourceSchema).max(20).optional(),
  hero_image_url: z.string().max(500).nullable().optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  language: z.string().min(2).max(10).optional(),
  submit_for_review: z.boolean().optional(),
});

const UpdateSchema = z.object({
  title: z.string().min(5).max(250).optional(),
  summary: z.string().max(500).optional(),
  body: z.string().max(50000).optional(),
  category: z.string().max(60).optional(),
  priority: z.enum(PRIORITIES).optional(),
  sources: z.array(SourceSchema).max(20).optional(),
  hero_image_url: z.string().max(500).nullable().optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  submit_for_review: z.boolean().optional(),
});

const PublishSchema = z.object({
  breaking: z.boolean().optional(),
  breaking_ttl_minutes: z.number().int().min(5).max(1440).optional(),
  ticker: z.boolean().optional(),
  ticker_order: z.number().int().min(0).max(1000).optional(),
});

const FactCheckSchema = z.object({
  verdict: z.enum(VERDICTS),
  notes: z.string().max(2000).nullable().optional(),
});

const TickerSchema = z.object({
  visible: z.boolean(),
  order: z.number().int().min(0).max(1000).optional(),
});

const PromoteBreakingSchema = z.object({
  ttl_minutes: z.number().int().min(5).max(1440).optional(),
});

function optionalUser(authorization: string | undefined) {
  const token = extractBearerToken(authorization);
  if (!token) return null;
  try { return verifyJwt(token); } catch { return null; }
}

function requireAuthPayload(auth: string | undefined): { sub: string; role: string } {
  const payload = requireAuth(auth);
  return { sub: payload.sub as string, role: (payload.role as string) ?? 'user' };
}

function isReporterOrAbove(role: string): boolean {
  return role === 'admin' || role === 'creator' || role === 'reporter' || role === 'editor';
}

function isEditorOrAdmin(role: string): boolean {
  return role === 'admin' || role === 'editor';
}

export async function newsRoutes(app: FastifyInstance) {
  // ============================================================
  // Public endpoints
  // ============================================================

  // GET /news — published articles
  app.get('/news', async (req, reply) => {
    const q = req.query as { category?: string; language?: string; limit?: string; offset?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 30, 1), 100) : 30;
    const offset = q.offset ? Math.max(parseInt(q.offset) || 0, 0) : 0;
    const items = listPublishedNews({ category: q.category, language: q.language, limit, offset });
    return reply.send({ success: true, data: { items } });
  });

  // GET /news/breaking — currently active breaking news
  app.get('/news/breaking', async (req, reply) => {
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 10, 1), 50) : 10;
    return reply.send({ success: true, data: { items: getActiveBreaking(limit) } });
  });

  // GET /news/ticker — ticker bar items
  app.get('/news/ticker', async (req, reply) => {
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 20, 1), 100) : 20;
    return reply.send({ success: true, data: { items: getTickerItems(limit) } });
  });

  // GET /news/slug/:slug — single article by slug
  app.get('/news/slug/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const item = getNewsItemBySlug(slug);
    if (!item || item.status !== 'published') {
      return reply.code(404).send({ success: false, error: 'Article not found' });
    }
    incrementNewsView(item.id);
    return reply.send({ success: true, data: item });
  });

  // GET /news/:id — admin/editor/reporter can see any status
  app.get('/news/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = getNewsItem(id);
    if (!item) return reply.code(404).send({ success: false, error: 'Not found' });
    // Published items are public; otherwise require auth
    if (item.status === 'published') {
      incrementNewsView(item.id);
      return reply.send({ success: true, data: item });
    }
    const user = optionalUser(req.headers.authorization);
    if (!user) return reply.code(404).send({ success: false, error: 'Not found' });
    const role = (user.role as string) ?? 'user';
    if (item.reporter_id !== user.sub && !isEditorOrAdmin(role)) {
      return reply.code(403).send({ success: false, error: 'Not authorized' });
    }
    return reply.send({ success: true, data: item });
  });

  // ============================================================
  // 72.3 — Reporter Portal
  // ============================================================

  // POST /news — reporter creates draft
  app.post('/news', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isReporterOrAbove(payload.role)) {
      return reply.code(403).send({ success: false, error: 'Reporter, editor or admin role required' });
    }
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const item = createNewsItem({
        ...parsed.data,
        reporter_id: payload.sub,
        sources: parsed.data.sources as NewsSource[] | undefined,
      });
      return reply.code(201).send({ success: true, data: item });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // PATCH /news/:id — reporter edits draft/pending
  app.patch('/news/:id', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const item = updateNewsItem(id, payload.sub, {
        ...parsed.data,
        sources: parsed.data.sources as NewsSource[] | undefined,
      });
      return reply.send({ success: true, data: item });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /news/reporter/me — my articles
  app.get('/news/reporter/me', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { status?: string; limit?: string };
    const status = STATUSES.includes(q.status as any) ? q.status as any : undefined;
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    const items = listReporterArticles(payload.sub, { status, limit });
    return reply.send({ success: true, data: { items } });
  });

  // POST /news/:id/submit-review — reporter submits for approval
  app.post('/news/:id/submit-review', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      const item = updateNewsItem(id, payload.sub, { submit_for_review: true });
      return reply.send({ success: true, data: item });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // Editorial workflow (editor/admin)
  // ============================================================

  // POST /news/:id/approve
  app.post('/news/:id/approve', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isEditorOrAdmin(payload.role)) return reply.code(403).send({ success: false, error: 'Editor or admin only' });
    const { id } = req.params as { id: string };
    try {
      return reply.send({ success: true, data: approveNewsItem(id, payload.sub) });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /news/:id/reject
  app.post('/news/:id/reject', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isEditorOrAdmin(payload.role)) return reply.code(403).send({ success: false, error: 'Editor or admin only' });
    const body = req.body as { reason?: string };
    const { id } = req.params as { id: string };
    try {
      return reply.send({ success: true, data: rejectNewsItem(id, payload.sub, body.reason ?? '') });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /news/:id/publish
  app.post('/news/:id/publish', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isEditorOrAdmin(payload.role)) return reply.code(403).send({ success: false, error: 'Editor or admin only' });
    const parsed = PublishSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      return reply.send({ success: true, data: publishNewsItem(id, payload.sub, parsed.data) });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /news/:id/archive
  app.post('/news/:id/archive', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isEditorOrAdmin(payload.role)) return reply.code(403).send({ success: false, error: 'Editor or admin only' });
    const { id } = req.params as { id: string };
    try {
      return reply.send({ success: true, data: archiveNewsItem(id, payload.sub) });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /news/editor/pending-review
  app.get('/news/editor/pending-review', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isEditorOrAdmin(payload.role)) return reply.code(403).send({ success: false, error: 'Editor or admin only' });
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    return reply.send({ success: true, data: { items: listPendingReview(limit) } });
  });

  // GET /news/editor/pending-fact-check
  app.get('/news/editor/pending-fact-check', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isEditorOrAdmin(payload.role)) return reply.code(403).send({ success: false, error: 'Editor or admin only' });
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    return reply.send({ success: true, data: { items: listPendingFactCheck(limit) } });
  });

  // ============================================================
  // 72.4 — Fact-checking
  // ============================================================

  // POST /news/:id/submit-fact-check
  app.post('/news/:id/submit-fact-check', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      return reply.send({ success: true, data: submitForFactCheck(id, payload.sub) });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /news/:id/fact-check — editor logs a fact-check verdict
  app.post('/news/:id/fact-check', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isEditorOrAdmin(payload.role)) return reply.code(403).send({ success: false, error: 'Editor or admin only' });
    const parsed = FactCheckSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const log = logFactCheck({
        news_id: id, checker_id: payload.sub,
        verdict: parsed.data.verdict, notes: parsed.data.notes,
      });
      return reply.code(201).send({ success: true, data: log });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /news/:id/fact-check-log
  app.get('/news/:id/fact-check-log', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isEditorOrAdmin(payload.role)) return reply.code(403).send({ success: false, error: 'Editor or admin only' });
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: { logs: listFactCheckLog(id) } });
  });

  // ============================================================
  // 72.1 — Breaking news control
  // ============================================================

  // POST /news/:id/promote-breaking
  app.post('/news/:id/promote-breaking', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isEditorOrAdmin(payload.role)) return reply.code(403).send({ success: false, error: 'Editor or admin only' });
    const parsed = PromoteBreakingSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      return reply.send({ success: true, data: promoteToBreaking(id, payload.sub, parsed.data.ttl_minutes) });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /news/breaking/expire — cron: expire stale breaking items
  app.post('/news/breaking/expire', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isEditorOrAdmin(payload.role)) return reply.code(403).send({ success: false, error: 'Editor or admin only' });
    const expired = expireBreakingNews();
    return reply.send({ success: true, data: { expired } });
  });

  // ============================================================
  // 72.2 — Ticker
  // ============================================================

  // POST /news/:id/ticker
  app.post('/news/:id/ticker', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isEditorOrAdmin(payload.role)) return reply.code(403).send({ success: false, error: 'Editor or admin only' });
    const parsed = TickerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      return reply.send({ success: true, data: setTickerVisibility(id, payload.sub, parsed.data.visible, parsed.data.order) });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // Delete
  // ============================================================

  // DELETE /news/:id
  app.delete('/news/:id', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      const ok = deleteNewsItem(id, payload.sub, payload.role === 'admin');
      if (!ok) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });
}
