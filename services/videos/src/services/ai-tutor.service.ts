// melodyflix videos — AI Tutor (Section 13.6-13.15)
// Student Q&A, AI answers, step-by-step, image/voice questions,
// practice quiz, error analysis, teacher escalation, source citation.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';
import {
  getIntegrationConfigRaw, isIntegrationReady,
} from './integration-settings.service.js';

export type QuestionStatus = 'pending' | 'ai_answered' | 'teacher_review' | 'teacher_answered' | 'closed' | 'rejected';
export type QuestionKind = 'text' | 'image' | 'voice' | 'mixed';
export type AiProvider = 'openai' | 'anthropic' | 'gemini';
export type AnswerSource = 'ai' | 'teacher' | 'hybrid';
export type VerificationStatus = 'unverified' | 'verified' | 'disputed' | 'needs_source';

export interface TutorQuestion {
  id: string;
  user_id: string;
  level_id: string | null;
  subject_id: string | null;
  topic_id: string | null;
  kind: QuestionKind;
  body: string;
  image_urls_json: string | null;
  voice_urls_json: string | null;
  language: string;
  status: QuestionStatus;
  escalation_reason: string | null;
  escalated_to: string | null;
  escalated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TutorAnswer {
  id: string;
  question_id: string;
  source: AnswerSource;
  provider: AiProvider | null;
  model: string | null;
  answer_text: string;
  explanation: string | null;
  step_by_step_json: string | null;
  sources_json: string | null;
  verification_status: VerificationStatus;
  verification_note: string | null;
  answered_by: string | null;
  tokens_used: number | null;
  latency_ms: number | null;
  created_at: string;
}

export interface PracticeQuiz {
  id: string;
  user_id: string;
  level_id: string | null;
  subject_id: string | null;
  topic_id: string | null;
  difficulty: string;
  questions_json: string;
  total_questions: number;
  created_at: string;
}

export interface QuizAttempt {
  id: string;
  quiz_id: string;
  user_id: string;
  answers_json: string;
  score: number;
  total: number;
  percent: number;
  error_analysis_json: string | null;
  feedback: string | null;
  duration_seconds: number | null;
  completed_at: string;
}

export interface LearningProgress {
  user_id: string;
  subject_id: string | null;
  total_questions: number;
  resolved_questions: number;
  escalated_questions: number;
  quizzes_taken: number;
  avg_quiz_score: number;
  last_activity_at: string;
}

// ============================================================
// Schema
// ============================================================

export function ensureAiTutorSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS tutor_questions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      level_id TEXT,
      subject_id TEXT,
      topic_id TEXT,
      kind TEXT NOT NULL DEFAULT 'text',
      body TEXT NOT NULL,
      image_urls_json TEXT,
      voice_urls_json TEXT,
      language TEXT NOT NULL DEFAULT 'en',
      status TEXT NOT NULL DEFAULT 'pending',
      escalation_reason TEXT,
      escalated_to TEXT,
      escalated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tq_user ON tutor_questions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tq_status ON tutor_questions(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tq_subject ON tutor_questions(subject_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tq_escalated_to ON tutor_questions(escalated_to, status);

    CREATE TABLE IF NOT EXISTS tutor_answers (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL,
      source TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      answer_text TEXT NOT NULL,
      explanation TEXT,
      step_by_step_json TEXT,
      sources_json TEXT,
      verification_status TEXT NOT NULL DEFAULT 'unverified',
      verification_note TEXT,
      answered_by TEXT,
      tokens_used INTEGER,
      latency_ms INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ta_question ON tutor_answers(question_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ta_source ON tutor_answers(source, created_at DESC);

    CREATE TABLE IF NOT EXISTS practice_quizzes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      level_id TEXT,
      subject_id TEXT,
      topic_id TEXT,
      difficulty TEXT NOT NULL DEFAULT 'medium',
      questions_json TEXT NOT NULL,
      total_questions INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pq_user ON practice_quizzes(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id TEXT PRIMARY KEY,
      quiz_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      answers_json TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      percent INTEGER NOT NULL DEFAULT 0,
      error_analysis_json TEXT,
      feedback TEXT,
      duration_seconds INTEGER,
      completed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_qa_user ON quiz_attempts(user_id, completed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_qa_quiz ON quiz_attempts(quiz_id);
  `);
}

// ============================================================
// 13.6 — Question submission
// ============================================================

export function submitQuestion(input: {
  user_id: string;
  body: string;
  level_id?: string | null;
  subject_id?: string | null;
  topic_id?: string | null;
  kind?: QuestionKind;
  image_urls?: string[];
  voice_urls?: string[];
  language?: string;
}): TutorQuestion {
  const body = (input.body ?? '').trim();
  if (body.length < 3 || body.length > 5000) throw new Error('body must be 3-5000 chars');

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO tutor_questions
      (id, user_id, level_id, subject_id, topic_id, kind, body, image_urls_json, voice_urls_json,
       language, status, escalation_reason, escalated_to, escalated_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, ?, ?)
  `).run(id, input.user_id, input.level_id ?? null, input.subject_id ?? null,
    input.topic_id ?? null, input.kind ?? 'text', body,
    input.image_urls ? JSON.stringify(input.image_urls.slice(0, 10)) : null,
    input.voice_urls ? JSON.stringify(input.voice_urls.slice(0, 5)) : null,
    input.language ?? 'en', now, now);
  return getQuestion(id)!;
}

export function getQuestion(id: string): TutorQuestion | null {
  return (getDb().prepare('SELECT * FROM tutor_questions WHERE id = ?').get(id) as TutorQuestion | undefined) ?? null;
}

export function listUserQuestions(userId: string, opts: { status?: QuestionStatus; limit?: number } = {}): TutorQuestion[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const filters: string[] = ['user_id = ?'];
  const params: any[] = [userId];
  if (opts.status) { filters.push('status = ?'); params.push(opts.status); }
  params.push(limit);
  return db.prepare(
    `SELECT * FROM tutor_questions WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT ?`
  ).all(...params) as TutorQuestion[];
}

export function listQuestionsForTeacher(teacherId: string, opts: { status?: QuestionStatus; limit?: number } = {}): TutorQuestion[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const filters: string[] = ['(escalated_to = ? OR status = ?)'];
  const params: any[] = [teacherId, 'teacher_review'];
  if (opts.status) { filters.push('status = ?'); params.push(opts.status); }
  params.push(limit);
  return db.prepare(
    `SELECT * FROM tutor_questions WHERE ${filters.join(' AND ')} ORDER BY created_at ASC LIMIT ?`
  ).all(...params) as TutorQuestion[];
}

export function escalateQuestion(questionId: string, reason: string, teacherId?: string | null): TutorQuestion {
  const db = getDb();
  const q = getQuestion(questionId);
  if (!q) throw new Error('Question not found');
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE tutor_questions SET status = 'teacher_review', escalation_reason = ?,
      escalated_to = ?, escalated_at = ?, updated_at = ? WHERE id = ?
  `).run(reason.slice(0, 500), teacherId ?? null, now, now, questionId);
  return getQuestion(questionId)!;
}

// ============================================================
// 13.7 / 13.8 — AI Answer
// ============================================================

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const TUTOR_TIMEOUT_MS = 30000;

function buildTutorSystemPrompt(opts: {
  level_name?: string | null; subject_name?: string | null;
  language?: string;
}): string {
  const parts: string[] = [
    'You are an expert tutor for students of all ages (preschool to BCS/professional certs).',
    'Your answers must be:',
    '1. Accurate, verified, and free of hallucinations.',
    '2. Age-appropriate for the requested level.',
    '3. Structured with: short answer, then detailed explanation.',
    '4. If a step-by-step solution is appropriate, provide numbered steps.',
    '5. Cite reliable sources when possible (textbook, website, or reference).',
    '6. Reply in the requested language.',
  ];
  if (opts.level_name) parts.push(`Student level: ${opts.level_name}.`);
  if (opts.subject_name) parts.push(`Subject: ${opts.subject_name}.`);
  parts.push(`Reply in language code: ${opts.language ?? 'en'}.`);
  return parts.join('\n');
}

function buildTutorUserPrompt(body: string, hasImages: boolean, hasVoice: boolean): string {
  let p = `Student question:\n${body}`;
  if (hasImages) p += '\n\n(Student attached image(s) of their question — analyze them carefully.)';
  if (hasVoice) p += '\n\n(Student also attached audio describing the question.)';
  p += '\n\nReturn JSON with these keys: { "short_answer": "...", "explanation": "...", "step_by_step": ["...", "..."], "sources": ["...", "..."] }';
  return p;
}

function getActiveProvider(): { provider: AiProvider; api_key: string; model: string; base_url?: string } | null {
  const candidates: AiProvider[] = ['openai', 'anthropic', 'gemini'];
  for (const p of candidates) {
    if (!isIntegrationReady(p)) continue;
    const cfg = getIntegrationConfigRaw(p);
    if (!cfg) continue;
    const key = String(cfg.api_key ?? '');
    if (!key) continue;
    return {
      provider: p, api_key: key,
      model: String(cfg.model ?? (p === 'openai' ? 'gpt-4o-mini' : p === 'anthropic' ? 'claude-3-5-sonnet-latest' : 'gemini-1.5-flash')),
      base_url: cfg.base_url ? String(cfg.base_url) : undefined,
    };
  }
  return null;
}

async function callOpenAiCompatible(baseUrl: string, apiKey: string, model: string, messages: ChatMessage[]): Promise<{ text: string; tokens: number }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TUTOR_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: 0.3, response_format: { type: 'json_object' } }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`OpenAI ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = await res.json() as any;
    const text = data.choices?.[0]?.message?.content ?? '';
    const tokens = data.usage?.total_tokens ?? 0;
    return { text, tokens };
  } finally { clearTimeout(t); }
}

async function callAnthropic(apiKey: string, model: string, system: string, userMessage: string): Promise<{ text: string; tokens: number }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TUTOR_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model, max_tokens: 2048, system,
        messages: [{ role: 'user', content: userMessage }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Anthropic ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = await res.json() as any;
    const text = data.content?.[0]?.text ?? '';
    const tokens = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);
    return { text, tokens };
  } finally { clearTimeout(t); }
}

async function callGemini(apiKey: string, model: string, systemPrompt: string, userMessage: string): Promise<{ text: string; tokens: number }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TUTOR_TIMEOUT_MS);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Gemini ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = await res.json() as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const tokens = data.usageMetadata?.totalTokenCount ?? 0;
    return { text, tokens };
  } finally { clearTimeout(t); }
}

