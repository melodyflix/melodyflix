// melodyflix videos — Lightweight RSS/Atom parser (Section 37.7)
// No external deps — regex-based XML extraction for common feed formats.
// Works for BBC, CNN, Medium, Substack, YouTube RSS, generic RSS 2.0/Atom 1.0.
import { getDb } from '@melodyflix/shared-db';

export interface RssItem {
  guid: string | null;
  title: string;
  link: string | null;
  description: string | null;
  pubDate: string | null;
  author: string | null;
  category: string | null;
  enclosure_url: string | null;
  enclosure_type: string | null;
  image_url: string | null;
  content_type: 'article' | 'video' | 'audio' | 'podcast';
}

export interface RssFeed {
  title: string;
  link: string | null;
  description: string | null;
  language: string | null;
  image_url: string | null;
  items: RssItem[];
}

const DEFAULT_TIMEOUT_MS = 10000;
const USER_AGENT = 'Melodyflix/1.0 (+https://melodyflix.com; RSS fetcher)';
const MAX_ITEMS = 200;

// ============================================================
// Schema (cache feeds to avoid re-fetch)
// ============================================================

export function ensureRssParserSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS rss_feed_cache (
      url TEXT PRIMARY KEY,
      etag TEXT,
      last_modified TEXT,
      last_fetched_at TEXT NOT NULL,
      title TEXT,
      item_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

// ============================================================
// XML helpers — lightweight, no deps
// ============================================================

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function stripHtml(s: string | null): string | null {
  if (!s) return null;
  const cleaned = s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 5000) : null;
}

/** Extract the first tag content (CDATA-aware). */
function pickTag(xml: string, ...tags: string[]): string | null {
  for (const tag of tags) {
    // self-closing skip, match <tag>content</tag>
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const m = xml.match(re);
    if (m) return decodeEntities(m[1]).trim();
    // match with attributes + self-closing for links
    const re2 = new RegExp(`<${tag}[^>]*href=["']([^"']+)["']`, 'i');
    const m2 = xml.match(re2);
    if (m2) return decodeEntities(m2[1]).trim();
    // match self-closing <tag href="..."/> or <tag url="..."/>
    const re3 = new RegExp(`<${tag}[^>]*(?:url|href)=["']([^"']+)["']`, 'i');
    const m3 = xml.match(re3);
    if (m3) return decodeEntities(m3[1]).trim();
  }
  return null;
}

