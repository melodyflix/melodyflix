// melodyflix videos - subtitle management (SRT/VTT upload + parse)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export interface SubtitleTrack {
  id: string;
  video_id: string;
  language: string;           // 'en', 'bn', 'hi', etc.
  label: string;              // 'English', 'বাংলা'
  format: 'srt' | 'vtt';
  kind: 'subtitles' | 'captions'; // subtitles = user-provided, captions = CC (hearing impaired)
  content: string;            // raw text
  is_default: number;         // 0 or 1
  created_at: string;
}

export interface SubtitleCue {
  start: number;   // seconds
  end: number;     // seconds
  text: string;
}

export function ensureSubtitleSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_subtitles (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      language TEXT NOT NULL,
      label TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'vtt',
      kind TEXT NOT NULL DEFAULT 'subtitles',
      content TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE (video_id, language, kind)
    );
    CREATE INDEX IF NOT EXISTS idx_subtitles_video ON video_subtitles(video_id, kind);
  `);
}

// ---------- SRT / VTT Parsing ----------

function timeToSeconds(t: string): number {
  // formats: HH:MM:SS,mmm or MM:SS.mmm or HH:MM:SS.mmm
  const clean = t.trim().replace(',', '.');
  const parts = clean.split(':');
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  }
  if (parts.length === 2) {
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(clean) || 0;
}

export function parseSrt(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const blocks = content.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length < 2) continue;
    // Skip the numeric index line if present
    let timeIdx = 0;
    if (/^\d+$/.test(lines[0].trim())) timeIdx = 1;
    const timeLine = lines[timeIdx];
    if (!timeLine || !timeLine.includes('-->')) continue;
    const [startStr, endStr] = timeLine.split('-->');
    const text = lines.slice(timeIdx + 1).join('\n').trim();
    if (!text) continue;
    cues.push({
      start: timeToSeconds(startStr),
      end: timeToSeconds(endStr),
      text,
    });
  }
  return cues;
}

export function parseVtt(content: string): SubtitleCue[] {
  // VTT is SRT-like. Strip "WEBVTT" header.
  const body = content.replace(/^WEBVTT[^\n]*\n+/, '');
  return parseSrt(body);
}

export function parseSubtitle(content: string, format: 'srt' | 'vtt'): SubtitleCue[] {
  return format === 'vtt' ? parseVtt(content) : parseSrt(content);
}

// Convert cues back to WebVTT for the player
export function cuesToVtt(cues: SubtitleCue[]): string {
  const lines = ['WEBVTT', ''];
  const fmt = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = (s % 60).toFixed(3).padStart(6, '0');
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec}`;
  };
  for (const c of cues) {
    lines.push(`${fmt(c.start)} --> ${fmt(c.end)}`);
    lines.push(c.text);
    lines.push('');
  }
  return lines.join('\n');
}

// ---------- CRUD ----------

export interface UploadInput {
  language: string;
  label: string;
  format: 'srt' | 'vtt';
  kind?: 'subtitles' | 'captions';
  content: string;
  is_default?: boolean;
}

export function listSubtitles(videoId: string): Omit<SubtitleTrack, 'content'>[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT id, video_id, language, label, format, kind, is_default, created_at FROM video_subtitles WHERE video_id = ? ORDER BY is_default DESC, language ASC'
  ).all(videoId) as Omit<SubtitleTrack, 'content'>[];
  return rows;
}

export function getSubtitle(trackId: string): SubtitleTrack | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM video_subtitles WHERE id = ?').get(trackId) as SubtitleTrack | undefined;
  return row ?? null;
}

export function getDefaultSubtitle(videoId: string, kind: 'subtitles' | 'captions' = 'subtitles'): SubtitleTrack | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM video_subtitles WHERE video_id = ? AND kind = ? ORDER BY is_default DESC, created_at ASC LIMIT 1'
  ).get(videoId, kind) as SubtitleTrack | undefined;
  return row ?? null;
}

