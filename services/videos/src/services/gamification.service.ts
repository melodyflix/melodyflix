// melodyflix videos - Section 36 Gamification
// Points ledger, challenges/missions, rewards redemption, daily streaks.
// Reuses existing tables: badges, user_badges, user_scores.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type PointSource =
  | 'watch' | 'like' | 'comment' | 'share' | 'upload'
  | 'challenge' | 'streak' | 'bonus' | 'admin' | 'redeem' | 'refund';
export type ChallengeKind = 'watch_minutes' | 'watch_videos' | 'like_count'
  | 'comment_count' | 'share_count' | 'upload_count' | 'streak_days' | 'custom';
export type ChallengeStatus = 'active' | 'expired' | 'archived';
export type UserChallengeStatus = 'in_progress' | 'completed' | 'claimed' | 'expired';
export type RewardKind = 'badge' | 'premium_days' | 'gift_card' | 'custom';
export type RewardRedemptionStatus = 'pending' | 'fulfilled' | 'cancelled' | 'failed';
export type StreakKind = 'daily_watch' | 'daily_login' | 'weekly_upload';

export function ensureGamificationSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS points_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      delta INTEGER NOT NULL,
      source TEXT NOT NULL,
      ref_type TEXT,
      ref_id TEXT,
      note TEXT,
      balance_after INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_points_user ON points_ledger(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_points_source ON points_ledger(source, created_at DESC);

    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      kind TEXT NOT NULL
        CHECK (kind IN ('watch_minutes','watch_videos','like_count','comment_count','share_count','upload_count','streak_days','custom')),
      target_value INTEGER NOT NULL,
      reward_points INTEGER NOT NULL DEFAULT 0,
      reward_badge_slug TEXT,
      starts_at TEXT NOT NULL,
      ends_at TEXT,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','expired','archived')),
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_challenges_status ON challenges(status, ends_at);

    CREATE TABLE IF NOT EXISTS user_challenges (
      user_id TEXT NOT NULL,
      challenge_id TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      target_value INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress','completed','claimed','expired')),
      started_at TEXT NOT NULL,
      completed_at TEXT,
      claimed_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, challenge_id)
    );
    CREATE INDEX IF NOT EXISTS idx_uc_user ON user_challenges(user_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_uc_challenge ON user_challenges(challenge_id, status);

    CREATE TABLE IF NOT EXISTS rewards (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      kind TEXT NOT NULL
        CHECK (kind IN ('badge','premium_days','gift_card','custom')),
      cost_points INTEGER NOT NULL,
      stock INTEGER,
      redeemed_count INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      payload TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rewards_active ON rewards(active, cost_points);

    CREATE TABLE IF NOT EXISTS reward_redemptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      reward_id TEXT NOT NULL,
      cost_points INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','fulfilled','cancelled','failed')),
      note TEXT,
      fulfilled_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rr_user ON reward_redemptions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_rr_reward ON reward_redemptions(reward_id, status);

    CREATE TABLE IF NOT EXISTS user_streaks (
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      current_length INTEGER NOT NULL DEFAULT 0,
      longest_length INTEGER NOT NULL DEFAULT 0,
      last_event_date TEXT,
      last_event_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, kind)
    );
    CREATE INDEX IF NOT EXISTS idx_streaks_kind ON user_streaks(kind, current_length DESC);
  `);
}

// ============================================================
// 36.1 Points System
// ============================================================

export interface PointsEntry {
  id: string;
  user_id: string;
  delta: number;
  source: PointSource;
  ref_type: string | null;
  ref_id: string | null;
  note: string | null;
  balance_after: number;
  created_at: string;
}

function ensureScoreRow(userId: string): number {
  const db = getDb();
  const row = db.prepare('SELECT total_points FROM user_scores WHERE user_id = ?').get(userId) as { total_points: number } | undefined;
  if (row) return row.total_points;
  const now = new Date().toISOString();
  db.prepare('INSERT INTO user_scores (user_id, total_points, badge_count, last_updated) VALUES (?, 0, 0, ?)').run(userId, now);
  return 0;
}

export interface AwardPointsInput {
  user_id: string;
  delta: number;
  source: PointSource;
  ref_type?: string | null;
  ref_id?: string | null;
  note?: string | null;
}

export function awardPoints(input: AwardPointsInput): PointsEntry {
  const db = getDb();
  if (!Number.isFinite(input.delta) || input.delta === 0) throw new Error('invalid_delta');
  const current = ensureScoreRow(input.user_id);
  const next = current + input.delta;
  if (next < 0) throw new Error('insufficient_points');
  const now = new Date().toISOString();
  const id = randomUUID();
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO points_ledger (id, user_id, delta, source, ref_type, ref_id, note, balance_after, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.user_id, input.delta, input.source,
      input.ref_type ?? null, input.ref_id ?? null, input.note ?? null, next, now);
    db.prepare('UPDATE user_scores SET total_points = ?, last_updated = ? WHERE user_id = ?')
      .run(next, now, input.user_id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return db.prepare('SELECT * FROM points_ledger WHERE id = ?').get(id) as PointsEntry;
}

export function getBalance(userId: string): number {
  return ensureScoreRow(userId);
}

export function listPointsHistory(userId: string, limit = 100): PointsEntry[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM points_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(userId, Math.min(Math.max(limit, 1), 500)) as PointsEntry[];
}

export interface LeaderboardRow {
  user_id: string;
  total_points: number;
  badge_count: number;
  rank: number;
}

export function getLeaderboard(limit = 50): LeaderboardRow[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT user_id, total_points, badge_count FROM user_scores ORDER BY total_points DESC LIMIT ?'
  ).all(Math.min(Math.max(limit, 1), 500)) as Array<{ user_id: string; total_points: number; badge_count: number }>;
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

// ============================================================
// 36.2 Challenges / Missions
// ============================================================

export interface Challenge {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  kind: ChallengeKind;
  target_value: number;
  reward_points: number;
  reward_badge_slug: string | null;
  starts_at: string;
  ends_at: string | null;
  status: ChallengeStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserChallenge {
  user_id: string;
  challenge_id: string;
  progress: number;
  target_value: number;
  status: UserChallengeStatus;
  started_at: string;
  completed_at: string | null;
  claimed_at: string | null;
  updated_at: string;
}

export interface CreateChallengeInput {
  slug: string;
  title: string;
  description?: string | null;
  kind: ChallengeKind;
  target_value: number;
  reward_points?: number;
  reward_badge_slug?: string | null;
  starts_at?: string;
  ends_at?: string | null;
}

export function createChallenge(input: CreateChallengeInput, createdBy: string | null): Challenge {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO challenges (id, slug, title, description, kind, target_value, reward_points, reward_badge_slug,
      starts_at, ends_at, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(
    id, input.slug.trim().toLowerCase(), input.title.slice(0, 200),
    input.description ?? null, input.kind, Math.max(1, input.target_value),
    Math.max(0, input.reward_points ?? 0), input.reward_badge_slug ?? null,
    input.starts_at ?? now, input.ends_at ?? null, createdBy, now, now,
  );
  return db.prepare('SELECT * FROM challenges WHERE id = ?').get(id) as Challenge;
}

export function listChallenges(opts: { status?: ChallengeStatus; limit?: number } = {}): Challenge[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  if (opts.status) {
    return db.prepare('SELECT * FROM challenges WHERE status = ? ORDER BY starts_at DESC LIMIT ?').all(opts.status, limit) as Challenge[];
  }
  return db.prepare('SELECT * FROM challenges ORDER BY starts_at DESC LIMIT ?').all(limit) as Challenge[];
}

export function getChallenge(id: string): Challenge | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM challenges WHERE id = ?').get(id) as Challenge | undefined) ?? null;
}

export function getChallengeBySlug(slug: string): Challenge | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM challenges WHERE slug = ?').get(slug.toLowerCase()) as Challenge | undefined) ?? null;
}

function ensureUserChallenge(userId: string, c: Challenge): UserChallenge {
  const db = getDb();
  const row = db.prepare('SELECT * FROM user_challenges WHERE user_id = ? AND challenge_id = ?').get(userId, c.id) as UserChallenge | undefined;
  if (row) return row;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO user_challenges (user_id, challenge_id, progress, target_value, status, started_at, updated_at)
    VALUES (?, ?, 0, ?, 'in_progress', ?, ?)
  `).run(userId, c.id, c.target_value, now, now);
  return db.prepare('SELECT * FROM user_challenges WHERE user_id = ? AND challenge_id = ?').get(userId, c.id) as UserChallenge;
}

