// melodyflix videos — Sports Streaming routes (Section 68)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  createSportsTeam, getSportsTeam, listSportsTeams,
  createSportsMatch, getSportsMatch, listSportsMatches,
  updateSportsMatchStatus, updateSportsScore,
  addTimelineEvent, listTimeline, deleteTimelineEvent,
  createReminder, listUserReminders, cancelReminder,
  getDueReminders, markReminderSent,
  ensureSportsReplaySchema,
  saveReplay, getReplay, listReplays, listUserReplays,
  deleteReplay, rewindLive, linkReplayToEvent,
} from '../services/livetv.service.js';

const STATUSES = ['scheduled','live','halftime','finished','postponed','cancelled'] as const;
const EVENT_TYPES = ['goal','own_goal','yellow_card','red_card','substitution','penalty','var','kickoff','halftime','fulltime','info'] as const;

function userId(req: any): string | null {
  return req.user?.id ?? req.user?.sub ?? null;
}

function checkInternalSecret(req: any): boolean {
  const secret = req.headers['x-internal-secret'];
  const expected = process.env.MELODYFLIX_INTERNAL_SECRET ?? '';
  if (!expected) return true; // dev mode
  return secret === expected;
}

export async function sportsRoutes(app: FastifyInstance) {
  // ---- Teams ----

  const TeamSchema = z.object({
    name: z.string().min(1).max(120),
    short_name: z.string().max(20).nullable().optional(),
    logo_url: z.string().url().nullable().optional(),
    country: z.string().max(60).nullable().optional(),
  });

  app.get('/sports/teams', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const q = req.query as { limit?: string };
    const teams = listSportsTeams(me, q.limit ? parseInt(q.limit) : 200);
    return reply.send({ success: true, data: { teams, count: teams.length } });
  });

  app.post('/sports/teams', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = TeamSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const team = createSportsTeam({ owner_id: me, ...parsed.data });
    return reply.code(201).send({ success: true, data: { team } });
  });

  app.get('/sports/teams/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const team = getSportsTeam(id);
    if (!team) return reply.code(404).send({ success: false, error: 'Team not found' });
    return reply.send({ success: true, data: { team } });
  });

  // ---- Matches ----

  const MatchSchema = z.object({
    channel_id: z.string().min(1),
    home_team_id: z.string().min(1),
    away_team_id: z.string().min(1),
    league: z.string().max(120).nullable().optional(),
    venue: z.string().max(200).nullable().optional(),
    start_ts: z.string(),
    overlay_style: z.string().max(40).optional(),
  });

  const StatusSchema = z.object({
    status: z.enum(STATUSES),
    minute: z.number().int().min(0).max(200).nullable().optional(),
    period: z.string().max(40).nullable().optional(),
  });

  const ScoreSchema = z.object({
    home_score: z.number().int().min(0).max(99),
    away_score: z.number().int().min(0).max(99),
    minute: z.number().int().min(0).max(200).nullable().optional(),
  });

  app.get('/sports/matches', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const matches = listSportsMatches({
      owner_id: q.owner_id,
      channel_id: q.channel_id,
      status: (q.status as any) ?? undefined,
      from: q.from,
      to: q.to,
      limit: q.limit ? parseInt(q.limit) : undefined,
    });
    return reply.send({ success: true, data: { matches, count: matches.length } });
  });

  app.get('/sports/matches/live', async (_req, reply) => {
    const matches = listSportsMatches({ status: 'live', limit: 100 });
    return reply.send({ success: true, data: { matches, count: matches.length } });
  });

  app.get('/sports/matches/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const m = getSportsMatch(id);
    if (!m) return reply.code(404).send({ success: false, error: 'Match not found' });
    return reply.send({ success: true, data: { match: m } });
  });

  app.post('/sports/matches', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = MatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const match = createSportsMatch({ owner_id: me, ...parsed.data });
      return reply.code(201).send({ success: true, data: { match } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Create failed' });
    }
  });

  app.patch('/sports/matches/:id/status', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const m = getSportsMatch(id);
    if (!m) return reply.code(404).send({ success: false, error: 'Match not found' });
    if (m.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your match' });
    const parsed = StatusSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const updated = updateSportsMatchStatus(id, parsed.data.status, {
      minute: parsed.data.minute,
      period: parsed.data.period,
    });
    return reply.send({ success: true, data: { match: updated } });
  });

  app.patch('/sports/matches/:id/score', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const m = getSportsMatch(id);
    if (!m) return reply.code(404).send({ success: false, error: 'Match not found' });
    if (m.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your match' });
    const parsed = ScoreSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const updated = updateSportsScore(id, parsed.data.home_score, parsed.data.away_score, parsed.data.minute);
    return reply.send({ success: true, data: { match: updated } });
  });

  // ---- Timeline (68.2) ----

  const TimelineSchema = z.object({
    team_id: z.string().nullable().optional(),
    event_type: z.enum(EVENT_TYPES),
    minute: z.number().int().min(0).max(200).nullable().optional(),
    player_name: z.string().max(120).nullable().optional(),
    player_out: z.string().max(120).nullable().optional(),
    description: z.string().max(500).nullable().optional(),
  });

  app.get('/sports/matches/:id/timeline', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string };
    const events = listTimeline(id, q.limit ? parseInt(q.limit) : 200);
    return reply.send({ success: true, data: { events, count: events.length } });
  });

  app.post('/sports/matches/:id/timeline', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const m = getSportsMatch(id);
    if (!m) return reply.code(404).send({ success: false, error: 'Match not found' });
    if (m.owner_id !== me) return reply.code(403).send({ success: false, error: 'Not your match' });
    const parsed = TimelineSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    const event = addTimelineEvent({ match_id: id, ...parsed.data });
    return reply.code(201).send({ success: true, data: { event } });
  });

  app.delete('/sports/timeline/:eventId', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { eventId } = req.params as { eventId: string };
    const removed = deleteTimelineEvent(eventId);
    return reply.send({ success: true, data: { removed } });
  });

  // ---- Reminders (68.4) ----

  const ReminderSchema = z.object({
    match_id: z.string().min(1),
    remind_at: z.string(),
    channel: z.enum(['push','email','inapp']).optional(),
  });

  app.get('/sports/reminders', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const q = req.query as { limit?: string };
    const reminders = listUserReminders(me, q.limit ? parseInt(q.limit) : 100);
    return reply.send({ success: true, data: { reminders, count: reminders.length } });
  });

  app.post('/sports/reminders', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = ReminderSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const reminder = createReminder({ user_id: me, ...parsed.data });
      return reply.code(201).send({ success: true, data: { reminder } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Create failed' });
    }
  });

  app.delete('/sports/reminders/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const removed = cancelReminder(me, id);
    return reply.send({ success: true, data: { removed } });
  });

  // Worker endpoints (secret-protected)
  app.get('/sports/reminders/due', async (req, reply) => {
    if (!checkInternalSecret(req)) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const q = req.query as { at?: string };
    const due = getDueReminders(q.at);
    return reply.send({ success: true, data: { due, count: due.length } });
  });

  app.post('/sports/reminders/:id/sent', async (req, reply) => {
    if (!checkInternalSecret(req)) return reply.code(403).send({ success: false, error: 'Forbidden' });
    const { id } = req.params as { id: string };
    markReminderSent(id);
    return reply.send({ success: true, data: { sent: true } });
  });

  // ---- Instant Replay (68.3) ----

  const SaveReplaySchema = z.object({
    match_id: z.string().min(1),
    label: z.string().min(1).max(200),
    start_ts: z.string(),
    duration_seconds: z.number().min(0).max(600),
    event_id: z.string().nullable().optional(),
    is_public: z.boolean().optional(),
  });

  const RewindSchema = z.object({
    seconds: z.number().int().min(1).max(6 * 3600),
  });

  // GET /sports/matches/:id/replays — public replays of a match
  app.get('/sports/matches/:id/replays', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string };
    const replays = listReplays(id, q.limit ? parseInt(q.limit) : 100);
    return reply.send({ success: true, data: { replays, count: replays.length } });
  });

  // POST /sports/replays — save a replay clip
  app.post('/sports/replays', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const parsed = SaveReplaySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const replay = saveReplay({ user_id: me, ...parsed.data });
      return reply.code(201).send({ success: true, data: { replay } });
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'Save failed' });
    }
  });

  // GET /sports/replays/mine — my saved clips
  app.get('/sports/replays/mine', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const q = req.query as { limit?: string };
    const replays = listUserReplays(me, q.limit ? parseInt(q.limit) : 100);
    return reply.send({ success: true, data: { replays, count: replays.length } });
  });

  // GET /sports/replays/:id — single
  app.get('/sports/replays/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = getReplay(id);
    if (!r) return reply.code(404).send({ success: false, error: 'Replay not found' });
    if (!r.is_public) {
      const me = userId(req as any);
      if (r.user_id !== me) return reply.code(403).send({ success: false, error: 'Private replay' });
    }
    return reply.send({ success: true, data: { replay: r } });
  });

  // DELETE /sports/replays/:id
  app.delete('/sports/replays/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    try {
      const removed = deleteReplay(id, me);
      return reply.send({ success: true, data: { removed } });
    } catch (e: any) {
      return reply.code(403).send({ success: false, error: e?.message ?? 'Forbidden' });
    }
  });

  // POST /sports/replays/:id/link — link to timeline event
  app.post('/sports/replays/:id/link', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = userId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { id } = req.params as { id: string };
    const body = req.body as { event_id?: string };
    if (!body?.event_id) return reply.code(400).send({ success: false, error: 'event_id required' });
    const r0 = getReplay(id);
    if (!r0) return reply.code(404).send({ success: false, error: 'Replay not found' });
    if (r0.user_id !== me) return reply.code(403).send({ success: false, error: 'Not your replay' });
    const r = linkReplayToEvent(id, body.event_id);
    return reply.send({ success: true, data: { replay: r } });
  });

  // POST /sports/matches/:id/rewind — validate live rewind against time-shift
  app.post('/sports/matches/:id/rewind', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = RewindSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    try {
      const result = rewindLive(id, parsed.data.seconds);
      return reply.send({ success: true, data: result });
    } catch (e: any) {
      if (e?.message === 'Match not found') {
        return reply.code(404).send({ success: false, error: 'Match not found' });
      }
      return reply.code(500).send({ success: false, error: e?.message ?? 'Rewind failed' });
    }
  });

}
