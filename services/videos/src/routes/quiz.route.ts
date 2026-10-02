// melodyflix videos - quiz routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, verifyJwt, extractBearerToken } from '@melodyflix/shared-auth';
import { getDb } from '@melodyflix/shared-db';
import {
  getQuiz, getQuizForVideo, createQuiz, answerQuiz, closeQuiz, deleteQuiz,
} from '../services/quiz.service.js';

const CreateSchema = z.object({
  question: z.string().min(1).max(280),
  options: z.array(z.string().min(1).max(120)).min(2).max(8),
  correct_index: z.number().int().min(0).max(7),
  explanation: z.string().max(500).nullable().optional(),
  closes_at: z.string().datetime().nullable().optional(),
});

const AnswerSchema = z.object({
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

export async function quizRoutes(app: FastifyInstance) {
  // GET /:videoId/quiz
  app.get('/:videoId/quiz', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const userId = optionalUser(req.headers.authorization);
    const quiz = getQuizForVideo(videoId, userId);
    return reply.send({ success: true, data: { quiz } });
  });

  // POST /:videoId/quiz — create (video owner only)
  app.post('/:videoId/quiz', { preHandler: [requireAuth] }, async (req, reply) => {
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
      const quiz = createQuiz(
        videoId,
        parsed.data.question,
        parsed.data.options,
        parsed.data.correct_index,
        parsed.data.explanation ?? null,
        parsed.data.closes_at ?? null,
      );
      return reply.send({ success: true, data: { quiz } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /quizzes/:quizId/answer
  app.post('/quizzes/:quizId/answer', { preHandler: [requireAuth] }, async (req, reply) => {
    const { quizId } = req.params as { quizId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = AnswerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    }
    try {
      const quiz = answerQuiz(quizId, parsed.data.option_id, userId);
      return reply.send({ success: true, data: { quiz } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /quizzes/:quizId/close — video owner only
  app.post('/quizzes/:quizId/close', { preHandler: [requireAuth] }, async (req, reply) => {
    const { quizId } = req.params as { quizId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const quiz = getQuiz(quizId, null);
    if (!quiz) return reply.code(404).send({ success: false, error: 'Quiz not found' });
    if (!checkVideoOwner(quiz.video_id, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your video' });
    }
    closeQuiz(quizId);
    return reply.send({ success: true, data: { quiz: getQuiz(quizId, userId) } });
  });

  // DELETE /quizzes/:quizId — video owner only
  app.delete('/quizzes/:quizId', { preHandler: [requireAuth] }, async (req, reply) => {
    const { quizId } = req.params as { quizId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const quiz = getQuiz(quizId, null);
    if (!quiz) return reply.code(404).send({ success: false, error: 'Quiz not found' });
    if (!checkVideoOwner(quiz.video_id, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your video' });
    }
    deleteQuiz(quizId);
    return reply.send({ success: true, data: { deleted: true } });
  });
}
