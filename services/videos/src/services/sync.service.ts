// melodyflix videos — Cross-Platform Sync (34.1 Multi-Device, 34.2 Cloud Playlist, 34.4 Settings)
// Lightweight sync primitives. The actual "last write wins" merge happens
// on the client; the server stores per-user, per-device sync records and
// returns changes since a given cursor.

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type SyncScope = 'watch_progress' | 'playlist' | 'settings' | 'favorites' | 'history';

export function ensureSyncSchema(): void {
  const db = getDb();
  db.exec(`
    -- Registered devices per user
    CREATE TABLE IF NOT EXISTS sync_devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_label TEXT NOT NULL,
      device_type TEXT,
      platform TEXT,
      app_version TEXT,
      last_seen_at TEXT NOT NULL,
      last_sync_cursor INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sync_devices_user
      ON sync_devices(user_id, last_seen_at DESC);

    -- Monotonic change log — every mutation appends a row with a global
    -- increasing cursor (cursor INTEGER AUTOINCREMENT via trigger-free
    -- approach: we keep a per-user sequence to avoid colliding across users)
    CREATE TABLE IF NOT EXISTS sync_changes (
      cursor INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('watch_progress','playlist','settings','favorites','history')),
      key TEXT NOT NULL,
      value_json TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      device_id TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sync_changes_user_cursor
      ON sync_changes(user_id, cursor ASC);
    CREATE INDEX IF NOT EXISTS idx_sync_changes_scope
      ON sync_changes(user_id, scope, cursor DESC);
  `);
}

// ============================================================
// Devices
// ============================================================

export interface SyncDevice {
  id: string;
  user_id: string;
  device_label: string;
  device_type: string | null;
  platform: string | null;
  app_version: string | null;
  last_seen_at: string;
  last_sync_cursor: number;
  is_active: number;
  created_at: string;
}

export interface RegisterDeviceInput {
  user_id: string;
  device_label: string;
  device_type?: string | null;
  platform?: string | null;
  app_version?: string | null;
  device_id?: string;   // pass to re-register an existing device
}

export function registerDevice(input: RegisterDeviceInput): SyncDevice {
  const label = (input.device_label ?? '').trim();
  if (label.length < 1 || label.length > 80) throw new Error('device_label must be 1-80 chars');

  const db = getDb();
  const now = new Date().toISOString();
  if (input.device_id) {
    const cur = db.prepare('SELECT * FROM sync_devices WHERE id = ? AND user_id = ?')
      .get(input.device_id, input.user_id) as SyncDevice | undefined;
    if (!cur) throw new Error('Device not found');
    db.prepare(`
      UPDATE sync_devices
      SET device_label = ?, device_type = ?, platform = ?, app_version = ?,
          last_seen_at = ?, is_active = 1
      WHERE id = ?
    `).run(
      label,
      input.device_type ?? cur.device_type,
      input.platform ?? cur.platform,
      input.app_version ?? cur.app_version,
      now, cur.id,
    );
    return getDevice(cur.id)!;
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO sync_devices
      (id, user_id, device_label, device_type, platform, app_version,
       last_seen_at, last_sync_cursor, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?)
  `).run(
    id, input.user_id, label,
    input.device_type ?? null, input.platform ?? null, input.app_version ?? null,
    now, now,
  );
  return getDevice(id)!;
}

export function getDevice(id: string): SyncDevice | null {
  return (getDb().prepare('SELECT * FROM sync_devices WHERE id = ?').get(id) as SyncDevice | undefined) ?? null;
}

export function listDevices(userId: string): SyncDevice[] {
  return getDb().prepare(
    'SELECT * FROM sync_devices WHERE user_id = ? ORDER BY last_seen_at DESC LIMIT 50'
  ).all(userId) as SyncDevice[];
}

export function touchDevice(id: string, cursor?: number): void {
  const db = getDb();
  const now = new Date().toISOString();
  if (cursor !== undefined) {
    db.prepare('UPDATE sync_devices SET last_seen_at = ?, last_sync_cursor = MAX(last_sync_cursor, ?) WHERE id = ?')
      .run(now, cursor, id);
  } else {
    db.prepare('UPDATE sync_devices SET last_seen_at = ? WHERE id = ?').run(now, id);
  }
}

export function deactivateDevice(id: string, userId: string): boolean {
  const db = getDb();
  const r = db.prepare('UPDATE sync_devices SET is_active = 0 WHERE id = ? AND user_id = ?').run(id, userId);
  return r.changes > 0;
}

// ============================================================
// Change log
// ============================================================

export interface SyncChange {
  cursor: number;
  user_id: string;
  scope: SyncScope;
  key: string;
  value_json: string | null;
  deleted: number;
  device_id: string | null;
  updated_at: string;
}

export interface PushChangeInput {
  user_id: string;
  scope: SyncScope;
  key: string;
  value: any;
  device_id?: string | null;
}

export function pushChange(input: PushChangeInput): SyncChange {
  const key = (input.key ?? '').trim();
  if (!key || key.length > 200) throw new Error('key must be 1-200 chars');
  const db = getDb();
  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO sync_changes
      (user_id, scope, key, value_json, deleted, device_id, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `).run(
    input.user_id, input.scope, key,
    input.value === undefined ? null : JSON.stringify(input.value),
    input.device_id ?? null, now,
  );
  return db.prepare('SELECT * FROM sync_changes WHERE cursor = ?')
    .get(info.lastInsertRowid) as SyncChange;
}

