// melodyflix videos - voice & audio features (Section 45)
//
// Real ffmpeg-based processing for enhancement/noise/normalization;
// metadata-driven config for licensed features (Dolby Atmos, spatial,
// binaural) with pluggable encoder hooks.

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export function ensureAudioProcessingSchema(): void {
  const db = getDb();
  db.exec(`
    -- 45.1 audio-only variants
    CREATE TABLE IF NOT EXISTS audio_variants (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      variant_type TEXT NOT NULL DEFAULT 'audio_only',
      audio_track_id TEXT,
      hls_audio_url TEXT,
      duration_seconds REAL NOT NULL DEFAULT 0,
      file_size_bytes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_av_video ON audio_variants(video_id);
    CREATE INDEX IF NOT EXISTS idx_av_status ON audio_variants(status);

    -- 45.3/45.4/45.7 processing profiles (enhancement, noise, loudness)
    CREATE TABLE IF NOT EXISTS audio_profiles (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      profile_name TEXT NOT NULL,
      enhancement_json TEXT NOT NULL DEFAULT '{}',
      noise_reduction_json TEXT NOT NULL DEFAULT '{}',
      normalization_json TEXT NOT NULL DEFAULT '{}',
      target_lufs REAL NOT NULL DEFAULT -16,
      applied INTEGER NOT NULL DEFAULT 0,
      output_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ap_video ON audio_profiles(video_id);

    -- 45.5/45.6 surround + Atmos
    CREATE TABLE IF NOT EXISTS audio_channel_configs (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      layout TEXT NOT NULL DEFAULT 'stereo',
      atmos_enabled INTEGER NOT NULL DEFAULT 0,
      atmos_metadata_json TEXT NOT NULL DEFAULT '{}',
      sample_rate INTEGER NOT NULL DEFAULT 48000,
      bit_depth INTEGER NOT NULL DEFAULT 24,
      codec TEXT NOT NULL DEFAULT 'aac',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(video_id)
    );

    -- 45.9/45.10 spatial objects + object-based mixing
    CREATE TABLE IF NOT EXISTS spatial_audio_objects (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      name TEXT NOT NULL,
      source_track_id TEXT,
      position_x REAL NOT NULL DEFAULT 0,
      position_y REAL NOT NULL DEFAULT 0,
      position_z REAL NOT NULL DEFAULT 0,
      gain_db REAL NOT NULL DEFAULT 0,
      size REAL NOT NULL DEFAULT 1.0,
      automation_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sao_video ON spatial_audio_objects(video_id);

    -- 45.11 binaural previews
    CREATE TABLE IF NOT EXISTS binaural_previews (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      hrtf_profile TEXT NOT NULL DEFAULT 'generic',
      head_tracking INTEGER NOT NULL DEFAULT 0,
      preview_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bp_video ON binaural_previews(video_id);

    -- 45.12 quality checks
    CREATE TABLE IF NOT EXISTS audio_quality_checks (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      loudness_lufs REAL,
      true_peak_db REAL,
      dynamic_range_db REAL,
      noise_floor_db REAL,
      silence_ratio REAL,
      clipping_detected INTEGER NOT NULL DEFAULT 0,
      channels INTEGER NOT NULL DEFAULT 2,
      sample_rate INTEGER NOT NULL DEFAULT 48000,
      spatial_score REAL,
      issues_json TEXT NOT NULL DEFAULT '[]',
      score REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_aqc_video ON audio_quality_checks(video_id);
  `);
}

// ---------- 45.1 Audio-Only Mode ----------

export interface AudioVariant {
  id: string;
  video_id: string;
  variant_type: string;
  audio_track_id: string | null;
  hls_audio_url: string | null;
  duration_seconds: number;
  file_size_bytes: number;
  status: 'pending' | 'ready' | 'failed';
  created_at: string;
  updated_at: string;
}

