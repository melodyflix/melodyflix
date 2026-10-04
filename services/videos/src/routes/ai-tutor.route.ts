// melodyflix videos — AI Tutor routes (Section 13.6-13.15)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  submitQuestion, getQuestion, listUserQuestions, listQuestionsForTeacher, escalateQuestion,
  answerQuestionWithAi, submitTeacherAnswer, verifyAnswer, getAnswer, listAnswersForQuestion, closeQuestion,
  createPracticeQuiz, getQuiz, listUserQuizzes,
  submitQuizAttempt, getQuizAttempt, listUserQuizAttempts,
  getLearningProgress, getAiProviderStatus,
  type QuestionStatus, type QuestionKind, type VerificationStatus,
} from '../services/ai-tutor.service.js';

const QUESTION_KINDS = ['text', 'image', 'voice', 'mixed'] as const;
const QUESTION_STATUSES = ['pending', 'ai_answered', 'teacher_review', 'teacher_answered', 'closed', 'rejected'] as const;
const VERIFICATION_STATUSES = ['unverified', 'verified', 'disputed', 'needs_source'] as const;

const SubmitQuestionSchema = z.object({
  body: z.string().min(3).max(5000),
  level_id: z.string().uuid().nullable().optional(),
  subject_id: z.string().uuid().nullable().optional(),
  topic_id: z.string().uuid().nullable().optional(),
  kind: z.enum(QUESTION_KINDS).optional(),
  image_urls: z.array(z.string().url().max(500)).max(10).optional(),
  voice_urls: z.array(z.string().url().max(500)).max(5).optional(),
  language: z.string().min(2).max(10).optional(),
});

const AiAnswerSchema = z.object({
  level_name: z.string().max(200).nullable().optional(),
  subject_name: z.string().max(200).nullable().optional(),
});

const TeacherAnswerSchema = z.object({
  answer_text: z.string().min(1).max(10000),
  explanation: z.string().max(10000).nullable().optional(),
  step_by_step: z.array(z.string().max(1000)).max(50).optional(),
  sources: z.array(z.string().max(500)).max(20).optional(),
  verification_status: z.enum(VERIFICATION_STATUSES).optional(),
});

const VerifySchema = z.object({
  status: z.enum(VERIFICATION_STATUSES),
  note: z.string().max(2000).nullable().optional(),
});

const EscalateSchema = z.object({
  reason: z.string().min(3).max(500),
  teacher_id: z.string().uuid().nullable().optional(),
});

const CreateQuizSchema = z.object({
  level_id: z.string().uuid().nullable().optional(),
  subject_id: z.string().uuid().nullable().optional(),
  topic_id: z.string().uuid().nullable().optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  total_questions: z.number().int().min(1).max(50).optional(),
});

const SubmitAttemptSchema = z.object({
  answers: z.array(z.number().int().min(0).max(20)).max(100),
  duration_seconds: z.number().int().min(0).max(86400).nullable().optional(),
});

function requireAuthPayload(auth: string | undefined): { sub: string; role: string } {
  const payload = requireAuth(auth);
  return { sub: payload.sub as string, role: (payload.role as string) ?? 'user' };
}

function isTeacherOrAdmin(role: string): boolean {
  return role === 'admin' || role === 'teacher' || role === 'creator';
}

