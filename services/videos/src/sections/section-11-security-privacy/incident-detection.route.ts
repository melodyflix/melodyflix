// melodyflix videos - Section 11.20 Incident Detection routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  recordSignal, createManualIncident, getIncident, listIncidents,
  listSignals, updateIncident, escalateIncident, correlateRecentSignals,
  getIncidentStats, pruneOldIncidents,
} from './incident-detection.service.js';

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const STATUSES = ['open', 'investigating', 'mitigated', 'closed', 'false_positive'] as const;
const SOURCES = ['waf', 'rate_limit', 'vpn', 'fraud', 'suspicious_login', 'ip_block', 'manual'] as const;

const RecordSchema = z.object({
  source: z.enum(SOURCES),
  source_id: z.string().max(100).nullable().optional(),
  signal_type: z.string().min(1).max(100),
  severity: z.enum(SEVERITIES),
  ip_address: z.string().max(64).nullable().optional(),
  user_id: z.string().max(100).nullable().optional(),
  details: z.record(z.string(), z.unknown()).nullable().optional(),
  title: z.string().max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
});

const ManualSchema = z.object({
  title: z.string().min(5).max(200),
  description: z.string().max(2000).optional(),
  severity: z.enum(SEVERITIES),
  actor_ip: z.string().max(64).nullable().optional(),
  actor_user_id: z.string().max(100).nullable().optional(),
});

const UpdateSchema = z.object({
  status: z.enum(STATUSES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  assigned_to: z.string().max(100).nullable().optional(),
  resolution_note: z.string().max(2000).nullable().optional(),
});

const EscalateSchema = z.object({
  note: z.string().max(1000).optional(),
});

const PruneSchema = z.object({
  older_than_days: z.number().int().min(1).max(3650).optional(),
});

const CorrelateSchema = z.object({
  window_minutes: z.number().int().min(1).max(1440).optional(),
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

export async function incidentDetectionRoutes(app: FastifyInstance) {
  // POST /incidents/signal — public: internal services report signals
  app.post('/incidents/signal', async (req, reply) => {
    const parsed = RecordSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const incident = recordSignal(parsed.data);
      return reply.code(201).send({ success: true, data: incident });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // Admin endpoints
  // ============================================================

  // GET /incidents — list (filtered)
  app.get('/incidents', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as Record<string, string | undefined>;
    const result = listIncidents({
      status: q.status as any,
      severity: q.severity as any,
      source: q.source as any,
      actor_ip: q.actor_ip,
      actor_user_id: q.actor_user_id,
      assigned_to: q.assigned_to,
      limit: q.limit ? parseInt(q.limit, 10) : 50,
      offset: q.offset ? parseInt(q.offset, 10) : 0,
    });
    return reply.send({ success: true, data: result });
  });

  // POST /incidents — create manually
  app.post('/incidents', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const parsed = ManualSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const inc = createManualIncident({ ...parsed.data, created_by: auth.userId! });
      return reply.code(201).send({ success: true, data: inc });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /incidents/:id
  app.get('/incidents/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const inc = getIncident(id);
    if (!inc) return reply.code(404).send({ success: false, error: 'Incident not found' });
    return reply.send({ success: true, data: inc });
  });

  // GET /incidents/:id/signals
  app.get('/incidents/:id/signals', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const inc = getIncident(id);
    if (!inc) return reply.code(404).send({ success: false, error: 'Incident not found' });
    return reply.send({ success: true, data: { signals: listSignals(id) } });
  });

  // PATCH /incidents/:id — update status/severity/assignee
  app.patch('/incidents/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const inc = updateIncident(id, parsed.data, auth.userId!);
      return reply.send({ success: true, data: inc });
    } catch (err) {
      const msg = (err as Error).message;
      return reply.code(msg === 'Incident not found' ? 404 : 400).send({ success: false, error: msg });
    }
  });

  // POST /incidents/:id/escalate
  app.post('/incidents/:id/escalate', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const parsed = EscalateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const inc = escalateIncident(id, auth.userId!, parsed.data.note);
      return reply.send({ success: true, data: inc });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /incidents/correlate — run correlation manually
  app.post('/incidents/correlate', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const parsed = CorrelateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const result = correlateRecentSignals(parsed.data.window_minutes ?? 15);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(500).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /incidents/stats/summary
  app.get('/incidents/stats/summary', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as { window_days?: string };
    const days = q.window_days ? parseInt(q.window_days, 10) : 30;
    return reply.send({ success: true, data: getIncidentStats(days) });
  });

  // POST /incidents/maintenance/prune
  app.post('/incidents/maintenance/prune', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const parsed = PruneSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const result = pruneOldIncidents(parsed.data.older_than_days ?? 365);
    return reply.send({ success: true, data: result });
  });
}
