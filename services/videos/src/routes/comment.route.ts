// melodyflix videos - comment routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, verifyJwt, extractBearerToken } from '@melodyflix/shared-auth';
import { publish, CHANNELS } from '@melodyflix/shared-events';
import {
  createComment, getComments, getCommentCount, updateComment, deleteComment,
  likeComment, reportComment, toggleSaveVideo, isVideoSaved, listSavedVideos,
  getCommentsPaginated, pinComment, unpinComment, toggleCreatorHeart,
  type CommentSort,
} from '../services/comment.service.js';
import { batchLookupUsers, getFallbackUser, type PublicUser } from '../services/userlookup.service.js';

const CreateCommentSchema = z.object({
  content: z.string().min(1).max(2000),
  parentId: z.string().uuid().nullable().optional(),
  // 6.8 Timestamp Comment: attach a playback position (0 - 86400s)
  video_timestamp_seconds: z.number().min(0).max(86400).nullable().optional(),
});

const UpdateCommentSchema = z.object({
  content: z.string().min(1).max(2000),
});

const ReportSchema = z.object({
  reason: z.enum(['spam', 'harassment', 'hate_speech', 'misinformation', 'other']),
  note: z.string().max(500).optional(),
});

function optionalUser(authorization: string | undefined) {
  const token = extractBearerToken(authorization);
  if (!token) return null;
  return verifyJwt(token);
}

function collectUserIds(comments: any[]): string[] {
  const set = new Set<string>();
  for (const c of comments) {
    set.add(c.user_id);
    if (Array.isArray(c.replies)) {
      for (const r of c.replies) set.add(r.user_id);
    }
  }
  return Array.from(set);
}

function attachUsers(comments: any[], userMap: Map<string, PublicUser>): any[] {
  return comments.map((c) => ({
    ...c,
    user: userMap.get(c.user_id) ?? getFallbackUser(c.user_id),
    replies: Array.isArray(c.replies)
      ? c.replies.map((r: any) => ({
          ...r,
          user: userMap.get(r.user_id) ?? getFallbackUser(r.user_id),
        }))
      : [],
  }));
}

