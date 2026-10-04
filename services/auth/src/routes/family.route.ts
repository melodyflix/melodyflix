// melodyflix auth — Family & Parental routes (Section 65)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  setScreenTimeLimit, getScreenTimeLimit, logUsage, getScreenTimeStatus,
  getScreenTimeReport,
  requestContentApproval, getApproval, reviewContentApproval, listApprovals,
  isVideoApproved, revokeApproval,
  sendParentTeacherMessage, listThread, listInbox, markMessageRead, unreadCount,
} from '../services/family.service.js';
import { getProfile } from '../services/profiles.service.js';

const SetLimitSchema = z.object({
  daily_minutes: z.number().int().min(0).max(1440).optional(),
  weekday_minutes: z.number().int().min(0).max(1440).nullable().optional(),
  weekend_minutes: z.number().int().min(0).max(1440).nullable().optional(),
  is_enabled: z.boolean().optional(),
});

const LogUsageSchema = z.object({
  profile_id: z.string().uuid(),
  video_id: z.string().uuid().nullable().optional(),
  seconds_watched: z.number().min(0).max(86400),
  device_id: z.string().max(200).nullable().optional(),
  started_at: z.string().optional(),
});

const RequestApprovalSchema = z.object({
  video_id: z.string().uuid(),
  note: z.string().max(1000).nullable().optional(),
});

const ReviewApprovalSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  note: z.string().max(1000).nullable().optional(),
});

const SendMsgSchema = z.object({
  recipient_id: z.string().uuid(),
  body: z.string().min(1).max(5000),
  subject: z.string().max(200).nullable().optional(),
  profile_id: z.string().uuid().nullable().optional(),
});

const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD required');

function requireOwnProfile(profileId: string, accountId: string) {
  const p = getProfile(profileId);
  if (!p) throw new Error('Profile not found');
  if (p.account_id !== accountId) throw new Error('Not your profile');
  return p;
}