interface AvRow {
  id: string; video_id: string; variant_type: string; audio_track_id: string | null;
  hls_audio_url: string | null; duration_seconds: number; file_size_bytes: number;
  status: string; created_at: string; updated_at: string;
}

function avRowToObj(row: AvRow): AudioVariant {
  return {
    id: row.id, video_id: row.video_id, variant_type: row.variant_type,
    audio_track_id: row.audio_track_id, hls_audio_url: row.hls_audio_url,
    duration_seconds: row.duration_seconds, file_size_bytes: row.file_size_bytes,
    status: row.status as AudioVariant['status'],
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

export function createAudioVariant(input: {
  video_id: string; audio_track_id?: string | null;
  hls_audio_url?: string | null; duration_seconds?: number;
}): AudioVariant {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO audio_variants (id, video_id, variant_type, audio_track_id, hls_audio_url,
      duration_seconds, file_size_bytes, status, created_at, updated_at)
    VALUES (?, ?, 'audio_only', ?, ?, ?, 0, ?, ?, ?)
  `).run(
    id, input.video_id, input.audio_track_id ?? null,
    input.hls_audio_url ?? null, input.duration_seconds ?? 0,
    input.hls_audio_url ? 'ready' : 'pending', now, now,
  );
  return getAudioVariant(id)!;
}

export function getAudioVariant(id: string): AudioVariant | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM audio_variants WHERE id = ?').get(id) as AvRow | undefined;
  return row ? avRowToObj(row) : null;
}

export function listAudioVariants(videoId: string): AudioVariant[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM audio_variants WHERE video_id = ? ORDER BY created_at DESC')
    .all(videoId) as AvRow[];
  return rows.map(avRowToObj);
}

export function updateAudioVariantStatus(id: string, status: AudioVariant['status'], url?: string): AudioVariant | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare('UPDATE audio_variants SET status = ?, hls_audio_url = COALESCE(?, hls_audio_url), updated_at = ? WHERE id = ?')
    .run(status, url ?? null, now, id);
  return getAudioVariant(id);
}

// ---------- 45.3/45.4/45.7 Audio Processing Profiles ----------

export interface EnhancementConfig {
  bass_boost_db?: number;
  treble_boost_db?: number;
  compression?: 'off' | 'light' | 'medium' | 'aggressive';
  stereo_widening?: number;  // 0.0 - 2.0
  clarity?: number;          // 0.0 - 1.0
}

export interface NoiseReductionConfig {
  enabled?: boolean;
  strength?: 'low' | 'medium' | 'high';
  noise_floor_db?: number;   // -80 to -20
  highpass_hz?: number;      // 20-300
  lowpass_hz?: number;       // 8000-20000
}

export interface NormalizationConfig {
  enabled?: boolean;
  target_lufs?: number;      // EBU R128: -23 to -14
  true_peak_db?: number;     // -2 to 0
  dual_pass?: boolean;
}

export interface AudioProfile {
  id: string;
  video_id: string;
  profile_name: string;
  enhancement: EnhancementConfig;
  noise_reduction: NoiseReductionConfig;
  normalization: NormalizationConfig;
  target_lufs: number;
  applied: boolean;
  output_url: string | null;
  created_at: string;
  updated_at: string;
}

interface ApRow {
  id: string; video_id: string; profile_name: string;
  enhancement_json: string; noise_reduction_json: string; normalization_json: string;
  target_lufs: number; applied: number; output_url: string | null;
  created_at: string; updated_at: string;
}

function safeObj<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function apRowToObj(row: ApRow): AudioProfile {
  return {
    id: row.id, video_id: row.video_id, profile_name: row.profile_name,
    enhancement: safeObj<EnhancementConfig>(row.enhancement_json, {}),
    noise_reduction: safeObj<NoiseReductionConfig>(row.noise_reduction_json, {}),
    normalization: safeObj<NormalizationConfig>(row.normalization_json, {}),
    target_lufs: row.target_lufs,
    applied: row.applied === 1,
    output_url: row.output_url,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

export interface CreateAudioProfileInput {
  video_id: string;
  profile_name: string;
  enhancement?: EnhancementConfig;
  noise_reduction?: NoiseReductionConfig;
  normalization?: NormalizationConfig;
}

export function createAudioProfile(input: CreateAudioProfileInput): AudioProfile {
  const db = getDb();
  if (!input.profile_name?.trim()) throw new Error('profile_name required');
  const id = randomUUID();
  const now = new Date().toISOString();
  const lufs = input.normalization?.target_lufs ?? -16;
  db.prepare(`
    INSERT INTO audio_profiles (id, video_id, profile_name, enhancement_json,
      noise_reduction_json, normalization_json, target_lufs, applied, output_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
  `).run(
    id, input.video_id, input.profile_name.trim(),
    JSON.stringify(input.enhancement ?? {}),
    JSON.stringify(input.noise_reduction ?? {}),
    JSON.stringify(input.normalization ?? {}),
    lufs, now, now,
  );
  return getAudioProfile(id)!;
}

export function getAudioProfile(id: string): AudioProfile | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM audio_profiles WHERE id = ?').get(id) as ApRow | undefined;
  return row ? apRowToObj(row) : null;
}

export function listAudioProfiles(videoId: string): AudioProfile[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM audio_profiles WHERE video_id = ? ORDER BY created_at DESC')
    .all(videoId) as ApRow[];
  return rows.map(apRowToObj);
}

export function updateAudioProfile(id: string, patch: {
  profile_name?: string;
  enhancement?: EnhancementConfig;
  noise_reduction?: NoiseReductionConfig;
  normalization?: NormalizationConfig;
  applied?: boolean;
  output_url?: string | null;
}): AudioProfile | null {
  const db = getDb();
  const cur = getAudioProfile(id);
  if (!cur) return null;
  const now = new Date().toISOString();
  const enh = patch.enhancement !== undefined ? { ...cur.enhancement, ...patch.enhancement } : cur.enhancement;
  const nr = patch.noise_reduction !== undefined ? { ...cur.noise_reduction, ...patch.noise_reduction } : cur.noise_reduction;
  const nz = patch.normalization !== undefined ? { ...cur.normalization, ...patch.normalization } : cur.normalization;
  db.prepare(`
    UPDATE audio_profiles SET profile_name = ?, enhancement_json = ?, noise_reduction_json = ?,
      normalization_json = ?, target_lufs = ?, applied = ?, output_url = ?, updated_at = ?
    WHERE id = ?
  `).run(
    patch.profile_name?.trim() || cur.profile_name,
    JSON.stringify(enh),
    JSON.stringify(nr),
    JSON.stringify(nz),
    nz.target_lufs ?? cur.target_lufs,
    patch.applied !== undefined ? (patch.applied ? 1 : 0) : (cur.applied ? 1 : 0),
    patch.output_url !== undefined ? patch.output_url : cur.output_url,
    now, id,
  );
  return getAudioProfile(id);
}

export function deleteAudioProfile(id: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM audio_profiles WHERE id = ?').run(id).changes > 0;
}

/**
 * Build the ffmpeg filter chain string for a given profile.
 * Real processing uses this chain; the actual run is triggered by the
 * caller (transcode worker).
 */
export function buildFfmpegFilterChain(profile: AudioProfile): string {
  const filters: string[] = [];

  const nr = profile.noise_reduction;
  if (nr.enabled) {
    // afftdn = FFT denoiser; nr controls strength (dB)
    const nf = nr.noise_floor_db ?? (nr.strength === 'high' ? -25 : nr.strength === 'medium' ? -35 : -45);
    filters.push(`afftdn=nf=${nf}`);
    if (nr.highpass_hz) filters.push(`highpass=f=${nr.highpass_hz}`);
    if (nr.lowpass_hz) filters.push(`lowpass=f=${nr.lowpass_hz}`);
  }

  const enh = profile.enhancement;
  if (enh.bass_boost_db) filters.push(`bass=g=${enh.bass_boost_db}`);
  if (enh.treble_boost_db) filters.push(`treble=g=${enh.treble_boost_db}`);
  if (enh.clarity) {
    // presence boost around 3kHz
    const g = Math.round(enh.clarity * 4 * 10) / 10;
    filters.push(`equalizer=f=3000:width_type=o:width=1:g=${g}`);
  }
  if (enh.stereo_widening && enh.stereo_widening !== 1.0) {
    filters.push(`extrastereo=m=${enh.stereo_widening}`);
  }
  if (enh.compression && enh.compression !== 'off') {
    const params: Record<string, string> = {
      light: 'threshold=-20dB:ratio=2:attack=10:release=200',
      medium: 'threshold=-18dB:ratio=4:attack=5:release=150',
      aggressive: 'threshold=-16dB:ratio=8:attack=3:release=100',
    };
    filters.push(`acompressor=${params[enh.compression]}`);
  }

  const nz = profile.normalization;
  if (nz.enabled) {
    const I = nz.target_lufs ?? profile.target_lufs;
    const TP = nz.true_peak_db ?? -2;
    filters.push(`loudnorm=I=${I}:TP=${TP}:LRA=11`);
  }

  return filters.join(',');
}

// ---------- 45.5/45.6 Surround Sound + Dolby Atmos ----------

export type ChannelLayout = 'mono' | 'stereo' | '5.1' | '7.1' | '5.1.4' | '7.1.4';

const VALID_LAYOUTS: ChannelLayout[] = ['mono', 'stereo', '5.1', '7.1', '5.1.4', '7.1.4'];

export interface AudioChannelConfig {
  id: string;
  video_id: string;
  layout: ChannelLayout;
  atmos_enabled: boolean;
  atmos_metadata: {
    // Dolby Atmos metadata placeholder — populated by licensed encoder
    atmos_version?: string;
    bed_layout?: string;
    object_count?: number;
    dialnorm?: number;
  };
  sample_rate: number;
  bit_depth: number;
  codec: 'aac' | 'ac3' | 'eac3' | 'truehd' | 'flac' | 'opus';
  created_at: string;
  updated_at: string;
}

interface AcRow {
  id: string; video_id: string; layout: string; atmos_enabled: number;
  atmos_metadata_json: string; sample_rate: number; bit_depth: number;
  codec: string; created_at: string; updated_at: string;
}

function acRowToObj(row: AcRow): AudioChannelConfig {
  return {
    id: row.id, video_id: row.video_id, layout: row.layout as ChannelLayout,
    atmos_enabled: row.atmos_enabled === 1,
    atmos_metadata: safeObj<AudioChannelConfig['atmos_metadata']>(row.atmos_metadata_json, {}),
    sample_rate: row.sample_rate, bit_depth: row.bit_depth,
    codec: row.codec as AudioChannelConfig['codec'],
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

export interface SetChannelConfigInput {
  layout?: ChannelLayout;
  atmos_enabled?: boolean;
  atmos_metadata?: AudioChannelConfig['atmos_metadata'];
  sample_rate?: number;
  bit_depth?: number;
  codec?: AudioChannelConfig['codec'];
}

export function setChannelConfig(videoId: string, input: SetChannelConfigInput): AudioChannelConfig {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = getChannelConfig(videoId);

  if (input.layout && !VALID_LAYOUTS.includes(input.layout)) {
    throw new Error(`invalid layout: ${input.layout} (allowed: ${VALID_LAYOUTS.join(', ')})`);
  }

  if (existing) {
    db.prepare(`
      UPDATE audio_channel_configs SET layout = ?, atmos_enabled = ?, atmos_metadata_json = ?,
        sample_rate = ?, bit_depth = ?, codec = ?, updated_at = ?
      WHERE video_id = ?
    `).run(
      input.layout ?? existing.layout,
      input.atmos_enabled !== undefined ? (input.atmos_enabled ? 1 : 0) : (existing.atmos_enabled ? 1 : 0),
      JSON.stringify(input.atmos_metadata ?? existing.atmos_metadata),
      input.sample_rate ?? existing.sample_rate,
      input.bit_depth ?? existing.bit_depth,
      input.codec ?? existing.codec,
      now, videoId,
    );
  } else {
    db.prepare(`
      INSERT INTO audio_channel_configs (id, video_id, layout, atmos_enabled, atmos_metadata_json,
        sample_rate, bit_depth, codec, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), videoId,
      input.layout ?? 'stereo',
      input.atmos_enabled ? 1 : 0,
      JSON.stringify(input.atmos_metadata ?? {}),
      input.sample_rate ?? 48000,
      input.bit_depth ?? 24,
      input.codec ?? 'aac',
      now, now,
    );
  }
  return getChannelConfig(videoId)!;
}

export function getChannelConfig(videoId: string): AudioChannelConfig | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM audio_channel_configs WHERE video_id = ?').get(videoId) as AcRow | undefined;
  return row ? acRowToObj(row) : null;
}