function parseDate(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function detectContentType(item: RssItem): RssItem['content_type'] {
  if (item.enclosure_type) {
    if (item.enclosure_type.startsWith('video/')) return 'video';
    if (item.enclosure_type.startsWith('audio/')) {
      // Podcast if title mentions podcast or has itunes namespace hints
      return 'podcast';
    }
  }
  if (item.enclosure_url) {
    if (/\.(mp4|webm|mkv|mov|m4v)$/i.test(item.enclosure_url)) return 'video';
    if (/\.(mp3|m4a|aac|ogg|wav)$/i.test(item.enclosure_url)) return 'podcast';
  }
  // YouTube / Vimeo links in description or link
  if (item.link && /(youtube\.com|youtu\.be|vimeo\.com)/i.test(item.link)) return 'video';
  return 'article';
}

// ============================================================
// RSS 2.0 / Atom 1.0 parser
// ============================================================

export function parseRssXml(xml: string): RssFeed {
  if (!xml || typeof xml !== 'string') throw new Error('Invalid XML input');

  // Strip xmlns attributes to simplify regex
  const cleaned = xml.replace(/xmlns(:\w+)?="[^"]*"/g, '');

  // Detect format
  const isAtom = /<feed[\s>]/i.test(cleaned.slice(0, 2000));

  // Channel (RSS) or Feed (Atom) level
  const channelMatch = cleaned.match(/<channel>([\s\S]*?)<\/channel>/i);
  const feedLevel = channelMatch ? channelMatch[1] : cleaned;

  const feedTitle = pickTag(feedLevel, 'title') ?? '';
  const feedLink = isAtom
    ? (feedLevel.match(/<link[^>]+rel=["']alternate["'][^>]+href=["']([^"']+)["']/i)?.[1]
       ?? feedLevel.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1]
       ?? null)
    : pickTag(feedLevel, 'link');
  const feedDesc = pickTag(feedLevel, 'description', 'subtitle');
  const feedLang = pickTag(feedLevel, 'language');
  const feedImage = pickTag(feedLevel, 'url', 'image') // <image><url>...</url></image>
    ?? pickTag(feedLevel, 'logo', 'icon');

  // Items: RSS uses <item>, Atom uses <entry>
  const itemTag = isAtom ? 'entry' : 'item';
  const itemRe = new RegExp(`<${itemTag}[\\s>][\\s\\S]*?<\\/${itemTag}>`, 'gi');
  const itemMatches = cleaned.match(itemRe) ?? [];

  const items: RssItem[] = [];
  for (const raw of itemMatches.slice(0, MAX_ITEMS)) {
    const guid = pickTag(raw, 'guid', 'id');
    const title = pickTag(raw, 'title') ?? 'Untitled';
    const link = isAtom
      ? (raw.match(/<link[^>]+rel=["']alternate["'][^>]+href=["']([^"']+)["']/i)?.[1]
         ?? raw.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1]
         ?? null)
      : pickTag(raw, 'link');
    const description = stripHtml(pickTag(raw, 'description', 'summary', 'content', 'content:encoded'));
    const pubDate = parseDate(pickTag(raw, 'pubDate', 'published', 'updated', 'dc:date'));
    const author = pickTag(raw, 'author', 'dc:creator', 'name');
    const category = pickTag(raw, 'category');

    // Enclosures (RSS 2.0)
    const encMatch = raw.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*?(?:type=["']([^"']+)["'])?[^>]*\/?>/i);
    const enclosure_url = encMatch ? decodeEntities(encMatch[1]) : null;
    const enclosure_type = encMatch?.[2] ?? null;

    // Media RSS content
    const mediaMatch = raw.match(/<media:content[^>]+url=["']([^"']+)["'][^>]*?(?:type=["']([^"']+)["'])?[^>]*\/?>/i);
    const mediaUrl = mediaMatch ? decodeEntities(mediaMatch[1]) : null;
    const mediaType = mediaMatch?.[2] ?? null;

    // Image from media:thumbnail or itunes:image
    const thumbMatch = raw.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
    const image_url = thumbMatch ? decodeEntities(thumbMatch[1]) : null;

    const item: RssItem = {
      guid: guid ?? link,
      title: title.slice(0, 300),
      link: link ? decodeEntities(link) : null,
      description,
      pubDate,
      author: author ? author.slice(0, 100) : null,
      category: category ? category.slice(0, 100) : null,
      enclosure_url: enclosure_url ?? mediaUrl,
      enclosure_type: enclosure_type ?? mediaType,
      image_url,
      content_type: 'article',
    };
    item.content_type = detectContentType(item);
    items.push(item);
  }

  return {
    title: feedTitle,
    link: feedLink ? decodeEntities(feedLink) : null,
    description: stripHtml(feedDesc),
    language: feedLang,
    image_url: feedImage,
    items,
  };
}

// ============================================================
// Fetch + parse
// ============================================================

export async function fetchRssFeed(url: string, opts: { timeout_ms?: number; use_cache_headers?: boolean } = {}): Promise<RssFeed> {
  if (!/^https?:\/\//i.test(url)) throw new Error('URL must be http(s)');

  const db = getDb();
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, 'Accept': 'application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.8' };

  if (opts.use_cache_headers) {
    const cached = db.prepare('SELECT etag, last_modified FROM rss_feed_cache WHERE url = ?')
      .get(url) as { etag: string | null; last_modified: string | null } | undefined;
    if (cached?.etag) headers['If-None-Match'] = cached.etag;
    if (cached?.last_modified) headers['If-Modified-Since'] = cached.last_modified;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeout_ms ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
    if (res.status === 304) {
      // Not modified — return empty (caller keeps existing items)
      return { title: '', link: url, description: null, language: null, image_url: null, items: [] };
    }
    if (!res.ok) throw new Error(`RSS fetch failed: ${res.status} ${res.statusText}`);
    const xml = await res.text();
    const feed = parseRssXml(xml);

    // Cache headers
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO rss_feed_cache (url, etag, last_modified, last_fetched_at, title, item_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET
        etag = excluded.etag, last_modified = excluded.last_modified,
        last_fetched_at = excluded.last_fetched_at, title = excluded.title,
        item_count = excluded.item_count, updated_at = excluded.updated_at
    `).run(
      url, res.headers.get('etag'), res.headers.get('last-modified'), now,
      feed.title, feed.items.length, now, now,
    );

    return feed;
  } finally {
    clearTimeout(timeout);
  }
}

export function getFeedCache(url: string): { title: string | null; last_fetched_at: string; item_count: number } | null {
  const row = getDb().prepare(
    'SELECT title, last_fetched_at, item_count FROM rss_feed_cache WHERE url = ?'
  ).get(url) as { title: string | null; last_fetched_at: string; item_count: number } | undefined;
  return row ?? null;
}