export interface PushBatchInput {
  user_id: string;
  device_id?: string | null;
  changes: Array<{ scope: SyncScope; key: string; value: any; deleted?: boolean }>;
}

export interface PushBatchResult {
  pushed: number;
  max_cursor: number;
  errors: Array<{ key: string; error: string }>;
}

export function pushBatch(input: PushBatchInput): PushBatchResult {
  const db = getDb();
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO sync_changes
      (user_id, scope, key, value_json, deleted, device_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const result: PushBatchResult = { pushed: 0, max_cursor: 0, errors: [] };
  db.exec('BEGIN');
  try {
    for (const c of input.changes.slice(0, 500)) {
      try {
        const key = (c.key ?? '').trim();
        if (!key) throw new Error('empty key');
        const info = insert.run(
          input.user_id, c.scope, key,
          c.value === undefined ? null : JSON.stringify(c.value),
          c.deleted ? 1 : 0,
          input.device_id ?? null, now,
        );
        result.pushed++;
        const cur = Number(info.lastInsertRowid);
        if (cur > result.max_cursor) result.max_cursor = cur;
      } catch (e: any) {
        result.errors.push({ key: c.key, error: e?.message ?? 'insert failed' });
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  if (input.device_id && result.max_cursor > 0) touchDevice(input.device_id, result.max_cursor);
  return result;
}

export interface PullChangesInput {
  user_id: string;
  since_cursor?: number;      // exclusive; returns rows with cursor > since_cursor
  scopes?: SyncScope[];
  limit?: number;
  device_id?: string | null;  // if set, cursor is updated
}

export interface PullChangesResult {
  changes: SyncChange[];
  next_cursor: number;
  has_more: boolean;
}

export function pullChanges(input: PullChangesInput): PullChangesResult {
  const db = getDb();
  const since = Math.max(0, input.since_cursor ?? 0);
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);

  const where: string[] = ['user_id = ?', 'cursor > ?'];
  const params: any[] = [input.user_id, since];
  if (input.scopes && input.scopes.length > 0) {
    where.push(`scope IN (${input.scopes.map(() => '?').join(',')})`);
    params.push(...input.scopes);
  }
  params.push(limit + 1);

  const rows = db.prepare(`
    SELECT * FROM sync_changes
    WHERE ${where.join(' AND ')}
    ORDER BY cursor ASC
    LIMIT ?
  `).all(...params) as SyncChange[];

  const hasMore = rows.length > limit;
  const changes = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = changes.length > 0 ? changes[changes.length - 1].cursor : since;

  if (input.device_id && changes.length > 0) touchDevice(input.device_id, nextCursor);

  return { changes, next_cursor: nextCursor, has_more: hasMore };
}

// ============================================================
// Scope-specific shortcuts
// ============================================================

// 34.1 Multi-device watch progress
export function pushWatchProgress(input: {
  user_id: string;
  video_id: string;
  position_seconds: number;
  duration_seconds?: number;
  device_id?: string | null;
}): SyncChange {
  return pushChange({
    user_id: input.user_id,
    scope: 'watch_progress',
    key: input.video_id,
    value: {
      position_seconds: input.position_seconds,
      duration_seconds: input.duration_seconds ?? null,
    },
    device_id: input.device_id ?? null,
  });
}

export function getLatestWatchProgress(userId: string, videoId: string): any {
  const row = getDb().prepare(`
    SELECT value_json FROM sync_changes
    WHERE user_id = ? AND scope = 'watch_progress' AND key = ? AND deleted = 0
    ORDER BY cursor DESC LIMIT 1
  `).get(userId, videoId) as { value_json: string | null } | undefined;
  if (!row?.value_json) return null;
  try { return JSON.parse(row.value_json); } catch { return null; }
}

// 34.2 Cloud playlist sync — accepts any playlist shape via generic value
export function pushPlaylistSnapshot(input: {
  user_id: string;
  playlist_id: string;
  value: any;
  device_id?: string | null;
}): SyncChange {
  return pushChange({
    user_id: input.user_id,
    scope: 'playlist',
    key: input.playlist_id,
    value: input.value,
    device_id: input.device_id ?? null,
  });
}

// 34.4 Settings sync
export function pushSettings(input: {
  user_id: string;
  settings: any;
  device_id?: string | null;
}): SyncChange {
  return pushChange({
    user_id: input.user_id,
    scope: 'settings',
    key: 'preferences',
    value: input.settings,
    device_id: input.device_id ?? null,
  });
}

export function getLatestSettings(userId: string): any {
  const row = getDb().prepare(`
    SELECT value_json FROM sync_changes
    WHERE user_id = ? AND scope = 'settings' AND key = 'preferences' AND deleted = 0
    ORDER BY cursor DESC LIMIT 1
  `).get(userId) as { value_json: string | null } | undefined;
  if (!row?.value_json) return null;
  try { return JSON.parse(row.value_json); } catch { return null; }
}

// ============================================================
// Summary
// ============================================================

export interface SyncSummary {
  user_id: string;
  active_devices: number;
  last_device: { id: string; label: string; last_seen_at: string } | null;
  latest_cursor: number;
  changes_last_7d: number;
  by_scope: { scope: string; count: number }[];
}

export function getSyncSummary(userId: string): SyncSummary {
  const db = getDb();
  const activeDevices = (db.prepare(
    'SELECT COUNT(*) as n FROM sync_devices WHERE user_id = ? AND is_active = 1'
  ).get(userId) as { n: number }).n;
  const lastDev = db.prepare(
    'SELECT id, device_label, last_seen_at FROM sync_devices WHERE user_id = ? AND is_active = 1 ORDER BY last_seen_at DESC LIMIT 1'
  ).get(userId) as { id: string; device_label: string; last_seen_at: string } | undefined;
  const latestCursor = (db.prepare(
    'SELECT COALESCE(MAX(cursor), 0) as c FROM sync_changes WHERE user_id = ?'
  ).get(userId) as { c: number }).c;
  const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
  const last7d = (db.prepare(
    'SELECT COUNT(*) as n FROM sync_changes WHERE user_id = ? AND updated_at >= ?'
  ).get(userId, cutoff) as { n: number }).n;
  const byScope = db.prepare(`
    SELECT scope, COUNT(*) as count FROM sync_changes WHERE user_id = ?
    GROUP BY scope ORDER BY count DESC
  `).all(userId) as { scope: string; count: number }[];
  return {
    user_id: userId,
    active_devices: activeDevices,
    last_device: lastDev ? { id: lastDev.id, label: lastDev.device_label, last_seen_at: lastDev.last_seen_at } : null,
    latest_cursor: latestCursor,
    changes_last_7d: last7d,
    by_scope: byScope,
  };
}
