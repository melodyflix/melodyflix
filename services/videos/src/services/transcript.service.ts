// melodyflix videos - video transcript (derived from subtitles/chapters)
import { getDb } from '@melodyflix/shared-db';
import {
  getDefaultSubtitle, parseSubtitle, cuesToVtt,
  getSubtitle, type SubtitleCue,
} from './subtitle.service.js';

export interface TranscriptCue {
  index: number;
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  video_id: string;
  language: string;
  label: string;
  source: 'subtitle' | 'chapters' | 'placeholder';
  cues: TranscriptCue[];
  plain_text: string;
  word_count: number;
  duration: number;
}

// Read chapter rows (best-effort, decoupled)
function readChapters(videoId: string): { start_seconds: number; title: string }[] {
  const db = getDb();
  try {
    return db.prepare(
      'SELECT start_seconds, title FROM video_chapters WHERE video_id = ? ORDER BY order_index ASC, start_seconds ASC'
    ).all(videoId) as { start_seconds: number; title: string }[];
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
  return (db.prepare(
    'SELECT title, description, duration_seconds FROM videos WHERE id = ?'
  ).get(videoId) as any) ?? null;
}

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

function buildFromRawCues(rawCues: SubtitleCue[]): TranscriptCue[] {
  return rawCues.map((c, i) => ({ index: i, start: c.start, end: c.end, text: c.text }));
}

function cuesToPlainText(cues: TranscriptCue[]): string {
  return cues.map((c) => c.text.replace(/\n+/g, ' ').trim()).join(' ').trim();
}

function countWords(text: string): number {
  return (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;
}

export function getTranscript(videoId: string, preferredLang?: string): Transcript | null {
  const meta = readVideoMeta(videoId);
  if (!meta) return null;
  const duration = Math.max(0, Math.floor(meta.duration_seconds ?? 0));

  // 1) Prefer subtitle in requested language
  if (preferredLang) {
    const db = getDb();
    const row = db.prepare(
      'SELECT * FROM video_subtitles WHERE video_id = ? AND language = ? ORDER BY is_default DESC, created_at ASC LIMIT 1'
    ).get(videoId, preferredLang.toLowerCase()) as any;
    if (row) {
      const cues = parseSubtitle(row.content, row.format);
      const tCues = buildFromRawCues(cues);
      const plain = cuesToPlainText(tCues);
      return {
        video_id: videoId,
        language: row.language,
        label: row.label,
        source: 'subtitle',
        cues: tCues,
        plain_text: plain,
        word_count: countWords(plain),
        duration,
      };
    }
  }

  // 2) Default subtitle
  const def = getDefaultSubtitle(videoId);
  if (def) {
    const cues = parseSubtitle(def.content, def.format);
    const tCues = buildFromRawCues(cues);
    const plain = cuesToPlainText(tCues);
    return {
      video_id: videoId,
      language: def.language,
      label: def.label,
      source: 'subtitle',
      cues: tCues,
      plain_text: plain,
      word_count: countWords(plain),
      duration,
    };
  }

  // 3) Chapters
  let segments = readChapters(videoId);
  let source: Transcript['source'] = 'chapters';
  if (segments.length === 0) {
    segments = parseTimestampedLines(meta.description);
    if (segments.length > 0) source = 'chapters';
  }

  if (segments.length > 0) {
    segments.sort((a, b) => a.start_seconds - b.start_seconds);
    const raw: SubtitleCue[] = [];
    for (let i = 0; i < segments.length; i++) {
      const cur = segments[i];
      const next = segments[i + 1];
      raw.push({
        start: cur.start_seconds,
        end: next ? next.start_seconds : (duration > 0 ? duration : cur.start_seconds + 5),
        text: cur.title,
      });
    }
    const tCues = buildFromRawCues(raw);
    const plain = cuesToPlainText(tCues);
    return {
      video_id: videoId,
      language: 'und',
      label: 'Auto (from chapters)',
      source: 'chapters',
      cues: tCues,
      plain_text: plain,
      word_count: countWords(plain),
      duration,
    };
  }

  // 4) Placeholder
  const text = meta.title ? `[${meta.title}]` : '[No transcript available]';
  const tCues: TranscriptCue[] = [{ index: 0, start: 0, end: duration || 5, text }];
  const plain = text;
  return {
    video_id: videoId,
    language: 'und',
    label: 'Placeholder',
    source: 'placeholder',
    cues: tCues,
    plain_text: plain,
    word_count: countWords(plain),
    duration,
  };
}

// ---------- 35.2 Searchable Transcript ----------

export interface TranscriptSearchHit {
  index: number;
  start: number;
  end: number;
  text: string;
  snippet: string;   // text with context + match markers
}

export function searchTranscript(
  videoId: string,
  query: string,
  lang?: string,
): { hits: TranscriptSearchHit[]; total: number; transcript: Transcript | null } {
  const t = getTranscript(videoId, lang);
  if (!t) return { hits: [], total: 0, transcript: null };
  const q = (query || '').trim();
  if (!q) return { hits: [], total: 0, transcript: t };

  const needle = q.toLowerCase();
  const hits: TranscriptSearchHit[] = [];
  for (const cue of t.cues) {
    const hay = cue.text.toLowerCase();
    const idx = hay.indexOf(needle);
    if (idx === -1) continue;
    const pre = cue.text.slice(Math.max(0, idx - 40), idx);
    const match = cue.text.slice(idx, idx + needle.length);
    const post = cue.text.slice(idx + needle.length, idx + needle.length + 40);
    hits.push({
      index: cue.index,
      start: cue.start,
      end: cue.end,
      text: cue.text,
      snippet: `${pre ? '…' + pre : ''}[[${match}]]${post ? post + '…' : ''}`,
    });
    if (hits.length >= 200) break;
  }
  return { hits, total: hits.length, transcript: t };
}

// ---------- 35.3 Downloadable Transcript ----------

function fmtSrtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function toSrt(cues: TranscriptCue[]): string {
  return cues.map((c, i) =>
    `${i + 1}\n${fmtSrtTime(c.start)} --> ${fmtSrtTime(c.end)}\n${c.text}\n`
  ).join('\n');
}

function toVtt(cues: TranscriptCue[]): string {
  const fmt = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = (s % 60).toFixed(3).padStart(6, '0');
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec}`;
  };
  const lines = ['WEBVTT', ''];
  for (const c of cues) {
    lines.push(`${fmt(c.start)} --> ${fmt(c.end)}`);
    lines.push(c.text);
    lines.push('');
  }
  return lines.join('\n');
}

function toTimestampedTxt(cues: TranscriptCue[]): string {
  return cues.map((c) => {
    const m = Math.floor(c.start / 60);
    const s = Math.floor(c.start % 60);
    return `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}] ${c.text}`;
  }).join('\n');
}

export function exportTranscript(
  videoId: string,
  format: 'txt' | 'srt' | 'vtt',
  lang?: string,
): { content: string; mime: string; filename: string } | null {
  const t = getTranscript(videoId, lang);
  if (!t) return null;
  const safeId = videoId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (format === 'srt') {
    return { content: toSrt(t.cues), mime: 'application/x-subrip; charset=utf-8', filename: `transcript-${safeId}.srt` };
  }
  if (format === 'vtt') {
    return { content: toVtt(t.cues), mime: 'text/vtt; charset=utf-8', filename: `transcript-${safeId}.vtt` };
  }
  return {
    content: `# Transcript — ${t.label} (${t.language})\n\n${toTimestampedTxt(t.cues)}\n`,
    mime: 'text/plain; charset=utf-8',
    filename: `transcript-${safeId}.txt`,
  };
}

// Available transcript languages (subtitle langs)
export function listTranscriptLanguages(videoId: string): { language: string; label: string }[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT DISTINCT language, label FROM video_subtitles WHERE video_id = ? ORDER BY is_default DESC, language ASC'
  ).all(videoId) as { language: string; label: string }[];
  return rows;
}
