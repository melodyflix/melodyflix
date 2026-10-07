// melodyflix videos - Section 11.14 Fraud Detection routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  recordFraudEvent, getFraudEvent, listFraudEvents, listSignals,
  reviewFraudEvent, getFraudStats, pruneOldEvents,
} from './fraud-detection.service.js';

const ACTIONS = [
  'signup', 'login', 'payment', 'refund', 'promo_redeem',
  'referral_claim', 'payout', 'content_upload',
] as const;

const DECISIONS = ['allow', 'review', 'block'] as const;
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const REVIEW_STATUSES = ['new', 'in_review', 'approved', 'blocked', 'dismissed'] as const;

const RecordSchema = z.object({
  action: z.enum(ACTIONS),
  ip_address: z.string().max(64).nullable().optional(),
  device_fingerprint: z.string().max(500).nullable().optional(),
  country: z.string().max(10).nullable().optional(),
  email: z.string().email().max(200).nullable().optional(),
  amount_cents: z.number().int().min(0).nullable().optional(),
  currency: z.string().max(10).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

const ReviewSchema = z.object({
  status: z.enum(REVIEW_STATUSES),
  note: z.string().max(1000).nullable().optional(),
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

export async function fraudDetectionRoutes(app: FastifyInstance) {
  // POST /fraud/record — auth: record a user-initiated event (also used by
  // other services via internal call or shared session token).
  app.post('/fraud/record', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const parsed = RecordSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const event = recordFraudEvent({ ...parsed.data, user_id: auth.userId! });
      return reply.code(201).send({ success: true, data: event });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /fraud/check — public: lightweight check (no persist) — for
  // pre-flight on signup/payment screens.
  app.post('/fraud/check', async (req, reply) => {
    const parsed = RecordSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    // We still need a user — check runs under the current session
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    try {
      const event = recordFraudEvent({ ...parsed.data, user_id: auth.userId! });
      return reply.send({ success: true, data: { decision: event.decision, severity: event.severity, score: event.score, reasons: JSON.parse(event.reasons) } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /fraud/events/mine — my events
  app.get('/fraud/events/mine', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const q = req.query as { limit?: string; offset?: string };
    const result = listFraudEvents({
      user_id: auth.userId!,
      limit: q.limit ? parseInt(q.limit, 10) : 50,
      offset: q.offset ? parseInt(q.offset, 10) : 0,
    });
    return reply.send({ success: true, data: result });
  });

  // GET /fraud/events/:id — own or admin
  app.get('/fraud/events/:id', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const evt = getFraudEvent(id);
    if (!evt) return reply.code(404).send({ success: false, error: 'Event not found' });

    if (evt.user_id !== auth.userId && auth.role !== 'admin') {
      return reply.code(403).send({ success: false, error: 'Access denied' });
    }
    return reply.send({ success: true, data: evt });
  });

  // GET /fraud/events/:id/signals — signals breakdown
  app.get('/fraud/events/:id/signals', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const evt = getFraudEvent(id);
    if (!evt) return reply.code(404).send({ success: false, error: 'Event not found' });

    if (evt.user_id !== auth.userId && auth.role !== 'admin') {
      return reply.code(403).send({ success: false, error: 'Access denied' });
    }
    return reply.send({ success: true, data: { signals: listSignals(id) } });
  });

  // ============================================================
  // Admin endpoints
  // ============================================================

  // GET /fraud/events — list all
  app.get('/fraud/events', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as Record<string, string | undefined>;
    const result = listFraudEvents({
      user_id: q.user_id,
      action: q.action as any,
      decision: q.decision as any,
      severity: q.severity as any,
      status: q.status,
      min_score: q.min_score ? parseInt(q.min_score, 10) : undefined,
      limit: q.limit ? parseInt(q.limit, 10) : 50,
      offset: q.offset ? parseInt(q.offset, 10) : 0,
    });
    return reply.send({ success: true, data: result });
  });

  // POST /fraud/events/:id/review — admin review
  app.post('/fraud/events/:id/review', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const parsed = ReviewSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const evt = reviewFraudEvent(id, auth.userId!, parsed.data.status, parsed.data.note ?? undefined);
      return reply.send({ success: true, data: evt });
    } catch (err) {
      const msg = (err as Error).message;
      return reply.code(msg === 'Event not found' ? 404 : 400).send({ success: false, error: msg });
    }
  });

  // GET /fraud/stats/summary
  app.get('/fraud/stats/summary', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const q = req.query as { window_days?: string };
    const days = q.window_days ? parseInt(q.window_days, 10) : 30;
    return reply.send({ success: true, data: getFraudStats(days) });
  });

  // POST /fraud/maintenance/prune
  app.post('/fraud/maintenance/prune', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const parsed = PruneSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const result = pruneOldEvents(parsed.data.older_than_days ?? 365);
    return reply.send({ success: true, data: result });
  });
}