export async function familyRoutes(app: FastifyInstance) {
  // ============================================================
  // 65.3 — Screen-Time Limit
  // ============================================================

  // PUT /family/profiles/:profileId/screen-time
  app.put('/family/profiles/:profileId/screen-time', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { profileId } = req.params as { profileId: string };
    const parsed = SetLimitSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      requireOwnProfile(profileId, userId);
      const limit = setScreenTimeLimit({ profile_id: profileId, updated_by: userId, ...parsed.data });
      return reply.send({ success: true, data: limit });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /family/profiles/:profileId/screen-time
  app.get('/family/profiles/:profileId/screen-time', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { profileId } = req.params as { profileId: string };
    try {
      requireOwnProfile(profileId, userId);
      const limit = getScreenTimeLimit(profileId);
      const status = getScreenTimeStatus(profileId);
      return reply.send({ success: true, data: { limit, status } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /family/usage — log a watch session (client calls when playback stops)
  app.post('/family/usage', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = LogUsageSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      requireOwnProfile(parsed.data.profile_id, userId);
      const log = logUsage(parsed.data);
      const status = getScreenTimeStatus(parsed.data.profile_id);
      return reply.code(201).send({ success: true, data: { log, status } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /family/profiles/:profileId/screen-time/status — pre-playback gate
  app.get('/family/profiles/:profileId/screen-time/status', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { profileId } = req.params as { profileId: string };
    try {
      requireOwnProfile(profileId, userId);
      return reply.send({ success: true, data: getScreenTimeStatus(profileId) });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // 65.5 — Screen-Time Report
  // ============================================================

  // GET /family/profiles/:profileId/screen-time/report?from=YYYY-MM-DD&to=YYYY-MM-DD
  app.get('/family/profiles/:profileId/screen-time/report', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { profileId } = req.params as { profileId: string };
    const q = req.query as { from?: string; to?: string };
    const fromParsed = IsoDay.safeParse(q.from);
    const toParsed = IsoDay.safeParse(q.to);
    if (!fromParsed.success || !toParsed.success) {
      return reply.code(400).send({ success: false, error: 'from and to must be YYYY-MM-DD' });
    }
    try {
      requireOwnProfile(profileId, userId);
      const report = getScreenTimeReport(profileId, fromParsed.data, toParsed.data);
      return reply.send({ success: true, data: report });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // 65.6 — Content Approval
  // ============================================================

  // POST /family/profiles/:profileId/approvals — request approval
  app.post('/family/profiles/:profileId/approvals', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { profileId } = req.params as { profileId: string };
    const parsed = RequestApprovalSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      requireOwnProfile(profileId, userId);
      const approval = requestContentApproval({
        profile_id: profileId, video_id: parsed.data.video_id,
        requested_by: userId, note: parsed.data.note,
      });
      return reply.code(201).send({ success: true, data: approval });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /family/profiles/:profileId/approvals?status=pending|approved|rejected
  app.get('/family/profiles/:profileId/approvals', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { profileId } = req.params as { profileId: string };
    const q = req.query as { status?: string };
    const status = ['pending', 'approved', 'rejected'].includes(q.status ?? '')
      ? q.status as any : undefined;
    try {
      requireOwnProfile(profileId, userId);
      const approvals = listApprovals(profileId, status);
      return reply.send({ success: true, data: { approvals } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // PATCH /family/approvals/:id — parent reviews (approve/reject)
  app.patch('/family/approvals/:id', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = ReviewApprovalSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const existing = getApproval(id);
      if (!existing) return reply.code(404).send({ success: false, error: 'Approval not found' });
      requireOwnProfile(existing.profile_id, userId);
      const approval = reviewContentApproval(id, userId, parsed.data.status, parsed.data.note);
      return reply.send({ success: true, data: approval });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /family/profiles/:profileId/approvals/:videoId — revoke
  app.delete('/family/profiles/:profileId/approvals/:videoId', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { profileId, videoId } = req.params as { profileId: string; videoId: string };
    try {
      requireOwnProfile(profileId, userId);
      const ok = revokeApproval(profileId, videoId);
      if (!ok) return reply.code(404).send({ success: false, error: 'No approved entry found' });
      return reply.send({ success: true, data: { revoked: true } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /family/profiles/:profileId/approvals/check/:videoId
  app.get('/family/profiles/:profileId/approvals/check/:videoId', async (req, reply) => {
    const { profileId, videoId } = req.params as { profileId: string; videoId: string };
    const approved = isVideoApproved(profileId, videoId);
    return reply.send({ success: true, data: { approved } });
  });

  // ============================================================
  // 65.7 — Parent–Teacher Messaging
  // ============================================================

  // POST /family/messages
  app.post('/family/messages', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = SendMsgSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const msg = sendParentTeacherMessage({ sender_id: userId, ...parsed.data });
      return reply.code(201).send({ success: true, data: msg });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /family/messages/thread/:userId
  app.get('/family/messages/thread/:userId', async (req, reply) => {
    let myId: string;
    try { myId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { userId } = req.params as { userId: string };
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 100, 1), 500) : 100;
    const messages = listThread(myId, userId, limit);
    return reply.send({ success: true, data: { messages } });
  });

  // GET /family/messages/inbox?unread_only=true&limit=50
  app.get('/family/messages/inbox', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const q = req.query as { unread_only?: string; limit?: string };
    const limit = q.limit ? Math.min(Math.max(parseInt(q.limit) || 50, 1), 200) : 50;
    const messages = listInbox(userId, { unread_only: q.unread_only === 'true', limit });
    const unread = unreadCount(userId);
    return reply.send({ success: true, data: { messages, unread } });
  });

  // POST /family/messages/:id/read
  app.post('/family/messages/:id/read', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const ok = markMessageRead(id, userId);
    if (!ok) return reply.code(404).send({ success: false, error: 'Message not found or already read' });
    return reply.send({ success: true, data: { read: true } });
  });

  // GET /family/messages/unread-count
  app.get('/family/messages/unread-count', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    return reply.send({ success: true, data: { unread: unreadCount(userId) } });
  });
}
