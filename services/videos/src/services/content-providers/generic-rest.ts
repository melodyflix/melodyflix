// melodyflix videos - generic REST API provider
//
// Users register a config that points at ANY REST endpoint + JSONPath
// mappings; this adapter fetches, unwraps, and normalizes the payload.
// No code changes needed to add a new source.

import {
  registerProvider,
  type ContentProvider, type ProviderItem, type ProviderValidation,
  type ProviderHealth, type ProviderSearchOpts,
} from './index.js';
import type { ContentKind } from '../content-source.service.js';

export interface GenericRestConfig {
  // Either 'list_url' (catalog) or 'search_url' (with {query} placeholder)
  list_url?: string;
  search_url?: string;
  detail_url?: string;           // optional; may contain {id}
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: Record<string, unknown>;           // for POST
  // JSONPath-ish dot notation: e.g. 'data.items' or 'results'
  items_path?: string;
  // Field mappings on each item:
  field_map?: {
    external_id?: string;
    title?: string;
    description?: string;
    thumbnail_url?: string;
    stream_url?: string;
    duration_seconds?: string;
    language?: string;
    release_date?: string;
  };
  content_kind?: ContentKind;
  timeout_ms?: number;
}

function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

async function doFetch(cfg: GenericRestConfig, url: string, body?: Record<string, unknown>): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.timeout_ms ?? 15_000);
  try {
    const method = cfg.method ?? 'GET';
    const init: RequestInit = {
      method,
      headers: { 'Accept': 'application/json', ...(cfg.headers ?? {}) },
      signal: controller.signal,
    };
    if (method === 'POST') {
      (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body ?? cfg.body ?? {});
    }
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeItem(raw: Record<string, unknown>, cfg: GenericRestConfig): ProviderItem | null {
  const fm = cfg.field_map ?? {};
  const title = fm.title ? String(getPath(raw, fm.title) ?? '') : String(raw.title ?? '');
  if (!title) return null;
  const externalId = fm.external_id
    ? String(getPath(raw, fm.external_id) ?? '')
    : String(raw.id ?? raw.slug ?? title);
  return {
    external_id: externalId,
    title,
    description: fm.description ? (getPath(raw, fm.description) as string | undefined) ?? null : null,
    thumbnail_url: fm.thumbnail_url ? (getPath(raw, fm.thumbnail_url) as string | undefined) ?? null : null,
    stream_url: fm.stream_url ? (getPath(raw, fm.stream_url) as string | undefined) ?? null : null,
    duration_seconds: fm.duration_seconds ? Number(getPath(raw, fm.duration_seconds) ?? 0) || null : null,
    language: fm.language ? (getPath(raw, fm.language) as string | undefined) ?? null : null,
    release_date: fm.release_date ? (getPath(raw, fm.release_date) as string | undefined) ?? null : null,
    content_kind: cfg.content_kind,
    raw,
  };
}

export const genericRestProvider: ContentProvider = {
  id: 'generic-rest',
  name: 'Generic REST API',
  description: 'Any JSON REST endpoint. Configure URL + field mappings.',
  capabilities: ['fetch_list', 'search', 'get_detail', 'import'],

  validate(config): ProviderValidation {
    const cfg = config as GenericRestConfig;
    const errors: string[] = [];
    if (!cfg.list_url && !cfg.search_url) {
      errors.push('At least one of list_url or search_url is required');
    }
    const testUrl = cfg.list_url ?? cfg.search_url ?? '';
    if (testUrl && !/^https?:\/\//i.test(testUrl)) errors.push('URL must start with http(s)://');
    if (!cfg.items_path) errors.push('items_path is required (e.g. "data.items")');
    if (!cfg.field_map?.title) errors.push('field_map.title is required');
    return { ok: errors.length === 0, errors: errors.length ? errors : undefined };
  },

  async healthCheck(config): Promise<ProviderHealth> {
    const cfg = config as GenericRestConfig;
    const t0 = Date.now();
    try {
      const url = cfg.list_url ?? (cfg.search_url ?? '').replace('{query}', 'test');
      if (!url) return { ok: false, message: 'no url configured' };
      await doFetch(cfg, url);
      return { ok: true, latency_ms: Date.now() - t0 };
    } catch (err) {
      return { ok: false, message: (err as Error).message, latency_ms: Date.now() - t0 };
    }
  },

  async fetchList(config, opts: ProviderSearchOpts = {}): Promise<ProviderItem[]> {
    const cfg = config as GenericRestConfig;
    if (!cfg.list_url) throw new Error('list_url not configured');
    const limit = opts.limit ?? 50;
    const page = opts.page ?? 1;
    const url = cfg.list_url
      .replace('{limit}', String(limit))
      .replace('{page}', String(page));
    const json = await doFetch(cfg, url);
    const items = getPath(json, cfg.items_path ?? '');
    if (!Array.isArray(items)) return [];
    return items
      .map((it) => normalizeItem(it as Record<string, unknown>, cfg))
      .filter((i): i is ProviderItem => i !== null)
      .slice(0, limit);
  },

  async search(query, config, opts: ProviderSearchOpts = {}): Promise<ProviderItem[]> {
    const cfg = config as GenericRestConfig;
    if (!cfg.search_url) throw new Error('search_url not configured');
    const url = cfg.search_url.replace('{query}', encodeURIComponent(query));
    const json = await doFetch(cfg, url);
    const items = getPath(json, cfg.items_path ?? '');
    if (!Array.isArray(items)) return [];
    return items
      .map((it) => normalizeItem(it as Record<string, unknown>, cfg))
      .filter((i): i is ProviderItem => i !== null)
      .slice(0, opts.limit ?? 50);
  },

  async getDetail(externalId, config): Promise<ProviderItem | null> {
    const cfg = config as GenericRestConfig;
    if (!cfg.detail_url) return null;
    const url = cfg.detail_url.replace('{id}', encodeURIComponent(externalId));
    const json = await doFetch(cfg, url);
    const node = getPath(json, cfg.items_path ?? '') ?? json;
    if (!node || typeof node !== 'object') return null;
    return normalizeItem(node as Record<string, unknown>, cfg);
  },
};

registerProvider(genericRestProvider);
