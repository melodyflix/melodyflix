// melodyflix videos - voice & audio features routes (Section 45)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  ensureAudioProcessingSchema,
  createAudioVariant, getAudioVariant, listAudioVariants, updateAudioVariantStatus,
  createAudioProfile, getAudioProfile, listAudioProfiles, updateAudioProfile, deleteAudioProfile,
  buildFfmpegFilterChain,
  setChannelConfig, getChannelConfig, listByLayout,
  createSpatialObject, getSpatialObject, listSpatialObjects, updateSpatialObject, deleteSpatialObject,
  createBinauralPreview, getBinauralPreview, listBinauralPreviews, updateBinauralPreview,
  runAudioQualityCheck, getAudioQualityCheck, listAudioQualityChecks,
} from '../services/audio-processing.service.js';

export async function audioProcessingRoutes(app: FastifyInstance) {
  ensureAudioProcessingSchema();

  const isAdmin = async (req: any, reply: any) => {
    try { requireRole(req.headers.authorization, ['admin']); return true; }
    catch (err) { reply.code(403).send({ success: false, error: (err as Error).message }); return false; }
  };

  // ============ 45.1 Audio-Only Mode ============
  app.post('/videos/:videoId/audio-variants', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { videoId } = req.params as { videoId: string };
    const BodySchema = z.object({
      audio_track_id: z.string().nullable().optional(),
      hls_audio_url: z.string().max(1000).nullable().optional(),
      duration_seconds: z.number().min(0).optional(),
    });
    const parsed = BodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const v = createAudioVariant({ video_id: videoId, ...parsed.data });
      return reply.code(201).send({ success: true, data: v });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.get('/videos/:videoId/audio-variants', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    return reply.send({ success: true, data: { variants: listAudioVariants(videoId) } });
  });

  app.patch('/audio-variants/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const BodySchema = z.object({
      status: z.enum(['pending', 'ready', 'failed']),
      hls_audio_url: z.string().max(1000).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const v = updateAudioVariantStatus(id, parsed.data.status, parsed.data.hls_audio_url);
    if (!v) return reply.code(404).send({ success: false, error: 'Variant not found' });
    return reply.send({ success: true, data: v });
  });

  // ============ 45.3/45.4/45.7 Audio Profiles ============
  app.post('/videos/:videoId/audio-profiles', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { videoId } = req.params as { videoId: string };
    const BodySchema = z.object({
      profile_name: z.string().min(1).max(80),
      enhancement: z.object({
        bass_boost_db: z.number().min(-20).max(20).optional(),
        treble_boost_db: z.number().min(-20).max(20).optional(),
        compression: z.enum(['off', 'light', 'medium', 'aggressive']).optional(),
        stereo_widening: z.number().min(0).max(2).optional(),
        clarity: z.number().min(0).max(1).optional(),
      }).optional(),
      noise_reduction: z.object({
        enabled: z.boolean().optional(),
        strength: z.enum(['low', 'medium', 'high']).optional(),
        noise_floor_db: z.number().min(-80).max(-20).optional(),
        highpass_hz: z.number().min(20).max(300).optional(),
        lowpass_hz: z.number().min(8000).max(20000).optional(),
      }).optional(),
      normalization: z.object({
        enabled: z.boolean().optional(),
        target_lufs: z.number().min(-30).max(-5).optional(),
        true_peak_db: z.number().min(-5).max(0).optional(),
        dual_pass: z.boolean().optional(),
      }).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const p = createAudioProfile({ video_id: videoId, ...parsed.data });
      return reply.code(201).send({ success: true, data: p });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.get('/videos/:videoId/audio-profiles', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    return reply.send({ success: true, data: { profiles: listAudioProfiles(videoId) } });
  });

  app.get('/audio-profiles/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = getAudioProfile(id);
    if (!p) return reply.code(404).send({ success: false, error: 'Profile not found' });
    return reply.send({ success: true, data: p });
  });

  app.patch('/audio-profiles/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const p = updateAudioProfile(id, req.body as any);
    if (!p) return reply.code(404).send({ success: false, error: 'Profile not found' });
    return reply.send({ success: true, data: p });
  });

  app.get('/audio-profiles/:id/ffmpeg-filter', async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = getAudioProfile(id);
    if (!p) return reply.code(404).send({ success: false, error: 'Profile not found' });
    return reply.send({ success: true, data: { filter: buildFfmpegFilterChain(p) } });
  });

  app.delete('/audio-profiles/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const ok = deleteAudioProfile(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Profile not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // ============ 45.5/45.6 Surround + Atmos ============
  app.put('/videos/:videoId/audio-channel-config', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { videoId } = req.params as { videoId: string };
    const BodySchema = z.object({
      layout: z.enum(['mono', 'stereo', '5.1', '7.1', '5.1.4', '7.1.4']).optional(),
      atmos_enabled: z.boolean().optional(),
      atmos_metadata: z.object({
        atmos_version: z.string().optional(),
        bed_layout: z.string().optional(),
        object_count: z.number().int().min(0).max(118).optional(),
        dialnorm: z.number().optional(),
      }).optional(),
      sample_rate: z.number().int().min(8000).max(192000).optional(),
      bit_depth: z.number().int().min(16).max(32).optional(),
      codec: z.enum(['aac', 'ac3', 'eac3', 'truehd', 'flac', 'opus']).optional(),
    });
    const parsed = BodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const c = setChannelConfig(videoId, parsed.data);
      return reply.send({ success: true, data: c });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.get('/videos/:videoId/audio-channel-config', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const c = getChannelConfig(videoId);
    return reply.send({ success: true, data: c });
  });

  app.get('/admin/audio/channels-by-layout/:layout', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { layout } = req.params as { layout: string };
    return reply.send({ success: true, data: { configs: listByLayout(layout as any) } });
  });

  // ============ 45.9/45.10 Spatial Audio Objects ============
  app.post('/videos/:videoId/spatial-objects', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { videoId } = req.params as { videoId: string };
    const BodySchema = z.object({
      name: z.string().min(1).max(120),
      source_track_id: z.string().nullable().optional(),
      position_x: z.number().min(-1).max(1).optional(),
      position_y: z.number().min(-1).max(1).optional(),
      position_z: z.number().min(-1).max(1).optional(),
      gain_db: z.number().min(-60).max(12).optional(),
      size: z.number().min(0).max(5).optional(),
      automation: z.array(z.object({
        time: z.number().min(0),
        x: z.number().min(-1).max(1).optional(),
        y: z.number().min(-1).max(1).optional(),
        z: z.number().min(-1).max(1).optional(),
        gain: z.number().min(-60).max(12).optional(),
      })).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const o = createSpatialObject({ video_id: videoId, ...parsed.data });
      return reply.code(201).send({ success: true, data: o });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.get('/videos/:videoId/spatial-objects', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    return reply.send({ success: true, data: { objects: listSpatialObjects(videoId) } });
  });

  app.get('/spatial-objects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const o = getSpatialObject(id);
    if (!o) return reply.code(404).send({ success: false, error: 'Object not found' });
    return reply.send({ success: true, data: o });
  });

  app.patch('/spatial-objects/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const o = updateSpatialObject(id, req.body as any);
    if (!o) return reply.code(404).send({ success: false, error: 'Object not found' });
    return reply.send({ success: true, data: o });
  });

  app.delete('/spatial-objects/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const ok = deleteSpatialObject(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Object not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // ============ 45.11 Binaural Preview ============
  app.post('/videos/:videoId/binaural-previews', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { videoId } = req.params as { videoId: string };
    const BodySchema = z.object({
      hrtf_profile: z.string().max(80).optional(),
      head_tracking: z.boolean().optional(),
    });
    const parsed = BodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const p = createBinauralPreview({ video_id: videoId, ...parsed.data });
    return reply.code(201).send({ success: true, data: p });
  });

  app.get('/videos/:videoId/binaural-previews', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    return reply.send({ success: true, data: { previews: listBinauralPreviews(videoId) } });
  });

  app.patch('/binaural-previews/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const p = updateBinauralPreview(id, req.body as any);
    if (!p) return reply.code(404).send({ success: false, error: 'Preview not found' });
    return reply.send({ success: true, data: p });
  });

  // ============ 45.12 Audio Quality Check ============
  app.post('/videos/:videoId/audio-quality-check', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { videoId } = req.params as { videoId: string };
    const BodySchema = z.object({
      loudness_lufs: z.number().min(-60).max(0).optional(),
      true_peak_db: z.number().min(-60).max(6).optional(),
      dynamic_range_db: z.number().min(0).max(40).optional(),
      noise_floor_db: z.number().min(-100).max(0).optional(),
      silence_ratio: z.number().min(0).max(1).optional(),
      clipping_detected: z.boolean().optional(),
      channels: z.number().int().min(1).max(16).optional(),
      sample_rate: z.number().int().min(8000).max(192000).optional(),
    });
    const parsed = BodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const r = runAudioQualityCheck({ video_id: videoId, ...parsed.data });
    return reply.send({ success: true, data: r });
  });

  app.get('/videos/:videoId/audio-quality-checks', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    return reply.send({ success: true, data: { checks: listAudioQualityChecks(videoId) } });
  });

  app.get('/audio-quality-checks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = getAudioQualityCheck(id);
    if (!c) return reply.code(404).send({ success: false, error: 'Check not found' });
    return reply.send({ success: true, data: c });
  });
}
