// melodyflix videos - entry point
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { loadConfig } from '@melodyflix/shared-config';
import { createLogger } from '@melodyflix/shared-logger';
import { searchRoutes } from './routes/search.route.js';
import { podcastRoutes } from './routes/podcast.route.js';
import { shortRoutes } from './routes/shorts.route.js';
import { seriesRoutes } from './routes/series.route.js';
import { trendingRoutes } from './routes/trending.route.js';
import { watchLaterRoutes } from './routes/watchlater.route.js';
import { historyRoutes } from './routes/history.route.js';
import { playlistRoutes } from './routes/playlist.route.js';
import { videoRoutes } from './routes/video.route.js';
import { commentRoutes } from './routes/comment.route.js';
import { adminReportRoutes } from './routes/admin.route.js';
import { ensureSchema } from './services/video.service.js';
import { ensureCommentSchema, ensureHistorySchema, ensurePlaylistSchema } from './services/comment.service.js';
import { ensureSeriesSchema } from './services/series.service.js';
import { ensureStorySchema } from './services/story.service.js';
import { ensureStorage } from './services/storage.service.js';

const config = loadConfig();
const logger = createLogger('videos');
const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 * 1024 });

await app.register(multipart, {
  limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 1 },
});

app.addHook('onRequest', async (req, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') reply.code(204).send();
});

app.get('/health', async () => ({ service: 'videos', status: 'ok' }));

ensureStorage();
ensureSchema();
ensureCommentSchema();
ensureHistorySchema();
ensurePlaylistSchema();
ensureSeriesSchema();
ensureStorySchema();
ensureAdsSchema();
ensureAdNetworksSchema();
ensurePaymentSchema();
ensureChatLimitsSchema();
ensureMembershipSchema();
ensureSupportSchema();
ensurePushSchema();
logger.info('videos storage and schema ensured');

// Specific routes first (before wildcards)
await app.register(searchRoutes, { prefix: '/api/v1/videos' });
await app.register(trendingRoutes, { prefix: '/api/v1/videos' });
await app.register(watchLaterRoutes, { prefix: '/api/v1/videos' });
await app.register(historyRoutes, { prefix: '/api/v1/videos' });
await app.register(playlistRoutes, { prefix: '/api/v1/videos' });
await app.register(videoRoutes, { prefix: '/api/v1/videos' });
await app.register(commentRoutes, { prefix: '/api/v1/videos' });
await app.register(adminReportRoutes, { prefix: '/api/v1/videos/admin' });

const PORT = 4003;
const start = async () => {
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`videos service listening on port ${PORT}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
