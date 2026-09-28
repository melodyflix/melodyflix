// melodyflix shared logger
import pino from 'pino';

export function createLogger(service: string) {
  return pino({
    name: service,
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.env.NODE_ENV === 'development' ? {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss' }
    } : undefined,
  });
}

export type Logger = ReturnType<typeof createLogger>;