export function joinChallenge(userId: string, challengeId: string): UserChallenge {
  const c = getChallenge(challengeId);
  if (!c) throw new Error('challenge_not_found');
  if (c.status !== 'active') throw new Error('challenge_not_active');
  return ensureUserChallenge(userId, c);
}

export interface ProgressInput {
  user_id: string;
  challenge_id?: string;
  slug?: string;
  delta: number;
}

export function recordProgress(input: ProgressInput): UserChallenge {
  const c = input.challenge_id ? getChallenge(input.challenge_id) : (input.slug ? getChallengeBySlug(input.slug) : null);
  if (!c) throw new Error('challenge_not_found');
  const uc = ensureUserChallenge(input.user_id, c);
  if (uc.status !== 'in_progress') return uc;
  const db = getDb();
  const nextProgress = Math.min(uc.target_value, uc.progress + Math.max(0, input.delta));
  const now = new Date().toISOString();
  const done = nextProgress >= uc.target_value;
  db.prepare(`
    UPDATE user_challenges SET progress = ?, status = ?, completed_at = COALESCE(completed_at, ?), updated_at = ?
    WHERE user_id = ? AND challenge_id = ?
  `).run(nextProgress, done ? 'completed' : 'in_progress', done ? now : null, now, input.user_id, c.id);
  return db.prepare('SELECT * FROM user_challenges WHERE user_id = ? AND challenge_id = ?').get(input.user_id, c.id) as UserChallenge;
}

