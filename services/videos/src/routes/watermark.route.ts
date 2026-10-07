// melodyflix videos - Section 19 Content Protection (Part B) routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  upsertWatermarkPolicy, getWatermarkPolicy,
  emitWatermarkTrace, traceToken, listTraces,
  reportLeak, detectLeakFromToken, resolveLeak, listLeaks,
  addPiracyTarget, updatePiracyStatus, fileDmca, listPiracyTargets,
  buildForensicReport, listForensicReports, verifyForensicReport,
  getWatermarkStats,
} from '../services/watermark.service.js';

const WM_STYLES = ['plain','semi_transparent','logo_plus_text','qr_code'] as const;
const WM_POSITIONS = ['top_left','top_right','bottom_left','bottom_right','center','random'] as const;
const LEAK_SEV = ['low','medium','high','critical'] as const;
const PIRACY_STATUS = ['open','investigating','action_taken','dismissed'] as const;

const WmPolicySchema = z.object({
  style: z.enum(WM_STYLES).optional(),
  position: z.enum(WM_POSITIONS).optional(),
  opacity: z.number().min(0).max(1).optional(),
  size_percent: z.number().int().min(1).max(50).optional(),
  include_user_id: z.boolean().optional(),
  include_timestamp: z.boolean().optional(),
  include_session_id: z.boolean().optional(),
  include_ip_hash: z.boolean().optional(),
  static_text: z.string().max(200).nullable().optional(),
  logo_url: z.string().url().max(2000).nullable().optional(),
  rotate_every_seconds: z.number().int().min(0).max(3600).optional(),
  enabled: z.boolean().optional(),
});

const TraceSchema = z.object({
  session_id: z.string().min(1).max(200),
  user_id: z.string().max(100).nullable().optional(),
  ttl_seconds: z.number().int().min(60).max(86400).optional(),
});

const LeakSchema = z.object({
  video_id: z.string().min(1).max(100),
  detector: z.string().min(1).max(80),
  severity: z.enum(LEAK_SEV).optional(),
  token: z.string().max(200).nullable().optional(),
  session_id: z.string().max(200).nullable().optional(),
  suspected_user_id: z.string().max(100).nullable().optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const DetectSchema = z.object({
  token: z.string().min(1).max(200),
  detector: z.string().min(1).max(80),
  notes: z.string().max(2000).optional(),
});

const PiracySchema = z.object({
  video_id: z.string().min(1).max(100),
  platform: z.string().min(1).max(80),
  url: z.string().url().max(2000),
  confidence: z.number().min(0).max(1).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const PiracyUpdateSchema = z.object({
  status: z.enum(PIRACY_STATUS),
  notes: z.string().max(2000).nullable().optional(),
});

const DmcaSchema = z.object({ notes: z.string().max(2000).nullable().optional() });

const ForensicSchema = z.object({
  period_start: z.string().datetime(),
  period_end: z.string().datetime(),
});

function admin(auth: string | undefined): boolean {
  try { requireRole(auth, ['admin']); return true; } catch { return false; }
}
function uid(auth: string | undefined): string | null {
  try { const p: any = requireRole(auth, ['admin','user','moderator']); return p?.sub ?? p?.id ?? null; } catch { return null; }
}
function clientIp(req: any): string | null {
  const xf = req.headers?.['x-forwarded-for'];
  if (typeof xf === 'string') return xf.split(',')[0].trim();
  return req.ip ?? null;
}

export async function watermarkRoutes(app: FastifyInstance): Promise<void> {
  // ===== Watermark policy =====
  app.post('/watermark/policy/:videoId', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { videoId } = req.params as { videoId: string };
    const p = WmPolicySchema.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: upsertWatermarkPolicy(videoId, p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/watermark/policy/:videoId', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const p = getWatermarkPolicy(videoId);
    if (!p) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: p });
  });

  // ===== Emit trace (19.10 + 19.13) =====
  app.post('/watermark/trace/:videoId', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { videoId } = req.params as { videoId: string };
    const p = TraceSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: emitWatermarkTrace({ video_id: videoId, ...p.data, ip: clientIp(req) }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/watermark/traces', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as any;
    return reply.send({ success: true, data: { items: listTraces({ video_id: q.video_id, session_id: q.session_id, user_id: q.user_id, limit: q.limit ? Number(q.limit) : undefined }) } });
  });

  app.get('/watermark/trace/:token', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { token } = req.params as { token: string };
    const t = traceToken(token);
    if (!t) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: t });
  });

  // ===== Leak detection =====
  app.post('/leaks', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = LeakSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: reportLeak(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/leaks/detect-from-token', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = DetectSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: detectLeakFromToken(p.data.token, p.data.detector, p.data.notes) }); }
    catch (e) { return reply.code(404).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/leaks', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as any;
    return reply.send({ success: true, data: { items: listLeaks({
      video_id: q.video_id, severity: q.severity,
      resolved: q.resolved !== undefined ? (q.resolved === '1' || q.resolved === 'true') : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    }) } });
  });

  app.post('/leaks/:id/resolve', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const ok = resolveLeak(id);
    return ok ? reply.send({ success: true, data: { resolved: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  // ===== Piracy =====
  app.post('/piracy', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = PiracySchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: addPiracyTarget(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/piracy', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as any;
    return reply.send({ success: true, data: { items: listPiracyTargets({ video_id: q.video_id, platform: q.platform, status: q.status, limit: q.limit ? Number(q.limit) : undefined }) } });
  });

  app.patch('/piracy/:id/status', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const p = PiracyUpdateSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: updatePiracyStatus(id, p.data.status, p.data.notes) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/piracy/:id/dmca', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const p = DmcaSchema.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: fileDmca(id, p.data.notes) }); }
    catch (e) { return reply.code(404).send({ success: false, error: (e as Error).message }); }
  });

  // ===== Forensic =====
  app.post('/forensic/:videoId', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { videoId } = req.params as { videoId: string };
    const p = ForensicSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: buildForensicReport({ video_id: videoId, ...p.data, requested_by: uid(req.headers.authorization) }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/forensic', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as { video_id?: string; limit?: string };
    return reply.send({ success: true, data: { items: listForensicReports(q.video_id, q.limit ? Number(q.limit) : 100) } });
  });

  app.get('/forensic/verify/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: verifyForensicReport(id) });
  });

  app.get('/watermark/stats', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getWatermarkStats() });
  });
}
