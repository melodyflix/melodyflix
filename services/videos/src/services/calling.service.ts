// melodyflix videos — Voice & Video Calling (Section 146)
// 146.1-146.4 1-to-1 + Group Voice/Video  146.5 Recording  146.6 Screen Share
// 146.7 Call History  146.8 DND / Block
// Design: DB-backed call state + signaling event models (WS hookup later).
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';
import {
  getIntegrationConfigRaw, isIntegrationReady,
} from './integration-settings.service.js';

export type CallType = 'voice' | 'video';
export type CallScope = 'direct' | 'group';
export type CallState = 'ringing' | 'active' | 'ended' | 'missed' | 'declined' | 'cancelled' | 'failed';
export type ParticipantState = 'invited' | 'ringing' | 'accepted' | 'declined' | 'left' | 'missed';
export type DndScope = 'all' | 'unknown_only' | 'nobody';

export interface Call {
  id: string;
  initiator_id: string;
  call_type: CallType;
  scope: CallScope;
  state: CallState;
  room_id: string;
  is_recording: number;
  recording_url: string | null;
  duration_seconds: number;
  started_at: string;
  accepted_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
  metadata_json: string | null;
  created_at: string;
}

export interface CallParticipant {
  call_id: string;
  user_id: string;
  state: ParticipantState;
  is_screen_sharing: number;
  joined_at: string | null;
  left_at: string | null;
  invited_at: string;
}

export interface CallBlock {
  user_id: string;
  blocked_user_id: string;
  reason: string | null;
  created_at: string;
}

export interface CallDnd {
  user_id: string;
  is_enabled: number;
  scope: DndScope;
  allow_from: string | null;   // JSON array of user ids
  updated_at: string;
}

export interface CallHistoryItem extends Call {
  participants: Array<Pick<CallParticipant, 'user_id' | 'state'>>;
}

export interface CallRecording {
  id: string;
  call_id: string;
  storage_url: string;
  file_size_bytes: number | null;
  duration_seconds: number;
  recorded_by: string;
  created_at: string;
}

const MAX_GROUP_PARTICIPANTS = 50;

