// melodyflix videos - membership routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '@melodyflix/shared-auth';
import {
  createTier, listTiersByChannel, getTierById, updateTier, deleteTier,
  createMembership, getMembership, listMyMemberships, cancelMembership,
  listChannelMembers, getMembershipStats,
} from '../services/membership.service.js';
import { getDb } from '@melodyflix/shared-db';

const CreateTierSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  price: z.number().min(1).max(100000),
  currency: z.string().max(10).optional(),
  color: z.string().max(20).optional(),
  badge_emoji: z.string().max(10).optional(),
  active: z.boolean().optional(),
});

const UpdateTierSchema = CreateTierSchema.partial();

const CreateMembershipSchema = z.object({
  tier_id: z.string().min(1),
  transaction_id: z.string().min(1),
  duration_days: z.number().int().min(1).max(365).optional(),
});

export async function membershipRoutes(app: FastifyInstance) {
  // ============ PUBLIC ============

  // GET /api/v1/videos/memberships/tiers/:channelId — channel's tiers
  app.get('/memberships/tiers/:channelId', async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const tiers = listTiersByChannel(channelId).filter((t) => t.active === 1);
    return reply.send({ success: true, data: { tiers } });
  });

  // GET /api/v1/videos/memberships/me — my memberships
  app.get('/memberships/me', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const memberships = listMyMemberships(user.sub);
    return reply.send({ success: true, data: { memberships } });
  });

  // GET /api/v1/videos/memberships/check/:channelId — do I have membership here?
  app.get('/memberships/check/:channelId', async (req, reply) => {
    const token = req.headers.authorization;
    if (!token) return reply.send({ success: true, data: { membership: null } });
    let user;
    try { user = requireAuth(token); }
    catch { return reply.send({ success: true, data: { membership: null } }); }
    const { channelId } = req.params as { channelId: string };
    const membership = getMembership(user.sub, channelId);
    if (!membership || membership.status !== 'active') {
      return reply.send({ success: true, data: { membership: null } });
    }
    const tier = getTierById(membership.tier_id);
    return reply.send({ success: true, data: { membership: { ...membership, tier } } });
  });

  // POST /api/v1/videos/memberships/join — create/extend membership (requires paid transaction)
  app.post('/memberships/join', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = CreateMembershipSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const tier = getTierById(parsed.data.tier_id);
    if (!tier) return reply.code(404).send({ success: false, error: 'Tier not found' });

    // Verify transaction
    try {
      const db = getDb();
      const tx = db.prepare('SELECT * FROM payment_transactions WHERE id = ?').get(parsed.data.transaction_id) as any;
      if (!tx || tx.user_id !== user.sub) {
        return reply.code(402).send({ success: false, error: 'Invalid transaction' });
      }
      if (tx.status !== 'completed') {
        return reply.code(402).send({ success: false, error: 'Payment not completed' });
      }
      if (tx.purpose !== 'membership') {
        return reply.code(400).send({ success: false, error: 'Transaction is not for membership' });
      }
    } catch (err) {
      return reply.code(500).send({ success: false, error: 'Transaction verification failed' });
    }

    try {
      const membership = createMembership({
        user_id: user.sub,
        channel_id: tier.channel_id,
        tier_id: tier.id,
        duration_days: parsed.data.duration_days,
        transaction_id: parsed.data.transaction_id,
        amount_paid: tier.price,
      });
      return reply.code(201).send({ success: true, data: { membership, tier } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /api/v1/videos/memberships/cancel/:channelId
  app.delete('/memberships/cancel/:channelId', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { channelId } = req.params as { channelId: string };
    try {
      cancelMembership(user.sub, channelId);
      return reply.send({ success: true, data: { cancelled: true } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============ CREATOR (channel owner) ============

  // GET /api/v1/videos/memberships/channel/:channelId — my channel's tiers (owner view, includes inactive)
  app.get('/memberships/channel/:channelId', async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const tiers = listTiersByChannel(channelId);
    const members = listChannelMembers(channelId);
    return reply.send({ success: true, data: { tiers, members } });
  });

  // POST /api/v1/videos/memberships/tiers — create tier
  app.post('/memberships/tiers', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = CreateTierSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const db = getDb();
    const channel = db.prepare('SELECT id FROM channels WHERE owner_id = ?').get(user.sub) as { id: string } | undefined;
    if (!channel) return reply.code(400).send({ success: false, error: 'You need a channel first' });

    try {
      const tier = createTier({ channel_id: channel.id, ...parsed.data });
      return reply.code(201).send({ success: true, data: tier });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // PATCH /api/v1/videos/memberships/tiers/:id
  app.patch('/memberships/tiers/:id', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = UpdateTierSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const db = getDb();
    const channel = db.prepare('SELECT id FROM channels WHERE owner_id = ?').get(user.sub) as { id: string } | undefined;
    if (!channel) return reply.code(400).send({ success: false, error: 'No channel' });
    try {
      const { id } = req.params as { id: string };
      const updated = updateTier(id, channel.id, parsed.data);
      return reply.send({ success: true, data: updated });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /api/v1/videos/memberships/tiers/:id
  app.delete('/memberships/tiers/:id', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const db = getDb();
    const channel = db.prepare('SELECT id FROM channels WHERE owner_id = ?').get(user.sub) as { id: string } | undefined;
    if (!channel) return reply.code(400).send({ success: false, error: 'No channel' });
    try {
      const { id } = req.params as { id: string };
      deleteTier(id, channel.id);
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) {
      return reply.code(403).send({ success: false, error: (err as Error).message });
    }
  });

  // ============ ADMIN ============

  // GET /api/v1/videos/admin/memberships/stats
  app.get('/memberships/stats', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: getMembershipStats() });
  });
}
