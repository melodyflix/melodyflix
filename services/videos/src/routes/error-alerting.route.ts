// melodyflix videos - Section 12.9 Error Alerting routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  createRule, getRule, listRules, updateRule, deleteRule,
  fireAlert, getEvent, listEvents,
  acknowledgeEvent, resolveEvent, reopenEvent,
  createSilence, listSilences, deleteSilence,
  getAlertingStats, evaluateRule, evaluateAllRules,
} from '../services/error-alerting.service.js';

const SOURCES = ['playback','api','cdn','job','system','security'] as const;
const SEVERITIES = ['info','warning','error','critical'] as const;
const STATUSES = ['open','acknowledged','resolved','silenced'] as const;

const RuleSchema = z.object({
  name: z.string().min(2).max(120),
  source: z.enum(SOURCES),
  severity: z.enum(SEVERITIES).optional(),
  condition_type: z.string().min(1).max(80),
  threshold: z.number().min(0).optional(),
  window_seconds: z.number().int().min(1).max(86_400).optional(),
  cooldown_seconds: z.number().int().min(0).max(86_400).optional(),
  webhook_url: z.string().url().max(500).nullable().optional(),
  channels: z.array(z.string().max(40)).max(20).optional(),
  enabled: z.boolean().optional(),
});

const UpdateRuleSchema = RuleSchema.partial();

const FireSchema = z.object({
  source: z.enum(SOURCES),
  severity: z.enum(SEVERITIES).optional(),
  fingerprint: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  message: z.string().max(2000).nullable().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  rule_id: z.string().max(100).nullable().optional(),
});

const SilenceSchema = z.object({
  fingerprint: z.string().max(200).nullable().optional(),
  source: z.enum(SOURCES).nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
  until_at: z.string().datetime(),
});

function admin(auth: string | undefined): boolean {
  try { requireRole(auth, ['admin']); return true; } catch { return false; }
}
function user(auth: string | undefined): string | null {
  try {
    const payload: any = requireRole(auth, ['admin','user','moderator']);
    return payload?.sub ?? payload?.id ?? null;
  } catch { return null; }
}

export async function errorAlertingRoutes(app: FastifyInstance): Promise<void> {
  // ============ RULES ============
  app.post('/alerts/rules', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = RuleSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createRule(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/alerts/rules', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as { source?: string; enabled?: string };
    const rules = listRules({ source: q.source as any, enabledOnly: q.enabled === '1' || q.enabled === 'true' });
    return reply.send({ success: true, data: { rules, total: rules.length } });
  });

  app.get('/alerts/rules/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const r = getRule(id);
    if (!r) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: r });
  });

  app.patch('/alerts/rules/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const p = UpdateRuleSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    const r = updateRule(id, p.data as any);
    if (!r) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: r });
  });

  app.delete('/alerts/rules/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const ok = deleteRule(id);
    return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  app.post('/alerts/rules/:id/evaluate', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: evaluateRule(id) }); }
    catch (e) { return reply.code(404).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/alerts/rules/evaluate-all', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: { results: evaluateAllRules() } });
  });

  // ============ FIRE ============
  app.post('/alerts/fire', async (req, reply) => {
    const p = FireSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: fireAlert(p.data as any) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  // ============ EVENTS ============
  app.get('/alerts/events', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as { status?: string; severity?: string; source?: string; fingerprint?: string; limit?: string };
    const events = listEvents({
      status: q.status as any,
      severity: q.severity as any,
      source: q.source as any,
      fingerprint: q.fingerprint,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return reply.send({ success: true, data: { events, total: events.length } });
  });

  app.get('/alerts/events/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const e = getEvent(id);
    if (!e) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: e });
  });

  app.post('/alerts/events/:id/acknowledge', async (req, reply) => {
    const actor = user(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    try {
      const e = acknowledgeEvent(id, actor);
      if (!e) return reply.code(404).send({ success: false, error: 'not_found' });
      return reply.send({ success: true, data: e });
    } catch (e) { return reply.code(409).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/alerts/events/:id/resolve', async (req, reply) => {
    const actor = user(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { note?: string };
    const e = resolveEvent(id, actor, body.note);
    if (!e) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: e });
  });

  app.post('/alerts/events/:id/reopen', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const e = reopenEvent(id);
    if (!e) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: e });
  });

  // ============ SILENCES ============
  app.post('/alerts/silences', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = SilenceSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    const actor = user(req.headers.authorization);
    try {
      const s = createSilence({ ...p.data, created_by: actor });
      return reply.code(201).send({ success: true, data: s });
    } catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/alerts/silences', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as { all?: string };
    const all = q.all === '1' || q.all === 'true';
    return reply.send({ success: true, data: { silences: listSilences(!all) } });
  });

  app.delete('/alerts/silences/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const ok = deleteSilence(id);
    return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  // ============ STATS ============
  app.get('/alerts/stats', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getAlertingStats() });
  });
}
