// melodyflix videos — Content Ingest routes (Section 37 core)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  ingestFetchJob, ingestQueuedJobs, getIngestStats,
} from '../services/content-ingest.service.js';

const IngestOneSchema = z.object({
  job_id: z.string().uuid(),
});

const IngestBatchSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
});

function requireAdmin(auth: string | undefined): { ok: boolean; userId?: string; error?: string } {
  try {
    const payload = requireAuth(auth);
    if (payload.role !== 'admin') return { ok: false, error: 'Admin only' };
    return { ok: true, userId: payload.sub as string };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function contentIngestRoutes(app: FastifyInstance) {
  // POST /content-ingest/job — ingest a single fetch job
  app.post('/content-ingest/job', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const parsed = IngestOneSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const result = await ingestFetchJob(parsed.data.job_id);
      const code = result.status === 'failed' ? 400 : 201;
      return reply.code(code).send({ success: result.status !== 'failed', data: result });
    } catch (err) {
      return reply.code(500).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /content-ingest/batch — process queued jobs (cron-friendly)
  app.post('/content-ingest/batch', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    const parsed = IngestBatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const result = await ingestQueuedJobs(parsed.data.limit);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(500).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /content-ingest/stats — today's ingest summary
  app.get('/content-ingest/stats', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    return reply.send({ success: true, data: getIngestStats() });
  });
}
