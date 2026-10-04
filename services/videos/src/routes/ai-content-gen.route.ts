// melodyflix videos — AI Content Generation routes (Section 13.16-13.19)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  generateLesson, getGeneratedLesson, listGeneratedLessons,
  updateGeneratedLessonStatus, deleteGeneratedLesson,
  generateStudyNotes, getStudyNote, listUserNotes, pinStudyNote, deleteStudyNote,
  generateQuestions, getQuestion, listBankQuestions, updateQuestionStatus, deleteQuestion,
  generateStudyPlan, getStudyPlan, listUserPlans, updatePlanProgress, deleteStudyPlan,
  type ContentStatus, type NoteStyle, type QuestionType, type PlanStatus,
} from '../services/ai-content-gen.service.js';

const CONTENT_STATUSES = ['draft','review','published','archived'] as const;
const NOTE_STYLES = ['summary','detailed','bullet','flashcard'] as const;
const QUESTION_TYPES = ['mcq','true_false','fill_blank','short_answer','long_answer'] as const;
const PLAN_STATUSES = ['active','completed','paused'] as const;

const GenerateLessonSchema = z.object({
  topic_id: z.string().uuid(),
  topic_name: z.string().min(2).max(200),
  level_id: z.string().uuid().nullable().optional(),
  subject_id: z.string().uuid().nullable().optional(),
  subject_name: z.string().max(200).nullable().optional(),
  level_name: z.string().max(200).nullable().optional(),
  language: z.string().min(2).max(10).optional(),
  target_minutes: z.number().int().min(5).max(300).optional(),
});

const StatusSchema = z.object({ status: z.enum(CONTENT_STATUSES) });

const GenerateNotesSchema = z.object({
  topic_id: z.string().uuid().nullable().optional(),
  lesson_id: z.string().uuid().nullable().optional(),
  subject_id: z.string().uuid().nullable().optional(),
  topic_name: z.string().min(2).max(200),
  style: z.enum(NOTE_STYLES).optional(),
  language: z.string().min(2).max(10).optional(),
  source_text: z.string().max(20000).nullable().optional(),
});

const PinSchema = z.object({ pinned: z.boolean() });

const GenerateQuestionsSchema = z.object({
  topic_id: z.string().uuid().nullable().optional(),
  level_id: z.string().uuid().nullable().optional(),
  subject_id: z.string().uuid().nullable().optional(),
  topic_name: z.string().min(2).max(200),
  count: z.number().int().min(1).max(50).optional(),
  types: z.array(z.enum(QUESTION_TYPES)).max(5).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  language: z.string().min(2).max(10).optional(),
});

const GeneratePlanSchema = z.object({
  level_id: z.string().uuid().nullable().optional(),
  subject_id: z.string().uuid().nullable().optional(),
  goal: z.string().min(3).max(500),
  duration_days: z.number().int().min(1).max(365).optional(),
  topics: z.array(z.string().min(1).max(200)).max(30).optional(),
  weak_areas: z.array(z.string().min(1).max(200)).max(10).optional(),
  hours_per_day: z.number().min(0.5).max(12).optional(),
  language: z.string().min(2).max(10).optional(),
});

const PlanProgressSchema = z.object({ percent: z.number().min(0).max(100) });

function requireAuthPayload(auth: string | undefined): { sub: string; role: string } {
  const payload = requireAuth(auth);
  return { sub: payload.sub as string, role: (payload.role as string) ?? 'user' };
}
function isTeacherOrAdmin(role: string): boolean {
  return role === 'admin' || role === 'teacher' || role === 'creator';
}
function wrapAiError(reply: any, err: unknown) {
  const msg = (err as Error).message;
  const code = msg.includes('No AI provider') ? 503 : 400;
  return reply.code(code).send({ success: false, error: msg });
}

