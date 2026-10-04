// melodyflix videos — Emoji Reactions & Rich Media (Section 148)
// 148.1 Emoji Reactions  148.2 Custom Emoji Sets  148.3 Stickers
// 148.4 Animated GIFs    148.5 Reaction Analytics  148.6 Super Thanks
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';
import {
  getIntegrationConfigRaw, isIntegrationReady,
} from './integration-settings.service.js';

export type ReactionEmoji = 'like' | 'love' | 'haha' | 'wow' | 'sad' | 'angry';
export type ReactableType = 'video' | 'comment' | 'community_post' | 'clip' | 'news' | 'story';

const VALID_EMOJI: ReactionEmoji[] = ['like', 'love', 'haha', 'wow', 'sad', 'angry'];
const VALID_TYPES: ReactableType[] = ['video', 'comment', 'community_post', 'clip', 'news', 'story'];

export interface Reaction {
  id: string;
  user_id: string;
  reactable_type: ReactableType;
  reactable_id: string;
  emoji: ReactionEmoji;
  created_at: string;
  updated_at: string;
}

export interface ReactionSummary {
  reactable_type: ReactableType;
  reactable_id: string;
  total: number;
  counts: Record<ReactionEmoji, number>;
  my_reaction: ReactionEmoji | null;
}

