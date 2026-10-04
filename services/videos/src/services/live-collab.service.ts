// melodyflix videos — Live Collaboration (Section 150)
// 150.1 Screen Share Room  150.2 Whiteboard  150.3 Remote Guest Invite
// 150.4 Scene Switching    150.5 Production Chat  150.6 Multi-Presenter
// Concept: StreamYard-style studio rooms with guests, scenes, and whiteboard.
import { randomUUID, createHash } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type RoomState = 'idle' | 'live' | 'ended';
export type ParticipantRole = 'host' | 'cohost' | 'guest' | 'viewer';
export type ParticipantState = 'invited' | 'joined' | 'left' | 'removed';
export type SceneSourceKind = 'camera' | 'screen' | 'video' | 'image' | 'text';
export type WhiteboardTool = 'pen' | 'line' | 'rect' | 'ellipse' | 'text' | 'eraser';

export interface CollabRoom {
  id: string;
  host_id: string;
  title: string;
  slug: string;
  state: RoomState;
  is_recording: number;
  room_url: string | null;
  started_at: string | null;
  ended_at: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface CollabParticipant {
  room_id: string;
  user_id: string;
  role: ParticipantRole;
  state: ParticipantState;
  display_name: string | null;
  stream_slot: number | null;
  is_muted: number;
  is_video_on: number;
  is_screen_sharing: number;
  joined_at: string | null;
  left_at: string | null;
  invited_at: string;
}

export interface GuestInvite {
  id: string;
  room_id: string;
  token_hash: string;
  token_prefix: string;
  invited_email: string | null;
  invited_name: string | null;
  role: ParticipantRole;
  created_by: string;
  expires_at: string;
  used_at: string | null;
  used_by: string | null;
  created_at: string;
}

export interface CollabScene {
  id: string;
  room_id: string;
  name: string;
  position: number;
  layout: string;         // 'grid' | 'spotlight' | 'side-by-side' | 'pip' | 'custom'
  sources_json: string;
  is_active: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SceneSource {
  slot: number;
  kind: SceneSourceKind;
  user_id?: string | null;
  label?: string | null;
  url?: string | null;
  position: { x: number; y: number; w: number; h: number };
}

export interface WhiteboardStroke {
  id: string;
  room_id: string;
  user_id: string;
  tool: WhiteboardTool;
  color: string;
  width: number;
  points_json: string;   // array of {x,y}
  text_content: string | null;
  is_deleted: number;
  sequence: number;
  created_at: string;
}

export interface ProductionChatMessage {
  id: string;
  room_id: string;
  user_id: string;
  body: string;
  is_pinned: number;
  mentions_json: string | null;
  created_at: string;
}

const MAX_INVITE_DAYS = 30;
const MAX_STROKES_PER_ROOM = 5000;

export function ensureLiveCollabSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS collab_rooms (
      id TEXT PRIMARY KEY,
      host_id TEXT NOT NULL,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
      state TEXT NOT NULL DEFAULT 'idle',
      is_recording INTEGER NOT NULL DEFAULT 0,
      room_url TEXT,
      started_at TEXT,
      ended_at TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_croom_host ON collab_rooms(host_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_croom_state ON collab_rooms(state, created_at DESC);

    CREATE TABLE IF NOT EXISTS collab_participants (
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'guest',
      state TEXT NOT NULL DEFAULT 'invited',
      display_name TEXT,
      stream_slot INTEGER,
      is_muted INTEGER NOT NULL DEFAULT 0,
      is_video_on INTEGER NOT NULL DEFAULT 1,
      is_screen_sharing INTEGER NOT NULL DEFAULT 0,
      joined_at TEXT,
      left_at TEXT,
      invited_at TEXT NOT NULL,
      PRIMARY KEY (room_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cpart_user ON collab_participants(user_id, invited_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cpart_room ON collab_participants(room_id, state);

    CREATE TABLE IF NOT EXISTS guest_invites (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      invited_email TEXT,
      invited_name TEXT,
      role TEXT NOT NULL DEFAULT 'guest',
      created_by TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      used_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ginv_room ON guest_invites(room_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ginv_expires ON guest_invites(expires_at);

    CREATE TABLE IF NOT EXISTS collab_scenes (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      layout TEXT NOT NULL DEFAULT 'grid',
      sources_json TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cscene_room ON collab_scenes(room_id, position);
    CREATE INDEX IF NOT EXISTS idx_cscene_active ON collab_scenes(room_id, is_active);

    CREATE TABLE IF NOT EXISTS whiteboard_strokes (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#000000',
      width REAL NOT NULL DEFAULT 2,
      points_json TEXT NOT NULL DEFAULT '[]',
      text_content TEXT,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      sequence INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wb_room ON whiteboard_strokes(room_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_wb_deleted ON whiteboard_strokes(room_id, is_deleted);

    CREATE TABLE IF NOT EXISTS production_chat (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      body TEXT NOT NULL,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      mentions_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pchat_room ON production_chat(room_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pchat_pinned ON production_chat(room_id, is_pinned);
  `);
}

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').slice(0, 80) || 'studio';
}

// ============================================================
// 150.1 — Rooms & participants
// ============================================================

export function createCollabRoom(input: {
  host_id: string;
  title: string;
  slug?: string;
  metadata?: Record<string, unknown> | null;
}): CollabRoom {
  const title = (input.title ?? '').trim();
  if (title.length < 3 || title.length > 200) throw new Error('title must be 3-200 chars');
  const db = getDb();
  const id = randomUUID();
  let slug = input.slug ? input.slug.toLowerCase() : slugify(title);
  let attempts = 0;
  while (db.prepare('SELECT 1 FROM collab_rooms WHERE slug = ?').get(slug)) {
    attempts += 1;
    slug = `${slugify(title)}-${attempts}`;
    if (attempts > 100) throw new Error('Cannot generate unique slug');
  }

  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO collab_rooms (id, host_id, title, slug, state, is_recording,
        room_url, started_at, ended_at, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'idle', 0, NULL, NULL, NULL, ?, ?, ?)
    `).run(id, input.host_id, title, slug,
      input.metadata ? JSON.stringify(input.metadata) : null, now, now);

    db.prepare(`
      INSERT INTO collab_participants (room_id, user_id, role, state, display_name,
        stream_slot, is_muted, is_video_on, is_screen_sharing, joined_at, left_at, invited_at)
      VALUES (?, ?, 'host', 'joined', NULL, 0, 0, 1, 0, ?, NULL, ?)
    `).run(id, input.host_id, now, now);

    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return getCollabRoom(id)!;
}

export function getCollabRoom(id: string): CollabRoom | null {
  return (getDb().prepare('SELECT * FROM collab_rooms WHERE id = ?').get(id) as CollabRoom | undefined) ?? null;
}

export function getCollabRoomBySlug(slug: string): CollabRoom | null {
  return (getDb().prepare('SELECT * FROM collab_rooms WHERE slug = ?').get(slug) as CollabRoom | undefined) ?? null;
}

export function listUserCollabRooms(userId: string, limit = 50): CollabRoom[] {
  return getDb().prepare(
    'SELECT * FROM collab_rooms WHERE host_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(userId, Math.min(Math.max(limit, 1), 200)) as CollabRoom[];
}

export function startCollabRoom(roomId: string, hostId: string, roomUrl?: string): CollabRoom {
  const db = getDb();
  const room = getCollabRoom(roomId);
  if (!room) throw new Error('Room not found');
  if (room.host_id !== hostId) throw new Error('Host only');
  if (room.state === 'live') return room;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE collab_rooms SET state = 'live', started_at = COALESCE(started_at, ?),
      room_url = COALESCE(?, room_url), updated_at = ? WHERE id = ?
  `).run(now, roomUrl ?? null, now, roomId);
  return getCollabRoom(roomId)!;
}

export function endCollabRoom(roomId: string, hostId: string): CollabRoom {
  const db = getDb();
  const room = getCollabRoom(roomId);
  if (!room) throw new Error('Room not found');
  if (room.host_id !== hostId) throw new Error('Host only');
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE collab_rooms SET state = 'ended', ended_at = ?, is_recording = 0, updated_at = ?
    WHERE id = ?
  `).run(now, now, roomId);
  return getCollabRoom(roomId)!;
}

export function setRoomRecording(roomId: string, hostId: string, recording: boolean): CollabRoom {
  const room = getCollabRoom(roomId);
  if (!room) throw new Error('Room not found');
  if (room.host_id !== hostId) throw new Error('Host only');
  const now = new Date().toISOString();
  getDb().prepare('UPDATE collab_rooms SET is_recording = ?, updated_at = ? WHERE id = ?')
    .run(recording ? 1 : 0, now, roomId);
  return getCollabRoom(roomId)!;
}

export function listCollabParticipants(roomId: string): CollabParticipant[] {
  return getDb().prepare(
    'SELECT * FROM collab_participants WHERE room_id = ? ORDER BY role ASC, invited_at ASC'
  ).all(roomId) as CollabParticipant[];
}

export function getCollabParticipant(roomId: string, userId: string): CollabParticipant | null {
  return (getDb().prepare(
    'SELECT * FROM collab_participants WHERE room_id = ? AND user_id = ?'
  ).get(roomId, userId) as CollabParticipant | undefined) ?? null;
}

export function addCollabParticipant(input: {
  room_id: string;
  user_id: string;
  role?: ParticipantRole;
  display_name?: string | null;
  stream_slot?: number | null;
  invited_by: string;
}): CollabParticipant {
  const db = getDb();
  const room = getCollabRoom(input.room_id);
  if (!room) throw new Error('Room not found');
  const inviter = getCollabParticipant(input.room_id, input.invited_by);
  if (!inviter || (inviter.role !== 'host' && inviter.role !== 'cohost')) {
    throw new Error('Host or cohost only');
  }

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO collab_participants (room_id, user_id, role, state, display_name,
      stream_slot, is_muted, is_video_on, is_screen_sharing, joined_at, left_at, invited_at)
    VALUES (?, ?, ?, 'invited', ?, ?, 0, 1, 0, NULL, NULL, ?)
    ON CONFLICT(room_id, user_id) DO UPDATE SET
      role = excluded.role,
      display_name = excluded.display_name,
      stream_slot = excluded.stream_slot,
      state = 'invited',
      invited_at = excluded.invited_at
  `).run(input.room_id, input.user_id, input.role ?? 'guest',
    input.display_name ?? null, input.stream_slot ?? null, now);
  return getCollabParticipant(input.room_id, input.user_id)!;
}

export function joinCollabRoom(roomId: string, userId: string): CollabParticipant {
  const db = getDb();
  const p = getCollabParticipant(roomId, userId);
  if (!p) throw new Error('Not invited to this room');
  if (p.state === 'removed') throw new Error('Removed from room');
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE collab_participants SET state = 'joined', joined_at = COALESCE(joined_at, ?), left_at = NULL
    WHERE room_id = ? AND user_id = ?
  `).run(now, roomId, userId);
  return getCollabParticipant(roomId, userId)!;
}

export function leaveCollabRoom(roomId: string, userId: string): CollabParticipant {
  const db = getDb();
  const p = getCollabParticipant(roomId, userId);
  if (!p) throw new Error('Not in this room');
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE collab_participants SET state = 'left', left_at = ?, is_screen_sharing = 0 WHERE room_id = ? AND user_id = ?"
  ).run(now, roomId, userId);
  return getCollabParticipant(roomId, userId)!;
}

export function updateCollabParticipant(roomId: string, requesterId: string, userId: string, patch: {
  role?: ParticipantRole;
  display_name?: string | null;
  stream_slot?: number | null;
  is_muted?: boolean;
  is_video_on?: boolean;
  is_screen_sharing?: boolean;
  state?: ParticipantState;
}): CollabParticipant {
  const db = getDb();
  const p = getCollabParticipant(roomId, userId);
  if (!p) throw new Error('Participant not found');
  const room = getCollabRoom(roomId);
  if (!room) throw new Error('Room not found');

  // Self-edit permitted for muted/video/screen; role/state only for host/cohost
  const isSelf = requesterId === userId;
  const requester = getCollabParticipant(roomId, requesterId);
  const canManage = requester && (requester.role === 'host' || requester.role === 'cohost');

  if (!isSelf && !canManage) throw new Error('Not authorized');
  if (!isSelf && !canManage) throw new Error('Not authorized');

  const fields: string[] = [];
  const params: any[] = [];
  if (patch.role !== undefined) {
    if (!canManage) throw new Error('Role change requires host/cohost');
    fields.push('role = ?'); params.push(patch.role);
  }
  if (patch.display_name !== undefined) { fields.push('display_name = ?'); params.push(patch.display_name); }
  if (patch.stream_slot !== undefined) {
    if (!canManage) throw new Error('Slot change requires host/cohost');
    fields.push('stream_slot = ?'); params.push(patch.stream_slot);
  }
  if (patch.is_muted !== undefined) { fields.push('is_muted = ?'); params.push(patch.is_muted ? 1 : 0); }
  if (patch.is_video_on !== undefined) { fields.push('is_video_on = ?'); params.push(patch.is_video_on ? 1 : 0); }
  if (patch.is_screen_sharing !== undefined) {
    fields.push('is_screen_sharing = ?'); params.push(patch.is_screen_sharing ? 1 : 0);
  }
  if (patch.state !== undefined) {
    if (!canManage) throw new Error('State change requires host/cohost');
    fields.push('state = ?'); params.push(patch.state);
  }
  if (fields.length === 0) return p;
  params.push(roomId, userId);
  db.prepare(`UPDATE collab_participants SET ${fields.join(', ')} WHERE room_id = ? AND user_id = ?`).run(...params);
  return getCollabParticipant(roomId, userId)!;
}

export function removeCollabParticipant(roomId: string, requesterId: string, userId: string): boolean {
  const db = getDb();
  const p = getCollabParticipant(roomId, userId);
  if (!p) return false;
  if (p.role === 'host') throw new Error('Cannot remove host');
  const requester = getCollabParticipant(roomId, requesterId);
  if (!requester || (requester.role !== 'host' && requester.role !== 'cohost')) {
    throw new Error('Host or cohost only');
  }
  const info = db.prepare('DELETE FROM collab_participants WHERE room_id = ? AND user_id = ?').run(roomId, userId);
  return Number(info.changes ?? 0) > 0;
}

// ============================================================
// 150.3 — Guest invites
// ============================================================

function generateGuestToken(): { raw: string; hash: string; prefix: string } {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const raw = 'MFLX-' + [block(), block(), block(), block()].join('-');
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash, prefix: raw.slice(0, 9) };
}

export function createGuestInvite(input: {
  room_id: string;
  created_by: string;
  role?: ParticipantRole;
  invited_email?: string | null;
  invited_name?: string | null;
  expires_in_days?: number;
}): { invite: GuestInvite; raw_token: string } {
  const room = getCollabRoom(input.room_id);
  if (!room) throw new Error('Room not found');
  const creator = getCollabParticipant(input.room_id, input.created_by);
  if (!creator || (creator.role !== 'host' && creator.role !== 'cohost')) {
    throw new Error('Host or cohost only');
  }
  const days = Math.min(Math.max(input.expires_in_days ?? 7, 1), MAX_INVITE_DAYS);
  const expiresAt = new Date(Date.now() + days * 86400_000).toISOString();

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const { raw, hash, prefix } = generateGuestToken();

  db.prepare(`
    INSERT INTO guest_invites (id, room_id, token_hash, token_prefix, invited_email,
      invited_name, role, created_by, expires_at, used_at, used_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
  `).run(id, input.room_id, hash, prefix,
    input.invited_email ?? null, input.invited_name ?? null,
    input.role ?? 'guest', input.created_by, expiresAt, now);

  return {
    invite: getGuestInvite(id)!,
    raw_token: raw,
  };
}

export function getGuestInvite(id: string): GuestInvite | null {
  return (getDb().prepare('SELECT * FROM guest_invites WHERE id = ?').get(id) as GuestInvite | undefined) ?? null;
}

export function listRoomInvites(roomId: string): GuestInvite[] {
  return getDb().prepare(
    'SELECT * FROM guest_invites WHERE room_id = ? ORDER BY created_at DESC LIMIT 200'
  ).all(roomId) as GuestInvite[];
}

export function redeemGuestInvite(rawToken: string, userId: string): {
  invite: GuestInvite;
  participant: CollabParticipant;
} {
  const clean = rawToken.trim().toUpperCase();
  if (!clean) throw new Error('token required');
  const hash = createHash('sha256').update(clean).digest('hex');
  const db = getDb();
  const invite = db.prepare('SELECT * FROM guest_invites WHERE token_hash = ?').get(hash) as GuestInvite | undefined;
  if (!invite) throw new Error('Invalid invite token');
  if (invite.used_at) throw new Error('Invite already used');
  if (new Date(invite.expires_at) < new Date()) throw new Error('Invite expired');

  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE guest_invites SET used_at = ?, used_by = ? WHERE id = ?')
      .run(now, userId, invite.id);
    const participant = addCollabParticipant({
      room_id: invite.room_id,
      user_id: userId,
      role: invite.role,
      display_name: invite.invited_name,
      invited_by: invite.created_by,
    });
    db.exec('COMMIT');
    return { invite: getGuestInvite(invite.id)!, participant };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function revokeGuestInvite(inviteId: string, requesterId: string): boolean {
  const db = getDb();
  const invite = getGuestInvite(inviteId);
  if (!invite) return false;
  if (invite.created_by !== requesterId) throw new Error('Not authorized');
  const info = db.prepare('DELETE FROM guest_invites WHERE id = ?').run(inviteId);
  return Number(info.changes ?? 0) > 0;
}

// ============================================================
// 150.4 — Scenes
// ============================================================

export function createScene(input: {
  room_id: string;
  created_by: string;
  name: string;
  layout?: string;
  sources?: SceneSource[];
  position?: number;
}): CollabScene {
  const name = (input.name ?? '').trim();
  if (name.length < 1 || name.length > 80) throw new Error('name must be 1-80 chars');
  const creator = getCollabParticipant(input.room_id, input.created_by);
  if (!creator || (creator.role !== 'host' && creator.role !== 'cohost')) {
    throw new Error('Host or cohost only');
  }
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO collab_scenes (id, room_id, name, position, layout, sources_json,
      is_active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `).run(id, input.room_id, name, input.position ?? 0, input.layout ?? 'grid',
    JSON.stringify(input.sources ?? []), input.created_by, now, now);
  return getScene(id)!;
}

export function getScene(id: string): CollabScene | null {
  return (getDb().prepare('SELECT * FROM collab_scenes WHERE id = ?').get(id) as CollabScene | undefined) ?? null;
}

export function listRoomScenes(roomId: string): CollabScene[] {
  return getDb().prepare(
    'SELECT * FROM collab_scenes WHERE room_id = ? ORDER BY position ASC, created_at ASC'
  ).all(roomId) as CollabScene[];
}

export function updateScene(sceneId: string, requesterId: string, patch: {
  name?: string;
  layout?: string;
  sources?: SceneSource[];
  position?: number;
}): CollabScene {
  const db = getDb();
  const scene = getScene(sceneId);
  if (!scene) throw new Error('Scene not found');
  const requester = getCollabParticipant(scene.room_id, requesterId);
  if (!requester || (requester.role !== 'host' && requester.role !== 'cohost')) {
    throw new Error('Host or cohost only');
  }
  const fields: string[] = [];
  const params: any[] = [];
  if (patch.name !== undefined) { fields.push('name = ?'); params.push(patch.name); }
  if (patch.layout !== undefined) { fields.push('layout = ?'); params.push(patch.layout); }
  if (patch.sources !== undefined) { fields.push('sources_json = ?'); params.push(JSON.stringify(patch.sources)); }
  if (patch.position !== undefined) { fields.push('position = ?'); params.push(patch.position); }
  if (fields.length === 0) return scene;
  fields.push('updated_at = ?'); params.push(new Date().toISOString());
  params.push(sceneId);
  db.prepare(`UPDATE collab_scenes SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getScene(sceneId)!;
}

export function activateScene(sceneId: string, requesterId: string): CollabScene {
  const db = getDb();
  const scene = getScene(sceneId);
  if (!scene) throw new Error('Scene not found');
  const requester = getCollabParticipant(scene.room_id, requesterId);
  if (!requester || (requester.role !== 'host' && requester.role !== 'cohost')) {
    throw new Error('Host or cohost only');
  }
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE collab_scenes SET is_active = 0, updated_at = ? WHERE room_id = ?')
      .run(now, scene.room_id);
    db.prepare('UPDATE collab_scenes SET is_active = 1, updated_at = ? WHERE id = ?')
      .run(now, sceneId);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return getScene(sceneId)!;
}

export function getActiveScene(roomId: string): CollabScene | null {
  return (getDb().prepare(
    'SELECT * FROM collab_scenes WHERE room_id = ? AND is_active = 1 LIMIT 1'
  ).get(roomId) as CollabScene | undefined) ?? null;
}

export function deleteScene(sceneId: string, requesterId: string): boolean {
  const db = getDb();
  const scene = getScene(sceneId);
  if (!scene) return false;
  const requester = getCollabParticipant(scene.room_id, requesterId);
  if (!requester || (requester.role !== 'host' && requester.role !== 'cohost')) {
    throw new Error('Host or cohost only');
  }
  const info = db.prepare('DELETE FROM collab_scenes WHERE id = ?').run(sceneId);
  return Number(info.changes ?? 0) > 0;
}

// ============================================================
// 150.2 — Whiteboard
// ============================================================

function nextStrokeSequence(roomId: string): number {
  const row = getDb().prepare(
    'SELECT COALESCE(MAX(sequence), 0) as max_seq FROM whiteboard_strokes WHERE room_id = ?'
  ).get(roomId) as { max_seq: number };
  return row.max_seq + 1;
}

export function addWhiteboardStroke(input: {
  room_id: string;
  user_id: string;
  tool: WhiteboardTool;
  points: Array<{ x: number; y: number }>;
  color?: string;
  width?: number;
  text_content?: string | null;
}): WhiteboardStroke {
  const room = getCollabRoom(input.room_id);
  if (!room) throw new Error('Room not found');
  const p = getCollabParticipant(input.room_id, input.user_id);
  if (!p || p.state !== 'joined') throw new Error('Must be joined to draw');

  const count = (getDb().prepare(
    'SELECT COUNT(*) as n FROM whiteboard_strokes WHERE room_id = ? AND is_deleted = 0'
  ).get(input.room_id) as { n: number }).n;
  if (count >= MAX_STROKES_PER_ROOM) throw new Error('Whiteboard stroke limit reached — clear some first');

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const seq = nextStrokeSequence(input.room_id);
  db.prepare(`
    INSERT INTO whiteboard_strokes (id, room_id, user_id, tool, color, width, points_json,
      text_content, is_deleted, sequence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(id, input.room_id, input.user_id, input.tool,
    input.color ?? '#000000', input.width ?? 2,
    JSON.stringify(input.points.slice(0, 5000)),
    input.text_content ?? null, seq, now);
  return getWhiteboardStroke(id)!;
}

export function getWhiteboardStroke(id: string): WhiteboardStroke | null {
  return (getDb().prepare('SELECT * FROM whiteboard_strokes WHERE id = ?').get(id) as WhiteboardStroke | undefined) ?? null;
}

export function listWhiteboardStrokes(roomId: string, opts: { since_sequence?: number; include_deleted?: boolean; limit?: number } = {}): WhiteboardStroke[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 1000, 1), MAX_STROKES_PER_ROOM);
  const filters: string[] = ['room_id = ?'];
  const params: any[] = [roomId];
  if (!opts.include_deleted) filters.push('is_deleted = 0');
  if (opts.since_sequence !== undefined) {
    filters.push('sequence > ?');
    params.push(opts.since_sequence);
  }
  params.push(limit);
  return db.prepare(
    `SELECT * FROM whiteboard_strokes WHERE ${filters.join(' AND ')} ORDER BY sequence ASC LIMIT ?`
  ).all(...params) as WhiteboardStroke[];
}

export function deleteWhiteboardStroke(strokeId: string, requesterId: string): boolean {
  const db = getDb();
  const s = getWhiteboardStroke(strokeId);
  if (!s) return false;
  const p = getCollabParticipant(s.room_id, requesterId);
  if (!p) throw new Error('Not in room');
  const canDelete = s.user_id === requesterId || p.role === 'host' || p.role === 'cohost';
  if (!canDelete) throw new Error('Not authorized');
  db.prepare('UPDATE whiteboard_strokes SET is_deleted = 1 WHERE id = ?').run(strokeId);
  return true;
}

export function clearWhiteboard(roomId: string, requesterId: string): number {
  const db = getDb();
  const p = getCollabParticipant(roomId, requesterId);
  if (!p || (p.role !== 'host' && p.role !== 'cohost')) throw new Error('Host or cohost only');
  const info = db.prepare(
    'UPDATE whiteboard_strokes SET is_deleted = 1 WHERE room_id = ? AND is_deleted = 0'
  ).run(roomId);
  return Number(info.changes ?? 0);
}

// ============================================================
// 150.5 — Production Chat
// ============================================================

export function sendProductionMessage(input: {
  room_id: string;
  user_id: string;
  body: string;
  mentions?: string[];
}): ProductionChatMessage {
  const body = (input.body ?? '').trim();
  if (body.length < 1 || body.length > 2000) throw new Error('body must be 1-2000 chars');
  const p = getCollabParticipant(input.room_id, input.user_id);
  if (!p) throw new Error('Not in room');
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO production_chat (id, room_id, user_id, body, is_pinned, mentions_json, created_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `).run(id, input.room_id, input.user_id, body,
    input.mentions && input.mentions.length ? JSON.stringify(input.mentions.slice(0, 30)) : null,
    now);
  return db.prepare('SELECT * FROM production_chat WHERE id = ?').get(id) as ProductionChatMessage;
}

export function listProductionChat(roomId: string, limit = 100): ProductionChatMessage[] {
  return getDb().prepare(
    'SELECT * FROM production_chat WHERE room_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(roomId, Math.min(Math.max(limit, 1), 500)) as ProductionChatMessage[];
}

export function pinProductionMessage(messageId: string, requesterId: string, pinned: boolean): ProductionChatMessage | null {
  const db = getDb();
  const msg = db.prepare('SELECT * FROM production_chat WHERE id = ?').get(messageId) as ProductionChatMessage | undefined;
  if (!msg) return null;
  const p = getCollabParticipant(msg.room_id, requesterId);
  if (!p || (p.role !== 'host' && p.role !== 'cohost')) throw new Error('Host or cohost only');
  db.prepare('UPDATE production_chat SET is_pinned = ? WHERE id = ?').run(pinned ? 1 : 0, messageId);
  return db.prepare('SELECT * FROM production_chat WHERE id = ?').get(messageId) as ProductionChatMessage;
}

export function listPinnedProduction(roomId: string): ProductionChatMessage[] {
  return getDb().prepare(
    'SELECT * FROM production_chat WHERE room_id = ? AND is_pinned = 1 ORDER BY created_at DESC'
  ).all(roomId) as ProductionChatMessage[];
}

export function deleteProductionMessage(messageId: string, requesterId: string): boolean {
  const db = getDb();
  const msg = db.prepare('SELECT * FROM production_chat WHERE id = ?').get(messageId) as ProductionChatMessage | undefined;
  if (!msg) return false;
  const p = getCollabParticipant(msg.room_id, requesterId);
  if (!p) throw new Error('Not in room');
  const canDelete = msg.user_id === requesterId || p.role === 'host' || p.role === 'cohost';
  if (!canDelete) throw new Error('Not authorized');
  return Number(db.prepare('DELETE FROM production_chat WHERE id = ?').run(messageId).changes ?? 0) > 0;
}

// ============================================================
// 150.6 — Multi-presenter layout
// ============================================================

export interface PresenterLayout {
  room_id: string;
  slots: Array<{
    slot: number;
    user_id: string | null;
    display_name: string | null;
    is_muted: boolean;
    is_video_on: boolean;
    is_screen_sharing: boolean;
    role: ParticipantRole;
  }>;
  active_scene_id: string | null;
  active_scene_name: string | null;
}

export function getPresenterLayout(roomId: string): PresenterLayout {
  const participants = listCollabParticipants(roomId);
  const active = getActiveScene(roomId);
  const slots = participants
    .filter((p) => p.state === 'joined')
    .sort((a, b) => {
      if (a.stream_slot === null && b.stream_slot === null) return a.invited_at.localeCompare(b.invited_at);
      if (a.stream_slot === null) return 1;
      if (b.stream_slot === null) return -1;
      return a.stream_slot - b.stream_slot;
    })
    .map((p, i) => ({
      slot: p.stream_slot ?? i,
      user_id: p.user_id,
      display_name: p.display_name,
      is_muted: p.is_muted === 1,
      is_video_on: p.is_video_on === 1,
      is_screen_sharing: p.is_screen_sharing === 1,
      role: p.role,
    }));

  return {
    room_id: roomId,
    slots,
    active_scene_id: active?.id ?? null,
    active_scene_name: active?.name ?? null,
  };
}

export function assignPresenterSlot(roomId: string, requesterId: string, userId: string, slot: number): CollabParticipant {
  if (slot < 0 || slot > 100) throw new Error('slot must be 0-100');
  return updateCollabParticipant(roomId, requesterId, userId, { stream_slot: slot });
}

// ============================================================
// Event builder for WS hookup
// ============================================================

export type CollabEventType =
  | 'room.started' | 'room.ended' | 'room.recording.toggled'
  | 'participant.joined' | 'participant.left' | 'participant.updated' | 'participant.removed'
  | 'guest.invited' | 'guest.redeemed'
  | 'scene.created' | 'scene.updated' | 'scene.activated' | 'scene.deleted'
  | 'whiteboard.stroke' | 'whiteboard.cleared'
  | 'chat.message' | 'chat.pinned';

export interface CollabEvent {
  id: string;
  type: CollabEventType;
  room_id: string;
  from_user: string;
  to_users: string[];
  payload: Record<string, unknown>;
  created_at: string;
}

export function buildCollabEvent(input: {
  type: CollabEventType;
  room_id: string;
  from_user: string;
  to_users?: string[];
  payload?: Record<string, unknown>;
}): CollabEvent {
  return {
    id: randomUUID(),
    type: input.type,
    room_id: input.room_id,
    from_user: input.from_user,
    to_users: input.to_users ?? [],
    payload: input.payload ?? {},
    created_at: new Date().toISOString(),
  };
}
