// melodyflix videos - Section 19 Content Protection (Part A)
// 19.1 DRM, 19.3 Screen-Rec Protection, 19.4 Embed Control,
// 19.5 Signed URLs, 19.6 Tokenized Playback, 19.7 Hotlink Protection,
// 19.8 Playback Session Validation.
import { randomUUID, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type DrmKind = 'widevine' | 'playready' | 'fairplay' | 'clearkey';
export type EmbedPolicy = 'allow_all' | 'allow_whitelist' | 'deny_all';
export type SignedUrlScope = 'playback' | 'download' | 'thumbnail' | 'manifest';

export function ensureContentProtectionSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS drm_licenses (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      license_url TEXT NOT NULL,
      key_id TEXT,
      policy TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_drm_video ON drm_licenses(video_id, enabled);
    CREATE INDEX IF NOT EXISTS idx_drm_kind ON drm_licenses(kind);

    CREATE TABLE IF NOT EXISTS screen_record_policies (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      block_capture INTEGER NOT NULL DEFAULT 1,
      block_audio_capture INTEGER NOT NULL DEFAULT 1,
      show_overlay_warning INTEGER NOT NULL DEFAULT 1,
      watermark_on_capture INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_screenrec_video ON screen_record_policies(video_id);

    CREATE TABLE IF NOT EXISTS embed_policies (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      policy TEXT NOT NULL DEFAULT 'allow_all',
      domains TEXT NOT NULL DEFAULT '[]',
      show_branding INTEGER NOT NULL DEFAULT 1,
      allow_fullscreen INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_embed_video ON embed_policies(video_id);

    CREATE TABLE IF NOT EXISTS signed_url_secrets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      secret TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      rotated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_signed_secret_name ON signed_url_secrets(name);

    CREATE TABLE IF NOT EXISTS signed_url_log (
      id TEXT PRIMARY KEY,
      secret_id TEXT NOT NULL,
      url TEXT NOT NULL,
      scope TEXT NOT NULL,
      resource TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      issued_to TEXT,
      ip TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_signedurl_log_secret ON signed_url_log(secret_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS playback_tokens (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      user_id TEXT,
      ip_hash TEXT,
      ua_hash TEXT,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      consumed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ptoken_session ON playback_tokens(session_id, revoked_at);
    CREATE INDEX IF NOT EXISTS idx_ptoken_video ON playback_tokens(video_id, expires_at);

    CREATE TABLE IF NOT EXISTS hotlink_policies (
      id TEXT PRIMARY KEY,
      video_id TEXT,
      allow_referers TEXT NOT NULL DEFAULT '[]',
      block_empty_referer INTEGER NOT NULL DEFAULT 1,
      allow_same_origin INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hotlink_video ON hotlink_policies(video_id, enabled);

    CREATE TABLE IF NOT EXISTS playback_session_validations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      token_id TEXT,
      ip_hash TEXT,
      ua_hash TEXT,
      checks TEXT NOT NULL DEFAULT '[]',
      result TEXT NOT NULL DEFAULT 'pass',
      reasons TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_psv_session ON playback_session_validations(session_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_psv_video ON playback_session_validations(video_id, result);
  `);
}

// ================= 19.1 DRM =================
export interface DrmLicense {
  id: string; video_id: string; kind: DrmKind; license_url: string;
  key_id: string | null; policy: string; enabled: number;
  created_at: string; updated_at: string;
}

export function upsertDrm(videoId: string, kind: DrmKind, licenseUrl: string, keyId?: string | null, policy?: Record<string, unknown>): DrmLicense {
  if (!['widevine','playready','fairplay','clearkey'].includes(kind)) throw new Error('invalid_kind');
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM drm_licenses WHERE video_id = ? AND kind = ?').get(videoId, kind) as DrmLicense | undefined;
  if (existing) {
    db.prepare('UPDATE drm_licenses SET license_url = ?, key_id = ?, policy = ?, updated_at = ? WHERE id = ?')
      .run(licenseUrl, keyId ?? null, JSON.stringify(policy ?? {}), now, existing.id);
    return db.prepare('SELECT * FROM drm_licenses WHERE id = ?').get(existing.id) as DrmLicense;
  }
  const id = randomUUID();
  db.prepare(`INSERT INTO drm_licenses (id, video_id, kind, license_url, key_id, policy, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(id, videoId, kind, licenseUrl, keyId ?? null, JSON.stringify(policy ?? {}), now, now);
  return db.prepare('SELECT * FROM drm_licenses WHERE id = ?').get(id) as DrmLicense;
}

export function listDrm(videoId: string): DrmLicense[] {
  return getDb().prepare('SELECT * FROM drm_licenses WHERE video_id = ? ORDER BY kind').all(videoId) as DrmLicense[];
}

export function deleteDrm(id: string): boolean {
  return getDb().prepare('DELETE FROM drm_licenses WHERE id = ?').run(id).changes > 0;
}

// ================= 19.3 Screen-Recording Protection =================
export interface ScreenRecPolicy {
  id: string; video_id: string; block_capture: number; block_audio_capture: number;
  show_overlay_warning: number; watermark_on_capture: number; enabled: number;
  created_at: string; updated_at: string;
}

export function upsertScreenRec(videoId: string, patch: Partial<Omit<ScreenRecPolicy,'id'|'video_id'|'created_at'|'updated_at'>>): ScreenRecPolicy {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM screen_record_policies WHERE video_id = ?').get(videoId) as ScreenRecPolicy | undefined;
  if (existing) {
    db.prepare(`UPDATE screen_record_policies SET
      block_capture = ?, block_audio_capture = ?, show_overlay_warning = ?,
      watermark_on_capture = ?, enabled = ?, updated_at = ? WHERE id = ?`).run(
      patch.block_capture !== undefined ? (patch.block_capture ? 1 : 0) : existing.block_capture,
      patch.block_audio_capture !== undefined ? (patch.block_audio_capture ? 1 : 0) : existing.block_audio_capture,
      patch.show_overlay_warning !== undefined ? (patch.show_overlay_warning ? 1 : 0) : existing.show_overlay_warning,
      patch.watermark_on_capture !== undefined ? (patch.watermark_on_capture ? 1 : 0) : existing.watermark_on_capture,
      patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : existing.enabled,
      now, existing.id);
    return db.prepare('SELECT * FROM screen_record_policies WHERE id = ?').get(existing.id) as ScreenRecPolicy;
  }
  const id = randomUUID();
  db.prepare(`INSERT INTO screen_record_policies
    (id, video_id, block_capture, block_audio_capture, show_overlay_warning, watermark_on_capture, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, videoId,
    patch.block_capture === false ? 0 : 1, patch.block_audio_capture === false ? 0 : 1,
    patch.show_overlay_warning === false ? 0 : 1, patch.watermark_on_capture === false ? 0 : 1,
    patch.enabled === false ? 0 : 1, now, now);
  return db.prepare('SELECT * FROM screen_record_policies WHERE id = ?').get(id) as ScreenRecPolicy;
}

export function getScreenRec(videoId: string): ScreenRecPolicy | null {
  return (getDb().prepare('SELECT * FROM screen_record_policies WHERE video_id = ?').get(videoId) as ScreenRecPolicy | undefined) ?? null;
}

// ================= 19.4 Embed Control =================
export interface EmbedPolicy {
  id: string; video_id: string; policy: EmbedPolicy; domains: string;
  show_branding: number; allow_fullscreen: number;
  created_at: string; updated_at: string;
}

export function upsertEmbed(videoId: string, policy: EmbedPolicy, domains: string[] = [], showBranding = true, allowFullscreen = true): EmbedPolicy {
  if (!['allow_all','allow_whitelist','deny_all'].includes(policy)) throw new Error('invalid_policy');
  if (policy === 'allow_whitelist' && domains.length === 0) throw new Error('whitelist_required');
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM embed_policies WHERE video_id = ?').get(videoId) as EmbedPolicy | undefined;
  if (existing) {
    db.prepare('UPDATE embed_policies SET policy = ?, domains = ?, show_branding = ?, allow_fullscreen = ?, updated_at = ? WHERE id = ?')
      .run(policy, JSON.stringify(domains), showBranding ? 1 : 0, allowFullscreen ? 1 : 0, now, existing.id);
    return db.prepare('SELECT * FROM embed_policies WHERE id = ?').get(existing.id) as EmbedPolicy;
  }
  const id = randomUUID();
  db.prepare(`INSERT INTO embed_policies (id, video_id, policy, domains, show_branding, allow_fullscreen, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, videoId, policy, JSON.stringify(domains),
    showBranding ? 1 : 0, allowFullscreen ? 1 : 0, now, now);
  return db.prepare('SELECT * FROM embed_policies WHERE id = ?').get(id) as EmbedPolicy;
}

export function checkEmbed(videoId: string, referer: string | null): { allowed: boolean; reason: string } {
  const p = getDb().prepare('SELECT * FROM embed_policies WHERE video_id = ?').get(videoId) as EmbedPolicy | undefined;
  if (!p) return { allowed: true, reason: 'no_policy' };
  if (p.policy === 'deny_all') return { allowed: false, reason: 'deny_all' };
  if (p.policy === 'allow_all') return { allowed: true, reason: 'allow_all' };
  if (!referer) return { allowed: false, reason: 'no_referer' };
  try {
    const host = new URL(referer).hostname;
    const domains = JSON.parse(p.domains) as string[];
    const ok = domains.some(d => host === d || host.endsWith('.' + d));
    return { allowed: ok, reason: ok ? 'whitelisted' : 'not_whitelisted' };
  } catch { return { allowed: false, reason: 'invalid_referer' }; }
}

// ================= 19.5 Signed URLs =================
export interface SignedSecret {
  id: string; name: string; secret: string; enabled: number;
  rotated_at: string | null; created_at: string; updated_at: string;
}

export function createSignedSecret(name: string): SignedSecret {
  if (!name || name.length > 80) throw new Error('invalid_name');
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  const secret = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  db.prepare(`INSERT INTO signed_url_secrets (id, name, secret, enabled, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)`).run(id, name, secret, now, now);
  return db.prepare('SELECT * FROM signed_url_secrets WHERE id = ?').get(id) as SignedSecret;
}

export function rotateSignedSecret(id: string): SignedSecret {
  const db = getDb();
  const s = db.prepare('SELECT * FROM signed_url_secrets WHERE id = ?').get(id) as SignedSecret | undefined;
  if (!s) throw new Error('secret_not_found');
  const now = new Date().toISOString();
  const newSecret = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  db.prepare('UPDATE signed_url_secrets SET secret = ?, rotated_at = ?, updated_at = ? WHERE id = ?')
    .run(newSecret, now, now, id);
  return db.prepare('SELECT * FROM signed_url_secrets WHERE id = ?').get(id) as SignedSecret;
}

export function listSignedSecrets(): SignedSecret[] {
  return getDb().prepare('SELECT id, name, enabled, rotated_at, created_at, updated_at FROM signed_url_secrets ORDER BY name').all() as SignedSecret[];
}

export interface SignUrlInput {
  secret_name: string;
  url: string;
  scope: SignedUrlScope;
  ttl_seconds?: number;
  issued_to?: string | null;
  ip?: string | null;
}

export function signUrl(input: SignUrlInput): { url: string; expires_at: string; signature: string; log_id: string } {
  if (!['playback','download','thumbnail','manifest'].includes(input.scope)) throw new Error('invalid_scope');
  const db = getDb();
  const s = db.prepare('SELECT * FROM signed_url_secrets WHERE name = ? AND enabled = 1').get(input.secret_name) as SignedSecret | undefined;
  if (!s) throw new Error('secret_not_found');
  const ttl = Math.min(Math.max(input.ttl_seconds ?? 3600, 30), 86400);
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  const payload = `${input.url}|${expiresAt}|${input.scope}`;
  const sig = createHmac('sha256', s.secret).update(payload).digest('hex');
  const id = randomUUID();
  db.prepare(`INSERT INTO signed_url_log (id, secret_id, url, scope, resource, expires_at, issued_to, ip, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, s.id, input.url, input.scope, input.url, expiresAt,
    input.issued_to ?? null, input.ip ?? null, new Date().toISOString());
  const sep = input.url.includes('?') ? '&' : '?';
  return { url: `${input.url}${sep}expires=${encodeURIComponent(expiresAt)}&sig=${sig}`, expires_at: expiresAt, signature: sig, log_id: id };
}

export function verifySignedUrl(url: string, signature: string, expiresAt: string, secretName: string, scope: SignedUrlScope): { valid: boolean; reason: string } {
  const s = getDb().prepare('SELECT * FROM signed_url_secrets WHERE name = ? AND enabled = 1').get(secretName) as SignedSecret | undefined;
  if (!s) return { valid: false, reason: 'secret_not_found' };
  if (new Date(expiresAt) < new Date()) return { valid: false, reason: 'expired' };
  const expected = createHmac('sha256', s.secret).update(`${url}|${expiresAt}|${scope}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return { valid: false, reason: 'bad_signature' };
  return timingSafeEqual(a, b) ? { valid: true, reason: 'ok' } : { valid: false, reason: 'bad_signature' };
}

export function listSignedUrlLog(secretId?: string, limit = 100) {
  const db = getDb();
  if (secretId) {
    return db.prepare('SELECT * FROM signed_url_log WHERE secret_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(secretId, Math.min(Math.max(limit, 1), 500));
  }
  return db.prepare('SELECT * FROM signed_url_log ORDER BY created_at DESC LIMIT ?')
    .all(Math.min(Math.max(limit, 1), 500));
}

// ================= 19.6 Tokenized Playback =================
export interface PlaybackToken {
  id: string; video_id: string; session_id: string; user_id: string | null;
  ip_hash: string | null; ua_hash: string | null; issued_at: string;
  expires_at: string; revoked_at: string | null; consumed_at: string | null;
}

function hash(v?: string | null): string | null {
  if (!v) return null;
  return createHash('sha256').update(v).digest('hex').slice(0, 32);
}

export interface IssueTokenInput {
  video_id: string; session_id: string; user_id?: string | null;
  ip?: string | null; ua?: string | null; ttl_seconds?: number;
}

export function issuePlaybackToken(input: IssueTokenInput): PlaybackToken {
  if (!input.video_id || !input.session_id) throw new Error('missing_fields');
  const db = getDb();
  const now = new Date();
  const ttl = Math.min(Math.max(input.ttl_seconds ?? 1800, 60), 86400);
  const id = randomUUID();
  const token = {
    id, video_id: input.video_id, session_id: input.session_id,
    user_id: input.user_id ?? null,
    ip_hash: hash(input.ip), ua_hash: hash(input.ua),
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttl * 1000).toISOString(),
  };
  db.prepare(`INSERT INTO playback_tokens (id, video_id, session_id, user_id, ip_hash, ua_hash, issued_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(token.id, token.video_id, token.session_id,
    token.user_id, token.ip_hash, token.ua_hash, token.issued_at, token.expires_at);
  return db.prepare('SELECT * FROM playback_tokens WHERE id = ?').get(id) as PlaybackToken;
}

export function getPlaybackToken(id: string): PlaybackToken | null {
  return (getDb().prepare('SELECT * FROM playback_tokens WHERE id = ?').get(id) as PlaybackToken | undefined) ?? null;
}

export function revokePlaybackToken(id: string): boolean {
  const now = new Date().toISOString();
  return getDb().prepare('UPDATE playback_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .run(now, id).changes > 0;
}

export function consumePlaybackToken(id: string): boolean {
  const now = new Date().toISOString();
  return getDb().prepare('UPDATE playback_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND revoked_at IS NULL')
    .run(now, id).changes > 0;
}

export interface ValidateTokenInput {
  token_id: string;
  session_id: string;
  ip?: string | null;
  ua?: string | null;
}

export function validatePlaybackToken(input: ValidateTokenInput): { valid: boolean; reason: string; token: PlaybackToken | null } {
  const t = getPlaybackToken(input.token_id);
  if (!t) return { valid: false, reason: 'token_not_found', token: null };
  if (t.revoked_at) return { valid: false, reason: 'revoked', token: t };
  if (new Date(t.expires_at) < new Date()) return { valid: false, reason: 'expired', token: t };
  if (t.session_id !== input.session_id) return { valid: false, reason: 'session_mismatch', token: t };
  if (t.ip_hash && hash(input.ip) !== t.ip_hash) return { valid: false, reason: 'ip_mismatch', token: t };
  if (t.ua_hash && hash(input.ua) !== t.ua_hash) return { valid: false, reason: 'ua_mismatch', token: t };
  return { valid: true, reason: 'ok', token: t };
}

// ================= 19.7 Hotlink Protection =================
export interface HotlinkPolicy {
  id: string; video_id: string | null; allow_referers: string;
  block_empty_referer: number; allow_same_origin: number; enabled: number;
  created_at: string; updated_at: string;
}

export function upsertHotlink(videoId: string | null, allowReferers: string[], blockEmpty = true, allowSameOrigin = true): HotlinkPolicy {
  const db = getDb();
  const now = new Date().toISOString();
  const key = videoId ?? '__global__';
  const existing = db.prepare("SELECT * FROM hotlink_policies WHERE COALESCE(video_id, '__global__') = ?").get(key) as HotlinkPolicy | undefined;
  if (existing) {
    db.prepare('UPDATE hotlink_policies SET allow_referers = ?, block_empty_referer = ?, allow_same_origin = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(allowReferers), blockEmpty ? 1 : 0, allowSameOrigin ? 1 : 0, now, existing.id);
    return db.prepare('SELECT * FROM hotlink_policies WHERE id = ?').get(existing.id) as HotlinkPolicy;
  }
  const id = randomUUID();
  db.prepare(`INSERT INTO hotlink_policies (id, video_id, allow_referers, block_empty_referer, allow_same_origin, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)`).run(id, videoId, JSON.stringify(allowReferers),
    blockEmpty ? 1 : 0, allowSameOrigin ? 1 : 0, now, now);
  return db.prepare('SELECT * FROM hotlink_policies WHERE id = ?').get(id) as HotlinkPolicy;
}

export function checkHotlink(videoId: string, referer: string | null, origin: string | null): { allowed: boolean; reason: string } {
  const db = getDb();
  let p = db.prepare("SELECT * FROM hotlink_policies WHERE video_id = ? AND enabled = 1").get(videoId) as HotlinkPolicy | undefined;
  if (!p) p = db.prepare("SELECT * FROM hotlink_policies WHERE video_id IS NULL AND enabled = 1").get() as HotlinkPolicy | undefined;
  if (!p) return { allowed: true, reason: 'no_policy' };
  if (!referer) return p.block_empty_referer ? { allowed: false, reason: 'empty_referer' } : { allowed: true, reason: 'empty_allowed' };
  try {
    const host = new URL(referer).hostname;
    const allowed = JSON.parse(p.allow_referers) as string[];
    if (allowed.some(d => host === d || host.endsWith('.' + d))) return { allowed: true, reason: 'referer_allowed' };
    if (p.allow_same_origin && origin) {
      try {
        const oh = new URL(origin).hostname;
        if (oh === host) return { allowed: true, reason: 'same_origin' };
      } catch {}
    }
    return { allowed: false, reason: 'referer_blocked' };
  } catch { return { allowed: false, reason: 'invalid_referer' }; }
}

// ================= 19.8 Playback Session Validation =================
export interface SessionValidation {
  id: string; session_id: string; video_id: string; token_id: string | null;
  ip_hash: string | null; ua_hash: string | null;
  checks: string; result: string; reasons: string; created_at: string;
}

export interface ValidateSessionInput {
  session_id: string;
  video_id: string;
  token_id?: string | null;
  ip?: string | null;
  ua?: string | null;
  require_token?: boolean;
  max_concurrent_sessions?: number;
}

export function validatePlaybackSession(input: ValidateSessionInput): SessionValidation {
  const db = getDb();
  const checks: { name: string; ok: boolean; reason?: string }[] = [];
  const reasons: string[] = [];

  if (input.token_id) {
    const v = validatePlaybackToken({ token_id: input.token_id, session_id: input.session_id, ip: input.ip, ua: input.ua });
    checks.push({ name: 'token', ok: v.valid, reason: v.reason });
    if (!v.valid) reasons.push('token:' + v.reason);
  } else if (input.require_token) {
    checks.push({ name: 'token', ok: false, reason: 'missing' });
    reasons.push('token:missing');
  } else {
    checks.push({ name: 'token', ok: true, reason: 'not_required' });
  }

  const maxSessions = input.max_concurrent_sessions ?? 0;
  if (maxSessions > 0) {
    const cnt = db.prepare(`SELECT COUNT(*) AS c FROM playback_session_validations
      WHERE video_id = ? AND result = 'pass' AND created_at > ?`)
      .get(input.video_id, new Date(Date.now() - 3600_000).toISOString()) as { c: number };
    const ok = cnt.c < maxSessions;
    checks.push({ name: 'concurrency', ok, reason: ok ? 'ok' : 'too_many_active' });
    if (!ok) reasons.push('concurrency:too_many_active');
  }

  const result = reasons.length ? 'fail' : 'pass';
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO playback_session_validations
    (id, session_id, video_id, token_id, ip_hash, ua_hash, checks, result, reasons, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.session_id, input.video_id,
    input.token_id ?? null, hash(input.ip), hash(input.ua),
    JSON.stringify(checks), result, JSON.stringify(reasons), now);
  return db.prepare('SELECT * FROM playback_session_validations WHERE id = ?').get(id) as SessionValidation;
}

export function listSessionValidations(filter?: { session_id?: string; video_id?: string; result?: string; limit?: number }) {
  const db = getDb();
  const where: string[] = []; const args: any[] = [];
  if (filter?.session_id) { where.push('session_id = ?'); args.push(filter.session_id); }
  if (filter?.video_id) { where.push('video_id = ?'); args.push(filter.video_id); }
  if (filter?.result) { where.push('result = ?'); args.push(filter.result); }
  const sql = `SELECT * FROM playback_session_validations ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(filter?.limit ?? 100, 1), 500));
  return db.prepare(sql).all(...args);
}

// ================= Stats =================
export interface ContentProtectionStats {
  drm_total: number;
  drm_by_kind: Record<string, number>;
  screenrec_policies: number;
  embed_policies: number;
  signed_secrets: number;
  signed_urls_issued: number;
  playback_tokens_active: number;
  playback_tokens_total: number;
  hotlink_policies: number;
  session_validations: number;
  session_failures: number;
}

export function getContentProtectionStats(): ContentProtectionStats {
  const db = getDb();
  const drm = db.prepare('SELECT kind, COUNT(*) AS c FROM drm_licenses GROUP BY kind').all() as { kind: string; c: number }[];
  const byKind: Record<string, number> = {};
  let drmTotal = 0;
  for (const d of drm) { byKind[d.kind] = d.c; drmTotal += d.c; }
  const sr = db.prepare('SELECT COUNT(*) AS c FROM screen_record_policies').get() as { c: number };
  const ep = db.prepare('SELECT COUNT(*) AS c FROM embed_policies').get() as { c: number };
  const ss = db.prepare('SELECT COUNT(*) AS c FROM signed_url_secrets').get() as { c: number };
  const sl = db.prepare('SELECT COUNT(*) AS c FROM signed_url_log').get() as { c: number };
  const ptAll = db.prepare('SELECT COUNT(*) AS c FROM playback_tokens').get() as { c: number };
  const ptActive = db.prepare(`SELECT COUNT(*) AS c FROM playback_tokens
    WHERE revoked_at IS NULL AND expires_at > ?`).get(new Date().toISOString()) as { c: number };
  const hp = db.prepare('SELECT COUNT(*) AS c FROM hotlink_policies').get() as { c: number };
  const sv = db.prepare('SELECT COUNT(*) AS c FROM playback_session_validations').get() as { c: number };
  const svFail = db.prepare("SELECT COUNT(*) AS c FROM playback_session_validations WHERE result = 'fail'").get() as { c: number };
  return {
    drm_total: drmTotal, drm_by_kind: byKind,
    screenrec_policies: sr.c, embed_policies: ep.c,
    signed_secrets: ss.c, signed_urls_issued: sl.c,
    playback_tokens_active: ptActive.c, playback_tokens_total: ptAll.c,
    hotlink_policies: hp.c,
    session_validations: sv.c, session_failures: svFail.c,
  };
}
