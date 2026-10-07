// melodyflix videos - Section 18 Video Management routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  getLifecycle, saveDraft, publishFromDraft,
  scheduleVideo, cancelSchedule, listDueScheduled, publishDueScheduled,
  archiveVideo, unarchiveVideo, listArchived,
  createAutoDeletePolicy, getAutoDeletePolicy, listAutoDeletePolicies, runAutoDeletePolicy,
  createFolder, getFolder, listFolders, deleteFolder,
  addVideoToFolder, removeVideoFromFolder, listFolderItems,
  createCollection, listCollections, addVideoToCollection, listCollectionItems,
  createBulkEditJob, getBulkEditJob, runBulkEditJob, listBulkEditJobs,
  createMassDeleteJob, getMassDeleteJob, runMassDeleteJob, listMassDeleteJobs,
  getVideoManagementStats,
} from '../services/video-management.service.js';

const ARCHIVE_REASON = ['manual','auto_age','storage_pressure'] as const;
const BULK_FIELDS = ['title','description','category','visibility','tags','status'] as const;

const DraftSchema = z.object({
  draft_payload: z.record(z.string(), z.unknown()),
  delete_after_days: z.number().int().min(1).max(3650).nullable().optional(),
});

const ScheduleSchema = z.object({
  scheduled_at: z.string().datetime(),
  scheduled_tz: z.string().max(60).nullable().optional(),
});

const ArchiveSchema = z.object({ reason: z.enum(ARCHIVE_REASON).optional() });

const AutoDeleteSchema = z.object({
  name: z.string().min(2).max(200),
  after_days: z.number().int().min(1).max(3650),
  apply_to: z.enum(['drafts','archived','deleted','all']).optional(),
  scope_filter: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

const FolderSchema = z.object({
  name: z.string().min(1).max(120),
  parent_id: z.string().max(100).nullable().optional(),
  color: z.string().max(20).nullable().optional(),
});

const CollectionSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  is_public: z.boolean().optional(),
});

const BulkEditSchema = z.object({
  video_ids: z.array(z.string().min(1).max(100)).min(1).max(5000),
  patch: z.record(z.string(), z.unknown()),
});

const MassDeleteSchema = z.object({
  video_ids: z.array(z.string().min(1).max(100)).min(1).max(10000),
  mode: z.enum(['soft','hard']).optional(),
});

const AddItemSchema = z.object({ video_id: z.string().min(1).max(100) });

function uid(auth: string | undefined): string | null {
  try { const p: any = requireRole(auth, ['admin','user','moderator']); return p?.sub ?? p?.id ?? null; } catch { return null; }
}
function admin(auth: string | undefined): boolean {
  try { requireRole(auth, ['admin']); return true; } catch { return false; }
}

