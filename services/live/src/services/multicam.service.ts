// melodyflix live — Multi-Camera (7.5) + Emergency Backup (7.10)

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export function ensureMulticamSchema(): void {
  const db = getDb();
  db.exec(`
    -- 7.5 Multi-Camera: multiple ingest sources per stream
    CREATE TABLE IF NOT EXISTS stream_cameras (
      id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL,
      label TEXT NOT NULL,
      ingest_key TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'secondary'
        CHECK (role IN ('primary','secondary','backup')),
      is_active INTEGER NOT NULL DEFAULT 1,
      is_muted INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT,
      viewer_active INTEGER NOT NULL DEFAULT 0,
      bitrate_kbps INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cameras_stream
      ON stream_cameras(stream_id, sort_order);

    -- 7.10 Emergency Backup: failover configuration + event log
    CREATE TABLE IF NOT EXISTS stream_backup_config (
      stream_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      health_timeout_seconds INTEGER NOT NULL DEFAULT 30,
      fallback_slate_url TEXT,
      auto_switch_to_backup INTEGER NOT NULL DEFAULT 1,
      switch_back_when_healthy INTEGER NOT NULL DEFAULT 1,
      notify_webhook_url TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stream_backup_events (
      id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL,
      event_type TEXT NOT NULL
        CHECK (event_type IN ('detected_down','switch_to_backup','switch_to_primary','recovered','manual_override')),
      from_camera_id TEXT,
      to_camera_id TEXT,
      reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_backup_events_stream
      ON stream_backup_events(stream_id, created_at DESC);
  `);
}

// ============================================================
// 7.5 Multi-Camera
// ============================================================

export type CameraRole = 'primary' | 'secondary' | 'backup';

