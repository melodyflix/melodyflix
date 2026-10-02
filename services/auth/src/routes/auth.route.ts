// melodyflix auth - HTTP routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { signup, login, completeTwoFALogin, getUserById, sendVerificationEmailFor } from '../services/auth.service.js';
import { verifyJwt } from '../services/crypto.service.js';
import { loadConfig } from '@melodyflix/shared-config';

const SignupSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(100).optional(),
  ref: z.string().min(4).max(20).optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {
  app.post('/signup', async (req, reply) => {
    const parsed = SignupSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    }
    try {
      const signupInput = { ...parsed.data, referralCode: parsed.data.ref };
      const user = signup(signupInput);
      // Fire-and-forget verification email
      sendVerificationEmailFor(user.id, user.email, user.display_name ?? user.username).catch(() => {});
      return reply.code(201).send({ success: true, data: user });
    } catch (err) {
      return reply.code(409).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/login', async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    }
    try {
      const result = login(parsed.data);
      // If 2FA is required, tell frontend
      if ('requires_2fa' in result && result.requires_2fa) {
        return reply.send({
          success: true,
          data: {
            requires_2fa: true,
            temp_token: result.temp_token,
            user_id: result.user_id,
          },
        });
      }
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(401).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /api/v1/auth/2fa/login — complete login with 2FA code
  app.post('/2fa/login', async (req, reply) => {
    const TwoFALoginSchema = z.object({
      temp_token: z.string().min(10),
      code: z.string().min(4).max(20),
    });
    const parsed = TwoFALoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    }
    try {
      const result = completeTwoFALogin(parsed.data.temp_token, parsed.data.code);
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(401).send({ success: false, error: (err as Error).message });
    }
  });

  app.get('/me', async (req, reply) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
    const token = auth.slice(7);
    const config = loadConfig();
    const payload = verifyJwt(token, config.JWT_SECRET);
    if (!payload || typeof payload.sub !== 'string') {
      return reply.code(401).send({ success: false, error: 'Invalid token' });
    }
    const user = getUserById(payload.sub);
    if (!user) return reply.code(404).send({ success: false, error: 'User not found' });
    return reply.send({ success: true, data: user });
  });
}
