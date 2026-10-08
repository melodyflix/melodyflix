// melodyflix videos - compliance routes (Section 50)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  ensureComplianceSchema, seedComplianceDefaults,
  getVideoCompliance, ensureVideoCompliance, setVideoCompliance, canView,
  listComplianceByRating, listGatedVideos, listCoppaVideos,
  recordAgeVerification, getAgeVerification, listAgeVerifications,
  upsertRegionalRule, listRegionalRules, deleteRegionalRule,
  createChecklistTemplate, listChecklistTemplates, getChecklistTemplate, deleteChecklistTemplate,
  startChecklistRun, getChecklistRun, listChecklistRuns, updateChecklistRun,
  addEvidence, listEvidence, deleteEvidence,
  createPolicyVersion, listPolicyVersions, getPolicyById, getActivePolicy,
  publishPolicy, listAllPolicies,
  generateAuditReport, getAuditReport, listAuditReports, finalizeAuditReport, deleteAuditReport,
} from '../services/compliance.service.js';

const AgeRatingEnum = z.enum(['unrated','G','PG','PG-13','R','NC-17','TV-Y','TV-G','TV-PG','TV-14','TV-MA']);

export async function complianceRoutes(app: FastifyInstance) {
  ensureComplianceSchema();
  seedComplianceDefaults();

  const isAdmin = async (req: any, reply: any) => {
    try { requireRole(req.headers.authorization, ['admin']); return true; }
    catch (err) { reply.code(403).send({ success: false, error: (err as Error).message }); return false; }
  };

  // ============ 50.1 + 50.2 + 50.3 Per-video compliance ============
  app.get('/videos/:videoId/compliance', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const c = getVideoCompliance(videoId) ?? ensureVideoCompliance(videoId);
    return reply.send({ success: true, data: c });
  });

  app.put('/videos/:videoId/compliance', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { videoId } = req.params as { videoId: string };
    const BodySchema = z.object({
      coppa_child_directed: z.boolean().optional(),
      coppa_personal_info_collected: z.boolean().optional(),
      age_rating: AgeRatingEnum.optional(),
      regional_ratings: z.record(z.string()).optional(),
      requires_age_gate: z.boolean().optional(),
      min_age: z.number().int().min(0).max(21).optional(),
      regional_restrictions: z.array(z.object({ country: z.string().length(2), reason: z.string().max(300) })).optional(),
      notes: z.string().max(2000).nullable().optional(),
      reviewed_by: z.string().optional(),
    });
    const parsed = BodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    return reply.send({ success: true, data: setVideoCompliance(videoId, parsed.data) });
  });

  app.get('/compliance/videos/by-rating/:rating', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { rating } = req.params as { rating: string };
    return reply.send({ success: true, data: { videos: listComplianceByRating(rating as any) } });
  });

  app.get('/compliance/videos/gated', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    return reply.send({ success: true, data: { videos: listGatedVideos() } });
  });

  app.get('/compliance/videos/coppa', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    return reply.send({ success: true, data: { videos: listCoppaVideos() } });
  });

  // Access check (viewer-facing)
  app.get('/videos/:videoId/compliance/can-view', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { age?: string; country?: string };
    const c = getVideoCompliance(videoId);
    if (!c) return reply.send({ success: true, data: { allowed: true } });
    const age = q.age ? Number(q.age) : null;
    const res = canView(c, Number.isFinite(age as number) ? (age as number) : null, q.country);
    return reply.send({ success: true, data: res });
  });

  // Age verification (users)
  app.post('/age-verifications', async (req, reply) => {
    const BodySchema = z.object({
      user_id: z.string().min(1),
      method: z.string().max(40).optional(),
      min_age: z.number().int().min(0).max(21).optional(),
      country: z.string().length(2).optional(),
      status: z.enum(['verified', 'pending', 'failed']).optional(),
      meta: z.record(z.unknown()).optional(),
    });
    const parsed = BodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    return reply.code(201).send({ success: true, data: recordAgeVerification(parsed.data) });
  });

  app.get('/age-verifications/:userId', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { userId } = req.params as { userId: string };
    return reply.send({ success: true, data: { current: getAgeVerification(userId), all: listAgeVerifications(userId) } });
  });

  // ============ 50.4 Regional rules ============
  app.put('/compliance/regional-rules', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const BodySchema = z.object({
      country: z.string().length(2),
      region: z.string().max(20).nullable().optional(),
      regulation: z.string().min(1).max(60),
      rule_key: z.string().min(1).max(80),
      rule_value: z.record(z.unknown()).optional(),
      description: z.string().max(500).optional(),
      is_active: z.boolean().optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try { return reply.send({ success: true, data: upsertRegionalRule(parsed.data) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.get('/compliance/regional-rules', async (req, reply) => {
    const q = req.query as { country?: string };
    return reply.send({ success: true, data: { rules: listRegionalRules(q.country) } });
  });

  app.delete('/compliance/regional-rules/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const ok = deleteRegionalRule(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Rule not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // ============ 50.5 Checklists ============
  app.post('/compliance/checklist-templates', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const BodySchema = z.object({
      name: z.string().min(1).max(120),
      scope: z.string().min(1).max(40),
      description: z.string().max(500).optional(),
      items: z.array(z.object({
        key: z.string().min(1).max(60),
        label: z.string().min(1).max(200),
        required: z.boolean(),
        weight: z.number().min(0).max(100).optional(),
      })).min(1).max(100),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try { return reply.code(201).send({ success: true, data: createChecklistTemplate(parsed.data) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.get('/compliance/checklist-templates', async (req, reply) => {
    const q = req.query as { scope?: string };
    return reply.send({ success: true, data: { templates: listChecklistTemplates(q.scope) } });
  });

  app.get('/compliance/checklist-templates/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = getChecklistTemplate(id);
    if (!t) return reply.code(404).send({ success: false, error: 'Template not found' });
    return reply.send({ success: true, data: t });
  });

  app.delete('/compliance/checklist-templates/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const ok = deleteChecklistTemplate(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Template not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  app.post('/compliance/checklist-runs', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const BodySchema = z.object({
      template_id: z.string().min(1),
      target_type: z.string().min(1).max(40),
      target_id: z.string().min(1),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try { return reply.code(201).send({ success: true, data: startChecklistRun(parsed.data) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.get('/compliance/checklist-runs', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const q = req.query as { target_type?: string; target_id?: string };
    return reply.send({ success: true, data: { runs: listChecklistRuns(q.target_type, q.target_id) } });
  });

  app.get('/compliance/checklist-runs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = getChecklistRun(id);
    if (!r) return reply.code(404).send({ success: false, error: 'Run not found' });
    return reply.send({ success: true, data: r });
  });

  app.patch('/compliance/checklist-runs/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const BodySchema = z.object({
      responses: z.record(z.object({
        passed: z.boolean(),
        note: z.string().max(500).optional(),
        checked_at: z.string().optional(),
      })).optional(),
      complete: z.boolean().optional(),
      completed_by: z.string().optional(),
    });
    const parsed = BodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const r = updateChecklistRun(id, parsed.data);
    if (!r) return reply.code(404).send({ success: false, error: 'Run not found' });
    return reply.send({ success: true, data: r });
  });

  // ============ 50.6 Evidence ============
  app.post('/compliance/evidence', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const BodySchema = z.object({
      target_type: z.string().min(1).max(40),
      target_id: z.string().min(1),
      kind: z.enum(['file', 'url', 'text', 'screenshot']).optional(),
      title: z.string().min(1).max(200),
      url: z.string().max(1000).optional(),
      body_text: z.string().max(20000).optional(),
      mime_type: z.string().max(80).optional(),
      size_bytes: z.number().int().min(0).optional(),
      hash_sha256: z.string().length(64).optional(),
      collected_by: z.string().optional(),
      notes: z.string().max(1000).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    return reply.code(201).send({ success: true, data: addEvidence(parsed.data) });
  });

  app.get('/compliance/evidence', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const q = req.query as { target_type?: string; target_id?: string };
    if (!q.target_type || !q.target_id) return reply.code(400).send({ success: false, error: 'target_type + target_id required' });
    return reply.send({ success: true, data: { evidence: listEvidence(q.target_type, q.target_id) } });
  });

  app.delete('/compliance/evidence/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const ok = deleteEvidence(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Evidence not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // ============ 50.8 Policy versioning ============
  app.post('/compliance/policies', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const BodySchema = z.object({
      policy_key: z.string().min(1).max(60),
      title: z.string().min(1).max(200),
      body_md: z.string().min(1).max(200000),
      effective_at: z.string().optional(),
      created_by: z.string().optional(),
      supersede_current: z.boolean().optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try { return reply.code(201).send({ success: true, data: createPolicyVersion(parsed.data) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.get('/compliance/policies', async (_req, reply) => {
    return reply.send({ success: true, data: { policies: listAllPolicies() } });
  });

  app.get('/compliance/policies/:key/versions', async (req, reply) => {
    const { key } = req.params as { key: string };
    return reply.send({ success: true, data: { versions: listPolicyVersions(key) } });
  });

  app.get('/compliance/policies/:key/active', async (req, reply) => {
    const { key } = req.params as { key: string };
    return reply.send({ success: true, data: getActivePolicy(key) });
  });

  app.get('/compliance/policies/by-id/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = getPolicyById(id);
    if (!p) return reply.code(404).send({ success: false, error: 'Policy not found' });
    return reply.send({ success: true, data: p });
  });

  app.post('/compliance/policies/:id/publish', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const p = publishPolicy(id);
    if (!p) return reply.code(404).send({ success: false, error: 'Policy not found' });
    return reply.send({ success: true, data: p });
  });

  // ============ 50.7 Audit reports ============
  app.post('/compliance/audit-reports', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const BodySchema = z.object({
      target_type: z.enum(['video', 'channel', 'platform']),
      target_id: z.string().min(1),
      period_start: z.string().min(1),
      period_end: z.string().min(1),
      generated_by: z.string().optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try { return reply.code(201).send({ success: true, data: generateAuditReport(parsed.data) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.get('/compliance/audit-reports', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const q = req.query as { target_type?: string; target_id?: string };
    return reply.send({ success: true, data: { reports: listAuditReports(q.target_type, q.target_id) } });
  });

  app.get('/compliance/audit-reports/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const r = getAuditReport(id);
    if (!r) return reply.code(404).send({ success: false, error: 'Report not found' });
    return reply.send({ success: true, data: r });
  });

  app.post('/compliance/audit-reports/:id/finalize', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const r = finalizeAuditReport(id);
    if (!r) return reply.code(404).send({ success: false, error: 'Report not found' });
    return reply.send({ success: true, data: r });
  });

  app.delete('/compliance/audit-reports/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const ok = deleteAuditReport(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Report not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });
}
