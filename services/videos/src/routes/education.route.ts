// melodyflix videos — Education routes (Section 13.1-13.5) — GLOBAL
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, verifyJwt, extractBearerToken } from '@melodyflix/shared-auth';
import {
  ensureEducationSchema, seedEducationDefaults, EDUCATION_COUNTRIES,
  listLevels, getLevelByIdOrSlug, createLevel,
  listSubjects, getSubjectByIdOrSlug, createSubject,
  linkSubjectToLevel, unlinkSubjectFromLevel,
  listSubjectsForLevel, listLevelsForSubject,
  createChapter, getChapter, listChapters,
  createTopic, getTopic, listTopics,
  createLesson, getLesson, listLessons,
  createCourse, getCourse, listCourses, updateCourseStatus,
  enroll, getEnrollment, listUserEnrollments, updateEnrollmentProgress,
  markLessonProgress, listLessonProgress, getTopicProgress,
  browseLevel, browseSubject,
  type LevelKind, type SubjectCategory, type LessonKind, type CourseStatus,
} from '../services/education.service.js';

const LEVEL_KINDS = ['preschool','class','high_school','undergrad','postgrad','diploma','exam_prep','vocational','religious','professional_cert'] as const;
const SUBJECT_CATEGORIES = ['language','math','science','social','religion','ict','business','general','other'] as const;
const LESSON_KINDS = ['video','pdf','text','live','audio'] as const;
const COURSE_STATUSES = ['draft','published','archived'] as const;

const CreateLevelSchema = z.object({
  slug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(150),
  name_bn: z.string().max(150).optional(),
  kind: z.enum(LEVEL_KINDS),
  numeric_order: z.number().int().min(0).max(10000).optional(),
  parent_id: z.string().uuid().nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  icon: z.string().max(20).nullable().optional(),
  country_code: z.string().min(2).max(10).optional(),
  curriculum: z.string().max(60).nullable().optional(),
  translations: z.record(z.string(), z.string()).nullable().optional(),
});

const CreateSubjectSchema = z.object({
  slug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(120),
  name_bn: z.string().max(120).optional(),
  category: z.enum(SUBJECT_CATEGORIES),
  description: z.string().max(2000).nullable().optional(),
  icon: z.string().max(20).nullable().optional(),
  country_code: z.string().min(2).max(10).optional(),
  translations: z.record(z.string(), z.string()).nullable().optional(),
});

const LinkSubjectSchema = z.object({
  level_id: z.string().uuid(),
  subject_id: z.string().uuid(),
  is_compulsory: z.boolean().optional(),
});

const CreateChapterSchema = z.object({
  level_id: z.string().uuid(),
  subject_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  name_bn: z.string().max(200).optional(),
  order_index: z.number().int().min(0).max(10000).optional(),
  description: z.string().max(2000).nullable().optional(),
});

const CreateTopicSchema = z.object({
  chapter_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  name_bn: z.string().max(200).optional(),
  order_index: z.number().int().min(0).max(10000).optional(),
  description: z.string().max(2000).nullable().optional(),
  learning_objectives: z.array(z.string().min(1).max(300)).max(50).optional(),
});

const CreateLessonSchema = z.object({
  topic_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  kind: z.enum(LESSON_KINDS).optional(),
  content_url: z.string().url().max(500).nullable().optional(),
  content_text: z.string().max(50000).nullable().optional(),
  duration_seconds: z.number().int().min(0).max(86400).nullable().optional(),
  order_index: z.number().int().min(0).max(10000).optional(),
  is_preview: z.boolean().optional(),
});

const CreateCourseSchema = z.object({
  title: z.string().min(2).max(200),
  title_bn: z.string().max(200).optional(),
  slug: z.string().min(2).max(80).optional(),
  level_id: z.string().uuid().nullable().optional(),
  subject_id: z.string().uuid().nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  thumbnail_url: z.string().url().max(500).nullable().optional(),
  is_premium: z.boolean().optional(),
  price_cents: z.number().int().min(0).max(10_000_000).optional(),
  duration_hours: z.number().int().min(0).max(10_000).optional(),
  teacher_id: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  country_code: z.string().max(10).nullable().optional(),
  curriculum: z.string().max(60).nullable().optional(),
  language: z.string().min(2).max(10).optional(),
});

const StatusSchema = z.object({ status: z.enum(COURSE_STATUSES) });
const EnrollSchema = z.object({
  course_id: z.string().uuid().nullable().optional(),
  level_id: z.string().uuid().nullable().optional(),
});
const ProgressSchema = z.object({ percent: z.number().min(0).max(100) });
const LessonProgressSchema = z.object({
  completed: z.boolean().optional(),
  time_spent_seconds: z.number().int().min(0).max(86400).optional(),
  last_position_seconds: z.number().int().min(0).max(86400).optional(),
});

