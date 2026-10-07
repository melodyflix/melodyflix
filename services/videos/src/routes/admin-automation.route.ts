// melodyflix videos - Section 17 Administration and Automation routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  logAudit, listAudit, getAuditEntry,
  createAnnouncement, getAnnouncement, publishAnnouncement, listAnnouncements,
  createRule, getRule, listRules, updateRule, deleteRule, fireRule, listRuleRuns,
  createMaintenance, getMaintenance, listMaintenance, activateMaintenance, deactivateMaintenance, getActiveMaintenance,
  createBulkJob, getBulkJob, runBulkJob, listBulkJobs,
  createReportTemplate, getReportTemplate, listReportTemplates, generateReport, listReportInstances,
  getAdminAutomationStats,
} from '../services/admin-automation.service.js';

const AUDIENCE = ['all','role','users'] as const;
const PRIORITY = ['low','normal','high','critical'] as const;
const TRIGGER = ['event','schedule','metric'] as const;
const R_ACTION = ['notify','suspend','unsuspend','flag','role_change','webhook'] as const;
const MAINT_SCOPE = ['platform','videos','auth','channel','notifications','admin'] as const;
const BULK_ACTION = ['suspend','unsuspend','role_change','notify','delete'] as const;
const BULK_STATUS = ['pending','running','completed','failed','cancelled'] as const;
const REPORT_KIND = ['daily','weekly','monthly','custom'] as const;

const AuditSchema = z.object({
  action: z.string().min(1).max(100),
  resource_type: z.string().max(60).nullable().optional(),
  resource_id: z.string().max(100).nullable().optional(),
  changes: z.record(z.string(), z.unknown()).optional(),
});

const AnnouncementSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(10000),
  audience: z.enum(AUDIENCE).optional(),
  audience_value: z.string().max(200).nullable().optional(),
  priority: z.enum(PRIORITY).optional(),
  scheduled_at: z.string().datetime().nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
});

const RuleSchema = z.object({
  name: z.string().min(2).max(200),
  trigger_type: z.enum(TRIGGER),
  trigger_value: z.string().max(200).nullable().optional(),
  condition: z.record(z.string(), z.unknown()).optional(),
  action_type: z.enum(R_ACTION),
  action_params: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

const FireSchema = z.object({
  payload: z.record(z.string(), z.unknown()).optional(),
});

const MaintenanceSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  scope: z.enum(MAINT_SCOPE).optional(),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  notify_users: z.boolean().optional(),
});

const BulkSchema = z.object({
  action_type: z.enum(BULK_ACTION),
  user_ids: z.array(z.string().min(1).max(100)).min(1).max(10000),
  params: z.record(z.string(), z.unknown()).optional(),
});

const ReportTemplateSchema = z.object({
  name: z.string().min(2).max(200),
  kind: z.enum(REPORT_KIND).optional(),
  metrics: z.array(z.string().max(80)).max(50).optional(),
  cron: z.string().max(80).nullable().optional(),
  recipients: z.array(z.string().email()).max(50).optional(),
  enabled: z.boolean().optional(),
});

const GenerateReportSchema = z.object({
  template_id: z.string().max(100).nullable().optional(),
  kind: z.enum(REPORT_KIND),
  period_start: z.string().datetime(),
  period_end: z.string().datetime(),
  data: z.record(z.string(), z.unknown()).optional(),
});

function uid(auth: string | undefined): string | null {
  try { const p: any = requireRole(auth, ['admin','user','moderator']); return p?.sub ?? p?.id ?? null; } catch { return null; }
}
function role(auth: string | undefined): string | null {
  try { const p: any = requireRole(auth, ['admin','user','moderator']); return p?.role ?? null; } catch { return null; }
}
function admin(auth: string | undefined): boolean {
  try { requireRole(auth, ['admin']); return true; } catch { return false; }
}

