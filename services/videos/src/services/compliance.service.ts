// melodyflix videos - video compliance (Section 50)
//
// COPPA, age-gate, content rating, regional rules, checklists,
// evidence, audit reports, policy versioning.

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export function ensureComplianceSchema(): void {
  const db = getDb();
  db.exec(`
    -- 50.1 COPPA + 50.3 content rating per video
    CREATE TABLE IF NOT EXISTS video_compliance (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL UNIQUE,
      coppa_child_directed INTEGER NOT NULL DEFAULT 0,
      coppa_personal_info_collected INTEGER NOT NULL DEFAULT 0,
      age_rating TEXT NOT NULL DEFAULT 'unrated',
      regional_ratings_json TEXT NOT NULL DEFAULT '{}',
      requires_age_gate INTEGER NOT NULL DEFAULT 0,
      min_age INTEGER NOT NULL DEFAULT 0,
      regional_restrictions_json TEXT NOT NULL DEFAULT '[]',
      last_reviewed_at TEXT,
      last_reviewed_by TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vc_video ON video_compliance(video_id);
    CREATE INDEX IF NOT EXISTS idx_vc_rating ON video_compliance(age_rating);
    CREATE INDEX IF NOT EXISTS idx_vc_coppa ON video_compliance(coppa_child_directed);

    -- 50.8 policy versioning
    CREATE TABLE IF NOT EXISTS compliance_policies (
      id TEXT PRIMARY KEY,
      policy_key TEXT NOT NULL,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      body_md TEXT NOT NULL,
      effective_at TEXT NOT NULL,
      supersedes_id TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_by TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(policy_key, version)
    );
    CREATE INDEX IF NOT EXISTS idx_cp_key ON compliance_policies(policy_key);
    CREATE INDEX IF NOT EXISTS idx_cp_status ON compliance_policies(status);
    CREATE INDEX IF NOT EXISTS idx_cp_effective ON compliance_policies(effective_at);

    -- 50.4 regional rules
    CREATE TABLE IF NOT EXISTS regional_compliance_rules (
      id TEXT PRIMARY KEY,
      country TEXT NOT NULL,
      region TEXT,
      regulation TEXT NOT NULL,
      rule_key TEXT NOT NULL,
      rule_value_json TEXT NOT NULL DEFAULT '{}',
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rcr_country ON regional_compliance_rules(country);
    CREATE INDEX IF NOT EXISTS idx_rcr_reg ON regional_compliance_rules(regulation);

    -- 50.5 checklist templates
    CREATE TABLE IF NOT EXISTS compliance_checklist_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      scope TEXT NOT NULL,
      description TEXT,
      items_json TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cct_scope ON compliance_checklist_templates(scope);

    -- 50.5 per-target checklist runs
    CREATE TABLE IF NOT EXISTS compliance_checklist_runs (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_progress',
      responses_json TEXT NOT NULL DEFAULT '{}',
      score REAL NOT NULL DEFAULT 0,
      completed_by TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ccr_target ON compliance_checklist_runs(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_ccr_template ON compliance_checklist_runs(template_id);

    -- 50.6 evidence
    CREATE TABLE IF NOT EXISTS compliance_evidence (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'file',
      title TEXT NOT NULL,
      url TEXT,
      body_text TEXT,
      mime_type TEXT,
      size_bytes INTEGER,
      hash_sha256 TEXT,
      collected_by TEXT,
      collected_at TEXT NOT NULL,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cev_target ON compliance_evidence(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_cev_kind ON compliance_evidence(kind);

    -- 50.7 audit reports
    CREATE TABLE IF NOT EXISTS compliance_audit_reports (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      summary_json TEXT NOT NULL DEFAULT '{}',
      findings_json TEXT NOT NULL DEFAULT '[]',
      score REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      generated_by TEXT,
      generated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_car_target ON compliance_audit_reports(target_type, target_id);

    -- 50.2 age verification (users) — compliance scope
    CREATE TABLE IF NOT EXISTS compliance_age_verifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      verified_at TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'self_declared',
      min_age INTEGER NOT NULL DEFAULT 18,
      country TEXT,
      status TEXT NOT NULL DEFAULT 'verified',
      meta_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_cavg_user ON compliance_age_verifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_cavg_status ON compliance_age_verifications(status);
  `);
}

// ---------- 50.1 / 50.2 / 50.3 Video compliance record ----------

