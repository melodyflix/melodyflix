// melodyflix channel - business logic
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';
import type { Channel, CreateChannelInput, Follow } from '../models/channel.model.js';

export function ensureSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      handle TEXT NOT NULL UNIQUE,
      description TEXT,
      avatar_url TEXT,
      banner_url TEXT,
      subscriber_count INTEGER NOT NULL DEFAULT 0,
      video_count INTEGER NOT NULL DEFAULT 0,
      is_verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_channels_handle ON channels(handle);
    CREATE INDEX IF NOT EXISTS idx_channels_owner ON channels(owner_id);

    CREATE TABLE IF NOT EXISTS follows (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (user_id, channel_id)
    );
    CREATE INDEX IF NOT EXISTS idx_follows_user ON follows(user_id);
    CREATE INDEX IF NOT EXISTS idx_follows_channel ON follows(channel_id);
  `);
}

export function createChannel(ownerId: string, input: CreateChannelInput): Channel {
  const db = getDb();

  const existingByOwner = db.prepare('SELECT id FROM channels WHERE owner_id = ?').get(ownerId);
  if (existingByOwner) throw new Error('You already own a channel');

  const handleTaken = db.prepare('SELECT id FROM channels WHERE handle = ?').get(input.handle);
  if (handleTaken) throw new Error('Handle already taken');

  const now = new Date().toISOString();
  const channel: Channel = {
    id: randomUUID(),
    owner_id: ownerId,
    name: input.name,
    handle: input.handle,
    description: input.description ?? null,
    avatar_url: null,
    banner_url: null,
    subscriber_count: 0,
    video_count: 0,
    is_verified: 0,
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO channels (id, owner_id, name, handle, description, avatar_url, banner_url, subscriber_count, video_count, is_verified, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    channel.id, channel.owner_id, channel.name, channel.handle,
    channel.description, channel.avatar_url, channel.banner_url,
    channel.subscriber_count, channel.video_count, channel.is_verified,
    channel.created_at, channel.updated_at
  );

  return channel;
}

export function getChannelById(id: string): Channel | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as Channel | undefined) ?? null;
}

export function getChannelByHandle(handle: string): Channel | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM channels WHERE handle = ?').get(handle) as Channel | undefined) ?? null;
}

export function getChannelByOwner(ownerId: string): Channel | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM channels WHERE owner_id = ?').get(ownerId) as Channel | undefined) ?? null;
}

export function listChannels(limit = 20, offset = 0): Channel[] {
  const db = getDb();
  return db.prepare('SELECT * FROM channels ORDER BY subscriber_count DESC LIMIT ? OFFSET ?').all(limit, offset) as Channel[];
}

export function updateChannel(channelId: string, ownerId: string, updates: { name?: string; description?: string; avatar_url?: string; banner_url?: string }): Channel {
  const db = getDb();
  const existing = getChannelById(channelId);
  if (!existing) throw new Error('Channel not found');
  if (existing.owner_id !== ownerId) throw new Error('Not authorized');

  const now = new Date().toISOString();
  const next: Channel = {
    ...existing,
    name: updates.name ?? existing.name,
    description: updates.description ?? existing.description,
    avatar_url: updates.avatar_url ?? existing.avatar_url,
    banner_url: updates.banner_url ?? existing.banner_url,
    updated_at: now,
  };

  db.prepare(`
    UPDATE channels SET name = ?, description = ?, avatar_url = ?, banner_url = ?, updated_at = ?
    WHERE id = ?
  `).run(next.name, next.description, next.avatar_url, next.banner_url, next.updated_at, channelId);

  return next;
}

export function followChannel(userId: string, channelId: string): { following: boolean; subscriberCount: number } {
  const db = getDb();
  const channel = getChannelById(channelId);
  if (!channel) throw new Error('Channel not found');
  if (channel.owner_id === userId) throw new Error('Cannot follow your own channel');

  const existing = db.prepare('SELECT id FROM follows WHERE user_id = ? AND channel_id = ?').get(userId, channelId);
  if (existing) throw new Error('Already following');

  const follow: Follow = {
    id: randomUUID(),
    user_id: userId,
    channel_id: channelId,
    created_at: new Date().toISOString(),
  };

  db.prepare('INSERT INTO follows (id, user_id, channel_id, created_at) VALUES (?, ?, ?, ?)').run(
    follow.id, follow.user_id, follow.channel_id, follow.created_at
  );
  db.prepare('UPDATE channels SET subscriber_count = subscriber_count + 1 WHERE id = ?').run(channelId);

  const updated = getChannelById(channelId)!;
  return { following: true, subscriberCount: updated.subscriber_count };
}

export function unfollowChannel(userId: string, channelId: string): { following: boolean; subscriberCount: number } {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM follows WHERE user_id = ? AND channel_id = ?').get(userId, channelId);
  if (!existing) throw new Error('Not following');

  db.prepare('DELETE FROM follows WHERE user_id = ? AND channel_id = ?').run(userId, channelId);
  db.prepare('UPDATE channels SET subscriber_count = MAX(subscriber_count - 1, 0) WHERE id = ?').run(channelId);

  const updated = getChannelById(channelId)!;
  return { following: false, subscriberCount: updated.subscriber_count };
}

export function isFollowing(userId: string, channelId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT id FROM follows WHERE user_id = ? AND channel_id = ?').get(userId, channelId);
  return !!row;
}

// ---------- Subscriptions (My following list) ----------
export function getMyFollowing(userId: string): Channel[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT c.*
    FROM channels c
    INNER JOIN follows f ON f.channel_id = c.id
    WHERE f.user_id = ?
    ORDER BY f.created_at DESC
    LIMIT 200
  `).all(userId) as Channel[];
  return rows;
}

export function getFollowingCount(userId: string): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as n FROM follows WHERE user_id = ?').get(userId) as { n: number };
  return row.n;
}
