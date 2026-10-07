// melodyflix videos - Section 15.2 Co-Publishing
// Co-author invitations, credit management, revenue split, and public
// credits per video.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type CoPublishRole = 'co_author' | 'producer' | 'editor' | 'composer' | 'camera' | 'writer';
export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';

const ROLES: CoPublishRole[] = ['co_author','producer','editor','composer','camera','writer'];

export function ensureCoPublishSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS co_publish_invites (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      inviter_id TEXT NOT NULL,
      invitee_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'co_author',
      revenue_share_percent REAL NOT NULL DEFAULT 0,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at TEXT,
      responded_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_copub_inv_video ON co_publish_invites(video_id, status);
    CREATE INDEX IF NOT EXISTS idx_copub_inv_invitee ON co_publish_invites(invitee_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_copub_inv_inviter ON co_publish_invites(inviter_id, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS co_publish_credits (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      revenue_share_percent REAL NOT NULL DEFAULT 0,
      is_public INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (video_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_copub_credits_video ON co_publish_credits(video_id, order_index);
    CREATE INDEX IF NOT EXISTS idx_copub_credits_user ON co_publish_credits(user_id);
  `);
}

export interface CoPublishInvite {
  id: string;
  video_id: string;
  inviter_id: string;
  invitee_id: string;
  role: CoPublishRole;
  revenue_share_percent: number;
  message: string | null;
  status: InviteStatus;
  expires_at: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoPublishCredit {
  id: string;
  video_id: string;
  user_id: string;
  display_name: string | null;
  role: CoPublishRole;
  order_index: number;
  revenue_share_percent: number;
  is_public: number;
  created_at: string;
  updated_at: string;
}

// ---------- helpers ----------
function totalShare(videoId: string, excludeUserId?: string): number {
  const db = getDb();
  if (excludeUserId) {
    const r = db.prepare(
      'SELECT COALESCE(SUM(revenue_share_percent), 0) AS s FROM co_publish_credits WHERE video_id = ? AND user_id != ?'
    ).get(videoId, excludeUserId) as { s: number };
    return r.s;
  }
  const r = db.prepare(
    'SELECT COALESCE(SUM(revenue_share_percent), 0) AS s FROM co_publish_credits WHERE video_id = ?'
  ).get(videoId) as { s: number };
  return r.s;
}

function pendingShare(videoId: string): number {
  const r = getDb().prepare(
    "SELECT COALESCE(SUM(revenue_share_percent), 0) AS s FROM co_publish_invites WHERE video_id = ? AND status = 'pending'"
  ).get(videoId) as { s: number };
  return r.s;
}

// ---------- invites ----------
export interface InviteInput {
  video_id: string;
  inviter_id: string;
  invitee_id: string;
  role?: CoPublishRole;
  revenue_share_percent?: number;
  message?: string | null;
  ttl_seconds?: number;
}

export function inviteCoPublisher(input: InviteInput): CoPublishInvite {
  if (!input.video_id) throw new Error('video_required');
  if (!input.inviter_id || !input.invitee_id) throw new Error('user_required');
  if (input.inviter_id === input.invitee_id) throw new Error('cannot_invite_self');
  const role = input.role ?? 'co_author';
  if (!ROLES.includes(role)) throw new Error('invalid_role');
  const share = input.revenue_share_percent ?? 0;
  if (share < 0 || share > 100) throw new Error('invalid_share');
  const db = getDb();
  // prevent duplicate pending invite for same (video, invitee)
  const dupe = db.prepare(
    "SELECT 1 AS c FROM co_publish_invites WHERE video_id = ? AND invitee_id = ? AND status = 'pending'"
  ).get(input.video_id, input.invitee_id) as { c: number } | undefined;
  if (dupe) throw new Error('pending_invite_exists');
  if (share > 0) {
    const already = totalShare(input.video_id) + pendingShare(input.video_id) + share;
    if (already > 100) throw new Error('share_exceeds_100');
  }
  const now = new Date();
  const expiresAt = input.ttl_seconds !== undefined
    ? new Date(now.getTime() + input.ttl_seconds * 1000).toISOString()
    : null;
  const id = randomUUID();
  db.prepare(`
    INSERT INTO co_publish_invites
      (id, video_id, inviter_id, invitee_id, role, revenue_share_percent, message,
       status, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(id, input.video_id, input.inviter_id, input.invitee_id, role, share,
    input.message ?? null, expiresAt, now.toISOString(), now.toISOString());
  return getInvite(id)!;
}

export function getInvite(id: string): CoPublishInvite | null {
  return (getDb().prepare('SELECT * FROM co_publish_invites WHERE id = ?').get(id) as CoPublishInvite | undefined) ?? null;
}

export function listInvites(filter?: {
  video_id?: string;
  inviter_id?: string;
  invitee_id?: string;
  status?: InviteStatus;
  limit?: number;
}): CoPublishInvite[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter?.video_id) { where.push('video_id = ?'); args.push(filter.video_id); }
  if (filter?.inviter_id) { where.push('inviter_id = ?'); args.push(filter.inviter_id); }
  if (filter?.invitee_id) { where.push('invitee_id = ?'); args.push(filter.invitee_id); }
  if (filter?.status) { where.push('status = ?'); args.push(filter.status); }
  const sql = `SELECT * FROM co_publish_invites ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args) as CoPublishInvite[];
}

function respond(inviteId: string, actorId: string, next: 'accepted' | 'declined' | 'revoked'): CoPublishInvite {
  const inv = getInvite(inviteId);
  if (!inv) throw new Error('invite_not_found');
  if (inv.status !== 'pending') throw new Error('invite_not_pending');
  if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
    const db = getDb();
    db.prepare("UPDATE co_publish_invites SET status = 'expired', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), inviteId);
    throw new Error('invite_expired');
  }
  if (next === 'revoked') {
    if (actorId !== inv.inviter_id) throw new Error('inviter_only');
  } else {
    if (actorId !== inv.invitee_id) throw new Error('invitee_only');
  }
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE co_publish_invites SET status = ?, responded_at = ?, updated_at = ? WHERE id = ?
  `).run(next, now, now, inviteId);
  if (next === 'accepted') {
    upsertCredit({
      video_id: inv.video_id,
      user_id: inv.invitee_id,
      role: inv.role,
      revenue_share_percent: inv.revenue_share_percent,
    });
  }
  return getInvite(inviteId)!;
}

export function acceptInvite(id: string, actorId: string): CoPublishInvite { return respond(id, actorId, 'accepted'); }
export function declineInvite(id: string, actorId: string): CoPublishInvite { return respond(id, actorId, 'declined'); }
export function revokeInvite(id: string, actorId: string): CoPublishInvite { return respond(id, actorId, 'revoked'); }

// ---------- credits ----------
export interface CreditInput {
  video_id: string;
  user_id: string;
  display_name?: string | null;
  role: CoPublishRole;
  order_index?: number;
  revenue_share_percent?: number;
  is_public?: boolean;
}

export function upsertCredit(input: CreditInput): CoPublishCredit {
  if (!ROLES.includes(input.role)) throw new Error('invalid_role');
  const share = input.revenue_share_percent ?? 0;
  if (share < 0 || share > 100) throw new Error('invalid_share');
  if (share > 0) {
    const others = totalShare(input.video_id, input.user_id);
    if (others + share > 100) throw new Error('share_exceeds_100');
  }
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM co_publish_credits WHERE video_id = ? AND user_id = ?')
    .get(input.video_id, input.user_id) as CoPublishCredit | undefined;
  if (existing) {
    db.prepare(`
      UPDATE co_publish_credits SET display_name = ?, role = ?, order_index = ?,
        revenue_share_percent = ?, is_public = ?, updated_at = ?
      WHERE id = ?
    `).run(input.display_name ?? existing.display_name, input.role,
      input.order_index ?? existing.order_index, share,
      input.is_public === undefined ? existing.is_public : (input.is_public ? 1 : 0),
      now, existing.id);
    return getCredit(existing.id)!;
  }
  const id = randomUUID();
  db.prepare(`
    INSERT INTO co_publish_credits
      (id, video_id, user_id, display_name, role, order_index, revenue_share_percent, is_public, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.video_id, input.user_id, input.display_name ?? null, input.role,
    input.order_index ?? 0, share, input.is_public === false ? 0 : 1, now, now);
  return getCredit(id)!;
}

export function getCredit(id: string): CoPublishCredit | null {
  return (getDb().prepare('SELECT * FROM co_publish_credits WHERE id = ?').get(id) as CoPublishCredit | undefined) ?? null;
}

export function listCredits(videoId: string, publicOnly = false): CoPublishCredit[] {
  const db = getDb();
  if (publicOnly) {
    return db.prepare('SELECT * FROM co_publish_credits WHERE video_id = ? AND is_public = 1 ORDER BY order_index, created_at')
      .all(videoId) as CoPublishCredit[];
  }
  return db.prepare('SELECT * FROM co_publish_credits WHERE video_id = ? ORDER BY order_index, created_at')
    .all(videoId) as CoPublishCredit[];
}

export function deleteCredit(videoId: string, userId: string, actorId: string): boolean {
  const db = getDb();
  const c = db.prepare('SELECT * FROM co_publish_credits WHERE video_id = ? AND user_id = ?')
    .get(videoId, userId) as CoPublishCredit | undefined;
  if (!c) return false;
  // only the credit's owner can remove themselves; invites/removal of others handled elsewhere
  if (userId !== actorId) throw new Error('self_only');
  return db.prepare('DELETE FROM co_publish_credits WHERE id = ?').run(c.id).changes > 0;
}

export function reorderCredits(videoId: string, orderedUserIds: string[]): CoPublishCredit[] {
  const db = getDb();
  const now = new Date().toISOString();
  const tx = db.prepare('UPDATE co_publish_credits SET order_index = ?, updated_at = ? WHERE video_id = ? AND user_id = ?');
  for (let i = 0; i < orderedUserIds.length; i++) {
    tx.run(i, now, videoId, orderedUserIds[i]);
  }
  return listCredits(videoId, false);
}

// ---------- revenue split ----------
export interface RevenueSplit {
  video_id: string;
  total_allocated: number;
  platform_remainder: number;
  entries: { user_id: string; role: CoPublishRole; share_percent: number }[];
}

export function getRevenueSplit(videoId: string): RevenueSplit {
  const credits = listCredits(videoId, false);
  const total = credits.reduce((s, c) => s + c.revenue_share_percent, 0);
  return {
    video_id: videoId,
    total_allocated: total,
    platform_remainder: Math.max(0, 100 - total),
    entries: credits.map(c => ({
      user_id: c.user_id,
      role: c.role,
      share_percent: c.revenue_share_percent,
    })),
  };
}

// ---------- stats ----------
export interface CoPublishStats {
  total_invites: number;
  pending: number;
  accepted: number;
  declined: number;
  revoked: number;
  total_credits: number;
  videos_with_credits: number;
  avg_share_percent: number;
  by_role: Record<string, number>;
}

export function getCoPublishStats(): CoPublishStats {
  const db = getDb();
  const inv = db.prepare('SELECT status FROM co_publish_invites').all() as { status: string }[];
  const byStatus: Record<string, number> = {};
  for (const r of inv) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const credits = db.prepare('SELECT video_id, role, revenue_share_percent FROM co_publish_credits').all() as
    { video_id: string; role: string; revenue_share_percent: number }[];
  const byRole: Record<string, number> = {};
  const videos = new Set<string>();
  let sumShare = 0;
  for (const c of credits) {
    byRole[c.role] = (byRole[c.role] ?? 0) + 1;
    videos.add(c.video_id);
    sumShare += c.revenue_share_percent;
  }
  return {
    total_invites: inv.length,
    pending: byStatus.pending ?? 0,
    accepted: byStatus.accepted ?? 0,
    declined: byStatus.declined ?? 0,
    revoked: byStatus.revoked ?? 0,
    total_credits: credits.length,
    videos_with_credits: videos.size,
    avg_share_percent: credits.length ? sumShare / credits.length : 0,
    by_role: byRole,
  };
}
