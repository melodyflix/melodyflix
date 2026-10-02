// melodyflix videos - VR/360 metadata (3.6)
import { getDb } from '@melodyflix/shared-db';

export type VrProjection = 'none' | 'equirectangular' | 'cubemap';
export type VrStereo = 'mono' | 'sbs' | 'ou';

export interface VrMetadata {
  video_id: string;
  projection: VrProjection;
  stereo: VrStereo;
  fov: number;              // default FOV in degrees
  initial_yaw: number;      // deg, 0..360
  initial_pitch: number;    // deg, -90..90
  has_spatial_audio: number; // 0/1 (link to spatial audio 45.5)
  updated_at: string;
}

export const PROJECTIONS: { id: VrProjection; label: string }[] = [
  { id: 'none', label: 'Standard (2D)' },
  { id: 'equirectangular', label: '360° Equirectangular' },
  { id: 'cubemap', label: '360° Cubemap' },
];

export const STEREOS: { id: VrStereo; label: string }[] = [
  { id: 'mono', label: 'Monoscopic (2D)' },
  { id: 'sbs', label: 'Stereoscopic Side-by-Side' },
  { id: 'ou', label: 'Stereoscopic Over-Under' },
];

export function ensureVrSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_vr_metadata (
      video_id TEXT PRIMARY KEY,
      projection TEXT NOT NULL DEFAULT 'none',
      stereo TEXT NOT NULL DEFAULT 'mono',
      fov REAL NOT NULL DEFAULT 75,
      initial_yaw REAL NOT NULL DEFAULT 0,
      initial_pitch REAL NOT NULL DEFAULT 0,
      has_spatial_audio INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
  // Add vr_projection column to videos (denormalized for list/filter)
  try { db.exec("ALTER TABLE videos ADD COLUMN vr_projection TEXT NOT NULL DEFAULT 'none'"); } catch {}
}

const DEFAULT_META = (videoId: string): VrMetadata => ({
  video_id: videoId,
  projection: 'none',
  stereo: 'mono',
  fov: 75,
  initial_yaw: 0,
  initial_pitch: 0,
  has_spatial_audio: 0,
  updated_at: new Date().toISOString(),
});

export function getVrMetadata(videoId: string): VrMetadata {
  const db = getDb();
  const row = db.prepare('SELECT * FROM video_vr_metadata WHERE video_id = ?').get(videoId) as VrMetadata | undefined;
  return row ?? DEFAULT_META(videoId);
}

export interface VrMetadataInput {
  projection?: VrProjection;
  stereo?: VrStereo;
  fov?: number;
  initial_yaw?: number;
  initial_pitch?: number;
  has_spatial_audio?: boolean;
}

function isValidProjection(v: any): v is VrProjection {
  return v === 'none' || v === 'equirectangular' || v === 'cubemap';
}
function isValidStereo(v: any): v is VrStereo {
  return v === 'mono' || v === 'sbs' || v === 'ou';
}

export function setVrMetadata(videoId: string, input: VrMetadataInput): VrMetadata {
  const db = getDb();
  const current = getVrMetadata(videoId);
  const next: VrMetadata = {
    video_id: videoId,
    projection: isValidProjection(input.projection) ? input.projection : current.projection,
    stereo: isValidStereo(input.stereo) ? input.stereo : current.stereo,
    fov: typeof input.fov === 'number' ? Math.max(30, Math.min(120, input.fov)) : current.fov,
    initial_yaw: typeof input.initial_yaw === 'number' ? ((input.initial_yaw % 360) + 360) % 360 : current.initial_yaw,
    initial_pitch: typeof input.initial_pitch === 'number' ? Math.max(-90, Math.min(90, input.initial_pitch)) : current.initial_pitch,
    has_spatial_audio: typeof input.has_spatial_audio === 'boolean' ? (input.has_spatial_audio ? 1 : 0) : current.has_spatial_audio,
    updated_at: new Date().toISOString(),
  };

  db.prepare(
    'INSERT INTO video_vr_metadata (video_id, projection, stereo, fov, initial_yaw, initial_pitch, has_spatial_audio, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(video_id) DO UPDATE SET ' +
    'projection = excluded.projection, stereo = excluded.stereo, fov = excluded.fov, ' +
    'initial_yaw = excluded.initial_yaw, initial_pitch = excluded.initial_pitch, ' +
    'has_spatial_audio = excluded.has_spatial_audio, updated_at = excluded.updated_at'
  ).run(
    next.video_id, next.projection, next.stereo, next.fov,
    next.initial_yaw, next.initial_pitch, next.has_spatial_audio, next.updated_at,
  );

  // Denormalize to videos table for list/filter queries
  db.prepare('UPDATE videos SET vr_projection = ? WHERE id = ?').run(next.projection, videoId);

  return next;
}

export function clearVrMetadata(videoId: string): VrMetadata {
  return setVrMetadata(videoId, { projection: 'none', stereo: 'mono', has_spatial_audio: false });
}

// List VR videos
export function listVrVideos(limit = 40): { id: string; title: string; thumbnail_url: string | null; vr_projection: string; created_at: string }[] {
  const db = getDb();
  return db.prepare(
    "SELECT id, title, thumbnail_url, vr_projection, created_at FROM videos WHERE vr_projection != 'none' ORDER BY created_at DESC LIMIT ?"
  ).all(Math.max(1, Math.min(100, limit))) as any;
}
