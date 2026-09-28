// melodyflix videos - lookup user info from auth service
import { createLogger } from '@melodyflix/shared-logger';

const logger = createLogger('userlookup');

const AUTH_URL = process.env.AUTH_SERVICE_URL ?? 'http://127.0.0.1:4001';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface PublicUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

const cache = new Map<string, { data: PublicUser; expiresAt: number }>();

function getCached(id: string): PublicUser | null {
  const entry = cache.get(id);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(id);
    return null;
  }
  return entry.data;
}

function setCache(user: PublicUser): void {
  cache.set(user.id, { data: user, expiresAt: Date.now() + CACHE_TTL_MS });
}

export async function batchLookupUsers(ids: string[]): Promise<Map<string, PublicUser>> {
  const result = new Map<string, PublicUser>();
  const missing: string[] = [];

  for (const id of ids) {
    const cached = getCached(id);
    if (cached) result.set(id, cached);
    else missing.push(id);
  }

  if (missing.length === 0) return result;

  try {
    const res = await fetch(`${AUTH_URL}/api/v1/auth/users/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: missing }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'batch lookup failed');
      return result;
    }
    const json = await res.json() as { success: boolean; data: { users: PublicUser[] } };
    if (json.success && Array.isArray(json.data.users)) {
      for (const u of json.data.users) {
        result.set(u.id, u);
        setCache(u);
      }
    }
  } catch (err) {
    logger.error({ err }, 'batch lookup error');
  }

  return result;
}

export function getFallbackUser(id: string): PublicUser {
  return {
    id,
    username: `user_${id.slice(0, 6)}`,
    display_name: null,
    avatar_url: null,
  };
}
