// melodyflix videos - content provider adapter registry
import type { ContentKind } from '../content-source.service.js';

export type ProviderId = string;
export type ProviderCapability = 'search' | 'fetch_list' | 'get_detail' | 'import';

export interface ProviderItem {
  external_id: string;
  title: string;
  description?: string | null;
  thumbnail_url?: string | null;
  stream_url?: string | null;
  duration_seconds?: number | null;
  content_kind?: ContentKind;
  language?: string | null;
  release_date?: string | null;
  raw?: Record<string, unknown>;
}

export interface ProviderValidation {
  ok: boolean;
  errors?: string[];
  warnings?: string[];
}

export interface ProviderHealth {
  ok: boolean;
  latency_ms?: number;
  message?: string;
}

export interface ProviderSearchOpts {
  limit?: number;
  page?: number;
  language?: string;
  kind?: ContentKind;
}

export interface ContentProvider {
  id: ProviderId;
  name: string;
  description?: string;
  capabilities: ProviderCapability[];
  validate(config: Record<string, unknown>): ProviderValidation;
  healthCheck(config: Record<string, unknown>): Promise<ProviderHealth>;
  search?(query: string, config: Record<string, unknown>, opts?: ProviderSearchOpts): Promise<ProviderItem[]>;
  fetchList?(config: Record<string, unknown>, opts?: ProviderSearchOpts): Promise<ProviderItem[]>;
  getDetail?(externalId: string, config: Record<string, unknown>): Promise<ProviderItem | null>;
}

const registry = new Map<ProviderId, ContentProvider>();

export function registerProvider(provider: ContentProvider): void {
  if (!provider.id) throw new Error('Provider id required');
  registry.set(provider.id, provider);
}

export function getProvider(id: ProviderId): ContentProvider | null {
  return registry.get(id) ?? null;
}

export function listProviders(): Array<{ id: ProviderId; name: string; description?: string; capabilities: ProviderCapability[] }> {
  return Array.from(registry.values()).map((p) => ({
    id: p.id, name: p.name, description: p.description, capabilities: p.capabilities,
  }));
}

export function unregisterProvider(id: ProviderId): boolean {
  return registry.delete(id);
}
