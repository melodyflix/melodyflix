// melodyflix videos — Auto Content Upload routes (Section 37)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  createContentSource, getContentSource, listContentSources, updateContentSource,
  approveSource, rejectSource, pauseSource, resumeSource, deleteContentSource,
  markSourceFetched, listDueContentSources,
  computeContentHash, isDuplicateContent, isDuplicateGlobally,
  createFetchJob, getFetchJob, listFetchJobs,
  markJobFetching, markJobImporting, markJobCompleted, markJobDuplicate,
  markJobRejected, markJobFailed,
  listRetryableJobs, scheduleRetry,
  runQualityCheck, runCopyrightCheck, decidePublishAction,
  applySourceDefaults, deleteFetchJob, pruneOldJobs,
} from '../services/content-source.service.js';

const SOURCE_TYPES = ['rss', 'atom', 'tmdb_list', 'tmdb_search', 'manual'] as const;
const CONTENT_KINDS = ['movie', 'tv', 'drama', 'song', 'news', 'web_series', 'podcast', 'other'] as const;
const PUBLISH_POLICIES = ['auto_publish', 'draft_only', 'requires_approval'] as const;
const SOURCE_STATUSES = ['pending_approval', 'active', 'paused', 'rejected', 'error'] as const;
const JOB_STATUSES = ['queued', 'fetching', 'importing', 'completed', 'failed', 'skipped_duplicate', 'rejected'] as const;

