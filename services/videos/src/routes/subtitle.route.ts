// melodyflix videos - subtitle routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard, verifyJwt, extractBearerToken } from '@melodyflix/shared-auth';
import { getDb } from '@melodyflix/shared-db';
import {listSubtitles, getSubtitle, uploadSubtitle, deleteSubtitle,
  setDefaultSubtitle, getSubtitleAsVtt, getDefaultSubtitle,
  getSubtitleCues, updateSubtitleCues,
  generateAutoCues, autoGenerateSubtitle,
  shiftSubtitleCues, findReplaceSubtitleCues, splitSubtitleCue, mergeSubtitleCues,
} from '../services/subtitle.service.js';

const UploadSchema = z.object({
  language: z.string().min(2).max(10),
  label: z.string().min(1).max(60),
  format: z.enum(['srt', 'vtt']),
  kind: z.enum(['subtitles', 'captions']).optional(),
  content: z.string().min(1).max(500_000),
  is_default: z.boolean().optional(),
});

const CueSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  text: z.string().max(2000),
});

const CuesUpdateSchema = z.object({
  cues: z.array(CueSchema).max(5000),
});

const AutoGenSchema = z.object({
  language: z.string().min(2).max(10).default('en'),
  label: z.string().min(1).max(60).optional(),
  kind: z.enum(['subtitles', 'captions']).optional(),
});

function checkVideoOwner(videoId: string, userId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT owner_id FROM videos WHERE id = ?').get(videoId) as { owner_id: string } | undefined;
  return row?.owner_id === userId;
}

