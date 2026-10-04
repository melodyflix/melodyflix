// melodyflix videos — Certificate System (Section 13.24-13.27)
// QR certificate, verification portal, digital credential, revocation.
import { randomUUID, createHash } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type CertStatus = 'issued' | 'revoked' | 'expired';
export type CertKind = 'course' | 'exam' | 'level' | 'achievement' | 'professional_cert';

export interface Certificate {
  id: string;
  serial: string;
  verification_code: string;   // short human-typeable code
  user_id: string;
  holder_name: string;
  kind: CertKind;
  title: string;
  description: string | null;
  level_id: string | null;
  subject_id: string | null;
  course_id: string | null;
  exam_id: string | null;
  attempt_id: string | null;
  score_percent: number | null;
  grade: string | null;
  issued_by: string | null;
  issuer_name: string | null;
  issued_at: string;
  expires_at: string | null;
  status: CertStatus;
  revocation_reason: string | null;
  revoked_by: string | null;
  revoked_at: string | null;
  qr_payload_json: string | null;
  credential_json: string | null;   // signed JSON-LD style credential
  credential_hash: string | null;
  language: string;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface CertificateVerificationLog {
  id: string;
  certificate_id: string;
  verification_code: string;
  verified_by_ip: string | null;
  user_agent: string | null;
  verified_at: string;
  result: 'valid' | 'revoked' | 'expired' | 'not_found';
}

// ============================================================
// Schema
// ============================================================

export function ensureCertificateSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS certificates (
      id TEXT PRIMARY KEY,
      serial TEXT NOT NULL UNIQUE,
      verification_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      user_id TEXT NOT NULL,
      holder_name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'course',
      title TEXT NOT NULL,
      description TEXT,
      level_id TEXT,
      subject_id TEXT,
      course_id TEXT,
      exam_id TEXT,
      attempt_id TEXT,
      score_percent INTEGER,
      grade TEXT,
      issued_by TEXT,
      issuer_name TEXT,
      issued_at TEXT NOT NULL,
      expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'issued',
      revocation_reason TEXT,
      revoked_by TEXT,
      revoked_at TEXT,
      qr_payload_json TEXT,
      credential_json TEXT,
      credential_hash TEXT,
      language TEXT NOT NULL DEFAULT 'en',
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cert_user ON certificates(user_id, issued_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cert_kind ON certificates(kind, status);
    CREATE INDEX IF NOT EXISTS idx_cert_issued_by ON certificates(issued_by);
    CREATE INDEX IF NOT EXISTS idx_cert_exam ON certificates(exam_id);

    CREATE TABLE IF NOT EXISTS certificate_verification_logs (
      id TEXT PRIMARY KEY,
      certificate_id TEXT NOT NULL,
      verification_code TEXT NOT NULL,
      verified_by_ip TEXT,
      user_agent TEXT,
      verified_at TEXT NOT NULL,
      result TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cvlog_cert ON certificate_verification_logs(certificate_id, verified_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cvlog_code ON certificate_verification_logs(verification_code);
  `);
}

// ============================================================
// Serial + verification code generation
// ============================================================

function generateSerial(): string {
  // MFX-<year>-<12 hex chars> — human-readable + unique
  const year = new Date().getFullYear();
  const hex = randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
  return `MFX-${year}-${hex}`;
}

function generateVerificationCode(): string {
  // 12-char base32-ish, grouped as XXXX-XXXX-XXXX
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return [block(), block(), block()].join('-');
}

function computeGrade(percent: number | null): string | null {
  if (percent === null) return null;
  if (percent >= 90) return 'A+';
  if (percent >= 80) return 'A';
  if (percent >= 70) return 'B';
  if (percent >= 60) return 'C';
  if (percent >= 50) return 'D';
  return 'F';
}

// ============================================================
// 13.24 — Issue certificate
// ============================================================

export function issueCertificate(input: {
  user_id: string;
  holder_name: string;
  title: string;
  kind?: CertKind;
  description?: string | null;
  level_id?: string | null;
  subject_id?: string | null;
  course_id?: string | null;
  exam_id?: string | null;
  attempt_id?: string | null;
  score_percent?: number | null;
  issued_by?: string | null;
  issuer_name?: string | null;
  expires_at?: string | null;
  language?: string;
  metadata?: Record<string, unknown> | null;
}): Certificate {
  const holder = (input.holder_name ?? '').trim();
  if (holder.length < 2 || holder.length > 200) throw new Error('holder_name must be 2-200 chars');
  const title = (input.title ?? '').trim();
  if (title.length < 3 || title.length > 250) throw new Error('title must be 3-250 chars');

  const db = getDb();
  const id = randomUUID();
  const serial = generateSerial();
  const verCode = generateVerificationCode();
  const now = new Date().toISOString();
  const grade = computeGrade(input.score_percent ?? null);

  // Build verifiable credential payload (JSON-LD-ish)
  const credential = {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    type: ['VerifiableCredential', 'EducationCredential', 'MelodyflixCertificate'],
    issuer: {
      id: 'https://melodyflix.com',
      name: input.issuer_name ?? 'Melodyflix Education',
    },
    issuanceDate: now,
    expirationDate: input.expires_at ?? null,
    credentialSubject: {
      id: `did:melodyflix:${input.user_id}`,
      name: holder,
      achievement: {
        title,
        kind: input.kind ?? 'course',
        grade,
        score_percent: input.score_percent ?? null,
      },
    },
    id: `urn:melodyflix:cert:${serial}`,
    credentialStatus: {
      type: 'MelodyflixCertStatus',
      status: 'issued',
      verifyAt: `https://melodyflix.com/verify/${verCode}`,
    },
  };
  const credJson = JSON.stringify(credential);
  const credHash = createHash('sha256').update(credJson).digest('hex');

  const qrPayload = {
    v: 1,
    type: 'melodyflix_cert',
    serial,
    verify: verCode,
    url: `https://melodyflix.com/verify/${verCode}`,
  };

  db.prepare(`
    INSERT INTO certificates (id, serial, verification_code, user_id, holder_name, kind,
      title, description, level_id, subject_id, course_id, exam_id, attempt_id,
      score_percent, grade, issued_by, issuer_name, issued_at, expires_at, status,
      revocation_reason, revoked_by, revoked_at, qr_payload_json, credential_json,
      credential_hash, language, metadata_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued',
      NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, serial, verCode, input.user_id, holder, input.kind ?? 'course',
    title, input.description ?? null,
    input.level_id ?? null, input.subject_id ?? null,
    input.course_id ?? null, input.exam_id ?? null, input.attempt_id ?? null,
    input.score_percent ?? null, grade,
    input.issued_by ?? null, input.issuer_name ?? 'Melodyflix Education',
    now, input.expires_at ?? null,
    JSON.stringify(qrPayload), credJson, credHash,
    input.language ?? 'en',
    input.metadata ? JSON.stringify(input.metadata) : null, now, now);

  return getCertificate(id)!;
}

export function issueCourseCertificate(input: {
  user_id: string;
  holder_name: string;
  course_id: string;
  course_title: string;
  level_id?: string | null;
  subject_id?: string | null;
  score_percent?: number | null;
  issued_by?: string | null;
  issuer_name?: string | null;
}): Certificate {
  return issueCertificate({
    user_id: input.user_id,
    holder_name: input.holder_name,
    title: `Certificate of Completion: ${input.course_title}`,
    kind: 'course',
    description: `Awarded for successfully completing "${input.course_title}".`,
    level_id: input.level_id ?? null,
    subject_id: input.subject_id ?? null,
    course_id: input.course_id,
    score_percent: input.score_percent ?? null,
    issued_by: input.issued_by ?? null,
    issuer_name: input.issuer_name ?? 'Melodyflix Education',
  });
}

export function issueExamCertificate(input: {
  user_id: string;
  holder_name: string;
  exam_id: string;
  exam_title: string;
  attempt_id: string;
  score_percent: number;
  level_id?: string | null;
  subject_id?: string | null;
  issued_by?: string | null;
  issuer_name?: string | null;
}): Certificate {
  return issueCertificate({
    user_id: input.user_id,
    holder_name: input.holder_name,
    title: `Certificate: ${input.exam_title}`,
    kind: 'exam',
    description: `Awarded for passing "${input.exam_title}" with ${input.score_percent}%.`,
    level_id: input.level_id ?? null,
    subject_id: input.subject_id ?? null,
    exam_id: input.exam_id,
    attempt_id: input.attempt_id,
    score_percent: input.score_percent,
    issued_by: input.issued_by ?? null,
    issuer_name: input.issuer_name ?? 'Melodyflix Education',
  });
}

// ============================================================
// Lookup
// ============================================================

export function getCertificate(id: string): Certificate | null {
  return (getDb().prepare('SELECT * FROM certificates WHERE id = ?').get(id) as Certificate | undefined) ?? null;
}

export function getCertificateBySerial(serial: string): Certificate | null {
  return (getDb().prepare('SELECT * FROM certificates WHERE serial = ?').get(serial) as Certificate | undefined) ?? null;
}

export function getCertificateByCode(code: string): Certificate | null {
  const normalized = code.trim().toUpperCase();
  return (getDb().prepare('SELECT * FROM certificates WHERE verification_code = ?').get(normalized) as Certificate | undefined) ?? null;
}

export function listUserCertificates(userId: string, opts: { status?: CertStatus; limit?: number } = {}): Certificate[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const filters: string[] = ['user_id = ?'];
  const params: any[] = [userId];
  if (opts.status) { filters.push('status = ?'); params.push(opts.status); }
  params.push(limit);
  return db.prepare(
    `SELECT * FROM certificates WHERE ${filters.join(' AND ')} ORDER BY issued_at DESC LIMIT ?`
  ).all(...params) as Certificate[];
}

export function listCertificatesByIssuer(issuerId: string, limit = 100): Certificate[] {
  return getDb().prepare(
    'SELECT * FROM certificates WHERE issued_by = ? ORDER BY issued_at DESC LIMIT ?'
  ).all(issuerId, Math.min(Math.max(limit, 1), 500)) as Certificate[];
}

export function listCertificatesByExam(examId: string): Certificate[] {
  return getDb().prepare(
    'SELECT * FROM certificates WHERE exam_id = ? ORDER BY issued_at DESC'
  ).all(examId) as Certificate[];
}

export function listCertificatesByCourse(courseId: string): Certificate[] {
  return getDb().prepare(
    'SELECT * FROM certificates WHERE course_id = ? ORDER BY issued_at DESC'
  ).all(courseId) as Certificate[];
}

// ============================================================
// 13.25 — Verification portal
// ============================================================

export interface VerifyResult {
  valid: boolean;
  reason: string;
  certificate: Certificate | null;
}

export function verifyCertificate(code: string, meta: { ip?: string | null; user_agent?: string | null } = {}): VerifyResult {
  const cert = getCertificateByCode(code);
  const db = getDb();
  const now = new Date().toISOString();

  let result: VerifyResult;

  if (!cert) {
    result = { valid: false, reason: 'not_found', certificate: null };
  } else if (cert.status === 'revoked') {
    result = { valid: false, reason: 'revoked', certificate: cert };
  } else if (cert.status === 'expired') {
    result = { valid: false, reason: 'expired', certificate: cert };
  } else if (cert.expires_at && new Date(cert.expires_at) < new Date()) {
    result = { valid: false, reason: 'expired', certificate: cert };
  } else {
    result = { valid: true, reason: 'valid', certificate: cert };
  }

  // Log the verification (only if cert exists)
  if (cert) {
    db.prepare(`
      INSERT INTO certificate_verification_logs (id, certificate_id, verification_code, verified_by_ip, user_agent, verified_at, result)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), cert.id, code.trim().toUpperCase(),
      meta.ip ?? null, meta.user_agent ?? null, now, result.reason);
  }

