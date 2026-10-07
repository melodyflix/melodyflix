// melodyflix videos - Section 15.3 Collaborative Playlist routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  createPlaylist, getPlaylist, listPlaylists, listUserPlaylists, updatePlaylist, deletePlaylist,
  addContributor, updateContributor, removeContributor, listContributors,
  addItem, listItems, removeItem, reorderItems, voteItem,
  createInvite, getInvite, listInvites, acceptInvite, declineInvite, revokeInvite,
  getPlaylistSummary, getCollabPlaylistStats,
} from '../services/collab-playlist.service.js';

const VISIBILITIES = ['public','unlisted','private'] as const;
const ROLES = ['editor','contributor','viewer'] as const;
const INVITE_STATUSES = ['pending','accepted','declined','revoked'] as const;

const CreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  visibility: z.enum(VISIBILITIES).optional(),
  is_collaborative: z.boolean().optional(),
  allow_voting: z.boolean().optional(),
  max_items: z.number().int().min(1).max(5000).optional(),
});

const UpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  visibility: z.enum(VISIBILITIES).optional(),
  is_collaborative: z.boolean().optional(),
  allow_voting: z.boolean().optional(),
  max_items: z.number().int().min(1).max(5000).optional(),
});

const ContributorSchema = z.object({
  user_id: z.string().min(1).max(100),
  role: z.enum(ROLES).optional(),
  can_add: z.boolean().optional(),
  can_remove: z.boolean().optional(),
  can_reorder: z.boolean().optional(),
});

const ContributorPatchSchema = z.object({
  role: z.enum(ROLES).optional(),
  can_add: z.boolean().optional(),
  can_remove: z.boolean().optional(),
  can_reorder: z.boolean().optional(),
});

const ItemSchema = z.object({
  video_id: z.string().min(1).max(100),
  position: z.number().int().min(0).max(100000).optional(),
});

const ReorderSchema = z.object({
  ordered_item_ids: z.array(z.string().min(1).max(100)).min(1).max(5000),
});

const VoteSchema = z.object({ vote: z.enum(['up','down']) });

const InviteSchema = z.object({
  invitee_id: z.string().min(1).max(100),
  role: z.enum(ROLES).optional(),
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

export async function collabPlaylistRoutes(app: FastifyInstance): Promise<void> {
  // ============ PLAYLISTS ============
  app.post('/collab-playlists', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = CreateSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createPlaylist({ owner_id: actor, ...p.data }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/collab-playlists/mine', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const q = req.query as { limit?: string };
    return reply.send({ success: true, data: { playlists: listUserPlaylists(actor, q.limit ? Number(q.limit) : 100) } });
  });

  app.get('/collab-playlists', async (req, reply) => {
    const q = req.query as { owner_id?: string; visibility?: string; limit?: string };
    return reply.send({ success: true, data: { playlists: listPlaylists({
      owner_id: q.owner_id, visibility: q.visibility as any, limit: q.limit ? Number(q.limit) : undefined,
    }) } });
  });

  app.get('/collab-playlists/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = getPlaylistSummary(id);
    if (!s) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: s });
  });

  app.patch('/collab-playlists/:id', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const p = UpdateSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try {
      const r = updatePlaylist(id, actor, p.data);
      return r ? reply.send({ success: true, data: r }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(403).send({ success: false, error: (e as Error).message }); }
  });

  app.delete('/collab-playlists/:id', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    try {
      const ok = deletePlaylist(id, actor);
      return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(403).send({ success: false, error: (e as Error).message }); }
  });

  // ============ CONTRIBUTORS ============
  app.post('/collab-playlists/:id/contributors', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const p = ContributorSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: addContributor({ playlist_id: id, invited_by: actor, ...p.data }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/collab-playlists/:id/contributors', async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: { contributors: listContributors(id) } });
  });

  app.patch('/collab-playlists/:id/contributors/:userId', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id, userId } = req.params as { id: string; userId: string };
    const p = ContributorPatchSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try {
      const r = updateContributor(id, actor, userId, p.data);
      return r ? reply.send({ success: true, data: r }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(403).send({ success: false, error: (e as Error).message }); }
  });

  app.delete('/collab-playlists/:id/contributors/:userId', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id, userId } = req.params as { id: string; userId: string };
    try {
      const ok = removeContributor(id, actor, userId);
      return ok ? reply.send({ success: true, data: { removed: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(403).send({ success: false, error: (e as Error).message }); }
  });

  // ============ ITEMS ============
  app.post('/collab-playlists/:id/items', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const p = ItemSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: addItem({ playlist_id: id, added_by: actor, ...p.data }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/collab-playlists/:id/items', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { order_by?: string };
    const order = q.order_by === 'votes' ? 'votes' : 'position';
    return reply.send({ success: true, data: { items: listItems(id, order) } });
  });

  app.delete('/collab-playlists/items/:itemId', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { itemId } = req.params as { itemId: string };
    try {
      const ok = removeItem(itemId, actor);
      return ok ? reply.send({ success: true, data: { removed: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(403).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/collab-playlists/:id/reorder', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const p = ReorderSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: { items: reorderItems(id, actor, p.data.ordered_item_ids) } }); }
    catch (e) { return reply.code(403).send({ success: false, error: (e as Error).message }); }
  });

  // ============ VOTES ============
  app.post('/collab-playlists/items/:itemId/vote', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { itemId } = req.params as { itemId: string };
    const p = VoteSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: voteItem(itemId, actor, p.data.vote) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  // ============ INVITES ============
  app.post('/collab-playlists/:id/invites', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const p = InviteSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createInvite({ playlist_id: id, inviter_id: actor, ...p.data }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/collab-playlists/invites', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const q = req.query as { box?: string; playlist_id?: string; status?: string };
    const filter: any = { playlist_id: q.playlist_id, status: q.status as any };
    if (q.box === 'received') filter.invitee_id = actor;
    return reply.send({ success: true, data: { invites: listInvites(filter) } });
  });

  app.get('/collab-playlists/invites/:inviteId', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { inviteId } = req.params as { inviteId: string };
    const i = getInvite(inviteId);
    if (!i) return reply.code(404).send({ success: false, error: 'not_found' });
    if (i.invitee_id !== actor && i.inviter_id !== actor && !admin(req.headers.authorization)) {
      return reply.code(403).send({ success: false, error: 'not_allowed' });
    }
    return reply.send({ success: true, data: i });
  });

  app.post('/collab-playlists/invites/:inviteId/accept', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { inviteId } = req.params as { inviteId: string };
    try { return reply.send({ success: true, data: acceptInvite(inviteId, actor) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/collab-playlists/invites/:inviteId/decline', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { inviteId } = req.params as { inviteId: string };
    try { return reply.send({ success: true, data: declineInvite(inviteId, actor) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/collab-playlists/invites/:inviteId/revoke', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { inviteId } = req.params as { inviteId: string };
    try { return reply.send({ success: true, data: revokeInvite(inviteId, actor) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  // ============ STATS ============
  app.get('/collab-playlists/stats', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getCollabPlaylistStats() });
  });
}