export async function commentRoutes(app: FastifyInstance) {
  // GET /api/v1/videos/:videoId/comments
  app.get('/:videoId/comments', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const user = optionalUser(req.headers.authorization);
    const comments = getComments(videoId, user?.sub ?? null);

    // Batch lookup user info
    const ids = collectUserIds(comments);
    const userMap = ids.length > 0 ? await batchLookupUsers(ids) : new Map();

    return reply.send({
      success: true,
      data: {
        comments: attachUsers(comments, userMap),
        total: getCommentCount(videoId),
      },
    });
  });

  // POST /api/v1/videos/:videoId/comments
  app.post('/:videoId/comments', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = CreateCommentSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const { videoId } = req.params as { videoId: string };
      const comment = createComment(videoId, user.sub, parsed.data.content, parsed.data.parentId ?? null, parsed.data.video_timestamp_seconds ?? null);

      const userMap = await batchLookupUsers([user.sub]);
      const enriched = attachUsers([{ ...comment, replies: [] }], userMap)[0];

      // Publish event for notifications
      try {
        const { getDb } = await import('@melodyflix/shared-db');
        const db = getDb();
        const video = db.prepare('SELECT owner_id, title FROM videos WHERE id = ?').get(videoId) as any;
        const parentAuthorId = parsed.data.parentId
          ? (db.prepare('SELECT user_id FROM comments WHERE id = ?').get(parsed.data.parentId) as any)?.user_id
          : null;
        if (video) {
          publish(CHANNELS.COMMENT_POSTED, {
            commentId: comment.id,
            videoId,
            videoOwnerId: video.owner_id,
            commenterId: user.sub,
            commenterUsername: enriched.user?.display_name ?? enriched.user?.username ?? 'someone',
            parentId: parsed.data.parentId ?? null,
            parentCommentAuthorId: parentAuthorId,
            content: parsed.data.content,
          }).catch(() => {});
        }
      } catch {}

      return reply.code(201).send({ success: true, data: enriched });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // PATCH /api/v1/videos/comments/:commentId
  app.patch('/comments/:commentId', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = UpdateCommentSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const { commentId } = req.params as { commentId: string };
      const updated = updateComment(commentId, user.sub, parsed.data.content);
      const userMap = await batchLookupUsers([updated.user_id]);
      const enriched = attachUsers([{ ...updated, replies: [] }], userMap)[0];
      return reply.send({ success: true, data: enriched });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /api/v1/videos/comments/:commentId
  app.delete('/comments/:commentId', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    try {
      const { commentId } = req.params as { commentId: string };
      deleteComment(commentId, user.sub, user.role === 'admin');
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /api/v1/videos/comments/:commentId/like
  app.post('/comments/:commentId/like', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    try {
      const { commentId } = req.params as { commentId: string };
      const result = likeComment(commentId, user.sub);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /api/v1/videos/comments/:commentId/report
  app.post('/comments/:commentId/report', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = ReportSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const { commentId } = req.params as { commentId: string };
      reportComment(commentId, user.sub, parsed.data.reason, parsed.data.note ?? null);
      return reply.send({ success: true, data: { reported: true } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /api/v1/videos/:videoId/save
  app.post('/:videoId/save', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    try {
      const { videoId } = req.params as { videoId: string };
      const result = toggleSaveVideo(videoId, user.sub);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /api/v1/videos/:videoId/saved
  app.get('/:videoId/saved', async (req, reply) => {
    const user = optionalUser(req.headers.authorization);
    const { videoId } = req.params as { videoId: string };
    return reply.send({ success: true, data: { saved: isVideoSaved(videoId, user?.sub ?? null) } });
  });

  // GET /api/v1/videos/user/saved
  app.get('/user/saved', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: { videoIds: listSavedVideos(user.sub) } });
  });

  // ============ Better Comments ============

  // GET /:videoId/comments/paginated?sort=top|newest|oldest&limit=20&offset=0
  app.get('/:videoId/comments/paginated', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { sort?: string; limit?: string; offset?: string };
    const sort = (q.sort === 'newest' || q.sort === 'oldest' || q.sort === 'top') ? q.sort as CommentSort : 'top';
    const limit = Math.min(Math.max(parseInt(q.limit ?? '20') || 20, 1), 50);
    const offset = Math.max(parseInt(q.offset ?? '0') || 0, 0);

    const u = optionalUser(req.headers.authorization);
    const currentUserId = (u?.sub as string) ?? null;
    const page = getCommentsPaginated(videoId, currentUserId, sort, limit, offset);
    return reply.send(page);
  });

  // POST /comments/:commentId/pin
  app.post('/comments/:commentId/pin', async (req, reply) => {
    let userId: string;
    let isAdmin = false;
    try {
      const payload = requireAuth(req.headers.authorization);
      userId = payload.sub as string;
      isAdmin = payload.role === 'admin';
    } catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { commentId } = req.params as { commentId: string };
    try {
      pinComment(commentId, userId, isAdmin);
      return reply.send({ ok: true, pinned: true });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /comments/:commentId/unpin
  app.post('/comments/:commentId/unpin', async (req, reply) => {
    let userId: string;
    let isAdmin = false;
    try {
      const payload = requireAuth(req.headers.authorization);
      userId = payload.sub as string;
      isAdmin = payload.role === 'admin';
    } catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { commentId } = req.params as { commentId: string };
    try {
      unpinComment(commentId, userId, isAdmin);
      return reply.send({ ok: true, pinned: false });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /comments/:commentId/heart
  app.post('/comments/:commentId/heart', async (req, reply) => {
    let userId: string;
    let isAdmin = false;
    try {
      const payload = requireAuth(req.headers.authorization);
      userId = payload.sub as string;
      isAdmin = payload.role === 'admin';
    } catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { commentId } = req.params as { commentId: string };
    try {
      const result = toggleCreatorHeart(commentId, userId, isAdmin);
      return reply.send({ ok: true, heart: result.heart });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });
}
