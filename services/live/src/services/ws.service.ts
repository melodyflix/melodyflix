// melodyflix live - WebSocket handlers for camera broadcasting
import { WebSocket } from 'ws';
import { createLogger } from '@melodyflix/shared-logger';
import { verifyJwt } from '@melodyflix/shared-auth';
import {
  getStreamById, getStreamByKey, updateStreamStatus,
  addViewer, removeViewer, postChat,
} from './live.service.js';
import { startCameraPipeline, streamPlaylistPath } from './pipeline.service.js';

const logger = createLogger('ws');

// Map: streamId → active broadcast socket
const broadcasters = new Map<string, WebSocket>();

export function getBroadcasterCount(): number {
  return broadcasters.size;
}

export function isLive(streamId: string): boolean {
  return broadcasters.has(streamId);
}

// ---------- Broadcaster (camera path) ----------
export function handleBroadcaster(ws: WebSocket, url: URL): void {
  const streamKey = url.searchParams.get('key');
  const token = url.searchParams.get('token');

  if (!streamKey) {
    ws.send(JSON.stringify({ type: 'error', message: 'Missing stream key' }));
    ws.close();
    return;
  }

  // Verify token
  let user: any = null;
  if (token) {
    try { user = verifyJwt(token); } catch {}
  }

  const stream = getStreamByKey(streamKey);
  if (!stream) {
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid stream key' }));
    ws.close();
    return;
  }

  if (user && user.sub !== stream.user_id) {
    ws.send(JSON.stringify({ type: 'error', message: 'Not authorized' }));
    ws.close();
    return;
  }

  if (broadcasters.has(stream.id)) {
    ws.send(JSON.stringify({ type: 'error', message: 'Stream already active' }));
    ws.close();
    return;
  }

  logger.info({ streamId: stream.id }, 'broadcaster connected');
  broadcasters.set(stream.id, ws);

  let pipeline = null;
  let totalBytes = 0;

  // Start FFmpeg pipeline
  pipeline = startCameraPipeline(stream.id, {
    onReady: () => {
      updateStreamStatus(stream.id, 'live', {
        hls_url: `/api/v1/live/${stream.id}/hls/index.m3u8`,
        started_at: new Date().toISOString(),
      });
      ws.send(JSON.stringify({
        type: 'ready',
        streamId: stream.id,
        hls: `/api/v1/live/${stream.id}/hls/index.m3u8`,
      }));
    },
    onEnded: () => {
      logger.info({ streamId: stream.id }, 'pipeline ended');
      updateStreamStatus(stream.id, 'ended', { ended_at: new Date().toISOString() });
      broadcasters.delete(stream.id);
      try { ws.close(); } catch {}
    },
    onError: (err) => {
      logger.error({ streamId: stream.id, err }, 'pipeline error');
      ws.send(JSON.stringify({ type: 'error', message: err }));
    },
  });

  if (!pipeline) {
    ws.send(JSON.stringify({ type: 'error', message: 'Could not start pipeline' }));
    ws.close();
    broadcasters.delete(stream.id);
    return;
  }

  // Update status to connecting
  updateStreamStatus(stream.id, 'connecting');

  ws.on('message', (data, isBinary) => {
    if (!pipeline) return;
    if (isBinary) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      totalBytes += buf.length;
      pipeline.write(buf);
    } else {
      // Text message — control commands
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'stop') {
          logger.info({ streamId: stream.id }, 'stop requested by broadcaster');
          pipeline.stop();
        }
      } catch {}
    }
  });

  ws.on('close', () => {
    logger.info({ streamId: stream.id, bytes: totalBytes }, 'broadcaster disconnected');
    if (pipeline) pipeline.stop();
    broadcasters.delete(stream.id);
    updateStreamStatus(stream.id, 'ended', { ended_at: new Date().toISOString() });
  });

  ws.on('error', (err) => {
    logger.error({ streamId: stream.id, err: err.message }, 'broadcaster ws error');
  });
}

// ---------- Viewer / Chat ----------
export function handleViewer(ws: WebSocket, url: URL): void {
  const streamId = url.searchParams.get('streamId');
  const token = url.searchParams.get('token');
  const username = url.searchParams.get('username') || 'Guest';

  if (!streamId) {
    ws.close();
    return;
  }

  const stream = getStreamById(streamId);
  if (!stream) {
    ws.send(JSON.stringify({ type: 'error', message: 'Stream not found' }));
    ws.close();
    return;
  }

  let user: any = null;
  if (token) {
    try { user = verifyJwt(token); } catch {}
  }

  const viewerId = addViewer(streamId, user?.sub ?? null, null);
  logger.info({ streamId, viewerId }, 'viewer joined');

  ws.send(JSON.stringify({
    type: 'joined',
    streamId,
    viewerCount: (getStreamById(streamId)?.viewer_count) ?? 0,
  }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'chat' && typeof msg.content === 'string') {
        const content = msg.content.slice(0, 500).trim();
        if (!content) return;
        const uname = (user ? (msg.username || username) : 'Guest').slice(0, 50);
        const chat = postChat(streamId, user?.sub ?? 'anonymous', uname, content);
        broadcastToViewers(streamId, {
          type: 'chat',
          chat: { id: chat.id, username: chat.username, content: chat.content, created_at: chat.created_at },
        });
      }
    } catch {}
  });

  ws.on('close', () => {
    removeViewer(viewerId);
    logger.info({ streamId, viewerId }, 'viewer left');
  });
}

// ---------- Broadcast chat to all viewers of a stream ----------
const viewerSockets = new Map<string, Set<WebSocket>>();

export function registerViewer(streamId: string, ws: WebSocket): void {
  if (!viewerSockets.has(streamId)) viewerSockets.set(streamId, new Set());
  viewerSockets.get(streamId)!.add(ws);
}

export function unregisterViewer(streamId: string, ws: WebSocket): void {
  const set = viewerSockets.get(streamId);
  if (set) set.delete(ws);
}

export function broadcastToViewers(streamId: string, msg: object): void {
  const set = viewerSockets.get(streamId);
  if (!set) return;
  const text = JSON.stringify(msg);
  for (const ws of set) {
    try {
      if (ws.readyState === 1) ws.send(text);
    } catch {}
  }
}
