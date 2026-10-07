// melodyflix videos - Section 11.19 Secret Vault routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  createSecret, getSecretView, listSecrets, updateSecretMeta, rotateSecret,
  deleteSecret, listEvents, getSecretStats, isMasterKeyConfigured,
  pruneOldEvents,
} from './secret-vault.service.js';

const CATEGORIES = ['api_key', 'oauth', 'db_credential', 'smtp', 'payment', 'encryption_key', 'webhook', 'other'] as const;

const CreateSchema = z.object({
  name: z.string().min(3).max(120),
  category: z.enum(CATEGORIES),
  description: z.string().max(500).nullable().optional(),
  value: z.string().min(1).max(100_000),
  expires_at: z.string().datetime().nullable().optional(),
});

const UpdateMetaSchema = z.object({
  description: z.string().max(500).nullable().optional(),
  category: z.enum(CATEGORIES).optional(),
  is_active: z.boolean().optional(),
  expires_at: z.string().datetime().nullable().optional(),
});

const RotateSchema = z.object({
  value: z.string().min(1).max(100_000),
});

const DeleteSchema = z.object({
  reason: z.string().max(500).optional(),
});

const PruneSchema = z.object({
  older_than_days: z.number().int().min(1).max(3650).optional(),
});

function getAuth(authorization: string | undefined): { ok: boolean; userId?: string; role?: string; error?: string } {
  try {
    const payload = requireAuth(authorization);
    return { ok: true, userId: payload.sub as string, role: payload.role as string };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function requireAdmin(authorization: string | undefined): { ok: boolean; userId?: string; error?: string } {
  const auth = getAuth(authorization);
  if (!auth.ok) return auth;
  if (auth.role !== 'admin') return { ok: false, error: 'Admin only' };
  return auth;
}

export async function secretVaultRoutes(app: FastifyInstance) {
  // GET /secrets/health — public: is vault ready?
  app.get('/secrets/health', async (req, reply) => {
    return reply.send({
      success: true,
      data: { master_key_configured: isMasterKeyConfigured() },
    });
  });

  // ============================================================
  // Admin endpoints — secrets are admin-only
  // ============================================================

  // GET /secrets — list (masked values)
  app.get('/secrets', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as { category?: string; active_only?: string; include_expired?: string; limit?: string; offset?: string };
    const result = listSecrets({
      category: q.category as any,
      active_only: q.active_only === 'true',
      include_expired: q.include_expired === 'true',
      limit: q.limit ? parseInt(q.limit, 10) : 100,
      offset: q.offset ? parseInt(q.offset, 10) : 0,
    });
    return reply.send({ success: true, data: result });
  });

  // POST /secrets — create
  app.post('/secrets', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const view = createSecret({ ...parsed.data, created_by: auth.userId! });
      return reply.code(201).send({ success: true, data: view });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /secrets/:id — view metadata (masked)
  app.get('/secrets/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const view = getSecretView(id);
    if (!view) return reply.code(404).send({ success: false, error: 'Secret not found' });
    return reply.send({ success: true, data: view });
  });

  // PATCH /secrets/:id — update metadata only (not value)
  app.patch('/secrets/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const parsed = UpdateMetaSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const view = updateSecretMeta(id, parsed.data, auth.userId!);
      return reply.send({ success: true, data: view });
    } catch (err) {
      const msg = (err as Error).message;
      return reply.code(msg === 'Secret not found' ? 404 : 400).send({ success: false, error: msg });
    }
  });

  // POST /secrets/:id/rotate — re-encrypt with new value
  app.post('/secrets/:id/rotate', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const parsed = RotateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const view = rotateSecret(id, parsed.data.value, auth.userId!);
      return reply.send({ success: true, data: view });
    } catch (err) {
      const msg = (err as Error).message;
      return reply.code(msg === 'Secret not found' ? 404 : 400).send({ success: false, error: msg });
    }
  });

  // DELETE /secrets/:id
  app.delete('/secrets/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const parsed = DeleteSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const ok = deleteSecret(id, auth.userId!, parsed.data.reason);
    if (!ok) return reply.code(404).send({ success: false, error: 'Secret not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // GET /secrets/events/log — audit trail
  app.get('/secrets/events/log', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as { secret_name?: string; actor_id?: string; event_type?: string; limit?: string; offset?: string };
    const result = listEvents({
      secret_name: q.secret_name,
      actor_id: q.actor_id,
      event_type: q.event_type,
      limit: q.limit ? parseInt(q.limit, 10) : 100,
      offset: q.offset ? parseInt(q.offset, 10) : 0,
    });
    return reply.send({ success: true, data: result });
  });

  // GET /secrets/stats/summary
  app.get('/secrets/stats/summary', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    return reply.send({ success: true, data: getSecretStats() });
  });

  // POST /secrets/maintenance/prune-events
  app.post('/secrets/maintenance/prune-events', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const parsed = PruneSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const result = pruneOldEvents(parsed.data.older_than_days ?? 365);
    return reply.send({ success: true, data: result });
  });
}
