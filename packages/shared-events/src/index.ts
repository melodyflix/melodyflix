// melodyflix shared events - Redis pub/sub (single subscriber connection)
import Redis from 'ioredis';
import { loadConfig } from '@melodyflix/shared-config';
import { createLogger } from '@melodyflix/shared-logger';

const logger = createLogger('events');

let publisher: Redis | null = null;
let subscriber: Redis | null = null;

const handlers = new Map<string, (payload: any) => void | Promise<void>>();

function getPublisher(): Redis {
  if (!publisher) {
    const config = loadConfig();
    publisher = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3 });
  }
  return publisher;
}

function getSubscriber(): Redis {
  if (!subscriber) {
    const config = loadConfig();
    subscriber = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3 });
    subscriber.on('error', (err) => logger.error({ err }, 'subscriber error'));
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
  try {
    await getPublisher().publish(channel, JSON.stringify(payload));
    logger.debug({ channel }, 'event published');
  } catch (err) {
    logger.error({ err, channel }, 'publish failed');
  }
}

export function subscribe<T>(channel: string, handler: (payload: T) => void | Promise<void>): void {
  handlers.set(channel, handler as any);
  logger.info({ channel }, 'handler registered');
}

// Call this ONCE after all subscribe() calls to actually attach to Redis
export async function startSubscriptions(): Promise<void> {
  const sub = getSubscriber();
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
