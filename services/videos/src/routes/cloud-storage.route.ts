// melodyflix videos - Section 49 Cloud Storage Management routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  createBackend, getBackend, getDefaultBackend, listBackends, updateBackend, deleteBackend,
  registerObject, getObject, touchAccess, deleteObject, listObjects, changeStorageClass,
  getBackendAnalytics, getGlobalStorageStats, snapshotAnalytics, getAnalyticsTrend,
  createPolicy, listPolicies, updatePolicy, deletePolicy,
  runArchivePolicy, listArchiveRuns, runAllActivePolicies,
} from '../services/cloud-storage.service.js';

const PROVIDERS = ['aws_s3','gcs','azure_blob','local'] as const;
const CLASSES = ['hot','cool','cold','archive'] as const;

const BackendSchema = z.object({
  provider: z.enum(PROVIDERS),
  name: z.string().min(2).max(100),
  bucket: z.string().max(200).nullable().optional(),
  region: z.string().max(80).nullable().optional(),
  endpoint: z.string().max(500).nullable().optional(),
  default_class: z.enum(CLASSES).optional(),
  is_default: z.boolean().optional(),
  credentials_ref: z.string().max(200).nullable().optional(),
});

const UpdateBackendSchema = BackendSchema.partial().omit({ provider: true }).extend({
  enabled: z.boolean().optional(),
});

const RegisterObjectSchema = z.object({
  backend_id: z.string().min(1).max(100),
  key: z.string().min(1).max(500),
  size_bytes: z.number().int().min(0).max(10_000_000_000_000),
  content_type: z.string().max(200).nullable().optional(),
  storage_class: z.enum(CLASSES).optional(),
  etag: z.string().max(200).nullable().optional(),
  url: z.string().max(2000).nullable().optional(),
  video_id: z.string().max(100).nullable().optional(),
  owner_id: z.string().max(100).nullable().optional(),
  checksum: z.string().max(200).nullable().optional(),
});

const ChangeClassSchema = z.object({ storage_class: z.enum(CLASSES) });

const PolicySchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(2000).nullable().optional(),
  from_class: z.enum(CLASSES),
  to_class: z.enum(CLASSES),
  older_than_days: z.number().int().min(1).max(3650),
  video_category: z.string().max(50).nullable().optional(),
  min_size_bytes: z.number().int().min(0).max(10_000_000_000_000).optional(),
});

const UpdatePolicySchema = PolicySchema.partial().extend({ enabled: z.boolean().optional() });

function admin(auth: string | undefined): boolean {
  try { requireRole(auth, ['admin']); return true; } catch { return false; }
}

export async function cloudStorageRoutes(app: FastifyInstance): Promise<void> {
  // ============ BACKENDS ============
  app.post('/storage/backends', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = BackendSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createBackend(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/storage/backends', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as { provider?: string };
    return reply.send({ success: true, data: { backends: listBackends(q.provider as any) } });
  });

  app.get('/storage/backends/default', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const b = getDefaultBackend();
    return reply.send({ success: true, data: b });
  });

  app.get('/storage/backends/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const b = getBackend(id);
    if (!b) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: b });
  });

  app.patch('/storage/backends/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const p = UpdateBackendSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body' });
    const b = updateBackend(id, p.data);
    if (!b) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: b });
  });

  app.delete('/storage/backends/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    try {
      const ok = deleteBackend(id);
      return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(409).send({ success: false, error: (e as Error).message }); }
  });

  // ============ OBJECTS ============
  app.post('/storage/objects', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = RegisterObjectSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: registerObject(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/storage/objects', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as { backend_id?: string; video_id?: string; owner_id?: string; storage_class?: string; limit?: string };
    const objects = listObjects({
      backend_id: q.backend_id, video_id: q.video_id, owner_id: q.owner_id,
      storage_class: q.storage_class as any,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return reply.send({ success: true, data: { objects, total: objects.length } });
  });

  app.get('/storage/objects/:backendId/:key', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { backendId, key } = req.params as { backendId: string; key: string };
    const o = getObject(backendId, decodeURIComponent(key));
    if (!o) return reply.code(404).send({ success: false, error: 'not_found' });
    touchAccess(backendId, o.key);
    return reply.send({ success: true, data: o });
  });

  app.patch('/storage/objects/:backendId/:key/class', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { backendId, key } = req.params as { backendId: string; key: string };
    const p = ChangeClassSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body' });
    const o = changeStorageClass(backendId, decodeURIComponent(key), p.data.storage_class);
    if (!o) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: o });
  });

  app.delete('/storage/objects/:backendId/:key', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { backendId, key } = req.params as { backendId: string; key: string };
    const ok = deleteObject(backendId, decodeURIComponent(key));
    return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  // ============ 49.4 ANALYTICS ============
  app.get('/storage/stats', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getGlobalStorageStats() });
  });

  app.get('/storage/backends/:id/analytics', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const a = getBackendAnalytics(id);
    if (!a) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: a });
  });

  app.get('/storage/backends/:id/analytics/trend', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const q = req.query as { days?: string };
    const days = q.days ? Math.min(Math.max(Number(q.days), 1), 365) : 30;
    return reply.send({ success: true, data: { trend: getAnalyticsTrend(id, days) } });
  });

  app.post('/storage/analytics/snapshot', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as { date?: string };
    const r = snapshotAnalytics(q.date);
    return reply.send({ success: true, data: r });
  });

  // ============ 49.5 ARCHIVING ============
  app.post('/storage/policies', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = PolicySchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createPolicy(p.data, null) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/storage/policies', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as { enabled_only?: string };
    return reply.send({ success: true, data: { policies: listPolicies(q.enabled_only === 'true') } });
  });

  app.patch('/storage/policies/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const p = UpdatePolicySchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body' });
    const r = updatePolicy(id, p.data);
    if (!r) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: r });
  });

  app.delete('/storage/policies/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const ok = deletePolicy(id);
    return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  app.post('/storage/policies/:id/run', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    try {
      const r = runArchivePolicy(id, null);
      return reply.send({ success: true, data: r });
    } catch (e) {
      const msg = (e as Error).message;
      const code = msg === 'policy_not_found' ? 404 : 400;
      return reply.code(code).send({ success: false, error: msg });
    }
  });

  app.post('/storage/policies/run-all', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const r = runAllActivePolicies(null);
    return reply.send({ success: true, data: r });
  });

  app.get('/storage/archive-runs', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as { policy_id?: string; limit?: string };
    const limit = q.limit ? Math.min(Math.max(Number(q.limit), 1), 200) : 50;
    return reply.send({ success: true, data: { runs: listArchiveRuns(q.policy_id, limit) } });
  });
}
