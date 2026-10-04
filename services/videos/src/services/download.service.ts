// melodyflix videos — Download & Offline (Section 21)
// 21.1 Offline Download  21.2 Download Quality  21.3 Auto-Delete
// 21.4 Data Saver Mode   21.5 Offline Sync
import { randomUUID, createHash } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type DownloadQuality = '144' | '240' | '360' | '480' | '720' | '1080' | '1440' | '2160';
export type DownloadStatus = 'pending' | 'ready' | 'expired' | 'revoked';

export interface VideoDownload {
  id: string;
  user_id: string;
  video_id: string;
  device_id: string | null;
  quality: string;
  status: DownloadStatus;
  file_size_bytes: number;
  token: string;
  expires_at: string;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

const QUALITY_SIZES: Record<string, number> = {
  '144': 20_000_000, '240': 40_000_000, '360': 70_000_000,
  '480': 120_000_000, '720': 250_000_000, '1080': 500_000_000,
  '1440': 1_200_000_000, '2160': 2_500_000_000,
};
const DEFAULT_TTL_DAYS = 30;
const MAX_DOWNLOADS_PER_USER = 100;

export function ensureDownloadSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_downloads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      device_id TEXT,
      quality TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      file_size_bytes INTEGER NOT NULL DEFAULT 0,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      last_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dl_user ON video_downloads(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_dl_video ON video_downloads(video_id);
    CREATE INDEX IF NOT EXISTS idx_dl_expires ON video_downloads(expires_at);
    CREATE INDEX IF NOT EXISTS idx_dl_device ON video_downloads(user_id, device_id);
  `);
  // 21.4 Data Saver Mode column on user_preferences
  try { db.exec('ALTER TABLE user_preferences ADD COLUMN data_saver_mode INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE user_preferences ADD COLUMN download_quality TEXT NOT NULL DEFAULT "720"'); } catch {}
}

function estimateSize(videoId: string, quality: string): number {
  const db = getDb();
  const row = db.prepare('SELECT duration_seconds FROM videos WHERE id = ?').get(videoId) as { duration_seconds: number } | undefined;
  const dur = row?.duration_seconds ?? 0;
  const baseSize = QUALITY_SIZES[quality] ?? QUALITY_SIZES['720'];
  // base is per ~2min (120s); scale by actual duration
  return Math.round((baseSize / 120) * Math.max(dur, 30));
}

/**
 * 21.1 + 21.2 — Create a download entry with quality selection.
 */
export function createDownload(input: {
  user_id: string;
  video_id: string;
  quality?: DownloadQuality;
  device_id?: string | null;
  ttl_days?: number;
}): VideoDownload {
  const db = getDb();

  const video = db.prepare('SELECT id, hls_master_url, status FROM videos WHERE id = ?').get(input.video_id) as
    { id: string; hls_master_url: string | null; status: string } | undefined;
  if (!video) throw new Error('Video not found');
  if (video.status !== 'ready' && video.status !== 'published') throw new Error('Video not ready for download');
  if (!video.hls_master_url) throw new Error('Video has no playable stream');

  const activeCount = (db.prepare(
    "SELECT COUNT(*) AS n FROM video_downloads WHERE user_id = ? AND status != 'expired' AND status != 'revoked'"
  ).get(input.user_id) as { n: number }).n;
  if (activeCount >= MAX_DOWNLOADS_PER_USER) throw new Error(`Download limit reached (${MAX_DOWNLOADS_PER_USER})`);

  // Default quality: user pref, fallback to 720
  let quality = input.quality;
  if (!quality) {
    const pref = db.prepare('SELECT download_quality FROM user_preferences WHERE user_id = ?').get(input.user_id) as
      { download_quality: string } | undefined;
    quality = (pref?.download_quality as DownloadQuality) ?? '720';
  }
  if (!QUALITY_SIZES[quality]) throw new Error('Invalid quality');

  const existing = db.prepare(
    "SELECT * FROM video_downloads WHERE user_id = ? AND video_id = ? AND device_id IS ? AND status IN ('pending','ready') LIMIT 1"
  ).get(input.user_id, input.video_id, input.device_id ?? null) as VideoDownload | undefined;
  if (existing) return existing;

  const id = randomUUID();
  const token = createHash('sha256').update(id + input.user_id + Date.now()).digest('hex');
  const now = new Date();
  const ttlDays = input.ttl_days ?? DEFAULT_TTL_DAYS;
  const expiresAt = new Date(now.getTime() + ttlDays * 86400_000).toISOString();
  const size = estimateSize(input.video_id, quality);

  db.prepare(`
    INSERT INTO video_downloads
      (id, user_id, video_id, device_id, quality, status, file_size_bytes, token, expires_at, last_synced_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'ready', ?, ?, ?, NULL, ?, ?)
  `).run(id, input.user_id, input.video_id, input.device_id ?? null, quality, size, token, expiresAt,
    now.toISOString(), now.toISOString());

  return getDownload(id)!;
}

export function getDownload(id: string): VideoDownload | null {
  return (getDb().prepare('SELECT * FROM video_downloads WHERE id = ?').get(id) as VideoDownload | undefined) ?? null;
}

export function getDownloadByToken(token: string): VideoDownload | null {
  return (getDb().prepare('SELECT * FROM video_downloads WHERE token = ?').get(token) as VideoDownload | undefined) ?? null;
}

export function listUserDownloads(userId: string, opts: { status?: DownloadStatus; device_id?: string; limit?: number } = {}): VideoDownload[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const filters: string[] = ['user_id = ?'];
  const params: any[] = [userId];
  if (opts.status) { filters.push('status = ?'); params.push(opts.status); }
  if (opts.device_id) { filters.push('device_id = ?'); params.push(opts.device_id); }
  params.push(limit);
  return db.prepare(
    `SELECT * FROM video_downloads WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT ?`
  ).all(...params) as VideoDownload[];
}

export function deleteDownload(id: string, userId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT user_id FROM video_downloads WHERE id = ?').get(id) as { user_id: string } | undefined;
  if (!row || row.user_id !== userId) return false;
  db.prepare('DELETE FROM video_downloads WHERE id = ?').run(id);
  return true;
}

export function revokeDownload(id: string, userId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT user_id FROM video_downloads WHERE id = ?').get(id) as { user_id: string } | undefined;
  if (!row || row.user_id !== userId) return false;
  db.prepare("UPDATE video_downloads SET status = 'revoked', updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
  return true;
}

/**
 * 21.3 — Auto-delete: purge downloads whose expires_at has passed.
 * Returns count of purged rows.
 */
export function purgeExpiredDownloads(): number {
  const db = getDb();
  const now = new Date().toISOString();
  const info = db.prepare("DELETE FROM video_downloads WHERE expires_at < ? AND status != 'revoked'").run(now);
  return Number(info.changes ?? 0);
}

/**
 * 21.5 — Offline Sync: client sends device_id + list of download IDs it has.
 * Returns { synced: [...], removed: [...], added: [...] } so client can reconcile.
 */
export function syncDownloads(userId: string, deviceId: string, clientIds: string[]): {
  synced: VideoDownload[];
  removed: string[];
  added: VideoDownload[];
} {
  const db = getDb();
  const all = db.prepare(
    "SELECT * FROM video_downloads WHERE user_id = ? AND device_id = ? AND status = 'ready'"
  ).all(userId, deviceId) as VideoDownload[];

  const serverIds = new Set(all.map((d) => d.id));
  const clientSet = new Set(clientIds);
  const removed = clientIds.filter((id) => !serverIds.has(id));

  const now = new Date().toISOString();
  const stmt = db.prepare('UPDATE video_downloads SET last_synced_at = ?, updated_at = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const d of all) {
      if (clientSet.has(d.id)) stmt.run(now, now, d.id);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  // "added" = those on server but NOT on client (client should download them)
  const added = all.filter((d) => !clientSet.has(d.id));
  const synced = all.filter((d) => clientSet.has(d.id));

  return { synced, removed, added };
}

/**
 * 21.4 — Data Saver: read preference and suggest a lower quality.
 */
export function getDownloadRecommendation(userId: string): {
  data_saver_mode: boolean;
  recommended_quality: DownloadQuality;
  estimated_total_bytes: number;
} {
  const db = getDb();
  const pref = db.prepare(
    'SELECT data_saver_mode, download_quality FROM user_preferences WHERE user_id = ?'
  ).get(userId) as { data_saver_mode: number; download_quality: string } | undefined;

  const dataSaver = pref?.data_saver_mode === 1;
  const baseQuality = (pref?.download_quality as DownloadQuality) ?? '720';
  const recommended = (dataSaver
    ? (['360', '480'].includes(baseQuality) ? baseQuality : '360')
    : baseQuality) as DownloadQuality;

  const totalBytes = (db.prepare(
    "SELECT COALESCE(SUM(file_size_bytes), 0) AS s FROM video_downloads WHERE user_id = ? AND status = 'ready'"
  ).get(userId) as { s: number }).s;

  return { data_saver_mode: dataSaver, recommended_quality: recommended, estimated_total_bytes: totalBytes };
}
