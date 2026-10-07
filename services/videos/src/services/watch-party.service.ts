// melodyflix videos - Section 15.1 Watch Party
// Synchronized group viewing: parties, participants, playback state,
// invites, chat, and control-event log.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type PartyVisibility = 'public' | 'private' | 'invite';
export type PartyRole = 'host' | 'moderator' | 'viewer';
export type PartyControlAction = 'play' | 'pause' | 'seek' | 'rate' | 'end';

const VISIBILITIES: PartyVisibility[] = ['public','private','invite'];
const ROLES: PartyRole[] = ['host','moderator','viewer'];
const ACTIONS: PartyControlAction[] = ['play','pause','seek','rate','end'];

export function ensureWatchPartySchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS watch_parties (
      id TEXT PRIMARY KEY,
      room_code TEXT NOT NULL,
      host_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      title TEXT,
      visibility TEXT NOT NULL DEFAULT 'public',
      is_playing INTEGER NOT NULL DEFAULT 0,
      position_seconds REAL NOT NULL DEFAULT 0,
      playback_rate REAL NOT NULL DEFAULT 1,
      max_participants INTEGER NOT NULL DEFAULT 50,
      started_at TEXT,
      ended_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_party_room_code ON watch_parties(room_code);
    CREATE INDEX IF NOT EXISTS idx_party_host ON watch_parties(host_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_party_video ON watch_parties(video_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS watch_party_participants (
      id TEXT PRIMARY KEY,
      party_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      is_online INTEGER NOT NULL DEFAULT 1,
      joined_at TEXT NOT NULL,
      left_at TEXT,
      UNIQUE (party_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_party_part_user ON watch_party_participants(user_id, joined_at DESC);
    CREATE INDEX IF NOT EXISTS idx_party_part_party ON watch_party_participants(party_id, is_online);

    CREATE TABLE IF NOT EXISTS watch_party_invites (
      id TEXT PRIMARY KEY,
      party_id TEXT NOT NULL,
      code TEXT NOT NULL,
      created_by TEXT NOT NULL,
      expires_at TEXT,
      used_by TEXT,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_party_invite_code ON watch_party_invites(code);
    CREATE INDEX IF NOT EXISTS idx_party_invite_party ON watch_party_invites(party_id);

    CREATE TABLE IF NOT EXISTS watch_party_messages (
      id TEXT PRIMARY KEY,
      party_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_party_msg_party ON watch_party_messages(party_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS watch_party_events (
      id TEXT PRIMARY KEY,
      party_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      position_seconds REAL,
      playback_rate REAL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_party_event_party ON watch_party_events(party_id, created_at DESC);
  `);
}

// ---------- Types ----------
export interface WatchParty {
  id: string;
  room_code: string;
  host_id: string;
  video_id: string;
  title: string | null;
  visibility: PartyVisibility;
  is_playing: number;
  position_seconds: number;
  playback_rate: number;
  max_participants: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PartyParticipant {
  id: string;
  party_id: string;
  user_id: string;
  role: PartyRole;
  is_online: number;
  joined_at: string;
  left_at: string | null;
}

export interface PartyInvite {
  id: string;
  party_id: string;
  code: string;
  created_by: string;
  expires_at: string | null;
  used_by: string | null;
  used_at: string | null;
  created_at: string;
}

export interface PartyMessage {
  id: string;
  party_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

export interface PartyEvent {
  id: string;
  party_id: string;
  actor_id: string;
  action: PartyControlAction;
  position_seconds: number | null;
  playback_rate: number | null;
  created_at: string;
}

// ---------- Helpers ----------
function genCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function isController(partyId: string, userId: string): boolean {
  const db = getDb();
  const row = db.prepare(
    'SELECT role FROM watch_party_participants WHERE party_id = ? AND user_id = ?'
  ).get(partyId, userId) as { role: PartyRole } | undefined;
  return !!row && (row.role === 'host' || row.role === 'moderator');
}

// ---------- Parties ----------
export interface CreatePartyInput {
  host_id: string;
  video_id: string;
  title?: string | null;
  visibility?: PartyVisibility;
  max_participants?: number;
}

export function createParty(input: CreatePartyInput): WatchParty {
  if (!input.host_id) throw new Error('host_required');
  if (!input.video_id) throw new Error('video_required');
  const visibility = input.visibility ?? 'public';
  if (!VISIBILITIES.includes(visibility)) throw new Error('invalid_visibility');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  let code = genCode();
  for (let i = 0; i < 5; i++) {
    const clash = db.prepare('SELECT 1 AS c FROM watch_parties WHERE room_code = ?').get(code) as { c: number } | undefined;
    if (!clash) break;
    code = genCode();
  }
  db.prepare(`
    INSERT INTO watch_parties
      (id, room_code, host_id, video_id, title, visibility, is_playing, position_seconds, playback_rate,
       max_participants, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0, 1, ?, ?, ?)
  `).run(id, code, input.host_id, input.video_id, input.title ?? null, visibility,
    input.max_participants ?? 50, now, now);
  db.prepare(`
    INSERT INTO watch_party_participants (id, party_id, user_id, role, is_online, joined_at)
    VALUES (?, ?, ?, 'host', 1, ?)
  `).run(randomUUID(), id, input.host_id, now);
  return getParty(id)!;
}

export function getParty(id: string): WatchParty | null {
  return (getDb().prepare('SELECT * FROM watch_parties WHERE id = ?').get(id) as WatchParty | undefined) ?? null;
}

export function getPartyByCode(code: string): WatchParty | null {
  return (getDb().prepare('SELECT * FROM watch_parties WHERE room_code = ?').get(code) as WatchParty | undefined) ?? null;
}

export function listMyParties(userId: string, limit = 50): WatchParty[] {
  return getDb().prepare(`
    SELECT p.* FROM watch_parties p
    JOIN watch_party_participants w ON w.party_id = p.id
    WHERE w.user_id = ?
    ORDER BY p.created_at DESC LIMIT ?
  `).all(userId, Math.min(Math.max(limit, 1), 200)) as WatchParty[];
}

export function listActiveParties(filter?: { visibility?: PartyVisibility; video_id?: string; limit?: number }): WatchParty[] {
  const db = getDb();
  const where: string[] = ["ended_at IS NULL"];
  const args: any[] = [];
  if (filter?.visibility) { where.push('visibility = ?'); args.push(filter.visibility); }
  if (filter?.video_id) { where.push('video_id = ?'); args.push(filter.video_id); }
  const sql = `SELECT * FROM watch_parties WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 200));
  return db.prepare(sql).all(...args) as WatchParty[];
}

export function startParty(partyId: string, actorId: string): WatchParty {
  const p = getParty(partyId);
  if (!p) throw new Error('party_not_found');
  if (p.host_id !== actorId) throw new Error('host_only');
  if (p.ended_at) throw new Error('already_ended');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE watch_parties SET started_at = COALESCE(started_at, ?), is_playing = 1, updated_at = ?
    WHERE id = ?
  `).run(now, now, partyId);
  logEvent(partyId, actorId, 'play', p.position_seconds, p.playback_rate);
  return getParty(partyId)!;
}

export function endParty(partyId: string, actorId: string): WatchParty {
  const p = getParty(partyId);
  if (!p) throw new Error('party_not_found');
  if (p.host_id !== actorId) throw new Error('host_only');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE watch_parties SET ended_at = ?, is_playing = 0, updated_at = ?
    WHERE id = ?
  `).run(now, now, partyId);
  db.prepare(`
    UPDATE watch_party_participants SET is_online = 0, left_at = COALESCE(left_at, ?)
    WHERE party_id = ?
  `).run(now, partyId);
  logEvent(partyId, actorId, 'end', p.position_seconds, p.playback_rate);
  return getParty(partyId)!;
}

// ---------- Playback state ----------
export interface PlaybackInput {
  is_playing?: boolean;
  position_seconds?: number;
  playback_rate?: number;
}

export function setPlaybackState(partyId: string, actorId: string, input: PlaybackInput): WatchParty {
  const p = getParty(partyId);
  if (!p) throw new Error('party_not_found');
  if (p.ended_at) throw new Error('party_ended');
  if (!isController(partyId, actorId)) throw new Error('controller_only');
  if (input.position_seconds !== undefined && (input.position_seconds < 0 || input.position_seconds > 86400)) {
    throw new Error('invalid_position');
  }
  if (input.playback_rate !== undefined && (input.playback_rate <= 0 || input.playback_rate > 4)) {
    throw new Error('invalid_rate');
  }
  const db = getDb();
  const now = new Date().toISOString();
  const nextPlaying = input.is_playing === undefined ? p.is_playing : (input.is_playing ? 1 : 0);
  const nextPos = input.position_seconds ?? p.position_seconds;
  const nextRate = input.playback_rate ?? p.playback_rate;
  db.prepare(`
    UPDATE watch_parties SET is_playing = ?, position_seconds = ?, playback_rate = ?, updated_at = ?
    WHERE id = ?
  `).run(nextPlaying, nextPos, nextRate, now, partyId);
  // log event
  if (input.playback_rate !== undefined && input.playback_rate !== p.playback_rate) {
    logEvent(partyId, actorId, 'rate', nextPos, nextRate);
  }
  if (input.position_seconds !== undefined && input.position_seconds !== p.position_seconds) {
    logEvent(partyId, actorId, 'seek', nextPos, nextRate);
  }
  if (input.is_playing !== undefined && (input.is_playing ? 1 : 0) !== p.is_playing) {
    logEvent(partyId, actorId, nextPlaying ? 'play' : 'pause', nextPos, nextRate);
  }
  return getParty(partyId)!;
}

// ---------- Participants ----------
export interface JoinResult {
  party: WatchParty;
  participant: PartyParticipant;
  created: boolean;
}

export function joinParty(partyId: string, userId: string, role: PartyRole = 'viewer'): JoinResult {
  const p = getParty(partyId);
  if (!p) throw new Error('party_not_found');
  if (p.ended_at) throw new Error('party_ended');
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM watch_party_participants WHERE party_id = ? AND user_id = ?')
    .get(partyId, userId) as PartyParticipant | undefined;
  if (existing) {
    db.prepare(`
      UPDATE watch_party_participants SET is_online = 1, left_at = NULL WHERE id = ?
    `).run(existing.id);
    return { party: p, participant: db.prepare('SELECT * FROM watch_party_participants WHERE id = ?').get(existing.id) as PartyParticipant, created: false };
  }
  const online = db.prepare('SELECT COUNT(*) AS c FROM watch_party_participants WHERE party_id = ? AND is_online = 1')
    .get(partyId) as { c: number };
  if (online.c >= p.max_participants) throw new Error('party_full');
  if (!ROLES.includes(role)) throw new Error('invalid_role');
  const id = randomUUID();
  db.prepare(`
    INSERT INTO watch_party_participants (id, party_id, user_id, role, is_online, joined_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(id, partyId, userId, role, now);
  return { party: p, participant: db.prepare('SELECT * FROM watch_party_participants WHERE id = ?').get(id) as PartyParticipant, created: true };
}

export function leaveParty(partyId: string, userId: string): PartyParticipant | null {
  const db = getDb();
  const now = new Date().toISOString();
  const row = db.prepare('SELECT * FROM watch_party_participants WHERE party_id = ? AND user_id = ?')
    .get(partyId, userId) as PartyParticipant | undefined;
  if (!row) return null;
  db.prepare(`
    UPDATE watch_party_participants SET is_online = 0, left_at = ? WHERE id = ?
  `).run(now, row.id);
  return db.prepare('SELECT * FROM watch_party_participants WHERE id = ?').get(row.id) as PartyParticipant;
}

export function setRole(partyId: string, actorId: string, userId: string, role: PartyRole): PartyParticipant | null {
  const p = getParty(partyId);
  if (!p) throw new Error('party_not_found');
  if (p.host_id !== actorId) throw new Error('host_only');
  if (!ROLES.includes(role)) throw new Error('invalid_role');
  if (userId === p.host_id) throw new Error('cannot_change_host_role');
  const db = getDb();
  const row = db.prepare('SELECT * FROM watch_party_participants WHERE party_id = ? AND user_id = ?')
    .get(partyId, userId) as PartyParticipant | undefined;
  if (!row) return null;
  db.prepare('UPDATE watch_party_participants SET role = ? WHERE id = ?').run(role, row.id);
  return db.prepare('SELECT * FROM watch_party_participants WHERE id = ?').get(row.id) as PartyParticipant;
}

export function kickParticipant(partyId: string, actorId: string, userId: string): boolean {
  const p = getParty(partyId);
  if (!p) throw new Error('party_not_found');
  if (p.host_id !== actorId && !isController(partyId, actorId)) throw new Error('controller_only');
  if (userId === p.host_id) throw new Error('cannot_kick_host');
  const r = getDb().prepare('DELETE FROM watch_party_participants WHERE party_id = ? AND user_id = ?')
    .run(partyId, userId);
  return r.changes > 0;
}

export function listParticipants(partyId: string, onlineOnly = false): PartyParticipant[] {
  const db = getDb();
  if (onlineOnly) {
    return db.prepare('SELECT * FROM watch_party_participants WHERE party_id = ? AND is_online = 1 ORDER BY joined_at')
      .all(partyId) as PartyParticipant[];
  }
  return db.prepare('SELECT * FROM watch_party_participants WHERE party_id = ? ORDER BY joined_at')
    .all(partyId) as PartyParticipant[];
}

// ---------- Invites ----------
export interface InviteInput {
  party_id: string;
  created_by: string;
  ttl_seconds?: number;
}

export function createInvite(input: InviteInput): PartyInvite {
  const p = getParty(input.party_id);
  if (!p) throw new Error('party_not_found');
  if (p.host_id !== input.created_by && !isController(input.party_id, input.created_by)) {
    throw new Error('controller_only');
  }
  const db = getDb();
  const now = new Date();
  const id = randomUUID();
  let code = genCode();
  for (let i = 0; i < 5; i++) {
    const clash = db.prepare('SELECT 1 AS c FROM watch_party_invites WHERE code = ?').get(code) as { c: number } | undefined;
    if (!clash) break;
    code = genCode();
  }
  const expiresAt = input.ttl_seconds !== undefined
    ? new Date(now.getTime() + input.ttl_seconds * 1000).toISOString()
    : null;
  db.prepare(`
    INSERT INTO watch_party_invites (id, party_id, code, created_by, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, input.party_id, code, input.created_by, expiresAt, now.toISOString());
  return getInvite(id)!;
}

export function getInvite(id: string): PartyInvite | null {
  return (getDb().prepare('SELECT * FROM watch_party_invites WHERE id = ?').get(id) as PartyInvite | undefined) ?? null;
}

export function listInvites(partyId: string): PartyInvite[] {
  return getDb().prepare('SELECT * FROM watch_party_invites WHERE party_id = ? ORDER BY created_at DESC')
    .all(partyId) as PartyInvite[];
}

export function redeemInvite(code: string, userId: string): JoinResult {
  const db = getDb();
  const invite = db.prepare('SELECT * FROM watch_party_invites WHERE code = ?').get(code) as PartyInvite | undefined;
  if (!invite) throw new Error('invite_not_found');
  if (invite.used_by) throw new Error('invite_already_used');
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) throw new Error('invite_expired');
  const res = joinParty(invite.party_id, userId, 'viewer');
  const now = new Date().toISOString();
  db.prepare('UPDATE watch_party_invites SET used_by = ?, used_at = ? WHERE id = ?').run(userId, now, invite.id);
  return res;
}

// ---------- Chat ----------
export function sendMessage(partyId: string, userId: string, body: string): PartyMessage {
  if (!body || body.length > 2000) throw new Error('invalid_body');
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO watch_party_messages (id, party_id, user_id, body, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, partyId, userId, body, now);
  return db.prepare('SELECT * FROM watch_party_messages WHERE id = ?').get(id) as PartyMessage;
}

export function listMessages(partyId: string, limit = 100): PartyMessage[] {
  return getDb().prepare('SELECT * FROM watch_party_messages WHERE party_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(partyId, Math.min(Math.max(limit, 1), 500)) as PartyMessage[];
}

export function deleteMessage(id: string, actorId: string): boolean {
  const db = getDb();
  const m = db.prepare('SELECT * FROM watch_party_messages WHERE id = ?').get(id) as PartyMessage | undefined;
  if (!m) return false;
  const p = getParty(m.party_id);
  if (!p) return false;
  if (m.user_id !== actorId && p.host_id !== actorId && !isController(m.party_id, actorId)) {
    throw new Error('not_allowed');
  }
  return db.prepare('DELETE FROM watch_party_messages WHERE id = ?').run(id).changes > 0;
}

// ---------- Events ----------
export function logEvent(partyId: string, actorId: string, action: PartyControlAction, position?: number | null, rate?: number | null): PartyEvent {
  if (!ACTIONS.includes(action)) throw new Error('invalid_action');
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO watch_party_events (id, party_id, actor_id, action, position_seconds, playback_rate, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, partyId, actorId, action, position ?? null, rate ?? null, now);
  return db.prepare('SELECT * FROM watch_party_events WHERE id = ?').get(id) as PartyEvent;
}

export function listEvents(partyId: string, limit = 100): PartyEvent[] {
  return getDb().prepare('SELECT * FROM watch_party_events WHERE party_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(partyId, Math.min(Math.max(limit, 1), 500)) as PartyEvent[];
}

// ---------- State snapshot ----------
export interface PartyState {
  party: WatchParty;
  participants_online: number;
  participants_total: number;
  recent_events: PartyEvent[];
}

export function getPartyState(partyId: string): PartyState | null {
  const p = getParty(partyId);
  if (!p) return null;
  const parts = listParticipants(partyId, false);
  return {
    party: p,
    participants_online: parts.filter(x => x.is_online === 1).length,
    participants_total: parts.length,
    recent_events: listEvents(partyId, 10),
  };
}

// ---------- Stats ----------
export interface WatchPartyStats {
  total_parties: number;
  active_parties: number;
  ended_parties: number;
  total_participants: number;
  online_participants: number;
  total_messages: number;
  by_visibility: Record<string, number>;
}

export function getWatchPartyStats(): WatchPartyStats {
  const db = getDb();
  const parties = db.prepare('SELECT visibility, ended_at, started_at FROM watch_parties').all() as
    { visibility: string; ended_at: string | null; started_at: string | null }[];
  const byVis: Record<string, number> = {};
  let active = 0, ended = 0;
  for (const p of parties) {
    byVis[p.visibility] = (byVis[p.visibility] ?? 0) + 1;
    if (p.ended_at) ended++;
    else active++;
  }
  const parts = db.prepare('SELECT COUNT(*) AS c, SUM(is_online) AS o FROM watch_party_participants').get() as
    { c: number; o: number | null };
  const msgs = db.prepare('SELECT COUNT(*) AS c FROM watch_party_messages').get() as { c: number };
  return {
    total_parties: parties.length,
    active_parties: active,
    ended_parties: ended,
    total_participants: parts.c,
    online_participants: parts.o ?? 0,
    total_messages: msgs.c,
    by_visibility: byVis,
  };
}
