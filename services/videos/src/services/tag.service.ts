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
