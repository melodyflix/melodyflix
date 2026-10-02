// melodyflix videos — DVR worker (Section 40.4)
// Runs as a SEPARATE process from the Fastify server so that FFmpeg
// memory pressure does not kill the API. Polls the DB for due/expired
// recordings and manages their lifecycle.
//
// Usage:
//   MELODYFLIX_FFMPEG_ENABLED=1 tsx src/workers/dvr-worker.ts
//
// Env vars:
//   MELODYFLIX_FFMPEG_ENABLED  "1" to spawn real ffmpeg (default mock)
//   MELODYFLIX_RECORDINGS_DIR  where to write .mp4 files
//   MELODYFLIX_WORKER_INTERVAL_MS   poll interval, default 10000
//   MELODYFLIX_INTERNAL_SECRET     optional shared secret for API calls

import {
  ensureLiveTvSchema, ensureLiveTvDvrSchema,
  getDueRecordings, getExpiredRecordings,
  startFfmpegCapture, finalizeCapture, ensureRecordingsDir,
  getChannel,
} from '../services/livetv.service.js';

const INTERVAL_MS = parseInt(process.env.MELODYFLIX_WORKER_INTERVAL_MS ?? '10000', 10);
const FFMPEG_ENABLED = process.env.MELODYFLIX_FFMPEG_ENABLED === '1';

function log(msg: string, meta?: any) {
  const ts = new Date().toISOString();
  console.log(`[dvr-worker ${ts}] ${msg}`, meta ?? '');
}

async function tick(): Promise<void> {
  const now = new Date().toISOString();

  // 1. Finalize expired recordings first (so state frees up)
  try {
    const expired = getExpiredRecordings(now);
    for (const rec of expired) {
      log(`finalize ${rec.id.slice(0,8)} status=recording`);
      try {
        await finalizeCapture(rec.id);
        log(`  ✅ finalized`);
      } catch (e: any) {
        log(`  ❌ finalize failed`, e?.message);
      }
    }
  } catch (e: any) {
    log(`expired scan failed`, e?.message);
  }

  // 2. Start due recordings
  try {
    const due = getDueRecordings(now);
    for (const rec of due) {
      // Check window still valid
      const stopMs = new Date(rec.stop_ts).getTime();
      if (stopMs <= Date.now()) {
        log(`skip ${rec.id.slice(0,8)} already past stop`);
        continue;
      }

      const ch = getChannel(rec.channel_id);
      if (!ch) {
        log(`skip ${rec.id.slice(0,8)} channel missing`);
        continue;
      }

      log(`start ${rec.id.slice(0,8)} channel=${ch.name}`);
      try {
        const result = await startFfmpegCapture({
          recording_id: rec.id,
          channel_id: rec.channel_id,
          stream_url: ch.stream_url,
          start_ts: rec.start_ts,
          stop_ts: rec.stop_ts,
        });
        if (result.ok) {
          log(`  ✅ started pid=${result.pid}${result.mock ? ' (MOCK)' : ''}`);
        } else {
          log(`  ❌ start failed`, result.error);
        }
      } catch (e: any) {
        log(`  ❌ start threw`, e?.message);
      }
    }
  } catch (e: any) {
    log(`due scan failed`, e?.message);
  }
}

async function main() {
  log('booting', {
    ffmpeg_enabled: FFMPEG_ENABLED,
    interval_ms: INTERVAL_MS,
    pid: process.pid,
  });

  ensureLiveTvSchema();
  ensureLiveTvDvrSchema();
  const dir = await ensureRecordingsDir();
  log(`recordings dir: ${dir}`);
  log(`mode: ${FFMPEG_ENABLED ? 'REAL FFmpeg' : 'MOCK (metadata-only)'}`);

  // Graceful shutdown
  let stopping = false;
  const shutdown = (sig: string) => {
    if (stopping) return;
    stopping = true;
    log(`received ${sig}, stopping`);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Initial tick + interval
  await tick();
  const timer = setInterval(() => {
    if (stopping) return;
    tick().catch((e) => log('tick error', e?.message));
  }, INTERVAL_MS);

  log(`running, interval=${INTERVAL_MS}ms`);
  // Keep the process alive; worker is meant to run continuously.
  // Deploy under pm2/systemd/screen for production.
  void timer;
}

main().catch((e) => {
  console.error('[dvr-worker] fatal', e);
  process.exit(1);
});
