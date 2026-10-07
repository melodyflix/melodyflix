// melodyflix videos - Section 19 Content Protection (Part A) routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  upsertDrm, listDrm, deleteDrm,
  upsertScreenRec, getScreenRec,
  upsertEmbed, checkEmbed,
  createSignedSecret, rotateSignedSecret, listSignedSecrets, signUrl, verifySignedUrl, listSignedUrlLog,
  issuePlaybackToken, revokePlaybackToken, consumePlaybackToken, validatePlaybackToken,
  upsertHotlink, checkHotlink,
  validatePlaybackSession, listSessionValidations,
  getContentProtectionStats,
} from '../services/content-protection.service.js';

const DRM_KINDS = ['widevine','playready','fairplay','clearkey'] as const;
const EMBED_POLICIES = ['allow_all','allow_whitelist','deny_all'] as const;
const SIGNED_SCOPES = ['playback','download','thumbnail','manifest'] as const;

const DrmSchema = z.object({
  kind: z.enum(DRM_KINDS),
  license_url: z.string().url().max(2000),
  key_id: z.string().max(200).nullable().optional(),
  policy: z.record(z.string(), z.unknown()).optional(),
});

const ScreenRecSchema = z.object({
  block_capture: z.boolean().optional(),
  block_audio_capture: z.boolean().optional(),
  show_overlay_warning: z.boolean().optional(),
  watermark_on_capture: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

const EmbedSchema = z.object({
  policy: z.enum(EMBED_POLICIES),
  domains: z.array(z.string().max(200)).max(200).optional(),
  show_branding: z.boolean().optional(),
  allow_fullscreen: z.boolean().optional(),
});

const SecretSchema = z.object({ name: z.string().min(2).max(80) });

const SignSchema = z.object({
  secret_name: z.string().min(1).max(80),
  url: z.string().url().max(2000),
  scope: z.enum(SIGNED_SCOPES),
  ttl_seconds: z.number().int().min(30).max(86400).optional(),
  issued_to: z.string().max(100).nullable().optional(),
});

const VerifySignSchema = z.object({
  url: z.string().max(2000),
  signature: z.string().min(8).max(200),
  expires_at: z.string().datetime(),
  secret_name: z.string().min(1).max(80),
  scope: z.enum(SIGNED_SCOPES),
});

const TokenSchema = z.object({
  video_id: z.string().min(1).max(100),
  session_id: z.string().min(1).max(200),
  user_id: z.string().max(100).nullable().optional(),
  ttl_seconds: z.number().int().min(60).max(86400).optional(),
});

const ValidateTokenSchema = z.object({
  session_id: z.string().min(1).max(200),
});

const HotlinkSchema = z.object({
  video_id: z.string().max(100).nullable().optional(),
  allow_referers: z.array(z.string().max(200)).max(200).optional(),
  block_empty_referer: z.boolean().optional(),
  allow_same_origin: z.boolean().optional(),
});

const SessionValidationSchema = z.object({
  session_id: z.string().min(1).max(200),
  video_id: z.string().min(1).max(100),
  token_id: z.string().max(100).nullable().optional(),
  require_token: z.boolean().optional(),
  max_concurrent_sessions: z.number().int().min(0).max(1000).optional(),
});

function admin(auth: string | undefined): boolean {
  try { requireRole(auth, ['admin']); return true; } catch { return false; }
}
function uid(auth: string | undefined): string | null {
  try { const p: any = requireRole(auth, ['admin','user','moderator']); return p?.sub ?? p?.id ?? null; } catch { return null; }
}
function clientIp(req: any): string | null {
  const xf = req.headers?.['x-forwarded-for'];
  if (typeof xf === 'string') return xf.split(',')[0].trim();
  return req.ip ?? null;
}

export async function contentProtectionRoutes(app: FastifyInstance): Promise<void> {
  // ===== DRM =====
  app.post('/protection/drm/:videoId', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { videoId } = req.params as { videoId: string };
    const p = DrmSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: upsertDrm(videoId, p.data.kind, p.data.license_url, p.data.key_id, p.data.policy) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/protection/drm/:videoId', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    return reply.send({ success: true, data: { items: listDrm(videoId) } });
  });

  app.delete('/protection/drm/:id', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const ok = deleteDrm(id);
    return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  // ===== Screen-Rec =====
  app.post('/protection/screen-rec/:videoId', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { videoId } = req.params as { videoId: string };
    const p = ScreenRecSchema.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: upsertScreenRec(videoId, p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/protection/screen-rec/:videoId', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const r = getScreenRec(videoId);
    if (!r) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: r });
  });

  // ===== Embed =====
  app.post('/protection/embed/:videoId', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { videoId } = req.params as { videoId: string };
    const p = EmbedSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: upsertEmbed(videoId, p.data.policy, p.data.domains ?? [], p.data.show_branding ?? true, p.data.allow_fullscreen ?? true) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/protection/embed/check/:videoId', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const referer = (req.headers['referer'] as string | undefined) ?? null;
    return reply.send({ success: true, data: checkEmbed(videoId, referer) });
  });

  // ===== Signed URLs =====
  app.post('/protection/signed-secrets', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = SecretSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: createSignedSecret(p.data.name) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/protection/signed-secrets', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: { items: listSignedSecrets() } });
  });

  app.post('/protection/signed-secrets/:id/rotate', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: rotateSignedSecret(id) }); }
    catch (e) { return reply.code(404).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/protection/sign-url', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = SignSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: signUrl({ ...p.data, ip: clientIp(req) }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/protection/verify-signed-url', async (req, reply) => {
    const p = VerifySignSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    return reply.send({ success: true, data: verifySignedUrl(p.data.url, p.data.signature, p.data.expires_at, p.data.secret_name, p.data.scope) });
  });

  app.get('/protection/signed-url-log', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as { secret_id?: string; limit?: string };
    return reply.send({ success: true, data: { items: listSignedUrlLog(q.secret_id, q.limit ? Number(q.limit) : 100) } });
  });

  // ===== Playback tokens =====
  app.post('/protection/playback-tokens', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = TokenSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: issuePlaybackToken({ ...p.data, ip: clientIp(req), ua: req.headers['user-agent'] as string | undefined }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.post('/protection/playback-tokens/:id/revoke', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const { id } = req.params as { id: string };
    const ok = revokePlaybackToken(id);
    return ok ? reply.send({ success: true, data: { revoked: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
  });

  app.post('/protection/playback-tokens/:id/consume', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    const ok = consumePlaybackToken(id);
    return ok ? reply.send({ success: true, data: { consumed: true } }) : reply.code(409).send({ success: false, error: 'not_consumable' });
  });

  app.post('/protection/playback-tokens/:id/validate', async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = ValidateTokenSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    return reply.send({ success: true, data: validatePlaybackToken({ token_id: id, session_id: p.data.session_id, ip: clientIp(req), ua: req.headers['user-agent'] as string | undefined }) });
  });

  // ===== Hotlink =====
  app.post('/protection/hotlink', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const p = HotlinkSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: upsertHotlink(p.data.video_id ?? null, p.data.allow_referers ?? [], p.data.block_empty_referer ?? true, p.data.allow_same_origin ?? true) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/protection/hotlink/check/:videoId', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const referer = (req.headers['referer'] as string | undefined) ?? null;
    const origin = (req.headers['origin'] as string | undefined) ?? null;
    return reply.send({ success: true, data: checkHotlink(videoId, referer, origin) });
  });

  // ===== Session validation =====
  app.post('/protection/session-validation', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = SessionValidationSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: validatePlaybackSession({ ...p.data, ip: clientIp(req), ua: req.headers['user-agent'] as string | undefined }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/protection/session-validations', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const q = req.query as any;
    return reply.send({ success: true, data: { items: listSessionValidations({ session_id: q.session_id, video_id: q.video_id, result: q.result, limit: q.limit ? Number(q.limit) : undefined }) } });
  });

  app.get('/protection/stats', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getContentProtectionStats() });
  });
}