export async function subtitleRoutes(app: FastifyInstance) {
  // GET /:videoId/subtitles — list all tracks (no content)
  app.get('/:videoId/subtitles', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const tracks = listSubtitles(videoId);
    return reply.send({ success: true, data: { subtitles: tracks } });
  });

  // GET /:videoId/subtitles/default.vtt
  app.get('/:videoId/subtitles/default.vtt', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const kind = ((req.query as any).kind === 'captions' ? 'captions' : 'subtitles') as 'subtitles' | 'captions';
    const track = getDefaultSubtitle(videoId, kind);
    if (!track) return reply.code(404).header('Content-Type', 'text/plain').send('No default subtitle');
    const vtt = getSubtitleAsVtt(track.id) ?? '';
    reply.header('Content-Type', 'text/vtt; charset=utf-8');
    reply.header('Cache-Control', 'public, max-age=300');
    return reply.send(vtt);
  });

  // GET /subtitles/:trackId.vtt
  app.get('/subtitles/:trackId.vtt', async (req, reply) => {
    const { trackId } = req.params as { trackId: string };
    const cleanId = trackId.replace(/\.vtt$/, '');
    const vtt = getSubtitleAsVtt(cleanId);
    if (!vtt) return reply.code(404).send('Not found');
    reply.header('Content-Type', 'text/vtt; charset=utf-8');
    reply.header('Cache-Control', 'public, max-age=300');
    return reply.send(vtt);
  });

  // GET /subtitles/:trackId/raw
  app.get('/subtitles/:trackId/raw', { preHandler: [authGuard] }, async (req, reply) => {
    const { trackId } = req.params as { trackId: string };
    const track = getSubtitle(trackId);
    if (!track) return reply.code(404).send({ success: false, error: 'Not found' });
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!checkVideoOwner(track.video_id, userId)) return reply.code(403).send({ success: false, error: 'Not your video' });
    return reply.send({ success: true, data: { track } });
  });

  // POST /:videoId/subtitles
  app.post('/:videoId/subtitles', { preHandler: [authGuard] }, async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkVideoOwner(videoId, userId)) return reply.code(403).send({ success: false, error: 'Not your video' });
    const parsed = UploadSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    try {
      const track = uploadSubtitle(videoId, parsed.data as any);
      return reply.send({ success: true, data: { track } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /subtitles/:trackId/set-default
  app.post('/subtitles/:trackId/set-default', { preHandler: [authGuard] }, async (req, reply) => {
    const { trackId } = req.params as { trackId: string };
    const track = getSubtitle(trackId);
    if (!track) return reply.code(404).send({ success: false, error: 'Not found' });
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!checkVideoOwner(track.video_id, userId)) return reply.code(403).send({ success: false, error: 'Not your video' });
    setDefaultSubtitle(trackId);
    return reply.send({ success: true, data: { ok: true } });
  });

  // GET /subtitles/:trackId/cues
  app.get('/subtitles/:trackId/cues', { preHandler: [authGuard] }, async (req, reply) => {
    const { trackId } = req.params as { trackId: string };
    const track = getSubtitle(trackId);
    if (!track) return reply.code(404).send({ success: false, error: 'Not found' });
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!checkVideoOwner(track.video_id, userId)) return reply.code(403).send({ success: false, error: 'Not your video' });
    const cues = getSubtitleCues(trackId) ?? [];
    return reply.send({ success: true, data: { cues, track: { id: track.id, language: track.language, label: track.label, kind: track.kind, format: track.format } } });
  });

  // PUT /subtitles/:trackId/cues
  app.put('/subtitles/:trackId/cues', { preHandler: [authGuard] }, async (req, reply) => {
    const { trackId } = req.params as { trackId: string };
    const track = getSubtitle(trackId);
    if (!track) return reply.code(404).send({ success: false, error: 'Not found' });
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!checkVideoOwner(track.video_id, userId)) return reply.code(403).send({ success: false, error: 'Not your video' });
    const parsed = CuesUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    try {
      const updated = updateSubtitleCues(trackId, parsed.data.cues as any);
      return reply.send({ success: true, data: { track: updated } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /:videoId/subtitles/auto-preview
  app.post('/:videoId/subtitles/auto-preview', { preHandler: [authGuard] }, async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkVideoOwner(videoId, userId)) return reply.code(403).send({ success: false, error: 'Not your video' });
    try { return reply.send({ success: true, data: generateAutoCues(videoId) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // POST /:videoId/subtitles/auto-generate
  app.post('/:videoId/subtitles/auto-generate', { preHandler: [authGuard] }, async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkVideoOwner(videoId, userId)) return reply.code(403).send({ success: false, error: 'Not your video' });
    const parsed = AutoGenSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    try {
      const track = autoGenerateSubtitle(videoId, parsed.data.language, parsed.data.label ?? `${parsed.data.language} (auto)`, parsed.data.kind ?? 'subtitles');
      return reply.send({ success: true, data: { track } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /subtitles/:trackId
  app.delete('/subtitles/:trackId', { preHandler: [authGuard] }, async (req, reply) => {
    const { trackId } = req.params as { trackId: string };
    const track = getSubtitle(trackId);
    if (!track) return reply.code(404).send({ success: false, error: 'Not found' });
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!checkVideoOwner(track.video_id, userId)) return reply.code(403).send({ success: false, error: 'Not your video' });
    deleteSubtitle(trackId);
    return reply.send({ success: true, data: { deleted: true } });
  });

  // (inserted before final brace)
  // POST /subtitles/:trackId/shift — shift all cue times by offset_seconds
  app.post('/subtitles/:trackId/shift', { preHandler: [authGuard] }, async (req, reply) => {
    const user = (req as any).user;
    if (!user) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { trackId } = req.params as { trackId: string };
    const { offset_seconds } = (req.body ?? {}) as { offset_seconds?: number };
    if (typeof offset_seconds !== 'number' || !Number.isFinite(offset_seconds)) {
      return reply.code(400).send({ success: false, error: 'offset_seconds must be a number' });
    }
    try {
      const track = shiftSubtitleCues(trackId, offset_seconds);
      if (!track) return reply.code(404).send({ success: false, error: 'Track not found' });
      return reply.send({ success: true, data: { track } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /subtitles/:trackId/find-replace
  app.post('/subtitles/:trackId/find-replace', { preHandler: [authGuard] }, async (req, reply) => {
    const user = (req as any).user;
    if (!user) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { trackId } = req.params as { trackId: string };
    const { find, replace, regex, caseSensitive } = (req.body ?? {}) as { find?: string; replace?: string; regex?: boolean; caseSensitive?: boolean };
    if (!find) return reply.code(400).send({ success: false, error: 'find required' });
    try {
      const result = findReplaceSubtitleCues(trackId, find, replace ?? '', { regex, caseSensitive });
      if (!result) return reply.code(404).send({ success: false, error: 'Track not found' });
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /subtitles/:trackId/split
  app.post('/subtitles/:trackId/split', { preHandler: [authGuard] }, async (req, reply) => {
    const user = (req as any).user;
    if (!user) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { trackId } = req.params as { trackId: string };
    const { cue_index, at } = (req.body ?? {}) as { cue_index?: number; at?: number };
    if (typeof cue_index !== 'number' || typeof at !== 'number') {
      return reply.code(400).send({ success: false, error: 'cue_index and at are required numbers' });
    }
    try {
      const track = splitSubtitleCue(trackId, cue_index, at);
      if (!track) return reply.code(404).send({ success: false, error: 'Track not found' });
      return reply.send({ success: true, data: { track } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /subtitles/:trackId/merge
  app.post('/subtitles/:trackId/merge', { preHandler: [authGuard] }, async (req, reply) => {
    const user = (req as any).user;
    if (!user) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { trackId } = req.params as { trackId: string };
    const { cue_index, joiner } = (req.body ?? {}) as { cue_index?: number; joiner?: string };
    if (typeof cue_index !== 'number') {
      return reply.code(400).send({ success: false, error: 'cue_index required' });
    }
    try {
      const track = mergeSubtitleCues(trackId, cue_index, joiner);
      if (!track) return reply.code(404).send({ success: false, error: 'Track not found' });
      return reply.send({ success: true, data: { track } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });
}
