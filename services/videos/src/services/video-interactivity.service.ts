// melodyflix videos - Section 24 Video Interactivity
// Clickable hotspots, branching video, info cards, shoppable products.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type HotspotActionType = 'link' | 'seek' | 'branch' | 'tooltip';
export type CardType = 'info' | 'channel' | 'video' | 'playlist' | 'link';
export type BranchTargetKind = 'video' | 'ending';

export function ensureVideoInteractivitySchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_hotspots (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      label TEXT NOT NULL,
      start_seconds REAL NOT NULL,
      end_seconds REAL NOT NULL,
      x REAL NOT NULL DEFAULT 0.5,
      y REAL NOT NULL DEFAULT 0.5,
      width REAL NOT NULL DEFAULT 0.1,
      height REAL NOT NULL DEFAULT 0.1,
      action_type TEXT NOT NULL DEFAULT 'link'
        CHECK (action_type IN ('link','seek','branch','tooltip')),
      action_value TEXT,
      tooltip TEXT,
      style TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hotspot_video ON video_hotspots(video_id, active, start_seconds);

    CREATE TABLE IF NOT EXISTS video_cards (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      card_type TEXT NOT NULL
        CHECK (card_type IN ('info','channel','video','playlist','link')),
      show_at_seconds REAL NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      target_id TEXT,
      target_url TEXT,
      thumbnail_url TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_card_video ON video_cards(video_id, active, show_at_seconds);

    CREATE TABLE IF NOT EXISTS video_branches (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      at_seconds REAL NOT NULL,
      prompt TEXT NOT NULL,
      target_kind TEXT NOT NULL DEFAULT 'video'
        CHECK (target_kind IN ('video','ending')),
      target_video_id TEXT,
      label TEXT NOT NULL,
      countdown_seconds INTEGER NOT NULL DEFAULT 10,
      is_default INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_branch_video ON video_branches(video_id, at_seconds);

    CREATE TABLE IF NOT EXISTS shoppable_products (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      product_url TEXT NOT NULL,
      image_url TEXT,
      price_cents INTEGER,
      currency TEXT NOT NULL DEFAULT 'USD',
      show_from_seconds REAL NOT NULL DEFAULT 0,
      show_to_seconds REAL,
      description TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_shop_video ON shoppable_products(video_id, active, show_from_seconds);
  `);
}

// ---------- Hotspots ----------

export interface Hotspot {
  id: string;
  video_id: string;
  channel_id: string;
  label: string;
  start_seconds: number;
  end_seconds: number;
  x: number;
  y: number;
  width: number;
  height: number;
  action_type: HotspotActionType;
  action_value: string | null;
  tooltip: string | null;
  style: string | null;
  active: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateHotspotInput {
  video_id: string;
  channel_id: string;
  label: string;
  start_seconds: number;
  end_seconds: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  action_type?: HotspotActionType;
  action_value?: string | null;
  tooltip?: string | null;
  style?: string | null;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function createHotspot(input: CreateHotspotInput, createdBy: string): Hotspot {
  const db = getDb();
  if (input.end_seconds <= input.start_seconds) throw new Error('end_seconds_must_exceed_start');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO video_hotspots
    (id, video_id, channel_id, label, start_seconds, end_seconds, x, y, width, height,
     action_type, action_value, tooltip, style, active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(
    id, input.video_id, input.channel_id, input.label.slice(0, 120),
    input.start_seconds, input.end_seconds,
    clamp01(input.x ?? 0.5), clamp01(input.y ?? 0.5),
    clamp01(input.width ?? 0.1), clamp01(input.height ?? 0.1),
    input.action_type ?? 'link', input.action_value ?? null,
    input.tooltip ?? null, input.style ?? null, createdBy, now, now,
  );
  return db.prepare('SELECT * FROM video_hotspots WHERE id = ?').get(id) as Hotspot;
}

export function listHotspots(videoId: string, activeOnly = true): Hotspot[] {
  const db = getDb();
  if (activeOnly) {
    return db.prepare('SELECT * FROM video_hotspots WHERE video_id = ? AND active = 1 ORDER BY start_seconds ASC').all(videoId) as Hotspot[];
  }
  return db.prepare('SELECT * FROM video_hotspots WHERE video_id = ? ORDER BY start_seconds ASC').all(videoId) as Hotspot[];
}

export function updateHotspot(id: string, channelId: string, patch: Partial<CreateHotspotInput> & { active?: boolean }): Hotspot | null {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM video_hotspots WHERE id = ?').get(id) as Hotspot | undefined;
  if (!existing || existing.channel_id !== channelId) return null;
  const f: string[] = [];
  const v: unknown[] = [];
  if (patch.label !== undefined) { f.push('label = ?'); v.push(patch.label.slice(0, 120)); }
  if (patch.start_seconds !== undefined) { f.push('start_seconds = ?'); v.push(patch.start_seconds); }
  if (patch.end_seconds !== undefined) { f.push('end_seconds = ?'); v.push(patch.end_seconds); }
  if (patch.x !== undefined) { f.push('x = ?'); v.push(clamp01(patch.x)); }
  if (patch.y !== undefined) { f.push('y = ?'); v.push(clamp01(patch.y)); }
  if (patch.width !== undefined) { f.push('width = ?'); v.push(clamp01(patch.width)); }
  if (patch.height !== undefined) { f.push('height = ?'); v.push(clamp01(patch.height)); }
  if (patch.action_type !== undefined) { f.push('action_type = ?'); v.push(patch.action_type); }
  if (patch.action_value !== undefined) { f.push('action_value = ?'); v.push(patch.action_value); }
  if (patch.tooltip !== undefined) { f.push('tooltip = ?'); v.push(patch.tooltip); }
  if (patch.style !== undefined) { f.push('style = ?'); v.push(patch.style); }
  if (patch.active !== undefined) { f.push('active = ?'); v.push(patch.active ? 1 : 0); }
  if (!f.length) return existing;
  f.push('updated_at = ?'); v.push(new Date().toISOString());
  v.push(id);
  db.prepare(`UPDATE video_hotspots SET ${f.join(', ')} WHERE id = ?`).run(...v);
  return db.prepare('SELECT * FROM video_hotspots WHERE id = ?').get(id) as Hotspot;
}

export function deleteHotspot(id: string, channelId: string): boolean {
  const db = getDb();
  const existing = db.prepare('SELECT channel_id FROM video_hotspots WHERE id = ?').get(id) as { channel_id: string } | undefined;
  if (!existing || existing.channel_id !== channelId) return false;
  return db.prepare('DELETE FROM video_hotspots WHERE id = ?').run(id).changes > 0;
}

// ---------- Cards ----------

export interface VideoCard {
  id: string;
  video_id: string;
  channel_id: string;
  card_type: CardType;
  show_at_seconds: number;
  title: string;
  body: string | null;
  target_id: string | null;
  target_url: string | null;
  thumbnail_url: string | null;
  active: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateCardInput {
  video_id: string;
  channel_id: string;
  card_type: CardType;
  show_at_seconds: number;
  title: string;
  body?: string | null;
  target_id?: string | null;
  target_url?: string | null;
  thumbnail_url?: string | null;
}

export function createCard(input: CreateCardInput, createdBy: string): VideoCard {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO video_cards
    (id, video_id, channel_id, card_type, show_at_seconds, title, body, target_id, target_url, thumbnail_url, active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(
    id, input.video_id, input.channel_id, input.card_type, input.show_at_seconds,
    input.title.slice(0, 200), input.body ?? null,
    input.target_id ?? null, input.target_url ?? null, input.thumbnail_url ?? null,
    createdBy, now, now,
  );
  return db.prepare('SELECT * FROM video_cards WHERE id = ?').get(id) as VideoCard;
}

export function listCards(videoId: string, activeOnly = true): VideoCard[] {
  const db = getDb();
  if (activeOnly) {
    return db.prepare('SELECT * FROM video_cards WHERE video_id = ? AND active = 1 ORDER BY show_at_seconds ASC').all(videoId) as VideoCard[];
  }
  return db.prepare('SELECT * FROM video_cards WHERE video_id = ? ORDER BY show_at_seconds ASC').all(videoId) as VideoCard[];
}

export function deleteCard(id: string, channelId: string): boolean {
  const db = getDb();
  const existing = db.prepare('SELECT channel_id FROM video_cards WHERE id = ?').get(id) as { channel_id: string } | undefined;
  if (!existing || existing.channel_id !== channelId) return false;
  return db.prepare('DELETE FROM video_cards WHERE id = ?').run(id).changes > 0;
}

// ---------- Branches ----------

export interface VideoBranch {
  id: string;
  video_id: string;
  channel_id: string;
  at_seconds: number;
  prompt: string;
  target_kind: BranchTargetKind;
  target_video_id: string | null;
  label: string;
  countdown_seconds: number;
  is_default: number;
  active: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateBranchInput {
  video_id: string;
  channel_id: string;
  at_seconds: number;
  prompt: string;
  target_kind?: BranchTargetKind;
  target_video_id?: string | null;
  label: string;
  countdown_seconds?: number;
  is_default?: boolean;
}

export function createBranch(input: CreateBranchInput, createdBy: string): VideoBranch {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO video_branches
    (id, video_id, channel_id, at_seconds, prompt, target_kind, target_video_id, label,
     countdown_seconds, is_default, active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(
    id, input.video_id, input.channel_id, input.at_seconds,
    input.prompt.slice(0, 300), input.target_kind ?? 'video',
    input.target_video_id ?? null, input.label.slice(0, 120),
    Math.max(0, Math.min(input.countdown_seconds ?? 10, 60)),
    input.is_default ? 1 : 0,
    createdBy, now, now,
  );
  return db.prepare('SELECT * FROM video_branches WHERE id = ?').get(id) as VideoBranch;
}

export function listBranches(videoId: string, activeOnly = true): VideoBranch[] {
  const db = getDb();
  if (activeOnly) {
    return db.prepare('SELECT * FROM video_branches WHERE video_id = ? AND active = 1 ORDER BY at_seconds ASC').all(videoId) as VideoBranch[];
  }
  return db.prepare('SELECT * FROM video_branches WHERE video_id = ? ORDER BY at_seconds ASC').all(videoId) as VideoBranch[];
}

export function deleteBranch(id: string, channelId: string): boolean {
  const db = getDb();
  const existing = db.prepare('SELECT channel_id FROM video_branches WHERE id = ?').get(id) as { channel_id: string } | undefined;
  if (!existing || existing.channel_id !== channelId) return false;
  return db.prepare('DELETE FROM video_branches WHERE id = ?').run(id).changes > 0;
}

// ---------- Shoppable products ----------

export interface ShoppableProduct {
  id: string;
  video_id: string;
  channel_id: string;
  product_name: string;
  product_url: string;
  image_url: string | null;
  price_cents: number | null;
  currency: string;
  show_from_seconds: number;
  show_to_seconds: number | null;
  description: string | null;
  active: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateShoppableInput {
  video_id: string;
  channel_id: string;
  product_name: string;
  product_url: string;
  image_url?: string | null;
  price_cents?: number | null;
  currency?: string;
  show_from_seconds?: number;
  show_to_seconds?: number | null;
  description?: string | null;
}

export function createShoppable(input: CreateShoppableInput, createdBy: string): ShoppableProduct {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO shoppable_products
    (id, video_id, channel_id, product_name, product_url, image_url, price_cents, currency,
     show_from_seconds, show_to_seconds, description, active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(
    id, input.video_id, input.channel_id,
    input.product_name.slice(0, 200), input.product_url.slice(0, 1000),
    input.image_url ?? null, input.price_cents ?? null,
    (input.currency ?? 'USD').slice(0, 6),
    input.show_from_seconds ?? 0, input.show_to_seconds ?? null,
    input.description ?? null, createdBy, now, now,
  );
  return db.prepare('SELECT * FROM shoppable_products WHERE id = ?').get(id) as ShoppableProduct;
}

export function listShoppable(videoId: string, activeOnly = true): ShoppableProduct[] {
  const db = getDb();
  if (activeOnly) {
    return db.prepare('SELECT * FROM shoppable_products WHERE video_id = ? AND active = 1 ORDER BY show_from_seconds ASC').all(videoId) as ShoppableProduct[];
  }
  return db.prepare('SELECT * FROM shoppable_products WHERE video_id = ? ORDER BY show_from_seconds ASC').all(videoId) as ShoppableProduct[];
}

export function deleteShoppable(id: string, channelId: string): boolean {
  const db = getDb();
  const existing = db.prepare('SELECT channel_id FROM shoppable_products WHERE id = ?').get(id) as { channel_id: string } | undefined;
  if (!existing || existing.channel_id !== channelId) return false;
  return db.prepare('DELETE FROM shoppable_products WHERE id = ?').run(id).changes > 0;
}

// ---------- Public playback payload ----------

export interface InteractiveAtTime {
  hotspots: Hotspot[];
  cards: VideoCard[];
  shoppable: ShoppableProduct[];
}

export function getInteractivityAt(videoId: string, atSeconds: number): InteractiveAtTime {
  const db = getDb();
  const hotspots = db.prepare(
    "SELECT * FROM video_hotspots WHERE video_id = ? AND active = 1 AND start_seconds <= ? AND end_seconds >= ? ORDER BY start_seconds ASC"
  ).all(videoId, atSeconds, atSeconds) as Hotspot[];
  const cards = db.prepare(
    "SELECT * FROM video_cards WHERE video_id = ? AND active = 1 AND ABS(show_at_seconds - ?) <= 2"
  ).all(videoId, atSeconds) as VideoCard[];
  const shoppable = db.prepare(
    "SELECT * FROM shoppable_products WHERE video_id = ? AND active = 1 AND show_from_seconds <= ? AND (show_to_seconds IS NULL OR show_to_seconds >= ?)"
  ).all(videoId, atSeconds, atSeconds) as ShoppableProduct[];
  return { hotspots, cards, shoppable };
}

export interface VideoInteractivityBundle {
  video_id: string;
  hotspots: Hotspot[];
  cards: VideoCard[];
  branches: VideoBranch[];
  shoppable: ShoppableProduct[];
  counts: { hotspots: number; cards: number; branches: number; shoppable: number };
}

export function getInteractivityBundle(videoId: string): VideoInteractivityBundle {
  const hotspots = listHotspots(videoId);
  const cards = listCards(videoId);
  const branches = listBranches(videoId);
  const shoppable = listShoppable(videoId);
  return {
    video_id: videoId,
    hotspots, cards, branches, shoppable,
    counts: {
      hotspots: hotspots.length,
      cards: cards.length,
      branches: branches.length,
      shoppable: shoppable.length,
    },
  };
}

export interface InteractivityStats {
  total_videos_with_interactivity: number;
  total_hotspots: number;
  total_cards: number;
  total_branches: number;
  total_shoppable: number;
  by_action_type: Record<string, number>;
}

export function getInteractivityStats(channelId: string): InteractivityStats {
  const db = getDb();
  const videos = (db.prepare(`
    SELECT COUNT(DISTINCT video_id) AS c FROM (
      SELECT video_id FROM video_hotspots WHERE channel_id = ?
      UNION SELECT video_id FROM video_cards WHERE channel_id = ?
      UNION SELECT video_id FROM video_branches WHERE channel_id = ?
      UNION SELECT video_id FROM shoppable_products WHERE channel_id = ?
    )
  `).get(channelId, channelId, channelId, channelId) as { c: number }).c;
  const hs = (db.prepare('SELECT COUNT(*) AS c FROM video_hotspots WHERE channel_id = ?').get(channelId) as { c: number }).c;
  const crd = (db.prepare('SELECT COUNT(*) AS c FROM video_cards WHERE channel_id = ?').get(channelId) as { c: number }).c;
  const br = (db.prepare('SELECT COUNT(*) AS c FROM video_branches WHERE channel_id = ?').get(channelId) as { c: number }).c;
  const sh = (db.prepare('SELECT COUNT(*) AS c FROM shoppable_products WHERE channel_id = ?').get(channelId) as { c: number }).c;
  const rows = db.prepare(
    'SELECT action_type, COUNT(*) AS c FROM video_hotspots WHERE channel_id = ? GROUP BY action_type'
  ).all(channelId) as Array<{ action_type: string; c: number }>;
  const by_action_type: Record<string, number> = {};
  for (const r of rows) by_action_type[r.action_type] = r.c;
  return {
    total_videos_with_interactivity: videos,
    total_hotspots: hs, total_cards: crd,
    total_branches: br, total_shoppable: sh,
    by_action_type,
  };
}
