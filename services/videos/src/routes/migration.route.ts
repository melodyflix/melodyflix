// melodyflix videos — Content Migration routes (Section 44)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  parseSourceUrl,
  createMigrationJob, bulkCreateMigrations, getMigrationJob,
  listMigrationJobs, cancelMigration, deleteMigration,
  fetchMigrationMetadata, extractPreservedMetadata, applyMetadataToVideo,
  migrationStats,
} from '../services/migration.service.js';

function userId(req: any): string | null {
  return req.user?.id ?? req.user?.sub ?? null;
}

export async function migrationRoutes(app: FastifyInstance) {
  // ---- URL parsing (public, no persistence) ----

  const ParseSchema = z.object({ url: z.string().min(1).max(2000) });

  // POST /migration/parse — parse a YouTube/Vimeo URL (dry-run, no DB write)
  app.post('/migration/parse', async (req, reply) => {
    const parsed = ParseSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    try {
      const result = parseSourceUrl(parsed.data.url);
      return reply.send({ success: true, data: result });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Parse failed' });
    }
  });

  // ---- Jobs ----

  const CreateSchema = z.object({
    source_url: z.string().min(1).max(2000),
    channel_id: z.string().nullable().optional(),
  });

  const BulkSchema = z.object({
    urls: z.array(z.string().min(1).max(2000)).min(1).max(100),
    channel_id: z.string().nullable().optional(),
  });

  // GET /migration/jobs — list own jobs (filterable)
  app.get('/migration/jobs', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const q = req.query as { status?: string; source?: string; limit?: string };
    const jobs = listMigrationJobs({
      owner_id: me,
      status: q.status as any,
      source: q.source as any,
      limit: q.limit ? parseInt(q.limit) : undefined,
    });
    return reply.send({ success: true, data: { jobs, count: jobs.length } });
  });

  // GET /migration/stats
  app.get('/migration/stats', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    return reply.send({ success: true, data: migrationStats(me) });
  });

  // GET /migration/jobs/:id
  app.get('/migration/jobs/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const job = getMigrationJob(id);
    if (!job) return reply.code(404).send({ success: false, error: 'Job not found' });
    if (job.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your job' });
    return reply.send({ success: true, data: { job } });
  });

  // POST /migration/jobs — create one
  app.post('/migration/jobs', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    try {
      const job = createMigrationJob({
        owner_id: me,
        source_url: parsed.data.source_url,
        channel_id: parsed.data.channel_id ?? null,
      });
      return reply.code(201).send({ success: true, data: { job } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Create failed' });
    }
  });

  // POST /migration/jobs/bulk — bulk create (up to 100 URLs)
  app.post('/migration/jobs/bulk', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = BulkSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    const result = bulkCreateMigrations({
      owner_id: me,
      urls: parsed.data.urls,
      channel_id: parsed.data.channel_id ?? null,
    });
    return reply.code(201).send({
      success: true,
      data: {
        created: result.created,
        created_count: result.created.length,
        errors: result.errors,
        error_count: result.errors.length,
      },
    });
  });

  // POST /migration/jobs/:id/fetch — fetch oEmbed metadata
  app.post('/migration/jobs/:id/fetch', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const job = getMigrationJob(id);
    if (!job) return reply.code(404).send({ success: false, error: 'Job not found' });
    if (job.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your job' });
    try {
      const updated = await fetchMigrationMetadata(id);
      return reply.send({ success: true, data: { job: updated } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Fetch failed' });
    }
  });

  // POST /migration/jobs/:id/apply — apply preserved metadata to target video
  app.post('/migration/jobs/:id/apply', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const job = getMigrationJob(id);
    if (!job) return reply.code(404).send({ success: false, error: 'Job not found' });
    if (job.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your job' });

    const body = req.body as { video_id?: string };
    if (!body?.video_id) return reply.code(400).send({ success: false, error: 'video_id required' });

    try {
      const result = applyMetadataToVideo(id, body.video_id);
      return reply.send({ success: true, data: result });
    } catch (e: any) {
      const msg = e?.message ?? 'Apply failed';
      if (msg === 'Video not found') return reply.code(404).send({ success: false, error: msg });
      return reply.code(400).send({ success: false, error: msg });
    }
  });

  // GET /migration/jobs/:id/metadata — extract preserved metadata (dry)
  app.get('/migration/jobs/:id/metadata', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const job = getMigrationJob(id);
    if (!job) return reply.code(404).send({ success: false, error: 'Job not found' });
    if (job.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your job' });
    const meta = extractPreservedMetadata(id);
    return reply.send({ success: true, data: { metadata: meta } });
  });

  // POST /migration/jobs/:id/cancel
  app.post('/migration/jobs/:id/cancel', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const ok = cancelMigration(id, me);
      if (!ok) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { cancelled: true } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Cancel failed' });
    }
  });

  // DELETE /migration/jobs/:id
  app.delete('/migration/jobs/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const ok = deleteMigration(id, me);
      if (!ok) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { deleted: true } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });
}
