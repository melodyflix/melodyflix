// melodyflix auth - influencer dashboard (27.3)
import { getDb } from '@melodyflix/shared-db';

export type InfluencerTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface Influencer {
  user_id: string;
  tier: InfluencerTier;
  notes: string | null;
  marked_by: string;
  created_at: string;
  updated_at: string;
}

export interface InfluencerMetrics {
  user_id: string;
  username: string | null;
  email: string | null;
  display_name: string | null;
  tier: InfluencerTier;
  // Aggregated
  channel_count: number;
  subscriber_count: number;
  video_count: number;
  total_views: number;
  total_likes: number;
  total_comments: number;
  // From referral program (27.2)
  referral_invited: number;
  referral_completed: number;
  referral_earned: number;
  // Estimated
  estimated_earnings: number;
  engagement_rate: number;   // (likes + comments) / views
  created_at: string;
}

export const TIERS: { id: InfluencerTier; label: string; min_subs: number }[] = [
  { id: 'bronze', label: 'Bronze', min_subs: 1000 },
  { id: 'silver', label: 'Silver', min_subs: 10000 },
  { id: 'gold', label: 'Gold', min_subs: 100000 },
  { id: 'platinum', label: 'Platinum', min_subs: 1000000 },
];

export function ensureInfluencerSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS influencers (
      user_id TEXT PRIMARY KEY,
      tier TEXT NOT NULL DEFAULT 'bronze',
      notes TEXT,
      marked_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_influencers_tier ON influencers(tier, created_at DESC);
  `);
}

export function isInfluencer(userId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT user_id FROM influencers WHERE user_id = ?').get(userId) as { user_id: string } | undefined;
  return !!row;
}

export function getInfluencer(userId: string): Influencer | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM influencers WHERE user_id = ?').get(userId) as Influencer) ?? null;
}

export interface MarkInput {
  tier?: InfluencerTier;
  notes?: string | null;
}

export function markInfluencer(userId: string, input: MarkInput, markedBy: string): Influencer {
  const db = getDb();
  const tier = TIERS.find((t) => t.id === input.tier)?.id ?? 'bronze';
  const now = new Date().toISOString();
  const existing = getInfluencer(userId);
  if (existing) {
    db.prepare('UPDATE influencers SET tier = ?, notes = ?, updated_at = ? WHERE user_id = ?')
      .run(tier, input.notes ?? existing.notes, now, userId);
  } else {
    db.prepare('INSERT INTO influencers (user_id, tier, notes, marked_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, tier, input.notes ?? null, markedBy, now, now);
  }
  return getInfluencer(userId)!;
}

export function unmarkInfluencer(userId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM influencers WHERE user_id = ?').run(userId);
}

export function updateTier(userId: string, tier: InfluencerTier): Influencer {
  const db = getDb();
  const t = TIERS.find((x) => x.id === tier)?.id ?? 'bronze';
  const existing = getInfluencer(userId);
  if (!existing) throw new Error('User is not an influencer');
  db.prepare('UPDATE influencers SET tier = ?, updated_at = ? WHERE user_id = ?')
    .run(t, new Date().toISOString(), userId);
  return getInfluencer(userId)!;
}

// ---------- Metrics aggregation ----------

function safeQuery<T = any>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

export function getMetrics(userId: string): InfluencerMetrics {
  const db = getDb();
  const influencer = getInfluencer(userId);
  const tier: InfluencerTier = (influencer?.tier as InfluencerTier) ?? 'bronze';

  // Basic user info
  const user = safeQuery(
    () => db.prepare('SELECT username, email, display_name, created_at FROM users WHERE id = ?').get(userId) as any,
    null as any
  );

  // Channel stats — try a few common shapes
  const channelRow = safeQuery(
    () => db.prepare(
      'SELECT COUNT(*) as n, COALESCE(SUM(subscriber_count), 0) as subs FROM channels WHERE owner_id = ?'
    ).get(userId) as { n: number; subs: number },
    { n: 0, subs: 0 }
  );

  // Videos aggregate
  const videoRow = safeQuery(
    () => db.prepare(
      'SELECT COUNT(*) as n, COALESCE(SUM(view_count), 0) as views, COALESCE(SUM(like_count), 0) as likes, COALESCE(SUM(dislike_count), 0) as dislikes FROM videos v JOIN channels c ON c.id = v.channel_id WHERE c.owner_id = ?'
    ).get(userId) as { n: number; views: number; likes: number; dislikes: number },
    { n: 0, views: 0, likes: 0, dislikes: 0 }
  );

  // Comments on this user's videos
  const commentRow = safeQuery(
    () => db.prepare(
      'SELECT COUNT(*) as n FROM comments cm JOIN videos v ON v.id = cm.video_id JOIN channels c ON c.id = v.channel_id WHERE c.owner_id = ? AND cm.is_deleted = 0'
    ).get(userId) as { n: number },
    { n: 0 }
  );

  // Referral aggregate
  const referralRow = safeQuery(
    () => db.prepare(
      "SELECT COUNT(*) as total, SUM(CASE WHEN status='rewarded' THEN 1 ELSE 0 END) as rewarded, COALESCE(SUM(CASE WHEN status='rewarded' THEN reward_amount ELSE 0 END), 0) as earned FROM referrals WHERE referrer_user_id = ?"
    ).get(userId) as { total: number; rewarded: number; earned: number },
    { total: 0, rewarded: 0, earned: 0 }
  );

  const subscriber_count = channelRow?.subs ?? 0;
  const total_views = videoRow?.views ?? 0;
  const total_likes = videoRow?.likes ?? 0;
  const total_comments = commentRow?.n ?? 0;

  const engagement = total_views > 0 ? (total_likes + total_comments) / total_views : 0;

  // Rough earnings estimate: $1 per 1000 views + 10% of referral credits as $ equivalent
  const estimated_earnings = (total_views / 1000) * 1 + (referralRow?.earned ?? 0) * 0.01;

  return {
    user_id: userId,
    username: user?.username ?? null,
    email: user?.email ?? null,
    display_name: user?.display_name ?? null,
    tier,
    channel_count: channelRow?.n ?? 0,
    subscriber_count,
    video_count: videoRow?.n ?? 0,
    total_views,
    total_likes,
    total_comments,
    referral_invited: referralRow?.total ?? 0,
    referral_completed: referralRow?.rewarded ?? 0,
    referral_earned: referralRow?.earned ?? 0,
    estimated_earnings,
    engagement_rate: engagement,
    created_at: user?.created_at ?? new Date().toISOString(),
  };
}

// Suggest tier based on current subscriber count
export function suggestTier(subscriberCount: number): InfluencerTier {
  let tier: InfluencerTier = 'bronze';
  for (const t of TIERS) {
    if (subscriberCount >= t.min_subs) tier = t.id;
  }
  return tier;
}

export interface InfluencerListItem extends InfluencerMetrics {
  marked_at: string;
  notes: string | null;
}

export function listInfluencers(limit = 100): InfluencerListItem[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM influencers ORDER BY created_at DESC LIMIT ?')
    .all(Math.max(1, Math.min(500, limit))) as Influencer[];
  return rows.map((r) => ({
    ...getMetrics(r.user_id),
    tier: r.tier,
    marked_at: r.created_at,
    notes: r.notes,
  }));
}

// Auto-detect top creators eligible to become influencers
export interface CandidateCreator {
  user_id: string;
  username: string | null;
  display_name: string | null;
  subscriber_count: number;
  video_count: number;
  total_views: number;
  suggested_tier: InfluencerTier;
  is_influencer: boolean;
}

export function findCandidates(minSubs = 1000, limit = 50): CandidateCreator[] {
  const db = getDb();
  try {
    const rows = db.prepare(
      `SELECT c.owner_id AS user_id,
              COALESCE(SUM(c.subscriber_count), 0) AS subscriber_count,
              (SELECT COUNT(*) FROM videos v WHERE v.channel_id = c.id) AS video_count,
              (SELECT COALESCE(SUM(v.view_count), 0) FROM videos v WHERE v.channel_id = c.id) AS total_views
       FROM channels c
       GROUP BY c.owner_id
       HAVING subscriber_count >= ?
       ORDER BY subscriber_count DESC
       LIMIT ?`
    ).all(minSubs, Math.max(1, Math.min(200, limit))) as any[];

    return rows.map((r) => {
      const u = safeQuery(
        () => db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(r.user_id) as any,
        null as any
      );
      return {
        user_id: r.user_id,
        username: u?.username ?? null,
        display_name: u?.display_name ?? null,
        subscriber_count: r.subscriber_count,
        video_count: r.video_count,
        total_views: r.total_views,
        suggested_tier: suggestTier(r.subscriber_count),
        is_influencer: isInfluencer(r.user_id),
      };
    });
  } catch {
    return [];
  }
}