const CreateSourceSchema = z.object({
  name: z.string().min(1).max(120),
  source_type: z.enum(SOURCE_TYPES),
  content_kind: z.enum(CONTENT_KINDS),
  url: z.string().min(1).max(500),
  fetch_interval_minutes: z.number().int().min(5).max(1440).optional(),
  publish_policy: z.enum(PUBLISH_POLICIES).optional(),
  default_channel_id: z.string().uuid().nullable().optional(),
  auto_tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  auto_category: z.string().max(80).nullable().optional(),
  copyright_check_enabled: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const UpdateSourceSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  fetch_interval_minutes: z.number().int().min(5).max(1440).optional(),
  publish_policy: z.enum(PUBLISH_POLICIES).optional(),
  default_channel_id: z.string().uuid().nullable().optional(),
  auto_tags: z.array(z.string().min(1).max(50)).max(20).nullable().optional(),
  auto_category: z.string().max(80).nullable().optional(),
  copyright_check_enabled: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const CreateJobSchema = z.object({
  external_id: z.string().max(200).nullable().optional(),
  source_url: z.string().max(500).nullable().optional(),
  title: z.string().max(300).nullable().optional(),
  metadata: z.record(z.string(), z.any()).nullable().optional(),
  skip_duplicate_check: z.boolean().optional(),
});

const CompleteJobSchema = z.object({
  video_id: z.string().uuid(),
  metadata: z.record(z.string(), z.any()).nullable().optional(),
});

const FailJobSchema = z.object({
  error_message: z.string().min(1).max(1000),
});

const RejectJobSchema = z.object({
  reason: z.string().min(1).max(500),
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

export async function contentSourceRoutes(app: FastifyInstance) {
  // ============================================================
  // 37.9 / 37.19 — Source management (admin)
  // ============================================================

  // POST /content-sources
  app.post('/content-sources', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const parsed = CreateSourceSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const source = createContentSource({
        ...parsed.data,
        created_by: auth.userId!,
        auto_approve: false, // always start in pending_approval
      });
      return reply.code(201).send({ success: true, data: source });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /content-sources?status=&content_kind=&limit=&offset=
  app.get('/content-sources', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const q = req.query as any;
    const status = SOURCE_STATUSES.includes(q.status) ? q.status : undefined;
    const kind = CONTENT_KINDS.includes(q.content_kind) ? q.content_kind : undefined;
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    const offset = q.offset ? Math.max(parseInt(q.offset) || 0, 0) : 0;
    const sources = listContentSources({ status, content_kind: kind, limit, offset });
    return reply.send({ success: true, data: { sources } });
  });

  // GET /content-sources/due — sources due for fetch (worker/cron uses this)
  app.get('/content-sources/due', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    return reply.send({ success: true, data: { sources: listDueContentSources(limit) } });
  });

  // GET /content-sources/:id
  app.get('/content-sources/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const { id } = req.params as { id: string };
    const source = getContentSource(id);
    if (!source) return reply.code(404).send({ success: false, error: 'Source not found' });
    return reply.send({ success: true, data: source });
  });

  // PATCH /content-sources/:id
  app.patch('/content-sources/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const parsed = UpdateSourceSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const source = updateContentSource(id, parsed.data);
      return reply.send({ success: true, data: source });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /content-sources/:id/approve  (37.19)
  app.post('/content-sources/:id/approve', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const { id } = req.params as { id: string };
    try {
      const source = approveSource(id, auth.userId!);
      return reply.send({ success: true, data: source });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /content-sources/:id/reject
  app.post('/content-sources/:id/reject', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const body = req.body as { reason?: string };
    if (!body.reason || body.reason.trim().length < 1) {
      return reply.code(400).send({ success: false, error: 'reason required' });
    }
    const { id } = req.params as { id: string };
    try {
      const source = rejectSource(id, auth.userId!, body.reason);
      return reply.send({ success: true, data: source });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /content-sources/:id/pause
  app.post('/content-sources/:id/pause', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const { id } = req.params as { id: string };
    try {
      return reply.send({ success: true, data: pauseSource(id) });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /content-sources/:id/resume
  app.post('/content-sources/:id/resume', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const { id } = req.params as { id: string };
    try {
      return reply.send({ success: true, data: resumeSource(id) });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /content-sources/:id
  app.delete('/content-sources/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const { id } = req.params as { id: string };
    const ok = deleteContentSource(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Source not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // POST /content-sources/:id/fetched — worker reports fetch completed
  app.post('/content-sources/:id/fetched', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const body = req.body as { success?: boolean; imports_count?: number };
    const { id } = req.params as { id: string };
    markSourceFetched(id, { success: body.success !== false, importsCount: body.imports_count });
    return reply.send({ success: true, data: getContentSource(id) });
  });

  // ============================================================
  // Fetch jobs (37.1-37.4, 37.13, 37.14, 37.21, 37.22)
  // ============================================================

  // POST /content-sources/:id/jobs — enqueue a job (with dedupe)
  app.post('/content-sources/:id/jobs', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const parsed = CreateJobSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const job = createFetchJob({ source_id: id, ...parsed.data });
      const isDup = job.status === 'skipped_duplicate';
      return reply.code(isDup ? 200 : 201).send({ success: true, data: job, duplicate: isDup });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /content-sources/jobs?source_id=&status=&limit=&offset=
  app.get('/content-sources/jobs', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const q = req.query as any;
    const status = JOB_STATUSES.includes(q.status) ? q.status : undefined;
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    const offset = q.offset ? Math.max(parseInt(q.offset) || 0, 0) : 0;
    const jobs = listFetchJobs({ source_id: q.source_id, status, limit, offset });
    return reply.send({ success: true, data: { jobs } });
  });

  // GET /content-sources/jobs/retryable — 37.22
  app.get('/content-sources/jobs/retryable', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    return reply.send({ success: true, data: { jobs: listRetryableJobs(limit) } });
  });

  // GET /content-sources/jobs/:id
  app.get('/content-sources/jobs/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const { id } = req.params as { id: string };
    const job = getFetchJob(id);
    if (!job) return reply.code(404).send({ success: false, error: 'Job not found' });
    return reply.send({ success: true, data: job });
  });

  // POST /content-sources/jobs/:id/fetching
  app.post('/content-sources/jobs/:id/fetching', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: markJobFetching(id) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // POST /content-sources/jobs/:id/importing
  app.post('/content-sources/jobs/:id/importing', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: markJobImporting(id) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // POST /content-sources/jobs/:id/complete
  app.post('/content-sources/jobs/:id/complete', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const parsed = CompleteJobSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: markJobCompleted(id, parsed.data.video_id, parsed.data.metadata ?? undefined) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // POST /content-sources/jobs/:id/duplicate
  app.post('/content-sources/jobs/:id/duplicate', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const body = req.body as { note?: string };
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: markJobDuplicate(id, body.note) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // POST /content-sources/jobs/:id/reject
  app.post('/content-sources/jobs/:id/reject', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const parsed = RejectJobSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: markJobRejected(id, parsed.data.reason) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // POST /content-sources/jobs/:id/fail
  app.post('/content-sources/jobs/:id/fail', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const parsed = FailJobSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: markJobFailed(id, parsed.data.error_message) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // POST /content-sources/jobs/:id/retry  (37.22)
  app.post('/content-sources/jobs/:id/retry', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: scheduleRetry(id) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // DELETE /content-sources/jobs/:id
  app.delete('/content-sources/jobs/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const { id } = req.params as { id: string };
    const ok = deleteFetchJob(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Job not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // POST /content-sources/jobs/prune — prune old jobs
  app.post('/content-sources/jobs/prune', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const body = req.body as { older_than_days?: number };
    const days = Math.min(Math.max(body.older_than_days ?? 30, 1), 365);
    const pruned = pruneOldJobs(days);
    return reply.send({ success: true, data: { pruned } });
  });

  // ============================================================
  // 37.13 — Duplicate detection helpers
  // ============================================================

  // POST /content-sources/dedupe/hash — compute hash from title/external_id
  app.post('/content-sources/dedupe/hash', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const body = req.body as { title?: string; external_id?: string; source_url?: string };
    const hash = computeContentHash({
      title: body.title ?? '',
      external_id: body.external_id ?? null,
      source_url: body.source_url ?? null,
    });
    return reply.send({ success: true, data: { content_hash: hash } });
  });

  // GET /content-sources/dedupe/check?source_id=&hash=
  app.get('/content-sources/dedupe/check', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const q = req.query as { source_id?: string; hash?: string };
    if (!q.hash) return reply.code(400).send({ success: false, error: 'hash required' });
    if (q.source_id) {
      return reply.send({ success: true, data: { duplicate: isDuplicateContent(q.source_id, q.hash), scope: 'source' } });
    }
    return reply.send({ success: true, data: { ...isDuplicateGlobally(q.hash), scope: 'global' } });
  });

  // ============================================================
  // 37.14 / 37.20 / 37.21 — Quality, Copyright, Publish rules
  // ============================================================

  // POST /content-sources/quality-check
  app.post('/content-sources/quality-check', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const body = req.body as any;
    return reply.send({ success: true, data: runQualityCheck(body) });
  });

  // POST /content-sources/copyright-check
  app.post('/content-sources/copyright-check', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const body = req.body as { title: string; description?: string; source_url?: string };
    return reply.send({ success: true, data: runCopyrightCheck(body) });
  });

  // POST /content-sources/:id/publish-decision — decide from quality+copyright
  app.post('/content-sources/:id/publish-decision', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const { id } = req.params as { id: string };
    const source = getContentSource(id);
    if (!source) return reply.code(404).send({ success: false, error: 'Source not found' });
    const body = req.body as { title?: string; description?: string; source_url?: string; duration_seconds?: number; has_thumbnail?: boolean; has_description?: boolean };
    const quality = runQualityCheck(body);
    const copyright = source.copyright_check_enabled === 1
      ? runCopyrightCheck({ title: body.title ?? '', description: body.description, source_url: body.source_url })
      : { safe: true, matches: [], notes: ['Copyright check disabled for this source'] };
    const decision = decidePublishAction(source, quality, copyright);
    return reply.send({ success: true, data: { decision, quality, copyright } });
  });

  // ============================================================
  // 37.10 / 37.11 / 37.12 / 37.16 — Metadata helper
  // ============================================================

  // POST /content-sources/:id/apply-defaults — merge source-level tags + category
  app.post('/content-sources/:id/apply-defaults', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const { id } = req.params as { id: string };
    const source = getContentSource(id);
    if (!source) return reply.code(404).send({ success: false, error: 'Source not found' });
    const body = req.body as any;
    const metadata = {
      title: String(body.title ?? ''),
      description: body.description ?? null,
      external_id: body.external_id ?? null,
      release_date: body.release_date ?? null,
      language: body.language ?? null,
      thumbnail_url: body.thumbnail_url ?? null,
      tags: Array.isArray(body.tags) ? body.tags : [],
      category: body.category ?? null,
    };
    return reply.send({ success: true, data: applySourceDefaults(metadata, source) });
  });
}