export function ensureCallingSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY,
      initiator_id TEXT NOT NULL,
      call_type TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'direct',
      state TEXT NOT NULL DEFAULT 'ringing',
      room_id TEXT NOT NULL UNIQUE,
      is_recording INTEGER NOT NULL DEFAULT 0,
      recording_url TEXT,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      accepted_at TEXT,
      ended_at TEXT,
      end_reason TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_calls_initiator ON calls(initiator_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_calls_state ON calls(state, started_at DESC);

    CREATE TABLE IF NOT EXISTS call_participants (
      call_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'invited',
      is_screen_sharing INTEGER NOT NULL DEFAULT 0,
      joined_at TEXT,
      left_at TEXT,
      invited_at TEXT NOT NULL,
      PRIMARY KEY (call_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cpart_user ON call_participants(user_id, invited_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cpart_call ON call_participants(call_id);

    CREATE TABLE IF NOT EXISTS call_blocks (
      user_id TEXT NOT NULL,
      blocked_user_id TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, blocked_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_callblock_blocked ON call_blocks(blocked_user_id);

    CREATE TABLE IF NOT EXISTS call_dnd (
      user_id TEXT PRIMARY KEY,
      is_enabled INTEGER NOT NULL DEFAULT 0,
      scope TEXT NOT NULL DEFAULT 'nobody',
      allow_from TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webrtc_signals (
      id TEXT PRIMARY KEY,
      call_id TEXT NOT NULL,
      from_user TEXT NOT NULL,
      to_user TEXT NOT NULL,
      signal_type TEXT NOT NULL
        CHECK (signal_type IN ('webrtc.offer','webrtc.answer','webrtc.ice')),
      payload TEXT NOT NULL,
      delivered_at TEXT,
      consumed_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wsig_to ON webrtc_signals(to_user, consumed_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_wsig_call ON webrtc_signals(call_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS webrtc_peers (
      id TEXT PRIMARY KEY,
      call_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      connection_state TEXT NOT NULL DEFAULT 'new'
        CHECK (connection_state IN ('new','connecting','connected','disconnected','failed','closed')),
      sdp_state TEXT NOT NULL DEFAULT 'idle'
        CHECK (sdp_state IN ('idle','have_local_offer','have_remote_offer','stable','failed')),
      ice_gathering_state TEXT NOT NULL DEFAULT 'new'
        CHECK (ice_gathering_state IN ('new','gathering','complete','closed')),
      ice_candidate_count INTEGER NOT NULL DEFAULT 0,
      last_connected_at TEXT,
      last_signal_at TEXT,
      rtt_ms INTEGER,
      packet_loss_pct REAL,
      bitrate_kbps INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (call_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_wp_call ON webrtc_peers(call_id);
    CREATE INDEX IF NOT EXISTS idx_wp_user ON webrtc_peers(user_id);

    CREATE TABLE IF NOT EXISTS call_recordings (
      id TEXT PRIMARY KEY,
      call_id TEXT NOT NULL,
      storage_url TEXT NOT NULL,
      file_size_bytes INTEGER,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      recorded_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_crec_call ON call_recordings(call_id);
  `);
}

// ============================================================
// 146.8 — DND & Block helpers (checked before placing calls)
// ============================================================

export function isBlocked(userId: string, byUserId: string): boolean {
  const row = getDb().prepare(
    'SELECT 1 FROM call_blocks WHERE user_id = ? AND blocked_user_id = ? LIMIT 1'
  ).get(byUserId, userId);
  return !!row;
}

export function blockUserFromCalls(userId: string, blockedUserId: string, reason?: string | null): CallBlock {
  if (userId === blockedUserId) throw new Error('Cannot block yourself');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO call_blocks (user_id, blocked_user_id, reason, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, blocked_user_id) DO UPDATE SET
      reason = excluded.reason
  `).run(userId, blockedUserId, reason ?? null, now);
  return db.prepare('SELECT * FROM call_blocks WHERE user_id = ? AND blocked_user_id = ?')
    .get(userId, blockedUserId) as CallBlock;
}

export function unblockUserFromCalls(userId: string, blockedUserId: string): boolean {
  const info = getDb().prepare(
    'DELETE FROM call_blocks WHERE user_id = ? AND blocked_user_id = ?'
  ).run(userId, blockedUserId);
  return Number(info.changes ?? 0) > 0;
}

export function listCallBlocks(userId: string): CallBlock[] {
  return getDb().prepare(
    'SELECT * FROM call_blocks WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId) as CallBlock[];
}

export function setDnd(userId: string, input: {
  is_enabled: boolean;
  scope?: DndScope;
  allow_from?: string[];
}): CallDnd {
  const db = getDb();
  const now = new Date().toISOString();
  const allowJson = input.allow_from ? JSON.stringify(input.allow_from.slice(0, 500)) : null;
  db.prepare(`
    INSERT INTO call_dnd (user_id, is_enabled, scope, allow_from, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      is_enabled = excluded.is_enabled,
      scope = excluded.scope,
      allow_from = excluded.allow_from,
      updated_at = excluded.updated_at
  `).run(userId, input.is_enabled ? 1 : 0, input.scope ?? 'nobody', allowJson, now);
  return getDnd(userId)!;
}

export function getDnd(userId: string): CallDnd | null {
  return (getDb().prepare('SELECT * FROM call_dnd WHERE user_id = ?').get(userId) as CallDnd | undefined) ?? null;
}

/** Returns true if caller is allowed to ring `userId` right now. */
export function canRingUser(userId: string, callerId: string): { allowed: boolean; reason?: string } {
  if (isBlocked(callerId, userId)) {
    return { allowed: false, reason: 'blocked' };
  }
  const dnd = getDnd(userId);
  if (!dnd || dnd.is_enabled !== 1) return { allowed: true };

  if (dnd.scope === 'all') return { allowed: false, reason: 'dnd_all' };
  if (dnd.scope === 'nobody') {
    const allow = dnd.allow_from ? (JSON.parse(dnd.allow_from) as string[]) : [];
    if (allow.includes(callerId)) return { allowed: true };
    return { allowed: false, reason: 'dnd_nobody' };
  }
  // unknown_only → allow known contacts (deferred — treat as allow)
  return { allowed: true };
}

// ============================================================
// 146.1-146.4 — Create call
// ============================================================

export function createCall(input: {
  initiator_id: string;
  call_type: CallType;
  participant_ids: string[];
  scope?: CallScope;
  metadata?: Record<string, unknown> | null;
}): { call: Call; participants: CallParticipant[]; blocked_participants: string[] } {
  if (input.call_type !== 'voice' && input.call_type !== 'video') {
    throw new Error('call_type must be voice or video');
  }
  const uniqueParticipants = Array.from(new Set(input.participant_ids.filter((id) => id !== input.initiator_id)));
  if (uniqueParticipants.length === 0) throw new Error('At least one participant required');

  const scope: CallScope = input.scope ?? (uniqueParticipants.length === 1 ? 'direct' : 'group');
  if (scope === 'direct' && uniqueParticipants.length !== 1) {
    throw new Error('Direct calls have exactly one participant');
  }
  if (scope === 'group') {
    if (uniqueParticipants.length > MAX_GROUP_PARTICIPANTS) {
      throw new Error(`Group calls limited to ${MAX_GROUP_PARTICIPANTS} participants`);
    }
  }

  const db = getDb();
  const id = randomUUID();
  const roomId = `call-${id}`;
  const now = new Date().toISOString();

  // Filter blocked
  const blocked: string[] = [];
  const allowed: string[] = [];
  for (const uid of uniqueParticipants) {
    const check = canRingUser(uid, input.initiator_id);
    if (!check.allowed) blocked.push(uid);
    else allowed.push(uid);
  }
  if (allowed.length === 0) throw new Error('All participants are unavailable (DND/blocked)');

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO calls (id, initiator_id, call_type, scope, state, room_id,
        is_recording, recording_url, duration_seconds, started_at, accepted_at,
        ended_at, end_reason, metadata_json, created_at)
      VALUES (?, ?, ?, ?, 'ringing', ?, 0, NULL, 0, ?, NULL, NULL, NULL, ?, ?)
    `).run(id, input.initiator_id, input.call_type, scope, roomId, now,
      input.metadata ? JSON.stringify(input.metadata) : null, now);

    const ins = db.prepare(`
      INSERT INTO call_participants (call_id, user_id, state, is_screen_sharing, joined_at, left_at, invited_at)
      VALUES (?, ?, ?, 0, NULL, NULL, ?)
    `);
    ins.run(id, input.initiator_id, 'accepted', now);
    for (const uid of allowed) ins.run(id, uid, 'ringing', now);

    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  return { call: getCall(id)!, participants: listCallParticipants(id), blocked_participants: blocked };
}

export function getCall(id: string): Call | null {
  return (getDb().prepare('SELECT * FROM calls WHERE id = ?').get(id) as Call | undefined) ?? null;
}

export function getCallByRoom(roomId: string): Call | null {
  return (getDb().prepare('SELECT * FROM calls WHERE room_id = ?').get(roomId) as Call | undefined) ?? null;
}

export function listCallParticipants(callId: string): CallParticipant[] {
  return getDb().prepare(
    'SELECT * FROM call_participants WHERE call_id = ? ORDER BY invited_at ASC'
  ).all(callId) as CallParticipant[];
}

export function getCallParticipant(callId: string, userId: string): CallParticipant | null {
  return (getDb().prepare(
    'SELECT * FROM call_participants WHERE call_id = ? AND user_id = ?'
  ).get(callId, userId) as CallParticipant | undefined) ?? null;
}

// ============================================================
// Participant state transitions
// ============================================================

export function acceptCall(callId: string, userId: string): Call {
  const db = getDb();
  const call = getCall(callId);
  if (!call) throw new Error('Call not found');
  if (call.state !== 'ringing' && call.state !== 'active') throw new Error(`Cannot accept in state ${call.state}`);
  const p = getCallParticipant(callId, userId);
  if (!p) throw new Error('Not a participant');

  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare(`
      UPDATE call_participants SET state = 'accepted', joined_at = COALESCE(joined_at, ?)
      WHERE call_id = ? AND user_id = ?
    `).run(now, callId, userId);
    // If this is the first acceptance beyond initiator, transition to active
    if (call.state === 'ringing' && userId !== call.initiator_id) {
      db.prepare('UPDATE calls SET state = ?, accepted_at = ? WHERE id = ?').run('active', now, callId);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return getCall(callId)!;
}

export function declineCall(callId: string, userId: string): Call {
  const db = getDb();
  const call = getCall(callId);
  if (!call) throw new Error('Call not found');
  if (call.state === 'ended') throw new Error('Call already ended');
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE call_participants SET state = 'declined', left_at = ?
    WHERE call_id = ? AND user_id = ?
  `).run(now, callId, userId);

  // Direct call declined → end call
  if (call.scope === 'direct') {
    db.prepare(`
      UPDATE calls SET state = 'declined', ended_at = ?, end_reason = ?
      WHERE id = ? AND state != 'ended'
    `).run(now, 'declined', callId);
  }
  return getCall(callId)!;
}

export function leaveCall(callId: string, userId: string): Call {
  const db = getDb();
  const call = getCall(callId);
  if (!call) throw new Error('Call not found');
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE call_participants SET state = 'left', left_at = ?
    WHERE call_id = ? AND user_id = ?
  `).run(now, callId, userId);

  // If no one remains, end the call
  const remaining = (db.prepare(`
    SELECT COUNT(*) as n FROM call_participants
    WHERE call_id = ? AND state IN ('accepted', 'ringing')
  `).get(callId) as { n: number }).n;
  if (remaining === 0 && call.state !== 'ended') {
    const duration = call.accepted_at
      ? Math.round((Date.now() - new Date(call.accepted_at).getTime()) / 1000)
      : 0;
    db.prepare(`
      UPDATE calls SET state = 'ended', ended_at = ?, end_reason = 'all_left', duration_seconds = ?
      WHERE id = ?
    `).run(now, duration, callId);
  }
  return getCall(callId)!;
}

export function endCall(callId: string, byUserId: string, reason = 'hangup'): Call {
  const db = getDb();
  const call = getCall(callId);
  if (!call) throw new Error('Call not found');
  if (call.state === 'ended') return call;
  if (call.initiator_id !== byUserId) {
    const p = getCallParticipant(callId, byUserId);
    if (!p) throw new Error('Not authorized to end this call');
  }
  const now = new Date().toISOString();
  const duration = call.accepted_at
    ? Math.round((Date.now() - new Date(call.accepted_at).getTime()) / 1000)
    : 0;
  db.prepare(`
    UPDATE calls SET state = 'ended', ended_at = ?, end_reason = ?, duration_seconds = ?
    WHERE id = ?
  `).run(now, reason, duration, callId);
  // Mark ringing participants as missed
  db.prepare(`
    UPDATE call_participants SET state = 'missed', left_at = ?
    WHERE call_id = ? AND state IN ('ringing', 'invited')
  `).run(now, callId);
  return getCall(callId)!;
}

/** Called by timeout worker — mark ringing calls missed after N seconds. */
export function expireStaleRingingCalls(timeoutSeconds = 45): number {
  const db = getDb();
  const cutoff = new Date(Date.now() - timeoutSeconds * 1000).toISOString();
  const now = new Date().toISOString();
  const ids = db.prepare(
    "SELECT id FROM calls WHERE state = 'ringing' AND started_at <= ?"
  ).all(cutoff) as Array<{ id: string }>;
  for (const { id } of ids) {
    db.prepare(`
      UPDATE calls SET state = 'missed', ended_at = ?, end_reason = 'no_answer'
      WHERE id = ?
    `).run(now, id);
    db.prepare(`
      UPDATE call_participants SET state = 'missed', left_at = ?
      WHERE call_id = ? AND state IN ('ringing', 'invited')
    `).run(now, id);
  }
  return ids.length;
}

// ============================================================
// 146.6 — Screen sharing flag
// ============================================================

export function setScreenSharing(callId: string, userId: string, sharing: boolean): CallParticipant {
  const db = getDb();
  const p = getCallParticipant(callId, userId);
  if (!p) throw new Error('Not a participant');
  if (p.state !== 'accepted') throw new Error('Must be in the call to share screen');
  db.prepare(`
    UPDATE call_participants SET is_screen_sharing = ? WHERE call_id = ? AND user_id = ?
  `).run(sharing ? 1 : 0, callId, userId);
  return getCallParticipant(callId, userId)!;
}

// ============================================================
// 146.5 — Recording
// ============================================================

export function startRecording(callId: string, userId: string): Call {
  const db = getDb();
  const call = getCall(callId);
  if (!call) throw new Error('Call not found');
  const p = getCallParticipant(callId, userId);
  if (!p || p.state !== 'accepted') throw new Error('Must be in the call to record');
  db.prepare('UPDATE calls SET is_recording = 1 WHERE id = ?').run(callId);
  return getCall(callId)!;
}

export function stopRecording(callId: string, userId: string, recording: {
  storage_url: string;
  file_size_bytes?: number | null;
}): CallRecording {
  const db = getDb();
  const call = getCall(callId);
  if (!call) throw new Error('Call not found');
  if (call.is_recording !== 1) throw new Error('Not recording');

  const id = randomUUID();
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO call_recordings (id, call_id, storage_url, file_size_bytes, duration_seconds, recorded_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, callId, recording.storage_url, recording.file_size_bytes ?? null,
      call.duration_seconds, userId, now);
    db.prepare('UPDATE calls SET is_recording = 0, recording_url = ? WHERE id = ?')
      .run(recording.storage_url, callId);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return db.prepare('SELECT * FROM call_recordings WHERE id = ?').get(id) as CallRecording;
}

export function listCallRecordings(callId: string): CallRecording[] {
  return getDb().prepare(
    'SELECT * FROM call_recordings WHERE call_id = ? ORDER BY created_at DESC'
  ).all(callId) as CallRecording[];
}

// ============================================================
// 146.7 — Call history
// ============================================================

export function listCallHistory(userId: string, opts: {
  limit?: number; offset?: number; only_missed?: boolean;
} = {}): CallHistoryItem[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const filters: string[] = [
    'EXISTS (SELECT 1 FROM call_participants cp WHERE cp.call_id = c.id AND cp.user_id = ?)',
  ];
  const params: any[] = [userId];
  if (opts.only_missed) filters.push("c.state IN ('missed', 'declined')");
  params.push(limit, offset);
  const calls = db.prepare(`
    SELECT c.* FROM calls c
    WHERE ${filters.join(' AND ')}
    ORDER BY c.started_at DESC
    LIMIT ? OFFSET ?
  `).all(...params) as Call[];

  return calls.map((c) => ({
    ...c,
    participants: listCallParticipants(c.id).map((p) => ({ user_id: p.user_id, state: p.state })),
  }));
}

export function getMissedCallCount(userId: string, sinceIso?: string): number {
  const db = getDb();
  const since = sinceIso ?? new Date(Date.now() - 7 * 86400_000).toISOString();
  return (db.prepare(`
    SELECT COUNT(*) as n FROM calls c
    INNER JOIN call_participants cp ON cp.call_id = c.id
    WHERE cp.user_id = ? AND cp.state = 'missed' AND c.started_at >= ?
  `).get(userId, since) as { n: number }).n;
}

// ============================================================
// TURN / ICE server config (from integration_settings)
// ============================================================

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export function getIceServers(): { configured: boolean; ice_servers: IceServer[] } {
  const servers: IceServer[] = [];
  // Always include a free STUN
  servers.push({ urls: 'stun:stun.l.google.com:19302' });

  if (isIntegrationReady('turn_server')) {
    const cfg = getIntegrationConfigRaw('turn_server');
    if (cfg?.url) {
      servers.push({
        urls: String(cfg.url),
        username: cfg.username ? String(cfg.username) : undefined,
        credential: cfg.credential ? String(cfg.credential) : undefined,
      });
    }
    if (cfg?.stun_url) {
      servers.push({ urls: String(cfg.stun_url) });
    }
  }

  return { configured: isIntegrationReady('turn_server'), ice_servers: servers };
}

// ============================================================
// Signaling events (WS layer hookup later)
// ============================================================

export type CallSignalType = 'call.invited' | 'call.ringing' | 'call.accepted'
  | 'call.declined' | 'call.left' | 'call.ended' | 'call.missed'
  | 'call.screen_share.started' | 'call.screen_share.stopped'
  | 'call.recording.started' | 'call.recording.stopped'
  | 'webrtc.offer' | 'webrtc.answer' | 'webrtc.ice';

export interface CallSignal {
  id: string;
  type: CallSignalType;
  call_id: string;
  from_user: string;
  to_users: string[];
  payload: Record<string, unknown>;
  created_at: string;
}

export function buildCallSignal(input: {
  type: CallSignalType;
  call_id: string;
  from_user: string;
  to_users: string[];
  payload?: Record<string, unknown>;
}): CallSignal {
  return {
    id: randomUUID(),
    type: input.type,
    call_id: input.call_id,
    from_user: input.from_user,
    to_users: input.to_users,
    payload: input.payload ?? {},
    created_at: new Date().toISOString(),
  };
}

// ============================================================
// 42.11 WebRTC — signaling persistence + peer state
// Reliable offer/answer/ICE exchange across WS reconnects, plus
// per-participant connection state for negotiation tracking.
// ============================================================

export type WebrtcSignalType = 'webrtc.offer' | 'webrtc.answer' | 'webrtc.ice';
export type WebrtcConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';
export type WebrtcSdpState = 'idle' | 'have_local_offer' | 'have_remote_offer' | 'stable' | 'failed';
export type WebrtcIceGatheringState = 'new' | 'gathering' | 'complete' | 'closed';

export interface WebrtcSignalRow {
  id: string;
  call_id: string;
  from_user: string;
  to_user: string;
  signal_type: WebrtcSignalType;
  payload: string;
  delivered_at: string | null;
  consumed_at: string | null;
  created_at: string;
}

export interface WebrtcPeer {
  id: string;
  call_id: string;
  user_id: string;
  connection_state: WebrtcConnectionState;
  sdp_state: WebrtcSdpState;
  ice_gathering_state: WebrtcIceGatheringState;
  ice_candidate_count: number;
  last_connected_at: string | null;
  last_signal_at: string | null;
  rtt_ms: number | null;
  packet_loss_pct: number | null;
  bitrate_kbps: number | null;
  created_at: string;
  updated_at: string;
}

export interface PersistSignalInput {
  call_id: string;
  from_user: string;
  to_user: string;
  signal_type: WebrtcSignalType;
  payload: Record<string, unknown>;
}

const SIGNAL_RETENTION_HOURS = 6;

export function persistSignal(input: PersistSignalInput): WebrtcSignalRow {
  const db = getDb();
  // ensure peer rows exist
  ensurePeer(input.call_id, input.from_user);
  ensurePeer(input.call_id, input.to_user);
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO webrtc_signals
    (id, call_id, from_user, to_user, signal_type, payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.call_id, input.from_user, input.to_user, input.signal_type, JSON.stringify(input.payload ?? {}), now);
  // bump counters
  if (input.signal_type === 'webrtc.ice') {
    db.prepare('UPDATE webrtc_peers SET ice_candidate_count = ice_candidate_count + 1, last_signal_at = ?, updated_at = ? WHERE call_id = ? AND user_id = ?')
      .run(now, now, input.call_id, input.from_user);
  } else {
    const nextSdp = input.signal_type === 'webrtc.offer' ? 'have_local_offer' : 'have_remote_offer';
    db.prepare('UPDATE webrtc_peers SET sdp_state = ?, last_signal_at = ?, updated_at = ? WHERE call_id = ? AND user_id = ?')
      .run(nextSdp, now, now, input.call_id, input.from_user);
    const remoteSdp = input.signal_type === 'webrtc.offer' ? 'have_remote_offer' : 'have_local_offer';
    db.prepare('UPDATE webrtc_peers SET sdp_state = ?, last_signal_at = ?, updated_at = ? WHERE call_id = ? AND user_id = ?')
      .run(remoteSdp, now, now, input.call_id, input.to_user);
  }
  return db.prepare('SELECT * FROM webrtc_signals WHERE id = ?').get(id) as WebrtcSignalRow;
}

export function ensurePeer(callId: string, userId: string): WebrtcPeer {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM webrtc_peers WHERE call_id = ? AND user_id = ?')
    .get(callId, userId) as WebrtcPeer | undefined;
  if (existing) return existing;
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO webrtc_peers (id, call_id, user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, callId, userId, now, now);
  return db.prepare('SELECT * FROM webrtc_peers WHERE id = ?').get(id) as WebrtcPeer;
}

export function getPeer(callId: string, userId: string): WebrtcPeer | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM webrtc_peers WHERE call_id = ? AND user_id = ?')
    .get(callId, userId) as WebrtcPeer | undefined) ?? null;
}

export function listCallPeers(callId: string): WebrtcPeer[] {
  const db = getDb();
  return db.prepare('SELECT * FROM webrtc_peers WHERE call_id = ? ORDER BY created_at ASC')
    .all(callId) as WebrtcPeer[];
}

export interface UpdatePeerStateInput {
  connection_state?: WebrtcConnectionState;
  sdp_state?: WebrtcSdpState;
  ice_gathering_state?: WebrtcIceGatheringState;
  rtt_ms?: number | null;
  packet_loss_pct?: number | null;
  bitrate_kbps?: number | null;
}

export function updatePeerState(callId: string, userId: string, patch: UpdatePeerStateInput): WebrtcPeer {
  const db = getDb();
  ensurePeer(callId, userId);
  const fields: string[] = [];
  const vals: unknown[] = [];
  for (const k of ['connection_state','sdp_state','ice_gathering_state','rtt_ms','packet_loss_pct','bitrate_kbps'] as const) {
    if (patch[k] !== undefined) { fields.push(`${k} = ?`); vals.push(patch[k]); }
  }
  const now = new Date().toISOString();
  if (patch.connection_state === 'connected') {
    fields.push('last_connected_at = ?'); vals.push(now);
  }
  if (fields.length === 0) return getPeer(callId, userId)!;
  fields.push('updated_at = ?'); vals.push(now);
  vals.push(callId, userId);
  db.prepare(`UPDATE webrtc_peers SET ${fields.join(', ')} WHERE call_id = ? AND user_id = ?`).run(...vals);
  return getPeer(callId, userId)!;
}

export interface FetchSignalsOpts {
  call_id: string;
  user_id: string;
  limit?: number;
  mark_consumed?: boolean;
}

export function fetchPendingSignals(opts: FetchSignalsOpts): WebrtcSignalRow[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const rows = db.prepare(`
    SELECT * FROM webrtc_signals
    WHERE call_id = ? AND to_user = ? AND consumed_at IS NULL
    ORDER BY created_at ASC LIMIT ?
  `).all(opts.call_id, opts.user_id, limit) as WebrtcSignalRow[];
  if (rows.length > 0 && opts.mark_consumed !== false) {
    const now = new Date().toISOString();
    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`UPDATE webrtc_signals SET consumed_at = ?, delivered_at = COALESCE(delivered_at, ?) WHERE id IN (${placeholders})`)
      .run(now, now, ...ids);
  }
  return rows;
}

export function getSignalHistory(callId: string, limit = 200): WebrtcSignalRow[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM webrtc_signals WHERE call_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(callId, Math.min(Math.max(limit, 1), 500)) as WebrtcSignalRow[];
}

export function pruneOldSignals(olderThanHours = SIGNAL_RETENTION_HOURS): { pruned: number } {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanHours * 3_600_000).toISOString();
  const r = db.prepare('DELETE FROM webrtc_signals WHERE created_at < ?').run(cutoff);
  return { pruned: r.changes };
}

export interface WebrtcPeerSummary {
  call_id: string;
  peers: WebrtcPeer[];
  total: number;
  connected: number;
  failed: number;
  negotiating: number;
  avg_rtt_ms: number | null;
}

export function getWebrtcCallSummary(callId: string): WebrtcPeerSummary {
  const peers = listCallPeers(callId);
  const rtts = peers.map(p => p.rtt_ms).filter((v): v is number => typeof v === 'number');
  return {
    call_id: callId,
    peers,
    total: peers.length,
    connected: peers.filter(p => p.connection_state === 'connected').length,
    failed: peers.filter(p => p.connection_state === 'failed').length,
    negotiating: peers.filter(p => p.connection_state === 'connecting' || p.connection_state === 'new').length,
    avg_rtt_ms: rtts.length > 0 ? Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length) : null,
  };
}

export interface WebrtcGlobalStats {
  signals_total: number;
  signals_pending: number;
  peers_total: number;
  by_connection_state: Record<string, number>;
  window_hours: number;
}

export function getWebrtcGlobalStats(windowHours = 24): WebrtcGlobalStats {
  const db = getDb();
  const since = new Date(Date.now() - windowHours * 3_600_000).toISOString();
  const total = (db.prepare('SELECT COUNT(*) AS c FROM webrtc_signals WHERE created_at >= ?').get(since) as { c: number }).c;
  const pending = (db.prepare('SELECT COUNT(*) AS c FROM webrtc_signals WHERE consumed_at IS NULL').get() as { c: number }).c;
  const peersTotal = (db.prepare('SELECT COUNT(*) AS c FROM webrtc_peers').get() as { c: number }).c;
  const byState = db.prepare('SELECT connection_state, COUNT(*) AS c FROM webrtc_peers GROUP BY connection_state')
    .all() as Array<{ connection_state: string; c: number }>;
  const by_connection_state: Record<string, number> = {};
  for (const r of byState) by_connection_state[r.connection_state] = r.c;
  return { signals_total: total, signals_pending: pending, peers_total: peersTotal, by_connection_state, window_hours: windowHours };
}
