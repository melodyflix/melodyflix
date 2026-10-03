// melodyflix videos — AI Content Safety (8.11, 8.12, 8.13, 8.14, 8.15, 8.16)
// Unified safety-check API for all AI-mediated flows.
// Mock-safe; real provider gated by MELODYFLIX_AI_ENABLED=1.

import { randomUUID, createHash } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';
import { invokeText, createAiJob, markAiJobRunning, markAiJobDone } from './ai.service.js';

export type SafetyFeature =
  | 'content_filter'        // 8.11
  | 'inappropriate'         // 8.12
  | 'spam_comment'          // 8.13
  | 'fake_account'          // 8.14
  | 'hallucination'         // 8.15
  | 'prompt_safety';        // 8.16

export type SafetyVerdict = 'safe' | 'review' | 'blocked';
export type SafetySeverity = 'low' | 'medium' | 'high' | 'critical';

export function ensureAiSafetySchema(): void {
  const db = getDb();
  db.exec(`
    -- Categories registry (seeded by seedSafetyCategories)
    CREATE TABLE IF NOT EXISTS ai_safety_categories (
      id TEXT PRIMARY KEY,
      feature TEXT NOT NULL,
      category TEXT NOT NULL,
      display_name TEXT NOT NULL,
      default_severity TEXT NOT NULL DEFAULT 'medium'
        CHECK (default_severity IN ('low','medium','high','critical')),
      action TEXT NOT NULL DEFAULT 'review'
        CHECK (action IN ('allow','review','hide','block')),
      description TEXT,
      UNIQUE (feature, category)
    );

    -- Per-feature policy (who can override, thresholds)
    CREATE TABLE IF NOT EXISTS ai_safety_policies (
      owner_id TEXT PRIMARY KEY,
      strict_mode INTEGER NOT NULL DEFAULT 0,
      auto_hide_threshold REAL NOT NULL DEFAULT 0.85,
      auto_block_threshold REAL NOT NULL DEFAULT 0.95,
      review_threshold REAL NOT NULL DEFAULT 0.6,
      updated_at TEXT NOT NULL
    );

    -- Every check goes here (evidence stored as JSON, no raw PII)
    -- NOTE: D14.1 shipped a compact version; drop stale shape once, then
    -- recreate with the extended schema for D14.3.
    DROP TABLE IF EXISTS ai_safety_checks;
    CREATE TABLE IF NOT EXISTS ai_safety_checks (
      id TEXT PRIMARY KEY,
      feature TEXT NOT NULL,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      owner_id TEXT,
      requester_id TEXT,
      verdict TEXT NOT NULL CHECK (verdict IN ('safe','review','blocked')),
      score REAL NOT NULL DEFAULT 0,
      severity TEXT NOT NULL DEFAULT 'low'
        CHECK (severity IN ('low','medium','high','critical')),
      categories_json TEXT,
      rationale TEXT,
      input_hash TEXT,
      input_preview TEXT,
      action_taken TEXT,
      provider TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_safety_subject
      ON ai_safety_checks(subject_type, subject_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_safety_feature
      ON ai_safety_checks(feature, verdict, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_safety_owner
      ON ai_safety_checks(owner_id, created_at DESC);

    -- 8.14 Fake account signals — aggregate scores per user
    CREATE TABLE IF NOT EXISTS ai_user_trust (
      user_id TEXT PRIMARY KEY,
      trust_score REAL NOT NULL DEFAULT 100,
      suspicious_signals INTEGER NOT NULL DEFAULT 0,
      flagged_at TEXT,
      last_signal_at TEXT,
      notes TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trust_score ON ai_user_trust(trust_score);

    -- 8.13 Spam comment filter — dedup + user scoring
    CREATE TABLE IF NOT EXISTS ai_spam_hashes (
      hash TEXT PRIMARY KEY,
      first_seen_at TEXT NOT NULL,
      seen_count INTEGER NOT NULL DEFAULT 1,
      reporter_count INTEGER NOT NULL DEFAULT 0,
      auto_hidden INTEGER NOT NULL DEFAULT 0
    );
  `);

  seedSafetyCategories();
}

