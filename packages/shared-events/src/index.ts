// melodyflix shared events - Redis pub/sub (single subscriber connection)
import Redis from 'ioredis';
import { loadConfig } from '@melodyflix/shared-config';
import { createLogger } from '@melodyflix/shared-logger';

const logger = createLogger('events');

let publisher: Redis | null = null;
let subscriber: Redis | null = null;

const handlers = new Map<string, (payload: any) => void | Promise<void>>();

const REDIS_DISABLED = process.env.DISABLE_REDIS === '1' || !process.env.REDIS_URL;

function getPublisher(): Redis | null {
  if (REDIS_DISABLED) return null;
  if (!publisher) {
    const config = loadConfig();
    publisher = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: (times) => times > 2 ? null : 1000,
    });
    publisher.on('error', () => { /* swallow — logged once at start */ });
  }
  return publisher;
}

function getSubscriber(): Redis | null {
  if (REDIS_DISABLED) return null;
  if (!subscriber) {
    const config = loadConfig();
    subscriber = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: (times) => times > 2 ? null : 1000,
    });
    subscriber.on('error', () => { /* swallow */ });
    subscriber.on('message', async (channel, message) => {
      const handler = handlers.get(channel);
      if (!handler) return;
      try {
        await handler(JSON.parse(message));
      } catch (err) {
        logger.error({ err, channel }, 'event handler failed');
      }
    });
  }
  return subscriber;
}

export async function publish<T>(channel: string, payload: T): Promise<void> {
  if (REDIS_DISABLED) return;   // silent no-op when Redis disabled
  const pub = getPublisher();
  if (!pub) return;
  try {
    await pub.publish(channel, JSON.stringify(payload));
    logger.debug({ channel }, 'event published');
  } catch {
    // silent — Redis optional
  }
}

export function subscribe<T>(channel: string, handler: (payload: T) => void | Promise<void>): void {
  handlers.set(channel, handler as any);
  logger.info({ channel }, 'handler registered');
}

// Call this ONCE after all subscribe() calls to actually attach to Redis
export async function startSubscriptions(): Promise<void> {
  if (REDIS_DISABLED) {
    logger.info('Redis disabled — subscriptions skipped');
    return;
  }
  const sub = getSubscriber();
  if (!sub) return;
  const channels = Array.from(handlers.keys());
  if (channels.length === 0) return;
  try {
    await sub.subscribe(...channels);
    logger.info({ channels }, 'subscribed to all channels');
  } catch (err) {
    logger.error({ err }, 'batch subscribe failed');
  }
}

export const CHANNELS = {
  USER_CREATED: 'user.created',
  VIDEO_UPLOADED: 'video.uploaded',
  VIDEO_TRANSCODED: 'video.transcoded',
  COMMENT_POSTED: 'comment.posted',
  VIDEO_LIKED: 'video.liked',
  CHANNEL_FOLLOWED: 'channel.followed',
  NOTIFICATION_CREATED: 'notification.created',
} as const;
