// melodyflix shared health - reusable health + readiness checks
// Provides liveness (/health) and readiness (/ready) helpers.
import { getDb } from '@melodyflix/shared-db';
import { loadConfig } from '@melodyflix/shared-config';
import { statfsSync } from 'node:fs';

export type CheckStatus = 'ok' | 'degraded' | 'down';

export interface LivenessResult {
  service: string;
  status: 'ok';
  uptime: number;
  timestamp: string;
  version: string;
}

export interface ReadinessCheck {
  name: string;
  status: CheckStatus;
  latency_ms: number;
  message?: string;
}

export interface ReadinessResult {
  service: string;
  status: CheckStatus;
  timestamp: string;
  checks: ReadinessCheck[];
}

const startedAt = Date.now();
const VERSION = '0.0.1';

export function buildLiveness(service: string): LivenessResult {
  return {
    service,
    status: 'ok',
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    version: VERSION,
  };
}

// ============================================================
// Individual checks
// ============================================================

export function checkDatabase(): ReadinessCheck {
  const start = Date.now();
  try {
    const db = getDb();
    const row = db.prepare('SELECT 1 as ok').get() as { ok: number } | undefined;
    if (!row || row.ok !== 1) {
      return { name: 'database', status: 'down', latency_ms: Date.now() - start, message: 'unexpected query result' };
    }
    return { name: 'database', status: 'ok', latency_ms: Date.now() - start };
  } catch (err) {
    return { name: 'database', status: 'down', latency_ms: Date.now() - start, message: (err as Error).message };
  }
}

export async function checkRedis(): Promise<ReadinessCheck> {
  const start = Date.now();
  try {
    const config = loadConfig();
    // Lightweight TCP probe — no redis client dependency
    const url = new URL(config.REDIS_URL);
    const host = url.hostname;
    const port = parseInt(url.port || '6379', 10);

    const net = await import('node:net');
    const result = await new Promise<{ ok: boolean; msg?: string }>((resolve) => {
      const socket = net.connect({ host, port });
      const timeout = setTimeout(() => {
        socket.destroy();
        resolve({ ok: false, msg: 'connection timeout' });
      }, 2000);
      socket.on('connect', () => {
        clearTimeout(timeout);
        socket.end();
        resolve({ ok: true });
      });
      socket.on('error', (e) => {
        clearTimeout(timeout);
        resolve({ ok: false, msg: e.message });
      });
    });

    if (!result.ok) {
      return { name: 'redis', status: 'degraded', latency_ms: Date.now() - start, message: result.msg };
    }
    return { name: 'redis', status: 'ok', latency_ms: Date.now() - start };
  } catch (err) {
    return { name: 'redis', status: 'degraded', latency_ms: Date.now() - start, message: (err as Error).message };
  }
}

export function checkDisk(path = '/'): ReadinessCheck {
  const start = Date.now();
  try {
    const stats = statfsSync(path);
    const totalBytes = Number(stats.bsize) * Number(stats.blocks);
    const freeBytes = Number(stats.bsize) * Number(stats.bfree);
    const usedPercent = totalBytes > 0 ? ((totalBytes - freeBytes) / totalBytes) * 100 : 0;
    if (usedPercent > 95) {
      return { name: 'disk', status: 'down', latency_ms: Date.now() - start, message: `disk ${usedPercent.toFixed(1)}% full` };
    }
    if (usedPercent > 85) {
      return { name: 'disk', status: 'degraded', latency_ms: Date.now() - start, message: `disk ${usedPercent.toFixed(1)}% full` };
    }
    return { name: 'disk', status: 'ok', latency_ms: Date.now() - start };
  } catch (err) {
    return { name: 'disk', status: 'degraded', latency_ms: Date.now() - start, message: (err as Error).message };
  }
}

export function checkMemory(): ReadinessCheck {
  const start = Date.now();
  try {
    const mem = process.memoryUsage();
    const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
    const ratio = mem.heapTotal > 0 ? mem.heapUsed / mem.heapTotal : 0;
    if (ratio > 0.95) {
      return { name: 'memory', status: 'degraded', latency_ms: Date.now() - start, message: `heap ${heapUsedMB}/${heapTotalMB} MB` };
    }
    return { name: 'memory', status: 'ok', latency_ms: Date.now() - start };
  } catch (err) {
    return { name: 'memory', status: 'down', latency_ms: Date.now() - start, message: (err as Error).message };
  }
}

// ============================================================
// Aggregate readiness
// ============================================================

export interface ReadinessOptions {
  service: string;
  includeRedis?: boolean;
  diskPath?: string;
  skipDisk?: boolean;
}

export async function buildReadiness(opts: ReadinessOptions): Promise<ReadinessResult> {
  const checks: ReadinessCheck[] = [];
  checks.push(checkDatabase());
  checks.push(checkMemory());
  if (!opts.skipDisk) checks.push(checkDisk(opts.diskPath));
  if (opts.includeRedis) checks.push(await checkRedis());

  let overall: CheckStatus = 'ok';
  if (checks.some((c) => c.status === 'down')) overall = 'down';
  else if (checks.some((c) => c.status === 'degraded')) overall = 'degraded';

  return {
    service: opts.service,
    status: overall,
    timestamp: new Date().toISOString(),
    checks,
  };
}

// ============================================================
// Fastify route registration helper
// ============================================================

export interface RegisterHealthOptions {
  service: string;
  path?: string;
  readyPath?: string;
  includeRedis?: boolean;
  diskPath?: string;
}

export function registerHealthRoutes(app: any, opts: RegisterHealthOptions): void {
  const healthPath = opts.path || '/health';
  const readyPath = opts.readyPath || '/ready';

  app.get(healthPath, async () => buildLiveness(opts.service));

  app.get(readyPath, async (_req: any, reply: any) => {
    const result = await buildReadiness({
      service: opts.service,
      includeRedis: opts.includeRedis,
      diskPath: opts.diskPath,
    });
    const code = result.status === 'down' ? 503 : 200;
    return reply.code(code).send(result);
  });
}