export function uploadSubtitle(videoId: string, input: UploadInput): SubtitleTrack {
  const db = getDb();
  const lang = (input.language || '').trim().toLowerCase().slice(0, 10);
  const label = (input.label || lang).trim().slice(0, 60);
  const format = input.format === 'vtt' ? 'vtt' : 'srt';
  const kind = input.kind === 'captions' ? 'captions' : 'subtitles';
  const content = (input.content || '').trim();

  if (!lang) throw new Error('Language is required');
  if (!content) throw new Error('Subtitle content is empty');
  if (content.length > 500_000) throw new Error('Subtitle file too large (max ~500KB)');

  // Validate by parsing
  const cues = parseSubtitle(content, format);
  if (cues.length === 0) throw new Error('No valid cues found in subtitle file');

  // If is_default, clear other defaults
  if (input.is_default) {
    db.prepare('UPDATE video_subtitles SET is_default = 0 WHERE video_id = ? AND kind = ?').run(videoId, kind);
  }

  const now = new Date().toISOString();
  const existing = db.prepare(
    'SELECT id FROM video_subtitles WHERE video_id = ? AND language = ? AND kind = ?'
  ).get(videoId, lang, kind) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      'UPDATE video_subtitles SET label = ?, format = ?, content = ?, is_default = ?, created_at = ? WHERE id = ?'
    ).run(label, format, content, input.is_default ? 1 : 0, now, existing.id);
    return getSubtitle(existing.id)!;
  }

  const id = randomUUID();
  db.prepare(
    'INSERT INTO video_subtitles (id, video_id, language, label, format, kind, content, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, videoId, lang, label, format, kind, content, input.is_default ? 1 : 0, now);
  return getSubtitle(id)!;
}

export function deleteSubtitle(trackId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM video_subtitles WHERE id = ?').run(trackId);
}

export function setDefaultSubtitle(trackId: string): void {
  const db = getDb();
  const track = getSubtitle(trackId);
  if (!track) throw new Error('Subtitle not found');
  db.prepare('UPDATE video_subtitles SET is_default = 0 WHERE video_id = ? AND kind = ?').run(track.video_id, track.kind);
  db.prepare('UPDATE video_subtitles SET is_default = 1 WHERE id = ?').run(trackId);
}

export function getSubtitleAsVtt(trackId: string): string | null {
  const track = getSubtitle(trackId);
  if (!track) return null;
  const cues = parseSubtitle(track.content, track.format);
  return cuesToVtt(cues);
}

// ---------- Subtitle Editor (38.4) ----------

export function getSubtitleCues(trackId: string): SubtitleCue[] | null {
  const track = getSubtitle(trackId);
  if (!track) return null;
  return parseSubtitle(track.content, track.format);
}

// Save edited cues back. Input cues are validated & normalized.
export function updateSubtitleCues(trackId: string, cues: SubtitleCue[]): SubtitleTrack | null {
  const track = getSubtitle(trackId);
  if (!track) return null;
  if (!Array.isArray(cues)) throw new Error('Cues must be an array');
  if (cues.length > 5000) throw new Error('Too many cues (max 5000)');

  const cleaned: SubtitleCue[] = [];
  for (const c of cues) {
    const start = Number(c.start);
    const end = Number(c.end);
    const text = String(c.text ?? '').trim();
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (end <= start) continue;
    if (!text) continue;
    cleaned.push({ start, end, text });
  }
  if (cleaned.length === 0) throw new Error('No valid cues to save');

  // Sort by start time
  cleaned.sort((a, b) => a.start - b.start);

  // Always save as VTT to normalize
  const vtt = cuesToVtt(cleaned);
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare('UPDATE video_subtitles SET content = ?, format = ?, created_at = ? WHERE id = ?')
    .run(vtt, 'vtt', now, trackId);
  return getSubtitle(trackId);
}

// ---------- 38.2 Automatic Subtitle Generation (chapters/metadata fallback) ----------

