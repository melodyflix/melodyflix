// melodyflix videos - RSS/Atom provider adapter
import {
  registerProvider,
  type ContentProvider, type ProviderItem, type ProviderValidation,
  type ProviderHealth, type ProviderSearchOpts,
} from './index.js';
import type { ContentKind } from '../content-source.service.js';

export interface RssConfig {
  feed_url: string;
  content_kind?: ContentKind;
  timeout_ms?: number;
}

// ---------- Minimal RSS/Atom parser ----------

interface RawFeedItem {
  title: string;
  link: string;
  description: string | null;
  pubDate: string | null;
  guid: string | null;
  enclosure_url: string | null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function pickTag(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!m) return null;
  return decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim());
}

function pickAttr(block: string, tag: string, attr: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]+)"`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}

function parseFeed(xml: string): RawFeedItem[] {
  const items: RawFeedItem[] = [];
  const itemRe = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[2];
    const title = pickTag(block, 'title') ?? '(untitled)';
    const link = pickTag(block, 'link') ?? pickAttr(block, 'link', 'href') ?? '';
    const description = pickTag(block, 'description') ?? pickTag(block, 'summary') ?? pickTag(block, 'content');
    const pubDate = pickTag(block, 'pubDate') ?? pickTag(block, 'published') ?? pickTag(block, 'updated');
    const guid = pickTag(block, 'guid') ?? pickTag(block, 'id');
    const enclosureUrl = pickAttr(block, 'enclosure', 'url');
    items.push({ title, link, description, pubDate, guid, enclosure_url: enclosureUrl });
  }
  return items;
}

async function fetchXml(url: string, timeoutMs = 15_000): Promise<string> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/rss+xml, application/xml, text/xml' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function feedItemToProviderItem(item: RawFeedItem, kind: ContentKind | undefined): ProviderItem {
  return {
    external_id: item.guid ?? item.link,
    title: item.title,
    description: item.description,
    thumbnail_url: null,
    stream_url: item.enclosure_url ?? item.link,
    duration_seconds: null,
    language: null,
    release_date: item.pubDate,
    content_kind: kind,
    raw: item as unknown as Record<string, unknown>,
  };
}

export const rssProvider: ContentProvider = {
  id: 'rss',
  name: 'RSS / Atom Feed',
  description: 'Any RSS or Atom feed — news portals, blogs, podcasts.',
  capabilities: ['fetch_list', 'import'],

  validate(config): ProviderValidation {
    const cfg = config as RssConfig;
    const errors: string[] = [];
    if (!cfg.feed_url) errors.push('feed_url is required');
    else if (!/^https?:\/\//i.test(cfg.feed_url)) errors.push('feed_url must start with http(s)://');
    return { ok: errors.length === 0, errors: errors.length ? errors : undefined };
  },

  async healthCheck(config): Promise<ProviderHealth> {
    const cfg = config as RssConfig;
    const t0 = Date.now();
    try {
      const xml = await fetchXml(cfg.feed_url, cfg.timeout_ms);
      const items = parseFeed(xml);
      return { ok: items.length > 0, latency_ms: Date.now() - t0, message: `${items.length} items` };
    } catch (err) {
      return { ok: false, message: (err as Error).message, latency_ms: Date.now() - t0 };
    }
  },

  async fetchList(config, opts: ProviderSearchOpts = {}): Promise<ProviderItem[]> {
    const cfg = config as RssConfig;
    const xml = await fetchXml(cfg.feed_url, cfg.timeout_ms);
    const items = parseFeed(xml);
    return items.slice(0, opts.limit ?? 50).map((it) => feedItemToProviderItem(it, cfg.content_kind));
  },
};

registerProvider(rssProvider);