export type AgeRating = 'unrated' | 'G' | 'PG' | 'PG-13' | 'R' | 'NC-17' | 'TV-Y' | 'TV-G' | 'TV-PG' | 'TV-14' | 'TV-MA';

export const AGE_RATING_MIN_AGE: Record<AgeRating, number> = {
  'unrated': 0, 'G': 0, 'PG': 7, 'PG-13': 13, 'R': 17, 'NC-17': 18,
  'TV-Y': 0, 'TV-G': 0, 'TV-PG': 7, 'TV-14': 14, 'TV-MA': 17,
};

export interface VideoCompliance {
  id: string;
  video_id: string;
  coppa_child_directed: boolean;
  coppa_personal_info_collected: boolean;
  age_rating: AgeRating;
  regional_ratings: Record<string, string>;
  requires_age_gate: boolean;
  min_age: number;
  regional_restrictions: Array<{ country: string; reason: string }>;
  last_reviewed_at: string | null;
  last_reviewed_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface VcRow {
  id: string; video_id: string;
  coppa_child_directed: number; coppa_personal_info_collected: number;
  age_rating: string; regional_ratings_json: string;
  requires_age_gate: number; min_age: number; regional_restrictions_json: string;
  last_reviewed_at: string | null; last_reviewed_by: string | null;
  notes: string | null; created_at: string; updated_at: string;
}

function safeParse<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function vcRowToObj(row: VcRow): VideoCompliance {
  return {
    id: row.id, video_id: row.video_id,
    coppa_child_directed: row.coppa_child_directed === 1,
    coppa_personal_info_collected: row.coppa_personal_info_collected === 1,
    age_rating: row.age_rating as AgeRating,
    regional_ratings: safeParse<Record<string, string>>(row.regional_ratings_json, {}),
    requires_age_gate: row.requires_age_gate === 1,
    min_age: row.min_age,
    regional_restrictions: safeParse<Array<{ country: string; reason: string }>>(row.regional_restrictions_json, []),
    last_reviewed_at: row.last_reviewed_at,
    last_reviewed_by: row.last_reviewed_by,
    notes: row.notes,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

export function getVideoCompliance(videoId: string): VideoCompliance | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM video_compliance WHERE video_id = ?').get(videoId) as VcRow | undefined;
  return row ? vcRowToObj(row) : null;
}

/** Get or create default compliance record for a video. */
export function ensureVideoCompliance(videoId: string): VideoCompliance {
  const existing = getVideoCompliance(videoId);
  if (existing) return existing;
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO video_compliance (id, video_id, age_rating, created_at, updated_at)
    VALUES (?, ?, 'unrated', ?, ?)
  `).run(id, videoId, now, now);
  return getVideoCompliance(videoId)!;
}

export interface SetVideoComplianceInput {
  coppa_child_directed?: boolean;
  coppa_personal_info_collected?: boolean;
  age_rating?: AgeRating;
  regional_ratings?: Record<string, string>;
  requires_age_gate?: boolean;
  min_age?: number;
  regional_restrictions?: Array<{ country: string; reason: string }>;
  notes?: string | null;
  reviewed_by?: string;
}

export function setVideoCompliance(videoId: string, input: SetVideoComplianceInput): VideoCompliance {
  const cur = ensureVideoCompliance(videoId);
  const db = getDb();
  const now = new Date().toISOString();

  let ageRating = input.age_rating ?? cur.age_rating;
  let requiresGate = input.requires_age_gate ?? cur.requires_age_gate;
  let minAge = input.min_age ?? cur.min_age;

  // auto-derive: if age_rating provided and requires_gate unset, gate when >= PG-13 / R
  if (input.age_rating && input.requires_age_gate === undefined) {
    const impliedMin = AGE_RATING_MIN_AGE[input.age_rating];
    if (impliedMin >= 13) requiresGate = true;
  }
  if (input.age_rating && input.min_age === undefined) {
    minAge = AGE_RATING_MIN_AGE[input.age_rating] || 0;
  }

  // COPPA: child-directed auto-gates + requires restriction from personalized content
  if (input.coppa_child_directed === true) {
    // child-directed implies age rating TV-Y / G and no personal info
    if (!input.age_rating) ageRating = 'TV-Y';
  }

  db.prepare(`
    UPDATE video_compliance SET
      coppa_child_directed = ?, coppa_personal_info_collected = ?,
      age_rating = ?, regional_ratings_json = ?, requires_age_gate = ?, min_age = ?,
      regional_restrictions_json = ?, notes = ?,
      last_reviewed_at = ?, last_reviewed_by = ?,
      updated_at = ?
    WHERE video_id = ?
  `).run(
    input.coppa_child_directed !== undefined ? (input.coppa_child_directed ? 1 : 0) : (cur.coppa_child_directed ? 1 : 0),
    input.coppa_personal_info_collected !== undefined ? (input.coppa_personal_info_collected ? 1 : 0) : (cur.coppa_personal_info_collected ? 1 : 0),
    ageRating,
    JSON.stringify(input.regional_ratings ?? cur.regional_ratings),
    requiresGate ? 1 : 0,
    minAge,
    JSON.stringify(input.regional_restrictions ?? cur.regional_restrictions),
    input.notes !== undefined ? input.notes : cur.notes,
    input.reviewed_by ? now : cur.last_reviewed_at,
    input.reviewed_by ?? cur.last_reviewed_by,
    now, videoId,
  );
  return getVideoCompliance(videoId)!;
}

export function listComplianceByRating(rating: AgeRating): VideoCompliance[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM video_compliance WHERE age_rating = ?').all(rating) as VcRow[];
  return rows.map(vcRowToObj);
}

export function listGatedVideos(): VideoCompliance[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM video_compliance WHERE requires_age_gate = 1').all() as VcRow[];
  return rows.map(vcRowToObj);
}

export function listCoppaVideos(): VideoCompliance[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM video_compliance WHERE coppa_child_directed = 1').all() as VcRow[];
  return rows.map(vcRowToObj);
}

/**
 * Check whether a viewer meets the age gate for a video.
 * Returns { allowed, reason? }.
 */
export function canView(
  compliance: VideoCompliance,
  viewerAge: number | null,
  viewerCountry?: string,
): { allowed: boolean; reason?: string } {
  // regional restrictions
  if (viewerCountry) {
    const rest = compliance.regional_restrictions.find((r) => r.country.toUpperCase() === viewerCountry.toUpperCase());
    if (rest) return { allowed: false, reason: `Restricted in ${viewerCountry}: ${rest.reason}` };
  }
  if (compliance.requires_age_gate) {
    if (viewerAge === null) return { allowed: false, reason: 'Age verification required' };
    if (viewerAge < compliance.min_age) {
      return { allowed: false, reason: `Requires age ${compliance.min_age}+` };
    }
  }
  return { allowed: true };
}

// ---------- 50.2 Age verification (users) ----------

export interface AgeVerification {
  id: string;
  user_id: string;
  verified_at: string;
  method: string;
  min_age: number;
  country: string | null;
  status: 'verified' | 'pending' | 'failed';
  meta: Record<string, unknown>;
}

interface AverRow {
  id: string; user_id: string; verified_at: string; method: string;
  min_age: number; country: string | null; status: string; meta_json: string;
}

function avRowToObj(row: AverRow): AgeVerification {
  return {
    id: row.id, user_id: row.user_id, verified_at: row.verified_at,
    method: row.method, min_age: row.min_age, country: row.country,
    status: row.status as AgeVerification['status'],
    meta: safeParse<Record<string, unknown>>(row.meta_json, {}),
  };
}

export function recordAgeVerification(input: {
  user_id: string;
  method?: string;
  min_age?: number;
  country?: string;
  status?: AgeVerification['status'];
  meta?: Record<string, unknown>;
}): AgeVerification {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO compliance_age_verifications (id, user_id, verified_at, method, min_age, country, status, meta_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.user_id, now,
    input.method ?? 'self_declared', input.min_age ?? 18,
    input.country ?? null, input.status ?? 'verified',
    JSON.stringify(input.meta ?? {}),
  );
  return avRowToObj(db.prepare('SELECT * FROM compliance_age_verifications WHERE id = ?').get(id) as AverRow);
}

export function getAgeVerification(userId: string): AgeVerification | null {
  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM compliance_age_verifications WHERE user_id = ? AND status = 'verified' ORDER BY verified_at DESC LIMIT 1"
  ).get(userId) as AverRow | undefined;
  return row ? avRowToObj(row) : null;
}

export function listAgeVerifications(userId: string): AgeVerification[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM compliance_age_verifications WHERE user_id = ? ORDER BY verified_at DESC')
    .all(userId) as AverRow[];
  return rows.map(avRowToObj);
}

// ---------- 50.4 Regional compliance rules ----------

export interface RegionalRule {
  id: string;
  country: string;
  region: string | null;
  regulation: string;
  rule_key: string;
  rule_value: Record<string, unknown>;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface RcrRow {
  id: string; country: string; region: string | null; regulation: string;
  rule_key: string; rule_value_json: string; description: string | null;
  is_active: number; created_at: string; updated_at: string;
}

function rcrRowToObj(row: RcrRow): RegionalRule {
  return {
    id: row.id, country: row.country, region: row.region,
    regulation: row.regulation, rule_key: row.rule_key,
    rule_value: safeParse<Record<string, unknown>>(row.rule_value_json, {}),
    description: row.description,
    is_active: row.is_active === 1,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

export function upsertRegionalRule(input: {
  country: string;
  region?: string | null;
  regulation: string;
  rule_key: string;
  rule_value?: Record<string, unknown>;
  description?: string;
  is_active?: boolean;
}): RegionalRule {
  const db = getDb();
  const country = input.country.toUpperCase().trim();
  if (country.length !== 2) throw new Error('country must be 2-letter code');
  const existing = db.prepare(
    "SELECT * FROM regional_compliance_rules WHERE country = ? AND COALESCE(region, '') = ? AND regulation = ? AND rule_key = ?"
  ).get(country, input.region ?? '', input.regulation, input.rule_key) as RcrRow | undefined;
  const now = new Date().toISOString();
  if (existing) {
    db.prepare(`
      UPDATE regional_compliance_rules SET rule_value_json = ?, description = ?, is_active = ?, updated_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(input.rule_value ?? {}),
      input.description ?? existing.description,
      input.is_active !== undefined ? (input.is_active ? 1 : 0) : existing.is_active,
      now, existing.id,
    );
    return rcrRowToObj(db.prepare('SELECT * FROM regional_compliance_rules WHERE id = ?').get(existing.id) as RcrRow);
  }
  const id = randomUUID();
  db.prepare(`
    INSERT INTO regional_compliance_rules (id, country, region, regulation, rule_key, rule_value_json, description, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, country, input.region ?? null, input.regulation, input.rule_key,
    JSON.stringify(input.rule_value ?? {}), input.description ?? null,
    input.is_active === false ? 0 : 1, now, now,
  );
  return rcrRowToObj(db.prepare('SELECT * FROM regional_compliance_rules WHERE id = ?').get(id) as RcrRow);
}

export function listRegionalRules(country?: string): RegionalRule[] {
  const db = getDb();
  const rows = country
    ? db.prepare('SELECT * FROM regional_compliance_rules WHERE country = ? ORDER BY regulation, rule_key').all(country.toUpperCase()) as RcrRow[]
    : db.prepare('SELECT * FROM regional_compliance_rules ORDER BY country, regulation, rule_key').all() as RcrRow[];
  return rows.map(rcrRowToObj);
}

export function deleteRegionalRule(id: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM regional_compliance_rules WHERE id = ?').run(id).changes > 0;
}

// ---------- 50.5 Compliance checklists ----------

export interface ChecklistTemplate {
  id: string;
  name: string;
  scope: string;
  description: string | null;
  items: Array<{ key: string; label: string; required: boolean; weight?: number }>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface CctRow {
  id: string; name: string; scope: string; description: string | null;
  items_json: string; is_active: number; created_at: string; updated_at: string;
}

function cctRowToObj(row: CctRow): ChecklistTemplate {
  return {
    id: row.id, name: row.name, scope: row.scope, description: row.description,
    items: safeParse<ChecklistTemplate['items']>(row.items_json, []),
    is_active: row.is_active === 1,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

export function createChecklistTemplate(input: {
  name: string; scope: string; description?: string;
  items: Array<{ key: string; label: string; required: boolean; weight?: number }>;
}): ChecklistTemplate {
  const db = getDb();
  if (!input.name?.trim()) throw new Error('name required');
  if (!input.items?.length) throw new Error('items required');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO compliance_checklist_templates (id, name, scope, description, items_json, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, input.name.trim(), input.scope, input.description ?? null, JSON.stringify(input.items), now, now);
  return cctRowToObj(db.prepare('SELECT * FROM compliance_checklist_templates WHERE id = ?').get(id) as CctRow);
}

export function listChecklistTemplates(scope?: string): ChecklistTemplate[] {
  const db = getDb();
  const rows = scope
    ? db.prepare('SELECT * FROM compliance_checklist_templates WHERE scope = ? ORDER BY updated_at DESC').all(scope) as CctRow[]
    : db.prepare('SELECT * FROM compliance_checklist_templates ORDER BY updated_at DESC').all() as CctRow[];
  return rows.map(cctRowToObj);
}

export function getChecklistTemplate(id: string): ChecklistTemplate | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM compliance_checklist_templates WHERE id = ?').get(id) as CctRow | undefined;
  return row ? cctRowToObj(row) : null;
}

export function deleteChecklistTemplate(id: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM compliance_checklist_templates WHERE id = ?').run(id).changes > 0;
}

export interface ChecklistRun {
  id: string;
  template_id: string;
  target_type: string;
  target_id: string;
  status: 'in_progress' | 'completed' | 'expired';
  responses: Record<string, { passed: boolean; note?: string; checked_at?: string }>;
  score: number;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CcrRow {
  id: string; template_id: string; target_type: string; target_id: string;
  status: string; responses_json: string; score: number;
  completed_by: string | null; completed_at: string | null;
  created_at: string; updated_at: string;
}

function ccrRowToObj(row: CcrRow): ChecklistRun {
  return {
    id: row.id, template_id: row.template_id,
    target_type: row.target_type, target_id: row.target_id,
    status: row.status as ChecklistRun['status'],
    responses: safeParse<ChecklistRun['responses']>(row.responses_json, {}),
    score: row.score,
    completed_by: row.completed_by, completed_at: row.completed_at,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

export function startChecklistRun(input: {
  template_id: string; target_type: string; target_id: string;
}): ChecklistRun {
  const db = getDb();
  if (!getChecklistTemplate(input.template_id)) throw new Error('template not found');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO compliance_checklist_runs (id, template_id, target_type, target_id, status, responses_json, score, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'in_progress', '{}', 0, ?, ?)
  `).run(id, input.template_id, input.target_type, input.target_id, now, now);
  return ccrRowToObj(db.prepare('SELECT * FROM compliance_checklist_runs WHERE id = ?').get(id) as CcrRow);
}