  return result;
}

export function listVerificationLogs(certificateId: string, limit = 100): CertificateVerificationLog[] {
  return getDb().prepare(
    'SELECT * FROM certificate_verification_logs WHERE certificate_id = ? ORDER BY verified_at DESC LIMIT ?'
  ).all(certificateId, Math.min(Math.max(limit, 1), 500)) as CertificateVerificationLog[];
}

export function getCertificatePublicView(code: string): {
  serial: string;
  holder_name: string;
  title: string;
  kind: string;
  grade: string | null;
  score_percent: number | null;
  issuer_name: string | null;
  issued_at: string;
  expires_at: string | null;
  status: CertStatus;
} | null {
  const cert = getCertificateByCode(code);
  if (!cert) return null;
  return {
    serial: cert.serial,
    holder_name: cert.holder_name,
    title: cert.title,
    kind: cert.kind,
    grade: cert.grade,
    score_percent: cert.score_percent,
    issuer_name: cert.issuer_name,
    issued_at: cert.issued_at,
    expires_at: cert.expires_at,
    status: cert.status,
  };
}

// ============================================================
// 13.26 — Digital credential download
// ============================================================

export interface DigitalCredential {
  certificate_id: string;
  serial: string;
  verification_code: string;
  verify_url: string;
  credential_json: string;
  credential_hash: string;
  qr_payload: string;
}

