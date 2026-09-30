// melodyflix auth - email service (SMTP settings + send)
import nodemailer, { Transporter } from 'nodemailer';
import { randomUUID, randomBytes } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';
import { createLogger } from '@melodyflix/shared-logger';

const logger = createLogger('email');

export interface SmtpSettings {
  id: number;
  host: string;
  port: number;
  secure: number;
  username: string;
  password: string;
  from_name: string;
  from_email: string;
  enabled: number;
  updated_at: string;
}

let cachedTransport: Transporter | null = null;
let cachedSettingsHash = '';

export function ensureEmailSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS smtp_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      host TEXT NOT NULL DEFAULT '',
      port INTEGER NOT NULL DEFAULT 587,
      secure INTEGER NOT NULL DEFAULT 0,
      username TEXT NOT NULL DEFAULT '',
      password TEXT NOT NULL DEFAULT '',
      from_name TEXT NOT NULL DEFAULT 'melodyflix',
      from_email TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS email_verifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      verified_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ev_user ON email_verifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_ev_token ON email_verifications(token);

    CREATE TABLE IF NOT EXISTS email_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'sent',
      error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_el_user ON email_logs(user_id);
  `);
}

export function getSmtpSettings(): SmtpSettings | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM smtp_settings WHERE id = 1').get() as SmtpSettings | undefined;
  return row ?? null;
}

export function saveSmtpSettings(input: Partial<SmtpSettings> & { host: string; from_email: string }): SmtpSettings {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = getSmtpSettings();

  if (existing) {
    db.prepare(`
      UPDATE smtp_settings SET host = ?, port = ?, secure = ?, username = ?, password = ?,
        from_name = ?, from_email = ?, enabled = ?, updated_at = ?
      WHERE id = 1
    `).run(
      input.host,
      input.port ?? existing.port,
      input.secure !== undefined ? (input.secure ? 1 : 0) : existing.secure,
      input.username ?? existing.username,
      input.password ?? existing.password,
      input.from_name ?? existing.from_name,
      input.from_email,
      input.enabled !== undefined ? (input.enabled ? 1 : 0) : existing.enabled,
      now,
    );
  } else {
    db.prepare(`
      INSERT INTO smtp_settings (id, host, port, secure, username, password, from_name, from_email, enabled, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.host,
      input.port ?? 587,
      input.secure ? 1 : 0,
      input.username ?? '',
      input.password ?? '',
      input.from_name ?? 'melodyflix',
      input.from_email,
      input.enabled ? 1 : 0,
      now,
    );
  }
  cachedTransport = null;
  cachedSettingsHash = '';
  return getSmtpSettings()!;
}

function getTransport(): Transporter | null {
  const settings = getSmtpSettings();
  if (!settings || !settings.enabled || !settings.host || !settings.from_email) {
    return null;
  }
  const hash = `${settings.host}:${settings.port}:${settings.username}:${settings.password}`;
  if (cachedTransport && cachedSettingsHash === hash) return cachedTransport;

  cachedTransport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure === 1,
    auth: settings.username ? { user: settings.username, pass: settings.password } : undefined,
  });
  cachedSettingsHash = hash;
  return cachedTransport;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  user_id?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<{ sent: boolean; error?: string }> {
  const settings = getSmtpSettings();
  const db = getDb();
  const now = new Date().toISOString();

  if (!settings || !settings.enabled) {
    logger.warn({ to: input.to }, 'SMTP not configured — email skipped');
    db.prepare(`
      INSERT INTO email_logs (id, user_id, to_email, subject, status, error, created_at)
      VALUES (?, ?, ?, ?, 'skipped', 'SMTP not configured', ?)
    `).run(randomUUID(), input.user_id ?? null, input.to, input.subject, now);
    return { sent: false, error: 'SMTP not configured' };
  }

  try {
    const transport = getTransport();
    if (!transport) throw new Error('Transport unavailable');

    await transport.sendMail({
      from: `"${settings.from_name}" <${settings.from_email}>`,
      to: input.to,
      subject: input.subject,
      text: input.text ?? input.html.replace(/<[^>]+>/g, ''),
      html: input.html,
    });

    db.prepare(`
      INSERT INTO email_logs (id, user_id, to_email, subject, status, created_at)
      VALUES (?, ?, ?, ?, 'sent', ?)
    `).run(randomUUID(), input.user_id ?? null, input.to, input.subject, now);
    logger.info({ to: input.to }, 'email sent');
    return { sent: true };
  } catch (err) {
    const errorMsg = (err as Error).message;
    db.prepare(`
      INSERT INTO email_logs (id, user_id, to_email, subject, status, error, created_at)
      VALUES (?, ?, ?, ?, 'failed', ?, ?)
    `).run(randomUUID(), input.user_id ?? null, input.to, input.subject, errorMsg.slice(0, 500), now);
    logger.error({ err: errorMsg, to: input.to }, 'email failed');
    return { sent: false, error: errorMsg };
  }
}

// ---------- Verification ----------
export function createVerificationToken(userId: string, email: string): string {
  const db = getDb();
  const token = randomBytes(24).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
  db.prepare(`
    INSERT INTO email_verifications (id, user_id, email, token, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), userId, email, token, expiresAt.toISOString(), now.toISOString());
  return token;
}

export function verifyToken(token: string): { ok: boolean; user_id?: string; email?: string; error?: string } {
  const db = getDb();
  const row = db.prepare('SELECT * FROM email_verifications WHERE token = ?').get(token) as
    | { user_id: string; email: string; expires_at: string; verified_at: string | null } | undefined;

  if (!row) return { ok: false, error: 'Invalid or expired link' };
  if (row.verified_at) return { ok: false, error: 'Already verified' };
  if (new Date(row.expires_at) < new Date()) return { ok: false, error: 'Link expired' };

  const now = new Date().toISOString();
  db.prepare('UPDATE email_verifications SET verified_at = ? WHERE token = ?').run(now, token);
  db.prepare('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?').run(now, row.user_id);

  return { ok: true, user_id: row.user_id, email: row.email };
}

export function getVerificationTemplate(displayName: string, verifyUrl: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.06);">
        <tr><td style="background:linear-gradient(135deg,#7c3aed,#ec4899);padding:28px;text-align:center;">
          <div style="color:#fff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">melodyflix</div>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 14px;font-size:22px;font-weight:700;color:#0f0f0f;">Verify your email</h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#404040;">
            Hi ${displayName || 'there'}, welcome to melodyflix! Please confirm your email by clicking the button below.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
            <tr><td style="border-radius:10px;background:#7c3aed;">
              <a href="${verifyUrl}" style="display:inline-block;padding:14px 30px;font-size:15px;font-weight:700;color:#fff;text-decoration:none;">Verify email</a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;color:#909090;">Or copy this link:</p>
          <p style="margin:0 0 20px;font-size:12px;color:#606060;word-break:break-all;background:#f9f9f9;padding:10px;border-radius:6px;">${verifyUrl}</p>
          <p style="margin:0;font-size:12px;color:#909090;line-height:1.6;">This link will expire in 24 hours.</p>
        </td></tr>
        <tr><td style="background:#f9f9f9;padding:16px;text-align:center;font-size:12px;color:#909090;">
          melodyflix © ${new Date().getFullYear()}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function getEmailLogs(limit = 100): any[] {
  const db = getDb();
  return db.prepare('SELECT * FROM email_logs ORDER BY created_at DESC LIMIT ?').all(limit);
}
