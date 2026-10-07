// melodyflix videos - channel membership service
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export interface MembershipTier {
  id: string;
  channel_id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  color: string;
  badge_emoji: string;
  active: number;
  subscriber_count: number;
  created_at: string;
  updated_at: string;
}

export interface Membership {
  id: string;
  user_id: string;
  channel_id: string;
  tier_id: string;
  status: 'active' | 'expired' | 'cancelled';
  started_at: string;
  expires_at: string;
  auto_renew: number;
  last_payment_at: string | null;
  total_paid: number;
  transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

export function ensureMembershipSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS membership_tiers (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'BDT',
      color TEXT NOT NULL DEFAULT '#7c3aed',
      badge_emoji TEXT NOT NULL DEFAULT '⭐',
      active INTEGER NOT NULL DEFAULT 1,
      subscriber_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mt_channel ON membership_tiers(channel_id);

    CREATE TABLE IF NOT EXISTS memberships (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      tier_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      auto_renew INTEGER NOT NULL DEFAULT 1,
      last_payment_at TEXT,
      total_paid REAL NOT NULL DEFAULT 0,
      transaction_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (user_id, channel_id)
    );
    CREATE INDEX IF NOT EXISTS idx_mem_user ON memberships(user_id);
    CREATE INDEX IF NOT EXISTS idx_mem_channel ON memberships(channel_id);
    CREATE INDEX IF NOT EXISTS idx_mem_status ON memberships(status);

    CREATE TABLE IF NOT EXISTS content_early_access (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      tier_id TEXT,
      hours_before_public INTEGER NOT NULL DEFAULT 24,
      available_from TEXT NOT NULL,
      public_at TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (video_id)
    );
    CREATE INDEX IF NOT EXISTS idx_early_channel ON content_early_access(channel_id);
    CREATE INDEX IF NOT EXISTS idx_early_public ON content_early_access(public_at);

    CREATE TABLE IF NOT EXISTS premium_ad_free (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      granted_at TEXT NOT NULL,
      expires_at TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_adfree_active ON premium_ad_free(active, expires_at);
  `);
}

// ---------- Tiers CRUD ----------
export interface CreateTierInput {
  channel_id: string;
  name: string;
  description?: string;
  price: number;
  currency?: string;
  color?: string;
  badge_emoji?: string;
  active?: boolean;
}

export function createTier(input: CreateTierInput): MembershipTier {
  const db = getDb();
  const now = new Date().toISOString();
  const tier: MembershipTier = {
    id: randomUUID(),
    channel_id: input.channel_id,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    price: input.price,
    currency: input.currency ?? 'BDT',
    color: input.color ?? '#7c3aed',
    badge_emoji: input.badge_emoji ?? '⭐',
    active: input.active === false ? 0 : 1,
    subscriber_count: 0,
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO membership_tiers (id, channel_id, name, description, price, currency,
      color, badge_emoji, active, subscriber_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tier.id, tier.channel_id, tier.name, tier.description, tier.price, tier.currency,
    tier.color, tier.badge_emoji, tier.active, tier.subscriber_count, now, now
  );
  return tier;
}

export function listTiersByChannel(channelId: string): MembershipTier[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM membership_tiers WHERE channel_id = ? ORDER BY price ASC'
  ).all(channelId) as MembershipTier[];
}

export function getTierById(id: string): MembershipTier | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM membership_tiers WHERE id = ?').get(id) as MembershipTier | undefined) ?? null;
}

export function updateTier(id: string, channelId: string, updates: Partial<CreateTierInput>): MembershipTier {
  const db = getDb();
  const existing = getTierById(id);
  if (!existing) throw new Error('Tier not found');
  if (existing.channel_id !== channelId) throw new Error('Not authorized');
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE membership_tiers SET name = ?, description = ?, price = ?, currency = ?,
      color = ?, badge_emoji = ?, active = ?, updated_at = ?
    WHERE id = ?
  `).run(
    updates.name?.trim() || existing.name,
    updates.description !== undefined ? (updates.description?.trim() || null) : existing.description,
    updates.price ?? existing.price,
    updates.currency ?? existing.currency,
    updates.color ?? existing.color,
    updates.badge_emoji ?? existing.badge_emoji,
    updates.active !== undefined ? (updates.active ? 1 : 0) : existing.active,
    now, id
  );
  return getTierById(id)!;
}

export function deleteTier(id: string, channelId: string): void {
  const db = getDb();
  const existing = getTierById(id);
  if (!existing) throw new Error('Tier not found');
  if (existing.channel_id !== channelId) throw new Error('Not authorized');
  // End memberships on this tier
  db.prepare("UPDATE memberships SET status = 'cancelled', updated_at = ? WHERE tier_id = ? AND status = 'active'")
    .run(new Date().toISOString(), id);
  db.prepare('DELETE FROM membership_tiers WHERE id = ?').run(id);
}

// ---------- Subscriptions ----------
export interface CreateMembershipInput {
  user_id: string;
  channel_id: string;
  tier_id: string;
  duration_days?: number;
  transaction_id?: string;
  amount_paid?: number;
}

export function createMembership(input: CreateMembershipInput): Membership {
  const db = getDb();
  const tier = getTierById(input.tier_id);
  if (!tier) throw new Error('Tier not found');
  if (tier.channel_id !== input.channel_id) throw new Error('Tier does not belong to this channel');

  const now = new Date();
  const durationDays = input.duration_days ?? 30;
  const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  // Upsert: if user already has membership, extend it
  const existing = db.prepare('SELECT * FROM memberships WHERE user_id = ? AND channel_id = ?')
    .get(input.user_id, input.channel_id) as Membership | undefined;

  if (existing) {
    // Extend expiry from current expiry (if not expired) or from now
    const baseDate = new Date(existing.expires_at) > now ? new Date(existing.expires_at) : now;
    const newExpiry = new Date(baseDate.getTime() + durationDays * 24 * 60 * 60 * 1000);
    db.prepare(`
      UPDATE memberships SET tier_id = ?, status = 'active', expires_at = ?,
        last_payment_at = ?, total_paid = total_paid + ?, transaction_id = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.tier_id, newExpiry.toISOString(), now.toISOString(),
      input.amount_paid ?? tier.price, input.transaction_id ?? null,
      now.toISOString(), existing.id
    );
    return db.prepare('SELECT * FROM memberships WHERE id = ?').get(existing.id) as Membership;
  }

  const membership: Membership = {
    id: randomUUID(),
    user_id: input.user_id,
    channel_id: input.channel_id,
    tier_id: input.tier_id,
    status: 'active',
    started_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    auto_renew: 1,
    last_payment_at: now.toISOString(),
    total_paid: input.amount_paid ?? tier.price,
    transaction_id: input.transaction_id ?? null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  db.prepare(`
    INSERT INTO memberships (id, user_id, channel_id, tier_id, status, started_at, expires_at,
      auto_renew, last_payment_at, total_paid, transaction_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    membership.id, membership.user_id, membership.channel_id, membership.tier_id,
    membership.status, membership.started_at, membership.expires_at,
    membership.auto_renew, membership.last_payment_at, membership.total_paid,
    membership.transaction_id, membership.created_at, membership.updated_at
  );

  db.prepare('UPDATE membership_tiers SET subscriber_count = subscriber_count + 1 WHERE id = ?')
    .run(input.tier_id);

  return membership;
}

export function getMembership(userId: string, channelId: string): Membership | null {
  const db = getDb();
  const m = db.prepare('SELECT * FROM memberships WHERE user_id = ? AND channel_id = ?')
    .get(userId, channelId) as Membership | undefined;
  if (!m) return null;

  // Auto-expire if past due
  if (m.status === 'active' && new Date(m.expires_at) < new Date()) {
    db.prepare("UPDATE memberships SET status = 'expired', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), m.id);
    return { ...m, status: 'expired' };
  }
  return m;
}

export function listMyMemberships(userId: string): Membership[] {
  const db = getDb();
  return db.prepare('SELECT * FROM memberships WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as Membership[];
}

export function cancelMembership(userId: string, channelId: string): void {
  const db = getDb();
  const m = getMembership(userId, channelId);
  if (!m) throw new Error('Membership not found');
  db.prepare("UPDATE memberships SET auto_renew = 0, status = 'cancelled', updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), m.id);
}

export function listChannelMembers(channelId: string, limit = 100): Membership[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM memberships WHERE channel_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT ?"
  ).all(channelId, limit) as Membership[];
}

export interface MembershipStats {
  total_tiers: number;
  total_memberships: number;
  active_memberships: number;
  total_revenue: number;
}

export function getMembershipStats(): MembershipStats {
  const db = getDb();
  const tiers = (db.prepare('SELECT COUNT(*) as n FROM membership_tiers').get() as { n: number }).n;
  const total = (db.prepare('SELECT COUNT(*) as n FROM memberships').get() as { n: number }).n;
  const active = (db.prepare("SELECT COUNT(*) as n FROM memberships WHERE status = 'active'").get() as { n: number }).n;
  const rev = (db.prepare('SELECT COALESCE(SUM(total_paid), 0) as s FROM memberships').get() as { s: number }).s;
  return { total_tiers: tiers, total_memberships: total, active_memberships: active, total_revenue: rev };
}

// ============================================================
// 57.1 Early Access Content
// Define per-video early-access windows for channel members.
// Members of a matching tier see it hours_before_public before
// the public release.
// ============================================================

export interface EarlyAccessEntry {
  id: string;
  video_id: string;
  channel_id: string;
  tier_id: string | null;
  hours_before_public: number;
  available_from: string;
  public_at: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SetEarlyAccessInput {
  video_id: string;
  channel_id: string;
  tier_id?: string | null;
  public_at: string;
  hours_before_public?: number;
}

export function setEarlyAccess(input: SetEarlyAccessInput, createdBy: string | null): EarlyAccessEntry {
  const db = getDb();
  const hours = Math.min(Math.max(input.hours_before_public ?? 24, 0), 8760);
  const publicMs = new Date(input.public_at).getTime();
  if (Number.isNaN(publicMs)) throw new Error('invalid_public_at');
  const availableFrom = new Date(publicMs - hours * 3_600_000).toISOString();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM content_early_access WHERE video_id = ?')
    .get(input.video_id) as { id: string } | undefined;
  if (existing) {
    db.prepare(`
      UPDATE content_early_access SET
        channel_id = ?, tier_id = ?, hours_before_public = ?,
        available_from = ?, public_at = ?, updated_at = ?
      WHERE id = ?
    `).run(input.channel_id, input.tier_id ?? null, hours, availableFrom, input.public_at, now, existing.id);
    return db.prepare('SELECT * FROM content_early_access WHERE id = ?').get(existing.id) as EarlyAccessEntry;
  }
  const id = randomUUID();
  db.prepare(`
    INSERT INTO content_early_access
    (id, video_id, channel_id, tier_id, hours_before_public, available_from, public_at, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.video_id, input.channel_id, input.tier_id ?? null, hours,
    availableFrom, input.public_at, createdBy, now, now);
  return db.prepare('SELECT * FROM content_early_access WHERE id = ?').get(id) as EarlyAccessEntry;
}

export function getEarlyAccess(videoId: string): EarlyAccessEntry | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM content_early_access WHERE video_id = ?').get(videoId) as EarlyAccessEntry | undefined) ?? null;
}

export function removeEarlyAccess(videoId: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM content_early_access WHERE video_id = ?').run(videoId).changes > 0;
}

export function listEarlyAccessForChannel(channelId: string, limit = 100): EarlyAccessEntry[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM content_early_access WHERE channel_id = ? ORDER BY public_at DESC LIMIT ?'
  ).all(channelId, limit) as EarlyAccessEntry[];
}

export function listUpcomingEarlyAccess(limit = 50): EarlyAccessEntry[] {
  const db = getDb();
  const now = new Date().toISOString();
  return db.prepare(
    'SELECT * FROM content_early_access WHERE public_at >= ? ORDER BY public_at ASC LIMIT ?'
  ).all(now, limit) as EarlyAccessEntry[];
}

export interface EarlyAccessDecision {
  video_id: string;
  has_early_access_program: boolean;
  is_public: boolean;
  user_can_watch: boolean;
  reason: 'public' | 'early_access_granted' | 'needs_membership' | 'early_access_window_not_open' | 'no_early_access_program';
  available_from: string | null;
  public_at: string | null;
}

export function canAccessEarly(userId: string | null, videoId: string): EarlyAccessDecision {
  const db = getDb();
  const entry = getEarlyAccess(videoId);
  if (!entry) {
    return {
      video_id: videoId,
      has_early_access_program: false,
      is_public: true,
      user_can_watch: true,
      reason: 'no_early_access_program',
      available_from: null,
      public_at: null,
    };
  }
  const now = Date.now();
  const publicMs = new Date(entry.public_at).getTime();
  const availableMs = new Date(entry.available_from).getTime();
  if (now >= publicMs) {
    return {
      video_id: videoId,
      has_early_access_program: true,
      is_public: true,
      user_can_watch: true,
      reason: 'public',
      available_from: entry.available_from,
      public_at: entry.public_at,
    };
  }
  if (now < availableMs) {
    return {
      video_id: videoId,
      has_early_access_program: true,
      is_public: false,
      user_can_watch: false,
      reason: 'early_access_window_not_open',
      available_from: entry.available_from,
      public_at: entry.public_at,
    };
  }
  // window is open: check membership
  if (!userId) {
    return {
      video_id: videoId,
      has_early_access_program: true,
      is_public: false,
      user_can_watch: false,
      reason: 'needs_membership',
      available_from: entry.available_from,
      public_at: entry.public_at,
    };
  }
  const mem = db.prepare(
    "SELECT id, tier_id FROM memberships WHERE user_id = ? AND channel_id = ? AND status = 'active' AND expires_at > ?"
  ).get(userId, entry.channel_id, new Date().toISOString()) as { id: string; tier_id: string } | undefined;
  if (mem) {
    if (!entry.tier_id || mem.tier_id === entry.tier_id) {
      return {
        video_id: videoId,
        has_early_access_program: true,
        is_public: false,
        user_can_watch: true,
        reason: 'early_access_granted',
        available_from: entry.available_from,
        public_at: entry.public_at,
      };
    }
  }
  return {
    video_id: videoId,
    has_early_access_program: true,
    is_public: false,
    user_can_watch: false,
    reason: 'needs_membership',
    available_from: entry.available_from,
    public_at: entry.public_at,
  };
}

// ============================================================
// 57.3 Ad-Free Experience
// Grant ad-free playback. Source can be 'membership' (auto via
// active membership), 'premium' (paid plan), 'admin', 'promo'.
// ============================================================

export interface AdFreeGrant {
  id: string;
  user_id: string;
  source: string;
  granted_at: string;
  expires_at: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface GrantAdFreeInput {
  source?: 'membership' | 'premium' | 'admin' | 'promo' | 'manual';
  expires_at?: string | null;
}

export function grantAdFree(userId: string, input: GrantAdFreeInput = {}): AdFreeGrant {
  const db = getDb();
  const now = new Date().toISOString();
  const source = input.source ?? 'manual';
  const existing = db.prepare('SELECT id FROM premium_ad_free WHERE user_id = ?').get(userId) as { id: string } | undefined;
  if (existing) {
    db.prepare(
      'UPDATE premium_ad_free SET source = ?, expires_at = ?, active = 1, updated_at = ? WHERE user_id = ?'
    ).run(source, input.expires_at ?? null, now, userId);
  } else {
    db.prepare(
      'INSERT INTO premium_ad_free (id, user_id, source, granted_at, expires_at, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'
    ).run(randomUUID(), userId, source, now, input.expires_at ?? null, now, now);
  }
  return db.prepare('SELECT * FROM premium_ad_free WHERE user_id = ?').get(userId) as AdFreeGrant;
}

export function revokeAdFree(userId: string): boolean {
  const db = getDb();
  const r = db.prepare('UPDATE premium_ad_free SET active = 0, updated_at = ? WHERE user_id = ?')
    .run(new Date().toISOString(), userId);
  return r.changes > 0;
}

export function getAdFreeGrant(userId: string): AdFreeGrant | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM premium_ad_free WHERE user_id = ?').get(userId) as AdFreeGrant | undefined) ?? null;
}

export interface AdFreeStatus {
  user_id: string;
  ad_free: boolean;
  source: string | null;
  expires_at: string | null;
  from_membership: boolean;
}

export function isAdFree(userId: string | null): AdFreeStatus {
  if (!userId) {
    return { user_id: '', ad_free: false, source: null, expires_at: null, from_membership: false };
  }
  const db = getDb();
  const now = new Date().toISOString();
  const grant = getAdFreeGrant(userId);
  if (grant && grant.active === 1) {
    if (!grant.expires_at || grant.expires_at > now) {
      return {
        user_id: userId,
        ad_free: true,
        source: grant.source,
        expires_at: grant.expires_at,
        from_membership: false,
      };
    }
  }
  // fallback: active membership anywhere grants ad-free
  const mem = db.prepare(
    "SELECT expires_at FROM memberships WHERE user_id = ? AND status = 'active' AND expires_at > ? LIMIT 1"
  ).get(userId, now) as { expires_at: string } | undefined;
  if (mem) {
    return {
      user_id: userId,
      ad_free: true,
      source: 'membership',
      expires_at: mem.expires_at,
      from_membership: true,
    };
  }
  return { user_id: userId, ad_free: false, source: null, expires_at: null, from_membership: false };
}

export function listAdFreeUsers(activeOnly = true, limit = 500): AdFreeGrant[] {
  const db = getDb();
  const now = new Date().toISOString();
  if (activeOnly) {
    return db.prepare(
      'SELECT * FROM premium_ad_free WHERE active = 1 AND (expires_at IS NULL OR expires_at > ?) ORDER BY granted_at DESC LIMIT ?'
    ).all(now, limit) as AdFreeGrant[];
  }
  return db.prepare(
    'SELECT * FROM premium_ad_free ORDER BY granted_at DESC LIMIT ?'
  ).all(limit) as AdFreeGrant[];
}

export interface AdFreeStats {
  active_grants: number;
  expired_or_inactive: number;
  by_source: Record<string, number>;
}

export function getAdFreeStats(): AdFreeStats {
  const db = getDb();
  const now = new Date().toISOString();
  const active = db.prepare(
    'SELECT COUNT(*) AS c FROM premium_ad_free WHERE active = 1 AND (expires_at IS NULL OR expires_at > ?)'
  ).get(now) as { c: number };
  const inactive = db.prepare(
    'SELECT COUNT(*) AS c FROM premium_ad_free WHERE active = 0 OR (expires_at IS NOT NULL AND expires_at <= ?)'
  ).get(now) as { c: number };
  const bySrc = db.prepare(
    'SELECT source, COUNT(*) AS c FROM premium_ad_free WHERE active = 1 AND (expires_at IS NULL OR expires_at > ?) GROUP BY source'
  ).all(now) as Array<{ source: string; c: number }>;
  const by_source: Record<string, number> = {};
  for (const r of bySrc) by_source[r.source] = r.c;
  return { active_grants: active.c, expired_or_inactive: inactive.c, by_source };
}
