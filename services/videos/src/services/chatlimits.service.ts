// melodyflix - chat limits (free tier + paid)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

const FREE_MESSAGE_LIMIT = 7;
const MESSAGE_PACK_SIZE = 20;
const MESSAGE_PACK_PRICE_BDT = 50;

export interface ChatLimit {
  user_id: string;
  free_used: number;
  paid_balance: number;
  total_messages_sent: number;
  created_at: string;
  updated_at: string;
}

export interface ChatUsage {
  free_used: number;
  free_remaining: number;
  free_limit: number;
  paid_balance: number;
  total_messages_sent: number;
  can_send: boolean;
  requires_payment: boolean;
  pack_price: number;
  pack_size: number;
}

export function ensureChatLimitsSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_limits (
      user_id TEXT PRIMARY KEY,
      free_used INTEGER NOT NULL DEFAULT 0,
      paid_balance INTEGER NOT NULL DEFAULT 0,
      total_messages_sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS message_purchases (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      transaction_id TEXT,
      pack_size INTEGER NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mp_user ON message_purchases(user_id);
  `);
}

export function getOrCreateLimit(userId: string): ChatLimit {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM chat_limits WHERE user_id = ?').get(userId) as ChatLimit | undefined;
  if (existing) return existing;
  const now = new Date().toISOString();
  const limit: ChatLimit = {
    user_id: userId,
    free_used: 0,
    paid_balance: 0,
    total_messages_sent: 0,
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO chat_limits (user_id, free_used, paid_balance, total_messages_sent, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(limit.user_id, limit.free_used, limit.paid_balance, limit.total_messages_sent, now, now);
  return limit;
}

export function getChatUsage(userId: string): ChatUsage {
  const limit = getOrCreateLimit(userId);
  const freeRemaining = Math.max(0, FREE_MESSAGE_LIMIT - limit.free_used);
  const canSend = freeRemaining > 0 || limit.paid_balance > 0;
  return {
    free_used: limit.free_used,
    free_remaining: freeRemaining,
    free_limit: FREE_MESSAGE_LIMIT,
    paid_balance: limit.paid_balance,
    total_messages_sent: limit.total_messages_sent,
    can_send: canSend,
    requires_payment: !canSend,
    pack_price: MESSAGE_PACK_PRICE_BDT,
    pack_size: MESSAGE_PACK_SIZE,
  };
}

export function consumeMessageCredit(userId: string): 'free' | 'paid' {
  const db = getDb();
  const limit = getOrCreateLimit(userId);
  const now = new Date().toISOString();
  const freeRemaining = Math.max(0, FREE_MESSAGE_LIMIT - limit.free_used);
  if (freeRemaining > 0) {
    db.prepare(`
      UPDATE chat_limits SET free_used = free_used + 1, total_messages_sent = total_messages_sent + 1, updated_at = ?
      WHERE user_id = ?
    `).run(now, userId);
    return 'free';
  }
  if (limit.paid_balance > 0) {
    db.prepare(`
      UPDATE chat_limits SET paid_balance = paid_balance - 1, total_messages_sent = total_messages_sent + 1, updated_at = ?
      WHERE user_id = ?
    `).run(now, userId);
    return 'paid';
  }
  throw new Error('MESSAGE_LIMIT_REACHED');
}

export function grantMessagePack(userId: string, transactionId: string | null, size: number = MESSAGE_PACK_SIZE, amount: number = MESSAGE_PACK_PRICE_BDT): void {
  const db = getDb();
  getOrCreateLimit(userId);
  const now = new Date().toISOString();
  db.prepare('UPDATE chat_limits SET paid_balance = paid_balance + ?, updated_at = ? WHERE user_id = ?')
    .run(size, now, userId);
  db.prepare(`
    INSERT INTO message_purchases (id, user_id, transaction_id, pack_size, amount, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'completed', ?)
  `).run(randomUUID(), userId, transactionId, size, amount, now);
}

export function resetUserFreeCredits(userId: string): void {
  const db = getDb();
  db.prepare('UPDATE chat_limits SET free_used = 0, updated_at = ? WHERE user_id = ?')
    .run(new Date().toISOString(), userId);
}

export interface ChatLimitsStats {
  total_users: number;
  free_users: number;
  paying_users: number;
  total_messages: number;
  total_paid_messages: number;
  total_pack_revenue: number;
}

export function getChatLimitsStats(): ChatLimitsStats {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as n FROM chat_limits').get() as { n: number }).n;
  const freeU = (db.prepare('SELECT COUNT(*) as n FROM chat_limits WHERE free_used < ?').get(FREE_MESSAGE_LIMIT) as { n: number }).n;
  const paying = (db.prepare('SELECT COUNT(*) as n FROM chat_limits WHERE paid_balance > 0').get() as { n: number }).n;
  const totalMsg = (db.prepare('SELECT COALESCE(SUM(total_messages_sent), 0) as s FROM chat_limits').get() as { s: number }).s;
  const paidMsg = (db.prepare('SELECT COUNT(*) as n FROM message_purchases').get() as { n: number }).n * MESSAGE_PACK_SIZE;
  const rev = (db.prepare("SELECT COALESCE(SUM(amount), 0) as s FROM message_purchases WHERE status = 'completed'").get() as { s: number }).s;
  return {
    total_users: total,
    free_users: freeU,
    paying_users: paying,
    total_messages: totalMsg,
    total_paid_messages: paidMsg,
    total_pack_revenue: rev,
  };
}

export const CHAT_LIMIT_CONSTANTS = {
  FREE_MESSAGE_LIMIT,
  MESSAGE_PACK_SIZE,
  MESSAGE_PACK_PRICE_BDT,
};