function safeJsonParse(text: string): any {
  try {
    // Strip code fences if present
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    return JSON.parse(cleaned);
  } catch { return null; }
}

export async function answerQuestionWithAi(questionId: string, opts: {
  level_name?: string | null; subject_name?: string | null;
} = {}): Promise<TutorAnswer> {
  const q = getQuestion(questionId);
  if (!q) throw new Error('Question not found');
  if (q.status === 'closed' || q.status === 'teacher_answered') {
    throw new Error(`Cannot AI-answer a ${q.status} question`);
  }

  const provider = getActiveProvider();
  if (!provider) {
    throw new Error('No AI provider configured — set OpenAI/Anthropic/Gemini in admin panel > Integrations');
  }

  const systemPrompt = buildTutorSystemPrompt({
    level_name: opts.level_name, subject_name: opts.subject_name, language: q.language,
  });
  const userPrompt = buildTutorUserPrompt(q.body, !!q.image_urls_json, !!q.voice_urls_json);

  const startedAt = Date.now();
  let rawText = '';
  let tokens = 0;

  if (provider.provider === 'openai') {
    const baseUrl = provider.base_url ?? 'https://api.openai.com/v1';
    const r = await callOpenAiCompatible(baseUrl, provider.api_key, provider.model, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);
    rawText = r.text; tokens = r.tokens;
  } else if (provider.provider === 'anthropic') {
    const r = await callAnthropic(provider.api_key, provider.model, systemPrompt, userPrompt);
    rawText = r.text; tokens = r.tokens;
  } else if (provider.provider === 'gemini') {
    const r = await callGemini(provider.api_key, provider.model, systemPrompt, userPrompt);
    rawText = r.text; tokens = r.tokens;
  }

  const latency = Date.now() - startedAt;
  const parsed = safeJsonParse(rawText);
  const answerText = parsed?.short_answer ?? rawText.slice(0, 5000);
  const explanation = parsed?.explanation ?? null;
  const steps = Array.isArray(parsed?.step_by_step) ? parsed.step_by_step : null;
  const sources = Array.isArray(parsed?.sources) ? parsed.sources : null;

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO tutor_answers
        (id, question_id, source, provider, model, answer_text, explanation,
         step_by_step_json, sources_json, verification_status, verification_note,
         answered_by, tokens_used, latency_ms, created_at)
      VALUES (?, ?, 'ai', ?, ?, ?, ?, ?, ?, 'unverified', NULL, NULL, ?, ?, ?)
    `).run(id, questionId, provider.provider, provider.model, answerText, explanation,
      steps ? JSON.stringify(steps) : null, sources ? JSON.stringify(sources) : null,
      tokens, latency, now);

    db.prepare(
      "UPDATE tutor_questions SET status = 'ai_answered', updated_at = ? WHERE id = ?"
    ).run(now, questionId);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  return getAnswer(id)!;
}

// ============================================================
// 13.14 — Teacher answer / review
// ============================================================

export function submitTeacherAnswer(input: {
  question_id: string;
  teacher_id: string;
  answer_text: string;
  explanation?: string | null;
  step_by_step?: string[];
  sources?: string[];
  verification_status?: VerificationStatus;
}): TutorAnswer {
  const q = getQuestion(input.question_id);
  if (!q) throw new Error('Question not found');
  const answer = (input.answer_text ?? '').trim();
  if (answer.length < 1 || answer.length > 10000) throw new Error('answer_text must be 1-10000 chars');

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO tutor_answers
        (id, question_id, source, provider, model, answer_text, explanation,
         step_by_step_json, sources_json, verification_status, verification_note,
         answered_by, tokens_used, latency_ms, created_at)
      VALUES (?, ?, 'teacher', NULL, NULL, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?)
    `).run(id, input.question_id, answer, input.explanation ?? null,
      input.step_by_step ? JSON.stringify(input.step_by_step) : null,
      input.sources ? JSON.stringify(input.sources) : null,
      input.verification_status ?? 'verified', input.teacher_id, now);

    db.prepare(
      "UPDATE tutor_questions SET status = 'teacher_answered', updated_at = ? WHERE id = ?"
    ).run(now, input.question_id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  return getAnswer(id)!;
}

