// melodyflix videos - Section 60.4 Appeal Review (moderation side)
// Bridge between the Section 11.7 appeal system and Section 60
// moderation. Moderators review appeals about comment/video
// removals, see original decision context, and either uphold or
// overturn (restoring the content).
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';
import { getAppeal } from '../sections/section-11-security-privacy/appeal.service.js';

export type ModerationReviewAction = 'uphold' | 'overturn' | 'request_info';
export type ModerationAppealKind = 'comment' | 'video' | 'channel' | 'other';

export interface ModerationAppealReview {
  id: string;
  appeal_id: string;
  moderator_id: string;
  action: ModerationReviewAction;
  reason: string | null;
  restore_action: string | null;
  original_decision: string | null;
  restored: number;
  created_at: string;
}

export function ensureModerationAppealSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS moderation_appeal_reviews (
      id TEXT PRIMARY KEY,
      appeal_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      action TEXT NOT NULL
        CHECK (action IN ('uphold','overturn','request_info')),
      reason TEXT,
      restore_action TEXT,
      original_decision TEXT,
      restored INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mar_appeal ON moderation_appeal_reviews(appeal_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mar_moderator ON moderation_appeal_reviews(moderator_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mar_action ON moderation_appeal_reviews(action, created_at DESC);
  `);
}

export interface ModerationAppealItem {
  appeal_id: string;
  user_id: string;
  appeal_type: string;
  target_type: string | null;
  target_id: string | null;
  subject: string;
  description: string;
  status: string;
  priority: string;
  assigned_to: string | null;
  created_at: string;
  due_at: string | null;
  last_review: ModerationAppealReview | null;
}

function normalizeKind(t?: string | null): ModerationAppealKind {
  if (!t) return 'other';
  const s = t.toLowerCase();
  if (s === 'comment') return 'comment';
  if (s === 'video' || s === 'content') return 'video';
  if (s === 'channel') return 'channel';
  return 'other';
}

// List moderation-relevant appeals (target_type comment/video/content or
// appeal_type content_removal/strike). Optionally filter by status.
export function listModerationAppeals(opts: {
  status?: string;
  kind?: ModerationAppealKind;
  limit?: number;
} = {}): { appeals: ModerationAppealItem[]; total: number } {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const cond: string[] = [
    "(target_type IN ('comment','video','content','channel') OR appeal_type IN ('content_removal','strike'))",
  ];
  const params: unknown[] = [];
  if (opts.status) { cond.push('status = ?'); params.push(opts.status); }
  if (opts.kind && opts.kind !== 'other') {
    const map: Record<ModerationAppealKind, string[]> = {
      comment: ['comment'],
      video: ['video', 'content'],
      channel: ['channel'],
      other: [],
    };
    const types = map[opts.kind];
    if (types.length > 0) {
      const ph = types.map(() => '?').join(',');
      cond.push(`target_type IN (${ph})`);
      params.push(...types);
    }
  }
  const where = `WHERE ${cond.join(' AND ')}`;
  const rows = db.prepare(
    `SELECT * FROM appeals ${where} ORDER BY
       CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
       created_at ASC
     LIMIT ?`
  ).all(...params, limit) as any[];
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM appeals ${where}`).get(...params) as { c: number }).c;
  const items: ModerationAppealItem[] = rows.map(r => {
    const last = getLastReview(r.id);
    return {
      appeal_id: r.id,
      user_id: r.user_id,
      appeal_type: r.appeal_type,
      target_type: r.target_type,
      target_id: r.target_id,
      subject: r.subject,
      description: r.description,
      status: r.status,
      priority: r.priority,
      assigned_to: r.assigned_to,
      created_at: r.created_at,
      due_at: r.due_at,
      last_review: last,
    };
  });
  return { appeals: items, total };
}

