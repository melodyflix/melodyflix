// melodyflix auth - 2FA HTTP routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import { getDb } from '@melodyflix/shared-db';
import type { User } from '../models/user.model.js';
import {
  beginTwoFASetup, confirmTwoFA, disableTwoFA,
  getTwoFAStatus, regenerateBackupCodes, isTwoFAEnabled,
} from '../services/twofa.service.js';

const CodeSchema = z.object({
  code: z.string().min(4).max(20),
});

export async function twofaRoutes(app: FastifyInstance) {
  // GET /api/v1/auth/2fa/status
  app.get('/2fa/status', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const status = getTwoFAStatus(user.sub);
    return reply.send({ success: true, data: status });
  });

  // POST /api/v1/auth/2fa/setup — begin (returns QR + secret)
  app.post('/2fa/setup', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    // Get user's email for label
    const db = getDb();
    const dbUser = db.prepare('SELECT email FROM users WHERE id = ?').get(user.sub) as { email: string } | undefined;
    const email = dbUser?.email ?? 'user@melodyflix';

    try {
      const result = await beginTwoFASetup(user.sub, email);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /api/v1/auth/2fa/confirm — confirm setup with code
  app.post('/2fa/confirm', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = CodeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const result = confirmTwoFA(user.sub, parsed.data.code);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /api/v1/auth/2fa/disable
  app.post('/2fa/disable', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = CodeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      disableTwoFA(user.sub, parsed.data.code);
      return reply.send({ success: true, data: { disabled: true } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /api/v1/auth/2fa/regenerate-backup-codes
  app.post('/2fa/regenerate-backup-codes', async (req, reply) => {
    let user;
    try { user = requireAuth(req.headers.authorization); }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }

    const parsed = CodeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const result = regenerateBackupCodes(user.sub, parsed.data.code);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });
}