function seedSafetyCategories(): void {
  const db = getDb();
  const rows: Array<[SafetyFeature, string, string, SafetySeverity, string, string]> = [
    // feature, category, display_name, default_severity, action, description
    ['content_filter', 'profanity', 'Profanity', 'low', 'review', 'Mild to strong profanity'],
    ['content_filter', 'violence', 'Violence', 'high', 'hide', 'Graphic or inciting violence'],
    ['content_filter', 'hate', 'Hate speech', 'critical', 'block', 'Hate against protected classes'],
    ['content_filter', 'sexual', 'Sexual content', 'high', 'hide', 'Adult or explicit content'],
    ['inappropriate', 'nudity', 'Nudity', 'high', 'hide', 'Nudity in video/thumbnail'],
    ['inappropriate', 'self_harm', 'Self-harm', 'critical', 'block', 'Promotes self-harm'],
    ['inappropriate', 'drugs', 'Drug use', 'medium', 'review', 'Illegal drug promotion'],
    ['spam_comment', 'link_spam', 'Link spam', 'medium', 'hide', 'Unsolicited external links'],
    ['spam_comment', 'repetition', 'Repetition', 'low', 'review', 'Same comment repeated'],
    ['spam_comment', 'crypto_scam', 'Crypto scam', 'high', 'hide', 'Get-rich / crypto schemes'],
    ['spam_comment', 'promo_flood', 'Promo flood', 'medium', 'hide', 'Channel/self-promo flooding'],
    ['fake_account', 'new_low_activity', 'New + low activity', 'low', 'review', 'Account age + activity mismatch'],
    ['fake_account', 'coordinated', 'Coordinated behavior', 'high', 'review', 'Burst of identical behavior'],
    ['fake_account', 'impersonation', 'Impersonation', 'high', 'block', 'Mimics another creator'],
    ['fake_account', 'bot_pattern', 'Bot pattern', 'high', 'review', 'Automation signatures'],
    ['hallucination', 'unsupported_claim', 'Unsupported claim', 'medium', 'review', 'Claim not in source'],
    ['hallucination', 'fabricated_name', 'Fabricated name', 'medium', 'review', 'Name not present in source'],
    ['hallucination', 'fabricated_stat', 'Fabricated statistic', 'high', 'review', 'Number not in source'],
    ['prompt_safety', 'jailbreak', 'Jailbreak attempt', 'high', 'block', 'Attempts to bypass policy'],
    ['prompt_safety', 'injection', 'Prompt injection', 'high', 'block', 'Tries to hijack the system prompt'],
    ['prompt_safety', 'pii_extraction', 'PII extraction', 'critical', 'block', 'Attempts to extract PII'],
    ['prompt_safety', 'illegal_request', 'Illegal request', 'critical', 'block', 'Asks for illegal help'],
  ];
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO ai_safety_categories
      (id, feature, category, display_name, default_severity, action, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(feature, category) DO UPDATE SET
      display_name = excluded.display_name,
      default_severity = excluded.default_severity,
      action = excluded.action,
      description = excluded.description
  `);
  for (const [feature, category, display, severity, action, desc] of rows) {
    stmt.run(randomUUID(), feature, category, display, severity, action, desc);
  }
}

// ============================================================
// Policy (per-owner)
// ============================================================

export interface SafetyPolicy {
  owner_id: string;
  strict_mode: number;
  auto_hide_threshold: number;
  auto_block_threshold: number;
  review_threshold: number;
  updated_at: string;
}

export function getSafetyPolicy(ownerId: string): SafetyPolicy {
  const row = getDb().prepare(
    'SELECT * FROM ai_safety_policies WHERE owner_id = ?'
  ).get(ownerId) as SafetyPolicy | undefined;
  if (row) return row;
  return {
    owner_id: ownerId,
    strict_mode: 0,
    auto_hide_threshold: 0.85,
    auto_block_threshold: 0.95,
    review_threshold: 0.6,
    updated_at: new Date(0).toISOString(),
  };
}

export interface SetSafetyPolicyInput {
  strict_mode?: boolean;
  auto_hide_threshold?: number;
  auto_block_threshold?: number;
  review_threshold?: number;
}

export function setSafetyPolicy(ownerId: string, patch: SetSafetyPolicyInput): SafetyPolicy {
  const cur = getSafetyPolicy(ownerId);
  const now = new Date().toISOString();

  const rev = patch.review_threshold === undefined
    ? cur.review_threshold
    : Math.max(0.1, Math.min(patch.review_threshold, 0.9));
  const hide = patch.auto_hide_threshold === undefined
    ? cur.auto_hide_threshold
    : Math.max(rev + 0.01, Math.min(patch.auto_hide_threshold, 0.99));
  const block = patch.auto_block_threshold === undefined
    ? cur.auto_block_threshold
    : Math.max(hide + 0.005, Math.min(patch.auto_block_threshold, 1.0));

  const db = getDb();
  db.prepare(`
    INSERT INTO ai_safety_policies
      (owner_id, strict_mode, auto_hide_threshold, auto_block_threshold, review_threshold, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_id) DO UPDATE SET
      strict_mode = excluded.strict_mode,
      auto_hide_threshold = excluded.auto_hide_threshold,
      auto_block_threshold = excluded.auto_block_threshold,
      review_threshold = excluded.review_threshold,
      updated_at = excluded.updated_at
  `).run(
    ownerId,
    patch.strict_mode === undefined ? cur.strict_mode : (patch.strict_mode ? 1 : 0),
    hide, block, rev, now,
  );
  return getSafetyPolicy(ownerId);
}

// ============================================================
// Category listing
// ============================================================

export interface SafetyCategory {
  id: string;
  feature: string;
  category: string;
  display_name: string;
  default_severity: SafetySeverity;
  action: string;
  description: string | null;
}

export function listCategories(feature?: SafetyFeature): SafetyCategory[] {
  const db = getDb();
  if (feature) {
    return db.prepare(
      'SELECT * FROM ai_safety_categories WHERE feature = ? ORDER BY category ASC'
    ).all(feature) as SafetyCategory[];
  }
  return db.prepare(
    'SELECT * FROM ai_safety_categories ORDER BY feature ASC, category ASC'
  ).all() as SafetyCategory[];
}

// ============================================================
// Core check
// ============================================================

export function hashInput(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

export interface RunCheckInput {
  feature: SafetyFeature;
  subject_type: string;
  subject_id: string;
  content: string;
  owner_id?: string | null;
  requester_id?: string | null;
  context?: Record<string, any>;
}

export interface CheckResult {
  check_id: string;
  verdict: SafetyVerdict;
  score: number;
  severity: SafetySeverity;
  categories: { category: string; score: number; severity: SafetySeverity; action: string }[];
  rationale: string;
  action_taken: string | null;
  provider: string;
}

const SYSTEM_PROMPTS: Record<SafetyFeature, string> = {
  content_filter: 'Classify text for general content policy. Return: score | category | rationale.',
  inappropriate: 'Detect inappropriate content (nudity, drugs, self-harm). Return: score | category | rationale.',
  spam_comment: 'Detect spam in a comment (links, crypto, repetition, promo). Return: score | category | rationale.',
  fake_account: 'Assess account signals for inauthentic behavior. Return: score | category | rationale.',
  hallucination: 'Verify claims against source. Return: score | category | rationale.',
  prompt_safety: 'Detect prompt injection / jailbreak attempts. Return: score | category | rationale.',
};

// Deterministic mock safety classifier
function mockClassify(feature: SafetyFeature, content: string): {
  score: number;
  matched: { category: string; score: number }[];
  rationale: string;
} {
  const lower = content.toLowerCase();
  const rules: Record<SafetyFeature, Array<{ pattern: RegExp; category: string; weight: number }>> = {
    content_filter: [
      { pattern: /\b(fuck|shit|damn|bitch)\b/, category: 'profanity', weight: 0.65 },
      { pattern: /\b(kill|murder|stab)\b/, category: 'violence', weight: 0.85 },
      { pattern: /\b(hate|slur|inferior race)\b/, category: 'hate', weight: 0.95 },
      { pattern: /\b(porn|nude|xxx)\b/, category: 'sexual', weight: 0.9 },
    ],
    inappropriate: [
      { pattern: /\b(nude|naked|nsfw)\b/, category: 'nudity', weight: 0.9 },
      { pattern: /\b(kys|kill myself|self-?harm)\b/, category: 'self_harm', weight: 0.98 },
      { pattern: /\b(cocaine|heroin|meth)\b/, category: 'drugs', weight: 0.7 },
    ],
    spam_comment: [
      { pattern: /https?:\/\//, category: 'link_spam', weight: 0.65 },
      { pattern: /\b(crypto|bitcoin|btc|airdrop)\b/, category: 'crypto_scam', weight: 0.8 },
      { pattern: /(.)\1{10,}/, category: 'repetition', weight: 0.4 },
      { pattern: /\b(subscribe to me|check my channel)\b/, category: 'promo_flood', weight: 0.6 },
    ],
    fake_account: [
      { pattern: /\b(bot|autogenerated|test\s*account)\b/, category: 'bot_pattern', weight: 0.7 },
      { pattern: /\b(official|verified)\b.*\b(clone|impersonate)\b/, category: 'impersonation', weight: 0.85 },
    ],
    hallucination: [
      { pattern: /\b(guaranteed|100% sure|absolutely true)\b/, category: 'unsupported_claim', weight: 0.6 },
      { pattern: /\b(billion|trillion|99\.9%)\b/, category: 'fabricated_stat', weight: 0.65 },
    ],
    prompt_safety: [
      { pattern: /\b(ignore (?:all )?previous instructions|jailbreak|DAN|developer mode)\b/, category: 'jailbreak', weight: 0.96 },
      { pattern: /\bsystem prompt\b|\b(?:print|show|leak) (?:the )?prompt\b/, category: 'injection', weight: 0.96 },
      { pattern: /\b(ssn|credit card|password|api key)\b/, category: 'pii_extraction', weight: 0.97 },
      { pattern: /\b(how to (?:make|build) (?:a )?(?:bomb|explosive))\b/, category: 'illegal_request', weight: 0.98 },
    ],
  };

  const matched: { category: string; score: number }[] = [];
  let top = 0;
  for (const rule of rules[feature] ?? []) {
    if (rule.pattern.test(lower)) {
      matched.push({ category: rule.category, score: rule.weight });
      if (rule.weight > top) top = rule.weight;
    }
  }
  const rationale = matched.length > 0
    ? `Matched: ${matched.map((m) => m.category).join(', ')}`
    : 'No policy category matched';
  return { score: top, matched, rationale };
}

export async function runSafetyCheck(input: RunCheckInput): Promise<CheckResult> {
  const feature = input.feature;
  const policy = input.owner_id ? getSafetyPolicy(input.owner_id) : getSafetyPolicy('__default__');
  const mock = mockClassify(feature, input.content);

  // Real provider could refine — for now, use mock result and optionally
  // ask the LLM to summarize the rationale.
  let provider = 'mock';
  if (process.env.MELODYFLIX_AI_ENABLED === '1') {
    try {
      const res = await invokeText(feature, input.content.slice(0, 500), {
        system: SYSTEM_PROMPTS[feature],
        max_tokens: 200,
      });
      provider = res.provider;
      // Merge: take the higher of mock vs LLM-inferred score (placeholder)
      // For now we don't parse LLM output structurally.
    } catch {
      // Fall through — stay with mock verdict
    }
  }

  // Resolve categories with severity from DB
  const db = getDb();
  const categories = mock.matched.map((m) => {
    const row = db.prepare(
      'SELECT * FROM ai_safety_categories WHERE feature = ? AND category = ?'
    ).get(feature, m.category) as SafetyCategory | undefined;
    return {
      category: m.category,
      score: m.score,
      severity: (row?.default_severity ?? 'medium') as SafetySeverity,
      action: row?.action ?? 'review',
    };
  });

  // Determine verdict using thresholds
  const hideTh = policy.strict_mode ? Math.max(0.6, policy.auto_hide_threshold - 0.15) : policy.auto_hide_threshold;
  const blockTh = policy.strict_mode ? Math.max(0.75, policy.auto_block_threshold - 0.15) : policy.auto_block_threshold;

  let verdict: SafetyVerdict = 'safe';
  let severity: SafetySeverity = 'low';
  let action_taken: string | null = null;

  if (mock.score >= blockTh) {
    verdict = 'blocked';
    severity = 'critical';
    action_taken = 'blocked';
  } else if (mock.score >= hideTh) {
    verdict = 'review';
    severity = 'high';
    action_taken = 'auto_hidden';
  } else if (mock.score >= policy.review_threshold) {
    verdict = 'review';
    severity = 'medium';
    action_taken = 'flagged_for_review';
  } else if (mock.score > 0) {
    verdict = 'safe';
    severity = 'low';
    action_taken = 'allowed';
  }

  // Persist check
  const id = randomUUID();
  const now = new Date().toISOString();
  const inputHash = hashInput(input.content);
  const preview = input.content.slice(0, 200);

  db.prepare(`
    INSERT INTO ai_safety_checks
      (id, feature, subject_type, subject_id, owner_id, requester_id,
       verdict, score, severity, categories_json, rationale,
       input_hash, input_preview, action_taken, provider, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, feature, input.subject_type, input.subject_id,
    input.owner_id ?? null, input.requester_id ?? null,
    verdict, mock.score, severity,
    categories.length > 0 ? JSON.stringify(categories) : null,
    mock.rationale, inputHash, preview, action_taken, provider, now,
  );

  // Feature-specific side effects
  if (feature === 'spam_comment' && verdict !== 'safe') {
    const db2 = getDb();
    const h = hashInput(input.content);
    db2.prepare(`
      INSERT INTO ai_spam_hashes (hash, first_seen_at, seen_count, reporter_count, auto_hidden)
      VALUES (?, ?, 1, 0, ?)
      ON CONFLICT(hash) DO UPDATE SET
        seen_count = ai_spam_hashes.seen_count + 1,
        auto_hidden = MAX(ai_spam_hashes.auto_hidden, excluded.auto_hidden)
    `).run(h, now, verdict === 'blocked' || action_taken === 'auto_hidden' ? 1 : 0);
  }

  if (feature === 'fake_account' && verdict !== 'safe' && input.subject_id) {
    const db2 = getDb();
    const delta = severity === 'critical' ? 25 : severity === 'high' ? 15 : severity === 'medium' ? 8 : 3;
    db2.prepare(`
      INSERT INTO ai_user_trust (user_id, trust_score, suspicious_signals, flagged_at, last_signal_at, updated_at)
      VALUES (?, ?, 1, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        trust_score = MAX(0, ai_user_trust.trust_score - ?),
        suspicious_signals = ai_user_trust.suspicious_signals + 1,
        flagged_at = COALESCE(ai_user_trust.flagged_at, ?),
        last_signal_at = ?,
        updated_at = ?
    `).run(
      input.subject_id,
      100 - delta, now, now, now,
      delta, now, now, now,
    );
  }

  return {
    check_id: id,
    verdict,
    score: mock.score,
    severity,
    categories,
    rationale: mock.rationale,
    action_taken,
    provider,
  };
}

// ============================================================
// Query
// ============================================================

export interface SafetyCheckRow {
  id: string;
  feature: string;
  subject_type: string;
  subject_id: string;
  owner_id: string | null;
  requester_id: string | null;
  verdict: SafetyVerdict;
  score: number;
  severity: SafetySeverity;
  categories_json: string | null;
  rationale: string | null;
  input_hash: string | null;
  input_preview: string | null;
  action_taken: string | null;
  provider: string | null;
  created_at: string;
}

export function listChecks(opts: {
  feature?: SafetyFeature;
  subject_type?: string;
  subject_id?: string;
  owner_id?: string;
  verdict?: SafetyVerdict;
  severity?: SafetySeverity;
  limit?: number;
} = {}): SafetyCheckRow[] {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];
  if (opts.feature) { where.push('feature = ?'); params.push(opts.feature); }
  if (opts.subject_type) { where.push('subject_type = ?'); params.push(opts.subject_type); }
  if (opts.subject_id) { where.push('subject_id = ?'); params.push(opts.subject_id); }
  if (opts.owner_id) { where.push('owner_id = ?'); params.push(opts.owner_id); }
  if (opts.verdict) { where.push('verdict = ?'); params.push(opts.verdict); }
  if (opts.severity) { where.push('severity = ?'); params.push(opts.severity); }
  const n = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  params.push(n);
  return db.prepare(`
    SELECT * FROM ai_safety_checks
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT ?
  `).all(...params) as SafetyCheckRow[];
}

