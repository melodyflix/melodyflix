// melodyflix videos - custom intro/outro + templates (30.3, 30.5)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type IntroKind = 'intro' | 'outro';

export interface ChannelIntro {
  id: string;
  channel_id: string;
  kind: IntroKind;
  video_url: string;
  thumbnail_url: string | null;
  duration_seconds: number;
  skip_after_seconds: number;   // auto-skip window
  is_enabled: number;
  template_id: string | null;
  created_at: string;
  updated_at: string;
}

// Predefined templates (30.5) — these are preset configurations
export interface IntroTemplate {
  id: string;
  label: string;
  description: string;
  duration_seconds: number;
  kind: IntroKind;
  preview_color: string;
  preview_icon: string;
}

export const INTRO_TEMPLATES: IntroTemplate[] = [
  { id: 'logo-fade', label: 'Logo Fade', description: 'Channel logo fades in and out over a solid background', duration_seconds: 3, kind: 'intro', preview_color: '#065fd4', preview_icon: '✨' },
  { id: 'swoosh', label: 'Swoosh', description: 'Quick swoosh transition with channel name', duration_seconds: 2, kind: 'intro', preview_color: '#7c3aed', preview_icon: '🌊' },
  { id: 'countdown', label: 'Countdown 3-2-1', description: 'Numeric countdown before video starts', duration_seconds: 3, kind: 'intro', preview_color: '#dc2626', preview_icon: '⏱️' },
  { id: 'subscribe-reminder', label: 'Subscribe Reminder', description: 'Animated subscribe bell with channel CTA', duration_seconds: 4, kind: 'intro', preview_color: '#ef4444', preview_icon: '🔔' },
  { id: 'end-card-basic', label: 'Basic End Card', description: 'Simple end screen with subscribe button', duration_seconds: 8, kind: 'outro', preview_color: '#0f0f0f', preview_icon: '🎬' },
  { id: 'end-card-grid', label: 'End Card Grid', description: '2x2 video grid for next-up suggestions', duration_seconds: 10, kind: 'outro', preview_color: '#16a34a', preview_icon: '📺' },
  { id: 'end-card-minimal', label: 'Minimal Outro', description: 'Clean fade-to-black with channel handle', duration_seconds: 5, kind: 'outro', preview_color: '#606060', preview_icon: '⚫' },
  { id: 'credits-roll', label: 'Credits Roll', description: 'Scrolling credits with music', duration_seconds: 15, kind: 'outro', preview_color: '#92400e', preview_icon: '📜' },
];

export function ensureIntroOutroSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_intros (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'intro',
      video_url TEXT NOT NULL,
      thumbnail_url TEXT,
      duration_seconds INTEGER NOT NULL DEFAULT 3,
      skip_after_seconds INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      template_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (channel_id, kind)
    );
    CREATE INDEX IF NOT EXISTS idx_intros_channel ON channel_intros(channel_id, kind);
  `);
}

export function listChannelIntros(channelId: string): ChannelIntro[] {
  const db = getDb();
  return db.prepare('SELECT * FROM channel_intros WHERE channel_id = ? ORDER BY kind ASC').all(channelId) as ChannelIntro[];
}

export function getChannelIntro(channelId: string, kind: IntroKind): ChannelIntro | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM channel_intros WHERE channel_id = ? AND kind = ?').get(channelId, kind) as ChannelIntro) ?? null;
}

export interface IntroInput {
  kind: IntroKind;
  video_url: string;
  thumbnail_url?: string | null;
  duration_seconds?: number;
  skip_after_seconds?: number;
  is_enabled?: boolean;
  template_id?: string | null;
}

export function setChannelIntro(channelId: string, input: IntroInput): ChannelIntro {
  const db = getDb();
  const url = (input.video_url || '').trim();
  if (!url) throw new Error('video_url is required');
  if (url.length > 500) throw new Error('URL too long');

  // Validate template id if provided
  if (input.template_id && !INTRO_TEMPLATES.find((t) => t.id === input.template_id)) {
    throw new Error('Invalid template_id');
  }

  // Auto-duration from template if not specified
  let duration = input.duration_seconds ?? 3;
  if (!input.duration_seconds && input.template_id) {
    const tpl = INTRO_TEMPLATES.find((t) => t.id === input.template_id);
    if (tpl) duration = tpl.duration_seconds;
  }
  duration = Math.max(1, Math.min(60, duration));

  const skip = Math.max(0, Math.min(duration, input.skip_after_seconds ?? 0));
  const now = new Date().toISOString();

  const existing = getChannelIntro(channelId, input.kind);
  if (existing) {
    db.prepare(
      'UPDATE channel_intros SET video_url = ?, thumbnail_url = ?, duration_seconds = ?, skip_after_seconds = ?, is_enabled = ?, template_id = ?, updated_at = ? WHERE id = ?'
    ).run(
      url,
      input.thumbnail_url !== undefined ? (input.thumbnail_url ? String(input.thumbnail_url).slice(0, 500) : null) : existing.thumbnail_url,
      duration,
      skip,
      input.is_enabled === undefined ? existing.is_enabled : (input.is_enabled ? 1 : 0),
      input.template_id !== undefined ? input.template_id : existing.template_id,
      now,
      existing.id,
    );
    return getChannelIntro(channelId, input.kind)!;
  }

  const id = randomUUID();
  db.prepare(
    'INSERT INTO channel_intros (id, channel_id, kind, video_url, thumbnail_url, duration_seconds, skip_after_seconds, is_enabled, template_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id, channelId, input.kind, url,
    input.thumbnail_url ? String(input.thumbnail_url).slice(0, 500) : null,
    duration, skip,
    input.is_enabled === false ? 0 : 1,
    input.template_id ?? null,
    now, now,
  );
  return getChannelIntro(channelId, input.kind)!;
}

export function removeChannelIntro(channelId: string, kind: IntroKind): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM channel_intros WHERE channel_id = ? AND kind = ?').run(channelId, kind);
  return res.changes > 0;
}

// Client-friendly bundle
export interface IntroBundle {
  intro: ChannelIntro | null;
  outro: ChannelIntro | null;
}

export function getIntroBundle(channelId: string): IntroBundle {
  return {
    intro: getChannelIntro(channelId, 'intro'),
    outro: getChannelIntro(channelId, 'outro'),
  };
}
