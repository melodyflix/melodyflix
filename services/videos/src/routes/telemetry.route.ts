// melodyflix videos — Playback Telemetry routes (Section 42.3, 42.5, 42.7)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  startSession, getSession, endSession,
  recordError, listErrors,
  recordBandwidth, recentBandwidth,
  getQoeMetrics, topProblemsByVideo,
} from '../services/telemetry.service.js';

const END_REASONS = ['completed','abandoned','error','unknown'] as const;
const ERROR_TYPES = ['network','decode','drm','manifest','segment','timeout','media','unknown'] as const;

function userId(req: any): string | null {
  return req.user?.id ?? req.user?.sub ?? null;
}

function isAdmin(req: any): boolean {
  const u = req.user as any;
  const roles = u?.roles ?? [];
  return Array.isArray(roles) && roles.includes('admin');
}

export async function telemetryRoutes(app: FastifyInstance) {
  // ---- Session lifecycle ----

  const StartSchema = z.object({
    video_id: z.string().min(1),
    quality: z.string().max(40).nullable().optional(),
    cdn: z.string().max(80).nullable().optional(),
    player_version: z.string().max(80).nullable().optional(),
    platform: z.string().max(80).nullable().optional(),
  });

  // POST /telemetry/sessions — start a playback session
  app.post('/telemetry/sessions', async (req, reply) => {
    const parsed = StartSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    const me = userId(req as any);
    const session = startSession({ user_id: me, ...parsed.data });
    return reply.code(201).send({ success: true, data: { session } });
  });

  const EndSchema = z.object({
    duration_ms: z.number().int().min(0).max(24 * 3600 * 1000).optional(),
    rebuffer_ms: z.number().int().min(0).max(24 * 3600 * 1000).optional(),
    rebuffer_count: z.number().int().min(0).max(10000).optional(),
    startup_ms: z.number().int().min(0).max(120_000).optional(),
    avg_bitrate_kbps: z.number().int().min(0).max(200_000).optional(),
    bitrate_switches: z.number().int().min(0).max(10000).optional(),
    bytes_streamed: z.number().int().min(0).max(100 * 1024 * 1024 * 1024).optional(),
    end_reason: z.enum(END_REASONS).optional(),
  });

  // PATCH /telemetry/sessions/:id — end a session with metrics
  app.patch('/telemetry/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = EndSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    const session = endSession(id, parsed.data);
    if (!session) return reply.code(404).send({ success: false, error: 'Session not found' });
    return reply.send({ success: true, data: { session } });
  });

  // GET /telemetry/sessions/:id
  app.get('/telemetry/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = getSession(id);
    if (!session) return reply.code(404).send({ success: false, error: 'Session not found' });
    const errors = listErrors(id);
    return reply.send({ success: true, data: { session, errors } });
  });

  // ---- Errors ----

  const ErrorSchema = z.object({
    session_id: z.string().min(1),
    error_type: z.enum(ERROR_TYPES).optional(),
    error_code: z.string().max(80).nullable().optional(),
    message: z.string().max(1000).nullable().optional(),
    fatal: z.boolean().optional(),
    at_position_ms: z.number().int().min(0).max(24 * 3600 * 1000).optional(),
  });

  // POST /telemetry/errors — record a playback error
  app.post('/telemetry/errors', async (req, reply) => {
    const parsed = ErrorSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    try {
      const err = recordError(parsed.data);
      return reply.code(201).send({ success: true, data: { error: err } });
    } catch (e: any) {
      if (e?.message === 'Session not found') {
        return reply.code(404).send({ success: false, error: 'Session not found' });
      }
      throw e;
    }
  });

  // GET /telemetry/sessions/:id/errors — list errors for a session
  app.get('/telemetry/sessions/:id/errors', async (req, reply) => {
    const { id } = req.params as { id: string };
    const errors = listErrors(id);
    return reply.send({ success: true, data: { errors, count: errors.length } });
  });

  // ---- Bandwidth ----

  const BwSchema = z.object({
    session_id: z.string().min(1),
    throughput_kbps: z.number().int().min(0).max(10_000_000),
    latency_ms: z.number().int().min(0).max(60_000).nullable().optional(),
  });

  // POST /telemetry/bandwidth — record a throughput sample
  app.post('/telemetry/bandwidth', async (req, reply) => {
    const parsed = BwSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    try {
      const sample = recordBandwidth(parsed.data);
      return reply.code(201).send({ success: true, data: { sample } });
    } catch (e: any) {
      if (e?.message === 'Session not found') {
        return reply.code(404).send({ success: false, error: 'Session not found' });
      }
      throw e;
    }
  });

  // GET /telemetry/sessions/:id/bandwidth — recent throughput samples
  app.get('/telemetry/sessions/:id/bandwidth', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string };
    const samples = recentBandwidth(id, q.limit ? parseInt(q.limit) : 20);
    return reply.send({ success: true, data: { samples, count: samples.length } });
  });

  // ---- QoE metrics (42.5) ----

  // GET /telemetry/qoe — aggregated QoE metrics
  // Public read for dashboards, but only aggregated; no per-user leakage.
  app.get('/telemetry/qoe', async (req, reply) => {
    const q = req.query as { video_id?: string; user_id?: string; from?: string; to?: string };
    // Restrict user_id filter to admins to prevent cross-user snooping
    const me = userId(req as any);
    const userFilter = isAdmin(req as any) ? q.user_id : (q.user_id && q.user_id === me ? me : undefined);
    const metrics = getQoeMetrics({
      video_id: q.video_id,
      user_id: userFilter,
      from: q.from,
      to: q.to,
    });
    return reply.send({ success: true, data: metrics });
  });

  // GET /telemetry/problems — top problem videos
  app.get('/telemetry/problems', async (req, reply) => {
    const q = req.query as { from?: string; to?: string; limit?: string };
    const problems = topProblemsByVideo({
      from: q.from,
      to: q.to,
      limit: q.limit ? parseInt(q.limit) : 20,
    });
    return reply.send({ success: true, data: { problems, count: problems.length } });
  });
}