export function getChecklistRun(id: string): ChecklistRun | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM compliance_checklist_runs WHERE id = ?').get(id) as CcrRow | undefined;
  return row ? ccrRowToObj(row) : null;
}

export function listChecklistRuns(targetType?: string, targetId?: string): ChecklistRun[] {
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (targetType) { where.push('target_type = ?'); params.push(targetType); }
  if (targetId) { where.push('target_id = ?'); params.push(targetId); }
  const sql = `SELECT * FROM compliance_checklist_runs${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`;
  const rows = db.prepare(sql).all(...params) as CcrRow[];
  return rows.map(ccrRowToObj);
}

export function updateChecklistRun(id: string, patch: {
  responses?: ChecklistRun['responses'];
  complete?: boolean;
  completed_by?: string;
}): ChecklistRun | null {
  const db = getDb();
  const cur = getChecklistRun(id);
  if (!cur) return null;
  const tpl = getChecklistTemplate(cur.template_id);
  const responses = patch.responses !== undefined ? { ...cur.responses, ...patch.responses } : cur.responses;

  // score = weighted pass ratio
  let score = 0;
  if (tpl) {
    const totalWeight = tpl.items.reduce((s, i) => s + (i.weight ?? 1), 0);
    let passedWeight = 0;
    for (const item of tpl.items) {
      if (responses[item.key]?.passed) passedWeight += (item.weight ?? 1);
    }
    score = totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 10000) / 100 : 0;
  }

  const now = new Date().toISOString();
  const status = patch.complete ? 'completed' : cur.status;
  const completedAt = patch.complete ? now : cur.completed_at;
  db.prepare(`
    UPDATE compliance_checklist_runs SET responses_json = ?, score = ?, status = ?, completed_by = COALESCE(?, completed_by), completed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify(responses), score, status,
    patch.completed_by ?? null, completedAt, now, id,
  );
  return getChecklistRun(id);
}

// ---------- 50.6 Evidence ----------

export interface ComplianceEvidence {
  id: string;
  target_type: string;
  target_id: string;
  kind: 'file' | 'url' | 'text' | 'screenshot';
  title: string;
  url: string | null;
  body_text: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  hash_sha256: string | null;
  collected_by: string | null;
  collected_at: string;
  notes: string | null;
}

interface CevRow {
  id: string; target_type: string; target_id: string; kind: string;
  title: string; url: string | null; body_text: string | null;
  mime_type: string | null; size_bytes: number | null; hash_sha256: string | null;
  collected_by: string | null; collected_at: string; notes: string | null;
}

function cevRowToObj(row: CevRow): ComplianceEvidence {
  return {
    id: row.id, target_type: row.target_type, target_id: row.target_id,
    kind: row.kind as ComplianceEvidence['kind'],
    title: row.title, url: row.url, body_text: row.body_text,
    mime_type: row.mime_type, size_bytes: row.size_bytes,
    hash_sha256: row.hash_sha256, collected_by: row.collected_by,
    collected_at: row.collected_at, notes: row.notes,
  };
}

export function addEvidence(input: {
  target_type: string; target_id: string;
  kind?: ComplianceEvidence['kind'];
  title: string; url?: string; body_text?: string;
  mime_type?: string; size_bytes?: number; hash_sha256?: string;
  collected_by?: string; notes?: string;
}): ComplianceEvidence {
  const db = getDb();
  if (!input.title?.trim()) throw new Error('title required');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO compliance_evidence (id, target_type, target_id, kind, title, url, body_text, mime_type, size_bytes, hash_sha256, collected_by, collected_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.target_type, input.target_id,
    input.kind ?? 'file', input.title.trim(),
    input.url ?? null, input.body_text ?? null,
    input.mime_type ?? null, input.size_bytes ?? null, input.hash_sha256 ?? null,
    input.collected_by ?? null, now, input.notes ?? null,
  );
  return cevRowToObj(db.prepare('SELECT * FROM compliance_evidence WHERE id = ?').get(id) as CevRow);
}

export function listEvidence(targetType: string, targetId: string): ComplianceEvidence[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM compliance_evidence WHERE target_type = ? AND target_id = ? ORDER BY collected_at DESC'
  ).all(targetType, targetId) as CevRow[];
  return rows.map(cevRowToObj);
}

export function deleteEvidence(id: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM compliance_evidence WHERE id = ?').run(id).changes > 0;
}

// ---------- 50.8 Policy versioning ----------

export interface CompliancePolicy {
  id: string;
  policy_key: string;
  version: number;
  title: string;
  body_md: string;
  effective_at: string;
  supersedes_id: string | null;
  status: 'draft' | 'published' | 'retired';
  created_by: string | null;
  created_at: string;
}

interface CpRow {
  id: string; policy_key: string; version: number; title: string; body_md: string;
  effective_at: string; supersedes_id: string | null; status: string;
  created_by: string | null; created_at: string;
}

function cpRowToObj(row: CpRow): CompliancePolicy {
  return {
    id: row.id, policy_key: row.policy_key, version: row.version,
    title: row.title, body_md: row.body_md,
    effective_at: row.effective_at, supersedes_id: row.supersedes_id,
    status: row.status as CompliancePolicy['status'],
    created_by: row.created_by, created_at: row.created_at,
  };
}

export function createPolicyVersion(input: {
  policy_key: string;
  title: string;
  body_md: string;
  effective_at?: string;
  created_by?: string;
  supersede_current?: boolean;
}): CompliancePolicy {
  const db = getDb();
  const key = input.policy_key.trim().toLowerCase();
  if (!key) throw new Error('policy_key required');
  // latest version
  const latest = db.prepare(
    'SELECT MAX(version) as v FROM compliance_policies WHERE policy_key = ?'
  ).get(key) as { v: number | null };
  const nextVersion = (latest.v ?? 0) + 1;
  const currentPublished = db.prepare(
    "SELECT id FROM compliance_policies WHERE policy_key = ? AND status = 'published' ORDER BY version DESC LIMIT 1"
  ).get(key) as { id: string } | undefined;

  const id = randomUUID();
  const now = new Date().toISOString();
  const effective = input.effective_at ?? now;

  if (input.supersede_current && currentPublished) {
    db.prepare("UPDATE compliance_policies SET status = 'retired' WHERE id = ?").run(currentPublished.id);
  }

  db.prepare(`
    INSERT INTO compliance_policies (id, policy_key, version, title, body_md, effective_at, supersedes_id, status, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
  `).run(
    id, key, nextVersion, input.title.trim(), input.body_md,
    effective, currentPublished?.id ?? null, input.created_by ?? null, now,
  );
  return cpRowToObj(db.prepare('SELECT * FROM compliance_policies WHERE id = ?').get(id) as CpRow);
}

export function listPolicyVersions(policyKey: string): CompliancePolicy[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM compliance_policies WHERE policy_key = ? ORDER BY version DESC'
  ).all(policyKey.toLowerCase()) as CpRow[];
  return rows.map(cpRowToObj);
}

export function getPolicyById(id: string): CompliancePolicy | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM compliance_policies WHERE id = ?').get(id) as CpRow | undefined;
  return row ? cpRowToObj(row) : null;
}

export function getActivePolicy(policyKey: string): CompliancePolicy | null {
  const db = getDb();
  const now = new Date().toISOString();
  const row = db.prepare(`
    SELECT * FROM compliance_policies
    WHERE policy_key = ? AND status = 'published' AND effective_at <= ?
    ORDER BY version DESC LIMIT 1
  `).get(policyKey.toLowerCase(), now) as CpRow | undefined;
  return row ? cpRowToObj(row) : null;
}

export function publishPolicy(id: string): CompliancePolicy | null {
  const db = getDb();
  const p = getPolicyById(id);
  if (!p) return null;
  // retire any other published versions of same key
  db.prepare(
    "UPDATE compliance_policies SET status = 'retired' WHERE policy_key = ? AND id != ? AND status = 'published'"
  ).run(p.policy_key, id);
  db.prepare("UPDATE compliance_policies SET status = 'published' WHERE id = ?").run(id);
  return getPolicyById(id);
}

export function listAllPolicies(): CompliancePolicy[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM compliance_policies ORDER BY policy_key, version DESC').all() as CpRow[];
  return rows.map(cpRowToObj);
}

// ---------- 50.7 Audit reports ----------

export interface AuditReport {
  id: string;
  target_type: string;
  target_id: string;
  period_start: string;
  period_end: string;
  summary: Record<string, unknown>;
  findings: Array<{ code: string; severity: 'info' | 'warning' | 'error'; message: string; reference?: string }>;
  score: number;
  status: 'draft' | 'final';
  generated_by: string | null;
  generated_at: string;
}

interface CarRow {
  id: string; target_type: string; target_id: string;
  period_start: string; period_end: string; summary_json: string;
  findings_json: string; score: number; status: string;
  generated_by: string | null; generated_at: string;
}

function carRowToObj(row: CarRow): AuditReport {
  return {
    id: row.id, target_type: row.target_type, target_id: row.target_id,
    period_start: row.period_start, period_end: row.period_end,
    summary: safeParse<Record<string, unknown>>(row.summary_json, {}),
    findings: safeParse<AuditReport['findings']>(row.findings_json, []),
    score: row.score,
    status: row.status as AuditReport['status'],
    generated_by: row.generated_by, generated_at: row.generated_at,
  };
}

export interface GenerateAuditInput {
  target_type: 'video' | 'channel' | 'platform';
  target_id: string;
  period_start: string;
  period_end: string;
  generated_by?: string;
}

/**
 * Generate an audit report by aggregating:
 * - compliance record (age rating, COPPA flags, regional restrictions)
 * - latest checklist runs + scores
 * - evidence count
 * - policy versions in period
 */
export function generateAuditReport(input: GenerateAuditInput): AuditReport {
  const db = getDb();
  const findings: AuditReport['findings'] = [];
  let score = 100;

  const summary: Record<string, unknown> = {};

  if (input.target_type === 'video') {
    const comp = getVideoCompliance(input.target_id);
    if (!comp) {
      findings.push({ code: 'no_compliance_record', severity: 'warning', message: 'No compliance record for video' });
      score -= 20;
      summary.compliance = null;
    } else {
      summary.compliance = comp;
      if (comp.age_rating === 'unrated') {
        findings.push({ code: 'unrated', severity: 'warning', message: 'Video has no age rating' });
        score -= 10;
      }
      if (comp.coppa_child_directed && comp.coppa_personal_info_collected) {
        findings.push({ code: 'coppa_violation', severity: 'error', message: 'Child-directed video with personal info collection' });
        score -= 40;
      }
    }
  }

  // checklist runs within period for this target
  const runs = listChecklistRuns(input.target_type, input.target_id)
    .filter((r) => r.created_at >= input.period_start && r.created_at <= input.period_end);
  summary.checklist_runs = runs.length;
  if (runs.length) {
    const avg = runs.reduce((s, r) => s + r.score, 0) / runs.length;
    summary.avg_checklist_score = Math.round(avg * 100) / 100;
    if (avg < 80) {
      findings.push({ code: 'checklist_low', severity: 'warning', message: `Avg checklist score ${avg.toFixed(1)} below 80`, reference: 'checklist' });
      score -= Math.round((80 - avg) / 2);
    }
  } else {
    findings.push({ code: 'no_checklists', severity: 'info', message: 'No checklist runs in period' });
  }

  // evidence count
  const evidence = listEvidence(input.target_type, input.target_id);
  summary.evidence_count = evidence.length;
  if (evidence.length === 0) {
    findings.push({ code: 'no_evidence', severity: 'info', message: 'No evidence collected' });
  }

  // policies active in period
  const policies = listAllPolicies().filter((p) =>
    p.status === 'published' && p.effective_at <= input.period_end
  );
  summary.active_policies = policies.length;

  score = Math.max(0, Math.min(100, score));

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO compliance_audit_reports (id, target_type, target_id, period_start, period_end, summary_json, findings_json, score, status, generated_by, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
  `).run(
    id, input.target_type, input.target_id,
    input.period_start, input.period_end,
    JSON.stringify(summary), JSON.stringify(findings),
    score, input.generated_by ?? null, now,
  );
  return carRowToObj(db.prepare('SELECT * FROM compliance_audit_reports WHERE id = ?').get(id) as CarRow);
}

