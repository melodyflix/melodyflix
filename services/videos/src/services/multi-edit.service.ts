// melodyflix videos - Section 15.5 Multi-User Video Editing
// Concurrent editing sessions: projects, members, timeline clips,
// append-only operation log, per-project and per-clip locks, presence.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type ProjectStatus = 'draft' | 'editing' | 'review' | 'locked' | 'archived';
export type MemberRole = 'owner' | 'editor' | 'reviewer' | 'viewer';
export type ClipKind = 'video' | 'audio' | 'text' | 'overlay' | 'image';
export type OperationType =
  | 'add_clip' | 'move_clip' | 'resize_clip' | 'delete_clip'
  | 'set_clip_prop' | 'lock_clip' | 'unlock_clip' | 'lock_project' | 'unlock_project';

const P_STATUSES: ProjectStatus[] = ['draft','editing','review','locked','archived'];
const M_ROLES: MemberRole[] = ['owner','editor','reviewer','viewer'];
const CLIP_KINDS: ClipKind[] = ['video','audio','text','overlay','image'];
const OPS: OperationType[] = [
  'add_clip','move_clip','resize_clip','delete_clip','set_clip_prop',
  'lock_clip','unlock_clip','lock_project','unlock_project',
];

export function ensureMultiEditSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS edit_projects (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      current_revision INTEGER NOT NULL DEFAULT 0,
      lock_holder_id TEXT,
      lock_acquired_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_edit_proj_owner ON edit_projects(owner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_edit_proj_video ON edit_projects(video_id);

    CREATE TABLE IF NOT EXISTS edit_project_members (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'editor',
      can_edit INTEGER NOT NULL DEFAULT 1,
      can_comment INTEGER NOT NULL DEFAULT 1,
      joined_at TEXT NOT NULL,
      UNIQUE (project_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_edit_member_user ON edit_project_members(user_id, joined_at DESC);

    CREATE TABLE IF NOT EXISTS edit_project_clips (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      track_index INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL DEFAULT 'video',
      start_ms INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      z_index INTEGER NOT NULL DEFAULT 0,
      source_url TEXT,
      properties TEXT NOT NULL DEFAULT '{}',
      locked_by TEXT,
      locked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_edit_clip_project ON edit_project_clips(project_id, track_index, start_ms);

    CREATE TABLE IF NOT EXISTS edit_project_operations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      op_type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_edit_op_project ON edit_project_operations(project_id, revision DESC);

    CREATE TABLE IF NOT EXISTS edit_project_cursors (
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      position_ms INTEGER NOT NULL DEFAULT 0,
      track_index INTEGER,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_edit_cursor_project ON edit_project_cursors(project_id, updated_at DESC);
  `);
}

export interface EditProject {
  id: string;
  video_id: string;
  owner_id: string;
  title: string;
  status: ProjectStatus;
  current_revision: number;
  lock_holder_id: string | null;
  lock_acquired_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EditMember {
  id: string;
  project_id: string;
  user_id: string;
  role: MemberRole;
  can_edit: number;
  can_comment: number;
  joined_at: string;
}

export interface EditClip {
  id: string;
  project_id: string;
  track_index: number;
  kind: ClipKind;
  start_ms: number;
  duration_ms: number;
  z_index: number;
  source_url: string | null;
  properties: string;
  locked_by: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EditOperation {
  id: string;
  project_id: string;
  actor_id: string;
  op_type: OperationType;
  payload: string;
  revision: number;
  created_at: string;
}

export interface EditCursor {
  project_id: string;
  user_id: string;
  position_ms: number;
  track_index: number | null;
  updated_at: string;
}

// ---------- helpers ----------
function getMember(projectId: string, userId: string): EditMember | null {
  return (getDb().prepare('SELECT * FROM edit_project_members WHERE project_id = ? AND user_id = ?')
    .get(projectId, userId) as EditMember | undefined) ?? null;
}

function canEdit(projectId: string, userId: string): boolean {
  const m = getMember(projectId, userId);
  if (!m) return false;
  if (m.role === 'owner' || m.role === 'editor') return m.can_edit === 1;
  return false;
}

function nextRevision(projectId: string): number {
  const db = getDb();
  const p = getProject(projectId);
  if (!p) throw new Error('project_not_found');
  const rev = p.current_revision + 1;
  db.prepare('UPDATE edit_projects SET current_revision = ?, updated_at = ? WHERE id = ?')
    .run(rev, new Date().toISOString(), projectId);
  return rev;
}

function logOperation(projectId: string, actorId: string, op: OperationType, payload: Record<string, unknown>): EditOperation {
  if (!OPS.includes(op)) throw new Error('invalid_op');
  const rev = nextRevision(projectId);
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO edit_project_operations (id, project_id, actor_id, op_type, payload, revision, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, projectId, actorId, op, JSON.stringify(payload), rev, now);
  return db.prepare('SELECT * FROM edit_project_operations WHERE id = ?').get(id) as EditOperation;
}

// ---------- projects ----------
export interface CreateProjectInput {
  video_id: string;
  owner_id: string;
  title: string;
}

export function createProject(input: CreateProjectInput): EditProject {
  if (!input.video_id) throw new Error('video_required');
  if (!input.owner_id) throw new Error('owner_required');
  if (!input.title || input.title.length > 200) throw new Error('invalid_title');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO edit_projects (id, video_id, owner_id, title, status, current_revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'draft', 0, ?, ?)
  `).run(id, input.video_id, input.owner_id, input.title, now, now);
  db.prepare(`
    INSERT INTO edit_project_members (id, project_id, user_id, role, can_edit, can_comment, joined_at)
    VALUES (?, ?, ?, 'owner', 1, 1, ?)
  `).run(randomUUID(), id, input.owner_id, now);
  return getProject(id)!;
}

export function getProject(id: string): EditProject | null {
  return (getDb().prepare('SELECT * FROM edit_projects WHERE id = ?').get(id) as EditProject | undefined) ?? null;
}

export function listProjects(filter?: { owner_id?: string; video_id?: string; status?: ProjectStatus; limit?: number }): EditProject[] {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (filter?.owner_id) { where.push('owner_id = ?'); args.push(filter.owner_id); }
  if (filter?.video_id) { where.push('video_id = ?'); args.push(filter.video_id); }
  if (filter?.status) { where.push('status = ?'); args.push(filter.status); }
  const sql = `SELECT * FROM edit_projects ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY updated_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args) as EditProject[];
}

export function listUserProjects(userId: string, limit = 100): EditProject[] {
  return getDb().prepare(`
    SELECT p.* FROM edit_projects p
    JOIN edit_project_members m ON m.project_id = p.id
    WHERE m.user_id = ?
    ORDER BY p.updated_at DESC LIMIT ?
  `).all(userId, Math.min(Math.max(limit, 1), 500)) as EditProject[];
}

export function updateProject(id: string, actorId: string, patch: { title?: string; status?: ProjectStatus }): EditProject | null {
  const p = getProject(id);
  if (!p) return null;
  if (p.owner_id !== actorId) throw new Error('owner_only');
  const fields: string[] = [];
  const args: any[] = [];
  if (patch.title !== undefined) { if (patch.title.length > 200) throw new Error('invalid_title'); fields.push('title = ?'); args.push(patch.title); }
  if (patch.status !== undefined) { if (!P_STATUSES.includes(patch.status)) throw new Error('invalid_status'); fields.push('status = ?'); args.push(patch.status); }
  if (!fields.length) return p;
  fields.push('updated_at = ?'); args.push(new Date().toISOString());
  args.push(id);
  getDb().prepare(`UPDATE edit_projects SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  return getProject(id);
}

export function deleteProject(id: string, actorId: string): boolean {
  const p = getProject(id);
  if (!p) return false;
  if (p.owner_id !== actorId) throw new Error('owner_only');
  const db = getDb();
  db.prepare('DELETE FROM edit_project_clips WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM edit_project_operations WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM edit_project_members WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM edit_project_cursors WHERE project_id = ?').run(id);
  return db.prepare('DELETE FROM edit_projects WHERE id = ?').run(id).changes > 0;
}

// ---------- members ----------
export interface AddMemberInput {
  project_id: string;
  user_id: string;
  role?: MemberRole;
  can_edit?: boolean;
  can_comment?: boolean;
}

export function addMember(actorId: string, input: AddMemberInput): EditMember {
  const p = getProject(input.project_id);
  if (!p) throw new Error('project_not_found');
  if (p.owner_id !== actorId) throw new Error('owner_only');
  const role = input.role ?? 'editor';
  if (!M_ROLES.includes(role) || role === 'owner') throw new Error('invalid_role');
  const db = getDb();
  const now = new Date().toISOString();
  const existing = getMember(input.project_id, input.user_id);
  if (existing) {
    db.prepare('UPDATE edit_project_members SET role = ?, can_edit = ?, can_comment = ? WHERE id = ?')
      .run(role, input.can_edit === undefined ? existing.can_edit : (input.can_edit ? 1 : 0),
        input.can_comment === undefined ? existing.can_comment : (input.can_comment ? 1 : 0),
        existing.id);
    return getMember(input.project_id, input.user_id)!;
  }
  const id = randomUUID();
  db.prepare(`
    INSERT INTO edit_project_members (id, project_id, user_id, role, can_edit, can_comment, joined_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.project_id, input.user_id, role,
    input.can_edit === false ? 0 : 1,
    input.can_comment === false ? 0 : 1,
    now);
  return getMember(input.project_id, input.user_id)!;
}

export function removeMember(projectId: string, actorId: string, userId: string): boolean {
  const p = getProject(projectId);
  if (!p) return false;
  if (p.owner_id !== actorId) throw new Error('owner_only');
  if (userId === p.owner_id) throw new Error('cannot_remove_owner');
  return getDb().prepare('DELETE FROM edit_project_members WHERE project_id = ? AND user_id = ?')
    .run(projectId, userId).changes > 0;
}

export function listMembers(projectId: string): EditMember[] {
  return getDb().prepare('SELECT * FROM edit_project_members WHERE project_id = ? ORDER BY joined_at')
    .all(projectId) as EditMember[];
}

// ---------- project lock ----------
export function acquireLock(projectId: string, userId: string): EditProject {
  const p = getProject(projectId);
  if (!p) throw new Error('project_not_found');
  if (!canEdit(projectId, userId)) throw new Error('no_permission');
  if (p.lock_holder_id && p.lock_holder_id !== userId) throw new Error('locked_by_other');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare('UPDATE edit_projects SET lock_holder_id = ?, lock_acquired_at = ?, updated_at = ? WHERE id = ?')
    .run(userId, now, now, projectId);
  logOperation(projectId, userId, 'lock_project', {});
  return getProject(projectId)!;
}

export function releaseLock(projectId: string, userId: string): EditProject {
  const p = getProject(projectId);
  if (!p) throw new Error('project_not_found');
  if (p.lock_holder_id && p.lock_holder_id !== userId) throw new Error('not_lock_holder');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare('UPDATE edit_projects SET lock_holder_id = NULL, lock_acquired_at = NULL, updated_at = ? WHERE id = ?')
    .run(now, projectId);
  logOperation(projectId, userId, 'unlock_project', {});
  return getProject(projectId)!;
}

// ---------- clips ----------
export interface AddClipInput {
  project_id: string;
  kind?: ClipKind;
  track_index?: number;
  start_ms?: number;
  duration_ms?: number;
  z_index?: number;
  source_url?: string | null;
  properties?: Record<string, unknown>;
}

export function addClip(actorId: string, input: AddClipInput): EditClip {
  const p = getProject(input.project_id);
  if (!p) throw new Error('project_not_found');
  if (!canEdit(input.project_id, actorId)) throw new Error('no_permission');
  const kind = input.kind ?? 'video';
  if (!CLIP_KINDS.includes(kind)) throw new Error('invalid_kind');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO edit_project_clips
      (id, project_id, track_index, kind, start_ms, duration_ms, z_index, source_url, properties, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.project_id, input.track_index ?? 0, kind,
    input.start_ms ?? 0, input.duration_ms ?? 0, input.z_index ?? 0,
    input.source_url ?? null, JSON.stringify(input.properties ?? {}), now, now);
  logOperation(input.project_id, actorId, 'add_clip', { clip_id: id, kind, start_ms: input.start_ms ?? 0 });
  return getClip(id)!;
}

export function getClip(id: string): EditClip | null {
  return (getDb().prepare('SELECT * FROM edit_project_clips WHERE id = ?').get(id) as EditClip | undefined) ?? null;
}

export function listClips(projectId: string, trackIndex?: number): EditClip[] {
  const db = getDb();
  if (trackIndex !== undefined) {
    return db.prepare('SELECT * FROM edit_project_clips WHERE project_id = ? AND track_index = ? ORDER BY start_ms')
      .all(projectId, trackIndex) as EditClip[];
  }
  return db.prepare('SELECT * FROM edit_project_clips WHERE project_id = ? ORDER BY track_index, start_ms')
    .all(projectId) as EditClip[];
}

function assertClipEditable(clip: EditClip, actorId: string): void {
  if (clip.locked_by && clip.locked_by !== actorId) throw new Error('clip_locked_by_other');
  if (!canEdit(clip.project_id, actorId)) throw new Error('no_permission');
}

export function moveClip(clipId: string, actorId: string, newStartMs: number, newTrackIndex?: number): EditClip {
  if (newStartMs < 0) throw new Error('invalid_start');
  const c = getClip(clipId);
  if (!c) throw new Error('clip_not_found');
  assertClipEditable(c, actorId);
  const track = newTrackIndex ?? c.track_index;
  const now = new Date().toISOString();
  getDb().prepare('UPDATE edit_project_clips SET start_ms = ?, track_index = ?, updated_at = ? WHERE id = ?')
    .run(newStartMs, track, now, clipId);
  logOperation(c.project_id, actorId, 'move_clip', { clip_id: clipId, from: c.start_ms, to: newStartMs, track });
  return getClip(clipId)!;
}

export function resizeClip(clipId: string, actorId: string, newDurationMs: number): EditClip {
  if (newDurationMs < 1) throw new Error('invalid_duration');
  const c = getClip(clipId);
  if (!c) throw new Error('clip_not_found');
  assertClipEditable(c, actorId);
  const now = new Date().toISOString();
  getDb().prepare('UPDATE edit_project_clips SET duration_ms = ?, updated_at = ? WHERE id = ?')
    .run(newDurationMs, now, clipId);
  logOperation(c.project_id, actorId, 'resize_clip', { clip_id: clipId, from: c.duration_ms, to: newDurationMs });
  return getClip(clipId)!;
}

export function updateClipProps(clipId: string, actorId: string, patch: Record<string, unknown>): EditClip {
  const c = getClip(clipId);
  if (!c) throw new Error('clip_not_found');
  assertClipEditable(c, actorId);
  const props = { ...JSON.parse(c.properties), ...patch };
  const now = new Date().toISOString();
  getDb().prepare('UPDATE edit_project_clips SET properties = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(props), now, clipId);
  logOperation(c.project_id, actorId, 'set_clip_prop', { clip_id: clipId, patch });
  return getClip(clipId)!;
}

export function deleteClip(clipId: string, actorId: string): boolean {
  const c = getClip(clipId);
  if (!c) return false;
  assertClipEditable(c, actorId);
  const ok = getDb().prepare('DELETE FROM edit_project_clips WHERE id = ?').run(clipId).changes > 0;
  if (ok) logOperation(c.project_id, actorId, 'delete_clip', { clip_id: clipId });
  return ok;
}

// ---------- clip lock ----------
export function lockClip(clipId: string, userId: string): EditClip {
  const c = getClip(clipId);
  if (!c) throw new Error('clip_not_found');
  if (!canEdit(c.project_id, userId)) throw new Error('no_permission');
  if (c.locked_by && c.locked_by !== userId) throw new Error('locked_by_other');
  const now = new Date().toISOString();
  getDb().prepare('UPDATE edit_project_clips SET locked_by = ?, locked_at = ?, updated_at = ? WHERE id = ?')
    .run(userId, now, now, clipId);
  logOperation(c.project_id, userId, 'lock_clip', { clip_id: clipId });
  return getClip(clipId)!;
}

export function unlockClip(clipId: string, userId: string): EditClip {
  const c = getClip(clipId);
  if (!c) throw new Error('clip_not_found');
  if (c.locked_by && c.locked_by !== userId) throw new Error('not_lock_holder');
  const now = new Date().toISOString();
  getDb().prepare('UPDATE edit_project_clips SET locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ?')
    .run(now, clipId);
  logOperation(c.project_id, userId, 'unlock_clip', { clip_id: clipId });
  return getClip(clipId)!;
}

// ---------- operations (sync) ----------
export function listOperations(projectId: string, sinceRevision = 0, limit = 200): EditOperation[] {
  return getDb().prepare(`
    SELECT * FROM edit_project_operations
    WHERE project_id = ? AND revision > ?
    ORDER BY revision ASC LIMIT ?
  `).all(projectId, sinceRevision, Math.min(Math.max(limit, 1), 1000)) as EditOperation[];
}

// ---------- cursors ----------
export function updateCursor(projectId: string, userId: string, positionMs: number, trackIndex?: number): EditCursor {
  if (positionMs < 0) throw new Error('invalid_position');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO edit_project_cursors (project_id, user_id, position_ms, track_index, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(project_id, user_id) DO UPDATE SET
      position_ms = excluded.position_ms,
      track_index = excluded.track_index,
      updated_at = excluded.updated_at
  `).run(projectId, userId, positionMs, trackIndex ?? null, now);
  return db.prepare('SELECT * FROM edit_project_cursors WHERE project_id = ? AND user_id = ?')
    .get(projectId, userId) as EditCursor;
}

export function listCursors(projectId: string, onlineWithinSeconds = 30): EditCursor[] {
  const cutoff = new Date(Date.now() - onlineWithinSeconds * 1000).toISOString();
  return getDb().prepare(`
    SELECT * FROM edit_project_cursors WHERE project_id = ? AND updated_at >= ?
    ORDER BY updated_at DESC
  `).all(projectId, cutoff) as EditCursor[];
}

// ---------- summary + stats ----------
export interface ProjectSummary {
  project: EditProject;
  members_count: number;
  clips_count: number;
  active_locks: number;
  online_editors: number;
}

export function getProjectSummary(projectId: string): ProjectSummary | null {
  const p = getProject(projectId);
  if (!p) return null;
  const db = getDb();
  const m = db.prepare('SELECT COUNT(*) AS c FROM edit_project_members WHERE project_id = ?').get(projectId) as { c: number };
  const c = db.prepare('SELECT COUNT(*) AS c FROM edit_project_clips WHERE project_id = ?').get(projectId) as { c: number };
  const l = db.prepare('SELECT COUNT(*) AS c FROM edit_project_clips WHERE project_id = ? AND locked_by IS NOT NULL').get(projectId) as { c: number };
  const online = listCursors(projectId, 30).length;
  return {
    project: p,
    members_count: m.c,
    clips_count: c.c,
    active_locks: l.c,
    online_editors: online,
  };
}

export interface MultiEditStats {
  total_projects: number;
  by_status: Record<string, number>;
  total_members: number;
  total_clips: number;
  total_operations: number;
  currently_locked_projects: number;
  currently_locked_clips: number;
  by_clip_kind: Record<string, number>;
}

export function getMultiEditStats(): MultiEditStats {
  const db = getDb();
  const projects = db.prepare('SELECT status, lock_holder_id FROM edit_projects').all() as
    { status: string; lock_holder_id: string | null }[];
  const byStatus: Record<string, number> = {};
  let lockedProj = 0;
  for (const p of projects) {
    byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
    if (p.lock_holder_id) lockedProj++;
  }
  const members = db.prepare('SELECT COUNT(*) AS c FROM edit_project_members').get() as { c: number };
  const clips = db.prepare('SELECT COUNT(*) AS c FROM edit_project_clips').get() as { c: number };
  const lockedClips = db.prepare('SELECT COUNT(*) AS c FROM edit_project_clips WHERE locked_by IS NOT NULL').get() as { c: number };
  const ops = db.prepare('SELECT COUNT(*) AS c FROM edit_project_operations').get() as { c: number };
  const byKind = db.prepare('SELECT kind, COUNT(*) AS c FROM edit_project_clips GROUP BY kind').all() as
    { kind: string; c: number }[];
  const kindsMap: Record<string, number> = {};
  for (const k of byKind) kindsMap[k.kind] = k.c;
  return {
    total_projects: projects.length,
    by_status: byStatus,
    total_members: members.c,
    total_clips: clips.c,
    total_operations: ops.c,
    currently_locked_projects: lockedProj,
    currently_locked_clips: lockedClips.c,
    by_clip_kind: kindsMap,
  };
}
