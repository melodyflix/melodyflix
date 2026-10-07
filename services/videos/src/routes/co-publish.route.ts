// melodyflix videos - Section 15.2 Co-Publishing routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  inviteCoPublisher, getInvite, listInvites,
  acceptInvite, declineInvite, revokeInvite,
  upsertCredit, listCredits, deleteCredit, reorderCredits,
  getRevenueSplit, getCoPublishStats,
} from '../services/co-publish.service.js';

const ROLES = ['co_author','producer','editor','composer','camera','writer'] as const;
const STATUSES = ['pending','accepted','declined','revoked','expired'] as const;

const InviteSchema = z.object({
  video_id: z.string().min(1).max(100),
  invitee_id: z.string().min(1).max(100),
  role: z.enum(ROLES).optional(),
  revenue_share_percent: z.number().min(0).max(100).optional(),
  message: z.string().max(1000).nullable().optional(),
  ttl_seconds: z.number().int().min(60).max(86400 * 30).optional(),
});

const CreditSchema = z.object({
  video_id: z.string().min(1).max(100),
  user_id: z.string().min(1).max(100),
  display_name: z.string().max(200).nullable().optional(),
  role: z.enum(ROLES),
  order_index: z.number().int().min(0).max(1000).optional(),
  revenue_share_percent: z.number().min(0).max(100).optional(),
  is_public: z.boolean().optional(),
});

const ReorderSchema = z.object({
  ordered_user_ids: z.array(z.string().min(1).max(100)).min(1).max(100),
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

export async function coPublishRoutes(app: FastifyInstance): Promise<void> {
  // ============ INVITES ============
  app.post('/copublish/invites', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = InviteSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: inviteCoPublisher({ inviter_id: actor, ...p.data }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/copublish/invites', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const q = req.query as { video_id?: string; box?: string; status?: string; limit?: string };
    const filter: any = { video_id: q.video_id, status: q.status as any, limit: q.limit ? Number(q.limit) : undefined };
    if (q.box === 'sent') filter.inviter_id = actor;
    else if (q.box === 'received') filter.invitee_id = actor;
    else { filter.inviter_id = actor; } // default to sent
    return reply.send({ success: true, data: { invites: listInvites(filter) } });
  });

  app.get('/copublish/invites/:id', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const inv = getInvite(id);
    if (!inv) return reply.code(404).send({ success: false, error: 'not_found' });
    if (inv.inviter_id !== actor && inv.invitee_id !== actor && !admin(req.headers.authorization)) {
      return reply.code(403).send({ success: false, error: 'not_allowed' });
    }
    return reply.send({ success: true, data: inv });
  });

  app.post('/copublish/invites/:id/accept', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: acceptInvite(id, actor) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/copublish/invites/:id/decline', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: declineInvite(id, actor) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/copublish/invites/:id/revoke', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: revokeInvite(id, actor) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  // ============ CREDITS ============
  app.post('/copublish/credits', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = CreditSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: upsertCredit(p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/copublish/credits/:videoId', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { public?: string };
    const publicOnly = q.public === '1' || q.public === 'true';
    if (!publicOnly) {
      const actor = uid(req.headers.authorization);
      if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    }
    return reply.send({ success: true, data: { credits: listCredits(videoId, publicOnly) } });
  });

  app.delete('/copublish/credits/:videoId/:userId', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { videoId, userId } = req.params as { videoId: string; userId: string };
    try {
      const ok = deleteCredit(videoId, userId, actor);
      return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(403).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/copublish/credits/:videoId/reorder', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { videoId } = req.params as { videoId: string };
    const p = ReorderSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    return reply.send({ success: true, data: { credits: reorderCredits(videoId, p.data.ordered_user_ids) } });
  });

  // ============ REVENUE SPLIT ============
  app.get('/copublish/revenue/:videoId', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    return reply.send({ success: true, data: getRevenueSplit(videoId) });
  });

  // ============ STATS ============
  app.get('/copublish/stats', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getCoPublishStats() });
  });
}