export async function aiTutorRoutes(app: FastifyInstance) {
  // ============================================================
  // Provider status
  // ============================================================

  // GET /tutor/ai-status — which AI providers are configured
  app.get('/tutor/ai-status', async (_req, reply) => {
    return reply.send({ success: true, data: getAiProviderStatus() });
  });

  // ============================================================
  // 13.6 — Question submission
  // ============================================================

  // POST /tutor/questions
  app.post('/tutor/questions', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = SubmitQuestionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const q = submitQuestion({ user_id: payload.sub, ...parsed.data });
      return reply.code(201).send({ success: true, data: q });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /tutor/questions/me
  app.get('/tutor/questions/me', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { status?: string; limit?: string };
    const status = QUESTION_STATUSES.includes(q.status as any) ? q.status as QuestionStatus : undefined;
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    return reply.send({ success: true, data: { questions: listUserQuestions(payload.sub, { status, limit }) } });
  });

  // GET /tutor/questions/:id
  app.get('/tutor/questions/:id', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const q = getQuestion(id);
    if (!q) return reply.code(404).send({ success: false, error: 'Question not found' });
    if (q.user_id !== payload.sub && !isTeacherOrAdmin(payload.role)) {
      return reply.code(403).send({ success: false, error: 'Not authorized' });
    }
    return reply.send({ success: true, data: q });
  });

  // GET /tutor/questions/:id/answers
  app.get('/tutor/questions/:id/answers', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const q = getQuestion(id);
    if (!q) return reply.code(404).send({ success: false, error: 'Question not found' });
    if (q.user_id !== payload.sub && !isTeacherOrAdmin(payload.role)) {
      return reply.code(403).send({ success: false, error: 'Not authorized' });
    }
    return reply.send({ success: true, data: { answers: listAnswersForQuestion(id) } });
  });

  // ============================================================
  // 13.7 / 13.8 — AI Answer
  // ============================================================

  // POST /tutor/questions/:id/ai-answer
  app.post('/tutor/questions/:id/ai-answer', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = AiAnswerSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    const q = getQuestion(id);
    if (!q) return reply.code(404).send({ success: false, error: 'Question not found' });
    if (q.user_id !== payload.sub) return reply.code(403).send({ success: false, error: 'Not your question' });
    try {
      const answer = await answerQuestionWithAi(id, parsed.data);
      return reply.code(201).send({ success: true, data: answer });
    } catch (err) {
      const msg = (err as Error).message;
      const code = msg.includes('No AI provider') ? 503 : 400;
      return reply.code(code).send({ success: false, error: msg });
    }
  });

  // ============================================================
  // 13.14 — Teacher escalation + answer
  // ============================================================

  // POST /tutor/questions/:id/escalate
  app.post('/tutor/questions/:id/escalate', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = EscalateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    const q = getQuestion(id);
    if (!q) return reply.code(404).send({ success: false, error: 'Question not found' });
    if (q.user_id !== payload.sub) return reply.code(403).send({ success: false, error: 'Not your question' });
    try {
      const updated = escalateQuestion(id, parsed.data.reason, parsed.data.teacher_id ?? null);
      return reply.send({ success: true, data: updated });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /tutor/teacher/queue
  app.get('/tutor/teacher/queue', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isTeacherOrAdmin(payload.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    const q = req.query as { status?: string; limit?: string };
    const status = QUESTION_STATUSES.includes(q.status as any) ? q.status as QuestionStatus : undefined;
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    return reply.send({ success: true, data: { questions: listQuestionsForTeacher(payload.sub, { status, limit }) } });
  });

  // POST /tutor/questions/:id/teacher-answer
  app.post('/tutor/questions/:id/teacher-answer', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isTeacherOrAdmin(payload.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    const parsed = TeacherAnswerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const answer = submitTeacherAnswer({ question_id: id, teacher_id: payload.sub, ...parsed.data });
      return reply.code(201).send({ success: true, data: answer });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /tutor/answers/:id/verify
  app.post('/tutor/answers/:id/verify', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isTeacherOrAdmin(payload.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    const parsed = VerifySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      return reply.send({ success: true, data: verifyAnswer(id, payload.sub, parsed.data.status, parsed.data.note) });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /tutor/questions/:id/close
  app.post('/tutor/questions/:id/close', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      return reply.send({ success: true, data: closeQuestion(id, payload.sub) });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // 13.11 — Practice Quiz
  // ============================================================

  // POST /tutor/quizzes
  app.post('/tutor/quizzes', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = CreateQuizSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const quiz = createPracticeQuiz({ user_id: payload.sub, ...parsed.data });
      return reply.code(201).send({ success: true, data: quiz });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /tutor/quizzes/me
  app.get('/tutor/quizzes/me', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 30, 1), 200) : 30;
    return reply.send({ success: true, data: { quizzes: listUserQuizzes(payload.sub, limit) } });
  });

  // GET /tutor/quizzes/:id
  app.get('/tutor/quizzes/:id', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const quiz = getQuiz(id);
    if (!quiz) return reply.code(404).send({ success: false, error: 'Quiz not found' });
    if (quiz.user_id !== payload.sub) return reply.code(403).send({ success: false, error: 'Not your quiz' });
    return reply.send({ success: true, data: quiz });
  });

  // ============================================================
  // 13.12 — Quiz attempt + error analysis
  // ============================================================

  // POST /tutor/quizzes/:id/attempt
  app.post('/tutor/quizzes/:id/attempt', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = SubmitAttemptSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const attempt = submitQuizAttempt({ quiz_id: id, user_id: payload.sub, ...parsed.data });
      return reply.code(201).send({ success: true, data: attempt });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /tutor/attempts/me
  app.get('/tutor/attempts/me', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    return reply.send({ success: true, data: { attempts: listUserQuizAttempts(payload.sub, limit) } });
  });

  // GET /tutor/attempts/:id
  app.get('/tutor/attempts/:id', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const attempt = getQuizAttempt(id);
    if (!attempt) return reply.code(404).send({ success: false, error: 'Attempt not found' });
    if (attempt.user_id !== payload.sub) return reply.code(403).send({ success: false, error: 'Not yours' });
    return reply.send({ success: true, data: attempt });
  });

  // ============================================================
  // 13.13 — Learning progress
  // ============================================================

  // GET /tutor/progress/me?subject_id=
  app.get('/tutor/progress/me', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { subject_id?: string };
    return reply.send({ success: true, data: getLearningProgress(payload.sub, q.subject_id ?? null) });
  });

  // GET /tutor/progress/:userId (teacher view)
  app.get('/tutor/progress/:userId', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isTeacherOrAdmin(payload.role) && payload.sub !== (req.params as any).userId) {
      return reply.code(403).send({ success: false, error: 'Not authorized' });
    }
    const { userId } = req.params as { userId: string };
    const q = req.query as { subject_id?: string };
    return reply.send({ success: true, data: getLearningProgress(userId, q.subject_id ?? null) });
  });
}
