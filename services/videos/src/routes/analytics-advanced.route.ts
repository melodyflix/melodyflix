// melodyflix videos - Section 26 Analytics (remaining) routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  createExport, getExport, listExports,
  linearForecast, listPredictions,
  computeChurnScore, listChurnScores, getChurnSummary,
  computeLtv, listLtv, getLtvSummary,
  getAnalyticsCoreStats,
} from '../services/analytics-core.service.js';
import {
  createCohort, getCohort, listCohorts, addCohortMembers, listCohortMembers, deleteCohort,
  createFunnel, listFunnels, getFunnel, recordFunnelEvent, analyzeFunnel,
  computeRewatchSegments, listRewatchSegments,
  recordScrollDepth, aggregateScrollDepth,
  startSessionRecording, appendSessionEvents, endSessionRecording, getSessionRecording, listSessionRecordings,
  getAnalyticsAdvancedStats,
} from '../services/analytics-advanced.service.js';

const EXPORT_FORMATS = ['csv','json','pdf_html'] as const;
const CHURN_RISKS = ['low','medium','high'] as const;

const ExportSchema = z.object({
  kind: z.string().min(1).max(80),
  format: z.enum(EXPORT_FORMATS),
  params: z.record(z.string(), z.unknown()).optional(),
  rows: z.array(z.record(z.string(), z.unknown())).max(100000),
});

const PredictSchema = z.object({
  kind: z.string().min(1).max(80),
  subject_id: z.string().min(1).max(100),
  horizon_days: z.number().int().min(1).max(730).optional(),
  history: z.array(z.object({ t: z.string().datetime(), value: z.number() })).min(1).max(10000),
  model_version: z.string().max(60).optional(),
});

const ChurnSchema = z.object({
  user_id: z.string().min(1).max(100),
  last_active_at: z.string().datetime(),
  days_active_last_30: z.number().int().min(0).max(30),
  logins_last_30: z.number().int().min(0).max(10000),
  watched_minutes_last_30: z.number().min(0),
  subscribed: z.boolean(),
});

const LtvSchema = z.object({
  user_id: z.string().min(1).max(100),
  realized_cents: z.number().int().min(0),
  joined_at: z.string().datetime(),
  monthly_churn_prob: z.number().min(0).max(1).optional(),
  arpu_cents: z.number().min(0).optional(),
});

const CohortSchema = z.object({
  name: z.string().min(1).max(200),
  kind: z.string().max(60).optional(),
  period_start: z.string().datetime(),
  period_end: z.string().datetime(),
  criteria: z.record(z.string(), z.unknown()).optional(),
  user_ids: z.array(z.string().max(100)).max(100000).optional(),
});

const CohortMembersSchema = z.object({ user_ids: z.array(z.string().max(100)).min(1).max(100000) });

const FunnelSchema = z.object({
  name: z.string().min(1).max(200),
  steps: z.array(z.string().max(120)).min(2).max(20),
});

const FunnelEventSchema = z.object({
  user_id: z.string().min(1).max(100),
  step_index: z.number().int().min(0).max(19),
  session_id: z.string().max(200).nullable().optional(),
});

const RewatchSchema = z.object({
  samples: z.array(z.object({
    video_id: z.string().min(1).max(100),
    start_ms: z.number().int().min(0),
    end_ms: z.number().int().min(0),
    user_id: z.string().min(1).max(100),
  })).min(1).max(100000),
});

const ScrollSchema = z.object({
  page_kind: z.string().min(1).max(60),
  page_id: z.string().min(1).max(200),
  user_id: z.string().max(100).nullable().optional(),
  session_id: z.string().max(200).nullable().optional(),
  max_percent: z.number().int().min(0).max(100),
  viewport_height: z.number().int().min(0).max(100000).nullable().optional(),
  doc_height: z.number().int().min(0).max(10000000).nullable().optional(),
});

const SessionStartSchema = z.object({
  session_id: z.string().min(1).max(200),
});