export function verifyAnswer(answerId: string, reviewerId: string, status: VerificationStatus, note?: string | null): TutorAnswer {
  const db = getDb();
  const existing = getAnswer(answerId);
  if (!existing) throw new Error('Answer not found');
  db.prepare(`
    UPDATE tutor_answers SET verification_status = ?, verification_note = ?, answered_by = ?
    WHERE id = ?
  `).run(status, note ?? null, reviewerId, answerId);
  return getAnswer(answerId)!;
}

export function getAnswer(id: string): TutorAnswer | null {
  return (getDb().prepare('SELECT * FROM tutor_answers WHERE id = ?').get(id) as TutorAnswer | undefined) ?? null;
}

export function listAnswersForQuestion(questionId: string): TutorAnswer[] {
  return getDb().prepare(
    'SELECT * FROM tutor_answers WHERE question_id = ? ORDER BY created_at DESC'
  ).all(questionId) as TutorAnswer[];
}

export function closeQuestion(questionId: string, userId: string): TutorQuestion {
  const db = getDb();
  const q = getQuestion(questionId);
  if (!q) throw new Error('Question not found');
  if (q.user_id !== userId) throw new Error('Not authorized');
  const now = new Date().toISOString();
  db.prepare("UPDATE tutor_questions SET status = 'closed', updated_at = ? WHERE id = ?").run(now, questionId);
  return getQuestion(questionId)!;
}