function getLastReview(appealId: string): ModerationAppealReview | null {
  const db = getDb();
  return (db.prepare(
    'SELECT * FROM moderation_appeal_reviews WHERE appeal_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(appealId) as ModerationAppealReview | undefined) ?? null;
}

export interface ModerationContext {
  appeal_id: string;
  kind: ModerationAppealKind;
  target_id: string | null;
  original_report: { id: string; reason: string; note: string | null; status: string; created_at: string } | null;
  target_exists: boolean;
  target_is_deleted: boolean;
}

export function getModerationContext(appealId: string): ModerationContext | null {
  const db = getDb();
  const appeal = getAppeal(appealId);
  if (!appeal) return null;
  const kind = normalizeKind(appeal.target_type);
  let original_report: ModerationContext['original_report'] = null;
  let target_exists = false;
  let target_is_deleted = false;

  if (kind === 'comment' && appeal.target_id) {
    try {
      const r = db.prepare(
        "SELECT id, reason, note, status, created_at FROM comment_reports WHERE comment_id = ? ORDER BY created_at DESC LIMIT 1"
      ).get(appeal.target_id) as any;
      if (r) original_report = r;
    } catch { /* table may not exist in some DBs */ }
    try {
      const c = db.prepare('SELECT is_deleted FROM comments WHERE id = ?').get(appeal.target_id) as { is_deleted: number } | undefined;
      if (c) { target_exists = true; target_is_deleted = c.is_deleted === 1; }
    } catch { /* */ }
  } else if (kind === 'video' && appeal.target_id) {
    try {
      const v = db.prepare('SELECT id, status FROM videos WHERE id = ?').get(appeal.target_id) as { id: string; status: string } | undefined;
      if (v) { target_exists = true; target_is_deleted = v.status === 'removed' || v.status === 'deleted'; }
    } catch { /* */ }
  }

  return {
    appeal_id: appealId,
    kind,
    target_id: appeal.target_id,
    original_report,
    target_exists,
    target_is_deleted,
  };
}

export interface ReviewInput {
  action: ModerationReviewAction;
  reason?: string | null;
  original_decision?: string | null;
}

export interface ReviewOutcome {
  review: ModerationAppealReview;
  appeal_status_after: string;
  restored: boolean;
}

export function reviewAppeal(appealId: string, moderatorId: string, input: ReviewInput): ReviewOutcome {
  const db = getDb();
  const appeal = getAppeal(appealId);
  if (!appeal) throw new Error('appeal_not_found');
  if (appeal.status === 'withdrawn' || appeal.status === 'expired') {
    throw new Error('appeal_closed');
  }
  const kind = normalizeKind(appeal.target_type);
  const now = new Date().toISOString();
  const reviewId = randomUUID();
  let restoreAction: string | null = null;
  let restored = 0;

  if (input.action === 'overturn' && appeal.target_id) {
    if (kind === 'comment') {
      try {
        const r = db.prepare(
          "UPDATE comments SET is_deleted = 0, content = COALESCE(NULLIF(content,'[deleted]'), '[restored]'), updated_at = ? WHERE id = ? AND is_deleted = 1"
        ).run(now, appeal.target_id);
        if (r.changes > 0) { restored = 1; restoreAction = 'comment_restored'; }
        // also dismiss the report
        try {
          db.prepare(
            "UPDATE comment_reports SET status = 'dismissed' WHERE comment_id = ? AND status = 'pending'"
          ).run(appeal.target_id);
        } catch { /* */ }
      } catch { /* */ }
    } else if (kind === 'video') {
      try {
        const r = db.prepare(
          "UPDATE videos SET status = 'ready', updated_at = ? WHERE id = ? AND status IN ('removed','deleted')"
        ).run(now, appeal.target_id);
        if (r.changes > 0) { restored = 1; restoreAction = 'video_restored'; }
      } catch { /* */ }
    }
  }

  // Insert review row
  db.prepare(`
    INSERT INTO moderation_appeal_reviews
    (id, appeal_id, moderator_id, action, reason, restore_action, original_decision, restored, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    reviewId, appealId, moderatorId, input.action,
    input.reason ?? null, restoreAction,
    input.original_decision ?? null, restored, now,
  );

  // Update appeal status in the 11.7 system
  let nextStatus = appeal.status;
  if (input.action === 'uphold') nextStatus = 'rejected';
  else if (input.action === 'overturn') nextStatus = 'approved';
  else if (input.action === 'request_info') nextStatus = 'awaiting_user';

  db.prepare(
    'UPDATE appeals SET status = ?, resolution_note = ?, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?'
  ).run(
    nextStatus,
    input.reason ?? null,
    moderatorId,
    input.action === 'request_info' ? null : now,
    now, appealId,
  );

  // Audit event in the appeal_events table (11.7 consistency)
  try {
    db.prepare(`
      INSERT INTO appeal_events (id, appeal_id, actor_id, event_type, note, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), appealId, moderatorId, `moderation_${input.action}`,
      input.reason ?? null,
      JSON.stringify({ restored, restore_action: restoreAction, kind }),
      now,
    );
  } catch { /* */ }

  const review = db.prepare('SELECT * FROM moderation_appeal_reviews WHERE id = ?').get(reviewId) as ModerationAppealReview;
  return { review, appeal_status_after: nextStatus, restored: restored > 0 };
}

export function listReviewsForAppeal(appealId: string): ModerationAppealReview[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM moderation_appeal_reviews WHERE appeal_id = ? ORDER BY created_at ASC'
  ).all(appealId) as ModerationAppealReview[];
}

