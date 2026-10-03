// melodyflix videos — Video Version Management (Section 41)
// Provides alternative cuts of the same content:
// Director's Cut, Extended, Theatrical, and custom editions.

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type VersionKind =
  | 'original'
  | 'directors_cut'
  | 'extended'
  | 'theatrical'
  | 'theatrical_cut'
  | 'unrated'
  | 'remastered'
  | 'custom';

export interface VideoVersion {
  id: string;
  parent_video_id: string;
  version_video_id: string;
  owner_id: string;
  kind: VersionKind;
  label: string;
  description: string | null;
  is_default: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export function ensureVersionsSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_versions (
      id TEXT PRIMARY KEY,
      parent_video_id TEXT NOT NULL,
      version_video_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'custom'
        CHECK (kind IN ('original','directors_cut','extended','theatrical','theatrical_cut','unrated','remastered','custom')),
      label TEXT NOT NULL,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (parent_video_id, version_video_id),
      UNIQUE (version_video_id)
    );
    CREATE INDEX IF NOT EXISTS idx_versions_parent ON video_versions(parent_video_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_versions_owner  ON video_versions(owner_id);
  `);
}

function assertVideoOwnedBy(videoId: string, ownerId: string): { id: string; owner_id: string } {
  const db = getDb();
  const row = db.prepare('SELECT id, owner_id FROM videos WHERE id = ?').get(videoId) as
    | { id: string; owner_id: string }
    | undefined;
  if (!row) throw new Error('Video not found');
  if (row.owner_id !== ownerId) throw new Error('Not your video');
  return row;
}

export interface AttachVersionInput {
  parent_video_id: string;
  version_video_id: string;
  owner_id: string;
  kind?: VersionKind;
  label: string;
  description?: string | null;
  is_default?: boolean;
  sort_order?: number;
}

export function attachVersion(input: AttachVersionInput): VideoVersion {
  if (input.parent_video_id === input.version_video_id) {
    throw new Error('A video cannot be a version of itself');
  }
  if (!input.label?.trim()) throw new Error('Label required');

  // Both videos must be owned by the same user
  assertVideoOwnedBy(input.parent_video_id, input.owner_id);
  assertVideoOwnedBy(input.version_video_id, input.owner_id);

  const db = getDb();

  // Guard against cyclic relationships (A → B and B → A)
  const cycle = db.prepare(`
    SELECT 1 FROM video_versions
    WHERE parent_video_id = ? AND version_video_id = ?
    LIMIT 1
  `).get(input.version_video_id, input.parent_video_id);
  if (cycle) throw new Error('Cyclic version relationship detected');

  const now = new Date().toISOString();
  const id = randomUUID();
  const isDefault = input.is_default ? 1 : 0;

  db.exec('BEGIN');
  try {
    if (isDefault) {
      // Only one default per parent
      db.prepare(
        'UPDATE video_versions SET is_default = 0, updated_at = ? WHERE parent_video_id = ?'
      ).run(now, input.parent_video_id);
    }

    db.prepare(`
      INSERT INTO video_versions
        (id, parent_video_id, version_video_id, owner_id, kind, label, description,
         is_default, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.parent_video_id, input.version_video_id, input.owner_id,
      input.kind ?? 'custom', input.label.slice(0, 200),
      input.description ?? null, isDefault, input.sort_order ?? 0, now, now
    );

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return getVersion(id)!;
}

export function getVersion(id: string): VideoVersion | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM video_versions WHERE id = ?')
    .get(id) as VideoVersion | undefined;
  return row ?? null;
}

export interface ListVersionsOptions {
  include_parent?: boolean;
  limit?: number;
}

export function listVersions(parentVideoId: string, opts: ListVersionsOptions = {}): VideoVersion[] {
  const db = getDb();
  const n = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  return db.prepare(`
    SELECT * FROM video_versions
    WHERE parent_video_id = ?
    ORDER BY is_default DESC, sort_order ASC, created_at ASC
    LIMIT ?
  `).all(parentVideoId, n) as VideoVersion[];
}

export function getDefaultVersion(parentVideoId: string): VideoVersion | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM video_versions
    WHERE parent_video_id = ? AND is_default = 1
    LIMIT 1
  `).get(parentVideoId) as VideoVersion | undefined;
  return row ?? null;
}

export interface UpdateVersionInput {
  label?: string;
  kind?: VersionKind;
  description?: string | null;
  is_default?: boolean;
  sort_order?: number;
}

export function updateVersion(id: string, ownerId: string, patch: UpdateVersionInput): VideoVersion | null {
  const v = getVersion(id);
  if (!v) return null;
  if (v.owner_id !== ownerId) throw new Error('Not your version');

  const db = getDb();
  const now = new Date().toISOString();
  const fields: string[] = [];
  const values: any[] = [];

  const map: Record<string, any> = {
    label: patch.label,
    kind: patch.kind,
    description: patch.description,
    sort_order: patch.sort_order,
  };

  db.exec('BEGIN');
  try {
    if (patch.is_default === true) {
      db.prepare(
        'UPDATE video_versions SET is_default = 0, updated_at = ? WHERE parent_video_id = ?'
      ).run(now, v.parent_video_id);
      fields.push('is_default = ?');
      values.push(1);
    } else if (patch.is_default === false) {
      fields.push('is_default = ?');
      values.push(0);
    }

    for (const [k, val] of Object.entries(map)) {
      if (val === undefined) continue;
      fields.push(`${k} = ?`);
      values.push(val);
    }

    if (fields.length === 0) {
      db.exec('COMMIT');
      return v;
    }

    fields.push('updated_at = ?');
    values.push(now);
    values.push(id);
    db.prepare(`UPDATE video_versions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return getVersion(id);
}

export function detachVersion(id: string, ownerId: string): boolean {
  const v = getVersion(id);
  if (!v) return false;
  if (v.owner_id !== ownerId) throw new Error('Not your version');
  return getDb().prepare('DELETE FROM video_versions WHERE id = ?').run(id).changes > 0;
}

// Given a video_id, resolve the "entry point":
// If it's a version, return its parent; otherwise return itself.
export function resolveParent(videoId: string): string {
  const db = getDb();
  const row = db.prepare(
    'SELECT parent_video_id FROM video_versions WHERE version_video_id = ?'
  ).get(videoId) as { parent_video_id: string } | undefined;
  return row?.parent_video_id ?? videoId;
}

export interface VersionGroupSummary {
  parent_video_id: string;
  version_count: number;
  kinds: { kind: VersionKind; count: number }[];
  default_version_id: string | null;
}

export function summarizeVersionGroup(parentVideoId: string): VersionGroupSummary {
  const db = getDb();
  const versions = listVersions(parentVideoId);
  const counts = new Map<VersionKind, number>();
  for (const v of versions) counts.set(v.kind, (counts.get(v.kind) ?? 0) + 1);
  return {
    parent_video_id: parentVideoId,
    version_count: versions.length,
    kinds: Array.from(counts.entries()).map(([kind, count]) => ({ kind, count })),
    default_version_id: versions.find((v) => v.is_default === 1)?.version_video_id ?? null,
  };
}

// Swap default to the original parent video (i.e. "no version" default)
export function clearDefault(parentVideoId: string, ownerId: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  const parent = assertVideoOwnedBy(parentVideoId, ownerId);
  if (!parent) return;
  db.prepare(`
    UPDATE video_versions
    SET is_default = 0, updated_at = ?
    WHERE parent_video_id = ?
  `).run(now, parentVideoId);
}
