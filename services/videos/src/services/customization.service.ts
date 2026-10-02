// melodyflix videos - player customization (30.1, 30.2, 30.4, 30.8)
import { getDb } from '@melodyflix/shared-db';

export interface PlayerCustomization {
  channel_id: string;
  // 30.1 / 30.2 — Player skin + branding
  accent_color: string;         // primary button/highlight color
  background_color: string;     // controls background
  progress_color: string;       // progress bar fill
  logo_url: string | null;      // channel logo shown on player
  logo_position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  logo_opacity: number;         // 0..1
  watermark_text: string | null;
  // 30.4 — Video filters (client-side CSS)
  filter_preset: string;        // 'none' | 'warm' | 'cool' | 'vivid' | 'vintage' | 'bw' | 'cinematic' | 'custom'
  brightness: number;           // 0.5..1.5
  contrast: number;             // 0.5..1.5
  saturation: number;           // 0..2
  hue_rotate: number;           // -180..180
  sepia: number;                // 0..1
  blur: number;                 // 0..5
  // 30.8 — Color grading
  color_grading_preset: string; // 'none' | 'teal-orange' | 'noir' | 'sepia' | 'vibrant' | 'pastel' | 'custom'
  tint_r: number;               // 0..255 (RGB tint)
  tint_g: number;
  tint_b: number;
  tint_alpha: number;           // 0..0.5
  updated_at: string;
}

const DEFAULTS: Omit<PlayerCustomization, 'channel_id' | 'updated_at'> = {
  accent_color: '#065fd4',
  background_color: '#0f0f0f',
  progress_color: '#065fd4',
  logo_url: null,
  logo_position: 'top-right',
  logo_opacity: 0.9,
  watermark_text: null,
  filter_preset: 'none',
  brightness: 1,
  contrast: 1,
  saturation: 1,
  hue_rotate: 0,
  sepia: 0,
  blur: 0,
  color_grading_preset: 'none',
  tint_r: 255,
  tint_g: 255,
  tint_b: 255,
  tint_alpha: 0,
};

export const FILTER_PRESETS: Record<string, Partial<PlayerCustomization>> = {
  none: { brightness: 1, contrast: 1, saturation: 1, hue_rotate: 0, sepia: 0, blur: 0 },
  warm: { brightness: 1.05, contrast: 1.05, saturation: 1.1, hue_rotate: -8, sepia: 0.15, blur: 0 },
  cool: { brightness: 1, contrast: 1.05, saturation: 1.05, hue_rotate: 15, sepia: 0, blur: 0 },
  vivid: { brightness: 1.05, contrast: 1.15, saturation: 1.4, hue_rotate: 0, sepia: 0, blur: 0 },
  vintage: { brightness: 0.98, contrast: 0.95, saturation: 0.85, hue_rotate: -5, sepia: 0.3, blur: 0 },
  bw: { brightness: 1, contrast: 1.1, saturation: 0, hue_rotate: 0, sepia: 0, blur: 0 },
  cinematic: { brightness: 0.95, contrast: 1.2, saturation: 1.05, hue_rotate: -3, sepia: 0.05, blur: 0 },
};

export const COLOR_GRADING_PRESETS: Record<string, { tint: [number, number, number, number]; label: string }> = {
  none: { tint: [255, 255, 255, 0], label: 'None' },
  'teal-orange': { tint: [255, 200, 150, 0.15], label: 'Teal & Orange' },
  noir: { tint: [40, 40, 60, 0.25], label: 'Noir' },
  sepia: { tint: [220, 190, 150, 0.2], label: 'Sepia' },
  vibrant: { tint: [255, 240, 255, 0.08], label: 'Vibrant' },
  pastel: { tint: [255, 240, 250, 0.18], label: 'Pastel' },
};

