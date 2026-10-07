// melodyflix videos - Section 15.7 Version Comparison routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  compareVersions, compareTimelines, getVersionCompareStats,
} from '../services/version-compare.service.js';

const CompareSchema = z.object({
  a_version_id: z.string().min(1).max(100),
  b_version_id: z.string().min(1).max(100),
});

const TimelineSchema = z.object({
  a_version_id: z.string().min(1).max(100),
  b_version_id: z.string().min(1).max(100),
  a_timeline: z.array(z.record(z.string(), z.unknown())).max(10000).optional(),
  b_timeline: z.array(z.record(z.string(), z.unknown())).max(10000).optional(),
  key_field: z.string().max(60).optional(),
});

function admin(auth: string | undefined): boolean {
  try { requireRole(auth, ['admin']); return true; } catch { return false; }
}

export async function versionCompareRoutes(app: FastifyInstance): Promise<void> {
  app.post('/versions/compare', async (req, reply) => {
    const p = CompareSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: compareVersions(p.data.a_version_id, p.data.b_version_id) }); }
    catch (e) { return reply.code(404).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/versions/compare-timeline', async (req, reply) => {
    const p = TimelineSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: compareTimelines(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/versions/compare-stats', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getVersionCompareStats() });
  });
}
