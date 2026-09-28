// melodyflix notifications - entry point
import Fastify from 'fastify';
import { loadConfig } from '@melodyflix/shared-config';
import { createLogger } from '@melodyflix/shared-logger';
import { startSubscriptions } from '@melodyflix/shared-events';
import { notificationRoutes } from './routes/notification.route.js';
import { ensureSchema } from './services/notification.service.js';
import { startListeners } from './services/listener.service.js';

const config = loadConfig();
const logger = createLogger('notifications');
const app = Fastify({ logger: false });

app.addHook('onRequest', async (req, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') reply.code(204).send();
});

app.get('/health', async () => ({ service: 'notifications', status: 'ok' }));

ensureSchema();
logger.info('notifications schema ensured');

await app.register(notificationRoutes, { prefix: '/api/v1/notifications' });

const PORT = 4004;
const start = async () => {
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`notifications service listening on port ${PORT}`);

    // Register all event handlers first, then attach to Redis once
    startListeners();
    await startSubscriptions();
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