export function getCheck(id: string): SafetyCheckRow | null {
  return (getDb().prepare('SELECT * FROM ai_safety_checks WHERE id = ?')
    .get(id) as SafetyCheckRow | undefined) ?? null;
}

// ============================================================
// 8.14 User trust
// ============================================================

export interface UserTrust {
  user_id: string;
  trust_score: number;
  suspicious_signals: number;
  flagged_at: string | null;
  last_signal_at: string | null;
  notes: string | null;
  updated_at: string;
}

export function getUserTrust(userId: string): UserTrust {
  const row = getDb().prepare('SELECT * FROM ai_user_trust WHERE user_id = ?')
    .get(userId) as UserTrust | undefined;
  if (row) return row;
  return {
    user_id: userId,
    trust_score: 100,
    suspicious_signals: 0,
    flagged_at: null,
    last_signal_at: null,
    notes: null,
    updated_at: new Date(0).toISOString(),
  };
}

export function adjustUserTrust(userId: string, delta: number, note?: string | null): UserTrust {
  const db = getDb();
  const cur = getUserTrust(userId);
  const nextScore = Math.max(0, Math.min(100, cur.trust_score + delta));
  const now = new Date().toISOString();
  const flagged = nextScore < 60 ? now : cur.flagged_at;
  db.prepare(`
    INSERT INTO ai_user_trust (user_id, trust_score, suspicious_signals, flagged_at, last_signal_at, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      trust_score = excluded.trust_score,
      flagged_at = excluded.flagged_at,
      last_signal_at = excluded.last_signal_at,
      notes = COALESCE(excluded.notes, ai_user_trust.notes),
      updated_at = excluded.updated_at
  `).run(
    userId, nextScore,
    delta < 0 ? cur.suspicious_signals + 1 : cur.suspicious_signals,
    flagged, now, note ?? null, now,
  );
  return getUserTrust(userId);
}