export function listByLayout(layout: ChannelLayout): AudioChannelConfig[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM audio_channel_configs WHERE layout = ?').all(layout) as AcRow[];
  return rows.map(acRowToObj);
}

// ---------- 45.9/45.10 Spatial Audio Objects ----------

export interface SpatialAudioObject {
  id: string;
  video_id: string;
  name: string;
  source_track_id: string | null;
  position_x: number;  // -1 to 1
  position_y: number;  // -1 to 1
  position_z: number;  // -1 to 1
  gain_db: number;     // -60 to +12
  size: number;        // 0 to 5
  automation: Array<{ time: number; x?: number; y?: number; z?: number; gain?: number }>;
  created_at: string;
  updated_at: string;
}

interface SaoRow {
  id: string; video_id: string; name: string; source_track_id: string | null;
  position_x: number; position_y: number; position_z: number;
  gain_db: number; size: number; automation_json: string;
  created_at: string; updated_at: string;
}

function saoRowToObj(row: SaoRow): SpatialAudioObject {
  return {
    id: row.id, video_id: row.video_id, name: row.name,
    source_track_id: row.source_track_id,
    position_x: row.position_x, position_y: row.position_y, position_z: row.position_z,
    gain_db: row.gain_db, size: row.size,
    automation: safeObj<SpatialAudioObject['automation']>(row.automation_json, []),
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

export interface CreateSpatialObjectInput {
  video_id: string;
  name: string;
  source_track_id?: string | null;
  position_x?: number;
  position_y?: number;
  position_z?: number;
  gain_db?: number;
  size?: number;
  automation?: SpatialAudioObject['automation'];
}

export function createSpatialObject(input: CreateSpatialObjectInput): SpatialAudioObject {
  const db = getDb();
  if (!input.name?.trim()) throw new Error('name required');
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO spatial_audio_objects (id, video_id, name, source_track_id,
      position_x, position_y, position_z, gain_db, size, automation_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.video_id, input.name.trim(), input.source_track_id ?? null,
    clamp(input.position_x ?? 0, -1, 1),
    clamp(input.position_y ?? 0, -1, 1),
    clamp(input.position_z ?? 0, -1, 1),
    clamp(input.gain_db ?? 0, -60, 12),
    clamp(input.size ?? 1, 0, 5),
    JSON.stringify(input.automation ?? []),
    now, now,
  );
  return getSpatialObject(id)!;
}

export function getSpatialObject(id: string): SpatialAudioObject | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM spatial_audio_objects WHERE id = ?').get(id) as SaoRow | undefined;
  return row ? saoRowToObj(row) : null;
}

export function listSpatialObjects(videoId: string): SpatialAudioObject[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM spatial_audio_objects WHERE video_id = ? ORDER BY created_at')
    .all(videoId) as SaoRow[];
  return rows.map(saoRowToObj);
}

export function updateSpatialObject(id: string, patch: Partial<CreateSpatialObjectInput>): SpatialAudioObject | null {
  const db = getDb();
  const cur = getSpatialObject(id);
  if (!cur) return null;
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE spatial_audio_objects SET name = ?, source_track_id = ?,
      position_x = ?, position_y = ?, position_z = ?, gain_db = ?, size = ?,
      automation_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    patch.name?.trim() || cur.name,
    patch.source_track_id !== undefined ? patch.source_track_id : cur.source_track_id,
    patch.position_x !== undefined ? clamp(patch.position_x, -1, 1) : cur.position_x,
    patch.position_y !== undefined ? clamp(patch.position_y, -1, 1) : cur.position_y,
    patch.position_z !== undefined ? clamp(patch.position_z, -1, 1) : cur.position_z,
    patch.gain_db !== undefined ? clamp(patch.gain_db, -60, 12) : cur.gain_db,
    patch.size !== undefined ? clamp(patch.size, 0, 5) : cur.size,
    patch.automation !== undefined ? JSON.stringify(patch.automation) : JSON.stringify(cur.automation),
    now, id,
  );
  return getSpatialObject(id);
}