export interface CustomEmoji {
  id: string;
  slug: string;
  name: string;
  image_url: string;
  category: string;
  is_public: number;
  is_active: number;
  created_by: string;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

export interface Sticker {
  id: string;
  name: string;
  image_url: string;
  pack_id: string | null;
  tags: string | null;
  is_public: number;
  is_active: number;
  created_by: string;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

export interface StickerPack {
  id: string;
  name: string;
  slug: string;
  thumbnail_url: string | null;
  is_public: number;
  is_active: number;
  created_by: string;
  sticker_count: number;
  created_at: string;
  updated_at: string;
}

export interface GifSearchResult {
  id: string;
  url: string;
  preview_url: string;
  title: string;
  source: 'giphy' | 'tenor';
  width: number;
  height: number;
}

export interface SuperThanks {
  id: string;
  user_id: string;
  video_id: string;
  amount_cents: number;
  currency: string;
  message: string | null;
  emoji: string;
  display_mode: 'public' | 'anonymous';
  wallet_transaction_id: string | null;
  created_at: string;
}

// ============================================================
// Schema
// ============================================================

export function ensureReactionsSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS reactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      reactable_type TEXT NOT NULL,
      reactable_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (user_id, reactable_type, reactable_id)
    );
    CREATE INDEX IF NOT EXISTS idx_react_target ON reactions(reactable_type, reactable_id, emoji);
    CREATE INDEX IF NOT EXISTS idx_react_user ON reactions(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS custom_emojis (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      image_url TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      is_public INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ce_category ON custom_emojis(category, is_active);

    CREATE TABLE IF NOT EXISTS sticker_packs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
      thumbnail_url TEXT,
      is_public INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      sticker_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stickers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      image_url TEXT NOT NULL,
      pack_id TEXT,
      tags TEXT,
      is_public INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sticker_pack ON stickers(pack_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_sticker_public ON stickers(is_public, is_active);

    CREATE TABLE IF NOT EXISTS super_thanks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'BDT',
      message TEXT,
      emoji TEXT NOT NULL DEFAULT '❤️',
      display_mode TEXT NOT NULL DEFAULT 'public',
      wallet_transaction_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_st_video ON super_thanks(video_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_st_user ON super_thanks(user_id, created_at DESC);
  `);
}

// ============================================================
// 148.1 — Reactions
// ============================================================

function validateTarget(type: ReactableType, id: string): void {
  if (!VALID_TYPES.includes(type)) throw new Error('Invalid reactable_type');
  if (!id || id.length < 1 || id.length > 100) throw new Error('reactable_id required');
}

export function setReaction(input: {
  user_id: string;
  reactable_type: ReactableType;
  reactable_id: string;
  emoji: ReactionEmoji;
}): Reaction {
  validateTarget(input.reactable_type, input.reactable_id);
  if (!VALID_EMOJI.includes(input.emoji)) throw new Error('Invalid emoji');

  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare(
    'SELECT * FROM reactions WHERE user_id = ? AND reactable_type = ? AND reactable_id = ?'
  ).get(input.user_id, input.reactable_type, input.reactable_id) as Reaction | undefined;

  if (existing) {
    if (existing.emoji === input.emoji) {
      // Toggle off — same emoji = remove
      db.prepare('DELETE FROM reactions WHERE id = ?').run(existing.id);
      throw new Error('REACTION_REMOVED'); // sentinel — route catches and returns removed
    }
    db.prepare('UPDATE reactions SET emoji = ?, updated_at = ? WHERE id = ?')
      .run(input.emoji, now, existing.id);
    return db.prepare('SELECT * FROM reactions WHERE id = ?').get(existing.id) as Reaction;
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO reactions (id, user_id, reactable_type, reactable_id, emoji, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.user_id, input.reactable_type, input.reactable_id, input.emoji, now, now);

  return db.prepare('SELECT * FROM reactions WHERE id = ?').get(id) as Reaction;
}

/** Remove any reaction by a user for a target. Returns true if deleted. */
export function removeReaction(userId: string, type: ReactableType, id: string): boolean {
  const info = getDb().prepare(
    'DELETE FROM reactions WHERE user_id = ? AND reactable_type = ? AND reactable_id = ?'
  ).run(userId, type, id);
  return Number(info.changes ?? 0) > 0;
}

export function getReactionSummary(type: ReactableType, id: string, viewerId?: string | null): ReactionSummary {
  const db = getDb();
  const rows = db.prepare(
    'SELECT emoji, COUNT(*) as n FROM reactions WHERE reactable_type = ? AND reactable_id = ? GROUP BY emoji'
  ).all(type, id) as Array<{ emoji: ReactionEmoji; n: number }>;

  const counts: Record<ReactionEmoji, number> = { like: 0, love: 0, haha: 0, wow: 0, sad: 0, angry: 0 };
  let total = 0;
  for (const r of rows) {
    counts[r.emoji] = r.n;
    total += r.n;
  }

  let mine: ReactionEmoji | null = null;
  if (viewerId) {
    const my = db.prepare(
      'SELECT emoji FROM reactions WHERE user_id = ? AND reactable_type = ? AND reactable_id = ?'
    ).get(viewerId, type, id) as { emoji: ReactionEmoji } | undefined;
    mine = my?.emoji ?? null;
  }

  return { reactable_type: type, reactable_id: id, total, counts, my_reaction: mine };
}

export function listUserReactions(userId: string, limit = 50): Reaction[] {
  return getDb().prepare(
    'SELECT * FROM reactions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?'
  ).all(userId, Math.min(Math.max(limit, 1), 200)) as Reaction[];
}

// ============================================================
// 148.2 — Custom Emoji Sets
// ============================================================

export function createCustomEmoji(input: {
  slug: string;
  name: string;
  image_url: string;
  category?: string;
  created_by: string;
  is_public?: boolean;
}): CustomEmoji {
  const slug = (input.slug ?? '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,40}$/.test(slug)) throw new Error('slug must be 2-40 chars (a-z, 0-9, _, -)');
  const name = (input.name ?? '').trim();
  if (name.length < 1 || name.length > 60) throw new Error('name must be 1-60 chars');
  if (!/^https?:\/\//i.test(input.image_url)) throw new Error('image_url must be http(s)');

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  try {
    db.prepare(`
      INSERT INTO custom_emojis (id, slug, name, image_url, category, is_public, is_active, created_by, usage_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, 0, ?, ?)
    `).run(id, slug, name, input.image_url, input.category ?? 'general',
      input.is_public === false ? 0 : 1, input.created_by, now, now);
  } catch (e: any) {
    if (String(e?.message ?? '').includes('UNIQUE')) throw new Error('slug already taken');
    throw e;
  }
  return getCustomEmoji(id)!;
}

export function getCustomEmoji(idOrSlug: string): CustomEmoji | null {
  return (getDb().prepare('SELECT * FROM custom_emojis WHERE id = ? OR slug = ?').get(idOrSlug, idOrSlug) as CustomEmoji | undefined) ?? null;
}

export function listCustomEmojis(opts: { category?: string; public_only?: boolean; limit?: number } = {}): CustomEmoji[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const filters: string[] = ['is_active = 1'];
  const params: any[] = [];
  if (opts.category) { filters.push('category = ?'); params.push(opts.category); }
  if (opts.public_only) filters.push('is_public = 1');
  params.push(limit);
  return db.prepare(
    `SELECT * FROM custom_emojis WHERE ${filters.join(' AND ')} ORDER BY usage_count DESC, created_at DESC LIMIT ?`
  ).all(...params) as CustomEmoji[];
}

export function updateCustomEmoji(id: string, requesterId: string, isAdmin: boolean, patch: {
  name?: string;
  image_url?: string;
  category?: string;
  is_public?: boolean;
  is_active?: boolean;
}): CustomEmoji {
  const existing = getCustomEmoji(id);
  if (!existing) throw new Error('Custom emoji not found');
  if (!isAdmin && existing.created_by !== requesterId) throw new Error('Not authorized');

  const db = getDb();
  const fields: string[] = [];
  const params: any[] = [];
  if (patch.name !== undefined) { fields.push('name = ?'); params.push(patch.name); }
  if (patch.image_url !== undefined) { fields.push('image_url = ?'); params.push(patch.image_url); }
  if (patch.category !== undefined) { fields.push('category = ?'); params.push(patch.category); }
  if (patch.is_public !== undefined) { fields.push('is_public = ?'); params.push(patch.is_public ? 1 : 0); }
  if (patch.is_active !== undefined) { fields.push('is_active = ?'); params.push(patch.is_active ? 1 : 0); }
  if (fields.length === 0) return existing;
  fields.push('updated_at = ?'); params.push(new Date().toISOString());
  params.push(id);
  db.prepare(`UPDATE custom_emojis SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getCustomEmoji(id)!;
}

export function recordCustomEmojiUse(idOrSlug: string): void {
  const e = getCustomEmoji(idOrSlug);
  if (!e) return;
  getDb().prepare('UPDATE custom_emojis SET usage_count = usage_count + 1 WHERE id = ?').run(e.id);
}

export function deleteCustomEmoji(id: string, requesterId: string, isAdmin: boolean): boolean {
  const existing = getCustomEmoji(id);
  if (!existing) return false;
  if (!isAdmin && existing.created_by !== requesterId) throw new Error('Not authorized');
  return Number(getDb().prepare('DELETE FROM custom_emojis WHERE id = ?').run(id).changes ?? 0) > 0;
}

// ============================================================
// 148.3 — Stickers
// ============================================================

export function createStickerPack(input: {
  name: string;
  slug: string;
  created_by: string;
  thumbnail_url?: string | null;
  is_public?: boolean;
}): StickerPack {
  const slug = (input.slug ?? '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,40}$/.test(slug)) throw new Error('slug must be 2-40 chars');
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  try {
    db.prepare(`
      INSERT INTO sticker_packs (id, name, slug, thumbnail_url, is_public, is_active, created_by, sticker_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, 0, ?, ?)
    `).run(id, input.name.trim(), slug, input.thumbnail_url ?? null,
      input.is_public === false ? 0 : 1, input.created_by, now, now);
  } catch (e: any) {
    if (String(e?.message ?? '').includes('UNIQUE')) throw new Error('slug already taken');
    throw e;
  }
  return getStickerPack(id)!;
}

export function getStickerPack(id: string): StickerPack | null {
  return (getDb().prepare('SELECT * FROM sticker_packs WHERE id = ?').get(id) as StickerPack | undefined) ?? null;
}

export function listStickerPacks(opts: { public_only?: boolean; limit?: number } = {}): StickerPack[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const filters: string[] = ['is_active = 1'];
  if (opts.public_only) filters.push('is_public = 1');
  return db.prepare(
    `SELECT * FROM sticker_packs WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT ?`
  ).all(limit) as StickerPack[];
}

export function createSticker(input: {
  name: string;
  image_url: string;
  created_by: string;
  pack_id?: string | null;
  tags?: string[];
  is_public?: boolean;
}): Sticker {
  const name = (input.name ?? '').trim();
  if (name.length < 1 || name.length > 100) throw new Error('name must be 1-100 chars');
  if (!/^https?:\/\//i.test(input.image_url)) throw new Error('image_url must be http(s)');
  if (input.pack_id) {
    const pack = getStickerPack(input.pack_id);
    if (!pack) throw new Error('Sticker pack not found');
  }
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO stickers (id, name, image_url, pack_id, tags, is_public, is_active, created_by, usage_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, 0, ?, ?)
    `).run(id, name, input.image_url, input.pack_id ?? null,
      input.tags ? JSON.stringify(input.tags.slice(0, 20)) : null,
      input.is_public === false ? 0 : 1, input.created_by, now, now);
    if (input.pack_id) {
      db.prepare('UPDATE sticker_packs SET sticker_count = sticker_count + 1, updated_at = ? WHERE id = ?')
        .run(now, input.pack_id);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return getSticker(id)!;
}

export function getSticker(id: string): Sticker | null {
  return (getDb().prepare('SELECT * FROM stickers WHERE id = ?').get(id) as Sticker | undefined) ?? null;
}

export function listStickers(opts: { pack_id?: string; public_only?: boolean; limit?: number } = {}): Sticker[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const filters: string[] = ['is_active = 1'];
  const params: any[] = [];
  if (opts.pack_id) { filters.push('pack_id = ?'); params.push(opts.pack_id); }
  if (opts.public_only) filters.push('is_public = 1');
  params.push(limit);
  return db.prepare(
    `SELECT * FROM stickers WHERE ${filters.join(' AND ')} ORDER BY usage_count DESC, created_at DESC LIMIT ?`
  ).all(...params) as Sticker[];
}

export function recordStickerUse(id: string): void {
  getDb().prepare('UPDATE stickers SET usage_count = usage_count + 1 WHERE id = ?').run(id);
}

export function deleteSticker(id: string, requesterId: string, isAdmin: boolean): boolean {
  const existing = getSticker(id);
  if (!existing) return false;
  if (!isAdmin && existing.created_by !== requesterId) throw new Error('Not authorized');
  const db = getDb();
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM stickers WHERE id = ?').run(id);
    if (existing.pack_id) {
      db.prepare('UPDATE sticker_packs SET sticker_count = MAX(0, sticker_count - 1), updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), existing.pack_id);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return true;
}

// ============================================================
// 148.4 — Animated GIFs (Giphy + Tenor via integration settings)
// ============================================================

const GIPHY_TIMEOUT_MS = 8000;

interface GiphyRaw {
  data?: Array<{
    id: string;
    title?: string;
    images?: {
      fixed_height?: { url?: string; width?: string; height?: string };
      fixed_height_small?: { url?: string };
      original?: { url?: string; width?: string; height?: string };
    };
  }>;
}

interface TenorRaw {
  results?: Array<{
    id: string;
    content_description?: string;
    media_formats?: {
      gif?: { url: string; dims?: number[] };
      tinygif?: { url: string; dims?: number[] };
    };
  }>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), GIPHY_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json() as T;
  } finally { clearTimeout(t); }
}

export async function searchGifs(query: string, limit = 25): Promise<GifSearchResult[]> {
  if (!isIntegrationReady('giphy')) {
    throw new Error('Giphy is not configured. Set API key in admin panel > Integrations.');
  }
  const cfg = getIntegrationConfigRaw('giphy');
  const apiKey = String(cfg?.api_key ?? '');
  if (!apiKey) throw new Error('Giphy api_key missing');

  const q = (query ?? '').trim();
  if (q.length < 1 || q.length > 100) throw new Error('query must be 1-100 chars');
  const n = Math.min(Math.max(limit, 1), 50);

  const url = new URL('https://api.giphy.com/v1/gifs/search');
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('q', q);
  url.searchParams.set('limit', String(n));
  url.searchParams.set('rating', String(cfg?.rating ?? 'pg-13'));

  const raw = await fetchJson<GiphyRaw>(url.toString());
  return (raw.data ?? []).map((g) => ({
    id: g.id,
    url: g.images?.original?.url ?? g.images?.fixed_height?.url ?? '',
    preview_url: g.images?.fixed_height_small?.url ?? g.images?.fixed_height?.url ?? '',
    title: g.title ?? '',
    source: 'giphy' as const,
    width: parseInt(g.images?.original?.width ?? '0', 10),
    height: parseInt(g.images?.original?.height ?? '0', 10),
  })).filter((g) => g.url);
}

export async function trendingGifs(limit = 25): Promise<GifSearchResult[]> {
  if (!isIntegrationReady('giphy')) throw new Error('Giphy is not configured');
  const cfg = getIntegrationConfigRaw('giphy');
  const apiKey = String(cfg?.api_key ?? '');
  const n = Math.min(Math.max(limit, 1), 50);

  const url = new URL('https://api.giphy.com/v1/gifs/trending');
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('limit', String(n));
  url.searchParams.set('rating', String(cfg?.rating ?? 'pg-13'));

  const raw = await fetchJson<GiphyRaw>(url.toString());
  return (raw.data ?? []).map((g) => ({
    id: g.id,
    url: g.images?.original?.url ?? '',
    preview_url: g.images?.fixed_height_small?.url ?? '',
    title: g.title ?? '',
    source: 'giphy' as const,
    width: parseInt(g.images?.original?.width ?? '0', 10),
    height: parseInt(g.images?.original?.height ?? '0', 10),
  })).filter((g) => g.url);
}

export async function searchTenor(query: string, limit = 25): Promise<GifSearchResult[]> {
  if (!isIntegrationReady('tenor')) throw new Error('Tenor is not configured');
  const cfg = getIntegrationConfigRaw('tenor');
  const apiKey = String(cfg?.api_key ?? '');
  if (!apiKey) throw new Error('Tenor api_key missing');

  const q = (query ?? '').trim();
  if (q.length < 1 || q.length > 100) throw new Error('query must be 1-100 chars');
  const n = Math.min(Math.max(limit, 1), 50);

  const url = new URL('https://tenor.googleapis.com/v2/search');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('q', q);
  url.searchParams.set('limit', String(n));
  url.searchParams.set('locale', String(cfg?.locale ?? 'en_US'));

  const raw = await fetchJson<TenorRaw>(url.toString());
  return (raw.results ?? []).map((g) => ({
    id: g.id,
    url: g.media_formats?.gif?.url ?? '',
    preview_url: g.media_formats?.tinygif?.url ?? '',
    title: g.content_description ?? '',
    source: 'tenor' as const,
    width: g.media_formats?.gif?.dims?.[0] ?? 0,
    height: g.media_formats?.gif?.dims?.[1] ?? 0,
  })).filter((g) => g.url);
}

export function getGifProvidersStatus(): Array<{ provider: 'giphy' | 'tenor'; ready: boolean }> {
  return [
    { provider: 'giphy', ready: isIntegrationReady('giphy') },
    { provider: 'tenor', ready: isIntegrationReady('tenor') },
  ];
}

// ============================================================
// 148.5 — Reaction Analytics
// ============================================================

export interface ReactionStats {
  reactable_type: ReactableType;
  reactable_id: string;
  total: number;
  counts: Record<ReactionEmoji, number>;
  latest_at: string | null;
}

export function getReactionStats(type: ReactableType, id: string): ReactionStats {
  const summary = getReactionSummary(type, id);
  const row = getDb().prepare(
    'SELECT MAX(created_at) as latest FROM reactions WHERE reactable_type = ? AND reactable_id = ?'
  ).get(type, id) as { latest: string | null };
  return {
    reactable_type: type,
    reactable_id: id,
    total: summary.total,
    counts: summary.counts,
    latest_at: row.latest,
  };
}

export function listTopReacted(type: ReactableType, limit = 20): Array<{ reactable_id: string; total: number }> {
  return getDb().prepare(`
    SELECT reactable_id, COUNT(*) as total FROM reactions
    WHERE reactable_type = ? GROUP BY reactable_id ORDER BY total DESC LIMIT ?
  `).all(type, Math.min(Math.max(limit, 1), 200)) as Array<{ reactable_id: string; total: number }>;
}

export function listUserReactionBreakdown(userId: string): Record<ReactionEmoji, number> {
  const rows = getDb().prepare(
    'SELECT emoji, COUNT(*) as n FROM reactions WHERE user_id = ? GROUP BY emoji'
  ).all(userId) as Array<{ emoji: ReactionEmoji; n: number }>;
  const out: Record<ReactionEmoji, number> = { like: 0, love: 0, haha: 0, wow: 0, sad: 0, angry: 0 };
  for (const r of rows) out[r.emoji] = r.n;
  return out;
}

// ============================================================
// 148.6 — Super Thanks
// ============================================================

export function createSuperThanks(input: {
  user_id: string;
  video_id: string;
  amount_cents: number;
  message?: string | null;
  emoji?: string;
  display_mode?: 'public' | 'anonymous';
  currency?: string;
}): SuperThanks {
  if (input.amount_cents <= 0) throw new Error('amount must be positive');
  if (input.amount_cents > 500_000_00) throw new Error('amount exceeds max (500,000 BDT)');
  if (input.message && input.message.length > 500) throw new Error('message too long (500 max)');

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO super_thanks
      (id, user_id, video_id, amount_cents, currency, message, emoji, display_mode, wallet_transaction_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
  `).run(id, input.user_id, input.video_id, input.amount_cents,
    input.currency ?? 'BDT', input.message ?? null,
    input.emoji ?? '❤️', input.display_mode ?? 'public', now);
  return getSuperThanks(id)!;
}

export function getSuperThanks(id: string): SuperThanks | null {
  return (getDb().prepare('SELECT * FROM super_thanks WHERE id = ?').get(id) as SuperThanks | undefined) ?? null;
}

export function listVideoSuperThanks(videoId: string, limit = 50): SuperThanks[] {
  return getDb().prepare(
    'SELECT * FROM super_thanks WHERE video_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(videoId, Math.min(Math.max(limit, 1), 200)) as SuperThanks[];
}

export function listUserSuperThanks(userId: string, limit = 50): SuperThanks[] {
  return getDb().prepare(
    'SELECT * FROM super_thanks WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(userId, Math.min(Math.max(limit, 1), 200)) as SuperThanks[];
}

export function getVideoSuperThanksTotal(videoId: string): { total_cents: number; count: number } {
  const row = getDb().prepare(
    'SELECT COALESCE(SUM(amount_cents), 0) as total, COUNT(*) as n FROM super_thanks WHERE video_id = ?'
  ).get(videoId) as { total: number; n: number };
  return { total_cents: row.total, count: row.n };
}
