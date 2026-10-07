// melodyflix videos - Section 15.7 Version Comparison
// Side-by-side metadata diff between two versions of the same parent
// video, plus timeline-level comparison of any provided descriptors.
import { getDb } from '@melodyflix/shared-db';

export interface VideoVersionRow {
  id: string;
  parent_video_id: string;
  version_video_id: string;
  owner_id: string;
  kind: string;
  label: string;
  description: string | null;
  is_default: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface FieldDiff {
  field: string;
  a: unknown;
  b: unknown;
  changed: boolean;
}

export interface VersionCompareResult {
  a: VideoVersionRow;
  b: VideoVersionRow;
  same_parent: boolean;
  field_diffs: FieldDiff[];
  changed_fields: string[];
  identical: boolean;
}

export interface TimelineDiffEntry {
  key: string; // clip id or index
  a: Record<string, unknown> | null;
  b: Record<string, unknown> | null;
  status: 'added' | 'removed' | 'changed' | 'unchanged';
  changes: string[];
}

export interface TimelineCompareResult {
  a_version_id: string;
  b_version_id: string;
  entries: TimelineDiffEntry[];
  summary: { added: number; removed: number; changed: number; unchanged: number };
}

function getVersionRow(id: string): VideoVersionRow | null {
  return (getDb().prepare('SELECT * FROM video_versions WHERE id = ?').get(id) as VideoVersionRow | undefined) ?? null;
}

const COMPARE_FIELDS: (keyof VideoVersionRow)[] = [
  'kind','label','description','is_default','sort_order',
];

export function compareVersions(aId: string, bId: string): VersionCompareResult {
  const a = getVersionRow(aId);
  const b = getVersionRow(bId);
  if (!a) throw new Error('version_a_not_found');
  if (!b) throw new Error('version_b_not_found');
  const diffs: FieldDiff[] = [];
  const changed: string[] = [];
  for (const f of COMPARE_FIELDS) {
    const va = (a as any)[f];
    const vb = (b as any)[f];
    const isChanged = JSON.stringify(va) !== JSON.stringify(vb);
    if (isChanged) changed.push(String(f));
    diffs.push({ field: String(f), a: va, b: vb, changed: isChanged });
  }
  return {
    a, b,
    same_parent: a.parent_video_id === b.parent_video_id,
    field_diffs: diffs,
    changed_fields: changed,
    identical: changed.length === 0 && a.version_video_id === b.version_video_id,
  };
}

export interface TimelineCompareInput {
  a_version_id: string;
  b_version_id: string;
  a_timeline?: Record<string, unknown>[];
  b_timeline?: Record<string, unknown>[];
  key_field?: string;
}

function indexBy(items: Record<string, unknown>[], keyField: string): Map<string, Record<string, unknown>> {
  const map = new Map();
  items.forEach((it, i) => {
    const k = String(it[keyField] ?? i);
    map.set(k, it);
  });
  return map;
}

export function compareTimelines(input: TimelineCompareInput): TimelineCompareResult {
  const keyField = input.key_field ?? 'id';
  const aItems = input.a_timeline ?? [];
  const bItems = input.b_timeline ?? [];
  const aIdx = indexBy(aItems, keyField);
  const bIdx = indexBy(bItems, keyField);
  const keys = new Set<string>([...aIdx.keys(), ...bIdx.keys()]);
  const entries: TimelineDiffEntry[] = [];
  const summary = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  for (const k of keys) {
    const a = aIdx.get(k) ?? null;
    const b = bIdx.get(k) ?? null;
    if (a && !b) { entries.push({ key: k, a, b: null, status: 'removed', changes: [] }); summary.removed++; continue; }
    if (!a && b) { entries.push({ key: k, a: null, b, status: 'added', changes: [] }); summary.added++; continue; }
    const changes: string[] = [];
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const fields = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
    for (const f of fields) {
      if (JSON.stringify(aObj[f]) !== JSON.stringify(bObj[f])) changes.push(f);
    }
    if (changes.length) { entries.push({ key: k, a, b, status: 'changed', changes }); summary.changed++; }
    else { entries.push({ key: k, a, b, status: 'unchanged', changes: [] }); summary.unchanged++; }
  }
  return {
    a_version_id: input.a_version_id,
    b_version_id: input.b_version_id,
    entries,
    summary,
  };
}

export interface VersionCompareStats {
  total_versions: number;
  parent_groups: number;
  avg_versions_per_group: number;
  multi_version_groups: number;
}

export function getVersionCompareStats(): VersionCompareStats {
  const db = getDb();
  const rows = db.prepare(`
    SELECT parent_video_id, COUNT(*) AS c FROM video_versions GROUP BY parent_video_id
  `).all() as { parent_video_id: string; c: number }[];
  const total = rows.reduce((s, r) => s + r.c, 0);
  const multi = rows.filter(r => r.c > 1).length;
  return {
    total_versions: total,
    parent_groups: rows.length,
    avg_versions_per_group: rows.length ? total / rows.length : 0,
    multi_version_groups: multi,
  };
}
