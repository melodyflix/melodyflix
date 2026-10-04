// melodyflix videos — AI Content Generation (Section 13.16-13.19)
// Lesson Generator, Study Notes, Question Bank, Personalized Study Plan.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';
import {
  getIntegrationConfigRaw, isIntegrationReady,
} from './integration-settings.service.js';

export type ContentStatus = 'draft' | 'review' | 'published' | 'archived';
export type NoteStyle = 'summary' | 'detailed' | 'bullet' | 'flashcard';
export type QuestionType = 'mcq' | 'true_false' | 'fill_blank' | 'short_answer' | 'long_answer';
export type PlanStatus = 'active' | 'completed' | 'paused';

export interface GeneratedLesson {
  id: string;
  topic_id: string;
  level_id: string | null;
  subject_id: string | null;
  title: string;
  content_markdown: string;
  objectives_json: string | null;
  key_points_json: string | null;
  examples_json: string | null;
  estimated_minutes: number;
  language: string;
  generated_by: string;
  provider: string | null;
  model: string | null;
  status: ContentStatus;
  created_at: string;
  updated_at: string;
}

export interface StudyNote {
  id: string;
  user_id: string;
  topic_id: string | null;
  lesson_id: string | null;
  subject_id: string | null;
  title: string;
  style: NoteStyle;
  content_markdown: string;
  flashcards_json: string | null;
  language: string;
  is_pinned: number;
  provider: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuestionBankItem {
  id: string;
  level_id: string | null;
  subject_id: string | null;
  topic_id: string | null;
  question_type: QuestionType;
  question: string;
  options_json: string | null;
  correct_answer: string;
  explanation: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  marks: number;
  tags: string | null;
  language: string;
  generated_by: string | null;
  provider: string | null;
  status: ContentStatus;
  created_at: string;
  updated_at: string;
}

export interface StudyPlanItem {
  week: number;
  day: number;
  topic_id: string | null;
  topic_name: string;
  activity: string;
  duration_minutes: number;
  priority: 'low' | 'medium' | 'high';
}

export interface StudyPlan {
  id: string;
  user_id: string;
  level_id: string | null;
  subject_id: string | null;
  title: string;
  goal: string;
  duration_days: number;
  plan_json: string;
  status: PlanStatus;
  progress_percent: number;
  provider: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Schema
// ============================================================

export function ensureAiContentGenSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS generated_lessons (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL,
      level_id TEXT,
      subject_id TEXT,
      title TEXT NOT NULL,
      content_markdown TEXT NOT NULL,
      objectives_json TEXT,
      key_points_json TEXT,
      examples_json TEXT,
      estimated_minutes INTEGER NOT NULL DEFAULT 0,
      language TEXT NOT NULL DEFAULT 'en',
      generated_by TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gl_topic ON generated_lessons(topic_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_gl_status ON generated_lessons(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS study_notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      topic_id TEXT,
      lesson_id TEXT,
      subject_id TEXT,
      title TEXT NOT NULL,
      style TEXT NOT NULL DEFAULT 'summary',
      content_markdown TEXT NOT NULL,
      flashcards_json TEXT,
      language TEXT NOT NULL DEFAULT 'en',
      is_pinned INTEGER NOT NULL DEFAULT 0,
      provider TEXT,
      model TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sn_user ON study_notes(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sn_topic ON study_notes(topic_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS question_bank (
      id TEXT PRIMARY KEY,
      level_id TEXT,
      subject_id TEXT,
      topic_id TEXT,
      question_type TEXT NOT NULL DEFAULT 'mcq',
      question TEXT NOT NULL,
      options_json TEXT,
      correct_answer TEXT NOT NULL,
      explanation TEXT,
      difficulty TEXT NOT NULL DEFAULT 'medium',
      marks INTEGER NOT NULL DEFAULT 1,
      tags TEXT,
      language TEXT NOT NULL DEFAULT 'en',
      generated_by TEXT,
      provider TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_qb_topic ON question_bank(topic_id, difficulty);
    CREATE INDEX IF NOT EXISTS idx_qb_subject ON question_bank(subject_id, difficulty);
    CREATE INDEX IF NOT EXISTS idx_qb_type ON question_bank(question_type, status);

    CREATE TABLE IF NOT EXISTS study_plans (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      level_id TEXT,
      subject_id TEXT,
      title TEXT NOT NULL,
      goal TEXT NOT NULL,
      duration_days INTEGER NOT NULL,
      plan_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      progress_percent INTEGER NOT NULL DEFAULT 0,
      provider TEXT,
      model TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sp_user ON study_plans(user_id, status, created_at DESC);
  `);
}

// ============================================================
// AI provider (shared)
// ============================================================

interface ProviderConfig {
  provider: 'openai' | 'anthropic' | 'gemini';
  api_key: string;
  model: string;
  base_url?: string;
}

function getActiveProvider(): ProviderConfig | null {
  const order: Array<'openai' | 'anthropic' | 'gemini'> = ['openai', 'anthropic', 'gemini'];
  for (const p of order) {
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

const TIMEOUT_MS = 45000;

async function callAi(provider: ProviderConfig, system: string, user: string): Promise<{ text: string; tokens: number }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    if (provider.provider === 'openai') {
      const baseUrl = provider.base_url ?? 'https://api.openai.com/v1';
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.api_key}` },
        body: JSON.stringify({
          model: provider.model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          temperature: 0.4,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new Error(`OpenAI ${res.status}: ${err.slice(0, 200)}`);
      }
      const data = await res.json() as any;
      return { text: data.choices?.[0]?.message?.content ?? '', tokens: data.usage?.total_tokens ?? 0 };
    }
    if (provider.provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': provider.api_key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: provider.model, max_tokens: 4096, system, messages: [{ role: 'user', content: user }] }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new Error(`Anthropic ${res.status}: ${err.slice(0, 200)}`);
      }
      const data = await res.json() as any;
      return { text: data.content?.[0]?.text ?? '', tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0) };
    }
    // gemini
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent?key=${provider.api_key}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Gemini ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = await res.json() as any;
    return { text: data.candidates?.[0]?.content?.parts?.[0]?.text ?? '', tokens: data.usageMetadata?.totalTokenCount ?? 0 };
  } finally { clearTimeout(t); }
}

function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, ''));
  } catch { return null; }
}

