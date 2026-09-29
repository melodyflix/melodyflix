// melodyflix live - business logic
import { randomUUID, randomBytes } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';
import type { LiveStream, LiveChat, StreamStatus, StreamSource } from '../models/live.model.js';

export function ensureSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS live_streams (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      stream_key TEXT NOT NULL UNIQUE,
      category TEXT DEFAULT 'other',
      status TEXT NOT NULL DEFAULT 'idle',
      source TEXT NOT NULL DEFAULT 'camera',
      hls_url TEXT,
      viewer_count INTEGER NOT NULL DEFAULT 0,
      peak_viewers INTEGER NOT NULL DEFAULT 0,
      total_views INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      ended_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_live_user ON live_streams(user_id);
    CREATE INDEX IF NOT EXISTS idx_live_channel ON live_streams(channel_id);
    CREATE INDEX IF NOT EXISTS idx_live_status ON live_streams(status);
    CREATE INDEX IF NOT EXISTS idx_live_key ON live_streams(stream_key);

    CREATE TABLE IF NOT EXISTS live_chat (
      id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_stream ON live_chat(stream_id);

    CREATE TABLE IF NOT EXISTS live_viewers (
      id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL,
      user_id TEXT,
      ip TEXT,
      joined_at TEXT NOT NULL,
      left_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_viewers_stream ON live_viewers(stream_id);
  `);
}

function generateStreamKey(): string {
  return randomBytes(12).toString('hex');
}

// ---------- Streams ----------
export interface CreateStreamInput {
  user_id: string;
  channel_id: string;
  title: string;
  description?: string;
  category?: string;
  source?: StreamSource;
}

export function createStream(input: CreateStreamInput): LiveStream {
  const db = getDb();
  const now = new Date().toISOString();
  const stream: LiveStream = {
    id: randomUUID(),
    user_id: input.user_id,
    channel_id: input.channel_id,
    title: input.title,
    description: input.description ?? null,
    stream_key: generateStreamKey(),
    category: input.category ?? 'other',
    status: 'idle',
    source: input.source ?? 'camera',
    hls_url: null,
    viewer_count: 0,
    peak_viewers: 0,
    total_views: 0,
    started_at: null,
    ended_at: null,
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO live_streams (id, user_id, channel_id, title, description, stream_key,
      category, status, source, hls_url, viewer_count, peak_viewers, total_views,
      started_at, ended_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    stream.id, stream.user_id, stream.channel_id, stream.title, stream.description,
    stream.stream_key, stream.category, stream.status, stream.source, stream.hls_url,
    stream.viewer_count, stream.peak_viewers, stream.total_views,
    stream.started_at, stream.ended_at, stream.created_at, stream.updated_at
  );
  return stream;
}

export function getStreamById(id: string): LiveStream | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM live_streams WHERE id = ?').get(id) as LiveStream | undefined) ?? null;
}

export function getStreamByKey(key: string): LiveStream | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM live_streams WHERE stream_key = ?').get(key) as LiveStream | undefined) ?? null;
}

export function getActiveStreamByUser(userId: string): LiveStream | null {
  const db = getDb();
  return (db.prepare(`
    SELECT * FROM live_streams
    WHERE user_id = ? AND status IN ('idle','connecting','live')
    ORDER BY created_at DESC LIMIT 1
  `).get(userId) as LiveStream | undefined) ?? null;
}

export function listLiveStreams(limit = 50, offset = 0): LiveStream[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM live_streams
    WHERE status = 'live'
    ORDER BY viewer_count DESC, started_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as LiveStream[];
}

export function countLiveStreams(): number {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) as n FROM live_streams WHERE status = 'live'`).get() as { n: number };
  return row.n;
}

export function listStreamsByUser(userId: string, limit = 50): LiveStream[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM live_streams WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(userId, limit) as LiveStream[];
}

export function updateStreamStatus(id: string, status: StreamStatus, extras?: {
  hls_url?: string;
  started_at?: string;
  ended_at?: string;
}): LiveStream | null {
  const db = getDb();
  const existing = getStreamById(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE live_streams
    SET status = ?, hls_url = ?, started_at = ?, ended_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    status,
    extras?.hls_url ?? existing.hls_url,
    extras?.started_at ?? existing.started_at,
    extras?.ended_at ?? existing.ended_at,
    now,
    id
  );
  return getStreamById(id);
}

export function updateStreamInfo(id: string, userId: string, updates: { title?: string; description?: string; category?: string }): LiveStream {
  const db = getDb();
  const existing = getStreamById(id);
  if (!existing) throw new Error('Stream not found');
  if (existing.user_id !== userId) throw new Error('Not authorized');
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE live_streams SET title = ?, description = ?, category = ?, updated_at = ?
    WHERE id = ?
  `).run(
    updates.title ?? existing.title,
    updates.description !== undefined ? updates.description : existing.description,
    updates.category ?? existing.category,
    now,
    id
  );
  return getStreamById(id)!;
}

export function deleteStream(id: string, userId: string): void {
  const db = getDb();
  const existing = getStreamById(id);
  if (!existing) throw new Error('Stream not found');
  if (existing.user_id !== userId) throw new Error('Not authorized');
  db.prepare('DELETE FROM live_chat WHERE stream_id = ?').run(id);
  db.prepare('DELETE FROM live_viewers WHERE stream_id = ?').run(id);
  db.prepare('DELETE FROM live_streams WHERE id = ?').run(id);
}

// ---------- Viewers ----------
export function addViewer(streamId: string, userId: string | null, ip: string | null): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO live_viewers (id, stream_id, user_id, ip, joined_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, streamId, userId, ip, new Date().toISOString());
  const stream = getStreamById(streamId);
  if (stream) {
    const newCount = stream.viewer_count + 1;
    const newPeak = Math.max(stream.peak_viewers, newCount);
    db.prepare(`
      UPDATE live_streams SET viewer_count = ?, peak_viewers = ?, total_views = total_views + 1 WHERE id = ?
    `).run(newCount, newPeak, streamId);
  }
  return id;
}

export function removeViewer(viewerId: string): void {
  const db = getDb();
  const viewer = db.prepare('SELECT * FROM live_viewers WHERE id = ?').get(viewerId) as { stream_id: string } | undefined;
  if (!viewer) return;
  db.prepare('UPDATE live_viewers SET left_at = ? WHERE id = ?').run(new Date().toISOString(), viewerId);
  const stream = getStreamById(viewer.stream_id);
  if (stream) {
    db.prepare('UPDATE live_streams SET viewer_count = MAX(viewer_count - 1, 0) WHERE id = ?').run(viewer.stream_id);
  }
}

// ---------- Chat ----------
export function postChat(streamId: string, userId: string, username: string, content: string): LiveChat {
  const db = getDb();
  const chat: LiveChat = {
    id: randomUUID(),
    stream_id: streamId,
    user_id: userId,
    username,
    content: content.trim(),
    created_at: new Date().toISOString(),
  };
  db.prepare(`
    INSERT INTO live_chat (id, stream_id, user_id, username, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(chat.id, chat.stream_id, chat.user_id, chat.username, chat.content, chat.created_at);
  return chat;
}

export function listChat(streamId: string, limit = 100, sinceId?: string): LiveChat[] {
  const db = getDb();
  if (sinceId) {
    return db.prepare(`
      SELECT * FROM live_chat WHERE stream_id = ? AND created_at > (SELECT created_at FROM live_chat WHERE id = ?)
      ORDER BY created_at ASC LIMIT ?
    `).all(streamId, sinceId, limit) as LiveChat[];
  }
  return db.prepare(`
    SELECT * FROM live_chat WHERE stream_id = ? ORDER BY created_at ASC LIMIT ?
  `).all(streamId, limit) as LiveChat[];
}

export function deleteChat(chatId: string, userId: string, isOwner: boolean): boolean {
  const db = getDb();
  const chat = db.prepare('SELECT * FROM live_chat WHERE id = ?').get(chatId) as LiveChat | undefined;
  if (!chat) return false;
  if (!isOwner && chat.user_id !== userId) return false;
  db.prepare('DELETE FROM live_chat WHERE id = ?').run(chatId);
  return true;
}

// ---------- Cleanup ----------
export function cleanupStaleStreams(maxAgeHours = 12): number {
  const db = getDb();
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();
  const result = db.prepare(`
    UPDATE live_streams
    SET status = 'ended', ended_at = ?, updated_at = ?
    WHERE status IN ('connecting','live') AND updated_at < ?
  `).run(new Date().toISOString(), new Date().toISOString(), cutoff);
  return result.changes;
}
