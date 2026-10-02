// melodyflix videos - video quizzes (question + options + correct answer)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export interface QuizOption {
  id: string;
  text: string;
  order_index: number;
  response_count: number;
}

export interface Quiz {
  id: string;
  video_id: string;
  question: string;
  explanation: string | null;
  is_closed: number;
  created_at: string;
  closes_at: string | null;
  options: QuizOption[];
  total_responses: number;
  correct_count: number;
  user_response_option_id: string | null;
  user_was_correct: number | null;
  correct_option_id: string | null; // revealed only after user answers or quiz closed
}

export function ensureQuizSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_quizzes (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      question TEXT NOT NULL,
      explanation TEXT,
      correct_option_index INTEGER NOT NULL DEFAULT 0,
      is_closed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      closes_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_quizzes_video ON video_quizzes(video_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS quiz_options (
      id TEXT PRIMARY KEY,
      quiz_id TEXT NOT NULL,
      text TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      is_correct INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_quiz_options_quiz ON quiz_options(quiz_id, order_index);

    CREATE TABLE IF NOT EXISTS quiz_responses (
      id TEXT PRIMARY KEY,
      quiz_id TEXT NOT NULL,
      option_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE (quiz_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_quiz_responses_quiz ON quiz_responses(quiz_id);
  `);
}

interface QuizRow {
  id: string;
  video_id: string;
  question: string;
  explanation: string | null;
  is_closed: number;
  created_at: string;
  closes_at: string | null;
}

function loadQuiz(quizId: string, currentUserId: string | null): Quiz | null {
  const db = getDb();
  const quiz = db.prepare('SELECT * FROM video_quizzes WHERE id = ?').get(quizId) as QuizRow | undefined;
  if (!quiz) return null;

  const options = db.prepare(
    'SELECT o.id, o.text, o.order_index, ' +
    '(SELECT COUNT(*) FROM quiz_responses r WHERE r.option_id = o.id) as response_count ' +
    'FROM quiz_options o WHERE o.quiz_id = ? ORDER BY o.order_index ASC'
  ).all(quizId) as QuizOption[];

  const total = db.prepare('SELECT COUNT(*) as n FROM quiz_responses WHERE quiz_id = ?').get(quizId) as { n: number };
  const correct = db.prepare('SELECT COUNT(*) as n FROM quiz_responses WHERE quiz_id = ? AND is_correct = 1').get(quizId) as { n: number };

  let userResponse: { option_id: string; is_correct: number } | null = null;
  if (currentUserId) {
    const r = db.prepare('SELECT option_id, is_correct FROM quiz_responses WHERE quiz_id = ? AND user_id = ?')
      .get(quizId, currentUserId) as { option_id: string; is_correct: number } | undefined;
    userResponse = r ?? null;
  }

  const correctOption = db.prepare('SELECT id FROM quiz_options WHERE quiz_id = ? AND is_correct = 1').get(quizId) as { id: string } | undefined;

  // Reveal correct answer only if user already responded or quiz closed
  const reveal = quiz.is_closed === 1 || !!userResponse;

  return {
    id: quiz.id,
    video_id: quiz.video_id,
    question: quiz.question,
    explanation: quiz.explanation,
    is_closed: quiz.is_closed,
    created_at: quiz.created_at,
    closes_at: quiz.closes_at,
    options,
    total_responses: total.n,
    correct_count: correct.n,
    user_response_option_id: userResponse?.option_id ?? null,
    user_was_correct: userResponse?.is_correct ?? null,
    correct_option_id: reveal ? (correctOption?.id ?? null) : null,
  };
}

export function getQuizForVideo(videoId: string, currentUserId: string | null): Quiz | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT id FROM video_quizzes WHERE video_id = ? AND is_closed = 0 ORDER BY created_at DESC LIMIT 1'
  ).get(videoId) as { id: string } | undefined;
  if (!row) return null;
  return loadQuiz(row.id, currentUserId);
}

export function getQuiz(quizId: string, currentUserId: string | null): Quiz | null {
  return loadQuiz(quizId, currentUserId);
}

export function createQuiz(
  videoId: string,
  question: string,
  optionTexts: string[],
  correctIndex: number,
  explanation: string | null,
  closesAt: string | null,
): Quiz {
  const db = getDb();
  if (!question.trim()) throw new Error('Question is required');
  const cleaned = optionTexts.map((t) => t.trim()).filter((t) => t.length > 0);
  if (cleaned.length < 2) throw new Error('At least 2 options are required');
  if (cleaned.length > 8) throw new Error('Maximum 8 options');
  if (correctIndex < 0 || correctIndex >= cleaned.length) throw new Error('Invalid correct option index');

  const quizId = randomUUID();
  const now = new Date().toISOString();

  db.prepare('UPDATE video_quizzes SET is_closed = 1 WHERE video_id = ? AND is_closed = 0').run(videoId);

  db.prepare(
    'INSERT INTO video_quizzes (id, video_id, question, explanation, correct_option_index, is_closed, created_at, closes_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)'
  ).run(quizId, videoId, question.trim(), explanation, correctIndex, now, closesAt);

  const insertOpt = db.prepare('INSERT INTO quiz_options (id, quiz_id, text, order_index, is_correct) VALUES (?, ?, ?, ?, ?)');
  cleaned.forEach((text, idx) => {
    insertOpt.run(randomUUID(), quizId, text, idx, idx === correctIndex ? 1 : 0);
  });

  return loadQuiz(quizId, null)!;
}

export function answerQuiz(quizId: string, optionId: string, userId: string): Quiz {
  const db = getDb();
  const quiz = db.prepare('SELECT id, is_closed, closes_at FROM video_quizzes WHERE id = ?')
    .get(quizId) as { id: string; is_closed: number; closes_at: string | null } | undefined;
  if (!quiz) throw new Error('Quiz not found');
  if (quiz.is_closed === 1) throw new Error('Quiz is closed');
  if (quiz.closes_at && new Date(quiz.closes_at).getTime() < Date.now()) {
    throw new Error('Quiz has expired');
  }

  const option = db.prepare('SELECT id, is_correct FROM quiz_options WHERE id = ? AND quiz_id = ?')
    .get(optionId, quizId) as { id: string; is_correct: number } | undefined;
  if (!option) throw new Error('Invalid option');

  const existing = db.prepare('SELECT id FROM quiz_responses WHERE quiz_id = ? AND user_id = ?')
    .get(quizId, userId) as { id: string } | undefined;
  if (existing) throw new Error('You have already answered this quiz');

  db.prepare('INSERT INTO quiz_responses (id, quiz_id, option_id, user_id, is_correct, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), quizId, optionId, userId, option.is_correct, new Date().toISOString());

  return loadQuiz(quizId, userId)!;
}

export function closeQuiz(quizId: string): void {
  const db = getDb();
  db.prepare('UPDATE video_quizzes SET is_closed = 1 WHERE id = ?').run(quizId);
}

export function deleteQuiz(quizId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM quiz_responses WHERE quiz_id = ?').run(quizId);
  db.prepare('DELETE FROM quiz_options WHERE quiz_id = ?').run(quizId);
  db.prepare('DELETE FROM video_quizzes WHERE id = ?').run(quizId);
}