export async function aiContentGenRoutes(app: FastifyInstance) {
  // ============================================================
  // 13.16 — Lesson Generator
  // ============================================================

  // POST /content-gen/lessons
  app.post('/content-gen/lessons', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isTeacherOrAdmin(payload.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    const parsed = GenerateLessonSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const lesson = await generateLesson({ ...parsed.data, generated_by: payload.sub });
      return reply.code(201).send({ success: true, data: lesson });
    } catch (err) { return wrapAiError(reply, err); }
  });

  // GET /content-gen/lessons
  app.get('/content-gen/lessons', async (req, reply) => {
    const q = req.query as { topic_id?: string; status?: string; limit?: string };
    const status = CONTENT_STATUSES.includes(q.status as any) ? q.status as ContentStatus : undefined;
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    return reply.send({ success: true, data: { lessons: listGeneratedLessons({ topic_id: q.topic_id, status, limit }) } });
  });

  // GET /content-gen/lessons/:id
  app.get('/content-gen/lessons/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const lesson = getGeneratedLesson(id);
    if (!lesson) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.send({ success: true, data: lesson });
  });

  // PATCH /content-gen/lessons/:id/status
  app.patch('/content-gen/lessons/:id/status', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isTeacherOrAdmin(payload.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    const parsed = StatusSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: updateGeneratedLessonStatus(id, parsed.data.status, payload.sub, payload.role === 'admin') }); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
  });

  // DELETE /content-gen/lessons/:id
  app.delete('/content-gen/lessons/:id', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isTeacherOrAdmin(payload.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    const { id } = req.params as { id: string };
    try {
      const ok = deleteGeneratedLesson(id, payload.sub, payload.role === 'admin');
      if (!ok) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
  });

  // ============================================================
  // 13.17 — Study Notes
  // ============================================================

  // POST /content-gen/notes
  app.post('/content-gen/notes', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = GenerateNotesSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const note = await generateStudyNotes({ ...parsed.data, user_id: payload.sub });
      return reply.code(201).send({ success: true, data: note });
    } catch (err) { return wrapAiError(reply, err); }
  });

  // GET /content-gen/notes/me
  app.get('/content-gen/notes/me', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { topic_id?: string; pinned_only?: string; limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    return reply.send({ success: true, data: { notes: listUserNotes(payload.sub, { topic_id: q.topic_id, pinned_only: q.pinned_only === 'true', limit }) } });
  });

  // GET /content-gen/notes/:id
  app.get('/content-gen/notes/:id', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const note = getStudyNote(id);
    if (!note) return reply.code(404).send({ success: false, error: 'Not found' });
    if (note.user_id !== payload.sub) return reply.code(403).send({ success: false, error: 'Not yours' });
    return reply.send({ success: true, data: note });
  });

  // POST /content-gen/notes/:id/pin
  app.post('/content-gen/notes/:id/pin', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = PinSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: pinStudyNote(id, payload.sub, parsed.data.pinned) }); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
  });

  // DELETE /content-gen/notes/:id
  app.delete('/content-gen/notes/:id', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      const ok = deleteStudyNote(id, payload.sub);
      if (!ok) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
  });

  // ============================================================
  // 13.18 — Question Bank
  // ============================================================

  // POST /content-gen/questions
  app.post('/content-gen/questions', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isTeacherOrAdmin(payload.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    const parsed = GenerateQuestionsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const questions = await generateQuestions({
        ...parsed.data,
        types: parsed.data.types as QuestionType[] | undefined,
        generated_by: payload.sub,
      });
      return reply.code(201).send({ success: true, data: { questions, count: questions.length } });
    } catch (err) { return wrapAiError(reply, err); }
  });

  // GET /content-gen/questions
  app.get('/content-gen/questions', async (req, reply) => {
    const q = req.query as any;
    const question_type = QUESTION_TYPES.includes(q.question_type as any) ? q.question_type as QuestionType : undefined;
    const status = CONTENT_STATUSES.includes(q.status as any) ? q.status as ContentStatus : undefined;
    const result = listBankQuestions({
      topic_id: q.topic_id, subject_id: q.subject_id, level_id: q.level_id,
      question_type, difficulty: q.difficulty, status,
      limit: q.limit ? parseInt(q.limit) : 50,
      offset: q.offset ? parseInt(q.offset) : 0,
    });
    return reply.send({ success: true, data: result });
  });

  // GET /content-gen/questions/:id
  app.get('/content-gen/questions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = getQuestion(id);
    if (!q) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.send({ success: true, data: q });
  });

  // PATCH /content-gen/questions/:id/status
  app.patch('/content-gen/questions/:id/status', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isTeacherOrAdmin(payload.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    const parsed = StatusSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: updateQuestionStatus(id, parsed.data.status, payload.sub, payload.role === 'admin') }); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
  });

  // DELETE /content-gen/questions/:id
  app.delete('/content-gen/questions/:id', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!isTeacherOrAdmin(payload.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    const { id } = req.params as { id: string };
    try {
      const ok = deleteQuestion(id, payload.sub, payload.role === 'admin');
      if (!ok) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
  });

  // ============================================================
  // 13.19 — Study Plan
  // ============================================================

  // POST /content-gen/plans
  app.post('/content-gen/plans', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = GeneratePlanSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const plan = await generateStudyPlan({ ...parsed.data, user_id: payload.sub });
      return reply.code(201).send({ success: true, data: plan });
    } catch (err) { return wrapAiError(reply, err); }
  });

  // GET /content-gen/plans/me
  app.get('/content-gen/plans/me', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { status?: string; limit?: string };
    const status = PLAN_STATUSES.includes(q.status as any) ? q.status as PlanStatus : undefined;
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 20, 1), 100) : 20;
    return reply.send({ success: true, data: { plans: listUserPlans(payload.sub, { status, limit }) } });
  });

  // GET /content-gen/plans/:id
  app.get('/content-gen/plans/:id', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const plan = getStudyPlan(id);
    if (!plan) return reply.code(404).send({ success: false, error: 'Not found' });
    if (plan.user_id !== payload.sub) return reply.code(403).send({ success: false, error: 'Not yours' });
    return reply.send({ success: true, data: plan });
  });

  // PATCH /content-gen/plans/:id/progress
  app.patch('/content-gen/plans/:id/progress', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = PlanProgressSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: updatePlanProgress(id, payload.sub, parsed.data.percent) }); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
  });

  // DELETE /content-gen/plans/:id
  app.delete('/content-gen/plans/:id', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    try {
      const ok = deleteStudyPlan(id, payload.sub);
      if (!ok) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
  });
}
