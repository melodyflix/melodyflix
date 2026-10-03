// melodyflix videos — Video Version Management routes (Section 41)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  attachVersion, getVersion, listVersions, getDefaultVersion,
  updateVersion, detachVersion, resolveParent,
  summarizeVersionGroup, clearDefault,
} from '../services/versions.service.js';

const KINDS = ['original','directors_cut','extended','theatrical','theatrical_cut','unrated','remastered','custom'] as const;

function userId(req: any): string | null {
  return req.user?.id ?? req.user?.sub ?? null;
}

export async function versionsRoutes(app: FastifyInstance) {
  const AttachSchema = z.object({
    version_video_id: z.string().min(1),
    kind: z.enum(KINDS).optional(),
    label: z.string().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    is_default: z.boolean().optional(),
    sort_order: z.number().int().min(0).max(10000).optional(),
  });

  const UpdateSchema = z.object({
    label: z.string().min(1).max(200).optional(),
    kind: z.enum(KINDS).optional(),
    description: z.string().max(2000).nullable().optional(),
    is_default: z.boolean().optional(),
    sort_order: z.number().int().min(0).max(10000).optional(),
  });

  // GET /videos/:videoId/versions — list all versions of a parent
  app.get('/videos/:videoId/versions', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { limit?: string };
    const versions = listVersions(videoId, { limit: q.limit ? parseInt(q.limit) : undefined });
    const summary = summarizeVersionGroup(videoId);
    return reply.send({ success: true, data: { versions, summary } });
  });

  // GET /videos/:videoId/versions/default — default version info
  app.get('/videos/:videoId/versions/default', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const def = getDefaultVersion(videoId);
    return reply.send({ success: true, data: { default: def } });
  });

  // POST /videos/:videoId/versions — attach a new version
  app.post('/videos/:videoId/versions', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { videoId } = req.params as { videoId: string };
    const parsed = AttachSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    try {
      const version = attachVersion({
        parent_video_id: videoId,
        owner_id: me,
        ...parsed.data,
      });
      return reply.code(201).send({ success: true, data: { version } });
    } catch (e: any) {
      const msg = e?.message ?? 'Attach failed';
      if (msg === 'Video not found') return reply.code(404).send({ success: false, error: msg });
      if (msg === 'Not your video') return reply.code(403).send({ success: false, error: msg });
      if (msg.includes('Cyclic')) return reply.code(409).send({ success: false, error: msg });
      if (msg.includes('version of itself')) return reply.code(400).send({ success: false, error: msg });
      return reply.code(500).send({ success: false, error: msg });
    }
  });

  // GET /versions/:id — single version
  app.get('/versions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const v = getVersion(id);
    if (!v) return reply.code(404).send({ success: false, error: 'Version not found' });
    return reply.send({ success: true, data: { version: v } });
  });

  // PATCH /versions/:id — update version metadata
  app.patch('/versions/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    try {
      const updated = updateVersion(id, me, parsed.data);
      if (!updated) return reply.code(404).send({ success: false, error: 'Version not found' });
      return reply.send({ success: true, data: { version: updated } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  // DELETE /versions/:id — detach version
  app.delete('/versions/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const removed = detachVersion(id, me);
      return reply.send({ success: true, data: { removed } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  // GET /videos/:videoId/versions/resolve — resolve entry point
  // If videoId is a version, returns the parent video id
  app.get('/videos/:videoId/versions/resolve', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const parent = resolveParent(videoId);
    return reply.send({
      success: true,
      data: {
        input_video_id: videoId,
        parent_video_id: parent,
        is_version: parent !== videoId,
      },
    });
  });

  // POST /videos/:videoId/versions/clear-default — reset default
  app.post('/videos/:videoId/versions/clear-default', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { videoId } = req.params as { videoId: string };
    try {
      clearDefault(videoId, me);
      return reply.send({ success: true, data: { cleared: true } });
    } catch (e: any) {
      const msg = e?.message ?? 'Failed';
      if (msg === 'Video not found') return reply.code(404).send({ success: false, error: msg });
      if (msg === 'Not your video') return reply.code(403).send({ success: false, error: msg });
      return reply.code(500).send({ success: false, error: msg });
    }
  });
}