export function getDigitalCredential(certId: string): DigitalCredential | null {
  const cert = getCertificate(certId);
  if (!cert) return null;
  if (cert.status === 'revoked') throw new Error('Certificate has been revoked');
  return {
    certificate_id: cert.id,
    serial: cert.serial,
    verification_code: cert.verification_code,
    verify_url: `https://melodyflix.com/verify/${cert.verification_code}`,
    credential_json: cert.credential_json ?? '{}',
    credential_hash: cert.credential_hash ?? '',
    qr_payload: cert.qr_payload_json ?? '{}',
  };
}

export function getCertificateIntegrity(certId: string): {
  valid: boolean;
  stored_hash: string | null;
  computed_hash: string;
} {
  const cert = getCertificate(certId);
  if (!cert) throw new Error('Certificate not found');
  const computed = cert.credential_json
    ? createHash('sha256').update(cert.credential_json).digest('hex')
    : '';
  return {
    valid: cert.credential_hash === computed,
    stored_hash: cert.credential_hash,
    computed_hash: computed,
  };
}

// ============================================================
// 13.27 — Revocation
// ============================================================

export function revokeCertificate(certId: string, revokedBy: string, reason: string): Certificate {
  const db = getDb();
  const cert = getCertificate(certId);
  if (!cert) throw new Error('Certificate not found');
  if (cert.status === 'revoked') return cert;

  const now = new Date().toISOString();

  // Update credential status inside the JSON-LD payload too
  let newCredJson = cert.credential_json;
  if (cert.credential_json) {
    try {
      const parsed = JSON.parse(cert.credential_json);
      if (parsed.credentialStatus) {
        parsed.credentialStatus.status = 'revoked';
        parsed.credentialStatus.reason = reason;
        parsed.credentialStatus.revokedAt = now;
      }
      newCredJson = JSON.stringify(parsed);
    } catch { /* leave as-is */ }
  }

  db.prepare(`
    UPDATE certificates SET status = 'revoked', revocation_reason = ?, revoked_by = ?,
      revoked_at = ?, credential_json = ?, updated_at = ? WHERE id = ?
  `).run(reason.slice(0, 500), revokedBy, now, newCredJson, now, certId);

  return getCertificate(certId)!;
}

