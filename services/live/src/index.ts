// melodyflix live - entry point (HTTP + WebSocket)
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { loadConfig } from '@melodyflix/shared-config';
import { createLogger } from '@melodyflix/shared-logger';
import { liveRoutes } from './routes/live.route.js';
import { superChatRoutes } from './routes/superchat.route.js';
import { moderationRoutes } from './routes/moderation.route.js';
import { ensureSchema, cleanupStaleStreams } from './services/live.service.js';
import { ensureSuperChatSchema } from './services/superchat.service.js';
import { ensureModerationSchema } from './services/moderation.service.js';
import { ensureHlsStorage, stopAllPipelines } from './services/pipeline.service.js';
import { handleBroadcaster, handleViewer, registerViewer, unregisterViewer } from './services/ws.service.js';
import { startRtmpServer, stopRtmpServer } from './services/rtmp.service.js';

const config = loadConfig();
const logger = createLogger('live');
const app = Fastify({ logger: false });

await app.register(websocket, {
  options: { maxPayload: 10 * 1024 * 1024 }, // 10 MB per chunk
});

app.addHook('onRequest', async (req, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') reply.code(204).send();
});

app.get('/health', async () => ({ service: 'live', status: 'ok' }));

ensureSchema();
ensureSuperChatSchema();
ensureModerationSchema();
ensureHlsStorage();
logger.info('live schema and HLS storage ensured');

// Cleanup any stale streams from previous runs
const cleaned = cleanupStaleStreams(2);
if (cleaned > 0) logger.info({ cleaned }, 'cleaned up stale streams');

// ---------- WebSocket routes ----------
app.get('/ws/broadcast', { websocket: true }, (conn: any, req: any) => {
  const url = new URL(req.url, 'http://localhost');
  handleBroadcaster(conn.socket ?? conn, url);
});

app.get('/ws/viewer', { websocket: true }, (conn: any, req: any) => {
  const url = new URL(req.url, 'http://localhost');
  const ws = conn.socket ?? conn;
  const streamId = url.searchParams.get('streamId');
  if (streamId) {
    registerViewer(streamId, ws);
    ws.on('close', () => unregisterViewer(streamId, ws));
  }
  handleViewer(ws, url);
});

// ---------- HTTP routes ----------
await app.register(liveRoutes, { prefix: '/api/v1/live' });
await app.register(moderationRoutes, { prefix: '/api/v1/live' });

const PORT = 4005;
const start = async () => {
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`live service listening on port ${PORT}`);

    // Start RTMP ingest server
    try {
      startRtmpServer();
    } catch (err) {
      logger.error({ err }, 'failed to start RTMP server');
    }
    logger.info('WebSocket endpoints:');
    logger.info('  - Broadcaster: ws://127.0.0.1:4005/ws/broadcast?key=STREAM_KEY&token=JWT');
    logger.info('  - Viewer:      ws://127.0.0.1:4005/ws/viewer?streamId=ID&token=JWT');
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
function shutdown() {
  logger.info('shutting down...');
  stopAllPipelines();
  try { stopRtmpServer(); } catch {}
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