export async function adminAutomationRoutes(app: FastifyInstance): Promise<void> {
  // ============ 17.2 AUDIT LOG ============
  app.post('/automation/audit', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = AuditSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    const xf = req.headers['x-forwarded-for'];
    const ip = typeof xf === 'string' ? xf.split(',')[0].trim() : (req.ip ?? null);
    return reply.code(201).send({ success: true, data: logAudit({
      actor_id: actor, actor_role: role(req.headers.authorization),
      ...p.data, ip, user_agent: (req.headers['user-agent'] as string | undefined) ?? null,
    }) });
  });

  app.get('/automation/audit', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as any;
    return reply.send({ success: true, data: { entries: listAudit({
      actor_id: q.actor_id, action: q.action, resource_type: q.resource_type,
      resource_id: q.resource_id, from: q.from, to: q.to,
      limit: q.limit ? Number(q.limit) : undefined,
    }) } });
  });

  app.get('/automation/audit/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const e = getAuditEntry(id);
    if (!e) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: e });
  });

  // ============ 17.3 ANNOUNCEMENTS ============
  app.post('/automation/announcements', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = AnnouncementSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createAnnouncement({ ...p.data, created_by: actor }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/automation/announcements', async (req, reply) => {
    const q = req.query as any;
    return reply.send({ success: true, data: { items: listAnnouncements({
      published: q.published !== undefined ? (q.published === '1' || q.published === 'true') : undefined,
      audience: q.audience, active: q.active === '1' || q.active === 'true',
      limit: q.limit ? Number(q.limit) : undefined,
    }) } });
  });

  app.post('/automation/announcements/:id/publish', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: publishAnnouncement(id, actor) }); }
    catch (e) { return reply.code(404).send({ success: false, error: (e as Error).message }); }
  });

  // ============ 17.4 RULES ============
  app.post('/automation/rules', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = RuleSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createRule({ ...p.data, created_by: actor }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/automation/rules', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as any;
    return reply.send({ success: true, data: { rules: listRules({
      trigger_type: q.trigger_type, enabledOnly: q.enabled === '1' || q.enabled === 'true',
    }) } });
  });

  app.get('/automation/rules/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const r = getRule(id);
    if (!r) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: r });
  });

  app.patch('/automation/rules/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const p = RuleSchema.partial().safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    const r = updateRule(id, p.data);
    return r ? reply.send({ success: true, data: r }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  app.delete('/automation/rules/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const ok = deleteRule(id);
    return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  app.post('/automation/rules/:id/fire', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const p = FireSchema.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: fireRule({ rule_id: id, payload: p.data.payload, triggered_by: actor }) }); }
    catch (e) { return reply.code(404).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/automation/rule-runs', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as any;
    return reply.send({ success: true, data: { runs: listRuleRuns(q.rule_id, q.limit ? Number(q.limit) : 100) } });
  });


  // ============ 17.5 MAINTENANCE ============
  app.post('/automation/maintenance', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = MaintenanceSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createMaintenance({ ...p.data, created_by: actor }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/automation/maintenance', async (req, reply) => {
    const q = req.query as any;
    return reply.send({ success: true, data: { windows: listMaintenance({
      active: q.active === '1' || q.active === 'true',
      upcoming: q.upcoming === '1' || q.upcoming === 'true',
      limit: q.limit ? Number(q.limit) : undefined,
    }) } });
  });

  app.get('/automation/maintenance/active', async (req, reply) => {
    const m = getActiveMaintenance();
    return reply.send({ success: true, data: m });
  });

  app.post('/automation/maintenance/:id/activate', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: activateMaintenance(id, actor) }); }
    catch (e) { return reply.code(404).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/automation/maintenance/:id/deactivate', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: deactivateMaintenance(id, actor) }); }
    catch (e) { return reply.code(404).send({ success: false, error: (e as Error).message }); }
  });

  // ============ 17.6 BULK JOBS ============
  app.post('/automation/bulk-jobs', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = BulkSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createBulkJob({ ...p.data, requested_by: actor }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/automation/bulk-jobs', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as any;
    return reply.send({ success: true, data: { jobs: listBulkJobs({
      status: q.status, limit: q.limit ? Number(q.limit) : undefined,
    }) } });
  });

  app.get('/automation/bulk-jobs/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const j = getBulkJob(id);
    if (!j) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: j });
  });

  app.post('/automation/bulk-jobs/:id/run', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: runBulkJob(id, actor) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  // ============ 17.7 REPORT TEMPLATES + INSTANCES ============
  app.post('/automation/report-templates', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = ReportTemplateSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createReportTemplate({ ...p.data, created_by: actor }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/automation/report-templates', async (req, reply) => {
    const q = req.query as any;
    return reply.send({ success: true, data: { templates: listReportTemplates(q.enabled === '1' || q.enabled === 'true') } });
  });

  app.get('/automation/report-templates/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = getReportTemplate(id);
    if (!t) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: t });
  });

  app.post('/automation/reports/generate', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = GenerateReportSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: generateReport({ ...p.data, generated_by: actor }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/automation/reports', async (req, reply) => {
    const q = req.query as any;
    return reply.send({ success: true, data: { instances: listReportInstances({
      template_id: q.template_id, kind: q.kind, limit: q.limit ? Number(q.limit) : undefined,
    }) } });
  });

  // ============ STATS ============
  app.get('/automation/automation-stats', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getAdminAutomationStats() });
  });
}
