// melodyflix videos - video polls (question + options + votes)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export interface PollOption {
  id: string;
  text: string;
  order_index: number;
  vote_count: number;
}

export interface Poll {
  id: string;
  video_id: string;
  question: string;
  is_closed: number;
  created_at: string;
  closes_at: string | null;
  options: PollOption[];
  total_votes: number;
  user_vote_option_id: string | null;
}

export function ensurePollSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_polls (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      question TEXT NOT NULL,
      is_closed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      closes_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_polls_video ON video_polls(video_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS poll_options (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL,
      text TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_poll_options_poll ON poll_options(poll_id, order_index);

    CREATE TABLE IF NOT EXISTS poll_votes (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL,
      option_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (poll_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON poll_votes(poll_id);
  `);
}

interface PollRow {
  id: string;
  video_id: string;
  question: string;
  is_closed: number;
  created_at: string;
  closes_at: string | null;
}

function loadPoll(pollId: string, currentUserId: string | null): Poll | null {
  const db = getDb();
  const poll = db.prepare('SELECT * FROM video_polls WHERE id = ?').get(pollId) as PollRow | undefined;
  if (!poll) return null;

  const options = db.prepare(
    'SELECT o.id, o.text, o.order_index, ' +
    '(SELECT COUNT(*) FROM poll_votes v WHERE v.option_id = o.id) as vote_count ' +
    'FROM poll_options o WHERE o.poll_id = ? ORDER BY o.order_index ASC'
  ).all(pollId) as PollOption[];

  const total = db.prepare('SELECT COUNT(*) as n FROM poll_votes WHERE poll_id = ?').get(pollId) as { n: number };

  let userVote: string | null = null;
  if (currentUserId) {
    const v = db.prepare('SELECT option_id FROM poll_votes WHERE poll_id = ? AND user_id = ?')
      .get(pollId, currentUserId) as { option_id: string } | undefined;
    userVote = v?.option_id ?? null;
  }

  return {
    id: poll.id,
    video_id: poll.video_id,
    question: poll.question,
    is_closed: poll.is_closed,
    created_at: poll.created_at,
    closes_at: poll.closes_at,
    options,
    total_votes: total.n,
    user_vote_option_id: userVote,
  };
}

export function getPollForVideo(videoId: string, currentUserId: string | null): Poll | null {
  const db = getDb();
  // Return the most recent active poll for this video
  const row = db.prepare(
    'SELECT id FROM video_polls WHERE video_id = ? AND is_closed = 0 ORDER BY created_at DESC LIMIT 1'
  ).get(videoId) as { id: string } | undefined;
  if (!row) return null;
  return loadPoll(row.id, currentUserId);
}

export function getPoll(pollId: string, currentUserId: string | null): Poll | null {
  return loadPoll(pollId, currentUserId);
}

export function createPoll(
  videoId: string,
  question: string,
  optionTexts: string[],
  closesAt: string | null,
): Poll {
  const db = getDb();
  if (!question.trim()) throw new Error('Question is required');
  const cleaned = optionTexts.map((t) => t.trim()).filter((t) => t.length > 0);
  if (cleaned.length < 2) throw new Error('At least 2 options are required');
  if (cleaned.length > 8) throw new Error('Maximum 8 options');

  const pollId = randomUUID();
  const now = new Date().toISOString();

  // Close any existing open poll for this video
  db.prepare('UPDATE video_polls SET is_closed = 1 WHERE video_id = ? AND is_closed = 0').run(videoId);

  db.prepare(
    'INSERT INTO video_polls (id, video_id, question, is_closed, created_at, closes_at) VALUES (?, ?, ?, 0, ?, ?)'
  ).run(pollId, videoId, question.trim(), now, closesAt);

  const insertOpt = db.prepare('INSERT INTO poll_options (id, poll_id, text, order_index) VALUES (?, ?, ?, ?)');
  cleaned.forEach((text, idx) => {
    insertOpt.run(randomUUID(), pollId, text, idx);
  });

  return loadPoll(pollId, null)!;
}

export function votePoll(pollId: string, optionId: string, userId: string): Poll {
  const db = getDb();
  const poll = db.prepare('SELECT id, is_closed, closes_at FROM video_polls WHERE id = ?')
    .get(pollId) as { id: string; is_closed: number; closes_at: string | null } | undefined;
  if (!poll) throw new Error('Poll not found');
  if (poll.is_closed === 1) throw new Error('Poll is closed');
  if (poll.closes_at && new Date(poll.closes_at).getTime() < Date.now()) {
    throw new Error('Poll has expired');
  }

  const option = db.prepare('SELECT id FROM poll_options WHERE id = ? AND poll_id = ?')
    .get(optionId, pollId) as { id: string } | undefined;
  if (!option) throw new Error('Invalid option');

  const existing = db.prepare('SELECT id, option_id FROM poll_votes WHERE poll_id = ? AND user_id = ?')
    .get(pollId, userId) as { id: string; option_id: string } | undefined;

  if (existing) {
    if (existing.option_id === optionId) {
      // Already voted this option — no change (or remove vote?)
      // Let's keep it — no double voting
    } else {
      throw new Error('You have already voted');
    }
  } else {
    db.prepare('INSERT INTO poll_votes (id, poll_id, option_id, user_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), pollId, optionId, userId, new Date().toISOString());
  }

  return loadPoll(pollId, userId)!;
}

export function closePoll(pollId: string): void {
  const db = getDb();
  db.prepare('UPDATE video_polls SET is_closed = 1 WHERE id = ?').run(pollId);
}

export function deletePoll(pollId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM poll_votes WHERE poll_id = ?').run(pollId);
  db.prepare('DELETE FROM poll_options WHERE poll_id = ?').run(pollId);
  db.prepare('DELETE FROM video_polls WHERE id = ?').run(pollId);
}
