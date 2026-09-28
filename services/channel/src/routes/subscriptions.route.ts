// melodyflix channel - subscriptions routes
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '@melodyflix/shared-auth';
import { getMyFollowing, getFollowingCount } from '../services/channel.service.js';

export async function subscriptionsRoutes(app: FastifyInstance) {
  // GET /api/v1/channels/me/following — list my subscribed channels
  app.get('/me/following', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const channels = getMyFollowing(user.sub);
    return reply.send({
      success: true,
      data: { channels, total: getFollowingCount(user.sub) },
    });
  });
}