// ============================================================
// 13.11 — Practice Quiz
// ============================================================

export function createPracticeQuiz(input: {
  user_id: string;
  level_id?: string | null;
  subject_id?: string | null;
  topic_id?: string | null;
  difficulty?: 'easy' | 'medium' | 'hard';
  total_questions?: number;
}): PracticeQuiz {
  const total = Math.min(Math.max(input.total_questions ?? 5, 1), 50);
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  // Placeholder questions — real implementation calls AI to generate
  const questions = Array.from({ length: total }, (_, i) => ({
    index: i + 1,
    question: `Sample question ${i + 1} — AI generation pending (configure OpenAI/Anthropic/Gemini in admin).`,
    options: ['A', 'B', 'C', 'D'],
    correct_index: 0,
    explanation: null as string | null,
  }));

  db.prepare(`
    INSERT INTO practice_quizzes (id, user_id, level_id, subject_id, topic_id, difficulty,
      questions_json, total_questions, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.user_id, input.level_id ?? null, input.subject_id ?? null,
    input.topic_id ?? null, input.difficulty ?? 'medium',
    JSON.stringify(questions), total, now);
  return getQuiz(id)!;
}

export function getQuiz(id: string): PracticeQuiz | null {
  return (getDb().prepare('SELECT * FROM practice_quizzes WHERE id = ?').get(id) as PracticeQuiz | undefined) ?? null;
}

export function listUserQuizzes(userId: string, limit = 30): PracticeQuiz[] {
  return getDb().prepare(
    'SELECT * FROM practice_quizzes WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(userId, Math.min(Math.max(limit, 1), 200)) as PracticeQuiz[];
}

// ============================================================
// 13.12 — Quiz attempt + error analysis
// ============================================================

export function submitQuizAttempt(input: {
  quiz_id: string;
  user_id: string;
  answers: number[];        // selected option index per question
  duration_seconds?: number | null;
}): QuizAttempt {
  const quiz = getQuiz(input.quiz_id);
  if (!quiz) throw new Error('Quiz not found');
  if (quiz.user_id !== input.user_id) throw new Error('Not your quiz');

  const questions = JSON.parse(quiz.questions_json) as Array<{ correct_index: number; question: string; explanation: string | null }>;
  let score = 0;
  const errorAnalysis: Array<{ index: number; question: string; correct: number; given: number | null }> = [];

  for (let i = 0; i < questions.length; i++) {
    const given = input.answers[i] ?? null;
    if (given === questions[i].correct_index) score += 1;
    else errorAnalysis.push({
      index: i + 1, question: questions[i].question,
      correct: questions[i].correct_index, given,
    });
  }

  const percent = Math.round((score / questions.length) * 100);
  const feedback = percent >= 80 ? 'Excellent! Keep it up.'
    : percent >= 50 ? 'Good — review the missed questions.'
    : 'Needs improvement — revisit the topic.';

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO quiz_attempts (id, quiz_id, user_id, answers_json, score, total, percent,
      error_analysis_json, feedback, duration_seconds, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.quiz_id, input.user_id, JSON.stringify(input.answers),
    score, questions.length, percent,
    JSON.stringify(errorAnalysis), feedback,
    input.duration_seconds ?? null, now);
  return getQuizAttempt(id)!;
}

export function getQuizAttempt(id: string): QuizAttempt | null {
  return (getDb().prepare('SELECT * FROM quiz_attempts WHERE id = ?').get(id) as QuizAttempt | undefined) ?? null;
}

export function listUserQuizAttempts(userId: string, limit = 50): QuizAttempt[] {
  return getDb().prepare(
    'SELECT * FROM quiz_attempts WHERE user_id = ? ORDER BY completed_at DESC LIMIT ?'
  ).all(userId, Math.min(Math.max(limit, 1), 200)) as QuizAttempt[];
}

// ============================================================
// 13.13 — Learning Progress
// ============================================================

export function getLearningProgress(userId: string, subjectId?: string | null): LearningProgress {
  const db = getDb();
  const subjectFilter = subjectId ? 'AND subject_id = ?' : '';
  const params: any[] = subjectId ? [userId, subjectId] : [userId];

  const totalQ = (db.prepare(
    `SELECT COUNT(*) as n FROM tutor_questions WHERE user_id = ? ${subjectFilter}`
  ).get(...params) as { n: number }).n;
  const resolvedQ = (db.prepare(
    `SELECT COUNT(*) as n FROM tutor_questions WHERE user_id = ? ${subjectFilter} AND status IN ('ai_answered','teacher_answered','closed')`
  ).get(...params) as { n: number }).n;
  const escalatedQ = (db.prepare(
    `SELECT COUNT(*) as n FROM tutor_questions WHERE user_id = ? ${subjectFilter} AND status = 'teacher_review'`
  ).get(...params) as { n: number }).n;

  const quizzesTaken = (db.prepare(
    'SELECT COUNT(*) as n FROM quiz_attempts WHERE user_id = ?'
  ).get(userId) as { n: number }).n;
  const avgScore = (db.prepare(
    'SELECT COALESCE(AVG(percent), 0) as avg FROM quiz_attempts WHERE user_id = ?'
  ).get(userId) as { avg: number }).avg;

  const lastActivity = (db.prepare(`
    SELECT MAX(ts) as last_ts FROM (
      SELECT MAX(created_at) as ts FROM tutor_questions WHERE user_id = ?
      UNION ALL
      SELECT MAX(completed_at) as ts FROM quiz_attempts WHERE user_id = ?
    )
  `).get(userId, userId) as { last_ts: string | null }).last_ts ?? new Date().toISOString();

  return {
    user_id: userId,
    subject_id: subjectId ?? null,
    total_questions: totalQ,
    resolved_questions: resolvedQ,
    escalated_questions: escalatedQ,
    quizzes_taken: quizzesTaken,
    avg_quiz_score: Math.round(avgScore),
    last_activity_at: lastActivity,
  };
}

// ============================================================
// AI provider status (for UI hints)
// ============================================================

export function getAiProviderStatus(): { available: boolean; provider: AiProvider | null; providers: Array<{ name: AiProvider; ready: boolean }> } {
  const active = getActiveProvider();
  return {
    available: !!active,
    provider: active?.provider ?? null,
    providers: [
      { name: 'openai', ready: isIntegrationReady('openai') },
      { name: 'anthropic', ready: isIntegrationReady('anthropic') },
      { name: 'gemini', ready: isIntegrationReady('gemini') },
    ],
  };
}
