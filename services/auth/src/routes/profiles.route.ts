// melodyflix auth — Account Profiles routes (Section 1.6)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '@melodyflix/shared-auth';
import {
  createProfile, getProfile, listProfiles, countProfiles,
  updateProfile, deleteProfile, getDefaultProfile, setDefaultProfile,
  setProfilePin, removeProfilePin, verifyProfilePin, profileHasPin,
  summarizeProfiles,
} from '../services/profiles.service.js';

function accountId(req: any): string | null {
  // The auth token subject is the account id
  return req.user?.id ?? req.user?.sub ?? null;
}

export async function profilesRoutes(app: FastifyInstance) {
  const CreateSchema = z.object({
    name: z.string().min(1).max(40),
    avatar_url: z.string().url().nullable().optional(),
    is_kids: z.boolean().optional(),
    pin: z.string().regex(/^\d{4,6}$/).nullable().optional(),
    language: z.string().max(10).nullable().optional(),
    autoplay: z.boolean().optional(),
    max_age_rating: z.number().int().min(0).max(21).nullable().optional(),
  });

  const UpdateSchema = z.object({
    name: z.string().min(1).max(40).optional(),
    avatar_url: z.string().url().nullable().optional(),
    is_kids: z.boolean().optional(),
    language: z.string().max(10).nullable().optional(),
    autoplay: z.boolean().optional(),
    max_age_rating: z.number().int().min(0).max(21).nullable().optional(),
    sort_order: z.number().int().min(0).max(100).optional(),
  });

  const PinSchema = z.object({ pin: z.string().regex(/^\d{4,6}$/) });

  // GET /profiles — list all profiles for the current account
  app.get('/profiles', { preHandler: [authGuard] }, async (req, reply) => {
    const me = accountId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const summary = summarizeProfiles(me);
    return reply.send({ success: true, data: summary });
  });

  // POST /profiles — create (max 5)
  app.post('/profiles', { preHandler: [authGuard] }, async (req, reply) => {
    const me = accountId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    try {
      const profile = createProfile({ account_id: me, ...parsed.data });
      return reply.code(201).send({ success: true, data: { profile } });
    } catch (e: any) {
      const msg = e?.message ?? 'Create failed';
      if (msg.startsWith('Max')) return reply.code(409).send({ success: false, error: msg });
      return reply.code(400).send({ success: false, error: msg });
    }
  });

  // GET /profiles/:id — single (account-scoped)
  app.get('/profiles/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const me = accountId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const profile = getProfile(id);
    if (!profile) return reply.code(404).send({ success: false, error: 'Profile not found' });
    if (profile.account_id !== me) return reply.code(403).send({ success: false, error: 'Not your profile' });
    // Strip PIN hash from response
    const { pin_hash, pin_salt, ...safe } = profile;
    return reply.send({
      success: true,
      data: { profile: safe, has_pin: !!pin_hash },
    });
  });

  // PATCH /profiles/:id — update
  app.patch('/profiles/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const me = accountId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    try {
      const updated = updateProfile(id, me, parsed.data);
      if (!updated) return reply.code(404).send({ success: false, error: 'Profile not found' });
      const { pin_hash, pin_salt, ...safe } = updated;
      return reply.send({ success: true, data: { profile: safe, has_pin: !!pin_hash } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  // DELETE /profiles/:id — cannot delete default
  app.delete('/profiles/:id', { preHandler: [authGuard] }, async (req, reply) => {
    const me = accountId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const ok = deleteProfile(id, me);
      if (!ok) return reply.code(404).send({ success: false, error: 'Profile not found' });
      return reply.send({ success: true, data: { deleted: true } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Delete failed' });
    }
  });

  // POST /profiles/:id/default — make this the default profile
  app.post('/profiles/:id/default', { preHandler: [authGuard] }, async (req, reply) => {
    const me = accountId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const updated = setDefaultProfile(id, me);
      if (!updated) return reply.code(404).send({ success: false, error: 'Profile not found' });
      return reply.send({ success: true, data: { profile: updated } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  // GET /profiles/default — current default
  app.get('/profiles/default', { preHandler: [authGuard] }, async (req, reply) => {
    const me = accountId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    return reply.send({ success: true, data: { profile: getDefaultProfile(me) } });
  });

  // ---- PIN ----

  // POST /profiles/:id/pin — set PIN
  app.post('/profiles/:id/pin', { preHandler: [authGuard] }, async (req, reply) => {
    const me = accountId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const parsed = PinSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    try {
      const p = setProfilePin(id, me, parsed.data.pin);
      if (!p) return reply.code(404).send({ success: false, error: 'Profile not found' });
      return reply.send({ success: true, data: { has_pin: true } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Set PIN failed' });
    }
  });

  // DELETE /profiles/:id/pin — remove PIN (requires current)
  app.delete('/profiles/:id/pin', { preHandler: [authGuard] }, async (req, reply) => {
    const me = accountId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const parsed = PinSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    try {
      const ok = removeProfilePin(id, me, parsed.data.pin);
      return reply.send({ success: true, data: { removed: ok } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  // POST /profiles/:id/pin/verify — verify PIN (for switching)
  app.post('/profiles/:id/pin/verify', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = PinSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    return reply.send({ success: true, data: { valid: verifyProfilePin(id, parsed.data.pin) } });
  });

  // GET /profiles/:id/pin — whether a PIN is set
  app.get('/profiles/:id/pin', async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: { has_pin: profileHasPin(id) } });
  });
}