const SessionEventSchema = z.object({
  events: z.array(z.object({
    type: z.string().min(1).max(80),
    at: z.string().datetime(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })).min(1).max(5000),
});

const SessionEndSchema = z.object({ storage_ref: z.string().max(500).nullable().optional() });

function admin(auth: string | undefined): boolean {
  try { requireRole(auth, ['admin']); return true; } catch { return false; }
}
function uid(auth: string | undefined): string | null {
  try { const p: any = requireRole(auth, ['admin','user','moderator']); return p?.sub ?? p?.id ?? null; } catch { return null; }
}

export async function analyticsAdvancedRoutes(app: FastifyInstance): Promise<void> {
  // ===== 26.5 Export =====
  app.post('/analytics/exports', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = ExportSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try {
      const e = createExport({ requested_by: actor, ...p.data });
      // don't return body inline; return metadata
      return reply.code(201).send({ success: true, data: { ...e, body: undefined } });
    } catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/analytics/exports', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const q = req.query as { mine?: string; limit?: string };
    const mine = q.mine !== '0';
    return reply.send({ success: true, data: { exports: listExports(mine ? actor : undefined, q.limit ? Number(q.limit) : 100) } });
  });

  app.get('/analytics/exports/:id', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const e = getExport(id);
    if (!e) return reply.code(404).send({ success: false, error: 'not_found' });
    if (e.requested_by !== actor && !admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'not_allowed' });
    return reply.send({ success: true, data: e });
  });

  // ===== 26.6 Predictive =====
  app.post('/analytics/predict', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = PredictSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: linearForecast(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/analytics/predictions', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as any;
    return reply.send({ success: true, data: { predictions: listPredictions({ kind: q.kind, subject_id: q.subject_id, limit: q.limit ? Number(q.limit) : undefined }) } });
  });

  // ===== 26.7 Churn =====
  app.post('/analytics/churn', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = ChurnSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: computeChurnScore(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/analytics/churn', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as any;
    return reply.send({ success: true, data: { scores: listChurnScores({ user_id: q.user_id, risk: q.risk, limit: q.limit ? Number(q.limit) : undefined }) } });
  });

  app.get('/analytics/churn/summary', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getChurnSummary() });
  });

  // ===== 26.8 LTV =====
  app.post('/analytics/ltv', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = LtvSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: computeLtv(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/analytics/ltv', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as any;
    return reply.send({ success: true, data: { snapshots: listLtv({ user_id: q.user_id, limit: q.limit ? Number(q.limit) : undefined }) } });
  });

  app.get('/analytics/ltv/summary', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getLtvSummary() });
  });

  // ===== 26.9 Cohort =====
  app.post('/analytics/cohorts', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = CohortSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createCohort(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/analytics/cohorts', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: { cohorts: listCohorts() } });
  });

  app.get('/analytics/cohorts/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const c = getCohort(id);
    if (!c) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: { cohort: c, members: listCohortMembers(id) } });
  });

  app.post('/analytics/cohorts/:id/members', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const p = CohortMembersSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    if (!getCohort(id)) return reply.code(404).send({ success: false, error: 'not_found' });
    const added = addCohortMembers(id, p.data.user_ids);
    return reply.send({ success: true, data: { added } });
  });

  app.delete('/analytics/cohorts/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const ok = deleteCohort(id);
    return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  // ===== 26.10 Funnel =====
  app.post('/analytics/funnels', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = FunnelSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createFunnel(p.data.name, p.data.steps) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/analytics/funnels', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: { funnels: listFunnels() } });
  });

  app.get('/analytics/funnels/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const f = getFunnel(id);
    if (!f) return reply.code(404).send({ success: false, error: 'not_found' });
    try { return reply.send({ success: true, data: { funnel: f, analysis: analyzeFunnel(id) } }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/analytics/funnels/:id/events', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const p = FunnelEventSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: recordFunnelEvent({ funnel_id: id, ...p.data }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  // ===== 26.13 Re-watch =====
  app.post('/analytics/rewatch/:videoId/compute', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { videoId } = req.params as { videoId: string };
    const p = RewatchSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: { segments: computeRewatchSegments(videoId, p.data.samples) } }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/analytics/rewatch/:videoId', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { limit?: string };
    return reply.send({ success: true, data: { segments: listRewatchSegments(videoId, q.limit ? Number(q.limit) : 50) } });
  });

  // ===== 26.16 Scroll Depth =====
  app.post('/analytics/scroll', async (req, reply) => {
    const p = ScrollSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: recordScrollDepth(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/analytics/scroll/:pageKind/:pageId', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { pageKind, pageId } = req.params as { pageKind: string; pageId: string };
    return reply.send({ success: true, data: aggregateScrollDepth(pageKind, pageId) });
  });

  // ===== 26.17 Session Recording =====
  app.post('/analytics/sessions/start', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = SessionStartSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: startSessionRecording(actor, p.data.session_id) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/analytics/sessions/:sessionId/events', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { sessionId } = req.params as { sessionId: string };
    const p = SessionEventSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try {
      const r = appendSessionEvents(sessionId, p.data.events);
      if (!r) return reply.code(404).send({ success: false, error: 'not_found' });
      return reply.send({ success: true, data: r });
    } catch (e) { return reply.code(409).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/analytics/sessions/:sessionId/end', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { sessionId } = req.params as { sessionId: string };
    const p = SessionEndSchema.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    const r = endSessionRecording(sessionId, p.data.storage_ref);
    if (!r) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: r });
  });

  app.get('/analytics/sessions/mine', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const q = req.query as { limit?: string };
    return reply.send({ success: true, data: { sessions: listSessionRecordings({ user_id: actor, limit: q.limit ? Number(q.limit) : 100 }) } });
  });

  app.get('/analytics/sessions/:sessionId', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { sessionId } = req.params as { sessionId: string };
    const r = getSessionRecording(sessionId);
    if (!r) return reply.code(404).send({ success: false, error: 'not_found' });
    if (r.user_id !== actor && !admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'not_allowed' });
    return reply.send({ success: true, data: r });
  });

  // ===== Stats =====
  app.get('/analytics/core-stats', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getAnalyticsCoreStats() });
  });

  app.get('/analytics/advanced-stats', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getAnalyticsAdvancedStats() });
  });
}
