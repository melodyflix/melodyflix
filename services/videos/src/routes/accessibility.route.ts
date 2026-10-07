// melodyflix videos - Section 16 Accessibility routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  addAudioDescription, listAudioDescriptions, getAudioDescription, deleteAudioDescription,
  addSignLanguageTrack, listSignLanguageTracks, deleteSignLanguageTrack,
  getOrCreatePreferences, updatePreferences,
  setAccessibleControl, listAccessibleControls, getDefaultControls,
  checkContrast,
  evaluateCaptionAccuracy, listCaptionAccuracy,
  runWcagAudit, getWcagAudit, listWcagAudits,
  generateAccessibilityReport, getA11yStats,
} from '../services/accessibility.service.js';

const AD_KINDS = ['standard','descriptive','extended'] as const;
const SIGN_LOCALES = ['asl','bsl','isl','other'] as const;
const COLORBLIND = ['protanopia','deuteranopia','tritanopia','achromatopsia','none'] as const;
const WCAG_LEVELS = ['A','AA','AAA'] as const;
const WCAG_STATUS = ['pass','fail','warning','manual'] as const;

const AudioDescSchema = z.object({
  video_id: z.string().min(1).max(100),
  language: z.string().min(2).max(10).optional(),
  kind: z.enum(AD_KINDS).optional(),
  track_url: z.string().url().max(2000),
  duration_ms: z.number().int().min(0).max(86_400_000).optional(),
  narrator: z.string().max(200).nullable().optional(),
});

const SignSchema = z.object({
  video_id: z.string().min(1).max(100),
  locale: z.enum(SIGN_LOCALES).optional(),
  track_url: z.string().url().max(2000),
  position: z.string().max(40).optional(),
  size_percent: z.number().int().min(5).max(75).optional(),
});

const PrefsSchema = z.object({
  screen_reader_enabled: z.boolean().optional(),
  aria_verbosity: z.enum(['minimal','standard','verbose']).optional(),
  keyboard_nav_enabled: z.boolean().optional(),
  keyboard_shortcuts: z.record(z.string(), z.string()).optional(),
  high_contrast: z.boolean().optional(),
  color_blind_mode: z.enum(COLORBLIND).optional(),
  reduced_motion: z.boolean().optional(),
  font_scale: z.number().min(0.5).max(3).optional(),
  caption_style: z.object({
    font: z.string().max(80).optional(),
    font_size_px: z.number().int().min(8).max(96).optional(),
    text_color: z.string().max(20).optional(),
    bg_color: z.string().max(20).optional(),
    bg_opacity: z.number().min(0).max(1).optional(),
    outline: z.boolean().optional(),
    position: z.enum(['top','bottom']).optional(),
  }).optional(),
});

const ControlSchema = z.object({
  control_key: z.string().min(1).max(60),
  enabled: z.boolean(),
  notes: z.string().max(500).optional(),
});

const ContrastSchema = z.object({
  fg: z.string().min(3).max(20),
  bg: z.string().min(3).max(20),
});

const CaptionAccSchema = z.object({
  video_id: z.string().min(1).max(100),
  language: z.string().min(2).max(10).optional(),
  reference_words: z.number().int().min(1).max(1_000_000),
  substitution_errors: z.number().int().min(0).max(1_000_000).optional(),
  deletion_errors: z.number().int().min(0).max(1_000_000).optional(),
  insertion_errors: z.number().int().min(0).max(1_000_000).optional(),
});

const WcagCheckSchema = z.object({
  id: z.string().max(80),
  criterion: z.string().max(200),
  level: z.enum(WCAG_LEVELS),
  status: z.enum(WCAG_STATUS),
  note: z.string().max(500).optional(),
});

const WcagAuditSchema = z.object({
  scope: z.string().max(40).optional(),
  target_id: z.string().min(1).max(100),
  level: z.enum(WCAG_LEVELS).optional(),
  checks: z.array(WcagCheckSchema).max(100).optional(),
  auto_run: z.boolean().optional(),
});

function uid(auth: string | undefined): string | null {
  try {
    const p: any = requireRole(auth, ['admin','user','moderator']);
    return p?.sub ?? p?.id ?? null;
  } catch { return null; }
}
function admin(auth: string | undefined): boolean {
  try { requireRole(auth, ['admin']); return true; } catch { return false; }
}

