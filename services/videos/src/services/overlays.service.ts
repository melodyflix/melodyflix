// melodyflix videos - lower thirds + transitions (30.6, 30.7)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

// ============ 30.6 Lower Third Graphics ============

export type LowerThirdPosition = 'left' | 'center' | 'right';
export type LowerThirdStyle = 'minimal' | 'solid' | 'glass' | 'accent' | 'bar';
export type LowerThirdAnimation = 'slide-up' | 'slide-left' | 'fade' | 'pop';

export interface LowerThird {
  id: string;
  channel_id: string;
  title: string;
  subtitle: string | null;
  accent_color: string;
  text_color: string;
  bg_color: string;
  position: LowerThirdPosition;
  style: LowerThirdStyle;
  animation: LowerThirdAnimation;
  start_seconds: number;
  end_seconds: number;
  is_enabled: number;
  created_at: string;
  updated_at: string;
}

export const LOWER_THIRD_STYLES: { id: LowerThirdStyle; label: string }[] = [
  { id: 'minimal', label: 'Minimal (text only)' },
  { id: 'solid', label: 'Solid color block' },
  { id: 'glass', label: 'Glass (blur)' },
  { id: 'accent', label: 'Accent bar' },
  { id: 'bar', label: 'Bottom bar' },
];

export const LOWER_THIRD_ANIMATIONS: { id: LowerThirdAnimation; label: string }[] = [
  { id: 'slide-up', label: 'Slide Up' },
  { id: 'slide-left', label: 'Slide Left' },
  { id: 'fade', label: 'Fade In' },
  { id: 'pop', label: 'Pop' },
];