export function claimChallenge(userId: string, challengeId: string): { challenge: UserChallenge; points_awarded: number; badge_awarded: string | null } {
  const c = getChallenge(challengeId);
  if (!c) throw new Error('challenge_not_found');
  const uc = ensureUserChallenge(userId, c);
  if (uc.status === 'claimed') throw new Error('already_claimed');
  if (uc.status !== 'completed') throw new Error('not_completed');
  const db = getDb();
  const now = new Date().toISOString();
  let badge: string | null = null;
  if (c.reward_points > 0) {
    awardPoints({ user_id: userId, delta: c.reward_points, source: 'challenge', ref_type: 'challenge', ref_id: c.id });
  }
  if (c.reward_badge_slug) {
    const b = db.prepare('SELECT id FROM badges WHERE slug = ?').get(c.reward_badge_slug) as { id: string } | undefined;
    if (b) {
      const r = db.prepare('INSERT OR IGNORE INTO user_badges (user_id, badge_id, awarded_at, note) VALUES (?, ?, ?, ?)')
        .run(userId, b.id, now, `challenge:${c.slug}`);
      if (r.changes > 0) {
        badge = c.reward_badge_slug;
        db.prepare('UPDATE user_scores SET badge_count = badge_count + 1, last_updated = ? WHERE user_id = ?').run(now, userId);
      }
    }
  }
  db.prepare('UPDATE user_challenges SET status = ?, claimed_at = ?, updated_at = ? WHERE user_id = ? AND challenge_id = ?')
    .run('claimed', now, now, userId, c.id);
  return {
    challenge: db.prepare('SELECT * FROM user_challenges WHERE user_id = ? AND challenge_id = ?').get(userId, c.id) as UserChallenge,
    points_awarded: c.reward_points,
    badge_awarded: badge,
  };
}