export function getAuditReport(id: string): AuditReport | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM compliance_audit_reports WHERE id = ?').get(id) as CarRow | undefined;
  return row ? carRowToObj(row) : null;
}

export function listAuditReports(targetType?: string, targetId?: string): AuditReport[] {
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (targetType) { where.push('target_type = ?'); params.push(targetType); }
  if (targetId) { where.push('target_id = ?'); params.push(targetId); }
  const sql = `SELECT * FROM compliance_audit_reports${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY generated_at DESC`;
  const rows = db.prepare(sql).all(...params) as CarRow[];
  return rows.map(carRowToObj);
}

export function finalizeAuditReport(id: string): AuditReport | null {
  const db = getDb();
  db.prepare("UPDATE compliance_audit_reports SET status = 'final' WHERE id = ?").run(id);
  return getAuditReport(id);
}

export function deleteAuditReport(id: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM compliance_audit_reports WHERE id = ?').run(id).changes > 0;
}

// ---------- Bootstrap: seed built-in policies + templates ----------

export function seedComplianceDefaults(): void {
  const db = getDb();
  // Only seed if no policies exist
  const n = (db.prepare('SELECT COUNT(*) as n FROM compliance_policies').get() as { n: number }).n;
  if (n === 0) {
    const now = new Date().toISOString();
    const seeds: Array<[string, string, string]> = [
      ['coppa', 'COPPA Policy', '# COPPA Compliance\n\nNo collection of personal information from children under 13. Child-directed content must be flagged and personalised features disabled.'],
      ['age_gate', 'Age Gate Policy', '# Age Gate\n\nContent rated PG-13 or higher requires viewer age verification (self-declared or verified). Minimum age derived from rating.'],
      ['gdpr', 'GDPR Policy', '# GDPR\n\nEU viewers have right to access, rectification, erasure, portability. Data processing based on consent.'],
      ['ccpa', 'CCPA Policy', '# CCPA\n\nCalifornia viewers may opt out of sale of personal information.'],
    ];
    for (const [key, title, body] of seeds) {
      db.prepare(`
        INSERT INTO compliance_policies (id, policy_key, version, title, body_md, effective_at, status, created_at)
        VALUES (?, ?, 1, ?, ?, ?, 'published', ?)
      `).run(randomUUID(), key, title, body, now, now);
    }
  }
  const tn = (db.prepare('SELECT COUNT(*) as n FROM compliance_checklist_templates').get() as { n: number }).n;
  if (tn === 0) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO compliance_checklist_templates (id, name, scope, description, items_json, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      randomUUID(), 'Default Video Upload Checklist', 'video',
      'Pre-publish checks for each video upload',
      JSON.stringify([
        { key: 'age_rating_set', label: 'Age rating is set', required: true, weight: 2 },
        { key: 'coppa_flag_reviewed', label: 'COPPA flag reviewed', required: true, weight: 2 },
        { key: 'regional_restrictions_reviewed', label: 'Regional restrictions reviewed', required: true, weight: 1 },
        { key: 'thumbnail_compliant', label: 'Thumbnail meets guidelines', required: true, weight: 1 },
        { key: 'metadata_accurate', label: 'Metadata is accurate', required: true, weight: 1 },
        { key: 'no_copyright_claim', label: 'No copyright claim outstanding', required: true, weight: 2 },
      ]),
      now, now,
    );
  }
}
