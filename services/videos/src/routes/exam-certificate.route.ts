// melodyflix videos — Exam + Certificate routes (Section 13.20-13.27)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, verifyJwt, extractBearerToken } from '@melodyflix/shared-auth';
import {
  createExam, getExam, listExams, updateExamStatus,
  addExamQuestion, getExamQuestion, listExamQuestions, deleteExamQuestion,
  startExamAttempt, getExamAttempt, listUserAttempts, listExamAttempts,
  getExamAttemptQuestions, submitExamAttempt, checkAndAutoSubmitExpired,
  logProctorEvent, listProctorEvents, getAttemptViolationSummary,
  getAttemptResult, teacherOverrideScore,
  type ExamStatus, type AttemptStatus, type ProctorEventKind,
} from '../services/exam.service.js';
import {
  issueCertificate, issueCourseCertificate, issueExamCertificate,
  getCertificate, getCertificateBySerial, getCertificateByCode,
  listUserCertificates, listCertificatesByIssuer, listCertificatesByExam, listCertificatesByCourse,
  verifyCertificate, listVerificationLogs, getCertificatePublicView,
  getDigitalCredential, getCertificateIntegrity,
  revokeCertificate, reactivateCertificate, listRevokedCertificates,
  getCertificateStats,
  type CertStatus, type CertKind,
} from '../services/certificate.service.js';

const EXAM_STATUSES = ['draft','scheduled','active','grading','completed','cancelled'] as const;
const ATTEMPT_STATUSES = ['in_progress','submitted','auto_submitted','graded','disqualified'] as const;
const CERT_KINDS = ['course','exam','level','achievement','professional_cert'] as const;
const CERT_STATUSES = ['issued','revoked','expired'] as const;
const PROCTOR_KINDS = ['tab_switch','face_missing','multiple_faces','noise_detected','mouse_out','fullscreen_exit','copy_paste_attempt','network_drop','suspicious_movement','second_screen','custom'] as const;

const CreateExamSchema = z.object({
  title: z.string().min(3).max(250),
  level_id: z.string().uuid().nullable().optional(),
  subject_id: z.string().uuid().nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  duration_minutes: z.number().int().min(1).max(600).optional(),
  pass_marks: z.number().int().min(0).max(10000).optional(),
  shuffle_questions: z.boolean().optional(),
  shuffle_options: z.boolean().optional(),
  proctoring_enabled: z.boolean().optional(),
  max_violations: z.number().int().min(1).max(20).optional(),
  scheduled_at: z.string().nullable().optional(),
});

const StatusUpdateSchema = z.object({ status: z.enum(EXAM_STATUSES) });

const AddQuestionSchema = z.object({
  question_text: z.string().min(3).max(10000),
  question_type: z.string().max(40).optional(),
  options: z.array(z.string().max(500)).max(10).optional(),
  correct_answer: z.string().min(1).max(500),
  marks: z.number().int().min(1).max(100).optional(),
  negative_marks: z.number().min(0).max(10).optional(),
  question_bank_id: z.string().uuid().nullable().optional(),
  order_index: z.number().int().min(0).max(10000).optional(),
});

const SubmitAttemptSchema = z.object({
  answers: z.record(z.string(), z.string().max(5000)),
  auto_submitted: z.boolean().optional(),
});

const ProctorEventSchema = z.object({
  kind: z.enum(PROCTOR_KINDS),
  description: z.string().max(1000).nullable().optional(),
  metadata: z.record(z.string(), z.any()).nullable().optional(),
  severity: z.enum(['low', 'medium', 'high']).optional(),
});

const OverrideSchema = z.object({
  score: z.number().int().min(0).max(10000),
  note: z.string().min(1).max(500),
});

const IssueCertSchema = z.object({
  user_id: z.string().uuid(),
  holder_name: z.string().min(2).max(200),
  title: z.string().min(3).max(250),
  kind: z.enum(CERT_KINDS).optional(),
  description: z.string().max(2000).nullable().optional(),
  level_id: z.string().uuid().nullable().optional(),
  subject_id: z.string().uuid().nullable().optional(),
  course_id: z.string().uuid().nullable().optional(),
  exam_id: z.string().uuid().nullable().optional(),
  attempt_id: z.string().uuid().nullable().optional(),
  score_percent: z.number().int().min(0).max(100).nullable().optional(),
  issuer_name: z.string().max(200).nullable().optional(),
  expires_at: z.string().nullable().optional(),
  language: z.string().min(2).max(10).optional(),
});

const IssueFromCourseSchema = z.object({
  user_id: z.string().uuid(),
  holder_name: z.string().min(2).max(200),
  course_id: z.string().uuid(),
  course_title: z.string().min(3).max(250),
  level_id: z.string().uuid().nullable().optional(),
  subject_id: z.string().uuid().nullable().optional(),
  score_percent: z.number().int().min(0).max(100).nullable().optional(),
  issuer_name: z.string().max(200).nullable().optional(),
});

