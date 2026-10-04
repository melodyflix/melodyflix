// melodyflix shared config
// Loads .env file (zero-dependency) + validates via zod.
// Fails fast in production if critical secrets are missing or default.
import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ============================================================
// Lightweight .env loader (no external dependency)
// ============================================================

function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadEnvFiles(): void {
  // Candidate paths in order of priority (later wins)
  const candidates = [
    process.env.ENV_FILE,
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(process.cwd(), '../../configs/.env.production'),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);

  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      const content = readFileSync(path, 'utf8');
      const parsed = parseEnvFile(content);
      for (const [k, v] of Object.entries(parsed)) {
        // Only set if not already set by shell (shell overrides .env)
        if (process.env[k] === undefined) process.env[k] = v;
      }
    } catch { /* silent */ }
  }
}

// ============================================================
// Schema
// ============================================================

const DEV_DEFAULT_JWT = 'melodyflix-dev-secret-change-in-production';
const DEV_DEFAULT_DB_PASSWORD = 'melody';
const DEV_DEFAULT_MINIO_SECRET = 'minioadmin';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.string().default('info'),

  // Database
  DB_TYPE: z.enum(['sqlite', 'postgres']).default('sqlite'),
  DB_PATH: z.string().default('./data/melodyflix.db'),
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().default(5432),
  DB_NAME: z.string().default('melodyflix'),
  DB_USER: z.string().default('melody'),
  DB_PASSWORD: z.string().default(DEV_DEFAULT_DB_PASSWORD),

  // Redis
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),

  // Storage
  STORAGE_TYPE: z.enum(['local', 'minio', 's3']).default('local'),
  STORAGE_PATH: z.string().default('./data/videos'),
  MINIO_ENDPOINT: z.string().default('127.0.0.1'),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_ACCESS_KEY: z.string().default('minioadmin'),
  MINIO_SECRET_KEY: z.string().default(DEV_DEFAULT_MINIO_SECRET),
  MINIO_BUCKET: z.string().default('melodyflix'),

  // JWT
  JWT_SECRET: z.string().default(DEV_DEFAULT_JWT),
  JWT_EXPIRES_IN: z.string().default('7d'),
});

export type Config = z.infer<typeof ConfigSchema>;

// ============================================================
// Production safety checks
// ============================================================

export class ProductionConfigError extends Error {
  constructor(msg: string) { super(msg); this.name = 'ProductionConfigError'; }
}

function enforceProductionSafety(cfg: Config): void {
  if (cfg.NODE_ENV !== 'production') return;
  const problems: string[] = [];

  if (cfg.JWT_SECRET === DEV_DEFAULT_JWT) {
    problems.push('JWT_SECRET is still the dev default — generate a real secret (min 32 chars)');
  }
  if (cfg.JWT_SECRET.length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters in production');
  }
  if (cfg.DB_TYPE === 'postgres' && cfg.DB_PASSWORD === DEV_DEFAULT_DB_PASSWORD) {
    problems.push('DB_PASSWORD is still the dev default (melody)');
  }
  if (cfg.STORAGE_TYPE === 'minio' && cfg.MINIO_SECRET_KEY === DEV_DEFAULT_MINIO_SECRET) {
    problems.push('MINIO_SECRET_KEY is still the dev default (minioadmin)');
  }
  if (cfg.STORAGE_TYPE === 'minio' && cfg.MINIO_ACCESS_KEY === 'minioadmin'
      && cfg.MINIO_SECRET_KEY === DEV_DEFAULT_MINIO_SECRET) {
    problems.push('MINIO credentials are still defaults — change both access + secret');
  }

  if (problems.length > 0) {
    const msg = [
      '',
      '╔══════════════════════════════════════════════════════════════╗',
      '║  FATAL: production config safety checks failed              ║',
      '╚══════════════════════════════════════════════════════════════╝',
      ...problems.map((p) => '  ✗ ' + p),
      '',
      'Fix these in .env (or configs/.env.production) and restart.',
      '',
    ].join('\n');
    throw new ProductionConfigError(msg);
  }
}

// ============================================================
// Public API
// ============================================================

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;

  // Load .env once, before parsing
  loadEnvFiles();

  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ✗ ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}\n`);
  }

  enforceProductionSafety(parsed.data);
  cached = parsed.data;
  return cached;
}

export function resetConfigCache(): void {
  cached = null;
}
