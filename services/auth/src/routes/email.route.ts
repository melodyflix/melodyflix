// melodyflix auth - email verification + SMTP admin routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  verifyToken, getSmtpSettings, saveSmtpSettings,
  sendEmail, getEmailLogs,
} from '../services/email.service.js';

const SmtpSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  username: z.string().max(255).optional(),
  password: z.string().max(500).optional(),
  from_name: z.string().max(100).optional(),
  from_email: z.string().email(),
  enabled: z.boolean().optional(),
});

export async function emailRoutes(app: FastifyInstance) {
  // POST /api/v1/auth/email/verify — verify token
  app.post('/email/verify', async (req, reply) => {
    const body = req.body as { token?: string };
    if (!body.token) return reply.code(400).send({ success: false, error: 'Token required' });

    const result = verifyToken(body.token);
    if (!result.ok) return reply.code(400).send({ success: false, error: result.error });
    return reply.send({
      success: true,
      data: { verified: true, user_id: result.user_id, email: result.email },
    });
  });

  // ============ ADMIN ============

  // GET /api/v1/admin/email/smtp
  app.get('/email/smtp', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }

    const settings = getSmtpSettings();
    if (!settings) {
      return reply.send({ success: true, data: null });
    }
    // Hide password
    return reply.send({
      success: true,
      data: {
        ...settings,
        password: settings.password ? '••••••••' : '',
      },
    });
  });

  // POST /api/v1/admin/email/smtp
  app.post('/email/smtp', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }

    const parsed = SmtpSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    }

    // Don't overwrite password if unchanged (placeholder)
    const existing = getSmtpSettings();
    const input: any = { ...parsed.data };
    if (input.password === '••••••••' && existing) {
      input.password = existing.password;
    }

    try {
      const saved = saveSmtpSettings(input);
      return reply.send({
        success: true,
        data: { ...saved, password: saved.password ? '••••••••' : '' },
      });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /api/v1/admin/email/test — send test email
  app.post('/email/test', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }

    const body = req.body as { to?: string };
    if (!body.to) return reply.code(400).send({ success: false, error: 'to required' });

    const result = await sendEmail({
      to: body.to,
      subject: 'melodyflix SMTP Test',
      html: '<h2>✅ SMTP is working!</h2><p>Your melodyflix instance can send emails successfully.</p>',
    });

    if (!result.sent) {
      return reply.code(400).send({ success: false, error: result.error ?? 'Send failed' });
    }
    return reply.send({ success: true, data: { sent: true } });
  });

  // GET /api/v1/admin/email/logs
  app.get('/email/logs', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { limit?: string };
    const limit = Math.min(Number(q.limit ?? 100), 500);
    const logs = getEmailLogs(limit);
    return reply.send({ success: true, data: { logs } });
  });
}