const IssueFromExamSchema = z.object({
  user_id: z.string().uuid(),
  holder_name: z.string().min(2).max(200),
  exam_id: z.string().uuid(),
  exam_title: z.string().min(3).max(250),
  attempt_id: z.string().uuid(),
  score_percent: z.number().int().min(0).max(100),
  level_id: z.string().uuid().nullable().optional(),
  subject_id: z.string().uuid().nullable().optional(),
  issuer_name: z.string().max(200).nullable().optional(),
});

const RevokeSchema = z.object({
  reason: z.string().min(3).max(500),
});

function requireAuthPayload(auth: string | undefined): { sub: string; role: string } {
  const payload = requireAuth(auth);
  return { sub: payload.sub as string, role: (payload.role as string) ?? 'user' };
}
function optionalUser(auth: string | undefined) {
  const token = extractBearerToken(auth);
  if (!token) return null;
  try { return verifyJwt(token); } catch { return null; }
}
function isTeacherOrAdmin(role: string): boolean {
  return role === 'admin' || role === 'teacher' || role === 'creator';
}

export async function examCertificateRoutes(app: FastifyInstance) {
  // ============================================================
  // 13.24-13.27 — Public certificate verification
  // ============================================================

  // GET /verify/:code — public verification (no auth)
  app.get('/verify/:code', async (req, reply) => {
    const { code } = req.params as { code: string };
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      ?? req.socket?.remoteAddress ?? null;
    const ua = (req.headers['user-agent'] as string) ?? null;
    const result = verifyCertificate(code, { ip, user_agent: ua });
    return reply.code(result.valid ? 200 : 404).send({ success: result.valid, data: result });
  });

  // GET /verify/:code/public — safe projection for UI
  app.get('/verify/:code/public', async (req, reply) => {
    const { code } = req.params as { code: string };
    const view = getCertificatePublicView(code);
    if (!view) return reply.code(404).send({ success: false, error: 'Certificate not found' });
    return reply.send({ success: true, data: view });
  });

  // ============================================================
  // Certificate stats (admin)
  // ============================================================

  // GET /certificates/stats
  app.get('/certificates/stats', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    if (!isTeacherOrAdmin(auth.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    return reply.send({ success: true, data: getCertificateStats() });
  });

  // ============================================================
  // 13.24 — Issue certificate
  // ============================================================

  // POST /certificates
  app.post('/certificates', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    if (!isTeacherOrAdmin(auth.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    const parsed = IssueCertSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const cert = issueCertificate({ ...parsed.data, issued_by: auth.sub });
      return reply.code(201).send({ success: true, data: cert });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // POST /certificates/from-course
  app.post('/certificates/from-course', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    if (!isTeacherOrAdmin(auth.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    const parsed = IssueFromCourseSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const cert = issueCourseCertificate({ ...parsed.data, issued_by: auth.sub });
      return reply.code(201).send({ success: true, data: cert });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // POST /certificates/from-exam
  app.post('/certificates/from-exam', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    if (!isTeacherOrAdmin(auth.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    const parsed = IssueFromExamSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const cert = issueExamCertificate({ ...parsed.data, issued_by: auth.sub });
      return reply.code(201).send({ success: true, data: cert });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // GET /certificates/me
  app.get('/certificates/me', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    const q = req.query as { status?: string; limit?: string };
    const status = CERT_STATUSES.includes(q.status as any) ? q.status as CertStatus : undefined;
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    return reply.send({ success: true, data: { certificates: listUserCertificates(auth.sub, { status, limit }) } });
  });

  // GET /certificates/issued-by-me
  app.get('/certificates/issued-by-me', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    if (!isTeacherOrAdmin(auth.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 100, 1), 500) : 100;
    return reply.send({ success: true, data: { certificates: listCertificatesByIssuer(auth.sub, limit) } });
  });

  // GET /certificates/revoked
  app.get('/certificates/revoked', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    if (!isTeacherOrAdmin(auth.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 100, 1), 500) : 100;
    return reply.send({ success: true, data: { certificates: listRevokedCertificates(limit) } });
  });

  // GET /certificates/exam/:examId
  app.get('/certificates/exam/:examId', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    if (!isTeacherOrAdmin(auth.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    const { examId } = req.params as { examId: string };
    return reply.send({ success: true, data: { certificates: listCertificatesByExam(examId) } });
  });

  // GET /certificates/course/:courseId
  app.get('/certificates/course/:courseId', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    if (!isTeacherOrAdmin(auth.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    const { courseId } = req.params as { courseId: string };
    return reply.send({ success: true, data: { certificates: listCertificatesByCourse(courseId) } });
  });

  // GET /certificates/serial/:serial
  app.get('/certificates/serial/:serial', async (req, reply) => {
    const { serial } = req.params as { serial: string };
    const cert = getCertificateBySerial(serial);
    if (!cert) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.send({ success: true, data: cert });
  });

  // GET /certificates/:id
  app.get('/certificates/:id', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    const { id } = req.params as { id: string };
    const cert = getCertificate(id);
    if (!cert) return reply.code(404).send({ success: false, error: 'Not found' });
    // Owner or teacher can see full; anyone can see public view
    if (cert.user_id !== auth.sub && !isTeacherOrAdmin(auth.role)) {
      return reply.send({ success: true, data: getCertificatePublicView(cert.verification_code) });
    }
    return reply.send({ success: true, data: cert });
  });

  // GET /certificates/:id/digital — 13.26 digital credential
  app.get('/certificates/:id/digital', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    const { id } = req.params as { id: string };
    const cert = getCertificate(id);
    if (!cert) return reply.code(404).send({ success: false, error: 'Not found' });
    if (cert.user_id !== auth.sub && !isTeacherOrAdmin(auth.role)) {
      return reply.code(403).send({ success: false, error: 'Not authorized' });
    }
    try {
      const cred = getDigitalCredential(id);
      if (!cred) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: cred });
    } catch (err) { return reply.code(410).send({ success: false, error: (err as Error).message }); }
  });

  // GET /certificates/:id/integrity — verify hash
  app.get('/certificates/:id/integrity', async (req, reply) => {
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: getCertificateIntegrity(id) }); }
    catch (err) { return reply.code(404).send({ success: false, error: (err as Error).message }); }
  });

  // GET /certificates/:id/verification-logs
  app.get('/certificates/:id/verification-logs', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    if (!isTeacherOrAdmin(auth.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 100, 1), 500) : 100;
    return reply.send({ success: true, data: { logs: listVerificationLogs(id, limit) } });
  });

  // ============================================================
  // 13.27 — Revocation
  // ============================================================

  // POST /certificates/:id/revoke
  app.post('/certificates/:id/revoke', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    if (!isTeacherOrAdmin(auth.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    const parsed = RevokeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: revokeCertificate(id, auth.sub, parsed.data.reason) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // POST /certificates/:id/reactivate (admin only)
  app.post('/certificates/:id/reactivate', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    if (auth.role !== 'admin') return reply.code(403).send({ success: false, error: 'Admin only' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: reactivateCertificate(id, auth.sub) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // ============================================================
  // 13.20-13.23 — Exams
  // ============================================================

  // POST /exams
  app.post('/exams', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    if (!isTeacherOrAdmin(auth.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    const parsed = CreateExamSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try { return reply.code(201).send({ success: true, data: createExam({ ...parsed.data, created_by: auth.sub }) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // GET /exams
  app.get('/exams', async (req, reply) => {
    const q = req.query as any;
    const status = EXAM_STATUSES.includes(q.status as any) ? q.status as ExamStatus : undefined;
    const exams = listExams({
      status, level_id: q.level_id, subject_id: q.subject_id,
      limit: q.limit ? parseInt(q.limit) : 50,
    });
    return reply.send({ success: true, data: { exams } });
  });

  // GET /exams/:id
  app.get('/exams/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const exam = getExam(id);
    if (!exam) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.send({ success: true, data: exam });
  });

  // PATCH /exams/:id/status
  app.patch('/exams/:id/status', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    if (!isTeacherOrAdmin(auth.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    const parsed = StatusUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: updateExamStatus(id, parsed.data.status, auth.sub, auth.role === 'admin') }); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
  });

  // POST /exams/:id/questions
  app.post('/exams/:id/questions', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    if (!isTeacherOrAdmin(auth.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    const parsed = AddQuestionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try { return reply.code(201).send({ success: true, data: addExamQuestion({ exam_id: id, ...parsed.data }) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // GET /exams/:id/questions
  app.get('/exams/:id/questions', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    if (!isTeacherOrAdmin(auth.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: { questions: listExamQuestions(id) } });
  });

  // DELETE /exams/questions/:qid
  app.delete('/exams/questions/:qid', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    if (!isTeacherOrAdmin(auth.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    const { qid } = req.params as { qid: string };
    try {
      const ok = deleteExamQuestion(qid, auth.sub, auth.role === 'admin');
      if (!ok) return reply.code(404).send({ success: false, error: 'Not found' });
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
  });

  // POST /exams/:id/start
  app.post('/exams/:id/start', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      ?? req.socket?.remoteAddress ?? null;
    const ua = (req.headers['user-agent'] as string) ?? null;
    const { id } = req.params as { id: string };
    try {
      const attempt = startExamAttempt(id, auth.sub, { ip_address: ip, user_agent: ua });
      const questions = getExamAttemptQuestions(attempt.id, true);
      return reply.code(201).send({ success: true, data: { attempt, questions } });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // GET /attempts/me
  app.get('/attempts/me', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    const q = req.query as { exam_id?: string; limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    return reply.send({ success: true, data: { attempts: listUserAttempts(auth.sub, { exam_id: q.exam_id, limit }) } });
  });

  // GET /attempts/:id
  app.get('/attempts/:id', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    const { id } = req.params as { id: string };
    const attempt = getExamAttempt(id);
    if (!attempt) return reply.code(404).send({ success: false, error: 'Not found' });
    if (attempt.user_id !== auth.sub && !isTeacherOrAdmin(auth.role)) {
      return reply.code(403).send({ success: false, error: 'Not authorized' });
    }
    return reply.send({ success: true, data: attempt });
  });

  // GET /attempts/:id/questions — safe view (no correct answers)
  app.get('/attempts/:id/questions', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    const { id } = req.params as { id: string };
    const attempt = getExamAttempt(id);
    if (!attempt) return reply.code(404).send({ success: false, error: 'Not found' });
    if (attempt.user_id !== auth.sub) return reply.code(403).send({ success: false, error: 'Not yours' });
    const forStudent = auth.role !== 'admin' && auth.role !== 'teacher';
    try { return reply.send({ success: true, data: { questions: getExamAttemptQuestions(id, forStudent) } }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // POST /attempts/:id/submit
  app.post('/attempts/:id/submit', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    const parsed = SubmitAttemptSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const attempt = submitExamAttempt(id, auth.sub, parsed.data.answers, { auto_submitted: parsed.data.auto_submitted });
      return reply.send({ success: true, data: attempt });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // GET /attempts/:id/result — 13.23
  app.get('/attempts/:id/result', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    const { id } = req.params as { id: string };
    const attempt = getExamAttempt(id);
    if (!attempt) return reply.code(404).send({ success: false, error: 'Not found' });
    if (attempt.user_id !== auth.sub && !isTeacherOrAdmin(auth.role)) {
      return reply.code(403).send({ success: false, error: 'Not authorized' });
    }
    const result = getAttemptResult(id);
    if (!result) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.send({ success: true, data: result });
  });

  // ============================================================
  // 13.22 — Proctoring
  // ============================================================

  // POST /attempts/:id/proctor-event
  app.post('/attempts/:id/proctor-event', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    const parsed = ProctorEventSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    const attempt = getExamAttempt(id);
    if (!attempt) return reply.code(404).send({ success: false, error: 'Not found' });
    if (attempt.user_id !== auth.sub) return reply.code(403).send({ success: false, error: 'Not your attempt' });
    try {
      const event = logProctorEvent({
        attempt_id: id,
        kind: parsed.data.kind as ProctorEventKind,
        description: parsed.data.description,
        metadata: parsed.data.metadata,
        severity: parsed.data.severity,
      });
      const summary = getAttemptViolationSummary(id);
      return reply.code(201).send({ success: true, data: { event, summary } });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // GET /attempts/:id/proctor-events
  app.get('/attempts/:id/proctor-events', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    const { id } = req.params as { id: string };
    const attempt = getExamAttempt(id);
    if (!attempt) return reply.code(404).send({ success: false, error: 'Not found' });
    if (attempt.user_id !== auth.sub && !isTeacherOrAdmin(auth.role)) {
      return reply.code(403).send({ success: false, error: 'Not authorized' });
    }
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 100, 1), 500) : 100;
    const events = listProctorEvents(id, limit);
    const summary = getAttemptViolationSummary(id);
    return reply.send({ success: true, data: { events, summary } });
  });

  // GET /exams/:examId/attempts — teacher view
  app.get('/exams/:examId/attempts', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    if (!isTeacherOrAdmin(auth.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    const { examId } = req.params as { examId: string };
    const q = req.query as { status?: string; limit?: string };
    const status = ATTEMPT_STATUSES.includes(q.status as any) ? q.status as AttemptStatus : undefined;
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 100, 1), 500) : 100;
    return reply.send({ success: true, data: { attempts: listExamAttempts(examId, { status, limit }) } });
  });

  // POST /attempts/:id/override — teacher score override
  app.post('/attempts/:id/override', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    if (!isTeacherOrAdmin(auth.role)) return reply.code(403).send({ success: false, error: 'Teacher only' });
    const parsed = OverrideSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: teacherOverrideScore(id, auth.sub, parsed.data.score, parsed.data.note) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // POST /exams/auto-submit-expired — cron
  app.post('/exams/auto-submit-expired', async (req, reply) => {
    const auth = requireAuthPayload(req.headers.authorization);
    if (auth.role !== 'admin') return reply.code(403).send({ success: false, error: 'Admin only' });
    const count = checkAndAutoSubmitExpired();
    return reply.send({ success: true, data: { auto_submitted: count } });
  });
}
