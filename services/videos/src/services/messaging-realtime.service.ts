// melodyflix videos — Real-time Messaging layer (Section 147)
// 147.1-147.8: presence, typing, read receipts, delivery status, group chat,
// reactions, edit/delete broadcasts.
// Design: DB-backed state + event emitters (WS layer future hookup).
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

// ============================================================
// Types
// ============================================================

export type PresenceStatus = 'online' | 'away' | 'offline';
export type DeliveryState = 'sent' | 'delivered' | 'read' | 'failed';
export type RealtimeEventType =
  | 'message.sent' | 'message.delivered' | 'message.read'
  | 'message.edited' | 'message.deleted' | 'message.reacted'
  | 'typing.started' | 'typing.stopped'
  | 'presence.changed'
  | 'group.created' | 'group.member.added' | 'group.member.removed';

export interface RealtimeEvent {
  id: string;
  type: RealtimeEventType;
  actor_id: string;
  target_user_ids: string[]; // who should receive this
  payload: Record<string, unknown>;
  created_at: string;
}

export interface UserPresence {
  user_id: string;
  status: PresenceStatus;
  last_seen_at: string;
  socket_count: number;
  updated_at: string;
}

export interface TypingIndicator {
  thread_id: string;
  user_id: string;
  started_at: string;
  expires_at: string;
}

export interface MessageReceipt {
  message_id: string;
  recipient_id: string;
  state: DeliveryState;
  sent_at: string;
  delivered_at: string | null;
  read_at: string | null;
}

