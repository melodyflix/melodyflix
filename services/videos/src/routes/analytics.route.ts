// melodyflix videos - analytics routes (creator dashboard)
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  getChannelOverview, getViewsTimeSeries, getTopVideos,
  getChannelRevenue, getSubscriberGrowth,
} from '../services/analytics.service.js';
import { getDb } from '@melodyflix/shared-db';

export async function analyticsRoutes(app: FastifyInstance) {
  // GET /api/v1/videos/analytics/channel/:channelId
  app.get('/analytics/channel/:channelId', async (req, reply) => {
    const { channelId } = req.params as { channelId: string };
    const q = req.query as { days?: string };
    const days = Math.min(Number(q.days ?? 30), 90);

    const [overview, series, top, revenue, growth] = await Promise.all([
      Promise.resolve(getChannelOverview(channelId)),
      Promise.resolve(getViewsTimeSeries(channelId, days)),
      Promise.resolve(getTopVideos(channelId, 10)),
      Promise.resolve(getChannelRevenue(channelId, days)),
      Promise.resolve(getSubscriberGrowth(channelId, days)),
    ]);

    return reply.send({
      success: true,
      data: { overview, series, top, revenue, growth, days },
    });
  });

  // GET /api/v1/videos/analytics/me — analytics for my channel
  app.get('/analytics/me', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const db = getDb();
    const channel = db.prepare('SELECT id FROM channels WHERE owner_id = ?').get(user.sub) as { id: string } | undefined;
    if (!channel) return reply.code(404).send({ success: false, error: 'No channel' });

    const q = req.query as { days?: string };
    const days = Math.min(Number(q.days ?? 30), 90);

    const [overview, series, top, revenue, growth] = await Promise.all([
      Promise.resolve(getChannelOverview(channel.id)),
      Promise.resolve(getViewsTimeSeries(channel.id, days)),
      Promise.resolve(getTopVideos(channel.id, 10)),
      Promise.resolve(getChannelRevenue(channel.id, days)),
      Promise.resolve(getSubscriberGrowth(channel.id, days)),
    ]);

    return reply.send({
      success: true,
      data: { overview, series, top, revenue, growth, days, channel_id: channel.id },
    });
  });
}