export interface StreamCamera {
  id: string;
  stream_id: string;
  label: string;
  ingest_key: string;
  role: CameraRole;
  is_active: number;
  is_muted: number;
  sort_order: number;
  last_seen_at: string | null;
  viewer_active: number;
  bitrate_kbps: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCameraInput {
  streamId: string;
  label: string;
  role?: CameraRole;
  sortOrder?: number;
}

const MAX_CAMERAS_PER_STREAM = 6;

export function createCamera(input: CreateCameraInput): StreamCamera {
  const label = (input.label ?? '').trim();
  if (label.length < 1 || label.length > 60) throw new Error('Label must be 1-60 chars');

  const db = getDb();
  const count = (db.prepare(
    'SELECT COUNT(*) as n FROM stream_cameras WHERE stream_id = ?'
  ).get(input.streamId) as { n: number }).n;
  if (count >= MAX_CAMERAS_PER_STREAM) throw new Error(`Max ${MAX_CAMERAS_PER_STREAM} cameras per stream`);

  // Auto-assign role: first camera becomes primary
  let role: CameraRole = input.role ?? (count === 0 ? 'primary' : 'secondary');

  const id = randomUUID();
  const ingestKey = 'cam_' + randomUUID().replace(/-/g, '');
  const now = new Date().toISOString();
  const sortOrder = input.sortOrder ?? count;

  // If role=primary, demote any existing primary
  db.exec('BEGIN');
  try {
    if (role === 'primary') {
      db.prepare(`UPDATE stream_cameras SET role = 'secondary', updated_at = ? WHERE stream_id = ? AND role = 'primary'`)
        .run(now, input.streamId);
    }

    db.prepare(`
      INSERT INTO stream_cameras
        (id, stream_id, label, ingest_key, role, is_active, is_muted,
         sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?)
    `).run(id, input.streamId, label, ingestKey, role, sortOrder, now, now);

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return getCamera(id)!;
}

export function getCamera(id: string): StreamCamera | null {
  return (getDb().prepare('SELECT * FROM stream_cameras WHERE id = ?').get(id) as StreamCamera | undefined) ?? null;
}

export function getCameraByIngestKey(key: string): StreamCamera | null {
  return (getDb().prepare('SELECT * FROM stream_cameras WHERE ingest_key = ?').get(key) as StreamCamera | undefined) ?? null;
}

export function listCameras(streamId: string): StreamCamera[] {
  return getDb().prepare(
    'SELECT * FROM stream_cameras WHERE stream_id = ? ORDER BY sort_order ASC, created_at ASC'
  ).all(streamId) as StreamCamera[];
}

export function getPrimaryCamera(streamId: string): StreamCamera | null {
  const row = getDb().prepare(
    `SELECT * FROM stream_cameras WHERE stream_id = ? AND role = 'primary' AND is_active = 1 LIMIT 1`
  ).get(streamId) as StreamCamera | undefined;
  return row ?? null;
}

export interface UpdateCameraInput {
  label?: string;
  role?: CameraRole;
  is_active?: boolean;
  is_muted?: boolean;
  sort_order?: number;
  viewer_active?: boolean;
  bitrate_kbps?: number | null;
  touch_last_seen?: boolean;
}

export function updateCamera(streamId: string, cameraId: string, patch: UpdateCameraInput): StreamCamera | null {
  const cam = getCamera(cameraId);
  if (!cam) return null;
  if (cam.stream_id !== streamId) throw new Error('Camera not in this stream');

  const db = getDb();
  const now = new Date().toISOString();

  db.exec('BEGIN');
  try {
    // Role change to primary: demote existing
    if (patch.role === 'primary' && cam.role !== 'primary') {
      db.prepare(`UPDATE stream_cameras SET role = 'secondary', updated_at = ? WHERE stream_id = ? AND role = 'primary'`)
        .run(now, streamId);
    }

    const fields: string[] = [];
    const values: any[] = [];
    const map: Record<string, any> = {
      label: patch.label,
      role: patch.role,
      is_active: patch.is_active === undefined ? undefined : (patch.is_active ? 1 : 0),
      is_muted: patch.is_muted === undefined ? undefined : (patch.is_muted ? 1 : 0),
      sort_order: patch.sort_order,
      viewer_active: patch.viewer_active === undefined ? undefined : (patch.viewer_active ? 1 : 0),
      bitrate_kbps: patch.bitrate_kbps,
      last_seen_at: patch.touch_last_seen ? now : undefined,
    };
    for (const [k, v] of Object.entries(map)) {
      if (v === undefined) continue;
      fields.push(`${k} = ?`);
      values.push(v);
    }
    if (fields.length === 0) {
      db.exec('COMMIT');
      return cam;
    }
    fields.push('updated_at = ?');
    values.push(now);
    values.push(cameraId);
    db.prepare(`UPDATE stream_cameras SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return getCamera(cameraId);
}

export function deleteCamera(streamId: string, cameraId: string): boolean {
  const cam = getCamera(cameraId);
  if (!cam) return false;
  if (cam.stream_id !== streamId) throw new Error('Camera not in this stream');
  if (cam.role === 'primary') throw new Error('Cannot delete primary — promote another camera first');
  return getDb().prepare('DELETE FROM stream_cameras WHERE id = ?').run(cameraId).changes > 0;
}

export function reorderCameras(streamId: string, orderedIds: string[]): StreamCamera[] {
  const db = getDb();
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    const upd = db.prepare(
      'UPDATE stream_cameras SET sort_order = ?, updated_at = ? WHERE id = ? AND stream_id = ?'
    );
    orderedIds.forEach((cid, idx) => upd.run(idx, now, cid, streamId));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return listCameras(streamId);
}

// Switch camera: promote target to primary
export function switchToCamera(streamId: string, targetCameraId: string, reason = 'manual'): StreamCamera | null {
  const cam = getCamera(targetCameraId);
  if (!cam || cam.stream_id !== streamId) return null;
  const db = getDb();
  const now = new Date().toISOString();

  const prevPrimary = getPrimaryCamera(streamId);

  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE stream_cameras SET role = 'secondary', updated_at = ? WHERE stream_id = ? AND role = 'primary'`)
      .run(now, streamId);
    db.prepare(`UPDATE stream_cameras SET role = 'primary', updated_at = ? WHERE id = ?`)
      .run(now, targetCameraId);

    // Log switch as backup event for observability
    db.prepare(`
      INSERT INTO stream_backup_events (id, stream_id, event_type, from_camera_id, to_camera_id, reason, created_at)
      VALUES (?, ?, 'manual_override', ?, ?, ?, ?)
    `).run(randomUUID(), streamId, prevPrimary?.id ?? null, targetCameraId, reason, now);

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return getCamera(targetCameraId);
}

// ============================================================
// 7.10 Emergency Backup
// ============================================================

export interface BackupConfig {
  stream_id: string;
  enabled: number;
  health_timeout_seconds: number;
  fallback_slate_url: string | null;
  auto_switch_to_backup: number;
  switch_back_when_healthy: number;
  notify_webhook_url: string | null;
  updated_at: string;
}

export function getBackupConfig(streamId: string): BackupConfig {
  const row = getDb().prepare(
    'SELECT * FROM stream_backup_config WHERE stream_id = ?'
  ).get(streamId) as BackupConfig | undefined;
  if (row) return row;
  return {
    stream_id: streamId,
    enabled: 0,
    health_timeout_seconds: 30,
    fallback_slate_url: null,
    auto_switch_to_backup: 1,
    switch_back_when_healthy: 1,
    notify_webhook_url: null,
    updated_at: new Date(0).toISOString(),
  };
}

export interface SetBackupConfigInput {
  enabled?: boolean;
  health_timeout_seconds?: number;
  fallback_slate_url?: string | null;
  auto_switch_to_backup?: boolean;
  switch_back_when_healthy?: boolean;
  notify_webhook_url?: string | null;
}

export function setBackupConfig(streamId: string, input: SetBackupConfigInput): BackupConfig {
  const db = getDb();
  const cur = getBackupConfig(streamId);
  const now = new Date().toISOString();
  const timeout = input.health_timeout_seconds === undefined
    ? cur.health_timeout_seconds
    : Math.max(5, Math.min(input.health_timeout_seconds, 300));

  db.prepare(`
    INSERT INTO stream_backup_config
      (stream_id, enabled, health_timeout_seconds, fallback_slate_url,
       auto_switch_to_backup, switch_back_when_healthy, notify_webhook_url, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(stream_id) DO UPDATE SET
      enabled = excluded.enabled,
      health_timeout_seconds = excluded.health_timeout_seconds,
      fallback_slate_url = excluded.fallback_slate_url,
      auto_switch_to_backup = excluded.auto_switch_to_backup,
      switch_back_when_healthy = excluded.switch_back_when_healthy,
      notify_webhook_url = excluded.notify_webhook_url,
      updated_at = excluded.updated_at
  `).run(
    streamId,
    input.enabled === undefined ? cur.enabled : (input.enabled ? 1 : 0),
    timeout,
    input.fallback_slate_url === undefined ? cur.fallback_slate_url : input.fallback_slate_url,
    input.auto_switch_to_backup === undefined ? cur.auto_switch_to_backup : (input.auto_switch_to_backup ? 1 : 0),
    input.switch_back_when_healthy === undefined ? cur.switch_back_when_healthy : (input.switch_back_when_healthy ? 1 : 0),
    input.notify_webhook_url === undefined ? cur.notify_webhook_url : input.notify_webhook_url,
    now
  );
  return getBackupConfig(streamId);
}

export type BackupEventType =
  | 'detected_down' | 'switch_to_backup' | 'switch_to_primary'
  | 'recovered' | 'manual_override';

export interface BackupEvent {
  id: string;
  stream_id: string;
  event_type: BackupEventType;
  from_camera_id: string | null;
  to_camera_id: string | null;
  reason: string | null;
  created_at: string;
}

export function recordBackupEvent(input: {
  streamId: string;
  eventType: BackupEventType;
  fromCameraId?: string | null;
  toCameraId?: string | null;
  reason?: string | null;
}): BackupEvent {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO stream_backup_events
      (id, stream_id, event_type, from_camera_id, to_camera_id, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.streamId, input.eventType,
    input.fromCameraId ?? null, input.toCameraId ?? null,
    input.reason ?? null, now
  );
  return db.prepare('SELECT * FROM stream_backup_events WHERE id = ?').get(id) as BackupEvent;
}

export function listBackupEvents(streamId: string, limit = 50): BackupEvent[] {
  const n = Math.min(Math.max(limit, 1), 200);
  return getDb().prepare(
    'SELECT * FROM stream_backup_events WHERE stream_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(streamId, n) as BackupEvent[];
}

// Mark a camera as seen (heartbeat from ingest)
export function cameraHeartbeat(streamId: string, cameraId: string, bitrateKbps?: number): StreamCamera | null {
  return updateCamera(streamId, cameraId, {
    touch_last_seen: true,
    bitrate_kbps: bitrateKbps,
    viewer_active: true,
  });
}

// Health check — which cameras are stale beyond the config timeout?
export interface CameraHealth {
  camera: StreamCamera;
  healthy: boolean;
  last_seen_age_seconds: number | null;
}

export function listCameraHealth(streamId: string): CameraHealth[] {
  const cfg = getBackupConfig(streamId);
  const now = Date.now();
  return listCameras(streamId).map((cam) => {
    if (!cam.last_seen_at) {
      return { camera: cam, healthy: false, last_seen_age_seconds: null };
    }
    const age = (now - new Date(cam.last_seen_at).getTime()) / 1000;
    return {
      camera: cam,
      healthy: age <= cfg.health_timeout_seconds,
      last_seen_age_seconds: age,
    };
  });
}

// Auto-failover: switch to first healthy backup camera if primary stale
export interface FailoverResult {
  switched: boolean;
  from_camera_id: string | null;
  to_camera_id: string | null;
  reason: string | null;
}

export function performAutoFailover(streamId: string): FailoverResult {
  const cfg = getBackupConfig(streamId);
  if (!cfg.enabled || !cfg.auto_switch_to_backup) {
    return { switched: false, from_camera_id: null, to_camera_id: null, reason: 'disabled' };
  }

  const primary = getPrimaryCamera(streamId);
  if (!primary) {
    return { switched: false, from_camera_id: null, to_camera_id: null, reason: 'no primary' };
  }

  const now = Date.now();
  const primaryAge = primary.last_seen_at
    ? (now - new Date(primary.last_seen_at).getTime()) / 1000
    : Infinity;
  if (primaryAge <= cfg.health_timeout_seconds) {
    return { switched: false, from_camera_id: primary.id, to_camera_id: null, reason: 'primary healthy' };
  }

  // Primary is down — find a healthy backup/secondary
  const health = listCameraHealth(streamId);
  const candidate = health.find(
    (h) => h.camera.id !== primary.id && h.camera.is_active === 1 && h.healthy
  );
  if (!candidate) {
    recordBackupEvent({
      streamId,
      eventType: 'detected_down',
      fromCameraId: primary.id,
      reason: 'primary stale, no healthy backup',
    });
    return { switched: false, from_camera_id: primary.id, to_camera_id: null, reason: 'no healthy backup' };
  }

  // Log + switch
  recordBackupEvent({
    streamId,
    eventType: 'detected_down',
    fromCameraId: primary.id,
    reason: `primary stale ${Math.round(primaryAge)}s`,
  });
  switchToCamera(streamId, candidate.camera.id, 'auto_failover');
  recordBackupEvent({
    streamId,
    eventType: 'switch_to_backup',
    fromCameraId: primary.id,
    toCameraId: candidate.camera.id,
  });

  return { switched: true, from_camera_id: primary.id, to_camera_id: candidate.camera.id, reason: null };
}

// Summary
export interface StreamStreamingSummary {
  stream_id: string;
  camera_count: number;
  primary_camera_id: string | null;
  healthy_cameras: number;
  backup_enabled: boolean;
  recent_backup_events: number;
}

export function getStreamingSummary(streamId: string): StreamStreamingSummary {
  const cams = listCameras(streamId);
  const health = listCameraHealth(streamId);
  const cfg = getBackupConfig(streamId);
  const events = listBackupEvents(streamId, 10);
  return {
    stream_id: streamId,
    camera_count: cams.length,
    primary_camera_id: cams.find((c) => c.role === 'primary')?.id ?? null,
    healthy_cameras: health.filter((h) => h.healthy).length,
    backup_enabled: cfg.enabled === 1,
    recent_backup_events: events.length,
  };
}
