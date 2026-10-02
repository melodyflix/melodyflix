// melodyflix videos - poll routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, verifyJwt, extractBearerToken } from '@melodyflix/shared-auth';
import { getDb } from '@melodyflix/shared-db';
import {
  getPoll, getPollForVideo, createPoll, votePoll, closePoll, deletePoll,
} from '../services/poll.service.js';

const CreateSchema = z.object({
  question: z.string().min(1).max(280),
  options: z.array(z.string().min(1).max(120)).min(2).max(8),
  closes_at: z.string().datetime().nullable().optional(),
});

const VoteSchema = z.object({
  option_id: z.string().min(1),
});

function checkVideoOwner(videoId: string, userId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT owner_id FROM videos WHERE id = ?').get(videoId) as { owner_id: string } | undefined;
  return row?.owner_id === userId;
}

function optionalUser(authorization: string | undefined): string | null {
  const token = extractBearerToken(authorization);
  if (!token) return null;
  try {
    return verifyJwt(token).sub as string;
  } catch {
    return null;
  }
}

export async function pollRoutes(app: FastifyInstance) {
  // GET /:videoId/poll — active poll for this video (with current user's vote if any)
  app.get('/:videoId/poll', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const userId = optionalUser(req.headers.authorization);
    const poll = getPollForVideo(videoId, userId);
    return reply.send({ success: true, data: { poll } });
  });

  // POST /:videoId/poll — create a new poll (video owner only)
  app.post('/:videoId/poll', { preHandler: [requireAuth] }, async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkVideoOwner(videoId, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your video' });
    }
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    }
    try {
      const poll = createPoll(videoId, parsed.data.question, parsed.data.options, parsed.data.closes_at ?? null);
      return reply.send({ success: true, data: { poll } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /polls/:pollId/vote — vote on a poll
  app.post('/polls/:pollId/vote', { preHandler: [requireAuth] }, async (req, reply) => {
    const { pollId } = req.params as { pollId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = VoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    }
    try {
      const poll = votePoll(pollId, parsed.data.option_id, userId);
      return reply.send({ success: true, data: { poll } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /polls/:pollId/close — close a poll (video owner only)
  app.post('/polls/:pollId/close', { preHandler: [requireAuth] }, async (req, reply) => {
    const { pollId } = req.params as { pollId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const poll = getPoll(pollId, null);
    if (!poll) return reply.code(404).send({ success: false, error: 'Poll not found' });
    if (!checkVideoOwner(poll.video_id, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your video' });
    }
    closePoll(pollId);
    return reply.send({ success: true, data: { poll: getPoll(pollId, userId) } });
  });

  // DELETE /polls/:pollId — delete a poll (video owner only)
  app.delete('/polls/:pollId', { preHandler: [requireAuth] }, async (req, reply) => {
    const { pollId } = req.params as { pollId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const poll = getPoll(pollId, null);
    if (!poll) return reply.code(404).send({ success: false, error: 'Poll not found' });
    if (!checkVideoOwner(poll.video_id, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your video' });
    }
    deletePoll(pollId);
    return reply.send({ success: true, data: { deleted: true } });
  });
}