export function listUserChallenges(userId: string, status?: UserChallengeStatus): Array<UserChallenge & { challenge: Challenge }> {
  const db = getDb();
  const rows = status
    ? db.prepare('SELECT * FROM user_challenges WHERE user_id = ? AND status = ? ORDER BY updated_at DESC').all(userId, status) as UserChallenge[]
    : db.prepare('SELECT * FROM user_challenges WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as UserChallenge[];
  return rows.map(uc => {
    const c = getChallenge(uc.challenge_id)!;
    return { ...uc, challenge: c };
  }).filter(r => r.challenge);
}

// ============================================================
// 36.3 Rewards Program
// ============================================================

export interface Reward {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  kind: RewardKind;
  cost_points: number;
  stock: number | null;
  redeemed_count: number;
  active: number;
  payload: string | null;
  created_at: string;
  updated_at: string;
}

export interface RewardRedemption {
  id: string;
  user_id: string;
  reward_id: string;
  cost_points: number;
  status: RewardRedemptionStatus;
  note: string | null;
  fulfilled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateRewardInput {
  slug: string;
  title: string;
  description?: string | null;
  kind: RewardKind;
  cost_points: number;
  stock?: number | null;
  payload?: Record<string, unknown> | null;
}

export function createReward(input: CreateRewardInput): Reward {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO rewards (id, slug, title, description, kind, cost_points, stock, redeemed_count, active, payload, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?)
  `).run(
    id, input.slug.trim().toLowerCase(), input.title.slice(0, 200),
    input.description ?? null, input.kind, Math.max(1, input.cost_points),
    input.stock ?? null, input.payload ? JSON.stringify(input.payload) : null,
    now, now,
  );
  return db.prepare('SELECT * FROM rewards WHERE id = ?').get(id) as Reward;
}

export function listRewards(activeOnly = true): Reward[] {
  const db = getDb();
  if (activeOnly) {
    return db.prepare('SELECT * FROM rewards WHERE active = 1 ORDER BY cost_points ASC').all() as Reward[];
  }
  return db.prepare('SELECT * FROM rewards ORDER BY cost_points ASC').all() as Reward[];
}

export function getReward(id: string): Reward | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM rewards WHERE id = ?').get(id) as Reward | undefined) ?? null;
}

export function redeemReward(userId: string, rewardId: string): RewardRedemption {
  const db = getDb();
  const r = getReward(rewardId);
  if (!r) throw new Error('reward_not_found');
  if (r.active !== 1) throw new Error('reward_inactive');
  if (r.stock !== null && r.redeemed_count >= r.stock) throw new Error('out_of_stock');
  const balance = ensureScoreRow(userId);
  if (balance < r.cost_points) throw new Error('insufficient_points');
  const now = new Date().toISOString();
  const id = randomUUID();
  // awardPoints() manages its own transaction — no outer BEGIN here.
  awardPoints({ user_id: userId, delta: -r.cost_points, source: 'redeem', ref_type: 'reward', ref_id: r.id });
  db.prepare(`
    INSERT INTO reward_redemptions (id, user_id, reward_id, cost_points, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, userId, r.id, r.cost_points, now, now);
  db.prepare('UPDATE rewards SET redeemed_count = redeemed_count + 1, updated_at = ? WHERE id = ?').run(now, r.id);
  return db.prepare('SELECT * FROM reward_redemptions WHERE id = ?').get(id) as RewardRedemption;
}

export function fulfillRedemption(redemptionId: string, note?: string | null): RewardRedemption | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM reward_redemptions WHERE id = ?').get(redemptionId) as RewardRedemption | undefined;
  if (!r) return null;
  if (r.status === 'fulfilled' || r.status === 'cancelled') return r;
  const now = new Date().toISOString();
  db.prepare('UPDATE reward_redemptions SET status = ?, note = COALESCE(?, note), fulfilled_at = ?, updated_at = ? WHERE id = ?')
    .run('fulfilled', note ?? null, now, now, redemptionId);
  return db.prepare('SELECT * FROM reward_redemptions WHERE id = ?').get(redemptionId) as RewardRedemption;
}

export function cancelRedemption(redemptionId: string, refund = true): RewardRedemption | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM reward_redemptions WHERE id = ?').get(redemptionId) as RewardRedemption | undefined;
  if (!r) return null;
  if (r.status !== 'pending') return r;
  const now = new Date().toISOString();
  if (refund) {
    awardPoints({ user_id: r.user_id, delta: r.cost_points, source: 'refund', ref_type: 'reward_redemption', ref_id: r.id });
  }
  db.prepare('UPDATE reward_redemptions SET status = ?, updated_at = ? WHERE id = ?').run('cancelled', now, redemptionId);
  db.prepare('UPDATE rewards SET redeemed_count = MAX(0, redeemed_count - 1), updated_at = ? WHERE id = ?').run(now, r.reward_id);
  return db.prepare('SELECT * FROM reward_redemptions WHERE id = ?').get(redemptionId) as RewardRedemption;
}