export function reactivateCertificate(certId: string, requesterId: string): Certificate {
  const db = getDb();
  const cert = getCertificate(certId);
  if (!cert) throw new Error('Certificate not found');
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE certificates SET status = 'issued', revocation_reason = NULL,
      revoked_by = NULL, revoked_at = NULL, updated_at = ? WHERE id = ?
  `).run(now, certId);
  return getCertificate(certId)!;
}

export function listRevokedCertificates(limit = 100): Certificate[] {
  return getDb().prepare(
    "SELECT * FROM certificates WHERE status = 'revoked' ORDER BY revoked_at DESC LIMIT ?"
  ).all(Math.min(Math.max(limit, 1), 500)) as Certificate[];
}

// ============================================================
// Stats
// ============================================================

export interface CertificateStats {
  total: number;
  by_kind: Record<string, number>;
  by_status: Record<string, number>;
  verified_total: number;
  revoked_total: number;
}

export function getCertificateStats(): CertificateStats {
  const db = getDb();
  const kindRows = db.prepare(
    'SELECT kind, COUNT(*) as n FROM certificates GROUP BY kind'
  ).all() as Array<{ kind: string; n: number }>;
  const statusRows = db.prepare(
    'SELECT status, COUNT(*) as n FROM certificates GROUP BY status'
  ).all() as Array<{ status: string; n: number }>;
  const total = (db.prepare('SELECT COUNT(*) as n FROM certificates').get() as { n: number }).n;
  const verifiedTotal = (db.prepare(
    'SELECT COUNT(*) as n FROM certificate_verification_logs'
  ).get() as { n: number }).n;
  const revokedTotal = (db.prepare(
    "SELECT COUNT(*) as n FROM certificates WHERE status = 'revoked'"
  ).get() as { n: number }).n;

  return {
    total,
    by_kind: Object.fromEntries(kindRows.map((r) => [r.kind, r.n])),
    by_status: Object.fromEntries(statusRows.map((r) => [r.status, r.n])),
    verified_total: verifiedTotal,
    revoked_total: revokedTotal,
  };
}
