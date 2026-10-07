// melodyflix videos - Section 15.6 Comment on Timeline routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  addComment, getComment, listComments, updateComment, deleteComment,
  resolveComment, unresolveComment,
  listReplies, getThread,
  listMentionsForUser,
  addReaction, removeReaction, listReactions,
  getTimelineCommentStats,
} from '../services/timeline-comment.service.js';

const AddSchema = z.object({
  video_id: z.string().min(1).max(100),
  body: z.string().min(1).max(5000),
  time_ms: z.number().int().min(0).max(86400000).optional(),
  time_end_ms: z.number().int().min(0).max(86400000).nullable().optional(),
  track_index: z.number().int().min(0).max(200).nullable().optional(),
  project_id: z.string().max(100).nullable().optional(),
  version_id: z.string().max(100).nullable().optional(),
  clip_id: z.string().max(100).nullable().optional(),
  parent_id: z.string().max(100).nullable().optional(),
  mentions: z.array(z.string().max(100)).max(30).optional(),
});

const UpdateSchema = z.object({ body: z.string().min(1).max(5000) });

const ReactionSchema = z.object({ emoji: z.string().min(1).max(32) });

function uid(auth: string | undefined): string | null {
  try {
    const p: any = requireRole(auth, ['admin','user','moderator']);
    return p?.sub ?? p?.id ?? null;
  } catch { return null; }
}
function admin(auth: string | undefined): boolean {
  try { requireRole(auth, ['admin']); return true; } catch { return false; }
}

export async function timelineCommentRoutes(app: FastifyInstance): Promise<void> {
  // ============ COMMENTS ============
  app.post('/timeline-comments', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = AddSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: addComment({ author_id: actor, ...p.data }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/timeline-comments', async (req, reply) => {
    const q = req.query as {
      video_id?: string; project_id?: string; clip_id?: string; author_id?: string;
      parent_id?: string; top_level?: string; resolved?: string;
      from_ms?: string; to_ms?: string; limit?: string;
    };
    const filter: any = {
      video_id: q.video_id, project_id: q.project_id, clip_id: q.clip_id, author_id: q.author_id,
      from_ms: q.from_ms ? Number(q.from_ms) : undefined,
      to_ms: q.to_ms ? Number(q.to_ms) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    };
    if (q.top_level === '1' || q.top_level === 'true') filter.parent_id = null;
    else if (q.parent_id) filter.parent_id = q.parent_id;
    if (q.resolved !== undefined) filter.resolved = q.resolved === '1' || q.resolved === 'true';
    return reply.send({ success: true, data: { comments: listComments(filter) } });
  });

  app.get('/timeline-comments/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = getComment(id);
    if (!c) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: c });
  });

  app.get('/timeline-comments/:id/thread', async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = getThread(id);
    if (!t) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: t });
  });

  app.get('/timeline-comments/:id/replies', async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: { replies: listReplies(id) } });
  });

  app.patch('/timeline-comments/:id', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const p = UpdateSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try {
      const c = updateComment(id, actor, p.data.body);
      return c ? reply.send({ success: true, data: c }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(403).send({ success: false, error: (e as Error).message }); }
  });

  app.delete('/timeline-comments/:id', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    try {
      const ok = deleteComment(id, actor);
      return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(403).send({ success: false, error: (e as Error).message }); }
  });

  // ============ RESOLVE ============
  app.post('/timeline-comments/:id/resolve', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const c = resolveComment(id, actor);
    return c ? reply.send({ success: true, data: c }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  app.post('/timeline-comments/:id/unresolve', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const c = unresolveComment(id, actor);
    return c ? reply.send({ success: true, data: c }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  // ============ MENTIONS ============
  app.get('/timeline-comments/mentions/me', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const q = req.query as { limit?: string };
    return reply.send({ success: true, data: { mentions: listMentionsForUser(actor, q.limit ? Number(q.limit) : 100) } });
  });

  // ============ REACTIONS ============
  app.post('/timeline-comments/:id/reactions', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const p = ReactionSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: addReaction(id, actor, p.data.emoji) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.delete('/timeline-comments/:id/reactions/:emoji', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id, emoji } = req.params as { id: string; emoji: string };
    const ok = removeReaction(id, actor, decodeURIComponent(emoji));
    return ok ? reply.send({ success: true, data: { removed: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  app.get('/timeline-comments/:id/reactions', async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: { reactions: listReactions(id) } });
  });

  // ============ STATS ============
  app.get('/timeline-comments-stats', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getTimelineCommentStats() });
  });
}
