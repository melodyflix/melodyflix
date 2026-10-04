// melodyflix videos — Timed Exam + Proctoring (Section 13.20-13.23)
// Timed exam, question randomization, AI proctoring events, result verification.
import { randomUUID, createHash } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type ExamStatus = 'draft' | 'scheduled' | 'active' | 'grading' | 'completed' | 'cancelled';
export type AttemptStatus = 'in_progress' | 'submitted' | 'auto_submitted' | 'graded' | 'disqualified';
export type ProctorEventKind = 'tab_switch' | 'face_missing' | 'multiple_faces' | 'noise_detected'
  | 'mouse_out' | 'fullscreen_exit' | 'copy_paste_attempt' | 'network_drop'
  | 'suspicious_movement' | 'second_screen' | 'custom';

export interface Exam {
  id: string;
  level_id: string | null;
  subject_id: string | null;
  title: string;
  description: string | null;
  duration_minutes: number;
  total_marks: number;
  pass_marks: number;
  question_count: number;
  shuffle_questions: number;
  shuffle_options: number;
  proctoring_enabled: number;
  max_violations: number;
  status: ExamStatus;
  scheduled_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ExamQuestion {
  id: string;
  exam_id: string;
  question_bank_id: string | null;
  question_text: string;
  question_type: string;
  options_json: string | null;
  correct_answer: string;
  marks: number;
  negative_marks: number;
  order_index: number;
  created_at: string;
}

export interface ExamAttempt {
  id: string;
  exam_id: string;
  user_id: string;
  attempt_number: number;
  status: AttemptStatus;
  question_order_json: string | null;    // JSON array of question ids
  option_orders_json: string | null;     // JSON map question_id → option order
  answers_json: string | null;           // JSON map question_id → given
  score: number;
  total: number;
  percent: number;
  passed: number;
  auto_submitted: number;
  violation_count: number;
  disqualification_reason: string | null;
  started_at: string;
  submitted_at: string | null;
  graded_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProctorEvent {
  id: string;
  attempt_id: string;
  kind: ProctorEventKind;
  severity: 'low' | 'medium' | 'high';
  description: string | null;
  metadata_json: string | null;
  occurred_at: string;
}

// ============================================================
// Schema
// ============================================================

export function ensureExamSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS exams (
      id TEXT PRIMARY KEY,
      level_id TEXT,
      subject_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      duration_minutes INTEGER NOT NULL DEFAULT 60,
      total_marks INTEGER NOT NULL DEFAULT 0,
      pass_marks INTEGER NOT NULL DEFAULT 0,
      question_count INTEGER NOT NULL DEFAULT 0,
      shuffle_questions INTEGER NOT NULL DEFAULT 0,
      shuffle_options INTEGER NOT NULL DEFAULT 0,
      proctoring_enabled INTEGER NOT NULL DEFAULT 0,
      max_violations INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'draft',
      scheduled_at TEXT,
      starts_at TEXT,
      ends_at TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_exam_status ON exams(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_exam_lvlsub ON exams(level_id, subject_id, status);

    CREATE TABLE IF NOT EXISTS exam_questions (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL,
      question_bank_id TEXT,
      question_text TEXT NOT NULL,
      question_type TEXT NOT NULL DEFAULT 'mcq',
      options_json TEXT,
      correct_answer TEXT NOT NULL,
      marks INTEGER NOT NULL DEFAULT 1,
      negative_marks REAL NOT NULL DEFAULT 0,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_eq_exam ON exam_questions(exam_id, order_index);

    CREATE TABLE IF NOT EXISTS exam_attempts (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      attempt_number INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'in_progress',
      question_order_json TEXT,
      option_orders_json TEXT,
      answers_json TEXT,
      score INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      percent INTEGER NOT NULL DEFAULT 0,
      passed INTEGER NOT NULL DEFAULT 0,
      auto_submitted INTEGER NOT NULL DEFAULT 0,
      violation_count INTEGER NOT NULL DEFAULT 0,
      disqualification_reason TEXT,
      started_at TEXT NOT NULL,
      submitted_at TEXT,
      graded_at TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (exam_id, user_id, attempt_number)
    );
    CREATE INDEX IF NOT EXISTS idx_ea_user ON exam_attempts(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ea_exam ON exam_attempts(exam_id, status);

    CREATE TABLE IF NOT EXISTS proctor_events (
      id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      description TEXT,
      metadata_json TEXT,
      occurred_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pe_attempt ON proctor_events(attempt_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pe_severity ON proctor_events(severity, occurred_at DESC);
  `);
}

// ============================================================
// 13.20 — Exam CRUD
// ============================================================

export function createExam(input: {
  title: string;
  level_id?: string | null;
  subject_id?: string | null;
  description?: string | null;
  duration_minutes?: number;
  pass_marks?: number;
  shuffle_questions?: boolean;
  shuffle_options?: boolean;
  proctoring_enabled?: boolean;
  max_violations?: number;
  scheduled_at?: string | null;
  created_by: string;
}): Exam {
  const title = (input.title ?? '').trim();
  if (title.length < 3 || title.length > 250) throw new Error('title must be 3-250 chars');
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO exams (id, level_id, subject_id, title, description, duration_minutes,
      total_marks, pass_marks, question_count, shuffle_questions, shuffle_options,
      proctoring_enabled, max_violations, status, scheduled_at, starts_at, ends_at,
      created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?, 'draft', ?, NULL, NULL, ?, ?, ?)
  `).run(id, input.level_id ?? null, input.subject_id ?? null, title, input.description ?? null,
    Math.min(Math.max(input.duration_minutes ?? 60, 1), 600),
    Math.min(Math.max(input.pass_marks ?? 0, 0), 10000),
    input.shuffle_questions ? 1 : 0, input.shuffle_options ? 1 : 0,
    input.proctoring_enabled ? 1 : 0,
    Math.min(Math.max(input.max_violations ?? 3, 1), 20),
    input.scheduled_at ?? null, input.created_by, now, now);
  return getExam(id)!;
}

export function getExam(id: string): Exam | null {
  return (getDb().prepare('SELECT * FROM exams WHERE id = ?').get(id) as Exam | undefined) ?? null;
}

export function listExams(opts: { status?: ExamStatus; level_id?: string; subject_id?: string; limit?: number } = {}): Exam[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const filters: string[] = [];
  const params: any[] = [];
  if (opts.status) { filters.push('status = ?'); params.push(opts.status); }
  if (opts.level_id) { filters.push('level_id = ?'); params.push(opts.level_id); }
  if (opts.subject_id) { filters.push('subject_id = ?'); params.push(opts.subject_id); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  params.push(limit);
  return db.prepare(
    `SELECT * FROM exams ${where} ORDER BY created_at DESC LIMIT ?`
  ).all(...params) as Exam[];
}

export function updateExamStatus(id: string, status: ExamStatus, requesterId: string, isAdmin: boolean): Exam {
  const db = getDb();
  const exam = getExam(id);
  if (!exam) throw new Error('Exam not found');
  if (!isAdmin && exam.created_by !== requesterId) throw new Error('Not authorized');

  const now = new Date().toISOString();
  let startsAt = exam.starts_at;
  let endsAt = exam.ends_at;
  if (status === 'active' && !startsAt) startsAt = now;
  if (status === 'completed' || status === 'cancelled') endsAt = now;

  db.prepare('UPDATE exams SET status = ?, starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ?')
    .run(status, startsAt, endsAt, now, id);
  return getExam(id)!;
}

// ============================================================
// Exam questions
// ============================================================

export function addExamQuestion(input: {
  exam_id: string;
  question_text: string;
  question_type?: string;
  options?: string[];
  correct_answer: string;
  marks?: number;
  negative_marks?: number;
  question_bank_id?: string | null;
  order_index?: number;
}): ExamQuestion {
  const exam = getExam(input.exam_id);
  if (!exam) throw new Error('Exam not found');
  const text = (input.question_text ?? '').trim();
  if (text.length < 3 || text.length > 10000) throw new Error('question_text must be 3-10000 chars');
  const correct = String(input.correct_answer ?? '').trim();
  if (!correct) throw new Error('correct_answer required');

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const order = input.order_index ?? (db.prepare(
    'SELECT COALESCE(MAX(order_index), 0) + 1 as next FROM exam_questions WHERE exam_id = ?'
  ).get(input.exam_id) as { next: number }).next;

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO exam_questions (id, exam_id, question_bank_id, question_text, question_type,
        options_json, correct_answer, marks, negative_marks, order_index, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.exam_id, input.question_bank_id ?? null, text,
      input.question_type ?? 'mcq',
      input.options ? JSON.stringify(input.options) : null,
      correct,
      Math.min(Math.max(input.marks ?? 1, 1), 100),
      Math.max(input.negative_marks ?? 0, 0),
      order, now);
    recomputeExamTotals(input.exam_id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return getExamQuestion(id)!;
}

function recomputeExamTotals(examId: string): void {
  const db = getDb();
  const row = db.prepare(
    'SELECT COALESCE(SUM(marks), 0) as total, COUNT(*) as cnt FROM exam_questions WHERE exam_id = ?'
  ).get(examId) as { total: number; cnt: number };
  db.prepare('UPDATE exams SET total_marks = ?, question_count = ?, updated_at = ? WHERE id = ?')
    .run(row.total, row.cnt, new Date().toISOString(), examId);
}

export function getExamQuestion(id: string): ExamQuestion | null {
  return (getDb().prepare('SELECT * FROM exam_questions WHERE id = ?').get(id) as ExamQuestion | undefined) ?? null;
}

export function listExamQuestions(examId: string): ExamQuestion[] {
  return getDb().prepare(
    'SELECT * FROM exam_questions WHERE exam_id = ? ORDER BY order_index ASC'
  ).all(examId) as ExamQuestion[];
}

export function deleteExamQuestion(id: string, requesterId: string, isAdmin: boolean): boolean {
  const db = getDb();
  const q = getExamQuestion(id);
  if (!q) return false;
  const exam = getExam(q.exam_id);
  if (!exam) return false;
  if (!isAdmin && exam.created_by !== requesterId) throw new Error('Not authorized');
  const info = db.prepare('DELETE FROM exam_questions WHERE id = ?').run(id);
  recomputeExamTotals(q.exam_id);
  return Number(info.changes ?? 0) > 0;
}

// ============================================================
// 13.21 — Question randomization
// ============================================================

function shuffleArray<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function seedFromString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function buildAttemptQuestions(exam: Exam, attemptId: string): {
  orderedQuestions: ExamQuestion[];
  questionOrder: string[];
  optionOrders: Record<string, number[]>;
} {
  let questions = listExamQuestions(exam.id);
  const seed = seedFromString(attemptId);

  if (exam.shuffle_questions) {
    questions = shuffleArray(questions, seed);
  }

  const optionOrders: Record<string, number[]> = {};
  if (exam.shuffle_options) {
    for (const q of questions) {
      if (!q.options_json) continue;
      const opts = JSON.parse(q.options_json) as string[];
      const idx = opts.map((_, i) => i);
      optionOrders[q.id] = shuffleArray(idx, seed + q.id.length);
    }
  }

  return {
    orderedQuestions: questions,
    questionOrder: questions.map((q) => q.id),
    optionOrders,
  };
}

// ============================================================
// 13.20 — Attempts (timed)
// ============================================================

export function startExamAttempt(examId: string, userId: string, meta: { ip_address?: string | null; user_agent?: string | null } = {}): ExamAttempt {
  const db = getDb();
  const exam = getExam(examId);
  if (!exam) throw new Error('Exam not found');
  if (exam.status !== 'active' && exam.status !== 'scheduled') {
    throw new Error(`Exam is ${exam.status} — cannot start`);
  }
  if (exam.status === 'scheduled' && exam.scheduled_at && new Date(exam.scheduled_at) > new Date()) {
    throw new Error('Exam has not started yet');
  }
  if (exam.question_count === 0) throw new Error('Exam has no questions');

  const existing = db.prepare(
    "SELECT * FROM exam_attempts WHERE exam_id = ? AND user_id = ? AND status IN ('in_progress','submitted')"
  ).get(examId, userId) as ExamAttempt | undefined;
  if (existing) {
    if (existing.status === 'in_progress') return existing;
    throw new Error('You have already attempted this exam');
  }

  const countRow = db.prepare(
    'SELECT COALESCE(MAX(attempt_number), 0) as max_n FROM exam_attempts WHERE exam_id = ? AND user_id = ?'
  ).get(examId, userId) as { max_n: number };
  const attemptNumber = countRow.max_n + 1;

  const id = randomUUID();
  const now = new Date().toISOString();
  const { questionOrder, optionOrders } = buildAttemptQuestions(exam, id);

  db.prepare(`
    INSERT INTO exam_attempts (id, exam_id, user_id, attempt_number, status,
      question_order_json, option_orders_json, answers_json, score, total, percent,
      passed, auto_submitted, violation_count, disqualification_reason,
      started_at, submitted_at, graded_at, ip_address, user_agent, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'in_progress', ?, ?, NULL, 0, ?, 0, 0, 0, 0, NULL, ?, NULL, NULL, ?, ?, ?, ?)
  `).run(id, examId, userId, attemptNumber,
    JSON.stringify(questionOrder),
    Object.keys(optionOrders).length ? JSON.stringify(optionOrders) : null,
    exam.total_marks, now,
    meta.ip_address ?? null, meta.user_agent ?? null, now, now);

  return getExamAttempt(id)!;
}

export function getExamAttempt(id: string): ExamAttempt | null {
  return (getDb().prepare('SELECT * FROM exam_attempts WHERE id = ?').get(id) as ExamAttempt | undefined) ?? null;
}

export function listUserAttempts(userId: string, opts: { exam_id?: string; limit?: number } = {}): ExamAttempt[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const filters: string[] = ['user_id = ?'];
  const params: any[] = [userId];
  if (opts.exam_id) { filters.push('exam_id = ?'); params.push(opts.exam_id); }
  params.push(limit);
  return db.prepare(
    `SELECT * FROM exam_attempts WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT ?`
  ).all(...params) as ExamAttempt[];
}

export function listExamAttempts(examId: string, opts: { status?: AttemptStatus; limit?: number } = {}): ExamAttempt[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const filters: string[] = ['exam_id = ?'];
  const params: any[] = [examId];
  if (opts.status) { filters.push('status = ?'); params.push(opts.status); }
  params.push(limit);
  return db.prepare(
    `SELECT * FROM exam_attempts WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT ?`
  ).all(...params) as ExamAttempt[];
}

export function getExamAttemptQuestions(attemptId: string, forStudent = true): Array<{
  id: string;
  question_text: string;
  question_type: string;
  options: string[] | null;
  marks: number;
  negative_marks: number;
  order_index: number;
}> {
  const attempt = getExamAttempt(attemptId);
  if (!attempt) throw new Error('Attempt not found');
  const order = attempt.question_order_json ? JSON.parse(attempt.question_order_json) as string[] : [];
  const optOrders = attempt.option_orders_json ? JSON.parse(attempt.option_orders_json) as Record<string, number[]> : {};
  const db = getDb();
  const result: Array<any> = [];
  for (let i = 0; i < order.length; i++) {
    const q = db.prepare('SELECT * FROM exam_questions WHERE id = ?').get(order[i]) as ExamQuestion | undefined;
    if (!q) continue;
    let options: string[] | null = null;
    if (q.options_json) {
      const parsed = JSON.parse(q.options_json) as string[];
      const orderArr = optOrders[q.id];
      options = orderArr ? orderArr.map((idx) => parsed[idx]) : parsed;
    }
    result.push({
      id: q.id,
      question_text: q.question_text,
      question_type: q.question_type,
      options,
      marks: q.marks,
      negative_marks: q.negative_marks,
      order_index: i + 1,
      ...(forStudent ? {} : { correct_answer: q.correct_answer }),
    });
  }
  return result;
}

// ============================================================
// Submit + auto-grade (13.20 / 13.23)
// ============================================================

export function submitExamAttempt(attemptId: string, userId: string, answers: Record<string, string>, opts: { auto_submitted?: boolean } = {}): ExamAttempt {
  const db = getDb();
  const attempt = getExamAttempt(attemptId);
  if (!attempt) throw new Error('Attempt not found');
  if (attempt.user_id !== userId) throw new Error('Not your attempt');
  if (attempt.status !== 'in_progress') throw new Error(`Attempt is ${attempt.status}`);

  const exam = getExam(attempt.exam_id);
  if (!exam) throw new Error('Exam not found');

  const questions = getExamAttemptQuestions(attemptId, false) as any[];
  let score = 0;
  let totalMarks = 0;
  for (const q of questions) {
    totalMarks += q.marks;
    const given = answers[q.id];
    if (given === undefined || given === null || given === '') continue;
    if (String(given).trim() === String(q.correct_answer).trim()) score += q.marks;
    else if (q.negative_marks > 0) score -= Math.round(q.negative_marks);
  }
  score = Math.max(0, score);
  const percent = totalMarks > 0 ? Math.round((score / totalMarks) * 100) : 0;
  const passed = score >= exam.pass_marks ? 1 : 0;

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE exam_attempts SET status = ?, answers_json = ?, score = ?, total = ?, percent = ?,
      passed = ?, auto_submitted = ?, submitted_at = ?, graded_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    opts.auto_submitted ? 'auto_submitted' : 'graded',
    JSON.stringify(answers), score, totalMarks, percent, passed,
    opts.auto_submitted ? 1 : 0, now, now, now, attemptId);
  return getExamAttempt(attemptId)!;
}

export function checkAndAutoSubmitExpired(): number {
  const db = getDb();
  const now = new Date();
  const inProgress = db.prepare(
    "SELECT * FROM exam_attempts WHERE status = 'in_progress'"
  ).all() as ExamAttempt[];
  let count = 0;
  for (const a of inProgress) {
    const exam = getExam(a.exam_id);
    if (!exam) continue;
    const elapsed = (now.getTime() - new Date(a.started_at).getTime()) / 60000;
    if (elapsed >= exam.duration_minutes) {
      const answers: Record<string, string> = a.answers_json ? JSON.parse(a.answers_json) : {};
      submitExamAttempt(a.id, a.user_id, answers, { auto_submitted: true });
      count += 1;
    }
  }
  return count;
}

// ============================================================
// 13.22 — AI Proctoring events
// ============================================================

const SEVERITY_BY_KIND: Record<ProctorEventKind, 'low' | 'medium' | 'high'> = {
  tab_switch: 'medium',
  face_missing: 'high',
  multiple_faces: 'high',
  noise_detected: 'low',
  mouse_out: 'low',
  fullscreen_exit: 'medium',
  copy_paste_attempt: 'high',
  network_drop: 'low',
  suspicious_movement: 'medium',
  second_screen: 'high',
  custom: 'low',
};

export function logProctorEvent(input: {
  attempt_id: string;
  kind: ProctorEventKind;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  severity?: 'low' | 'medium' | 'high';
}): ProctorEvent {
  const attempt = getExamAttempt(input.attempt_id);
  if (!attempt) throw new Error('Attempt not found');
  const exam = getExam(attempt.exam_id);
  if (!exam) throw new Error('Exam not found');
  if (exam.proctoring_enabled !== 1) throw new Error('Proctoring not enabled for this exam');
  if (attempt.status !== 'in_progress') throw new Error('Attempt not in progress');

  const severity = input.severity ?? SEVERITY_BY_KIND[input.kind] ?? 'medium';
  const id = randomUUID();
  const now = new Date().toISOString();

  const db = getDb();
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO proctor_events (id, attempt_id, kind, severity, description, metadata_json, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.attempt_id, input.kind, severity,
      input.description ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null, now);

    const newCount = attempt.violation_count + 1;
    let status: AttemptStatus = attempt.status;
    let disqReason: string | null = attempt.disqualification_reason;

    if (newCount >= exam.max_violations) {
      status = 'disqualified';
      disqReason = `Auto-disqualified: exceeded ${exam.max_violations} proctoring violations`;
    }

    db.prepare(`
      UPDATE exam_attempts SET violation_count = ?, status = ?, disqualification_reason = ?, updated_at = ?
      WHERE id = ?
    `).run(newCount, status, disqReason, now, input.attempt_id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  return db.prepare('SELECT * FROM proctor_events WHERE id = ?').get(id) as ProctorEvent;
}

export function listProctorEvents(attemptId: string, limit = 100): ProctorEvent[] {
  return getDb().prepare(
    'SELECT * FROM proctor_events WHERE attempt_id = ? ORDER BY occurred_at DESC LIMIT ?'
  ).all(attemptId, Math.min(Math.max(limit, 1), 500)) as ProctorEvent[];
}

export function getAttemptViolationSummary(attemptId: string): {
  attempt_id: string;
  total_violations: number;
  by_kind: Record<string, number>;
  by_severity: Record<string, number>;
  disqualified: boolean;
} {
  const db = getDb();
  const attempt = getExamAttempt(attemptId);
  if (!attempt) throw new Error('Attempt not found');
  const byKind: Record<string, number> = {};
  const bySev: Record<string, number> = { low: 0, medium: 0, high: 0 };
  const rows = db.prepare(
    'SELECT kind, severity, COUNT(*) as n FROM proctor_events WHERE attempt_id = ? GROUP BY kind, severity'
  ).all(attemptId) as Array<{ kind: string; severity: string; n: number }>;
  for (const r of rows) {
    byKind[r.kind] = (byKind[r.kind] ?? 0) + r.n;
    bySev[r.severity] = (bySev[r.severity] ?? 0) + r.n;
  }
  return {
    attempt_id: attemptId,
    total_violations: attempt.violation_count,
    by_kind: byKind,
    by_severity: bySev,
    disqualified: attempt.status === 'disqualified',
  };
}

// ============================================================
// 13.23 — Result verification
// ============================================================

export interface AttemptResult {
  attempt_id: string;
  exam_id: string;
  exam_title: string;
  user_id: string;
  score: number;
  total: number;
  percent: number;
  passed: boolean;
  status: AttemptStatus;
  started_at: string;
  submitted_at: string | null;
  result_hash: string | null;
}

export function getAttemptResult(attemptId: string): AttemptResult | null {
  const db = getDb();
  const a = getExamAttempt(attemptId);
  if (!a) return null;
  const exam = getExam(a.exam_id);
  if (!exam) return null;
  return {
    attempt_id: a.id,
    exam_id: a.exam_id,
    exam_title: exam.title,
    user_id: a.user_id,
    score: a.score,
    total: a.total,
    percent: a.percent,
    passed: a.passed === 1,
    status: a.status,
    started_at: a.started_at,
    submitted_at: a.submitted_at,
    result_hash: a.status === 'graded' || a.status === 'auto_submitted'
      ? createHash('sha256').update(`${a.id}|${a.score}|${a.total}|${a.graded_at}`).digest('hex').slice(0, 32)
      : null,
  };
}

export function teacherOverrideScore(attemptId: string, teacherId: string, newScore: number, note: string): ExamAttempt {
  const db = getDb();
  const attempt = getExamAttempt(attemptId);
  if (!attempt) throw new Error('Attempt not found');
  const exam = getExam(attempt.exam_id);
  if (!exam) throw new Error('Exam not found');
  const score = Math.min(Math.max(Math.round(newScore), 0), attempt.total);
  const percent = attempt.total > 0 ? Math.round((score / attempt.total) * 100) : 0;
  const passed = score >= exam.pass_marks ? 1 : 0;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE exam_attempts SET score = ?, percent = ?, passed = ?, status = 'graded',
      graded_at = ?, disqualification_reason = COALESCE(disqualification_reason, ?), updated_at = ?
    WHERE id = ?
  `).run(score, percent, passed, now, `Override by ${teacherId}: ${note}`, now, attemptId);
  return getExamAttempt(attemptId)!;
}