export function listUserRedemptions(userId: string, limit = 50): RewardRedemption[] {
  const db = getDb();
  return db.prepare('SELECT * FROM reward_redemptions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, Math.min(Math.max(limit, 1), 200)) as RewardRedemption[];
}

// ============================================================
// 36.4 Streak Tracking
// ============================================================

export interface UserStreak {
  user_id: string;
  kind: StreakKind;
  current_length: number;
  longest_length: number;
  last_event_date: string | null;
  last_event_at: string | null;
  updated_at: string;
}

function ymd(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function recordStreakEvent(userId: string, kind: StreakKind): { streak: UserStreak; extended: boolean; reset: boolean; bonus_points: number } {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM user_streaks WHERE user_id = ? AND kind = ?').get(userId, kind) as UserStreak | undefined;
  const today = ymd();
  const now = new Date().toISOString();
  if (!existing) {
    db.prepare(`
      INSERT INTO user_streaks (user_id, kind, current_length, longest_length, last_event_date, last_event_at, updated_at)
      VALUES (?, ?, 1, 1, ?, ?, ?)
    `).run(userId, kind, today, now, now);
    return { streak: db.prepare('SELECT * FROM user_streaks WHERE user_id = ? AND kind = ?').get(userId, kind) as UserStreak, extended: false, reset: false, bonus_points: 0 };
  }
  if (existing.last_event_date === today) {
    return { streak: existing, extended: false, reset: false, bonus_points: 0 };
  }
  const yesterday = ymd(new Date(Date.now() - 86_400_000));
  const extended = existing.last_event_date === yesterday;
  const reset = !extended;
  const newLen = extended ? existing.current_length + 1 : 1;
  const newLongest = Math.max(existing.longest_length, newLen);
  db.prepare(`
    UPDATE user_streaks SET current_length = ?, longest_length = ?, last_event_date = ?, last_event_at = ?, updated_at = ?
    WHERE user_id = ? AND kind = ?
  `).run(newLen, newLongest, today, now, now, userId, kind);
  // streak bonuses every 7 days
  let bonus = 0;
  if (extended && newLen > 0 && newLen % 7 === 0) {
    bonus = 50 * Math.min(7, Math.floor(newLen / 7));
    try {
      awardPoints({ user_id: userId, delta: bonus, source: 'streak', ref_type: 'streak', ref_id: `${kind}:${newLen}`, note: `${kind} streak ${newLen} days` });
    } catch { bonus = 0; }
  }
  return { streak: db.prepare('SELECT * FROM user_streaks WHERE user_id = ? AND kind = ?').get(userId, kind) as UserStreak, extended, reset, bonus_points: bonus };
}

export function getUserStreaks(userId: string): UserStreak[] {
  const db = getDb();
  return db.prepare('SELECT * FROM user_streaks WHERE user_id = ?').all(userId) as UserStreak[];
}

export function getStreak(userId: string, kind: StreakKind): UserStreak | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM user_streaks WHERE user_id = ? AND kind = ?').get(userId, kind) as UserStreak | undefined) ?? null;
}

// ============================================================
// Stats
// ============================================================

export interface GamificationStats {
  total_awarded_points: number;
  total_redeemed_points: number;
  active_challenges: number;
  total_user_challenges: number;
  completed_challenges: number;
  rewards_active: number;
  redemptions_pending: number;
  top_streak_length: number;
  users_with_points: number;
}

export function getGamificationStats(): GamificationStats {
  const db = getDb();
  const totalAwarded = (db.prepare("SELECT COALESCE(SUM(delta),0) AS s FROM points_ledger WHERE delta > 0").get() as { s: number }).s;
  const totalRedeemed = Math.abs((db.prepare("SELECT COALESCE(SUM(delta),0) AS s FROM points_ledger WHERE delta < 0").get() as { s: number }).s);
  const activeCh = (db.prepare("SELECT COUNT(*) AS c FROM challenges WHERE status = 'active'").get() as { c: number }).c;
  const totalUC = (db.prepare('SELECT COUNT(*) AS c FROM user_challenges').get() as { c: number }).c;
  const completedUC = (db.prepare("SELECT COUNT(*) AS c FROM user_challenges WHERE status IN ('completed','claimed')").get() as { c: number }).c;
  const rewardsActive = (db.prepare('SELECT COUNT(*) AS c FROM rewards WHERE active = 1').get() as { c: number }).c;
  const pendingR = (db.prepare("SELECT COUNT(*) AS c FROM reward_redemptions WHERE status = 'pending'").get() as { c: number }).c;
  const topStreak = (db.prepare('SELECT COALESCE(MAX(current_length),0) AS m FROM user_streaks').get() as { m: number }).m;
  const usersWithPoints = (db.prepare('SELECT COUNT(*) AS c FROM user_scores WHERE total_points > 0').get() as { c: number }).c;
  return {
    total_awarded_points: totalAwarded,
    total_redeemed_points: totalRedeemed,
    active_challenges: activeCh,
    total_user_challenges: totalUC,
    completed_challenges: completedUC,
    rewards_active: rewardsActive,
    redemptions_pending: pendingR,
    top_streak_length: topStreak,
    users_with_points: usersWithPoints,
  };
}