// ============================================================
// 13.16 — Lesson Generator
// ============================================================

export async function generateLesson(input: {
  topic_id: string;
  level_id?: string | null;
  subject_id?: string | null;
  topic_name: string;
  subject_name?: string | null;
  level_name?: string | null;
  language?: string;
  generated_by: string;
  target_minutes?: number;
}): Promise<GeneratedLesson> {
  const provider = getActiveProvider();
  if (!provider) throw new Error('No AI provider configured — set OpenAI/Anthropic/Gemini in admin panel > Integrations');
  if (!input.topic_name || input.topic_name.length < 2) throw new Error('topic_name required');

  const system = 'You are an expert curriculum designer. Generate structured lesson content in JSON.';
  const prompt = `Generate a lesson for:
- Level: ${input.level_name ?? 'general'}
- Subject: ${input.subject_name ?? 'general'}
- Topic: ${input.topic_name}
- Language: ${input.language ?? 'en'}
- Target duration: ${input.target_minutes ?? 30} minutes

Return JSON: {
  "title": "...",
  "content_markdown": "## Overview\\n...",
  "objectives": ["..."],
  "key_points": ["..."],
  "examples": ["..."],
  "estimated_minutes": 30
}`;

  const { text } = await callAi(provider, system, prompt);
  const parsed = safeJsonParse(text);
  if (!parsed || !parsed.content_markdown) throw new Error('AI returned invalid lesson format');

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO generated_lessons
      (id, topic_id, level_id, subject_id, title, content_markdown, objectives_json,
       key_points_json, examples_json, estimated_minutes, language, generated_by,
       provider, model, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
  `).run(id, input.topic_id, input.level_id ?? null, input.subject_id ?? null,
    String(parsed.title ?? input.topic_name).slice(0, 200),
    String(parsed.content_markdown).slice(0, 100000),
    parsed.objectives ? JSON.stringify(parsed.objectives) : null,
    parsed.key_points ? JSON.stringify(parsed.key_points) : null,
    parsed.examples ? JSON.stringify(parsed.examples) : null,
    Math.min(Math.max(parseInt(parsed.estimated_minutes) || 30, 1), 300),
    input.language ?? 'en', input.generated_by,
    provider.provider, provider.model, now, now);

  return getGeneratedLesson(id)!;
}

export function getGeneratedLesson(id: string): GeneratedLesson | null {
  return (getDb().prepare('SELECT * FROM generated_lessons WHERE id = ?').get(id) as GeneratedLesson | undefined) ?? null;
}

export function listGeneratedLessons(opts: { topic_id?: string; status?: ContentStatus; limit?: number } = {}): GeneratedLesson[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const filters: string[] = [];
  const params: any[] = [];
  if (opts.topic_id) { filters.push('topic_id = ?'); params.push(opts.topic_id); }
  if (opts.status) { filters.push('status = ?'); params.push(opts.status); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  params.push(limit);
  return db.prepare(
    `SELECT * FROM generated_lessons ${where} ORDER BY created_at DESC LIMIT ?`
  ).all(...params) as GeneratedLesson[];
}

export function updateGeneratedLessonStatus(id: string, status: ContentStatus, requesterId: string, isAdmin: boolean): GeneratedLesson {
  const db = getDb();
  const lesson = getGeneratedLesson(id);
  if (!lesson) throw new Error('Lesson not found');
  if (!isAdmin && lesson.generated_by !== requesterId) throw new Error('Not authorized');
  db.prepare('UPDATE generated_lessons SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, new Date().toISOString(), id);
  return getGeneratedLesson(id)!;
}

export function deleteGeneratedLesson(id: string, requesterId: string, isAdmin: boolean): boolean {
  const db = getDb();
  const lesson = getGeneratedLesson(id);
  if (!lesson) return false;
  if (!isAdmin && lesson.generated_by !== requesterId) throw new Error('Not authorized');
  return Number(db.prepare('DELETE FROM generated_lessons WHERE id = ?').run(id).changes ?? 0) > 0;
}

// ============================================================
// 13.17 — Study Notes
// ============================================================

export async function generateStudyNotes(input: {
  user_id: string;
  topic_id?: string | null;
  lesson_id?: string | null;
  subject_id?: string | null;
  topic_name: string;
  style?: NoteStyle;
  language?: string;
  source_text?: string | null;
}): Promise<StudyNote> {
  const provider = getActiveProvider();
  if (!provider) throw new Error('No AI provider configured');

  const style = input.style ?? 'summary';
  const system = 'You are a study assistant. Create clear, memorable study notes in JSON.';
  const prompt = `Create ${style} study notes for topic: ${input.topic_name}
Language: ${input.language ?? 'en'}
${input.source_text ? `Source material:\n${input.source_text.slice(0, 6000)}` : ''}

Return JSON:
{
  "title": "...",
  "content_markdown": "## Notes\\n...",
  "flashcards": [{"q": "...", "a": "..."}]
}`;

  const { text } = await callAi(provider, system, prompt);
  const parsed = safeJsonParse(text);
  if (!parsed || !parsed.content_markdown) throw new Error('AI returned invalid notes format');

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO study_notes
      (id, user_id, topic_id, lesson_id, subject_id, title, style, content_markdown,
       flashcards_json, language, is_pinned, provider, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
  `).run(id, input.user_id, input.topic_id ?? null, input.lesson_id ?? null,
    input.subject_id ?? null, String(parsed.title ?? input.topic_name).slice(0, 200),
    style, String(parsed.content_markdown).slice(0, 100000),
    parsed.flashcards ? JSON.stringify(parsed.flashcards) : null,
    input.language ?? 'en', provider.provider, provider.model, now, now);
  return getStudyNote(id)!;
}

