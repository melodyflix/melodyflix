// melodyflix auth - entry point
import Fastify from 'fastify';
import { loadConfig } from '@melodyflix/shared-config';
import { createLogger } from '@melodyflix/shared-logger';
import { authRoutes } from './routes/auth.route.js';
import { adminRoutes } from './routes/admin.route.js';
import { publicUserRoutes } from './routes/public.route.js';
import { twofaRoutes } from './routes/twofa.route.js';
import { emailRoutes } from './routes/email.route.js';
import { ensureSchema } from './services/auth.service.js';
import { ensureTwoFASchema } from './services/twofa.service.js';
import { ensureEmailSchema } from './services/email.service.js';
import { campaignRoutes } from './routes/campaign.route.js';
import { ensureCampaignSchema } from './services/campaign.service.js';
import { referralRoutes } from './routes/referral.route.js';
import { ensureReferralSchema } from './services/referral.service.js';
import { influencerRoutes } from './routes/influencer.route.js';
import { ensureInfluencerSchema } from './services/influencer.service.js';

const config = loadConfig();
const logger = createLogger('auth');
const app = Fastify({ logger: false });

app.addHook('onRequest', async (req, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') reply.code(204).send();
});

app.get('/health', async () => ({ service: 'auth', status: 'ok' }));

ensureSchema();
ensureTwoFASchema();
ensureEmailSchema();
ensureCampaignSchema();
ensureReferralSchema();
ensureInfluencerSchema();
logger.info('auth + 2FA + email schema ensured');

await app.register(authRoutes, { prefix: '/api/v1/auth' });
await app.register(twofaRoutes, { prefix: '/api/v1/auth' });
await app.register(adminRoutes, { prefix: '/api/v1/admin' });
await app.register(publicUserRoutes, { prefix: '/api/v1/auth' });
await app.register(campaignRoutes, { prefix: '/api/v1/auth' });
await app.register(referralRoutes, { prefix: '/api/v1/auth' });
await app.register(influencerRoutes, { prefix: '/api/v1/auth' });

const PORT = 4001;
const start = async () => {
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`auth service listening on port ${PORT}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
