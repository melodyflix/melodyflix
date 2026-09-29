// melodyflix channel - admin verification routes
import type { FastifyInstance } from 'fastify';
import { requireRole } from '@melodyflix/shared-auth';
import { verifyChannel, unverifyChannel } from '../services/channel.service.js';

export async function channelAdminRoutes(app: FastifyInstance) {
  // POST /api/v1/channels/admin/:id/verify
  app.post('/admin/:id/verify', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }

    const { id } = req.params as { id: string };
    const channel = verifyChannel(id);
    if (!channel) return reply.code(404).send({ success: false, error: 'Channel not found' });
    return reply.send({ success: true, data: channel });
  });

  // POST /api/v1/channels/admin/:id/unverify
  app.post('/admin/:id/unverify', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }

    const { id } = req.params as { id: string };
    const channel = unverifyChannel(id);
    if (!channel) return reply.code(404).send({ success: false, error: 'Channel not found' });
    return reply.send({ success: true, data: channel });
  });
}
