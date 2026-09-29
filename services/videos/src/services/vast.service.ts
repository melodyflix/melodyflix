// melodyflix videos - VAST ad network integration
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export interface AdNetwork {
  id: string;
  name: string;
  vast_tag_url: string;
  type: 'pre-roll' | 'mid-roll' | 'post-roll';
  weight: number;
  active: number;
  priority: number;
  created_at: string;
  updated_at: string;
}

export function ensureAdNetworksSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ad_networks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      vast_tag_url TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'pre-roll',
      weight INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_adn_type ON ad_networks(type);
    CREATE INDEX IF NOT EXISTS idx_adn_active ON ad_networks(active);
  `);
}

// ---------- Admin CRUD ----------
export interface CreateAdNetworkInput {
  name: string;
  vast_tag_url: string;
  type?: 'pre-roll' | 'mid-roll' | 'post-roll';
  weight?: number;
  priority?: number;
}

export function createAdNetwork(input: CreateAdNetworkInput): AdNetwork {
  const db = getDb();
  const now = new Date().toISOString();
  const adn: AdNetwork = {
    id: randomUUID(),
    name: input.name.trim(),
    vast_tag_url: input.vast_tag_url.trim(),
    type: input.type ?? 'pre-roll',
    weight: input.weight ?? 1,
    active: 1,
    priority: input.priority ?? 0,
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO ad_networks (id, name, vast_tag_url, type, weight, active, priority, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(adn.id, adn.name, adn.vast_tag_url, adn.type, adn.weight, adn.active, adn.priority, adn.created_at, adn.updated_at);
  return adn;
}

export function listAdNetworks(): AdNetwork[] {
  const db = getDb();
  return db.prepare('SELECT * FROM ad_networks ORDER BY priority DESC, created_at DESC').all() as AdNetwork[];
}

export function getAdNetworkById(id: string): AdNetwork | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM ad_networks WHERE id = ?').get(id) as AdNetwork | undefined) ?? null;
}

export function updateAdNetwork(id: string, updates: Partial<CreateAdNetworkInput> & { active?: number }): AdNetwork {
  const db = getDb();
  const existing = getAdNetworkById(id);
  if (!existing) throw new Error('Ad network not found');
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE ad_networks SET name = ?, vast_tag_url = ?, type = ?, weight = ?, active = ?, priority = ?, updated_at = ?
    WHERE id = ?
  `).run(
    updates.name?.trim() || existing.name,
    updates.vast_tag_url?.trim() || existing.vast_tag_url,
    updates.type ?? existing.type,
    updates.weight ?? existing.weight,
    updates.active ?? existing.active,
    updates.priority ?? existing.priority,
    now,
    id
  );
  return getAdNetworkById(id)!;
}

export function deleteAdNetwork(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM ad_networks WHERE id = ?').run(id);
}

// ---------- Ad Selection (Mediation) ----------
export interface SelectedAd {
  source: 'internal' | 'external';
  vast_tag_url?: string;
  ad?: any; // internal ad object
  network_name?: string;
}

export function pickAdWithFallback(type: 'pre-roll' | 'mid-roll' | 'post-roll', internalAd: any): SelectedAd {
  const db = getDb();
  const networks = db.prepare(
    'SELECT * FROM ad_networks WHERE type = ? AND active = 1 ORDER BY priority DESC, weight DESC'
  ).all(type) as AdNetwork[];

  if (networks.length > 0) {
    // Priority + weighted pick
    const maxPriority = networks[0].priority;
    const topTier = networks.filter((n) => n.priority === maxPriority);
    const totalWeight = topTier.reduce((s, n) => s + n.weight, 0);
    let r = Math.random() * totalWeight;
    for (const n of topTier) {
      r -= n.weight;
      if (r <= 0) {
        return { source: 'external', vast_tag_url: n.vast_tag_url, network_name: n.name };
      }
    }
    return { source: 'external', vast_tag_url: topTier[0].vast_tag_url, network_name: topTier[0].name };
  }

  if (internalAd) {
    return { source: 'internal', ad: internalAd };
  }

  return { source: 'internal' };
}