export function ensureOverlaysSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_lower_thirds (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT,
      accent_color TEXT NOT NULL DEFAULT '#065fd4',
      text_color TEXT NOT NULL DEFAULT '#ffffff',
      bg_color TEXT NOT NULL DEFAULT 'rgba(0,0,0,0.75)',
      position TEXT NOT NULL DEFAULT 'left',
      style TEXT NOT NULL DEFAULT 'minimal',
      animation TEXT NOT NULL DEFAULT 'slide-up',
      start_seconds REAL NOT NULL DEFAULT 0,
      end_seconds REAL NOT NULL DEFAULT 5,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lower_thirds_channel ON channel_lower_thirds(channel_id, start_seconds);
  `);
}

export function listLowerThirds(channelId: string): LowerThird[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM channel_lower_thirds WHERE channel_id = ? ORDER BY start_seconds ASC'
  ).all(channelId) as LowerThird[];
}

export interface LowerThirdInput {
  title: string;
  subtitle?: string | null;
  accent_color?: string;
  text_color?: string;
  bg_color?: string;
  position?: LowerThirdPosition;
  style?: LowerThirdStyle;
  animation?: LowerThirdAnimation;
  start_seconds?: number;
  end_seconds?: number;
  is_enabled?: boolean;
}

export function createLowerThird(channelId: string, input: LowerThirdInput): LowerThird {
  const db = getDb();
  if (!input.title?.trim()) throw new Error('Title is required');
  const start = Math.max(0, input.start_seconds ?? 0);
  const end = Math.max(start + 0.5, input.end_seconds ?? start + 5);
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO channel_lower_thirds (id, channel_id, title, subtitle, accent_color, text_color, bg_color, position, style, animation, start_seconds, end_seconds, is_enabled, created_at, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id, channelId, input.title.trim().slice(0, 150),
    input.subtitle?.trim().slice(0, 200) ?? null,
    input.accent_color || '#065fd4',
    input.text_color || '#ffffff',
    input.bg_color || 'rgba(0,0,0,0.75)',
    input.position || 'left',
    input.style || 'minimal',
    input.animation || 'slide-up',
    start, end,
    input.is_enabled === false ? 0 : 1,
    now, now,
  );
  return db.prepare('SELECT * FROM channel_lower_thirds WHERE id = ?').get(id) as LowerThird;
}

export function updateLowerThird(id: string, input: LowerThirdInput): LowerThird {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM channel_lower_thirds WHERE id = ?').get(id) as LowerThird | undefined;
  if (!existing) throw new Error('Lower third not found');
  const start = input.start_seconds ?? existing.start_seconds;
  const end = Math.max(start + 0.5, input.end_seconds ?? existing.end_seconds);
  db.prepare(
    'UPDATE channel_lower_thirds SET title = ?, subtitle = ?, accent_color = ?, text_color = ?, bg_color = ?, position = ?, style = ?, animation = ?, start_seconds = ?, end_seconds = ?, is_enabled = ?, updated_at = ? WHERE id = ?'
  ).run(
    input.title?.trim().slice(0, 150) ?? existing.title,
    input.subtitle !== undefined ? (input.subtitle?.trim().slice(0, 200) ?? null) : existing.subtitle,
    input.accent_color || existing.accent_color,
    input.text_color || existing.text_color,
    input.bg_color || existing.bg_color,
    input.position || existing.position,
    input.style || existing.style,
    input.animation || existing.animation,
    start, end,
    input.is_enabled === undefined ? existing.is_enabled : (input.is_enabled ? 1 : 0),
    new Date().toISOString(),
    id,
  );
  return db.prepare('SELECT * FROM channel_lower_thirds WHERE id = ?').get(id) as LowerThird;
}

export function deleteLowerThird(id: string): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM channel_lower_thirds WHERE id = ?').run(id);
  return res.changes > 0;
}

// ============ 30.7 Transition Presets ============

export type TransitionKind = 'none' | 'fade' | 'slide-left' | 'slide-right' | 'zoom-in' | 'dissolve' | 'wipe' | 'glitch';

export interface ChannelTransition {
  channel_id: string;
  intro_to_video: TransitionKind;   // transition when intro ends
  video_to_outro: TransitionKind;   // transition when main video ends
  duration_ms: number;              // 200..2000
  updated_at: string;
}

export const TRANSITION_PRESETS: { id: TransitionKind; label: string; icon: string }[] = [
  { id: 'none', label: 'None (hard cut)', icon: '⏭️' },
  { id: 'fade', label: 'Fade to black', icon: '⬛' },
  { id: 'slide-left', label: 'Slide Left', icon: '⬅️' },
  { id: 'slide-right', label: 'Slide Right', icon: '➡️' },
  { id: 'zoom-in', label: 'Zoom In', icon: '🔍' },
  { id: 'dissolve', label: 'Dissolve', icon: '💫' },
  { id: 'wipe', label: 'Wipe', icon: '🎞️' },
  { id: 'glitch', label: 'Glitch', icon: '📺' },
];

const DEFAULT_TRANSITION: Omit<ChannelTransition, 'channel_id' | 'updated_at'> = {
  intro_to_video: 'fade',
  video_to_outro: 'fade',
  duration_ms: 500,
};

export function getChannelTransition(channelId: string): ChannelTransition {
  const db = getDb();
  const row = db.prepare('SELECT * FROM channel_transitions WHERE channel_id = ?').get(channelId) as ChannelTransition | undefined;
  if (row) return row;
  return { channel_id: channelId, ...DEFAULT_TRANSITION, updated_at: new Date().toISOString() };
}

export interface TransitionInput {
  intro_to_video?: TransitionKind;
  video_to_outro?: TransitionKind;
  duration_ms?: number;
}

export function setChannelTransition(channelId: string, input: TransitionInput): ChannelTransition {
  const db = getDb();
  const current = getChannelTransition(channelId);
  const next: ChannelTransition = {
    channel_id: channelId,
    intro_to_video: input.intro_to_video ?? current.intro_to_video,
    video_to_outro: input.video_to_outro ?? current.video_to_outro,
    duration_ms: Math.max(200, Math.min(2000, input.duration_ms ?? current.duration_ms)),
    updated_at: new Date().toISOString(),
  };

  db.prepare(
    'INSERT INTO channel_transitions (channel_id, intro_to_video, video_to_outro, duration_ms, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?) ' +
    'ON CONFLICT(channel_id) DO UPDATE SET ' +
    'intro_to_video = excluded.intro_to_video, video_to_outro = excluded.video_to_outro, duration_ms = excluded.duration_ms, updated_at = excluded.updated_at'
  ).run(
    next.channel_id, next.intro_to_video, next.video_to_outro, next.duration_ms, next.updated_at,
  );

  return next;
}

export function resetChannelTransition(channelId: string): ChannelTransition {
  const db = getDb();
  db.prepare('DELETE FROM channel_transitions WHERE channel_id = ?').run(channelId);
  return getChannelTransition(channelId);
}

// Extend ensureOverlaysSchema to create transition table
export function ensureTransitionSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_transitions (
      channel_id TEXT PRIMARY KEY,
      intro_to_video TEXT NOT NULL DEFAULT 'fade',
      video_to_outro TEXT NOT NULL DEFAULT 'fade',
      duration_ms INTEGER NOT NULL DEFAULT 500,
      updated_at TEXT NOT NULL
    );
  `);
}

// Build CSS transition string for client consumption
export function buildTransitionCss(kind: TransitionKind, durationMs: number): string {
  const dur = Math.max(200, Math.min(2000, durationMs));
  switch (kind) {
    case 'none': return `transition: none;`;
    case 'fade': return `transition: opacity ${dur}ms ease-in-out;`;
    case 'slide-left': return `transition: transform ${dur}ms ease-in-out;`;
    case 'slide-right': return `transition: transform ${dur}ms ease-in-out;`;
    case 'zoom-in': return `transition: transform ${dur}ms ease-out, opacity ${dur}ms ease-out;`;
    case 'dissolve': return `transition: opacity ${dur}ms cubic-bezier(0.4, 0, 0.2, 1);`;
    case 'wipe': return `transition: clip-path ${dur}ms ease-in-out;`;
    case 'glitch': return `transition: filter ${dur}ms steps(6);`;
    default: return `transition: opacity ${dur}ms ease-in-out;`;
  }
}