export interface GroupChat {
  id: string;
  name: string;
  slug: string;
  avatar_url: string | null;
  owner_id: string;
  is_public: number;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface GroupChatMember {
  group_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  joined_at: string;
}

export interface DMMessageReaction {
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface MessageEdit {
  id: string;
  message_id: string;
  edited_by: string;
  old_body: string;
  new_body: string;
  edited_at: string;
}

// ============================================================
// Schema
// ============================================================

export function ensureMessagingRealtimeSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_presence (
      user_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'offline',
      last_seen_at TEXT NOT NULL,
      socket_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_presence_status ON user_presence(status, last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS typing_indicators (
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_typing_expires ON typing_indicators(expires_at);

    CREATE TABLE IF NOT EXISTS message_receipts (
      message_id TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'sent',
      sent_at TEXT NOT NULL,
      delivered_at TEXT,
      read_at TEXT,
      PRIMARY KEY (message_id, recipient_id)
    );
    CREATE INDEX IF NOT EXISTS idx_receipts_user ON message_receipts(recipient_id, state);
    CREATE INDEX IF NOT EXISTS idx_receipts_message ON message_receipts(message_id);

    CREATE TABLE IF NOT EXISTS group_chats (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
      avatar_url TEXT,
      owner_id TEXT NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 0,
      member_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_group_owner ON group_chats(owner_id);

    CREATE TABLE IF NOT EXISTS group_chat_members (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL,
      PRIMARY KEY (group_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_gcm_user ON group_chat_members(user_id, joined_at DESC);

    CREATE TABLE IF NOT EXISTS dm_message_reactions (
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (message_id, user_id, emoji)
    );
    CREATE INDEX IF NOT EXISTS idx_dmr_message ON dm_message_reactions(message_id);

    CREATE TABLE IF NOT EXISTS dm_message_edits (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      edited_by TEXT NOT NULL,
      old_body TEXT NOT NULL,
      new_body TEXT NOT NULL,
      edited_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dme_message ON dm_message_edits(message_id, edited_at DESC);
  `);
}

// ============================================================
// 147.1 — Connection registration (WS hookup will call these)
// ============================================================

export function registerConnection(userId: string): UserPresence {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO user_presence (user_id, status, last_seen_at, socket_count, updated_at)
    VALUES (?, 'online', ?, 1, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      status = 'online',
      last_seen_at = excluded.last_seen_at,
      socket_count = user_presence.socket_count + 1,
      updated_at = excluded.updated_at
  `).run(userId, now, now);
  return getUserPresence(userId)!;
}

export function unregisterConnection(userId: string): UserPresence | null {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = getUserPresence(userId);
  if (!existing) return null;
  const newCount = Math.max(0, existing.socket_count - 1);
  const newStatus: PresenceStatus = newCount === 0 ? 'offline' : existing.status;
  db.prepare(`
    UPDATE user_presence SET status = ?, socket_count = ?, last_seen_at = ?, updated_at = ?
    WHERE user_id = ?
  `).run(newStatus, newCount, now, now, userId);
  return getUserPresence(userId);
}

export function heartbeat(userId: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE user_presence SET last_seen_at = ?, status = 'online', updated_at = ? WHERE user_id = ?"
  ).run(now, now, userId);
}

// ============================================================
// 147.4 — Presence
// ============================================================

export function getUserPresence(userId: string): UserPresence | null {
  return (getDb().prepare('SELECT * FROM user_presence WHERE user_id = ?').get(userId) as UserPresence | undefined) ?? null;
}

export function setPresenceStatus(userId: string, status: PresenceStatus): UserPresence {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO user_presence (user_id, status, last_seen_at, socket_count, updated_at)
    VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      status = excluded.status,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at
  `).run(userId, status, now, now);
  return getUserPresence(userId)!;
}

export function getPresenceForUsers(userIds: string[]): UserPresence[] {
  if (userIds.length === 0) return [];
  const placeholders = userIds.map(() => '?').join(',');
  return getDb().prepare(
    `SELECT * FROM user_presence WHERE user_id IN (${placeholders})`
  ).all(...userIds) as UserPresence[];
}

export function listOnlineUsers(limit = 100): UserPresence[] {
  return getDb().prepare(
    "SELECT * FROM user_presence WHERE status = 'online' ORDER BY last_seen_at DESC LIMIT ?"
  ).all(Math.min(Math.max(limit, 1), 500)) as UserPresence[];
}

/** Sweep: mark users offline if not seen for `thresholdMinutes`. */
export function sweepStalePresence(thresholdMinutes = 5): number {
  const cutoff = new Date(Date.now() - thresholdMinutes * 60_000).toISOString();
  const now = new Date().toISOString();
  const info = getDb().prepare(`
    UPDATE user_presence SET status = 'offline', socket_count = 0, updated_at = ?
    WHERE status != 'offline' AND last_seen_at < ?
  `).run(now, cutoff);
  return Number(info.changes ?? 0);
}

// ============================================================
// 147.2 — Typing Indicators
// ============================================================

const TYPING_TTL_MS = 6000;

export function startTyping(threadId: string, userId: string): TypingIndicator {
  const db = getDb();
  const now = new Date();
  const expires = new Date(now.getTime() + TYPING_TTL_MS);
  db.prepare(`
    INSERT INTO typing_indicators (thread_id, user_id, started_at, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(thread_id, user_id) DO UPDATE SET
      started_at = excluded.started_at,
      expires_at = excluded.expires_at
  `).run(threadId, userId, now.toISOString(), expires.toISOString());
  return { thread_id: threadId, user_id: userId, started_at: now.toISOString(), expires_at: expires.toISOString() };
}

export function stopTyping(threadId: string, userId: string): boolean {
  const info = getDb().prepare(
    'DELETE FROM typing_indicators WHERE thread_id = ? AND user_id = ?'
  ).run(threadId, userId);
  return Number(info.changes ?? 0) > 0;
}

export function listTypingInThread(threadId: string): TypingIndicator[] {
  const db = getDb();
  const now = new Date().toISOString();
  // Cleanup expired first
  db.prepare('DELETE FROM typing_indicators WHERE expires_at <= ?').run(now);
  return db.prepare(
    'SELECT * FROM typing_indicators WHERE thread_id = ? AND expires_at > ?'
  ).all(threadId, now) as TypingIndicator[];
}

// ============================================================
// 147.3 / 147.5 — Delivery + Read Receipts
// ============================================================

export function createReceipt(messageId: string, recipientId: string): MessageReceipt {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO message_receipts (message_id, recipient_id, state, sent_at, delivered_at, read_at)
    VALUES (?, ?, 'sent', ?, NULL, NULL)
    ON CONFLICT(message_id, recipient_id) DO NOTHING
  `).run(messageId, recipientId, now);
  return getReceipt(messageId, recipientId)!;
}

export function getReceipt(messageId: string, recipientId: string): MessageReceipt | null {
  return (getDb().prepare(
    'SELECT * FROM message_receipts WHERE message_id = ? AND recipient_id = ?'
  ).get(messageId, recipientId) as MessageReceipt | undefined) ?? null;
}

export function markDelivered(messageId: string, recipientId: string): MessageReceipt | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE message_receipts SET state = CASE WHEN state = 'sent' THEN 'delivered' ELSE state END,
      delivered_at = COALESCE(delivered_at, ?)
    WHERE message_id = ? AND recipient_id = ?
  `).run(now, messageId, recipientId);
  return getReceipt(messageId, recipientId);
}

export function markRead(messageId: string, recipientId: string): MessageReceipt | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE message_receipts SET state = 'read',
      delivered_at = COALESCE(delivered_at, ?),
      read_at = COALESCE(read_at, ?)
    WHERE message_id = ? AND recipient_id = ?
  `).run(now, now, messageId, recipientId);
  return getReceipt(messageId, recipientId);
}

export function listMessageReceipts(messageId: string): MessageReceipt[] {
  return getDb().prepare(
    'SELECT * FROM message_receipts WHERE message_id = ?'
  ).all(messageId) as MessageReceipt[];
}

export interface UnreadSummary {
  user_id: string;
  unread_messages: number;
  unread_threads: number;
}

export function getUnreadSummary(userId: string): UnreadSummary {
  const db = getDb();
  const total = (db.prepare(
    "SELECT COUNT(*) as n FROM message_receipts WHERE recipient_id = ? AND state != 'read'"
  ).get(userId) as { n: number }).n;
  const threads = (db.prepare(`
    SELECT COUNT(DISTINCT dm.thread_id) as n FROM message_receipts mr
    INNER JOIN direct_messages dm ON dm.id = mr.message_id
    WHERE mr.recipient_id = ? AND mr.state != 'read'
  `).get(userId) as { n: number }).n;
  return { user_id: userId, unread_messages: total, unread_threads: threads };
}

/** Convenience: mark all pending receipts in a thread as read for the user. */
export function markThreadReadReceipts(threadId: string, userId: string): number {
  const db = getDb();
  const now = new Date().toISOString();
  const info = db.prepare(`
    UPDATE message_receipts SET state = 'read',
      delivered_at = COALESCE(delivered_at, ?),
      read_at = COALESCE(read_at, ?)
    WHERE recipient_id = ? AND message_id IN (
      SELECT id FROM direct_messages WHERE thread_id = ? AND recipient_id = ?
    )
  `).run(now, now, userId, threadId, userId);
  return Number(info.changes ?? 0);
}

// ============================================================
// 147.6 — Group Chats
// ============================================================

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').slice(0, 60) || 'group';
}

export function createGroupChat(input: {
  name: string;
  owner_id: string;
  slug?: string;
  avatar_url?: string | null;
  is_public?: boolean;
  member_ids?: string[];
}): GroupChat {
  const name = (input.name ?? '').trim();
  if (name.length < 1 || name.length > 100) throw new Error('name must be 1-100 chars');
  const db = getDb();

  let slug = (input.slug ?? slugify(name)).toLowerCase();
  let attempts = 0;
  while (db.prepare('SELECT 1 FROM group_chats WHERE slug = ?').get(slug)) {
    attempts += 1;
    slug = `${slugify(name)}-${attempts}`;
    if (attempts > 100) throw new Error('Cannot generate unique slug');
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const memberIds = Array.from(new Set([input.owner_id, ...(input.member_ids ?? [])]));

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO group_chats (id, name, slug, avatar_url, owner_id, is_public, member_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, slug, input.avatar_url ?? null, input.owner_id,
      input.is_public ? 1 : 0, memberIds.length, now, now);

    const ins = db.prepare(
      'INSERT INTO group_chat_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
    );
    for (const uid of memberIds) {
      const role = uid === input.owner_id ? 'owner' : 'member';
      ins.run(id, uid, role, now);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  return getGroupChat(id)!;
}

export function getGroupChat(id: string): GroupChat | null {
  return (getDb().prepare('SELECT * FROM group_chats WHERE id = ?').get(id) as GroupChat | undefined) ?? null;
}

export function getGroupChatBySlug(slug: string): GroupChat | null {
  return (getDb().prepare('SELECT * FROM group_chats WHERE slug = ?').get(slug) as GroupChat | undefined) ?? null;
}

export function listUserGroupChats(userId: string): GroupChat[] {
  return getDb().prepare(`
    SELECT gc.* FROM group_chats gc
    INNER JOIN group_chat_members m ON m.group_id = gc.id
    WHERE m.user_id = ?
    ORDER BY gc.updated_at DESC
  `).all(userId) as GroupChat[];
}

export function listGroupMembers(groupId: string): GroupChatMember[] {
  return getDb().prepare(
    'SELECT * FROM group_chat_members WHERE group_id = ? ORDER BY role ASC, joined_at ASC'
  ).all(groupId) as GroupChatMember[];
}

export function addGroupMember(groupId: string, requesterId: string, userId: string): GroupChatMember {
  const db = getDb();
  const group = getGroupChat(groupId);
  if (!group) throw new Error('Group not found');
  const me = getGroupMember(groupId, requesterId);
  if (!me || (me.role !== 'owner' && me.role !== 'admin')) throw new Error('Not authorized');

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO group_chat_members (group_id, user_id, role, joined_at)
    VALUES (?, ?, 'member', ?)
    ON CONFLICT(group_id, user_id) DO NOTHING
  `).run(groupId, userId, now);
  db.prepare('UPDATE group_chats SET member_count = (SELECT COUNT(*) FROM group_chat_members WHERE group_id = ?), updated_at = ? WHERE id = ?')
    .run(groupId, now, groupId);
  return getGroupMember(groupId, userId)!;
}

export function removeGroupMember(groupId: string, requesterId: string, userId: string): boolean {
  const db = getDb();
  const group = getGroupChat(groupId);
  if (!group) throw new Error('Group not found');
  if (userId === group.owner_id) throw new Error('Cannot remove owner');
  const me = getGroupMember(groupId, requesterId);
  if (!me || (me.role !== 'owner' && me.role !== 'admin')) throw new Error('Not authorized');

  const info = db.prepare('DELETE FROM group_chat_members WHERE group_id = ? AND user_id = ?').run(groupId, userId);
  if (Number(info.changes ?? 0) > 0) {
    db.prepare('UPDATE group_chats SET member_count = (SELECT COUNT(*) FROM group_chat_members WHERE group_id = ?), updated_at = ? WHERE id = ?')
      .run(groupId, new Date().toISOString(), groupId);
  }
  return Number(info.changes ?? 0) > 0;
}

export function getGroupMember(groupId: string, userId: string): GroupChatMember | null {
  return (getDb().prepare(
    'SELECT * FROM group_chat_members WHERE group_id = ? AND user_id = ?'
  ).get(groupId, userId) as GroupChatMember | undefined) ?? null;
}

export function isGroupMember(groupId: string, userId: string): boolean {
  return !!getGroupMember(groupId, userId);
}

export function deleteGroupChat(groupId: string, requesterId: string): boolean {
  const db = getDb();
  const group = getGroupChat(groupId);
  if (!group) return false;
  if (group.owner_id !== requesterId) throw new Error('Owner only');
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM group_chat_members WHERE group_id = ?').run(groupId);
    db.prepare('DELETE FROM group_chats WHERE id = ?').run(groupId);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return true;
}

// ============================================================
// 147.7 — DM Message Reactions
// ============================================================

export function reactToDMMessage(messageId: string, userId: string, emoji: string): DMMessageReaction {
  const em = (emoji ?? '').trim();
  if (em.length < 1 || em.length > 20) throw new Error('emoji must be 1-20 chars');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO dm_message_reactions (message_id, user_id, emoji, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(message_id, user_id, emoji) DO NOTHING
  `).run(messageId, userId, em, now);
  return db.prepare(
    'SELECT * FROM dm_message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
  ).get(messageId, userId, em) as DMMessageReaction;
}

export function removeDMMessageReaction(messageId: string, userId: string, emoji: string): boolean {
  const info = getDb().prepare(
    'DELETE FROM dm_message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
  ).run(messageId, userId, emoji);
  return Number(info.changes ?? 0) > 0;
}

export interface DMMessageReactionSummary {
  message_id: string;
  total: number;
  counts: Record<string, number>;
  my_reactions: string[];
}

export function getDMMessageReactionSummary(messageId: string, viewerId?: string | null): DMMessageReactionSummary {
  const db = getDb();
  const rows = db.prepare(
    'SELECT emoji, COUNT(*) as n FROM dm_message_reactions WHERE message_id = ? GROUP BY emoji'
  ).all(messageId) as Array<{ emoji: string; n: number }>;
  const counts: Record<string, number> = {};
  let total = 0;
  for (const r of rows) { counts[r.emoji] = r.n; total += r.n; }
  const mine: string[] = [];
  if (viewerId) {
    const mineRows = db.prepare(
      'SELECT emoji FROM dm_message_reactions WHERE message_id = ? AND user_id = ?'
    ).all(messageId, viewerId) as Array<{ emoji: string }>;
    for (const m of mineRows) mine.push(m.emoji);
  }
  return { message_id: messageId, total, counts, my_reactions: mine };
}

export function listDMMessageReactions(messageId: string): DMMessageReaction[] {
  return getDb().prepare(
    'SELECT * FROM dm_message_reactions WHERE message_id = ? ORDER BY created_at ASC'
  ).all(messageId) as DMMessageReaction[];
}

// ============================================================
// 147.8 — Message Edit / Delete History
// ============================================================

export function logMessageEdit(messageId: string, editedBy: string, oldBody: string, newBody: string): MessageEdit {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO dm_message_edits (id, message_id, edited_by, old_body, new_body, edited_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, messageId, editedBy, oldBody, newBody, now);
  return db.prepare('SELECT * FROM dm_message_edits WHERE id = ?').get(id) as MessageEdit;
}

export function listMessageEdits(messageId: string): MessageEdit[] {
  return getDb().prepare(
    'SELECT * FROM dm_message_edits WHERE message_id = ? ORDER BY edited_at DESC'
  ).all(messageId) as MessageEdit[];
}

// ============================================================
// Event helper — future WS hookup
// ============================================================

export function buildRealtimeEvent(input: {
  type: RealtimeEventType;
  actor_id: string;
  target_user_ids: string[];
  payload: Record<string, unknown>;
}): RealtimeEvent {
  return {
    id: randomUUID(),
    type: input.type,
    actor_id: input.actor_id,
    target_user_ids: input.target_user_ids,
    payload: input.payload,
    created_at: new Date().toISOString(),
  };
}
