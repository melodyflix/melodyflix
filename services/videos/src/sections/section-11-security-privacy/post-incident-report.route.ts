// melodyflix videos - Section 11.23 Post-Incident Report routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  createReport, getReport, listReports, updateReport,
  publishReport, archiveReport,
  addTimelineEvent, removeTimelineEvent,
  addCapa, updateCapa, removeCapa, listCapaByOwner,
  exportReportJSON, getReportStats,
} from './post-incident-report.service.js';

const STATUSES = ['draft','in_review','published','archived'] as const;
const EVENT_TYPES = ['detection','escalation','mitigation','recovery','communication','root_cause','note'] as const;
const CAPA_KINDS = ['corrective','preventive'] as const;
const CAPA_STATUSES = ['open','in_progress','done','wont_fix','verified'] as const;

const CreateSchema = z.object({
  incident_id: z.string().min(1).max(100),
  title: z.string().min(3).max(200),
  summary: z.string().max(8000).nullable().optional(),
  impact: z.string().max(8000).nullable().optional(),
  root_cause: z.string().max(8000).nullable().optional(),
  lessons_learned: z.string().max(8000).nullable().optional(),
  severity: z.string().max(30).nullable().optional(),
});

const UpdateSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  summary: z.string().max(8000).nullable().optional(),
  impact: z.string().max(8000).nullable().optional(),
  root_cause: z.string().max(8000).nullable().optional(),
  lessons_learned: z.string().max(8000).nullable().optional(),
  severity: z.string().max(30).nullable().optional(),
  status: z.enum(STATUSES).optional(),
  reviewer_id: z.string().max(100).nullable().optional(),
});

const TimelineSchema = z.object({
  event_type: z.enum(EVENT_TYPES),
  happened_at: z.string().datetime(),
  title: z.string().min(2).max(200),
  description: z.string().max(4000).nullable().optional(),
  actor: z.string().max(200).nullable().optional(),
});

const CapaCreateSchema = z.object({
  kind: z.enum(CAPA_KINDS),
  title: z.string().min(3).max(200),
  description: z.string().max(4000).nullable().optional(),
  owner_id: z.string().max(100).nullable().optional(),
  due_at: z.string().datetime().nullable().optional(),
});

const CapaUpdateSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.string().max(4000).nullable().optional(),
  owner_id: z.string().max(100).nullable().optional(),
  due_at: z.string().datetime().nullable().optional(),
  status: z.enum(CAPA_STATUSES).optional(),
});

const ListQuerySchema = z.object({
  incident_id: z.string().max(100).optional(),
  status: z.enum(STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
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

export async function postIncidentReportRoutes(app: FastifyInstance): Promise<void> {
  // -------- Reports --------
  app.post('/security/pir/reports', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const parse = CreateSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: 'invalid_input', details: parse.error.flatten() });
    const r = createReport(parse.data, auth.userId ?? null);
    return reply.code(201).send(r);
  });

  app.get('/security/pir/reports', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const q = ListQuerySchema.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });
    const { reports, total } = listReports(q.data);
    return { reports, total };
  });

  app.get('/security/pir/reports/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { id } = req.params as { id: string };
    const r = getReport(id);
    if (!r) return reply.code(404).send({ error: 'not_found' });
    return r;
  });

  app.patch('/security/pir/reports/:id', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { id } = req.params as { id: string };
    const parse = UpdateSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: 'invalid_input' });
    const updated = updateReport(id, parse.data);
    if (!updated) return reply.code(404).send({ error: 'not_found' });
    return updated;
  });

  app.post('/security/pir/reports/:id/publish', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { id } = req.params as { id: string };
    const r = publishReport(id, auth.userId ?? null);
    if (!r) return reply.code(404).send({ error: 'not_found' });
    return r;
  });

  app.post('/security/pir/reports/:id/archive', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { id } = req.params as { id: string };
    const r = archiveReport(id);
    if (!r) return reply.code(404).send({ error: 'not_found' });
    return r;
  });

  app.get('/security/pir/reports/:id/export', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { id } = req.params as { id: string };
    const data = exportReportJSON(id);
    if (!data) return reply.code(404).send({ error: 'not_found' });
    return data;
  });

  // -------- Timeline --------
  app.post('/security/pir/reports/:id/timeline', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { id } = req.params as { id: string };
    const parse = TimelineSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: 'invalid_input', details: parse.error.flatten() });
    try {
      const ev = addTimelineEvent(id, parse.data);
      return reply.code(201).send(ev);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'error';
      if (msg === 'report_not_found') return reply.code(404).send({ error: msg });
      return reply.code(500).send({ error: 'add_failed' });
    }
  });

  app.delete('/security/pir/timeline/:eventId', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { eventId } = req.params as { eventId: string };
    const ok = removeTimelineEvent(eventId);
    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // -------- CAPA --------
  app.post('/security/pir/reports/:id/capa', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { id } = req.params as { id: string };
    const parse = CapaCreateSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: 'invalid_input', details: parse.error.flatten() });
    try {
      const c = addCapa(id, parse.data);
      return reply.code(201).send(c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'error';
      if (msg === 'report_not_found') return reply.code(404).send({ error: msg });
      return reply.code(500).send({ error: 'add_failed' });
    }
  });

  app.patch('/security/pir/capa/:capaId', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { capaId } = req.params as { capaId: string };
    const parse = CapaUpdateSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: 'invalid_input' });
    const updated = updateCapa(capaId, parse.data, auth.userId ?? null);
    if (!updated) return reply.code(404).send({ error: 'not_found' });
    return updated;
  });

  app.delete('/security/pir/capa/:capaId', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const { capaId } = req.params as { capaId: string };
    const ok = removeCapa(capaId);
    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // -------- Stats + self-service --------
  app.get('/security/pir/stats/summary', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(403).send({ error: auth.error });
    const q = req.query as { window_days?: string };
    const days = q.window_days ? Math.min(Math.max(parseInt(q.window_days, 10) || 180, 1), 3650) : 180;
    return getReportStats(days);
  });

  app.get('/security/pir/my-capa', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ error: auth.error });
    const items = listCapaByOwner(auth.userId!);
    return { capa: items, total: items.length };
  });
}