export interface ModerationAppealStats {
  total_moderation_appeals: number;
  pending: number;
  upheld: number;
  overturned: number;
  awaiting_user: number;
  by_kind: Record<ModerationAppealKind, number>;
  avg_review_hours: number | null;
  window_days: number;
}

export function getModerationAppealStats(windowDays = 30): ModerationAppealStats {
  const db = getDb();
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const baseCond = "(target_type IN ('comment','video','content','channel') OR appeal_type IN ('content_removal','strike')) AND created_at >= ?";
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM appeals WHERE ${baseCond}`).get(since) as { c: number }).c;
  const pending = (db.prepare(`SELECT COUNT(*) AS c FROM appeals WHERE ${baseCond} AND status IN ('submitted','under_review','awaiting_user')`).get(since) as { c: number }).c;
  const upheld = (db.prepare("SELECT COUNT(*) AS c FROM moderation_appeal_reviews WHERE action = 'uphold' AND created_at >= ?").get(since) as { c: number }).c;
  const overturned = (db.prepare("SELECT COUNT(*) AS c FROM moderation_appeal_reviews WHERE action = 'overturn' AND created_at >= ?").get(since) as { c: number }).c;
  const awaiting = (db.prepare(`SELECT COUNT(*) AS c FROM appeals WHERE ${baseCond} AND status = 'awaiting_user'`).get(since) as { c: number }).c;
  const by_kind: Record<ModerationAppealKind, number> = { comment: 0, video: 0, channel: 0, other: 0 };
  const kinds = db.prepare(
    `SELECT target_type, COUNT(*) AS c FROM appeals WHERE ${baseCond} GROUP BY target_type`
  ).all(since) as Array<{ target_type: string | null; c: number }>;
  for (const k of kinds) by_kind[normalizeKind(k.target_type)] += k.c;
  const avgRow = db.prepare(
    `SELECT AVG((julianday(r.created_at) - julianday(a.created_at)) * 24.0) AS avg_h
     FROM moderation_appeal_reviews r
     JOIN appeals a ON a.id = r.appeal_id
     WHERE r.created_at >= ?`
  ).get(since) as { avg_h: number | null };
  return {
    total_moderation_appeals: total,
    pending,
    upheld,
    overturned,
    awaiting_user: awaiting,
    by_kind,
    avg_review_hours: avgRow.avg_h ?? null,
    window_days: windowDays,
  };
}
