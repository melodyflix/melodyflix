// melodyflix videos — Integration Settings routes (admin panel)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  listIntegrations, getIntegration, updateIntegration,
  isIntegrationReady, checkIntegrationHealth, listIntegrationHealth,
  type IntegrationId,
} from '../services/integration-settings.service.js';

const VALID_IDS = [
  'tmdb', 'omdb', 'giphy', 'tenor', 'newsapi', 'rss_generic',
  'openai', 'anthropic', 'gemini', 'azure_tts', 'elevenlabs',
  'turn_server', 'smtp', 'bkash', 'nagad', 'sslcommerz',
  'stripe', 'paypal', 'razorpay',
] as const;

const UpdateSchema = z.object({
  is_enabled: z.boolean().optional(),
  config: z.record(z.string(), z.string()).optional(),
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

export async function integrationSettingsRoutes(app: FastifyInstance) {
  // GET /integrations — list all (config masked; admin only)
  app.get('/integrations', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as { category?: string; enabled_only?: string };
    const integrations = listIntegrations({
      category: q.category,
      enabledOnly: q.enabled_only === 'true',
    });
    return reply.send({ success: true, data: { integrations } });
  });

  // GET /integrations/health — summary of which integrations are ready
  app.get('/integrations/health', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });
    return reply.send({ success: true, data: { integrations: listIntegrationHealth() } });
  });

  // GET /integrations/:id — single (admin only)
  app.get('/integrations/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    if (!VALID_IDS.includes(id as any)) {
      return reply.code(400).send({ success: false, error: 'Unknown integration' });
    }
    const integration = getIntegration(id as IntegrationId);
    if (!integration) return reply.code(404).send({ success: false, error: 'Integration not found' });
    const health = checkIntegrationHealth(id as IntegrationId);
    return reply.send({ success: true, data: { integration, health } });
  });

  // PUT /integrations/:id — update config (admin only)
  app.put('/integrations/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    if (!VALID_IDS.includes(id as any)) {
      return reply.code(400).send({ success: false, error: 'Unknown integration' });
    }
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const integration = updateIntegration(id as IntegrationId, {
        ...parsed.data,
        updated_by: auth.userId,
      });
      const health = checkIntegrationHealth(id as IntegrationId);
      return reply.send({ success: true, data: { integration, health } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /integrations/:id/test — verify config is complete (no external call)
  app.post('/integrations/:id/test', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    if (!VALID_IDS.includes(id as any)) {
      return reply.code(400).send({ success: false, error: 'Unknown integration' });
    }
    const health = checkIntegrationHealth(id as IntegrationId);
    if (!health) return reply.code(404).send({ success: false, error: 'Integration not found' });
    return reply.send({
      success: true,
      data: {
        ready: health.ready,
        is_enabled: health.is_enabled,
        has_credentials: health.has_credentials,
        missing_fields: health.missing_fields,
        message: health.ready
          ? 'Integration is ready'
          : health.missing_fields.length > 0
            ? `Missing fields: ${health.missing_fields.join(', ')}`
            : 'Integration is disabled — enable it after entering credentials',
      },
    });
  });

  // GET /integrations/:id/ready — used internally by other services
  app.get('/integrations/:id/ready', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!VALID_IDS.includes(id as any)) {
      return reply.code(400).send({ success: false, error: 'Unknown integration' });
    }
    const ready = isIntegrationReady(id as IntegrationId);
    return reply.send({ success: true, data: { ready } });
  });
}
