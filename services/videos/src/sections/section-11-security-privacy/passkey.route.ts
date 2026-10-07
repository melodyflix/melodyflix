// melodyflix videos - Section 11.16 Passkey Login routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  createChallenge, getChallenge, consumeChallenge, pruneExpiredChallenges,
  registerPasskey, getPasskey, getPasskeyByCredentialId, listPasskeys,
  renamePasskey, revokePasskey, touchPasskey, recordAuthentication,
  listEvents, getPasskeyStats,
} from './passkey.service.js';

const CHALLENGE_TYPES = ['registration', 'authentication'] as const;

const ChallengeSchema = z.object({
  type: z.enum(CHALLENGE_TYPES),
  ttl_seconds: z.number().int().min(30).max(600).optional(),
});

const ConsumeSchema = z.object({
  challenge_id: z.string().min(1).max(100),
  type: z.enum(CHALLENGE_TYPES),
});

const RegisterSchema = z.object({
  challenge_id: z.string().min(1).max(100),
  credential_id: z.string().min(16).max(2000),
  public_key: z.string().min(16).max(4000),
  counter: z.number().int().min(0).optional(),
  transports: z.array(z.string()).max(10).optional(),
  aaguid: z.string().max(100).nullable().optional(),
  device_name: z.string().max(100).nullable().optional(),
  is_backup_eligible: z.boolean().optional(),
  is_backed_up: z.boolean().optional(),
});

const RenameSchema = z.object({
  device_name: z.string().min(1).max(100),
});

const RevokeSchema = z.object({
  reason: z.string().max(500).optional(),
});

const TouchSchema = z.object({
  new_counter: z.number().int().min(0),
});

const AuthSuccessSchema = z.object({
  credential_id: z.string().min(16).max(2000),
});

const PruneSchema = z.object({
  older_than_hours: z.number().int().min(1).max(8760).optional(),
});

function getAuth(authorization: string | undefined): { ok: boolean; userId?: string; role?: string; error?: string } {
  try {
    const payload = requireAuth(authorization);
    return { ok: true, userId: payload.sub as string, role: payload.role as string };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function requireAdmin(authorization: string | undefined): { ok: boolean; userId?: string; error?: string } {
  const auth = getAuth(authorization);
  if (!auth.ok) return auth;
  if (auth.role !== 'admin') return { ok: false, error: 'Admin only' };
  return auth;
}

export async function passkeyRoutes(app: FastifyInstance) {
  // ============================================================
  // User endpoints
  // ============================================================

  // POST /passkey/challenge — request a WebAuthn challenge
  app.post('/passkey/challenge', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const parsed = ChallengeSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const ch = createChallenge(auth.userId!, parsed.data.type, parsed.data.ttl_seconds);
      return reply.code(201).send({ success: true, data: ch });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /passkey/challenge/consume — validate + consume a challenge
  app.post('/passkey/challenge/consume', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const parsed = ConsumeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const ch = consumeChallenge(parsed.data.challenge_id, auth.userId!, parsed.data.type);
      return reply.send({ success: true, data: ch });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /passkey/register — register a new passkey
  app.post('/passkey/register', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const pk = registerPasskey({
        ...parsed.data,
        user_id: auth.userId!,
        ip_address: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? null,
        user_agent: (req.headers['user-agent'] as string | undefined) ?? null,
      });
      return reply.code(201).send({ success: true, data: pk });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /passkey/mine — list my passkeys
  app.get('/passkey/mine', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const q = req.query as { include_revoked?: string };
    const includeRevoked = q.include_revoked === 'true';
    return reply.send({ success: true, data: { passkeys: listPasskeys(auth.userId!, !includeRevoked) } });
  });

  // GET /passkey/mine/events — my passkey event history
  app.get('/passkey/mine/events', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const q = req.query as { limit?: string };
    const limit = q.limit ? parseInt(q.limit, 10) : 100;
    return reply.send({ success: true, data: { events: listEvents(auth.userId!, limit) } });
  });

  // PATCH /passkey/:id/rename — rename a passkey
  app.patch('/passkey/:id/rename', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const parsed = RenameSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const pk = renamePasskey(id, auth.userId!, parsed.data.device_name);
      return reply.send({ success: true, data: pk });
    } catch (err) {
      const msg = (err as Error).message;
      const code = msg === 'Passkey not found' ? 404 : msg === 'Not your passkey' ? 403 : 400;
      return reply.code(code).send({ success: false, error: msg });
    }
  });

  // POST /passkey/:id/revoke — revoke a passkey
  app.post('/passkey/:id/revoke', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const parsed = RevokeSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    try {
      const pk = revokePasskey(id, auth.userId!, parsed.data.reason);
      return reply.send({ success: true, data: pk });
    } catch (err) {
      const msg = (err as Error).message;
      const code = msg === 'Passkey not found' ? 404 : msg === 'Not your passkey' ? 403 : 400;
      return reply.code(code).send({ success: false, error: msg });
    }
  });

  // POST /passkey/:id/touch — update counter after successful auth
  app.post('/passkey/:id/touch', async (req, reply) => {
    const auth = getAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ success: false, error: auth.error });

    const { id } = req.params as { id: string };
    const parsed = TouchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const pk = getPasskey(id);
    if (!pk) return reply.code(404).send({ success: false, error: 'Passkey not found' });
    if (pk.user_id !== auth.userId) return reply.code(403).send({ success: false, error: 'Not your passkey' });

    try {
      const updated = touchPasskey(id, parsed.data.new_counter);
      return reply.send({ success: true, data: updated });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // Public authentication completion (no auth required — passkey IS the auth)
  // ============================================================

  // POST /passkey/authenticate/complete — record successful auth
  // (Challenge + signature verified by client/library; we just log + touch)
  app.post('/passkey/authenticate/complete', async (req, reply) => {
    const parsed = AuthSuccessSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const pk = getPasskeyByCredentialId(parsed.data.credential_id);
    if (!pk) return reply.code(404).send({ success: false, error: 'Passkey not registered' });
    if (pk.status !== 'active') return reply.code(403).send({ success: false, error: 'Passkey is revoked' });

    recordAuthentication(pk.user_id, pk.id, {
      ip_address: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? null,
      user_agent: (req.headers['user-agent'] as string | undefined) ?? null,
    });

    return reply.send({ success: true, data: { user_id: pk.user_id, passkey_id: pk.id } });
  });

  // ============================================================
  // Admin endpoints
  // ============================================================

  // GET /passkey/stats/summary
  app.get('/passkey/stats/summary', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    return reply.send({ success: true, data: getPasskeyStats() });
  });

  // POST /passkey/maintenance/prune-challenges
  app.post('/passkey/maintenance/prune-challenges', async (req, reply) => {
    const auth = requireAdmin(req.headers.authorization);
    if (!auth.ok) return reply.code(auth.error === 'Admin only' ? 403 : 401).send({ success: false, error: auth.error });

    const parsed = PruneSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });

    const result = pruneExpiredChallenges(parsed.data.older_than_hours ?? 24);
    return reply.send({ success: true, data: result });
  });
}
