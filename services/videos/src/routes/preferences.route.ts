// melodyflix videos - user preferences routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  getPreferences, updatePreferences, resetPreferences,
  recordInterest, recordInterestsBulk, getUserInterestProfile,
  clearInterestProfile, removeInterestTopic, rebuildInterestsFromViews,
  addBlockedKeyword, removeBlockedKeyword, listBlockedKeywords,
  addBlockedChannel, removeBlockedChannel, listBlockedChannels,
  isContentBlocked, filterBlockedContent,
} from '../services/preferences.service.js';

const UpdateSchema = z.object({
  autoplay_next: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
  autoplay_playlist: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
  default_quality: z.enum(['auto', '144', '240', '360', '480', '720', '1080', '1440', '2160']).optional(),
  default_speed: z.number().min(0.25).max(4).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  language: z.string().min(2).max(10).optional(),
  reduced_motion: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
  captions_on: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
});

const RecordInterestSchema = z.object({
  topic: z.string().min(1).max(100),
  weight: z.number().min(0.1).max(10).optional(),
  source: z.enum(['view','like','search','share','purchase','manual']).optional(),
});

const RecordBulkSchema = z.object({
  items: z.array(RecordInterestSchema).min(1).max(200),
});

const RebuildSchema = z.object({
  days: z.number().int().min(1).max(730).optional(),
});

const KeywordSchema = z.object({
  keyword: z.string().min(1).max(100),
});

const ChannelBlockSchema = z.object({
  channel_id: z.string().min(1).max(100),
  reason: z.string().max(300).optional(),
});

const CheckBlockSchema = z.object({
  channel_id: z.string().max(100).nullable().optional(),
  title: z.string().max(500).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  tags: z.array(z.string().max(100)).max(50).nullable().optional(),
});

const FilterBlockSchema = z.object({
  items: z.array(CheckBlockSchema).max(200),
});

function toBool01(v: unknown): number | undefined {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v ? 1 : 0;
  return undefined;
}

export async function preferencesRoutes(app: FastifyInstance) {
  // GET /preferences
  app.get('/preferences', async (req, reply) => {
    let uid: string;
    try { uid = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const prefs = getPreferences(uid);
    return reply.send(prefs);
  });

  // PUT /preferences
  app.put('/preferences', async (req, reply) => {
    let uid: string;
    try { uid = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });

    const d = parsed.data;
    const patch: any = {};
    if (d.autoplay_next !== undefined) patch.autoplay_next = toBool01(d.autoplay_next);
    if (d.autoplay_playlist !== undefined) patch.autoplay_playlist = toBool01(d.autoplay_playlist);
    if (d.default_quality !== undefined) patch.default_quality = d.default_quality;
    if (d.default_speed !== undefined) patch.default_speed = d.default_speed;
    if (d.theme !== undefined) patch.theme = d.theme;
    if (d.language !== undefined) patch.language = d.language;
    if (d.reduced_motion !== undefined) patch.reduced_motion = toBool01(d.reduced_motion);
    if (d.captions_on !== undefined) patch.captions_on = toBool01(d.captions_on);

    const prefs = updatePreferences(uid, patch);
    return reply.send(prefs);
  });

  // DELETE /preferences (reset to defaults)
  app.delete('/preferences', async (req, reply) => {
    let uid: string;
    try { uid = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const prefs = resetPreferences(uid);
    return reply.send(prefs);
  });

  // ============ 14.2 INTEREST PROFILE ============

  // GET /me/interests
  app.get('/me/interests', async (req, reply) => {
    let uid: string;
    try { uid = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { limit?: string };
    const limit = Math.min(Math.max(Number(q.limit ?? 50), 1), 200);
    const profile = getUserInterestProfile(uid, limit);
    return reply.send({ success: true, data: profile });
  });

  // POST /me/interests  (record one)
  app.post('/me/interests', async (req, reply) => {
    let uid: string;
    try { uid = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = RecordInterestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    try {
      const row = recordInterest(uid, parsed.data);
      return reply.code(201).send({ success: true, data: row });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /me/interests/bulk
  app.post('/me/interests/bulk', async (req, reply) => {
    let uid: string;
    try { uid = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = RecordBulkSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', errors: parsed.error.issues });
    const r = recordInterestsBulk(uid, parsed.data.items);
    return reply.code(201).send({ success: true, data: r });
  });

  // DELETE /me/interests  (clear all)
  app.delete('/me/interests', async (req, reply) => {
    let uid: string;
    try { uid = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: clearInterestProfile(uid) });
  });

  // DELETE /me/interests/:topic  (remove one)
  app.delete('/me/interests/:topic', async (req, reply) => {
    let uid: string;
    try { uid = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { topic } = req.params as { topic: string };
    const ok = removeInterestTopic(uid, decodeURIComponent(topic));
    return ok
      ? reply.send({ success: true, data: { removed: true } })
      : reply.code(404).send({ success: false, error: 'Not found' });
  });

  // POST /me/interests/rebuild  (from views)
  app.post('/me/interests/rebuild', async (req, reply) => {
    let uid: string;
    try { uid = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = RebuildSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    const r = rebuildInterestsFromViews(uid, parsed.data);
    return reply.send({ success: true, data: r });
  });

  // ============ 14.3 KEYWORD / CHANNEL BLOCK ============

  // GET /me/blocked
  app.get('/me/blocked', async (req, reply) => {
    let uid: string;
    try { uid = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    return reply.send({
      success: true,
      data: {
        keywords: listBlockedKeywords(uid),
        channels: listBlockedChannels(uid),
      },
    });
  });

  // POST /me/blocked/keywords
  app.post('/me/blocked/keywords', async (req, reply) => {
    let uid: string;
    try { uid = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = KeywordSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    try {
      const row = addBlockedKeyword(uid, parsed.data.keyword);
      return reply.code(201).send({ success: true, data: row });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /me/blocked/keywords/:keyword
  app.delete('/me/blocked/keywords/:keyword', async (req, reply) => {
    let uid: string;
    try { uid = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { keyword } = req.params as { keyword: string };
    const ok = removeBlockedKeyword(uid, decodeURIComponent(keyword));
    return ok
      ? reply.send({ success: true, data: { removed: true } })
      : reply.code(404).send({ success: false, error: 'Not found' });
  });

  // POST /me/blocked/channels
  app.post('/me/blocked/channels', async (req, reply) => {
    let uid: string;
    try { uid = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = ChannelBlockSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    const row = addBlockedChannel(uid, parsed.data.channel_id, parsed.data.reason);
    return reply.code(201).send({ success: true, data: row });
  });

  // DELETE /me/blocked/channels/:channelId
  app.delete('/me/blocked/channels/:channelId', async (req, reply) => {
    let uid: string;
    try { uid = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { channelId } = req.params as { channelId: string };
    const ok = removeBlockedChannel(uid, channelId);
    return ok
      ? reply.send({ success: true, data: { removed: true } })
      : reply.code(404).send({ success: false, error: 'Not found' });
  });

  // POST /me/blocked/check  (is this content blocked for me?)
  app.post('/me/blocked/check', async (req, reply) => {
    let uid: string;
    try { uid = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = CheckBlockSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    return reply.send({ success: true, data: isContentBlocked(uid, parsed.data) });
  });

  // POST /me/blocked/filter  (batch filter)
  app.post('/me/blocked/filter', async (req, reply) => {
    let uid: string;
    try { uid = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = FilterBlockSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    const r = filterBlockedContent(uid, parsed.data.items);
    return reply.send({ success: true, data: { kept: r.kept, filtered: r.filtered, original: parsed.data.items.length } });
  });
}