export function deleteSpatialObject(id: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM spatial_audio_objects WHERE id = ?').run(id).changes > 0;
}

// ---------- 45.11 Binaural Preview ----------

export interface BinauralPreview {
  id: string;
  video_id: string;
  hrtf_profile: string;
  head_tracking: boolean;
  preview_url: string | null;
  status: 'pending' | 'ready' | 'failed';
  created_at: string;
  updated_at: string;
}

interface BpRow {
  id: string; video_id: string; hrtf_profile: string; head_tracking: number;
  preview_url: string | null; status: string; created_at: string; updated_at: string;
}

function bpRowToObj(row: BpRow): BinauralPreview {
  return {
    id: row.id, video_id: row.video_id, hrtf_profile: row.hrtf_profile,
    head_tracking: row.head_tracking === 1,
    preview_url: row.preview_url, status: row.status as BinauralPreview['status'],
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

export function createBinauralPreview(input: {
  video_id: string; hrtf_profile?: string; head_tracking?: boolean;
}): BinauralPreview {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO binaural_previews (id, video_id, hrtf_profile, head_tracking, preview_url, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, 'pending', ?, ?)
  `).run(id, input.video_id, input.hrtf_profile ?? 'generic', input.head_tracking ? 1 : 0, now, now);
  return getBinauralPreview(id)!;
}

export function getBinauralPreview(id: string): BinauralPreview | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM binaural_previews WHERE id = ?').get(id) as BpRow | undefined;
  return row ? bpRowToObj(row) : null;
}

export function listBinauralPreviews(videoId: string): BinauralPreview[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM binaural_previews WHERE video_id = ? ORDER BY created_at DESC')
    .all(videoId) as BpRow[];
  return rows.map(bpRowToObj);
}

export function updateBinauralPreview(id: string, patch: {
  status?: BinauralPreview['status']; preview_url?: string | null;
  hrtf_profile?: string; head_tracking?: boolean;
}): BinauralPreview | null {
  const db = getDb();
  const cur = getBinauralPreview(id);
  if (!cur) return null;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE binaural_previews SET hrtf_profile = ?, head_tracking = ?, preview_url = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(
    patch.hrtf_profile ?? cur.hrtf_profile,
    patch.head_tracking !== undefined ? (patch.head_tracking ? 1 : 0) : (cur.head_tracking ? 1 : 0),
    patch.preview_url !== undefined ? patch.preview_url : cur.preview_url,
    patch.status ?? cur.status,
    now, id,
  );
  return getBinauralPreview(id);
}

// ---------- 45.12 Spatial Audio Quality Check ----------

export interface AudioQualityIssue {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  measured?: number;
  recommended?: number;
}

export interface AudioQualityCheck {
  id: string;
  video_id: string;
  loudness_lufs: number | null;
  true_peak_db: number | null;
  dynamic_range_db: number | null;
  noise_floor_db: number | null;
  silence_ratio: number | null;
  clipping_detected: boolean;
  channels: number;
  sample_rate: number;
  spatial_score: number | null;
  issues: AudioQualityIssue[];
  score: number;
  created_at: string;
}

interface AqcRow {
  id: string; video_id: string; loudness_lufs: number | null; true_peak_db: number | null;
  dynamic_range_db: number | null; noise_floor_db: number | null; silence_ratio: number | null;
  clipping_detected: number; channels: number; sample_rate: number;
  spatial_score: number | null; issues_json: string; score: number; created_at: string;
}

function aqcRowToObj(row: AqcRow): AudioQualityCheck {
  return {
    id: row.id, video_id: row.video_id,
    loudness_lufs: row.loudness_lufs,
    true_peak_db: row.true_peak_db,
    dynamic_range_db: row.dynamic_range_db,
    noise_floor_db: row.noise_floor_db,
    silence_ratio: row.silence_ratio,
    clipping_detected: row.clipping_detected === 1,
    channels: row.channels, sample_rate: row.sample_rate,
    spatial_score: row.spatial_score,
    issues: safeObj<AudioQualityIssue[]>(row.issues_json, []),
    score: row.score, created_at: row.created_at,
  };
}

export interface RunQualityCheckInput {
  video_id: string;
  loudness_lufs?: number;
  true_peak_db?: number;
  dynamic_range_db?: number;
  noise_floor_db?: number;
  silence_ratio?: number;
  clipping_detected?: boolean;
  channels?: number;
  sample_rate?: number;
}

/**
 * Evaluate audio quality against EBU R128 + best-practice thresholds.
 * Measurements are passed in (from ffprobe/ebur128 filter output);
 * this function scores and flags issues.
 */
export function runAudioQualityCheck(input: RunQualityCheckInput): AudioQualityCheck {
  const db = getDb();
  const issues: AudioQualityIssue[] = [];
  let score = 100;

  const lufs = input.loudness_lufs ?? null;
  if (lufs !== null) {
    if (lufs > -9) {
      issues.push({ code: 'loud', severity: 'error', message: `Loudness ${lufs.toFixed(1)} LUFS exceeds -9 (too loud)`, measured: lufs, recommended: -14 });
      score -= 25;
    } else if (lufs < -24) {
      issues.push({ code: 'quiet', severity: 'warning', message: `Loudness ${lufs.toFixed(1)} LUFS below -24 (too quiet)`, measured: lufs, recommended: -14 });
      score -= 10;
    } else if (lufs < -18 || lufs > -11) {
      issues.push({ code: 'loudness_off', severity: 'info', message: `Loudness ${lufs.toFixed(1)} LUFS outside ideal -14 to -16 range`, measured: lufs, recommended: -14 });
      score -= 3;
    }
  }

  const tp = input.true_peak_db ?? null;
  if (tp !== null) {
    if (tp > -0.1) {
      issues.push({ code: 'clipping', severity: 'error', message: `True peak ${tp.toFixed(2)} dB exceeds -0.1 dB (inter-sample clipping)`, measured: tp, recommended: -1 });
      score -= 20;
    } else if (tp > -1) {
      issues.push({ code: 'true_peak_high', severity: 'warning', message: `True peak ${tp.toFixed(2)} dB above -1 dB (safe threshold)`, measured: tp, recommended: -1 });
      score -= 5;
    }
  }

  const dr = input.dynamic_range_db ?? null;
  if (dr !== null && dr < 6) {
    issues.push({ code: 'low_dynamic_range', severity: 'warning', message: `Dynamic range ${dr.toFixed(1)} dB is low (over-compressed)`, measured: dr, recommended: 10 });
    score -= 8;
  }

  const nf = input.noise_floor_db ?? null;
  if (nf !== null && nf > -45) {
    issues.push({ code: 'high_noise_floor', severity: 'warning', message: `Noise floor ${nf.toFixed(1)} dB too high`, measured: nf, recommended: -50 });
    score -= 10;
  }

  const sr = input.silence_ratio ?? null;
  if (sr !== null && sr > 0.5) {
    issues.push({ code: 'excess_silence', severity: 'info', message: `Silence ratio ${(sr * 100).toFixed(0)}% is very high`, measured: sr, recommended: 0.3 });
    score -= 3;
  }

  if (input.clipping_detected) {
    issues.push({ code: 'clipping_events', severity: 'error', message: 'Digital clipping events detected' });
    score -= 25;
  }

  const channels = input.channels ?? 2;
  const layout = getChannelConfig(input.video_id);
  if (layout && layout.atmos_enabled && channels < 6) {
    issues.push({ code: 'atmos_channel_mismatch', severity: 'error', message: 'Atmos enabled but channel count < 6' });
    score -= 15;
  }

  const sr2 = input.sample_rate ?? 48000;
  if (sr2 < 44100) {
    issues.push({ code: 'low_sample_rate', severity: 'warning', message: `Sample rate ${sr2} Hz below CD quality (44.1kHz)`, measured: sr2, recommended: 44100 });
    score -= 8;
  }

  // spatial score: 100 minus issues affecting spatial
  const spatialIssues = issues.filter((i) =>
    ['atmos_channel_mismatch', 'clipping', 'clipping_events', 'high_noise_floor'].includes(i.code)
  ).length;
  const spatialScore = Math.max(0, 100 - spatialIssues * 25);

  score = Math.max(0, Math.min(100, score));

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO audio_quality_checks (id, video_id, loudness_lufs, true_peak_db, dynamic_range_db,
      noise_floor_db, silence_ratio, clipping_detected, channels, sample_rate, spatial_score, issues_json, score, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.video_id, lufs, tp, dr, nf, sr,
    input.clipping_detected ? 1 : 0, channels, sr2,
    spatialScore, JSON.stringify(issues), score, now,
  );
  return getAudioQualityCheck(id)!;
}

export function getAudioQualityCheck(id: string): AudioQualityCheck | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM audio_quality_checks WHERE id = ?').get(id) as AqcRow | undefined;
  return row ? aqcRowToObj(row) : null;
}

export function listAudioQualityChecks(videoId: string, limit = 20): AudioQualityCheck[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM audio_quality_checks WHERE video_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(videoId, limit) as AqcRow[];
  return rows.map(aqcRowToObj);
}

// ---------- ffmpeg execution helper ----------

import { spawn } from 'node:child_process';

/**
 * Apply an audio profile to a source file using ffmpeg's filter chain.
 * Real processing — produces a new audio output. Non-blocking helper
 * that callers await; the transcode worker is expected to drive this.
 */
export function applyAudioProfile(
  profileId: string,
  inputPath: string,
  outputPath: string,
): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    const profile = getAudioProfile(profileId);
    if (!profile) { resolve({ ok: false, stderr: 'profile not found' }); return; }
    const filter = buildFfmpegFilterChain(profile);
    const args = [
      '-y', '-i', inputPath,
      ...(filter ? ['-af', filter] : []),
      '-c:a', 'aac', '-b:a', '192k',
      outputPath,
    ];
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('error', (e) => resolve({ ok: false, stderr: e.message }));
    proc.on('close', (code) => {
      if (code === 0) {
        updateAudioProfile(profileId, { applied: true, output_url: outputPath });
        resolve({ ok: true, stderr });
      } else {
        resolve({ ok: false, stderr: stderr.slice(-800) });
      }
    });
  });
}
