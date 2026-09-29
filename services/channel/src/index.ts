// melodyflix channel - entry point
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { loadConfig } from '@melodyflix/shared-config';
import { createLogger } from '@melodyflix/shared-logger';
import { channelRoutes, channelUploadRoutes } from './routes/channel.route.js';
import { subscriptionsRoutes } from './routes/subscriptions.route.js';
import { channelAdminRoutes } from './routes/admin.route.js';
import { communityRoutes } from './routes/community.route.js';
import { ensureSchema } from './services/channel.service.js';
import { ensureCommunitySchema } from './services/community.service.js';
import { ensureChannelStorage } from './services/storage.service.js';

const config = loadConfig();
const logger = createLogger('channel');
const app = Fastify({ logger: false });

await app.register(multipart, {
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

app.addHook('onRequest', async (req, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') reply.code(204).send();
});

app.get('/health', async () => ({ service: 'channel', status: 'ok' }));

ensureSchema();
ensureCommunitySchema();
ensureChannelStorage();
logger.info('channel + community schema and storage ensured');

// Register specific routes BEFORE wildcards
await app.register(subscriptionsRoutes, { prefix: '/api/v1/channels' });
await app.register(channelAdminRoutes, { prefix: '/api/v1/channels' });
await app.register(communityRoutes, { prefix: '/api/v1/channels' });
await app.register(channelUploadRoutes, { prefix: '/api/v1/channels' });
await app.register(channelRoutes, { prefix: '/api/v1/channels' });

const PORT = 4002;
const start = async () => {
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`channel service listening on port ${PORT}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