export function ensureCustomizationSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_customizations (
      channel_id TEXT PRIMARY KEY,
      accent_color TEXT NOT NULL DEFAULT '#065fd4',
      background_color TEXT NOT NULL DEFAULT '#0f0f0f',
      progress_color TEXT NOT NULL DEFAULT '#065fd4',
      logo_url TEXT,
      logo_position TEXT NOT NULL DEFAULT 'top-right',
      logo_opacity REAL NOT NULL DEFAULT 0.9,
      watermark_text TEXT,
      filter_preset TEXT NOT NULL DEFAULT 'none',
      brightness REAL NOT NULL DEFAULT 1,
      contrast REAL NOT NULL DEFAULT 1,
      saturation REAL NOT NULL DEFAULT 1,
      hue_rotate REAL NOT NULL DEFAULT 0,
      sepia REAL NOT NULL DEFAULT 0,
      blur REAL NOT NULL DEFAULT 0,
      color_grading_preset TEXT NOT NULL DEFAULT 'none',
      tint_r INTEGER NOT NULL DEFAULT 255,
      tint_g INTEGER NOT NULL DEFAULT 255,
      tint_b INTEGER NOT NULL DEFAULT 255,
      tint_alpha REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
}

export function getCustomization(channelId: string): PlayerCustomization {
  const db = getDb();
  const row = db.prepare('SELECT * FROM player_customizations WHERE channel_id = ?').get(channelId) as PlayerCustomization | undefined;
  if (row) return row;
  return { channel_id: channelId, ...DEFAULTS, updated_at: new Date().toISOString() };
}

export interface CustomizationInput {
  accent_color?: string;
  background_color?: string;
  progress_color?: string;
  logo_url?: string | null;
  logo_position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  logo_opacity?: number;
  watermark_text?: string | null;
  filter_preset?: string;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  hue_rotate?: number;
  sepia?: number;
  blur?: number;
  color_grading_preset?: string;
  tint_r?: number;
  tint_g?: number;
  tint_b?: number;
  tint_alpha?: number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function normalizeColor(v: string | undefined, fallback: string): string {
  if (!v) return fallback;
  const s = v.trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) return s;
  return fallback;
}

