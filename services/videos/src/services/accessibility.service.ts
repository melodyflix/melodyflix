// melodyflix videos - Section 16 Accessibility
// Single service covering all 12 accessibility items:
//   16.1  Audio Description tracks
//   16.2  Screen Reader support profiles
//   16.3  Keyboard Navigation profiles
//   16.4  High-Contrast Mode preferences
//   16.5  Sign Language Overlay tracks
//   16.6  Caption Styling preferences
//   16.7  Color-Blind Mode preferences
//   16.8  Accessible Player Controls (feature registry)
//   16.9  WCAG Audit
//   16.10 Caption Accuracy Check (WER-style)
//   16.11 Contrast Checker (WCAG ratio)
//   16.12 Accessibility Report (aggregated score)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type AudioDescriptionKind = 'standard' | 'descriptive' | 'extended';
export type SignLanguageLocale = 'asl' | 'bsl' | 'isl' | 'other';
export type ColorBlindKind = 'protanopia' | 'deuteranopia' | 'tritanopia' | 'achromatopsia' | 'none';
export type WcagLevel = 'A' | 'AA' | 'AAA';
export type WcagStatus = 'pass' | 'fail' | 'warning' | 'manual';

export function ensureAccessibilitySchema(): void {
  const db = getDb();
  db.exec(`
    -- 16.1 Audio Description tracks
    CREATE TABLE IF NOT EXISTS audio_descriptions (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en',
      kind TEXT NOT NULL DEFAULT 'standard',
      track_url TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      narrator TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ad_video ON audio_descriptions(video_id, language);

    -- 16.5 Sign Language Overlay tracks
    CREATE TABLE IF NOT EXISTS sign_language_tracks (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      locale TEXT NOT NULL DEFAULT 'asl',
      track_url TEXT NOT NULL,
      position TEXT NOT NULL DEFAULT 'bottom_right',
      size_percent INTEGER NOT NULL DEFAULT 25,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_slt_video ON sign_language_tracks(video_id, locale);

    -- 16.2 + 16.3 + 16.4 + 16.6 + 16.7 user accessibility preferences
    CREATE TABLE IF NOT EXISTS a11y_preferences (
      user_id TEXT PRIMARY KEY,
      screen_reader_enabled INTEGER NOT NULL DEFAULT 0,
      aria_verbosity TEXT NOT NULL DEFAULT 'standard',
      keyboard_nav_enabled INTEGER NOT NULL DEFAULT 1,
      keyboard_shortcuts TEXT NOT NULL DEFAULT '{}',
      high_contrast INTEGER NOT NULL DEFAULT 0,
      color_blind_mode TEXT NOT NULL DEFAULT 'none',
      reduced_motion INTEGER NOT NULL DEFAULT 0,
      font_scale REAL NOT NULL DEFAULT 1.0,
      caption_style TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- 16.8 accessible player controls (feature registry per video)
    CREATE TABLE IF NOT EXISTS accessible_controls (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      control_key TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE (video_id, control_key)
    );

    -- 16.9 WCAG audit
    CREATE TABLE IF NOT EXISTS wcag_audits (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL DEFAULT 'video',
      target_id TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'AA',
      status TEXT NOT NULL DEFAULT 'warning',
      score REAL NOT NULL DEFAULT 0,
      checks TEXT NOT NULL DEFAULT '[]',
      auditor_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wcag_target ON wcag_audits(target_id, created_at DESC);

    -- 16.10 caption accuracy
    CREATE TABLE IF NOT EXISTS caption_accuracy (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en',
      reference_words INTEGER NOT NULL DEFAULT 0,
      substitution_errors INTEGER NOT NULL DEFAULT 0,
      deletion_errors INTEGER NOT NULL DEFAULT 0,
      insertion_errors INTEGER NOT NULL DEFAULT 0,
      wer REAL NOT NULL DEFAULT 0,
      accuracy REAL NOT NULL DEFAULT 0,
      grade TEXT NOT NULL DEFAULT 'unknown',
      evaluated_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_caption_acc_video ON caption_accuracy(video_id, created_at DESC);
  `);
}

