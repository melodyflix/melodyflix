// melodyflix videos — Auto Content Worker (Section 37 orchestrator)
// Combines: due sources + RSS parser + fetch jobs + publishing decisions.
// Designed to be called from a cron worker (every minute or on-demand).
import { getDb } from '@melodyflix/shared-db';
import {
  listDueContentSources, markSourceFetched, createFetchJob,
  markJobFetching, markJobFailed, markJobDuplicate, markJobRejected,
  runQualityCheck, runCopyrightCheck, decidePublishAction,
  applySourceDefaults, isDuplicateGlobally,
  type ContentSource, type ExtractedMetadata,
} from './content-source.service.js';
import { fetchRssFeed, ensureRssParserSchema, type RssItem } from './rss-parser.service.js';

export interface WorkerRunResult {
  started_at: string;
  finished_at: string;
  sources_processed: number;
  jobs_created: number;
  jobs_deduped: number;
  jobs_rejected: number;
  errors: Array<{ source_id: string; error: string }>;
}

export function ensureContentWorkerSchema(): void {
  ensureRssParserSchema();
}

// ============================================================
// Metadata extraction
// ============================================================

function extractFromRssItem(item: RssItem): ExtractedMetadata {
  const tags: string[] = [];
  if (item.category) tags.push(item.category);
  const langMatch = item.title.match(/[\u0980-\u09FF]/) ? 'bn' : null;

  return {
    title: item.title,
    description: item.description,
    external_id: item.guid,
    release_date: item.pubDate,
    language: langMatch,
    thumbnail_url: item.image_url,
    tags,
    category: item.category,
  };
}

// ============================================================
// Process a single source
// ============================================================

export async function processSource(source: ContentSource): Promise<{
  created: number;
  deduped: number;
  rejected: number;
  errors: string[];
}> {
  const result = { created: 0, deduped: 0, rejected: 0, errors: [] as string[] };

  if (source.source_type !== 'rss' && source.source_type !== 'atom') {
    result.errors.push(`Unsupported source_type: ${source.source_type}`);
    return result;
  }

  let feed;
  try {
    feed = await fetchRssFeed(source.url, { use_cache_headers: true });
  } catch (e) {
    const msg = (e as Error).message;
    result.errors.push(msg);
    markSourceFetched(source.id, { success: false });
    return result;
  }

  // No items (304 not-modified, or empty feed)
  if (feed.items.length === 0) {
    markSourceFetched(source.id, { success: true, importsCount: 0 });
    return result;
  }

  for (const item of feed.items) {
    try {
      // Global dedupe (across all sources, by external_id)
      const meta = extractFromRssItem(item);
      const merged = applySourceDefaults(meta, source);

      // Quality check first
      const quality = runQualityCheck({
        title: merged.title,
        source_url: item.link ?? null,
        has_thumbnail: !!merged.thumbnail_url,
        has_description: !!merged.description,
        duration_seconds: null,
      });
      if (!quality.passed) {
        result.rejected += 1;
        continue;
      }

      // Copyright check (only if enabled on source)
      let copyright = { safe: true, matches: [] as Array<{ source: string; score: number; reference: string | null }>, notes: [] as string[] };
      if (source.copyright_check_enabled === 1) {
        copyright = runCopyrightCheck({ title: merged.title, description: merged.description, source_url: item.link });
      }

      // Publish decision
      const decision = decidePublishAction(source, quality, copyright);
      if (decision.action === 'reject') {
        result.rejected += 1;
        continue;
      }

      // Create fetch job (dedupe is checked inside createFetchJob)
      const job = createFetchJob({
        source_id: source.id,
        external_id: merged.external_id,
        source_url: item.link,
        title: merged.title,
        metadata: {
          ...merged,
          content_type: item.content_type,
          enclosure_url: item.enclosure_url,
          enclosure_type: item.enclosure_type,
          publish_action: decision.action,
          publish_reason: decision.reason,
        },
      });

      // If job already existed (deduped), its status won't be 'queued'
      if (job.status === 'skipped_duplicate') {
        result.deduped += 1;
      } else {
        result.created += 1;
      }
    } catch (e) {
      result.errors.push(`Item "${item.title}": ${(e as Error).message}`);
    }
  }

  markSourceFetched(source.id, {
    success: true,
    importsCount: result.created,
  });

  return result;
}

// ============================================================
// Worker main entry
// ============================================================

export async function runContentWorker(opts: { max_sources?: number; dry_run?: boolean } = {}): Promise<WorkerRunResult> {
  const startedAt = new Date().toISOString();
  const result: WorkerRunResult = {
    started_at: startedAt,
    finished_at: startedAt,
    sources_processed: 0,
    jobs_created: 0,
    jobs_deduped: 0,
    jobs_rejected: 0,
    errors: [],
  };

  const sources = listDueContentSources(opts.max_sources ?? 20);
  for (const src of sources) {
    if (opts.dry_run) {
      // Just count how many are due
      result.sources_processed += 1;
      continue;
    }
    try {
      const r = await processSource(src);
      result.sources_processed += 1;
      result.jobs_created += r.created;
      result.jobs_deduped += r.deduped;
      result.jobs_rejected += r.rejected;
      if (r.errors.length > 0) {
        result.errors.push({ source_id: src.id, error: r.errors.join('; ') });
      }
    } catch (e) {
      result.errors.push({ source_id: src.id, error: (e as Error).message });
    }
  }

  result.finished_at = new Date().toISOString();
  return result;
}

// ============================================================
// Worker state / stats
// ============================================================

export function getContentWorkerStats(): {
  active_sources: number;
  pending_approval: number;
  paused_sources: number;
  error_sources: number;
  queued_jobs: number;
  failed_jobs: number;
  completed_today: number;
} {
  const db = getDb();
  const active = (db.prepare("SELECT COUNT(*) as n FROM content_sources WHERE status = 'active'").get() as { n: number }).n;
  const pending = (db.prepare("SELECT COUNT(*) as n FROM content_sources WHERE status = 'pending_approval'").get() as { n: number }).n;
  const paused = (db.prepare("SELECT COUNT(*) as n FROM content_sources WHERE status = 'paused'").get() as { n: number }).n;
  const err = (db.prepare("SELECT COUNT(*) as n FROM content_sources WHERE status = 'error'").get() as { n: number }).n;
  const queued = (db.prepare("SELECT COUNT(*) as n FROM content_fetch_jobs WHERE status = 'queued'").get() as { n: number }).n;
  const failed = (db.prepare("SELECT COUNT(*) as n FROM content_fetch_jobs WHERE status = 'failed'").get() as { n: number }).n;
  const todayCutoff = new Date(Date.now() - 86400_000).toISOString();
  const completed = (db.prepare(
    "SELECT COUNT(*) as n FROM content_fetch_jobs WHERE status = 'completed' AND completed_at >= ?"
  ).get(todayCutoff) as { n: number }).n;
  return {
    active_sources: active,
    pending_approval: pending,
    paused_sources: paused,
    error_sources: err,
    queued_jobs: queued,
    failed_jobs: failed,
    completed_today: completed,
  };
}
