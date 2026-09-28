// melodyflix shared config
import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.string().default('info'),

  // Database - SQLite now, PostgreSQL later
  DB_TYPE: z.enum(['sqlite', 'postgres']).default('sqlite'),
  DB_PATH: z.string().default('./data/melodyflix.db'),
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().default(5432),
  DB_NAME: z.string().default('melodyflix'),
  DB_USER: z.string().default('melody'),
  DB_PASSWORD: z.string().default('melody'),

  // Redis
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),

  // Storage
  STORAGE_TYPE: z.enum(['local', 'minio', 's3']).default('local'),
  STORAGE_PATH: z.string().default('./data/videos'),
  MINIO_ENDPOINT: z.string().default('127.0.0.1'),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_ACCESS_KEY: z.string().default('minioadmin'),
  MINIO_SECRET_KEY: z.string().default('minioadmin'),
  MINIO_BUCKET: z.string().default('melodyflix'),

  // JWT
  JWT_SECRET: z.string().default('melodyflix-dev-secret-change-in-production'),
  JWT_EXPIRES_IN: z.string().default('7d'),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  return ConfigSchema.parse(process.env);
}