// ================= 16.1 Audio Description =================
export interface AudioDescription {
  id: string;
  video_id: string;
  language: string;
  kind: AudioDescriptionKind;
  track_url: string;
  duration_ms: number;
  narrator: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AddAudioDescInput {
  video_id: string;
  language?: string;
  kind?: AudioDescriptionKind;
  track_url: string;
  duration_ms?: number;
  narrator?: string | null;
  created_by?: string | null;
}

export function addAudioDescription(input: AddAudioDescInput): AudioDescription {
  if (!input.video_id) throw new Error('video_required');
  if (!input.track_url) throw new Error('track_url_required');
  const kind = input.kind ?? 'standard';
  if (!['standard','descriptive','extended'].includes(kind)) throw new Error('invalid_kind');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO audio_descriptions
      (id, video_id, language, kind, track_url, duration_ms, narrator, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.video_id, input.language ?? 'en', kind, input.track_url,
    input.duration_ms ?? 0, input.narrator ?? null, input.created_by ?? null, now, now);
  return getAudioDescription(id)!;
}

export function getAudioDescription(id: string): AudioDescription | null {
  return (getDb().prepare('SELECT * FROM audio_descriptions WHERE id = ?').get(id) as AudioDescription | undefined) ?? null;
}

export function listAudioDescriptions(videoId: string): AudioDescription[] {
  return getDb().prepare('SELECT * FROM audio_descriptions WHERE video_id = ? ORDER BY language, kind')
    .all(videoId) as AudioDescription[];
}

export function deleteAudioDescription(id: string, actorId: string): boolean {
  const a = getAudioDescription(id);
  if (!a) return false;
  if (a.created_by && a.created_by !== actorId) throw new Error('creator_only');
  return getDb().prepare('DELETE FROM audio_descriptions WHERE id = ?').run(id).changes > 0;
}

// ================= 16.5 Sign Language Overlay =================
export interface SignLanguageTrack {
  id: string;
  video_id: string;
  locale: SignLanguageLocale;
  track_url: string;
  position: string;
  size_percent: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AddSignTrackInput {
  video_id: string;
  locale?: SignLanguageLocale;
  track_url: string;
  position?: string;
  size_percent?: number;
  created_by?: string | null;
}

export function addSignLanguageTrack(input: AddSignTrackInput): SignLanguageTrack {
  if (!input.video_id) throw new Error('video_required');
  if (!input.track_url) throw new Error('track_url_required');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO sign_language_tracks
      (id, video_id, locale, track_url, position, size_percent, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.video_id, input.locale ?? 'asl', input.track_url,
    input.position ?? 'bottom_right', Math.min(Math.max(input.size_percent ?? 25, 5), 75),
    input.created_by ?? null, now, now);
  return getSignTrack(id)!;
}

export function getSignTrack(id: string): SignLanguageTrack | null {
  return (getDb().prepare('SELECT * FROM sign_language_tracks WHERE id = ?').get(id) as SignLanguageTrack | undefined) ?? null;
}

export function listSignLanguageTracks(videoId: string): SignLanguageTrack[] {
  return getDb().prepare('SELECT * FROM sign_language_tracks WHERE video_id = ? ORDER BY locale')
    .all(videoId) as SignLanguageTrack[];
}

export function deleteSignLanguageTrack(id: string, actorId: string): boolean {
  const t = getSignTrack(id);
  if (!t) return false;
  if (t.created_by && t.created_by !== actorId) throw new Error('creator_only');
  return getDb().prepare('DELETE FROM sign_language_tracks WHERE id = ?').run(id).changes > 0;
}

// ================= 16.2/16.3/16.4/16.6/16.7 Preferences =================
export interface A11yPreferences {
  user_id: string;
  screen_reader_enabled: number;
  aria_verbosity: string;
  keyboard_nav_enabled: number;
  keyboard_shortcuts: string;
  high_contrast: number;
  color_blind_mode: ColorBlindKind;
  reduced_motion: number;
  font_scale: number;
  caption_style: string;
  updated_at: string;
  created_at: string;
}

export interface UpdateA11yPrefsInput {
  screen_reader_enabled?: boolean;
  aria_verbosity?: 'minimal' | 'standard' | 'verbose';
  keyboard_nav_enabled?: boolean;
  keyboard_shortcuts?: Record<string, string>;
  high_contrast?: boolean;
  color_blind_mode?: ColorBlindKind;
  reduced_motion?: boolean;
  font_scale?: number;
  caption_style?: {
    font?: string;
    font_size_px?: number;
    text_color?: string;
    bg_color?: string;
    bg_opacity?: number;
    outline?: boolean;
    position?: 'top' | 'bottom';
  };
}

export function getOrCreatePreferences(userId: string): A11yPreferences {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM a11y_preferences WHERE user_id = ?').get(userId) as A11yPreferences | undefined;
  if (existing) return existing;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO a11y_preferences
      (user_id, screen_reader_enabled, aria_verbosity, keyboard_nav_enabled, keyboard_shortcuts,
       high_contrast, color_blind_mode, reduced_motion, font_scale, caption_style, updated_at, created_at)
    VALUES (?, 0, 'standard', 1, '{}', 0, 'none', 0, 1.0, '{}', ?, ?)
  `).run(userId, now, now);
  return db.prepare('SELECT * FROM a11y_preferences WHERE user_id = ?').get(userId) as A11yPreferences;
}

export function updatePreferences(userId: string, patch: UpdateA11yPrefsInput): A11yPreferences {
  const cur = getOrCreatePreferences(userId);
  const fields: string[] = [];
  const args: any[] = [];
  if (patch.screen_reader_enabled !== undefined) { fields.push('screen_reader_enabled = ?'); args.push(patch.screen_reader_enabled ? 1 : 0); }
  if (patch.aria_verbosity !== undefined) { fields.push('aria_verbosity = ?'); args.push(patch.aria_verbosity); }
  if (patch.keyboard_nav_enabled !== undefined) { fields.push('keyboard_nav_enabled = ?'); args.push(patch.keyboard_nav_enabled ? 1 : 0); }
  if (patch.keyboard_shortcuts !== undefined) { fields.push('keyboard_shortcuts = ?'); args.push(JSON.stringify(patch.keyboard_shortcuts)); }
  if (patch.high_contrast !== undefined) { fields.push('high_contrast = ?'); args.push(patch.high_contrast ? 1 : 0); }
  if (patch.color_blind_mode !== undefined) {
    if (!['protanopia','deuteranopia','tritanopia','achromatopsia','none'].includes(patch.color_blind_mode)) throw new Error('invalid_colorblind');
    fields.push('color_blind_mode = ?'); args.push(patch.color_blind_mode);
  }
  if (patch.reduced_motion !== undefined) { fields.push('reduced_motion = ?'); args.push(patch.reduced_motion ? 1 : 0); }
  if (patch.font_scale !== undefined) {
    if (patch.font_scale < 0.5 || patch.font_scale > 3) throw new Error('invalid_font_scale');
    fields.push('font_scale = ?'); args.push(patch.font_scale);
  }
  if (patch.caption_style !== undefined) { fields.push('caption_style = ?'); args.push(JSON.stringify(patch.caption_style)); }
  if (!fields.length) return cur;
  fields.push('updated_at = ?'); args.push(new Date().toISOString());
  args.push(userId);
  getDb().prepare(`UPDATE a11y_preferences SET ${fields.join(', ')} WHERE user_id = ?`).run(...args);
  return getOrCreatePreferences(userId);
}

// ================= 16.8 Accessible Player Controls =================
const DEFAULT_CONTROLS = [
  'play_pause','seek','volume','captions_toggle','captions_language',
  'speed','fullscreen','quality','audio_track','keyboard_help','aria_live_region',
];

export interface AccessibleControl {
  id: string;
  video_id: string;
  control_key: string;
  enabled: number;
  notes: string | null;
  updated_at: string;
}

export function setAccessibleControl(videoId: string, controlKey: string, enabled: boolean, notes?: string): AccessibleControl {
  if (!DEFAULT_CONTROLS.includes(controlKey)) throw new Error('unknown_control');
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM accessible_controls WHERE video_id = ? AND control_key = ?')
    .get(videoId, controlKey) as AccessibleControl | undefined;
  if (existing) {
    db.prepare('UPDATE accessible_controls SET enabled = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, notes ?? null, now, existing.id);
    return db.prepare('SELECT * FROM accessible_controls WHERE id = ?').get(existing.id) as AccessibleControl;
  }
  const id = randomUUID();
  db.prepare(`
    INSERT INTO accessible_controls (id, video_id, control_key, enabled, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, videoId, controlKey, enabled ? 1 : 0, notes ?? null, now);
  return db.prepare('SELECT * FROM accessible_controls WHERE id = ?').get(id) as AccessibleControl;
}

export function listAccessibleControls(videoId: string): AccessibleControl[] {
  const rows = getDb().prepare('SELECT * FROM accessible_controls WHERE video_id = ? ORDER BY control_key')
    .all(videoId) as AccessibleControl[];
  const byKey = new Map(rows.map(r => [r.control_key, r]));
  // fill defaults for unspecified controls
  for (const k of DEFAULT_CONTROLS) {
    if (!byKey.has(k)) {
      byKey.set(k, { id: 'default', video_id: videoId, control_key: k, enabled: 1, notes: null, updated_at: '' });
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.control_key.localeCompare(b.control_key));
}

export function getDefaultControls(): string[] { return [...DEFAULT_CONTROLS]; }

// ================= 16.11 Contrast Checker =================
function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map(x => x + x).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error('invalid_hex');
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export interface ContrastResult {
  fg: string;
  bg: string;
  ratio: number;
  passes: { AA_normal: boolean; AA_large: boolean; AAA_normal: boolean; AAA_large: boolean };
}

export function checkContrast(fg: string, bg: string): ContrastResult {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  const ratio = (lighter + 0.05) / (darker + 0.05);
  const r = Math.round(ratio * 100) / 100;
  return {
    fg, bg, ratio: r,
    passes: {
      AA_normal: r >= 4.5,
      AA_large: r >= 3,
      AAA_normal: r >= 7,
      AAA_large: r >= 4.5,
    },
  };
}

// ================= 16.10 Caption Accuracy =================
export interface CaptionAccuracy {
  id: string;
  video_id: string;
  language: string;
  reference_words: number;
  substitution_errors: number;
  deletion_errors: number;
  insertion_errors: number;
  wer: number;
  accuracy: number;
  grade: string;
  evaluated_by: string | null;
  created_at: string;
}

export interface EvaluateCaptionInput {
  video_id: string;
  language?: string;
  reference_words: number;
  substitution_errors?: number;
  deletion_errors?: number;
  insertion_errors?: number;
  evaluated_by?: string | null;
}

export function evaluateCaptionAccuracy(input: EvaluateCaptionInput): CaptionAccuracy {
  if (!input.video_id) throw new Error('video_required');
  const ref = input.reference_words;
  if (ref <= 0) throw new Error('reference_words_must_be_positive');
  const s = Math.max(0, input.substitution_errors ?? 0);
  const d = Math.max(0, input.deletion_errors ?? 0);
  const i = Math.max(0, input.insertion_errors ?? 0);
  const wer = (s + d + i) / ref;
  const accuracy = Math.max(0, 1 - wer);
  const grade = accuracy >= 0.99 ? 'A+' : accuracy >= 0.97 ? 'A'
    : accuracy >= 0.95 ? 'B' : accuracy >= 0.90 ? 'C'
    : accuracy >= 0.80 ? 'D' : 'F';
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO caption_accuracy
      (id, video_id, language, reference_words, substitution_errors, deletion_errors, insertion_errors,
       wer, accuracy, grade, evaluated_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.video_id, input.language ?? 'en', ref, s, d, i, wer, accuracy, grade,
    input.evaluated_by ?? null, now);
  return db.prepare('SELECT * FROM caption_accuracy WHERE id = ?').get(id) as CaptionAccuracy;
}

export function listCaptionAccuracy(videoId: string, limit = 50): CaptionAccuracy[] {
  return getDb().prepare('SELECT * FROM caption_accuracy WHERE video_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(videoId, Math.min(Math.max(limit, 1), 200)) as CaptionAccuracy[];
}

// ================= 16.9 WCAG Audit =================
export interface WcagCheck {
  id: string;
  criterion: string;
  level: WcagLevel;
  status: WcagStatus;
  note?: string;
}

export interface WcagAudit {
  id: string;
  scope: string;
  target_id: string;
  level: WcagLevel;
  status: WcagStatus;
  score: number;
  checks: string;
  auditor_id: string | null;
  created_at: string;
}

export interface RunWcagAuditInput {
  scope?: string;
  target_id: string;
  level?: WcagLevel;
  checks?: WcagCheck[];
  auditor_id?: string | null;
  // auto-run augmentations:
  auto_run?: boolean;
}

const AUTO_CHECKS: (targetId: string) => WcagCheck[] = (targetId) => {
  const db = getDb();
  const video_id = targetId;
  const ads = db.prepare('SELECT COUNT(*) AS c FROM audio_descriptions WHERE video_id = ?').get(video_id) as { c: number };
  const signs = db.prepare('SELECT COUNT(*) AS c FROM sign_language_tracks WHERE video_id = ?').get(video_id) as { c: number };
  const caps = db.prepare('SELECT COUNT(*) AS c FROM caption_accuracy WHERE video_id = ?').get(video_id) as { c: number };
  return [
    { id: 'audio-desc', criterion: '1.2.5 Audio Description (Prerecorded)', level: 'AA',
      status: ads.c > 0 ? 'pass' : 'fail', note: ads.c > 0 ? `${ads.c} tracks` : 'no audio description' },
    { id: 'sign-lang', criterion: '1.2.6 Sign Language (Prerecorded)', level: 'AAA',
      status: signs.c > 0 ? 'pass' : 'warning', note: signs.c > 0 ? `${signs.c} tracks` : 'no sign language track' },
    { id: 'captions-acc', criterion: '1.2.2 Captions accuracy', level: 'AA',
      status: caps.c > 0 ? 'pass' : 'manual', note: caps.c > 0 ? `${caps.c} evaluations` : 'no caption accuracy on file' },
    { id: 'keyboard', criterion: '2.1.1 Keyboard', level: 'A', status: 'manual', note: 'verify on frontend' },
    { id: 'contrast', criterion: '1.4.3 Contrast (Minimum)', level: 'AA', status: 'manual', note: 'use /a11y/contrast-check' },
    { id: 'sr', criterion: '4.1.2 Name, Role, Value', level: 'A', status: 'manual', note: 'screen reader review' },
  ];
};

export function runWcagAudit(input: RunWcagAuditInput): WcagAudit {
  if (!input.target_id) throw new Error('target_required');
  const level = input.level ?? 'AA';
  const checks = [...(input.checks ?? []), ...(input.auto_run !== false ? AUTO_CHECKS(input.target_id) : [])];
  const total = checks.length;
  const weights: Record<WcagStatus, number> = { pass: 1, warning: 0.5, manual: 0.5, fail: 0 };
  const score = total ? checks.reduce((s, c) => s + weights[c.status], 0) / total : 0;
  const hasFail = checks.some(c => c.status === 'fail');
  const status: WcagStatus = hasFail ? 'fail' : score >= 0.95 ? 'pass' : 'warning';
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO wcag_audits (id, scope, target_id, level, status, score, checks, auditor_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.scope ?? 'video', input.target_id, level, status, score,
    JSON.stringify(checks), input.auditor_id ?? null, now);
  return getWcagAudit(id)!;
}

export function getWcagAudit(id: string): WcagAudit | null {
  return (getDb().prepare('SELECT * FROM wcag_audits WHERE id = ?').get(id) as WcagAudit | undefined) ?? null;
}

export function listWcagAudits(filter?: { target_id?: string; level?: WcagLevel; limit?: number }): WcagAudit[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter?.target_id) { where.push('target_id = ?'); args.push(filter.target_id); }
  if (filter?.level) { where.push('level = ?'); args.push(filter.level); }
  const sql = `SELECT * FROM wcag_audits ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args) as WcagAudit[];
}

// ================= 16.12 Accessibility Report =================
export interface AccessibilityReport {
  video_id: string;
  score: number;
  breakdown: {
    audio_description: { present: boolean; count: number; weight: number; contribution: number };
    sign_language: { present: boolean; count: number; weight: number; contribution: number };
    caption_accuracy: { avg_accuracy: number; latest_grade: string | null; weight: number; contribution: number };
    accessible_controls: { enabled: number; total: number; weight: number; contribution: number };
    wcag: { latest_score: number | null; latest_status: string | null; weight: number; contribution: number };
  };
  generated_at: string;
}

export function generateAccessibilityReport(videoId: string): AccessibilityReport {
  const db = getDb();
  const ads = db.prepare('SELECT COUNT(*) AS c FROM audio_descriptions WHERE video_id = ?').get(videoId) as { c: number };
  const signs = db.prepare('SELECT COUNT(*) AS c FROM sign_language_tracks WHERE video_id = ?').get(videoId) as { c: number };
  const accRow = db.prepare(`
    SELECT AVG(accuracy) AS a, COUNT(*) AS c FROM caption_accuracy WHERE video_id = ?
  `).get(videoId) as { a: number | null; c: number };
  const latestAcc = db.prepare(`SELECT grade FROM caption_accuracy WHERE video_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(videoId) as { grade: string } | undefined;
  const controls = listAccessibleControls(videoId);
  const wcagLatest = db.prepare(`SELECT score, status FROM wcag_audits WHERE target_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(videoId) as { score: number; status: string } | undefined;

  const weights = { ads: 0.25, sign: 0.15, caps: 0.25, controls: 0.15, wcag: 0.20 };
  const adsPresent = ads.c > 0 ? 1 : 0;
  const signPresent = signs.c > 0 ? 1 : 0;
  const capsAcc = accRow.a ?? 0;
  const controlsEnabled = controls.filter(c => c.enabled === 1).length;
  const controlsTotal = controls.length;
  const controlsScore = controlsTotal ? controlsEnabled / controlsTotal : 1;
  const wcagScore = wcagLatest?.score ?? 0.5;

  const bAds = weights.ads * adsPresent;
  const bSign = weights.sign * signPresent;
  const bCaps = weights.caps * capsAcc;
  const bControls = weights.controls * controlsScore;
  const bWcag = weights.wcag * wcagScore;
  const score = Math.round((bAds + bSign + bCaps + bControls + bWcag) * 1000) / 1000;

  return {
    video_id: videoId,
    score,
    breakdown: {
      audio_description: { present: ads.c > 0, count: ads.c, weight: weights.ads, contribution: bAds },
      sign_language: { present: signs.c > 0, count: signs.c, weight: weights.sign, contribution: bSign },
      caption_accuracy: { avg_accuracy: capsAcc, latest_grade: latestAcc?.grade ?? null, weight: weights.caps, contribution: bCaps },
      accessible_controls: { enabled: controlsEnabled, total: controlsTotal, weight: weights.controls, contribution: bControls },
      wcag: { latest_score: wcagLatest?.score ?? null, latest_status: wcagLatest?.status ?? null, weight: weights.wcag, contribution: bWcag },
    },
    generated_at: new Date().toISOString(),
  };
}

// ================= Global stats =================
export interface A11yStats {
  audio_descriptions: number;
  sign_language_tracks: number;
  caption_evaluations: number;
  wcag_audits: number;
  wcag_pass_rate: number;
  avg_caption_accuracy: number;
  users_with_prefs: number;
  users_with_high_contrast: number;
  users_with_colorblind_mode: number;
  users_with_screen_reader: number;
}

export function getA11yStats(): A11yStats {
  const db = getDb();
  const ads = db.prepare('SELECT COUNT(*) AS c FROM audio_descriptions').get() as { c: number };
  const signs = db.prepare('SELECT COUNT(*) AS c FROM sign_language_tracks').get() as { c: number };
  const caps = db.prepare('SELECT COUNT(*) AS c, AVG(accuracy) AS a FROM caption_accuracy').get() as { c: number; a: number | null };
  const audits = db.prepare('SELECT status FROM wcag_audits').all() as { status: string }[];
  const passCount = audits.filter(a => a.status === 'pass').length;
  const prefs = db.prepare('SELECT high_contrast, color_blind_mode, screen_reader_enabled FROM a11y_preferences').all() as
    { high_contrast: number; color_blind_mode: string; screen_reader_enabled: number }[];
  return {
    audio_descriptions: ads.c,
    sign_language_tracks: signs.c,
    caption_evaluations: caps.c,
    wcag_audits: audits.length,
    wcag_pass_rate: audits.length ? passCount / audits.length : 0,
    avg_caption_accuracy: caps.a ?? 0,
    users_with_prefs: prefs.length,
    users_with_high_contrast: prefs.filter(p => p.high_contrast === 1).length,
    users_with_colorblind_mode: prefs.filter(p => p.color_blind_mode !== 'none').length,
    users_with_screen_reader: prefs.filter(p => p.screen_reader_enabled === 1).length,
  };
}
