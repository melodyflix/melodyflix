// melodyflix videos - Section 15.3 Collaborative Playlist
// Multi-contributor playlists with roles/permissions, item voting,
// invites, and reorderable items.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type PlaylistVisibility = 'public' | 'unlisted' | 'private';
export type ContributorRole = 'owner' | 'editor' | 'contributor' | 'viewer';
export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'revoked';
export type VoteKind = 'up' | 'down';

const VISIBILITIES: PlaylistVisibility[] = ['public','unlisted','private'];
const ROLES: ContributorRole[] = ['owner','editor','contributor','viewer'];

export function ensureCollabPlaylistSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS collab_playlists (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      owner_id TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'private',
      is_collaborative INTEGER NOT NULL DEFAULT 1,
      allow_voting INTEGER NOT NULL DEFAULT 1,
      max_items INTEGER NOT NULL DEFAULT 500,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cpl_owner ON collab_playlists(owner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cpl_vis ON collab_playlists(visibility, updated_at DESC);

    CREATE TABLE IF NOT EXISTS collab_playlist_contributors (
      id TEXT PRIMARY KEY,
      playlist_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'contributor',
      can_add INTEGER NOT NULL DEFAULT 1,
      can_remove INTEGER NOT NULL DEFAULT 0,
      can_reorder INTEGER NOT NULL DEFAULT 0,
      invited_by TEXT,
      joined_at TEXT NOT NULL,
      UNIQUE (playlist_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cpl_contrib_user ON collab_playlist_contributors(user_id, joined_at DESC);

    CREATE TABLE IF NOT EXISTS collab_playlist_items (
      id TEXT PRIMARY KEY,
      playlist_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      added_by TEXT NOT NULL,
      votes_up INTEGER NOT NULL DEFAULT 0,
      votes_down INTEGER NOT NULL DEFAULT 0,
      added_at TEXT NOT NULL,
      UNIQUE (playlist_id, video_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cpl_item_list ON collab_playlist_items(playlist_id, position);

    CREATE TABLE IF NOT EXISTS collab_playlist_votes (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      vote TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (item_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cpl_vote_item ON collab_playlist_votes(item_id, vote);

    CREATE TABLE IF NOT EXISTS collab_playlist_invites (
      id TEXT PRIMARY KEY,
      playlist_id TEXT NOT NULL,
      inviter_id TEXT NOT NULL,
      invitee_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'contributor',
      status TEXT NOT NULL DEFAULT 'pending',
      responded_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cpl_inv_invitee ON collab_playlist_invites(invitee_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cpl_inv_playlist ON collab_playlist_invites(playlist_id, status);
  `);
}

export interface CollabPlaylist {
  id: string;
  title: string;
  description: string | null;
  owner_id: string;
  visibility: PlaylistVisibility;
  is_collaborative: number;
  allow_voting: number;
  max_items: number;
  created_at: string;
  updated_at: string;
}

export interface Contributor {
  id: string;
  playlist_id: string;
  user_id: string;
  role: ContributorRole;
  can_add: number;
  can_remove: number;
  can_reorder: number;
  invited_by: string | null;
  joined_at: string;
}

export interface PlaylistItem {
  id: string;
  playlist_id: string;
  video_id: string;
  position: number;
  added_by: string;
  votes_up: number;
  votes_down: number;
  added_at: string;
}

export interface PlaylistVote {
  id: string;
  item_id: string;
  user_id: string;
  vote: VoteKind;
  created_at: string;
}

export interface PlaylistInvite {
  id: string;
  playlist_id: string;
  inviter_id: string;
  invitee_id: string;
  role: ContributorRole;
  status: InviteStatus;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
}

// ---------- permission helpers ----------
function getContrib(playlistId: string, userId: string): Contributor | null {
  return (getDb().prepare('SELECT * FROM collab_playlist_contributors WHERE playlist_id = ? AND user_id = ?')
    .get(playlistId, userId) as Contributor | undefined) ?? null;
}

function canAddItems(playlistId: string, userId: string): boolean {
  const c = getContrib(playlistId, userId);
  if (!c) return false;
  return c.role === 'owner' || c.role === 'editor' || (c.role === 'contributor' && c.can_add === 1);
}
function canRemoveItems(playlistId: string, userId: string): boolean {
  const c = getContrib(playlistId, userId);
  if (!c) return false;
  return c.role === 'owner' || c.role === 'editor' || c.can_remove === 1;
}
function canReorderItems(playlistId: string, userId: string): boolean {
  const c = getContrib(playlistId, userId);
  if (!c) return false;
  return c.role === 'owner' || c.role === 'editor' || c.can_reorder === 1;
}
function isOwner(playlistId: string, userId: string): boolean {
  const p = getPlaylist(playlistId);
  return !!p && p.owner_id === userId;
}

// ---------- playlists ----------
export interface CreatePlaylistInput {
  title: string;
  description?: string | null;
  owner_id: string;
  visibility?: PlaylistVisibility;
  is_collaborative?: boolean;
  allow_voting?: boolean;
  max_items?: number;
}

export function createPlaylist(input: CreatePlaylistInput): CollabPlaylist {
  if (!input.title || input.title.length > 200) throw new Error('invalid_title');
  if (!input.owner_id) throw new Error('owner_required');
  const vis = input.visibility ?? 'private';
  if (!VISIBILITIES.includes(vis)) throw new Error('invalid_visibility');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO collab_playlists
      (id, title, description, owner_id, visibility, is_collaborative, allow_voting, max_items, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.title, input.description ?? null, input.owner_id, vis,
    input.is_collaborative === false ? 0 : 1,
    input.allow_voting === false ? 0 : 1,
    input.max_items ?? 500, now, now);
  db.prepare(`
    INSERT INTO collab_playlist_contributors
      (id, playlist_id, user_id, role, can_add, can_remove, can_reorder, joined_at)
    VALUES (?, ?, ?, 'owner', 1, 1, 1, ?)
  `).run(randomUUID(), id, input.owner_id, now);
  return getPlaylist(id)!;
}

export function getPlaylist(id: string): CollabPlaylist | null {
  return (getDb().prepare('SELECT * FROM collab_playlists WHERE id = ?').get(id) as CollabPlaylist | undefined) ?? null;
}

export function listPlaylists(filter?: { owner_id?: string; visibility?: PlaylistVisibility; limit?: number }): CollabPlaylist[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter?.owner_id) { where.push('owner_id = ?'); args.push(filter.owner_id); }
  if (filter?.visibility) { where.push('visibility = ?'); args.push(filter.visibility); }
  const sql = `SELECT * FROM collab_playlists ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY updated_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 200));
  return db.prepare(sql).all(...args) as CollabPlaylist[];
}

export function listUserPlaylists(userId: string, limit = 100): CollabPlaylist[] {
  return getDb().prepare(`
    SELECT p.* FROM collab_playlists p
    JOIN collab_playlist_contributors c ON c.playlist_id = p.id
    WHERE c.user_id = ?
    ORDER BY p.updated_at DESC LIMIT ?
  `).all(userId, Math.min(Math.max(limit, 1), 200)) as CollabPlaylist[];
}

export interface UpdatePlaylistInput {
  title?: string;
  description?: string | null;
  visibility?: PlaylistVisibility;
  is_collaborative?: boolean;
  allow_voting?: boolean;
  max_items?: number;
}

export function updatePlaylist(id: string, actorId: string, patch: UpdatePlaylistInput): CollabPlaylist | null {
  const p = getPlaylist(id);
  if (!p) return null;
  if (!isOwner(id, actorId)) throw new Error('owner_only');
  const fields: string[] = [];
  const args: any[] = [];
  if (patch.title !== undefined) { if (patch.title.length > 200) throw new Error('invalid_title'); fields.push('title = ?'); args.push(patch.title); }
  if (patch.description !== undefined) { fields.push('description = ?'); args.push(patch.description); }
  if (patch.visibility !== undefined) { if (!VISIBILITIES.includes(patch.visibility)) throw new Error('invalid_visibility'); fields.push('visibility = ?'); args.push(patch.visibility); }
  if (patch.is_collaborative !== undefined) { fields.push('is_collaborative = ?'); args.push(patch.is_collaborative ? 1 : 0); }
  if (patch.allow_voting !== undefined) { fields.push('allow_voting = ?'); args.push(patch.allow_voting ? 1 : 0); }
  if (patch.max_items !== undefined) { fields.push('max_items = ?'); args.push(patch.max_items); }
  if (!fields.length) return p;
  fields.push('updated_at = ?'); args.push(new Date().toISOString());
  args.push(id);
  getDb().prepare(`UPDATE collab_playlists SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  return getPlaylist(id);
}

export function deletePlaylist(id: string, actorId: string): boolean {
  if (!isOwner(id, actorId)) throw new Error('owner_only');
  const db = getDb();
  db.prepare('DELETE FROM collab_playlist_votes WHERE item_id IN (SELECT id FROM collab_playlist_items WHERE playlist_id = ?)').run(id);
  db.prepare('DELETE FROM collab_playlist_items WHERE playlist_id = ?').run(id);
  db.prepare('DELETE FROM collab_playlist_contributors WHERE playlist_id = ?').run(id);
  db.prepare('DELETE FROM collab_playlist_invites WHERE playlist_id = ?').run(id);
  return db.prepare('DELETE FROM collab_playlists WHERE id = ?').run(id).changes > 0;
}

// ---------- contributors ----------
export interface AddContributorInput {
  playlist_id: string;
  user_id: string;
  role?: ContributorRole;
  can_add?: boolean;
  can_remove?: boolean;
  can_reorder?: boolean;
  invited_by?: string | null;
}

export function addContributor(input: AddContributorInput): Contributor {
  const p = getPlaylist(input.playlist_id);
  if (!p) throw new Error('playlist_not_found');
  const role = input.role ?? 'contributor';
  if (!ROLES.includes(role)) throw new Error('invalid_role');
  if (role === 'owner') throw new Error('use_create_for_owner');
  const db = getDb();
  const now = new Date().toISOString();
  const existing = getContrib(input.playlist_id, input.user_id);
  if (existing) {
    db.prepare(`
      UPDATE collab_playlist_contributors SET role = ?, can_add = ?, can_remove = ?, can_reorder = ?
      WHERE id = ?
    `).run(role, input.can_add === undefined ? existing.can_add : (input.can_add ? 1 : 0),
      input.can_remove === undefined ? existing.can_remove : (input.can_remove ? 1 : 0),
      input.can_reorder === undefined ? existing.can_reorder : (input.can_reorder ? 1 : 0),
      existing.id);
    return getContrib(input.playlist_id, input.user_id)!;
  }
  const id = randomUUID();
  db.prepare(`
    INSERT INTO collab_playlist_contributors
      (id, playlist_id, user_id, role, can_add, can_remove, can_reorder, invited_by, joined_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.playlist_id, input.user_id, role,
    input.can_add === false ? 0 : 1,
    input.can_remove ? 1 : 0,
    input.can_reorder ? 1 : 0,
    input.invited_by ?? null, now);
  return getContrib(input.playlist_id, input.user_id)!;
}

export function updateContributor(playlistId: string, actorId: string, userId: string, patch: {
  role?: ContributorRole;
  can_add?: boolean;
  can_remove?: boolean;
  can_reorder?: boolean;
}): Contributor | null {
  const p = getPlaylist(playlistId);
  if (!p) return null;
  if (!isOwner(playlistId, actorId)) throw new Error('owner_only');
  const c = getContrib(playlistId, userId);
  if (!c) return null;
  if (c.role === 'owner') throw new Error('cannot_edit_owner');
  const fields: string[] = [];
  const args: any[] = [];
  if (patch.role !== undefined) {
    if (!ROLES.includes(patch.role) || patch.role === 'owner') throw new Error('invalid_role');
    fields.push('role = ?'); args.push(patch.role);
  }
  if (patch.can_add !== undefined) { fields.push('can_add = ?'); args.push(patch.can_add ? 1 : 0); }
  if (patch.can_remove !== undefined) { fields.push('can_remove = ?'); args.push(patch.can_remove ? 1 : 0); }
  if (patch.can_reorder !== undefined) { fields.push('can_reorder = ?'); args.push(patch.can_reorder ? 1 : 0); }
  if (!fields.length) return c;
  args.push(c.id);
  getDb().prepare(`UPDATE collab_playlist_contributors SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  return getContrib(playlistId, userId);
}

export function removeContributor(playlistId: string, actorId: string, userId: string): boolean {
  const p = getPlaylist(playlistId);
  if (!p) return false;
  if (!isOwner(playlistId, actorId)) throw new Error('owner_only');
  if (userId === p.owner_id) throw new Error('cannot_remove_owner');
  return getDb().prepare('DELETE FROM collab_playlist_contributors WHERE playlist_id = ? AND user_id = ?')
    .run(playlistId, userId).changes > 0;
}

export function listContributors(playlistId: string): Contributor[] {
  return getDb().prepare('SELECT * FROM collab_playlist_contributors WHERE playlist_id = ? ORDER BY joined_at')
    .all(playlistId) as Contributor[];
}

// ---------- items ----------
export interface AddItemInput {
  playlist_id: string;
  video_id: string;
  added_by: string;
  position?: number;
}

export function addItem(input: AddItemInput): PlaylistItem {
  const p = getPlaylist(input.playlist_id);
  if (!p) throw new Error('playlist_not_found');
  if (!canAddItems(input.playlist_id, input.added_by)) throw new Error('no_permission');
  const db = getDb();
  const existing = db.prepare('SELECT * FROM collab_playlist_items WHERE playlist_id = ? AND video_id = ?')
    .get(input.playlist_id, input.video_id) as PlaylistItem | undefined;
  if (existing) throw new Error('already_in_playlist');
  const count = db.prepare('SELECT COUNT(*) AS c FROM collab_playlist_items WHERE playlist_id = ?')
    .get(input.playlist_id) as { c: number };
  if (count.c >= p.max_items) throw new Error('playlist_full');
  const now = new Date().toISOString();
  const position = input.position ?? (count.c);
  const id = randomUUID();
  db.prepare(`
    INSERT INTO collab_playlist_items (id, playlist_id, video_id, position, added_by, added_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, input.playlist_id, input.video_id, position, input.added_by, now);
  // shift others if we're inserting in middle
  if (input.position !== undefined) {
    db.prepare(`
      UPDATE collab_playlist_items SET position = position + 1
      WHERE playlist_id = ? AND id != ? AND position >= ?
    `).run(input.playlist_id, id, input.position);
  }
  db.prepare('UPDATE collab_playlists SET updated_at = ? WHERE id = ?').run(now, input.playlist_id);
  return getItem(id)!;
}

export function getItem(id: string): PlaylistItem | null {
  return (getDb().prepare('SELECT * FROM collab_playlist_items WHERE id = ?').get(id) as PlaylistItem | undefined) ?? null;
}

export function listItems(playlistId: string, orderBy: 'position' | 'votes' = 'position'): PlaylistItem[] {
  const db = getDb();
  if (orderBy === 'votes') {
    return db.prepare(`
      SELECT * FROM collab_playlist_items WHERE playlist_id = ?
      ORDER BY (votes_up - votes_down) DESC, position ASC
    `).all(playlistId) as PlaylistItem[];
  }
  return db.prepare('SELECT * FROM collab_playlist_items WHERE playlist_id = ? ORDER BY position ASC')
    .all(playlistId) as PlaylistItem[];
}

export function removeItem(itemId: string, actorId: string): boolean {
  const db = getDb();
  const item = getItem(itemId);
  if (!item) return false;
  if (!canRemoveItems(item.playlist_id, actorId)) throw new Error('no_permission');
  db.prepare('DELETE FROM collab_playlist_votes WHERE item_id = ?').run(itemId);
  const ok = db.prepare('DELETE FROM collab_playlist_items WHERE id = ?').run(itemId).changes > 0;
  db.prepare('UPDATE collab_playlists SET updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), item.playlist_id);
  return ok;
}

export function reorderItems(playlistId: string, actorId: string, orderedItemIds: string[]): PlaylistItem[] {
  if (!canReorderItems(playlistId, actorId)) throw new Error('no_permission');
  const db = getDb();
  const now = new Date().toISOString();
  const tx = db.prepare('UPDATE collab_playlist_items SET position = ? WHERE id = ? AND playlist_id = ?');
  for (let i = 0; i < orderedItemIds.length; i++) tx.run(i, orderedItemIds[i], playlistId);
  db.prepare('UPDATE collab_playlists SET updated_at = ? WHERE id = ?').run(now, playlistId);
  return listItems(playlistId, 'position');
}

// ---------- voting ----------
export function voteItem(itemId: string, userId: string, vote: VoteKind): PlaylistItem {
  if (vote !== 'up' && vote !== 'down') throw new Error('invalid_vote');
  const item = getItem(itemId);
  if (!item) throw new Error('item_not_found');
  const p = getPlaylist(item.playlist_id);
  if (!p) throw new Error('playlist_not_found');
  if (!p.allow_voting) throw new Error('voting_disabled');
  if (!getContrib(item.playlist_id, userId) && p.visibility !== 'public') throw new Error('not_a_member');
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM collab_playlist_votes WHERE item_id = ? AND user_id = ?')
    .get(itemId, userId) as PlaylistVote | undefined;
  if (existing) {
    if (existing.vote === vote) {
      // toggle off
      db.prepare('DELETE FROM collab_playlist_votes WHERE id = ?').run(existing.id);
      db.prepare(`UPDATE collab_playlist_items SET votes_${vote} = votes_${vote} - 1 WHERE id = ?`).run(itemId);
    } else {
      // switch
      db.prepare('UPDATE collab_playlist_votes SET vote = ?, created_at = ? WHERE id = ?').run(vote, now, existing.id);
      db.prepare(`UPDATE collab_playlist_items SET votes_${existing.vote} = votes_${existing.vote} - 1, votes_${vote} = votes_${vote} + 1 WHERE id = ?`).run(itemId);
    }
  } else {
    db.prepare('INSERT INTO collab_playlist_votes (id, item_id, user_id, vote, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), itemId, userId, vote, now);
    db.prepare(`UPDATE collab_playlist_items SET votes_${vote} = votes_${vote} + 1 WHERE id = ?`).run(itemId);
  }
  return getItem(itemId)!;
}

// ---------- invites ----------
export interface InviteInput {
  playlist_id: string;
  inviter_id: string;
  invitee_id: string;
  role?: ContributorRole;
}

export function createInvite(input: InviteInput): PlaylistInvite {
  const p = getPlaylist(input.playlist_id);
  if (!p) throw new Error('playlist_not_found');
  if (!isOwner(input.playlist_id, input.inviter_id)) throw new Error('owner_only');
  if (input.inviter_id === input.invitee_id) throw new Error('cannot_invite_self');
  const role = input.role ?? 'contributor';
  if (!ROLES.includes(role) || role === 'owner') throw new Error('invalid_role');
  const db = getDb();
  const dupe = db.prepare(`SELECT 1 AS c FROM collab_playlist_invites
    WHERE playlist_id = ? AND invitee_id = ? AND status = 'pending'`)
    .get(input.playlist_id, input.invitee_id) as { c: number } | undefined;
  if (dupe) throw new Error('pending_invite_exists');
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO collab_playlist_invites
      (id, playlist_id, inviter_id, invitee_id, role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, input.playlist_id, input.inviter_id, input.invitee_id, role, now, now);
  return getInvite(id)!;
}

export function getInvite(id: string): PlaylistInvite | null {
  return (getDb().prepare('SELECT * FROM collab_playlist_invites WHERE id = ?').get(id) as PlaylistInvite | undefined) ?? null;
}

export function listInvites(filter?: { playlist_id?: string; invitee_id?: string; status?: InviteStatus; limit?: number }): PlaylistInvite[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter?.playlist_id) { where.push('playlist_id = ?'); args.push(filter.playlist_id); }
  if (filter?.invitee_id) { where.push('invitee_id = ?'); args.push(filter.invitee_id); }
  if (filter?.status) { where.push('status = ?'); args.push(filter.status); }
  const sql = `SELECT * FROM collab_playlist_invites ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args) as PlaylistInvite[];
}

function respondInvite(id: string, actorId: string, next: 'accepted' | 'declined' | 'revoked'): PlaylistInvite {
  const inv = getInvite(id);
  if (!inv) throw new Error('invite_not_found');
  if (inv.status !== 'pending') throw new Error('invite_not_pending');
  if (next === 'revoked') {
    if (actorId !== inv.inviter_id) throw new Error('inviter_only');
  } else {
    if (actorId !== inv.invitee_id) throw new Error('invitee_only');
  }
  const now = new Date().toISOString();
  getDb().prepare('UPDATE collab_playlist_invites SET status = ?, responded_at = ?, updated_at = ? WHERE id = ?')
    .run(next, now, now, id);
  if (next === 'accepted') {
    addContributor({ playlist_id: inv.playlist_id, user_id: inv.invitee_id, role: inv.role, invited_by: inv.inviter_id });
  }
  return getInvite(id)!;
}

export function acceptInvite(id: string, actorId: string): PlaylistInvite { return respondInvite(id, actorId, 'accepted'); }
export function declineInvite(id: string, actorId: string): PlaylistInvite { return respondInvite(id, actorId, 'declined'); }
export function revokeInvite(id: string, actorId: string): PlaylistInvite { return respondInvite(id, actorId, 'revoked'); }

// ---------- stats + summary ----------
export interface PlaylistSummary {
  playlist: CollabPlaylist;
  contributors_count: number;
  items_count: number;
  total_votes_up: number;
  total_votes_down: number;
}

export function getPlaylistSummary(playlistId: string): PlaylistSummary | null {
  const p = getPlaylist(playlistId);
  if (!p) return null;
  const db = getDb();
  const cCount = db.prepare('SELECT COUNT(*) AS c FROM collab_playlist_contributors WHERE playlist_id = ?')
    .get(playlistId) as { c: number };
  const agg = db.prepare(`
    SELECT COUNT(*) AS items, COALESCE(SUM(votes_up), 0) AS up, COALESCE(SUM(votes_down), 0) AS down
    FROM collab_playlist_items WHERE playlist_id = ?
  `).get(playlistId) as { items: number; up: number; down: number };
  return {
    playlist: p,
    contributors_count: cCount.c,
    items_count: agg.items,
    total_votes_up: agg.up,
    total_votes_down: agg.down,
  };
}

export interface CollabPlaylistStats {
  total_playlists: number;
  collaborative: number;
  total_contributors: number;
  total_items: number;
  total_votes: number;
  pending_invites: number;
  by_visibility: Record<string, number>;
}

export function getCollabPlaylistStats(): CollabPlaylistStats {
  const db = getDb();
  const lists = db.prepare('SELECT visibility, is_collaborative FROM collab_playlists').all() as
    { visibility: string; is_collaborative: number }[];
  const byVis: Record<string, number> = {};
  let collab = 0;
  for (const l of lists) {
    byVis[l.visibility] = (byVis[l.visibility] ?? 0) + 1;
    if (l.is_collaborative === 1) collab++;
  }
  const c = db.prepare('SELECT COUNT(*) AS c FROM collab_playlist_contributors').get() as { c: number };
  const it = db.prepare('SELECT COUNT(*) AS c FROM collab_playlist_items').get() as { c: number };
  const vt = db.prepare('SELECT COUNT(*) AS c FROM collab_playlist_votes').get() as { c: number };
  const inv = db.prepare("SELECT COUNT(*) AS c FROM collab_playlist_invites WHERE status = 'pending'").get() as { c: number };
  return {
    total_playlists: lists.length,
    collaborative: collab,
    total_contributors: c.c,
    total_items: it.c,
    total_votes: vt.c,
    pending_invites: inv.c,
    by_visibility: byVis,
  };
}