export async function accessibilityRoutes(app: FastifyInstance): Promise<void> {
  // ===== 16.1 Audio Description =====
  app.post('/a11y/audio-descriptions', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = AudioDescSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: addAudioDescription({ ...p.data, created_by: actor }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/a11y/audio-descriptions', async (req, reply) => {
    const q = req.query as { video_id?: string };
    if (!q.video_id) return reply.code(400).send({ success: false, error: 'video_id_required' });
    return reply.send({ success: true, data: { items: listAudioDescriptions(q.video_id) } });
  });

  app.delete('/a11y/audio-descriptions/:id', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    if (!getAudioDescription(id)) return reply.code(404).send({ success: false, error: 'not_found' });
    try {
      const ok = deleteAudioDescription(id, actor);
      return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(403).send({ success: false, error: (e as Error).message }); }
  });

  // ===== 16.5 Sign Language =====
  app.post('/a11y/sign-language', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = SignSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: addSignLanguageTrack({ ...p.data, created_by: actor }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/a11y/sign-language', async (req, reply) => {
    const q = req.query as { video_id?: string };
    if (!q.video_id) return reply.code(400).send({ success: false, error: 'video_id_required' });
    return reply.send({ success: true, data: { items: listSignLanguageTracks(q.video_id) } });
  });

  app.delete('/a11y/sign-language/:id', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const { id } = req.params as { id: string };
    try {
      const ok = deleteSignLanguageTrack(id, actor);
      return ok ? reply.send({ success: true, data: { deleted: true } }) : reply.code(404).send({ success: false, error: 'not_found' });
    } catch (e) { return reply.code(403).send({ success: false, error: (e as Error).message }); }
  });

  // ===== 16.2/16.3/16.4/16.6/16.7 User Preferences =====
  app.get('/a11y/preferences', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    return reply.send({ success: true, data: getOrCreatePreferences(actor) });
  });

  app.patch('/a11y/preferences', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = PrefsSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: updatePreferences(actor, p.data) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  // ===== 16.8 Accessible Player Controls =====
  app.get('/a11y/controls/default', async (req, reply) => {
    return reply.send({ success: true, data: { controls: getDefaultControls() } });
  });

  app.post('/a11y/controls', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    const body = req.body as { video_id?: string; control_key?: string; enabled?: boolean; notes?: string };
    if (!body.video_id) return reply.code(400).send({ success: false, error: 'video_id_required' });
    const p = ControlSchema.safeParse(body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: setAccessibleControl(body.video_id, p.data.control_key, p.data.enabled, p.data.notes) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/a11y/controls', async (req, reply) => {
    const q = req.query as { video_id?: string };
    if (!q.video_id) return reply.code(400).send({ success: false, error: 'video_id_required' });
    return reply.send({ success: true, data: { controls: listAccessibleControls(q.video_id) } });
  });

  // ===== 16.11 Contrast Checker =====
  app.post('/a11y/contrast-check', async (req, reply) => {
    const p = ContrastSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.send({ success: true, data: checkContrast(p.data.fg, p.data.bg) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  // ===== 16.10 Caption Accuracy =====
  app.post('/a11y/caption-accuracy', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = CaptionAccSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: evaluateCaptionAccuracy({ ...p.data, evaluated_by: actor }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/a11y/caption-accuracy', async (req, reply) => {
    const q = req.query as { video_id?: string; limit?: string };
    if (!q.video_id) return reply.code(400).send({ success: false, error: 'video_id_required' });
    return reply.send({ success: true, data: { items: listCaptionAccuracy(q.video_id, q.limit ? Number(q.limit) : 50) } });
  });

  // ===== 16.9 WCAG Audit =====
  app.post('/a11y/wcag-audit', async (req, reply) => {
    const actor = uid(req.headers.authorization);
    if (!actor) return reply.code(403).send({ success: false, error: 'auth_required' });
    const p = WcagAuditSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ success: false, error: 'invalid_body', details: p.error.issues });
    try { return reply.code(201).send({ success: true, data: runWcagAudit({ ...p.data, auditor_id: actor }) }); }
    catch (e) { return reply.code(400).send({ success: false, error: (e as Error).message }); }
  });

  app.get('/a11y/wcag-audits', async (req, reply) => {
    const q = req.query as { target_id?: string; level?: string; limit?: string };
    return reply.send({ success: true, data: { audits: listWcagAudits({
      target_id: q.target_id, level: q.level as any, limit: q.limit ? Number(q.limit) : undefined,
    }) } });
  });

  app.get('/a11y/wcag-audits/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const a = getWcagAudit(id);
    if (!a) return reply.code(404).send({ success: false, error: 'not_found' });
    return reply.send({ success: true, data: a });
  });

  // ===== 16.12 Report =====
  app.get('/a11y/report/:videoId', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    return reply.send({ success: true, data: generateAccessibilityReport(videoId) });
  });

  // ===== Global stats =====
  app.get('/a11y/stats', async (req, reply) => {
    if (!admin(req.headers.authorization)) return reply.code(403).send({ success: false, error: 'admin_required' });
    return reply.send({ success: true, data: getA11yStats() });
  });
}
