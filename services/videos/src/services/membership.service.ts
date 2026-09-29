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
