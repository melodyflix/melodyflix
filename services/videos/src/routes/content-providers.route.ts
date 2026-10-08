// melodyflix videos - content provider registry routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  listProviders, getProvider,
} from '../services/content-providers/index.js';
// side-effect imports register built-in providers
import '../services/content-providers/generic-rest.js';
import '../services/content-providers/rss-provider.js';

export async function contentProvidersRoutes(app: FastifyInstance) {
  // GET /admin/content-providers — list registered adapters
  app.get('/admin/content-providers', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: { providers: listProviders() } });
  });

  // POST /admin/content-providers/:id/validate
  app.post('/admin/content-providers/:id/validate', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const p = getProvider(id);
    if (!p) return reply.code(404).send({ success: false, error: 'Provider not found' });
    const config = (req.body ?? {}) as Record<string, unknown>;
    try {
      const result = p.validate(config);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /admin/content-providers/:id/health
  app.post('/admin/content-providers/:id/health', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const p = getProvider(id);
    if (!p) return reply.code(404).send({ success: false, error: 'Provider not found' });
    const config = (req.body ?? {}) as Record<string, unknown>;
    try {
      const result = await p.healthCheck(config);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /admin/content-providers/:id/search
  app.post('/admin/content-providers/:id/search', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const p = getProvider(id);
    if (!p) return reply.code(404).send({ success: false, error: 'Provider not found' });
    if (!p.search) return reply.code(400).send({ success: false, error: 'Provider does not support search' });

    const BodySchema = z.object({
      query: z.string().min(1).max(200),
      config: z.record(z.unknown()),
      opts: z.object({
        limit: z.number().int().min(1).max(100).optional(),
        page: z.number().int().min(1).optional(),
        language: z.string().max(10).optional(),
      }).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const items = await p.search(parsed.data.query, parsed.data.config, parsed.data.opts);
      return reply.send({ success: true, data: { items, total: items.length } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /admin/content-providers/:id/fetch-list
  app.post('/admin/content-providers/:id/fetch-list', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const p = getProvider(id);
    if (!p) return reply.code(404).send({ success: false, error: 'Provider not found' });
    if (!p.fetchList) return reply.code(400).send({ success: false, error: 'Provider does not support fetch_list' });

    const BodySchema = z.object({
      config: z.record(z.unknown()),
      opts: z.object({
        limit: z.number().int().min(1).max(200).optional(),
        page: z.number().int().min(1).optional(),
      }).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const items = await p.fetchList(parsed.data.config, parsed.data.opts);
      return reply.send({ success: true, data: { items, total: items.length } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });
}