function optionalUser(auth: string | undefined) {
  const token = extractBearerToken(auth);
  if (!token) return null;
  try { return verifyJwt(token); } catch { return null; }
}
function requireAuthPayload(auth: string | undefined): { sub: string; role: string } {
  const payload = requireAuth(auth);
  return { sub: payload.sub as string, role: (payload.role as string) ?? 'user' };
}
function canManageEducation(role: string): boolean {
  return role === 'admin' || role === 'creator' || role === 'teacher';
}

export async function educationRoutes(app: FastifyInstance) {
  // ============================================================
  // Countries & Curricula (public)
  // ============================================================

  // GET /education/countries — list all supported countries
  app.get('/education/countries', async (_req, reply) => {
    return reply.send({ success: true, data: { countries: EDUCATION_COUNTRIES } });
  });

  // ============================================================
  // Public browsing
  // ============================================================

  // GET /education/levels?kind=&country_code=&curriculum=
  app.get('/education/levels', async (req, reply) => {
    const q = req.query as { kind?: string; country_code?: string; curriculum?: string };
    const kind = LEVEL_KINDS.includes(q.kind as any) ? q.kind as LevelKind : undefined;
    let levels = listLevels({ kind });
    if (q.country_code) {
      levels = levels.filter((l) => l.country_code === q.country_code);
    }
    if (q.curriculum) {
      levels = levels.filter((l) => l.curriculum === q.curriculum);
    }
    return reply.send({ success: true, data: { levels } });
  });

  // GET /education/levels/:idOrSlug
  app.get('/education/levels/:idOrSlug', async (req, reply) => {
    const { idOrSlug } = req.params as { idOrSlug: string };
    const level = getLevelByIdOrSlug(idOrSlug);
    if (!level) return reply.code(404).send({ success: false, error: 'Level not found' });
    return reply.send({ success: true, data: level });
  });

  // GET /education/levels/:idOrSlug/browse
  app.get('/education/levels/:idOrSlug/browse', async (req, reply) => {
    const { idOrSlug } = req.params as { idOrSlug: string };
    const result = browseLevel(idOrSlug);
    if (!result) return reply.code(404).send({ success: false, error: 'Level not found' });
    return reply.send({ success: true, data: result });
  });

  // GET /education/subjects?category=&country_code=
  app.get('/education/subjects', async (req, reply) => {
    const q = req.query as { category?: string; country_code?: string };
    const category = SUBJECT_CATEGORIES.includes(q.category as any) ? q.category as SubjectCategory : undefined;
    let subjects = listSubjects({ category });
    if (q.country_code) {
      subjects = subjects.filter((s) => s.country_code === q.country_code);
    }
    return reply.send({ success: true, data: { subjects } });
  });

  // GET /education/subjects/:idOrSlug
  app.get('/education/subjects/:idOrSlug', async (req, reply) => {
    const { idOrSlug } = req.params as { idOrSlug: string };
    const subject = getSubjectByIdOrSlug(idOrSlug);
    if (!subject) return reply.code(404).send({ success: false, error: 'Subject not found' });
    return reply.send({ success: true, data: subject });
  });

  // GET /education/subjects/:idOrSlug/browse
  app.get('/education/subjects/:idOrSlug/browse', async (req, reply) => {
    const { idOrSlug } = req.params as { idOrSlug: string };
    const result = browseSubject(idOrSlug);
    if (!result) return reply.code(404).send({ success: false, error: 'Subject not found' });
    return reply.send({ success: true, data: result });
  });

  // GET /education/levels/:levelId/subjects
  app.get('/education/levels/:levelId/subjects', async (req, reply) => {
    const { levelId } = req.params as { levelId: string };
    const level = getLevelByIdOrSlug(levelId);
    if (!level) return reply.code(404).send({ success: false, error: 'Level not found' });
    return reply.send({ success: true, data: { subjects: listSubjectsForLevel(level.id) } });
  });

  // GET /education/subjects/:subjectId/levels
  app.get('/education/subjects/:subjectId/levels', async (req, reply) => {
    const { subjectId } = req.params as { subjectId: string };
    const subject = getSubjectByIdOrSlug(subjectId);
    if (!subject) return reply.code(404).send({ success: false, error: 'Subject not found' });
    return reply.send({ success: true, data: { levels: listLevelsForSubject(subject.id) } });
  });

  // GET /education/chapters?level_id=&subject_id=
  app.get('/education/chapters', async (req, reply) => {
    const q = req.query as { level_id?: string; subject_id?: string };
    if (!q.level_id || !q.subject_id) return reply.code(400).send({ success: false, error: 'level_id and subject_id required' });
    return reply.send({ success: true, data: { chapters: listChapters(q.level_id, q.subject_id) } });
  });

  // GET /education/topics?chapter_id=
  app.get('/education/topics', async (req, reply) => {
    const q = req.query as { chapter_id?: string };
    if (!q.chapter_id) return reply.code(400).send({ success: false, error: 'chapter_id required' });
    return reply.send({ success: true, data: { topics: listTopics(q.chapter_id) } });
  });

  // GET /education/lessons?topic_id=
  app.get('/education/lessons', async (req, reply) => {
    const q = req.query as { topic_id?: string };
    if (!q.topic_id) return reply.code(400).send({ success: false, error: 'topic_id required' });
    return reply.send({ success: true, data: { lessons: listLessons(q.topic_id) } });
  });

  // GET /education/courses
  app.get('/education/courses', async (req, reply) => {
    const q = req.query as any;
    const courses = listCourses({
      level_id: q.level_id, subject_id: q.subject_id, teacher_id: q.teacher_id,
      status: 'published',
      limit: q.limit ? parseInt(q.limit) : 50,
      offset: q.offset ? parseInt(q.offset) : 0,
    });
    return reply.send({ success: true, data: { courses } });
  });

  // GET /education/courses/:idOrSlug
  app.get('/education/courses/:idOrSlug', async (req, reply) => {
    const { idOrSlug } = req.params as { idOrSlug: string };
    const course = getCourse(idOrSlug);
    if (!course) return reply.code(404).send({ success: false, error: 'Course not found' });
    if (course.status !== 'published') {
      const user = optionalUser(req.headers.authorization);
      if (!user) return reply.code(404).send({ success: false, error: 'Course not found' });
      const role = (user.role as string) ?? 'user';
      if (role !== 'admin' && course.teacher_id !== user.sub && course.created_by !== user.sub) {
        return reply.code(404).send({ success: false, error: 'Course not found' });
      }
    }
    return reply.send({ success: true, data: course });
  });

  // ============================================================
  // Progress (auth)
  // ============================================================

  // POST /education/lessons/:lessonId/progress
  app.post('/education/lessons/:lessonId/progress', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = LessonProgressSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { lessonId } = req.params as { lessonId: string };
    if (!getLesson(lessonId)) return reply.code(404).send({ success: false, error: 'Lesson not found' });
    try {
      return reply.send({ success: true, data: markLessonProgress({ user_id: payload.sub, lesson_id: lessonId, ...parsed.data }) });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // GET /education/topics/:topicId/progress
  app.get('/education/topics/:topicId/progress', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { topicId } = req.params as { topicId: string };
    return reply.send({ success: true, data: getTopicProgress(payload.sub, topicId) });
  });

  // ============================================================
  // Enrollments (auth)
  // ============================================================

  // POST /education/enroll
  app.post('/education/enroll', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = EnrollSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try { return reply.code(201).send({ success: true, data: enroll({ user_id: payload.sub, ...parsed.data }) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // GET /education/enrollments/me
  app.get('/education/enrollments/me', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: { enrollments: listUserEnrollments(payload.sub) } });
  });

  // PATCH /education/enrollments/:id/progress
  app.patch('/education/enrollments/:id/progress', async (req, reply) => {
    let payload: { sub: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = ProgressSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    const enr = getEnrollment(id);
    if (!enr) return reply.code(404).send({ success: false, error: 'Enrollment not found' });
    if (enr.user_id !== payload.sub) return reply.code(403).send({ success: false, error: 'Not authorized' });
    return reply.send({ success: true, data: updateEnrollmentProgress(id, parsed.data.percent) });
  });

  // ============================================================
  // Teacher/Admin: create content
  // ============================================================

  // POST /education/seed (admin)
  app.post('/education/seed', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (payload.role !== 'admin') return reply.code(403).send({ success: false, error: 'Admin only' });
    return reply.send({ success: true, data: seedEducationDefaults() });
  });

  // POST /education/levels
  app.post('/education/levels', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!canManageEducation(payload.role)) return reply.code(403).send({ success: false, error: 'Admin/teacher only' });
    const parsed = CreateLevelSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      // Note: for custom levels with country_code, we bypass createLevel and use direct DB insert
      if (parsed.data.country_code) {
        const { getDb } = await import('@melodyflix/shared-db');
        const db = getDb();
        const { randomUUID } = await import('node:crypto');
        const id = randomUUID();
        const now = new Date().toISOString();
        db.prepare(`
          INSERT INTO education_levels
            (id, slug, name, name_bn, kind, numeric_order, parent_id, description, icon,
             is_active, country_code, curriculum, translations_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
        `).run(id, parsed.data.slug, parsed.data.name, parsed.data.name_bn ?? null,
          parsed.data.kind, parsed.data.numeric_order ?? 0, parsed.data.parent_id ?? null,
          parsed.data.description ?? null, parsed.data.icon ?? null,
          parsed.data.country_code, parsed.data.curriculum ?? null,
          parsed.data.translations ? JSON.stringify(parsed.data.translations) : null,
          now, now);
        return reply.code(201).send({ success: true, data: getLevelByIdOrSlug(id) });
      }
      return reply.code(201).send({ success: true, data: createLevel(parsed.data as any) });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // POST /education/subjects
  app.post('/education/subjects', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!canManageEducation(payload.role)) return reply.code(403).send({ success: false, error: 'Admin/teacher only' });
    const parsed = CreateSubjectSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      if (parsed.data.country_code) {
        const { getDb } = await import('@melodyflix/shared-db');
        const db = getDb();
        const { randomUUID } = await import('node:crypto');
        const id = randomUUID();
        const now = new Date().toISOString();
        db.prepare(`
          INSERT INTO subjects
            (id, slug, name, name_bn, category, description, icon, is_active,
             country_code, translations_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
        `).run(id, parsed.data.slug, parsed.data.name, parsed.data.name_bn ?? null,
          parsed.data.category, parsed.data.description ?? null, parsed.data.icon ?? null,
          parsed.data.country_code,
          parsed.data.translations ? JSON.stringify(parsed.data.translations) : null, now, now);
        return reply.code(201).send({ success: true, data: getSubjectByIdOrSlug(id) });
      }
      return reply.code(201).send({ success: true, data: createSubject(parsed.data as any) });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // POST /education/link-subject
  app.post('/education/link-subject', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!canManageEducation(payload.role)) return reply.code(403).send({ success: false, error: 'Admin/teacher only' });
    const parsed = LinkSubjectSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      linkSubjectToLevel(parsed.data.level_id, parsed.data.subject_id, parsed.data.is_compulsory);
      return reply.code(201).send({ success: true, data: { linked: true } });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // DELETE /education/link-subject/:levelId/:subjectId
  app.delete('/education/link-subject/:levelId/:subjectId', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!canManageEducation(payload.role)) return reply.code(403).send({ success: false, error: 'Admin/teacher only' });
    const { levelId, subjectId } = req.params as { levelId: string; subjectId: string };
    const ok = unlinkSubjectFromLevel(levelId, subjectId);
    if (!ok) return reply.code(404).send({ success: false, error: 'Link not found' });
    return reply.send({ success: true, data: { unlinked: true } });
  });

  // POST /education/chapters
  app.post('/education/chapters', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!canManageEducation(payload.role)) return reply.code(403).send({ success: false, error: 'Admin/teacher only' });
    const parsed = CreateChapterSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try { return reply.code(201).send({ success: true, data: createChapter(parsed.data) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // POST /education/topics
  app.post('/education/topics', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!canManageEducation(payload.role)) return reply.code(403).send({ success: false, error: 'Admin/teacher only' });
    const parsed = CreateTopicSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try { return reply.code(201).send({ success: true, data: createTopic(parsed.data) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // POST /education/lessons
  app.post('/education/lessons', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!canManageEducation(payload.role)) return reply.code(403).send({ success: false, error: 'Admin/teacher only' });
    const parsed = CreateLessonSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try { return reply.code(201).send({ success: true, data: createLesson({ ...parsed.data, created_by: payload.sub }) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // POST /education/courses
  app.post('/education/courses', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!canManageEducation(payload.role)) return reply.code(403).send({ success: false, error: 'Admin/teacher only' });
    const parsed = CreateCourseSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try { return reply.code(201).send({ success: true, data: createCourse({ ...parsed.data, created_by: payload.sub }) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // PATCH /education/courses/:id/status
  app.patch('/education/courses/:id/status', async (req, reply) => {
    let payload: { sub: string; role: string };
    try { payload = requireAuthPayload(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    if (!canManageEducation(payload.role)) return reply.code(403).send({ success: false, error: 'Admin/teacher only' });
    const parsed = StatusSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: updateCourseStatus(id, parsed.data.status, payload.sub, payload.role === 'admin') }); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
  });
}