export function getStudyNote(id: string): StudyNote | null {
  return (getDb().prepare('SELECT * FROM study_notes WHERE id = ?').get(id) as StudyNote | undefined) ?? null;
}

export function listUserNotes(userId: string, opts: { topic_id?: string; pinned_only?: boolean; limit?: number } = {}): StudyNote[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const filters: string[] = ['user_id = ?'];
  const params: any[] = [userId];
  if (opts.topic_id) { filters.push('topic_id = ?'); params.push(opts.topic_id); }
  if (opts.pinned_only) filters.push('is_pinned = 1');
  params.push(limit);
  return db.prepare(
    `SELECT * FROM study_notes WHERE ${filters.join(' AND ')} ORDER BY is_pinned DESC, created_at DESC LIMIT ?`
  ).all(...params) as StudyNote[];
}

export function pinStudyNote(id: string, userId: string, pinned: boolean): StudyNote {
  const db = getDb();
  const note = getStudyNote(id);
  if (!note) throw new Error('Note not found');
  if (note.user_id !== userId) throw new Error('Not your note');
  db.prepare('UPDATE study_notes SET is_pinned = ?, updated_at = ? WHERE id = ?')
    .run(pinned ? 1 : 0, new Date().toISOString(), id);
  return getStudyNote(id)!;
}

export function deleteStudyNote(id: string, userId: string): boolean {
  const db = getDb();
  const note = getStudyNote(id);
  if (!note) return false;
  if (note.user_id !== userId) throw new Error('Not your note');
  return Number(db.prepare('DELETE FROM study_notes WHERE id = ?').run(id).changes ?? 0) > 0;
}

