// melodyflix videos - promotional banners (27.4)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export interface Banner {
  id: string;
  title: string;
  message: string | null;
  cta_label: string | null;
  cta_url: string | null;
  bg_color: string;
  text_color: string;
  placement: 'top' | 'bottom' | 'home' | 'watch';
  is_active: number;
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  dismissible: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export function ensureBannerSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS promo_banners (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT,
      cta_label TEXT,
      cta_url TEXT,
      bg_color TEXT NOT NULL DEFAULT '#065fd4',
      text_color TEXT NOT NULL DEFAULT '#ffffff',
      placement TEXT NOT NULL DEFAULT 'top',
      is_active INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 0,
      starts_at TEXT,
      ends_at TEXT,
      dismissible INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_banners_active ON promo_banners(is_active, priority DESC);

    CREATE TABLE IF NOT EXISTS banner_dismissals (
      user_id TEXT NOT NULL,
      banner_id TEXT NOT NULL,
      dismissed_at TEXT NOT NULL,
      PRIMARY KEY (user_id, banner_id)
    );
  `);
}

export interface BannerInput {
  title: string;
  message?: string | null;
  cta_label?: string | null;
  cta_url?: string | null;
  bg_color?: string;
  text_color?: string;
  placement?: 'top' | 'bottom' | 'home' | 'watch';
  is_active?: boolean;
  priority?: number;
  starts_at?: string | null;
  ends_at?: string | null;
  dismissible?: boolean;
}

export function createBanner(input: BannerInput, createdBy: string): Banner {
  if (!input.title?.trim()) throw new Error('Title is required');
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO promo_banners (id, title, message, cta_label, cta_url, bg_color, text_color, placement, is_active, priority, starts_at, ends_at, dismissible, created_by, created_at, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    input.title.trim().slice(0, 200),
    input.message?.trim().slice(0, 500) ?? null,
    input.cta_label?.trim().slice(0, 50) ?? null,
    input.cta_url?.trim().slice(0, 500) ?? null,
    input.bg_color || '#065fd4',
    input.text_color || '#ffffff',
    input.placement || 'top',
    input.is_active === false ? 0 : 1,
    input.priority ?? 0,
    input.starts_at ?? null,
    input.ends_at ?? null,
    input.dismissible === false ? 0 : 1,
    createdBy,
    now,
    now,
  );
  return getBanner(id)!;
}

export function getBanner(id: string): Banner | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM promo_banners WHERE id = ?').get(id) as Banner) ?? null;
}

export function listAllBanners(limit = 100): Banner[] {
  const db = getDb();
  return db.prepare('SELECT * FROM promo_banners ORDER BY priority DESC, created_at DESC LIMIT ?')
    .all(Math.max(1, Math.min(200, limit))) as Banner[];
}

export interface ActiveBannerQuery {
  placement?: string;
  userId?: string | null;
}

export function listActiveBanners(q: ActiveBannerQuery = {}): Banner[] {
  const db = getDb();
  const now = new Date().toISOString();
  let sql = "SELECT * FROM promo_banners WHERE is_active = 1 " +
    "AND (starts_at IS NULL OR starts_at <= ?) " +
    "AND (ends_at IS NULL OR ends_at >= ?) ";
  const params: any[] = [now, now];
  if (q.placement) {
    sql += "AND (placement = ? OR placement = 'top') ";
    params.push(q.placement);
  }
  sql += "ORDER BY priority DESC, created_at DESC LIMIT 10";
  let rows = db.prepare(sql).all(...params) as Banner[];

  if (q.userId) {
    const dismissed = new Set(
      (db.prepare('SELECT banner_id FROM banner_dismissals WHERE user_id = ?').all(q.userId) as { banner_id: string }[])
        .map((r) => r.banner_id)
    );
    rows = rows.filter((b) => !(b.dismissible === 1 && dismissed.has(b.id)));
  }

  return rows;
}

export function updateBanner(id: string, patch: Partial<BannerInput>): Banner {
  const existing = getBanner(id);
  if (!existing) throw new Error('Banner not found');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE promo_banners SET title = ?, message = ?, cta_label = ?, cta_url = ?, bg_color = ?, text_color = ?, placement = ?, is_active = ?, priority = ?, starts_at = ?, ends_at = ?, dismissible = ?, updated_at = ? WHERE id = ?'
  ).run(
    patch.title?.trim().slice(0, 200) ?? existing.title,
    patch.message !== undefined ? (patch.message?.trim().slice(0, 500) ?? null) : existing.message,
    patch.cta_label !== undefined ? (patch.cta_label?.trim().slice(0, 50) ?? null) : existing.cta_label,
    patch.cta_url !== undefined ? (patch.cta_url?.trim().slice(0, 500) ?? null) : existing.cta_url,
    patch.bg_color ?? existing.bg_color,
    patch.text_color ?? existing.text_color,
    patch.placement ?? existing.placement,
    patch.is_active === undefined ? existing.is_active : (patch.is_active ? 1 : 0),
    patch.priority ?? existing.priority,
    patch.starts_at !== undefined ? patch.starts_at : existing.starts_at,
    patch.ends_at !== undefined ? patch.ends_at : existing.ends_at,
    patch.dismissible === undefined ? existing.dismissible : (patch.dismissible ? 1 : 0),
    now,
    id,
  );
  return getBanner(id)!;
}

export function deleteBanner(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM banner_dismissals WHERE banner_id = ?').run(id);
  db.prepare('DELETE FROM promo_banners WHERE id = ?').run(id);
}

export function dismissBanner(userId: string, bannerId: string): void {
  const db = getDb();
  db.prepare(
    'INSERT OR REPLACE INTO banner_dismissals (user_id, banner_id, dismissed_at) VALUES (?, ?, ?)'
  ).run(userId, bannerId, new Date().toISOString());
}

export function clearDismissals(bannerId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM banner_dismissals WHERE banner_id = ?').run(bannerId);
}
