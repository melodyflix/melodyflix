// melodyflix videos - Section 15.5 Multi-User Video Editing routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  createProject, getProject, listProjects, listUserProjects, updateProject, deleteProject,
  addMember, removeMember, listMembers,
  acquireLock, releaseLock,
  addClip, getClip, listClips, moveClip, resizeClip, updateClipProps, deleteClip,
  lockClip, unlockClip,
  listOperations, updateCursor, listCursors,
  getProjectSummary, getMultiEditStats,
} from '../services/multi-edit.service.js';

const P_STATUSES = ['draft','editing','review','locked','archived'] as const;
const M_ROLES = ['editor','reviewer','viewer'] as const;
const CLIP_KINDS = ['video','audio','text','overlay','image'] as const;

const CreateProjectSchema = z.object({
  video_id: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
});

const UpdateProjectSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.enum(P_STATUSES).optional(),
});

const MemberSchema = z.object({
  user_id: z.string().min(1).max(100),
  role: z.enum(M_ROLES).optional(),
  can_edit: z.boolean().optional(),
  can_comment: z.boolean().optional(),
});

const AddClipSchema = z.object({
  kind: z.enum(CLIP_KINDS).optional(),
  track_index: z.number().int().min(0).max(200).optional(),
  start_ms: z.number().int().min(0).max(86_400_000).optional(),
  duration_ms: z.number().int().min(0).max(86_400_000).optional(),
  z_index: z.number().int().min(-1000).max(1000).optional(),
  source_url: z.string().max(2000).nullable().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

const MoveClipSchema = z.object({
  start_ms: z.number().int().min(0).max(86_400_000),
  track_index: z.number().int().min(0).max(200).optional(),
});

const ResizeClipSchema = z.object({
  duration_ms: z.number().int().min(1).max(86_400_000),
});

const PropsSchema = z.object({
  patch: z.record(z.string(), z.unknown()),
});

const CursorSchema = z.object({
  position_ms: z.number().int().min(0).max(86_400_000),
  track_index: z.number().int().min(0).max(200).optional(),
});

function uid(auth: string | undefined): string | null {
  try {
    const p: any = requireRole(auth, ['admin','user','moderator']);
    return p?.sub ?? p?.id ?? null;
  } catch { return null; }
}
function admin(auth: string | undefined): boolean {
  try { requireRole(auth, ['admin']); return true; } catch { return false; }
}

export async function multiEditRoutes(app: FastifyInstance): Promise<void> {
  // ============ PROJECTS ============
  app.post('/edit-projects', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = CreateProjectSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createProject({ owner_id: actor, ...p.data }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/edit-projects/mine', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const q = req.query as { limit?: string };
    return reply.send({ success: true, data: { projects: listUserProjects(actor, q.limit ? Number(q.limit) : 100) } });
  });

  app.get('/edit-projects', async (req, reply) => {
    const q = req.query as { owner_id?: string; video_id?: string; status?: string; limit?: string };
    return reply.send({ success: true, data: { projects: listProjects({
      owner_id: q.owner_id, video_id: q.video_id, status: q.status as any,
      limit: q.limit ? Number(q.limit) : undefined,
    }) } });
  });

  app.get('/edit-projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = getProjectSummary(id);
    if (!s) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: s });
  });

  app.patch('/edit-projects/:id', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const p = UpdateProjectSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try {
      const r = updateProject(id, actor, p.data);
      return r ? reply.send({ success: true, data: r }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(403).send({ success: false, error: (e as Error).message }); }
  });

  app.delete('/edit-projects/:id', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    try {
      const ok = deleteProject(id, actor);
      return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(403).send({ success: false, error: (e as Error).message }); }
  });

  // ============ LOCK ============
  app.post('/edit-projects/:id/lock', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: acquireLock(id, actor) }); }
    catch (e) { return reply.code(409).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/edit-projects/:id/unlock', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: releaseLock(id, actor) }); }
    catch (e) { return reply.code(409).send({ success: false, error: (e as Error).message }); }
  });

  // ============ MEMBERS ============
  app.post('/edit-projects/:id/members', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const p = MemberSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: addMember(actor, { project_id: id, ...p.data }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/edit-projects/:id/members', async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: { members: listMembers(id) } });
  });

  app.delete('/edit-projects/:id/members/:userId', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id, userId } = req.params as { id: string; userId: string };
    try {
      const ok = removeMember(id, actor, userId);
      return ok ? reply.send({ success: true, data: { removed: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(403).send({ success: false, error: (e as Error).message }); }
  });

  // ============ CLIPS ============
  app.post('/edit-projects/:id/clips', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const p = AddClipSchema.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: addClip(actor, { project_id: id, ...p.data }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/edit-projects/:id/clips', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { track?: string };
    return reply.send({ success: true, data: { clips: listClips(id, q.track !== undefined ? Number(q.track) : undefined) } });
  });

  app.get('/edit-clips/:clipId', async (req, reply) => {
    const { clipId } = req.params as { clipId: string };
    const c = getClip(clipId);
    if (!c) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: c });
  });

  app.post('/edit-clips/:clipId/move', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { clipId } = req.params as { clipId: string };
    const p = MoveClipSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: moveClip(clipId, actor, p.data.start_ms, p.data.track_index) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/edit-clips/:clipId/resize', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { clipId } = req.params as { clipId: string };
    const p = ResizeClipSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: resizeClip(clipId, actor, p.data.duration_ms) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/edit-clips/:clipId/props', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { clipId } = req.params as { clipId: string };
    const p = PropsSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: updateClipProps(clipId, actor, p.data.patch) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.delete('/edit-clips/:clipId', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { clipId } = req.params as { clipId: string };
    try {
      const ok = deleteClip(clipId, actor);
      return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/edit-clips/:clipId/lock', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { clipId } = req.params as { clipId: string };
    try { return reply.send({ success: true, data: lockClip(clipId, actor) }); }
    catch (e) { return reply.code(409).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/edit-clips/:clipId/unlock', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { clipId } = req.params as { clipId: string };
    try { return reply.send({ success: true, data: unlockClip(clipId, actor) }); }
    catch (e) { return reply.code(409).send({ success: false, error: (e as Error).message }); }
  });

  // ============ OPS (sync) ============
  app.get('/edit-projects/:id/operations', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { since?: string; limit?: string };
    return reply.send({ success: true, data: { operations: listOperations(
      id,
      q.since ? Number(q.since) : 0,
      q.limit ? Number(q.limit) : 200,
    ) } });
  });

  // ============ CURSORS (presence) ============
  app.post('/edit-projects/:id/cursor', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const p = CursorSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: updateCursor(id, actor, p.data.position_ms, p.data.track_index) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/edit-projects/:id/cursors', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { online_within?: string };
    return reply.send({ success: true, data: { cursors: listCursors(id, q.online_within ? Number(q.online_within) : 30) } });
  });

  // ============ STATS ============
  app.get('/edit-projects-stats', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getMultiEditStats() });
  });
}
