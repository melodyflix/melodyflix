// melodyflix videos - Section 12.5 Smart TV Support
// Device registry, platform-specific layouts, capability negotiation,
// and platform statistics for Smart TV apps.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type TvPlatform = 'tizen' | 'webos' | 'android_tv' | 'roku' | 'firetv' | 'apple_tv';

const PLATFORMS: TvPlatform[] = ['tizen','webos','android_tv','roku','firetv','apple_tv'];

export function ensureSmartTvSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS smart_tv_devices (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      model TEXT,
      os_version TEXT,
      app_version TEXT,
      capabilities TEXT NOT NULL DEFAULT '{}',
      user_id TEXT,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_tv_device ON smart_tv_devices(device_id);
    CREATE INDEX IF NOT EXISTS idx_tv_platform ON smart_tv_devices(platform, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tv_user ON smart_tv_devices(user_id, last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS smart_tv_layouts (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      name TEXT NOT NULL,
      layout TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tv_layout_platform ON smart_tv_layouts(platform, is_default);

    CREATE TABLE IF NOT EXISTS smart_tv_compat (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      min_os_version TEXT NOT NULL,
      min_app_version TEXT NOT NULL,
      required_capabilities TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_tv_compat ON smart_tv_compat(platform, min_os_version);
  `);
}

export interface TvDevice {
  id: string;
  device_id: string;
  platform: TvPlatform;
  model: string | null;
  os_version: string | null;
  app_version: string | null;
  capabilities: string;
  user_id: string | null;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface TvLayout {
  id: string;
  platform: TvPlatform;
  name: string;
  layout: string;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface TvCompat {
  id: string;
  platform: TvPlatform;
  min_os_version: string;
  min_app_version: string;
  required_capabilities: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ---------- Devices ----------
export interface RegisterDeviceInput {
  device_id: string;
  platform: TvPlatform;
  model?: string | null;
  os_version?: string | null;
  app_version?: string | null;
  capabilities?: Record<string, unknown>;
  user_id?: string | null;
}

export function registerDevice(input: RegisterDeviceInput): TvDevice {
  if (!PLATFORMS.includes(input.platform)) throw new Error('invalid_platform');
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM smart_tv_devices WHERE device_id = ?')
    .get(input.device_id) as TvDevice | undefined;
  if (existing) {
    db.prepare(`
      UPDATE smart_tv_devices
      SET platform = ?, model = ?, os_version = ?, app_version = ?, capabilities = ?,
          user_id = COALESCE(?, user_id), last_seen_at = ?, updated_at = ?
      WHERE device_id = ?
    `).run(input.platform, input.model ?? existing.model, input.os_version ?? existing.os_version,
      input.app_version ?? existing.app_version,
      input.capabilities ? JSON.stringify(input.capabilities) : existing.capabilities,
      input.user_id ?? null, now, now, input.device_id);
    return getDevice(input.device_id)!;
  }
  const id = randomUUID();
  db.prepare(`
    INSERT INTO smart_tv_devices
      (id, device_id, platform, model, os_version, app_version, capabilities, user_id,
       last_seen_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.device_id, input.platform, input.model ?? null, input.os_version ?? null,
    input.app_version ?? null, JSON.stringify(input.capabilities ?? {}),
    input.user_id ?? null, now, now, now);
  return getDevice(input.device_id)!;
}

export function getDevice(deviceId: string): TvDevice | null {
  return (getDb().prepare('SELECT * FROM smart_tv_devices WHERE device_id = ?')
    .get(deviceId) as TvDevice | undefined) ?? null;
}

export function heartbeat(deviceId: string, appVersion?: string): TvDevice | null {
  const d = getDevice(deviceId);
  if (!d) return null;
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE smart_tv_devices SET last_seen_at = ?, app_version = COALESCE(?, app_version), updated_at = ?
    WHERE device_id = ?
  `).run(now, appVersion ?? null, now, deviceId);
  return getDevice(deviceId);
}

export function listDevices(filter?: {
  platform?: TvPlatform;
  user_id?: string;
  onlineWithinSeconds?: number;
  limit?: number;
}): TvDevice[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter?.platform) { where.push('platform = ?'); args.push(filter.platform); }
  if (filter?.user_id) { where.push('user_id = ?'); args.push(filter.user_id); }
  if (filter?.onlineWithinSeconds) {
    const cutoff = new Date(Date.now() - filter.onlineWithinSeconds * 1000).toISOString();
    where.push('last_seen_at >= ?'); args.push(cutoff);
  }
  const sql = `SELECT * FROM smart_tv_devices ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY last_seen_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args) as TvDevice[];
}

export function deleteDevice(deviceId: string): boolean {
  return getDb().prepare('DELETE FROM smart_tv_devices WHERE device_id = ?').run(deviceId).changes > 0;
}

// ---------- Layouts ----------
export interface LayoutInput {
  platform: TvPlatform;
  name: string;
  layout: Record<string, unknown>;
  is_default?: boolean;
}

export function upsertLayout(input: LayoutInput): TvLayout {
  if (!PLATFORMS.includes(input.platform)) throw new Error('invalid_platform');
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM smart_tv_layouts WHERE platform = ? AND name = ?')
    .get(input.platform, input.name) as TvLayout | undefined;
  if (existing) {
    db.prepare(`
      UPDATE smart_tv_layouts SET layout = ?, is_default = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(input.layout), input.is_default ? 1 : existing.is_default, now, existing.id);
    if (input.is_default) {
      db.prepare('UPDATE smart_tv_layouts SET is_default = 0 WHERE platform = ? AND id != ?')
        .run(input.platform, existing.id);
    }
    return getLayoutById(existing.id)!;
  }
  const id = randomUUID();
  db.prepare(`
    INSERT INTO smart_tv_layouts (id, platform, name, layout, is_default, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.platform, input.name, JSON.stringify(input.layout),
    input.is_default ? 1 : 0, now, now);
  if (input.is_default) {
    db.prepare('UPDATE smart_tv_layouts SET is_default = 0 WHERE platform = ? AND id != ?')
      .run(input.platform, id);
  }
  return getLayoutById(id)!;
}

export function getLayoutById(id: string): TvLayout | null {
  return (getDb().prepare('SELECT * FROM smart_tv_layouts WHERE id = ?').get(id) as TvLayout | undefined) ?? null;
}

export function getDefaultLayout(platform: TvPlatform): TvLayout | null {
  return (getDb().prepare('SELECT * FROM smart_tv_layouts WHERE platform = ? AND is_default = 1 LIMIT 1')
    .get(platform) as TvLayout | undefined) ?? null;
}

export function listLayouts(platform?: TvPlatform): TvLayout[] {
  const db = getDb();
  if (platform) {
    return db.prepare('SELECT * FROM smart_tv_layouts WHERE platform = ? ORDER BY is_default DESC, name')
      .all(platform) as TvLayout[];
  }
  return db.prepare('SELECT * FROM smart_tv_layouts ORDER BY platform, is_default DESC, name').all() as TvLayout[];
}

export function deleteLayout(id: string): boolean {
  return getDb().prepare('DELETE FROM smart_tv_layouts WHERE id = ?').run(id).changes > 0;
}

// ---------- Compatibility ----------
export interface CompatInput {
  platform: TvPlatform;
  min_os_version: string;
  min_app_version: string;
  required_capabilities?: string[];
  notes?: string | null;
}

export function upsertCompat(input: CompatInput): TvCompat {
  if (!PLATFORMS.includes(input.platform)) throw new Error('invalid_platform');
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM smart_tv_compat WHERE platform = ? AND min_os_version = ?')
    .get(input.platform, input.min_os_version) as TvCompat | undefined;
  if (existing) {
    db.prepare(`
      UPDATE smart_tv_compat SET min_app_version = ?, required_capabilities = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(input.min_app_version, JSON.stringify(input.required_capabilities ?? []),
      input.notes ?? null, now, existing.id);
    return getCompatById(existing.id)!;
  }
  const id = randomUUID();
  db.prepare(`
    INSERT INTO smart_tv_compat
      (id, platform, min_os_version, min_app_version, required_capabilities, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.platform, input.min_os_version, input.min_app_version,
    JSON.stringify(input.required_capabilities ?? []), input.notes ?? null, now, now);
  return getCompatById(id)!;
}

export function getCompatById(id: string): TvCompat | null {
  return (getDb().prepare('SELECT * FROM smart_tv_compat WHERE id = ?').get(id) as TvCompat | undefined) ?? null;
}

export function listCompat(platform?: TvPlatform): TvCompat[] {
  const db = getDb();
  if (platform) {
    return db.prepare('SELECT * FROM smart_tv_compat WHERE platform = ? ORDER BY min_os_version')
      .all(platform) as TvCompat[];
  }
  return db.prepare('SELECT * FROM smart_tv_compat ORDER BY platform, min_os_version').all() as TvCompat[];
}

export function deleteCompat(id: string): boolean {
  return getDb().prepare('DELETE FROM smart_tv_compat WHERE id = ?').run(id).changes > 0;
}

// ---------- Compatibility resolution ----------
function semverGte(a: string, b: string): boolean {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return true;
}

export interface CompatCheckResult {
  supported: boolean;
  reason?: string;
  required: TvCompat | null;
  missing_capabilities: string[];
}

export function checkCompatibility(
  platform: TvPlatform,
  osVersion: string,
  appVersion: string,
  capabilities: Record<string, unknown> = {},
): CompatCheckResult {
  const rows = listCompat(platform);
  if (!rows.length) return { supported: true, required: null, missing_capabilities: [] };
  // pick strictest requirement whose min_os_version <= osVersion
  const applicable = rows.filter(r => semverGte(osVersion, r.min_os_version));
  if (!applicable.length) {
    return { supported: false, reason: 'os_version_too_low', required: rows[0], missing_capabilities: [] };
  }
  const required = applicable.reduce((acc, r) =>
    semverGte(r.min_app_version, acc.min_app_version) ? r : acc, applicable[0]);
  if (!semverGte(appVersion, required.min_app_version)) {
    return { supported: false, reason: 'app_version_too_low', required, missing_capabilities: [] };
  }
  const needed = JSON.parse(required.required_capabilities) as string[];
  const missing = needed.filter(c => !(c in capabilities));
  if (missing.length) {
    return { supported: false, reason: 'missing_capabilities', required, missing_capabilities: missing };
  }
  return { supported: true, required, missing_capabilities: [] };
}

// ---------- Stats ----------
export interface SmartTvStats {
  total_devices: number;
  online_now: number;
  by_platform: Record<string, number>;
  by_app_version: Record<string, number>;
  total_layouts: number;
  total_compat_rules: number;
}

export function getSmartTvStats(onlineWindowSeconds = 300): SmartTvStats {
  const db = getDb();
  const devices = db.prepare('SELECT platform, app_version, last_seen_at FROM smart_tv_devices').all() as
    { platform: string; app_version: string | null; last_seen_at: string }[];
  const byPlatform: Record<string, number> = {};
  const byAppVersion: Record<string, number> = {};
  const cutoff = new Date(Date.now() - onlineWindowSeconds * 1000).toISOString();
  let online = 0;
  for (const d of devices) {
    byPlatform[d.platform] = (byPlatform[d.platform] ?? 0) + 1;
    if (d.app_version) byAppVersion[d.app_version] = (byAppVersion[d.app_version] ?? 0) + 1;
    if (d.last_seen_at >= cutoff) online++;
  }
  const layouts = db.prepare('SELECT COUNT(*) AS c FROM smart_tv_layouts').get() as { c: number };
  const compats = db.prepare('SELECT COUNT(*) AS c FROM smart_tv_compat').get() as { c: number };
  return {
    total_devices: devices.length,
    online_now: online,
    by_platform: byPlatform,
    by_app_version: byAppVersion,
    total_layouts: layouts.c,
    total_compat_rules: compats.c,
  };
}