// ============================================================
// 13.18 — Question Bank
// ============================================================

export async function generateQuestions(input: {
  topic_id?: string | null;
  level_id?: string | null;
  subject_id?: string | null;
  topic_name: string;
  count?: number;
  types?: QuestionType[];
  difficulty?: 'easy' | 'medium' | 'hard';
  language?: string;
  generated_by: string;
}): Promise<QuestionBankItem[]> {
  const provider = getActiveProvider();
  if (!provider) throw new Error('No AI provider configured');

  const count = Math.min(Math.max(input.count ?? 10, 1), 50);
  const types = input.types ?? ['mcq'];
  const difficulty = input.difficulty ?? 'medium';
  const system = 'You are an exam question author. Generate well-formed questions in JSON.';
  const prompt = `Generate ${count} ${difficulty} questions on topic "${input.topic_name}".
Types allowed: ${types.join(', ')}
Language: ${input.language ?? 'en'}

Return JSON:
{
  "questions": [
    {
      "question_type": "mcq",
      "question": "...",
      "options": ["A", "B", "C", "D"],
      "correct_answer": "A",
      "explanation": "...",
      "marks": 1
    }
  ]
}`;

  const { text } = await callAi(provider, system, prompt);
  const parsed = safeJsonParse(text);
  if (!parsed || !Array.isArray(parsed.questions)) throw new Error('AI returned invalid question format');

  const db = getDb();
  const now = new Date().toISOString();
  const inserted: QuestionBankItem[] = [];
  db.exec('BEGIN');
  try {
    for (const q of parsed.questions.slice(0, count)) {
      if (!q.question || !q.correct_answer) continue;
      const id = randomUUID();
      const qtype: QuestionType = types.includes(q.question_type) ? q.question_type : types[0];
      db.prepare(`
        INSERT INTO question_bank
          (id, level_id, subject_id, topic_id, question_type, question, options_json,
           correct_answer, explanation, difficulty, marks, tags, language, generated_by,
           provider, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'draft', ?, ?)
      `).run(id, input.level_id ?? null, input.subject_id ?? null, input.topic_id ?? null,
        qtype, String(q.question).slice(0, 5000),
        Array.isArray(q.options) ? JSON.stringify(q.options) : null,
        String(q.correct_answer).slice(0, 2000),
        q.explanation ? String(q.explanation).slice(0, 5000) : null,
        difficulty, Math.min(Math.max(parseInt(q.marks) || 1, 1), 100),
        input.language ?? 'en', input.generated_by,
        provider.provider, now, now);
      inserted.push(getQuestion(id)!);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return inserted;
}

export function getQuestion(id: string): QuestionBankItem | null {
  return (getDb().prepare('SELECT * FROM question_bank WHERE id = ?').get(id) as QuestionBankItem | undefined) ?? null;
}

export function listBankQuestions(opts: {
  topic_id?: string; subject_id?: string; level_id?: string;
  question_type?: QuestionType; difficulty?: string; status?: ContentStatus;
  limit?: number; offset?: number;
} = {}): { questions: QuestionBankItem[]; total: number } {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const filters: string[] = [];
  const params: any[] = [];
  if (opts.topic_id) { filters.push('topic_id = ?'); params.push(opts.topic_id); }
  if (opts.subject_id) { filters.push('subject_id = ?'); params.push(opts.subject_id); }
  if (opts.level_id) { filters.push('level_id = ?'); params.push(opts.level_id); }
  if (opts.question_type) { filters.push('question_type = ?'); params.push(opts.question_type); }
  if (opts.difficulty) { filters.push('difficulty = ?'); params.push(opts.difficulty); }
  if (opts.status) { filters.push('status = ?'); params.push(opts.status); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) as n FROM question_bank ${where}`).get(...params) as { n: number }).n;
  const questions = db.prepare(
    `SELECT * FROM question_bank ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as QuestionBankItem[];
  return { questions, total };
}

export function updateQuestionStatus(id: string, status: ContentStatus, requesterId: string, isAdmin: boolean): QuestionBankItem {
  const db = getDb();
  const q = getQuestion(id);
  if (!q) throw new Error('Question not found');
  if (!isAdmin && q.generated_by !== requesterId) throw new Error('Not authorized');
  db.prepare('UPDATE question_bank SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, new Date().toISOString(), id);
  return getQuestion(id)!;
}

export function deleteQuestion(id: string, requesterId: string, isAdmin: boolean): boolean {
  const db = getDb();
  const q = getQuestion(id);
  if (!q) return false;
  if (!isAdmin && q.generated_by !== requesterId) throw new Error('Not authorized');
  return Number(db.prepare('DELETE FROM question_bank WHERE id = ?').run(id).changes ?? 0) > 0;
}

// ============================================================
// 13.19 — Personalized Study Plan
// ============================================================

export async function generateStudyPlan(input: {
  user_id: string;
  level_id?: string | null;
  subject_id?: string | null;
  goal: string;
  duration_days?: number;
  topics?: string[];
  weak_areas?: string[];
  hours_per_day?: number;
  language?: string;
}): Promise<StudyPlan> {
  const provider = getActiveProvider();
  if (!provider) throw new Error('No AI provider configured');
  const goal = (input.goal ?? '').trim();
  if (goal.length < 3 || goal.length > 500) throw new Error('goal must be 3-500 chars');
  const days = Math.min(Math.max(input.duration_days ?? 30, 1), 365);

  const system = 'You are a study coach. Create realistic day-by-day study plans in JSON.';
  const prompt = `Create a ${days}-day personalized study plan.
Goal: ${goal}
${input.topics?.length ? `Topics to cover: ${input.topics.slice(0, 30).join(', ')}` : ''}
${input.weak_areas?.length ? `Weak areas to focus: ${input.weak_areas.slice(0, 10).join(', ')}` : ''}
Daily study time: ${input.hours_per_day ?? 2} hours
Language: ${input.language ?? 'en'}

Return JSON:
{
  "title": "...",
  "plan": [
    { "week": 1, "day": 1, "topic_name": "...", "activity": "...", "duration_minutes": 60, "priority": "high" }
  ]
}`;

  const { text } = await callAi(provider, system, prompt);
  const parsed = safeJsonParse(text);
  if (!parsed || !Array.isArray(parsed.plan)) throw new Error('AI returned invalid plan format');

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const items: StudyPlanItem[] = parsed.plan.slice(0, 365).map((it: any) => ({
    week: Math.max(1, parseInt(it.week) || 1),
    day: Math.max(1, parseInt(it.day) || 1),
    topic_id: it.topic_id ?? null,
    topic_name: String(it.topic_name ?? 'Study session').slice(0, 200),
    activity: String(it.activity ?? '').slice(0, 1000),
    duration_minutes: Math.min(Math.max(parseInt(it.duration_minutes) || 60, 5), 600),
    priority: (['low', 'medium', 'high'].includes(it.priority) ? it.priority : 'medium'),
  }));

  db.prepare(`
    INSERT INTO study_plans
      (id, user_id, level_id, subject_id, title, goal, duration_days, plan_json,
       status, progress_percent, provider, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, ?)
  `).run(id, input.user_id, input.level_id ?? null, input.subject_id ?? null,
    String(parsed.title ?? 'Study Plan').slice(0, 200), goal, days,
    JSON.stringify(items), provider.provider, provider.model, now, now);
  return getStudyPlan(id)!;
}

export function getStudyPlan(id: string): StudyPlan | null {
  return (getDb().prepare('SELECT * FROM study_plans WHERE id = ?').get(id) as StudyPlan | undefined) ?? null;
}

export function listUserPlans(userId: string, opts: { status?: PlanStatus; limit?: number } = {}): StudyPlan[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const filters: string[] = ['user_id = ?'];
  const params: any[] = [userId];
  if (opts.status) { filters.push('status = ?'); params.push(opts.status); }
  params.push(limit);
  return db.prepare(
    `SELECT * FROM study_plans WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT ?`
  ).all(...params) as StudyPlan[];
}

export function updatePlanProgress(id: string, userId: string, percent: number): StudyPlan {
  const db = getDb();
  const plan = getStudyPlan(id);
  if (!plan) throw new Error('Plan not found');
  if (plan.user_id !== userId) throw new Error('Not your plan');
  const p = Math.min(Math.max(Math.round(percent), 0), 100);
  const status: PlanStatus = p >= 100 ? 'completed' : plan.status;
  db.prepare('UPDATE study_plans SET progress_percent = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(p, status, new Date().toISOString(), id);
  return getStudyPlan(id)!;
}

export function deleteStudyPlan(id: string, userId: string): boolean {
  const db = getDb();
  const plan = getStudyPlan(id);
  if (!plan) return false;
  if (plan.user_id !== userId) throw new Error('Not your plan');
  return Number(db.prepare('DELETE FROM study_plans WHERE id = ?').run(id).changes ?? 0) > 0;
}
