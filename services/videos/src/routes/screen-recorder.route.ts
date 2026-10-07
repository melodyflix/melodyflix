// melodyflix videos - Section 9.6 Screen Recorder routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  startSession, getSession, listSessions, listSessionsByChannel,
  heartbeat, recordChunk, pauseSession, resumeSession,
  finishSession, failSession, cancelSession, getRecorderStats,
} from '../services/screen-recorder.service.js';

const StartSchema = z.object({
  channel_id: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  source_type: z.enum(['screen','camera','screen_camera','audio_only']).optional(),
  resolution_w: z.number().int().min(240).max(7680).optional(),
  resolution_h: z.number().int().min(240).max(4320).optional(),
  fps: z.number().int().min(1).max(120).optional(),
  audio_enabled: z.boolean().optional(),
  mic_enabled: z.boolean().optional(),
  visibility: z.enum(['public','unlisted','private']).optional(),
});

const HeartbeatSchema = z.object({
  bytes_received: z.number().int().min(0).max(1e12).optional(),
  duration_seconds: z.number().min(0).max(86400).optional(),
});

const ChunkSchema = z.object({
  chunk_index: z.number().int().min(0).max(100000),
  byte_size: z.number().int().min(0).max(500_000_000),
});

const FinishSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  duration_seconds: z.number().min(0).max(86400).optional(),
  link_to_video_id: z.string().max(100).nullable().optional(),
  create_video: z.boolean().optional(),
});

const FailSchema = z.object({
  reason: z.string().min(1).max(2000),
});

function getAuth(authorization: string | undefined): { ok: boolean; userId?: string; error?: string } {
  try {
    const payload = requireAuth(authorization);
    return { ok: true, userId: payload.sub as string };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function screenRecorderRoutes(app: FastifyInstance): Promise<void> {
  // POST /screen-recorder/sessions — start new recording
  app.post('/screen-recorder/sessions', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });
    const parsed = StartSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    const session = startSession(parsed.data, auth.userId!);
    return reply.code(201).send({ success: true, data: { session } });
  });

  // GET /screen-recorder/sessions — list mine
  app.get('/screen-recorder/sessions', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });
    const q = req.query as { status?: string; limit?: string };
    const status = q.status as any;
    const limit = q.limit ? Math.min(Math.max(Number(q.limit), 1), 200) : 50;
    const sessions = listSessions(auth.userId!, { status, limit });
    return reply.send({ success: true, data: { sessions, total: sessions.length } });
  });

  // GET /screen-recorder/sessions/channel/:channelId
  app.get('/screen-recorder/sessions/channel/:channelId', async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(Number(q.limit), 1), 200) : 50;
    const sessions = listSessionsByChannel(channelId, limit);
    return reply.send({ success: true, data: { sessions, total: sessions.length } });
  });

  // GET /screen-recorder/stats — owner summary
  app.get('/screen-recorder/stats', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });
    return reply.send({ success: true, data: getRecorderStats(auth.userId!) });
  });

  // GET /screen-recorder/sessions/:id
  app.get('/screen-recorder/sessions/:id', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });
    const { id } = req.params as { id: string };
    const session = getSession(id);
    if (!session) return reply.code(404).send({ success: false, error: 'Not found' });
    if (session.owner_id !== auth.userId) return reply.code(403).send({ success: false, error: 'forbidden' });
    return reply.send({ success: true, data: { session } });
  });

  // POST /screen-recorder/sessions/:id/heartbeat
  app.post('/screen-recorder/sessions/:id/heartbeat', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });
    const { id } = req.params as { id: string };
    const parsed = HeartbeatSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    try {
      const session = heartbeat(id, auth.userId!, parsed.data);
      if (!session) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { session } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /screen-recorder/sessions/:id/chunk
  app.post('/screen-recorder/sessions/:id/chunk', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });
    const { id } = req.params as { id: string };
    const parsed = ChunkSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    try {
      const r = recordChunk(id, auth.userId!, parsed.data);
      if (!r) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: r });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /screen-recorder/sessions/:id/pause
  app.post('/screen-recorder/sessions/:id/pause', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });
    const { id } = req.params as { id: string };
    try {
      const session = pauseSession(id, auth.userId!);
      if (!session) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { session } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /screen-recorder/sessions/:id/resume
  app.post('/screen-recorder/sessions/:id/resume', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });
    const { id } = req.params as { id: string };
    try {
      const session = resumeSession(id, auth.userId!);
      if (!session) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { session } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /screen-recorder/sessions/:id/finish
  app.post('/screen-recorder/sessions/:id/finish', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });
    const { id } = req.params as { id: string };
    const parsed = FinishSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    try {
      const r = finishSession(id, auth.userId!, parsed.data);
      if (!r) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: r });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /screen-recorder/sessions/:id/fail
  app.post('/screen-recorder/sessions/:id/fail', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });
    const { id } = req.params as { id: string };
    const parsed = FailSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    try {
      const session = failSession(id, auth.userId!, parsed.data.reason);
      if (!session) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { session } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /screen-recorder/sessions/:id/cancel
  app.post('/screen-recorder/sessions/:id/cancel', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });
    const { id } = req.params as { id: string };
    try {
      const session = cancelSession(id, auth.userId!);
      if (!session) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { session } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });
}
