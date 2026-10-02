// melodyflix videos - video tags & hashtags
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export interface VideoTag {
  id: string;
  video_id: string;
  tag: string;
  tag_normalized: string;
  source: 'manual' | 'hashtag' | 'auto';
  created_at: string;
}

export function ensureTagSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_tags (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      tag_normalized TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL,
      UNIQUE (video_id, tag_normalized)
    );
    CREATE INDEX IF NOT EXISTS idx_video_tags_video ON video_tags(video_id);
    CREATE INDEX IF NOT EXISTS idx_video_tags_normalized ON video_tags(tag_normalized);
  `);
}

function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-').slice(0, 50);
}

export function addTag(
  videoId: string,
  rawTag: string,
  source: 'manual' | 'hashtag' | 'auto' = 'manual',
): VideoTag {
  const tag = rawTag.trim().replace(/^#/, '');
  if (!tag) throw new Error('Empty tag');
  if (tag.length > 50) throw new Error('Tag too long (max 50)');
  const normalized = normalizeTag(rawTag);
  if (!normalized) throw new Error('Invalid tag');

  const db = getDb();
  // Already exists? return it
  const existing = db.prepare(
    'SELECT * FROM video_tags WHERE video_id = ? AND tag_normalized = ?'
  ).get(videoId, normalized) as VideoTag | undefined;
  if (existing) return existing;

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO video_tags (id, video_id, tag, tag_normalized, source, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, videoId, tag, normalized, source, now);

  return db.prepare('SELECT * FROM video_tags WHERE id = ?').get(id) as VideoTag;
}

export function removeTag(videoId: string, rawTag: string): boolean {
  const normalized = normalizeTag(rawTag);
  const db = getDb();
  const res = db.prepare('DELETE FROM video_tags WHERE video_id = ? AND tag_normalized = ?').run(videoId, normalized);
  return res.changes > 0;
}

export function listTagsForVideo(videoId: string): VideoTag[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM video_tags WHERE video_id = ? ORDER BY source ASC, tag ASC'
  ).all(videoId) as VideoTag[];
}

export function replaceManualTags(videoId: string, tags: string[]): VideoTag[] {
  const db = getDb();
  db.prepare("DELETE FROM video_tags WHERE video_id = ? AND source = 'manual'").run(videoId);
  const saved: VideoTag[] = [];
  for (const t of tags) {
    try {
      saved.push(addTag(videoId, t, 'manual'));
    } catch { /* skip invalid */ }
  }
  return saved;
}

export interface TagWithCount {
  tag: string;
  tag_normalized: string;
  video_count: number;
}

export function listVideoIdsByTag(rawTag: string, limit = 50): string[] {
  const normalized = normalizeTag(rawTag);
  if (!normalized) return [];
  const db = getDb();
  const rows = db.prepare(
    'SELECT video_id FROM video_tags WHERE tag_normalized = ? LIMIT ?'
  ).all(normalized, Math.max(1, Math.min(200, limit))) as { video_id: string }[];
  return rows.map((r) => r.video_id);
}

export function topTags(limit = 50): TagWithCount[] {
  const db = getDb();
  return db.prepare(
    'SELECT tag, tag_normalized, COUNT(*) as video_count ' +
    'FROM video_tags GROUP BY tag_normalized ORDER BY video_count DESC LIMIT ?'
  ).all(Math.max(1, Math.min(100, limit))) as TagWithCount[];
}

export function suggestTags(prefix: string, limit = 10): TagWithCount[] {
  const normalized = normalizeTag(prefix);
  if (!normalized) return [];
  const db = getDb();
  return db.prepare(
    "SELECT tag, tag_normalized, COUNT(*) as video_count " +
    "FROM video_tags WHERE tag_normalized LIKE ? GROUP BY tag_normalized " +
    "ORDER BY video_count DESC LIMIT ?"
  ).all(`${normalized}%`, Math.max(1, Math.min(20, limit))) as TagWithCount[];
}

// Parse hashtags from title/description text. Returns unique lowercase tags (without #)
export function extractHashtags(text: string | null | undefined): string[] {
  if (!text) return [];
  const set = new Set<string>();
  const re = /#([A-Za-z0-9_\u0980-\u09FF]{2,50})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    set.add(m[1].toLowerCase());
  }
  return Array.from(set);
}

export function syncHashtagsFromText(videoId: string, text: string | null | undefined): VideoTag[] {
  const tags = extractHashtags(text);
  const saved: VideoTag[] = [];
  for (const t of tags) {
    try {
      saved.push(addTag(videoId, t, 'hashtag'));
    } catch { /* skip */ }
  }
  return saved;
}

// ---------- 46.1 AI-Powered Auto-Tagging (heuristic NLP) ----------

// Common English + Bangla stopwords. Extendable.
const STOPWORDS = new Set<string>([
  // English
  'a','an','the','and','or','but','if','then','else','when','while','for','to','of','in','on','at','by','with','from','as','is','are','was','were','be','been','being','am','do','does','did','have','has','had','will','would','could','should','may','might','must','can','this','that','these','those','it','its','he','she','they','them','their','his','her','you','your','yours','i','me','my','we','us','our','not','no','yes','so','than','too','very','just','only','also','into','out','up','down','over','under','about','after','before','more','most','some','any','all','each','every','other','another','such','same','own','new','old','good','bad','one','two','three','get','got','make','made','use','used','using','video','videos','watch','channel','official','full','hd','new','tutorial','how','what','why','which','who','whom','where','when','official','please','subscribe','like','share','comment','comments','song','songs','music',
  // Bangla (common)
  'এবং','বা','কিন্তু','যদি','তাহলে','যখন','যেহেতু','জন্য','থেকে','দ্বারা','সাথে','হলো','হয়','হয়েছে','ছিল','ছিলেন','আমি','আমার','আমরা','তুমি','তোমার','সে','তার','তারা','এই','সেই','ওই','কি','কী','কেন','কোথায়','কিভাবে','কত','একটি','একটা','দুই','তিন','ভিডিও','চ্যানেল','নতুন','ভালো','খারাপ','দেখুন','সাবস্ক্রাইব','করুন','করেছি','করেছেন','আছে','নেই','সব','কিছু','অনেক','খুব','শুধু','আরো','আবার','মধ্যে','উপর','নিচে','পরে','আগে','সঙ্গে','মত','হিসাবে','হতে',
]);

function isStopword(w: string): boolean {
  return STOPWORDS.has(w) || w.length < 3;
}

// Tokenize: keep Unicode letters/digits (supports Bangla), lowercase
function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) as string[];
}

export interface AutoTagSuggestion {
  tag: string;
  score: number;
  source: 'title' | 'body' | 'phrase';
}

// Extract ranked keyword candidates from title + description
export function suggestAutoTags(
  title: string | null | undefined,
  description: string | null | undefined,
  max = 10,
): AutoTagSuggestion[] {
  const t = (title || '').trim();
  const d = (description || '').trim();

  const titleTokens = tokenize(t);
  const bodyTokens = tokenize(d);

  const scores = new Map<string, number>();
  const bump = (word: string, weight: number) => {
    if (isStopword(word)) return;
    scores.set(word, (scores.get(word) ?? 0) + weight);
  };

  // Title tokens: heavy weight
  for (const w of titleTokens) bump(w, 3);

  // Body tokens: light weight
  for (const w of bodyTokens) bump(w, 1);

  // Bigram phrases from title (only if both words non-stopword)
  const phrases: AutoTagSuggestion[] = [];
  for (let i = 0; i < titleTokens.length - 1; i++) {
    const a = titleTokens[i];
    const b = titleTokens[i + 1];
    if (isStopword(a) || isStopword(b)) continue;
    const phrase = `${a} ${b}`;
    phrases.push({ tag: phrase, score: 4, source: 'phrase' });
  }

  // Unigram candidates
  const unigrams: AutoTagSuggestion[] = [];
  for (const [word, score] of scores.entries()) {
    // Skip if the word is already inside any top phrase
    const isInsidePhrase = phrases.some((p) => p.tag.includes(word));
    if (isInsidePhrase && phrases.length < max / 2) continue;
    unigrams.push({
      tag: word,
      score,
      source: titleTokens.includes(word) ? 'title' : 'body',
    });
  }

  unigrams.sort((a, b) => b.score - a.score);
  phrases.sort((a, b) => b.score - a.score);

  // Merge: top phrases first, then unigrams
  const out: AutoTagSuggestion[] = [];
  const seen = new Set<string>();
  const take = (arr: AutoTagSuggestion[]) => {
    for (const s of arr) {
      if (out.length >= max) break;
      if (seen.has(s.tag)) continue;
      seen.add(s.tag);
      out.push(s);
    }
  };
  take(phrases);
  take(unigrams);

  return out;
}

// Run auto-tagging for a video and save with source='auto'
export function autoTagVideo(
  videoId: string,
  title: string | null | undefined,
  description: string | null | undefined,
  max = 10,
): VideoTag[] {
  const suggestions = suggestAutoTags(title, description, max);
  const saved: VideoTag[] = [];
  for (const s of suggestions) {
    try {
      saved.push(addTag(videoId, s.tag, 'auto'));
    } catch { /* skip */ }
  }
  return saved;
}

// Clear only auto tags for a video (so we can regenerate)
export function clearAutoTags(videoId: string): number {
  const db = getDb();
  const res = db.prepare("DELETE FROM video_tags WHERE video_id = ? AND source = 'auto'").run(videoId);
  return res.changes ?? 0;
}

// Re-run auto-tagging: clears previous auto tags, adds fresh
export function regenerateAutoTags(
  videoId: string,
  title: string | null | undefined,
  description: string | null | undefined,
  max = 10,
): VideoTag[] {
  clearAutoTags(videoId);
  return autoTagVideo(videoId, title, description, max);
}