/**
 * Auto-generate a draft subtitle track when no Whisper engine is available.
 *
 * Strategy:
 *   1. If video has chapters -> emit one cue per chapter segment
 *      ([chapter.start, nextChapter.start or video duration])
 *   2. Else if description has timestamped lines -> same, using those
 *   3. Else -> a single whole-video placeholder cue
 *
 * When Whisper / ASR is available later, swap the generator without touching routes.
 */

// Best-effort chapter reader (decoupled from chapter service types)
function readVideoChapters(videoId: string): { start_seconds: number; title: string }[] {
  const db = getDb();
  try {
    const rows = db.prepare(
      'SELECT start_seconds, title FROM video_chapters WHERE video_id = ? ORDER BY order_index ASC, start_seconds ASC'
    ).all(videoId) as { start_seconds: number; title: string }[];
    return rows;
  } catch {
    return [];
  }
}

function readVideoMeta(videoId: string): {
  title: string | null;
  description: string | null;
  duration_seconds: number | null;
} | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT title, description, duration_seconds FROM videos WHERE id = ?'
  ).get(videoId) as { title: string | null; description: string | null; duration_seconds: number | null } | undefined;
  return row ?? null;
}

// Fallback: timestamps embedded in the description body
function parseTimestampedLines(description: string | null | undefined): { start_seconds: number; title: string }[] {
  if (!description) return [];
  const out: { start_seconds: number; title: string }[] = [];
  for (const line of description.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—:]?\s*(.+?)\s*$/);
    if (!m) continue;
    const parts = m[1].split(':').map(Number);
    let secs = 0;
    if (parts.length === 2) secs = parts[0] * 60 + parts[1];
    else if (parts.length === 3) secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
    const title = m[2].trim();
    if (title) out.push({ start_seconds: secs, title });
  }
  return out;
}

export interface AutoGenResult {
  cues: SubtitleCue[];
  source: 'chapters' | 'description' | 'placeholder';
  draft: boolean; // true = user should review/edit before publishing
}

export function generateAutoCues(videoId: string): AutoGenResult {
  const meta = readVideoMeta(videoId);
  const duration = Math.max(0, Math.floor(meta?.duration_seconds ?? 0));

  // 1) Chapters
  let segments = readVideoChapters(videoId);
  let source: AutoGenResult['source'] = 'chapters';

  // 2) Description fallback
  if (segments.length === 0) {
    segments = parseTimestampedLines(meta?.description ?? '');
    if (segments.length > 0) source = 'description';
  }

  // 3) Placeholder
  if (segments.length === 0) {
    const text = meta?.title ? `[${meta.title}]` : '[Auto-generated draft — please review]';
    return {
      cues: [{ start: 0, end: duration > 0 ? duration : 5, text }],
      source: 'placeholder',
      draft: true,
    };
  }

  // Sort + build cues from consecutive segments
  segments.sort((a, b) => a.start_seconds - b.start_seconds);
  const cues: SubtitleCue[] = [];
  for (let i = 0; i < segments.length; i++) {
    const cur = segments[i];
    const next = segments[i + 1];
    const start = Math.max(0, cur.start_seconds);
    const endRaw = next ? next.start_seconds : (duration > 0 ? duration : start + 5);
    const end = Math.max(start + 0.5, endRaw);
    cues.push({ start, end, text: cur.title });
  }
  return { cues, source, draft: true };
}

// Persist an auto-generated draft as a subtitle track (language configurable)
export function autoGenerateSubtitle(
  videoId: string,
  language: string,
  label: string,
  kind: 'subtitles' | 'captions' = 'subtitles',
): SubtitleTrack {
  const result = generateAutoCues(videoId);
  const vtt = cuesToVtt(result.cues);
  return uploadSubtitle(videoId, {
    language,
    label: label || `${language} (auto)`,
    format: 'vtt',
    kind,
    content: vtt,
    is_default: false,
  });
}