export async function videoManagementRoutes(app: FastifyInstance): Promise<void> {
  // ============ 18.3 DRAFT ============
  app.get('/video-lifecycle/:videoId', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    return reply.send({ success: true, data: getLifecycle(videoId) });
  });

  app.post('/video-lifecycle/:videoId/draft', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { videoId } = req.params as { videoId: string };
    const p = DraftSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: saveDraft(videoId, p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/video-lifecycle/:videoId/publish', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { videoId } = req.params as { videoId: string };
    try { return reply.send({ success: true, data: publishFromDraft(videoId) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  // ============ 18.4 SCHEDULE ============
  app.post('/video-lifecycle/:videoId/schedule', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { videoId } = req.params as { videoId: string };
    const p = ScheduleSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: scheduleVideo(videoId, p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/video-lifecycle/:videoId/cancel-schedule', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { videoId } = req.params as { videoId: string };
    return reply.send({ success: true, data: cancelSchedule(videoId) });
  });

  app.get('/video-lifecycle/scheduled/due', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: { due: listDueScheduled() } });
  });

  app.post('/video-lifecycle/scheduled/publish-due', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const published = publishDueScheduled();
    return reply.send({ success: true, data: { published } });
  });

  // ============ 18.14 ARCHIVE ============
  app.post('/video-lifecycle/:videoId/archive', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { videoId } = req.params as { videoId: string };
    const p = ArchiveSchema.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: archiveVideo(videoId, p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/video-lifecycle/:videoId/unarchive', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { videoId } = req.params as { videoId: string };
    return reply.send({ success: true, data: unarchiveVideo(videoId) });
  });

  app.get('/video-lifecycle/archived/list', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: { archived: listArchived() } });
  });

  // ============ 18.10 AUTO-DELETE ============
  app.post('/auto-delete-policies', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = AutoDeleteSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createAutoDeletePolicy({ owner_id: actor, ...p.data }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/auto-delete-policies', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    return reply.send({ success: true, data: { policies: listAutoDeletePolicies(actor) } });
  });

  app.post('/auto-delete-policies/:id/run', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: runAutoDeletePolicy(id) }); }
    catch (e) { return reply.code(404).send({ success: false, error: (e as Error).message }); }
  });

  // ============ 18.11 FOLDERS / COLLECTIONS ============
  app.post('/video-folders', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = FolderSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createFolder(actor, p.data.name, p.data.parent_id, p.data.color) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/video-folders', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const q = req.query as { parent_id?: string };
    const parent = q.parent_id === undefined ? undefined : (q.parent_id === '' ? null : q.parent_id);
    return reply.send({ success: true, data: { folders: listFolders(actor, parent) } });
  });

  app.get('/video-folders/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const f = getFolder(id);
    if (!f) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: { folder: f, items: listFolderItems(id) } });
  });

  app.delete('/video-folders/:id', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    try {
      const ok = deleteFolder(id, actor);
      return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(403).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/video-folders/:id/items', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const p = AddItemSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try {
      const added = addVideoToFolder(id, p.data.video_id, actor);
      return reply.send({ success: true, data: { added } });
    } catch (e) { return reply.code(403).send({ success: false, error: (e as Error).message }); }
  });

  app.delete('/video-folders/:id/items/:videoId', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id, videoId } = req.params as { id: string; videoId: string };
    try {
      const ok = removeVideoFromFolder(id, videoId, actor);
      return ok ? reply.send({ success: true, data: { removed: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(403).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/video-collections', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = CollectionSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createCollection(actor, p.data.name, p.data.description, p.data.is_public ?? false) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/video-collections', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    const q = req.query as { public?: string; all?: string };
    if (q.all === '1' || q.public === '1') {
      return reply.send({ success: true, data: { collections: listCollections(undefined, q.public === '1') } });
    }
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    return reply.send({ success: true, data: { collections: listCollections(actor) } });
  });

  app.post('/video-collections/:id/items', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const p = AddItemSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try {
      const added = addVideoToCollection(id, p.data.video_id, actor);
      return reply.send({ success: true, data: { added } });
    } catch (e) { return reply.code(403).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/video-collections/:id/items', async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: { video_ids: listCollectionItems(id) } });
  });

  // ============ 18.12 BULK EDIT ============
  app.post('/bulk-edit-jobs', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = BulkEditSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createBulkEditJob({ owner_id: actor, ...p.data }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/bulk-edit-jobs', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    return reply.send({ success: true, data: { jobs: listBulkEditJobs(actor) } });
  });

  app.get('/bulk-edit-jobs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const j = getBulkEditJob(id);
    if (!j) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: j });
  });

  app.post('/bulk-edit-jobs/:id/run', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: runBulkEditJob(id, actor) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  // ============ 18.13 MASS DELETE ============
  app.post('/mass-delete-jobs', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = MassDeleteSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createMassDeleteJob({ owner_id: actor, ...p.data }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/mass-delete-jobs', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    return reply.send({ success: true, data: { jobs: listMassDeleteJobs(actor) } });
  });

  app.get('/mass-delete-jobs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const j = getMassDeleteJob(id);
    if (!j) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: j });
  });

  app.post('/mass-delete-jobs/:id/run', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: runMassDeleteJob(id, actor) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  // ============ STATS ============
  app.get('/video-management-stats', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getVideoManagementStats() });
  });
}
