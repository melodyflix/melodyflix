import Fastify from 'fastify';
import { loadConfig } from '@melodyflix/shared-config';
import { createLogger } from '@melodyflix/shared-logger';
import type { HealthStatus } from '@melodyflix/shared-types';

const config = loadConfig();
const logger = createLogger('health');
const app = Fastify({ logger });

const startedAt = Date.now();

app.get('/health', async (): Promise<HealthStatus> => ({
  service: 'health',
  status: 'ok',
  uptime: Math.floor((Date.now() - startedAt) / 1000),
  timestamp: new Date().toISOString(),
}));

app.get('/', async () => ({
  name: 'Melodyflix API',
  version: '0.0.1',
  message: 'Platform is running 🎬',
}));

const start = async () => {
  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    logger.info(`health service listening on port ${config.PORT}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