export function setCustomization(channelId: string, input: CustomizationInput): PlayerCustomization {
  const db = getDb();
  const current = getCustomization(channelId);
  const patch = { ...input };

  // If a filter preset is selected (and not 'custom'), override filter numeric fields
  if (patch.filter_preset && patch.filter_preset !== 'custom' && FILTER_PRESETS[patch.filter_preset]) {
    Object.assign(patch, FILTER_PRESETS[patch.filter_preset]);
  }

  // If a color grading preset is selected (and not 'custom'), apply tint defaults
  if (patch.color_grading_preset && patch.color_grading_preset !== 'custom' && COLOR_GRADING_PRESETS[patch.color_grading_preset]) {
    const [r, g, b, a] = COLOR_GRADING_PRESETS[patch.color_grading_preset].tint;
    patch.tint_r = r; patch.tint_g = g; patch.tint_b = b; patch.tint_alpha = a;
  }

  const now = new Date().toISOString();

  const next: PlayerCustomization = {
    channel_id: channelId,
    accent_color: normalizeColor(patch.accent_color, current.accent_color),
    background_color: normalizeColor(patch.background_color, current.background_color),
    progress_color: normalizeColor(patch.progress_color, current.progress_color),
    logo_url: patch.logo_url !== undefined ? (patch.logo_url ? String(patch.logo_url).slice(0, 500) : null) : current.logo_url,
    logo_position: patch.logo_position ?? current.logo_position,
    logo_opacity: typeof patch.logo_opacity === 'number' ? clamp(patch.logo_opacity, 0, 1) : current.logo_opacity,
    watermark_text: patch.watermark_text !== undefined ? (patch.watermark_text ? String(patch.watermark_text).slice(0, 100) : null) : current.watermark_text,
    filter_preset: patch.filter_preset ?? current.filter_preset,
    brightness: typeof patch.brightness === 'number' ? clamp(patch.brightness, 0.5, 1.5) : current.brightness,
    contrast: typeof patch.contrast === 'number' ? clamp(patch.contrast, 0.5, 1.5) : current.contrast,
    saturation: typeof patch.saturation === 'number' ? clamp(patch.saturation, 0, 2) : current.saturation,
    hue_rotate: typeof patch.hue_rotate === 'number' ? clamp(patch.hue_rotate, -180, 180) : current.hue_rotate,
    sepia: typeof patch.sepia === 'number' ? clamp(patch.sepia, 0, 1) : current.sepia,
    blur: typeof patch.blur === 'number' ? clamp(patch.blur, 0, 5) : current.blur,
    color_grading_preset: patch.color_grading_preset ?? current.color_grading_preset,
    tint_r: typeof patch.tint_r === 'number' ? clamp(Math.round(patch.tint_r), 0, 255) : current.tint_r,
    tint_g: typeof patch.tint_g === 'number' ? clamp(Math.round(patch.tint_g), 0, 255) : current.tint_g,
    tint_b: typeof patch.tint_b === 'number' ? clamp(Math.round(patch.tint_b), 0, 255) : current.tint_b,
    tint_alpha: typeof patch.tint_alpha === 'number' ? clamp(patch.tint_alpha, 0, 0.5) : current.tint_alpha,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO player_customizations (
      channel_id, accent_color, background_color, progress_color,
      logo_url, logo_position, logo_opacity, watermark_text,
      filter_preset, brightness, contrast, saturation, hue_rotate, sepia, blur,
      color_grading_preset, tint_r, tint_g, tint_b, tint_alpha, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET
      accent_color = excluded.accent_color,
      background_color = excluded.background_color,
      progress_color = excluded.progress_color,
      logo_url = excluded.logo_url,
      logo_position = excluded.logo_position,
      logo_opacity = excluded.logo_opacity,
      watermark_text = excluded.watermark_text,
      filter_preset = excluded.filter_preset,
      brightness = excluded.brightness,
      contrast = excluded.contrast,
      saturation = excluded.saturation,
      hue_rotate = excluded.hue_rotate,
      sepia = excluded.sepia,
      blur = excluded.blur,
      color_grading_preset = excluded.color_grading_preset,
      tint_r = excluded.tint_r,
      tint_g = excluded.tint_g,
      tint_b = excluded.tint_b,
      tint_alpha = excluded.tint_alpha,
      updated_at = excluded.updated_at`
  ).run(
    next.channel_id, next.accent_color, next.background_color, next.progress_color,
    next.logo_url, next.logo_position, next.logo_opacity, next.watermark_text,
    next.filter_preset, next.brightness, next.contrast, next.saturation, next.hue_rotate, next.sepia, next.blur,
    next.color_grading_preset, next.tint_r, next.tint_g, next.tint_b, next.tint_alpha, next.updated_at,
  );

  return next;
}

export function resetCustomization(channelId: string): PlayerCustomization {
  const db = getDb();
  db.prepare('DELETE FROM player_customizations WHERE channel_id = ?').run(channelId);
  return getCustomization(channelId);
}

// Build CSS filter string (for client consumption)
export function buildCssFilter(c: PlayerCustomization): string {
  const parts: string[] = [];
  if (c.brightness !== 1) parts.push(`brightness(${c.brightness})`);
  if (c.contrast !== 1) parts.push(`contrast(${c.contrast})`);
  if (c.saturation !== 1) parts.push(`saturate(${c.saturation})`);
  if (c.hue_rotate !== 0) parts.push(`hue-rotate(${c.hue_rotate}deg)`);
  if (c.sepia > 0) parts.push(`sepia(${c.sepia})`);
  if (c.blur > 0) parts.push(`blur(${c.blur}px)`);
  return parts.join(' ') || 'none';
}