export function listLowTrustUsers(threshold = 60, limit = 100): UserTrust[] {
  const n = Math.min(Math.max(limit, 1), 500);
  return getDb().prepare(
    'SELECT * FROM ai_user_trust WHERE trust_score < ? ORDER BY trust_score ASC LIMIT ?'
  ).all(threshold, n) as UserTrust[];
}

// ============================================================
// 8.13 Spam hash lookup
// ============================================================

export interface SpamHashRow {
  hash: string;
  first_seen_at: string;
  seen_count: number;
  reporter_count: number;
  auto_hidden: number;
}

export function getSpamHash(hash: string): SpamHashRow | null {
  return (getDb().prepare('SELECT * FROM ai_spam_hashes WHERE hash = ?')
    .get(hash) as SpamHashRow | undefined) ?? null;
}

export function recordSpamReport(content: string): SpamHashRow {
  const db = getDb();
  const h = hashInput(content);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO ai_spam_hashes (hash, first_seen_at, seen_count, reporter_count, auto_hidden)
    VALUES (?, ?, 1, 1, 0)
    ON CONFLICT(hash) DO UPDATE SET
      reporter_count = ai_spam_hashes.reporter_count + 1
  `).run(h, now);
  return getSpamHash(h)!;
}

// ============================================================
// Stats / summary
// ============================================================

export interface SafetyStats {
  window_start: string;
  window_end: string;
  total: number;
  safe: number;
  review: number;
  blocked: number;
  by_feature: { feature: string; count: number }[];
  by_severity: { severity: string; count: number }[];
  low_trust_users: number;
  spam_hashes: number;
}

export function getSafetyStats(opts: { from?: string; to?: string } = {}): SafetyStats {
  const db = getDb();
  const to = opts.to ?? new Date().toISOString();
  const from = opts.from ?? new Date(Date.now() - 30 * 86400_000).toISOString();

  const totals = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN verdict='safe'    THEN 1 ELSE 0 END) as safe,
      SUM(CASE WHEN verdict='review'  THEN 1 ELSE 0 END) as review,
      SUM(CASE WHEN verdict='blocked' THEN 1 ELSE 0 END) as blocked
    FROM ai_safety_checks WHERE created_at >= ? AND created_at <= ?
  `).get(from, to) as any;

  const byFeature = db.prepare(`
    SELECT feature, COUNT(*) as count FROM ai_safety_checks
    WHERE created_at >= ? AND created_at <= ?
    GROUP BY feature ORDER BY count DESC
  `).all(from, to) as { feature: string; count: number }[];

  const bySeverity = db.prepare(`
    SELECT severity, COUNT(*) as count FROM ai_safety_checks
    WHERE created_at >= ? AND created_at <= ?
    GROUP BY severity
  `).all(from, to) as { severity: string; count: number }[];

  const lowTrust = (db.prepare(
    'SELECT COUNT(*) as n FROM ai_user_trust WHERE trust_score < 60'
  ).get() as { n: number }).n;

  const spamCount = (db.prepare('SELECT COUNT(*) as n FROM ai_spam_hashes').get() as { n: number }).n;

  return {
    window_start: from,
    window_end: to,
    total: totals.total ?? 0,
    safe: totals.safe ?? 0,
    review: totals.review ?? 0,
    blocked: totals.blocked ?? 0,
    by_feature: byFeature,
    by_severity: bySeverity,
    low_trust_users: lowTrust,
    spam_hashes: spamCount,
  };
}

// Convenience wrappers per feature
export async function checkContentFilter(input: Omit<RunCheckInput, 'feature'>): Promise<CheckResult> {
  return runSafetyCheck({ ...input, feature: 'content_filter' });
}
export async function checkInappropriate(input: Omit<RunCheckInput, 'feature'>): Promise<CheckResult> {
  return runSafetyCheck({ ...input, feature: 'inappropriate' });
}
export async function checkSpamComment(input: Omit<RunCheckInput, 'feature'>): Promise<CheckResult> {
  return runSafetyCheck({ ...input, feature: 'spam_comment' });
}
export async function checkFakeAccount(input: Omit<RunCheckInput, 'feature'>): Promise<CheckResult> {
  return runSafetyCheck({ ...input, feature: 'fake_account' });
}
export async function checkHallucination(input: Omit<RunCheckInput, 'feature'>): Promise<CheckResult> {
  return runSafetyCheck({ ...input, feature: 'hallucination' });
}
export async function checkPromptSafety(input: Omit<RunCheckInput, 'feature'>): Promise<CheckResult> {
  return runSafetyCheck({ ...input, feature: 'prompt_safety' });
}
