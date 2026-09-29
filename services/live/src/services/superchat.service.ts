// melodyflix live - Super Chat service
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export interface SuperChat {
  id: string;
  stream_id: string;
  user_id: string;
  username: string;
  content: string;
  amount: number;
  currency: string;
  color: string;
  pinned_until: string;
  transaction_id: string | null;
  created_at: string;
}

// Amount → color + pin duration mapping
// ৳50 → green (60s), ৳100 → yellow (120s), ৳500 → red (300s), ৳1000+ → purple (600s)
export function amountToStyle(amount: number): { color: string; pinSeconds: number; label: string } {
  if (amount >= 1000) return { color: '#7c3aed', pinSeconds: 600, label: 'Super Chat Elite' };
  if (amount >= 500) return { color: '#dc2626', pinSeconds: 300, label: 'Super Chat' };
  if (amount >= 100) return { color: '#dba617', pinSeconds: 120, label: 'Super Chat' };
  if (amount >= 50) return { color: '#00a32a', pinSeconds: 60, label: 'Super Chat' };
  return { color: '#909090', pinSeconds: 0, label: 'Chat' };
}

export const MIN_SUPER_CHAT_AMOUNT = 50;
export const PRESET_AMOUNTS = [50, 100, 500, 1000, 2000];

export function ensureSuperChatSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS super_chats (
      id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'BDT',
      color TEXT NOT NULL,
      pinned_until TEXT NOT NULL,
      transaction_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sc_stream ON super_chats(stream_id);
    CREATE INDEX IF NOT EXISTS idx_sc_user ON super_chats(user_id);
    CREATE INDEX IF NOT EXISTS idx_sc_pinned ON super_chats(pinned_until);
  `);
}

export interface CreateSuperChatInput {
  stream_id: string;
  user_id: string;
  username: string;
  content: string;
  amount: number;
  currency?: string;
  transaction_id?: string;
}

export function createSuperChat(input: CreateSuperChatInput): SuperChat {
  const db = getDb();

  if (input.amount < MIN_SUPER_CHAT_AMOUNT) {
    throw new Error(`Minimum Super Chat amount is ৳${MIN_SUPER_CHAT_AMOUNT}`);
  }

  const style = amountToStyle(input.amount);
  const now = new Date();
  const pinUntil = new Date(now.getTime() + style.pinSeconds * 1000);

  const sc: SuperChat = {
    id: randomUUID(),
    stream_id: input.stream_id,
    user_id: input.user_id,
    username: input.username,
    content: input.content.trim().slice(0, 200),
    amount: input.amount,
    currency: input.currency ?? 'BDT',
    color: style.color,
    pinned_until: pinUntil.toISOString(),
    transaction_id: input.transaction_id ?? null,
    created_at: now.toISOString(),
  };

  db.prepare(`
    INSERT INTO super_chats (id, stream_id, user_id, username, content, amount, currency,
      color, pinned_until, transaction_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sc.id, sc.stream_id, sc.user_id, sc.username, sc.content, sc.amount, sc.currency,
    sc.color, sc.pinned_until, sc.transaction_id, sc.created_at
  );

  return sc;
}

export function listSuperChats(streamId: string, limit = 50): SuperChat[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM super_chats WHERE stream_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(streamId, limit) as SuperChat[];
}

export function listActivePinned(streamId: string): SuperChat[] {
  const db = getDb();
  const now = new Date().toISOString();
  return db.prepare(`
    SELECT * FROM super_chats
    WHERE stream_id = ? AND pinned_until > ?
    ORDER BY amount DESC, created_at DESC
    LIMIT 5
  `).all(streamId, now) as SuperChat[];
}

export interface SuperChatStats {
  total_count: number;
  total_revenue: number;
  revenue_last_30d: number;
  top_supporters: { user_id: string; username: string; total: number }[];
}

export function getSuperChatStats(): SuperChatStats {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as n FROM super_chats').get() as { n: number }).n;
  const rev = (db.prepare('SELECT COALESCE(SUM(amount), 0) as s FROM super_chats').get() as { s: number }).s;
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rev30 = (db.prepare('SELECT COALESCE(SUM(amount), 0) as s FROM super_chats WHERE created_at >= ?').get(cutoff) as { s: number }).s;
  const top = db.prepare(`
    SELECT user_id, username, SUM(amount) as total
    FROM super_chats
    GROUP BY user_id, username
    ORDER BY total DESC
    LIMIT 10
  `).all() as { user_id: string; username: string; total: number }[];
  return {
    total_count: total,
    total_revenue: rev,
    revenue_last_30d: rev30,
    top_supporters: top,
  };
}

export interface StreamSuperChatStats {
  stream_id: string;
  total_count: number;
  total_amount: number;
}

export function getStreamSuperChatStats(streamId: string): StreamSuperChatStats {
  const db = getDb();
  const row = db.prepare(`
    SELECT COUNT(*) as n, COALESCE(SUM(amount), 0) as s
    FROM super_chats WHERE stream_id = ?
  `).get(streamId) as { n: number; s: number };
  return { stream_id: streamId, total_count: row.n, total_amount: row.s };
}
