// melodyflix videos — Content Scheduling routes (Section 39)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  createScheduledItem, batchCreateScheduledItems, getScheduledItem, updateScheduledItem,
  cancelScheduledItem, deleteScheduledItem, listScheduledItems,
  getContentCalendar, getEditorialCalendar, expandRecurring, listItemsByTimeZone,
  getPlanningDashboard, createTask, getTask, listTasks, updateTask, deleteTask,
  listDeadlineReminders,
} from '../services/content-scheduling.service.js';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'Must be ISO 8601');

const CreateItemSchema = z.object({
  channel_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  publish_at: IsoDate,
  video_id: z.string().uuid().nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  timezone: z.string().min(1).max(64).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  is_recurring: z.boolean().optional(),
  recurrence_rule: z.string().max(100).nullable().optional(),
  parent_item_id: z.string().uuid().nullable().optional(),
});

const BatchCreateSchema = z.object({
  items: z.array(CreateItemSchema).min(1).max(100),
});

const UpdateItemSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  publish_at: IsoDate.optional(),
  timezone: z.string().min(1).max(64).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  status: z.enum(['draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled']).optional(),
});

const CreateTaskSchema = z.object({
  channel_id: z.string().uuid(),
  assignee_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  item_id: z.string().uuid().nullable().optional(),
  due_at: IsoDate.nullable().optional(),
});

const UpdateTaskSchema = z.object({
  status: z.enum(['open', 'in_progress', 'blocked', 'done']).optional(),
  due_at: IsoDate.nullable().optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  assignee_id: z.string().uuid().optional(),
});

const ExpandRecurringSchema = z.object({
  occurrences: z.number().int().min(1).max(52).default(4),
});

export async function contentSchedulingRoutes(app: FastifyInstance) {
  // ============================================================
  // 39.1 / 39.2 — CRUD + Batch
  // ============================================================

  // POST /scheduling/items
  app.post('/scheduling/items', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = CreateItemSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const item = createScheduledItem({ ...parsed.data, created_by: userId });
      return reply.code(201).send({ success: true, data: item });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /scheduling/items/batch — 39.2
  app.post('/scheduling/items/batch', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = BatchCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const items = batchCreateScheduledItems(parsed.data.items.map((it) => ({ ...it, created_by: userId })));
      return reply.code(201).send({ success: true, data: { items, count: items.length } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /scheduling/items/:id
  app.get('/scheduling/items/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = getScheduledItem(id);
    if (!item) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.send({ success: true, data: item });
  });

  // PATCH /scheduling/items/:id
  app.patch('/scheduling/items/:id', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = UpdateItemSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const item = updateScheduledItem(id, userId, parsed.data);
      return reply.send({ success: true, data: item });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // POST /scheduling/items/:id/cancel
  app.post('/scheduling/items/:id/cancel', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const ok = cancelScheduledItem(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Not found or not cancellable' });
    return reply.send({ success: true, data: { cancelled: true } });
  });

  // DELETE /scheduling/items/:id
  app.delete('/scheduling/items/:id', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const ok = deleteScheduledItem(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // GET /scheduling/items?channel_id=&from=&to=&status=&assigned_to=&priority=&limit=
  app.get('/scheduling/items', async (req, reply) => {
    const q = req.query as any;
    if (!q.channel_id) return reply.code(400).send({ success: false, error: 'channel_id required' });
    const items = listScheduledItems(q.channel_id, {
      from: q.from, to: q.to, status: q.status, assigned_to: q.assigned_to,
      priority: q.priority, limit: q.limit ? parseInt(q.limit) : undefined,
    });
    return reply.send({ success: true, data: { items } });
  });

  // ============================================================
  // 39.1 / 39.5 — Calendar views
  // ============================================================

  // GET /scheduling/calendar?channel_id=&from=&to=
  app.get('/scheduling/calendar', async (req, reply) => {
    const q = req.query as { channel_id?: string; from?: string; to?: string };
    if (!q.channel_id || !q.from || !q.to) {
      return reply.code(400).send({ success: false, error: 'channel_id, from, to required' });
    }
    const calendar = getContentCalendar(q.channel_id, q.from, q.to);
    return reply.send({ success: true, data: { calendar } });
  });

  // GET /scheduling/editorial?channel_id=&from=&to=
  app.get('/scheduling/editorial', async (req, reply) => {
    const q = req.query as { channel_id?: string; from?: string; to?: string };
    if (!q.channel_id || !q.from || !q.to) {
      return reply.code(400).send({ success: false, error: 'channel_id, from, to required' });
    }
    const calendar = getEditorialCalendar(q.channel_id, q.from, q.to);
    return reply.send({ success: true, data: { calendar } });
  });

  // ============================================================
  // 39.3 — Recurring
  // ============================================================

  // POST /scheduling/items/:id/expand
  app.post('/scheduling/items/:id/expand', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = ExpandRecurringSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const items = expandRecurring(id, parsed.data.occurrences);
      return reply.code(201).send({ success: true, data: { items, count: items.length } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // 39.4 — Time Zone
  // ============================================================

  // GET /scheduling/by-timezone?channel_id=&timezone=
  app.get('/scheduling/by-timezone', async (req, reply) => {
    const q = req.query as { channel_id?: string; timezone?: string };
    if (!q.channel_id || !q.timezone) {
      return reply.code(400).send({ success: false, error: 'channel_id, timezone required' });
    }
    try {
      const items = listItemsByTimeZone(q.channel_id, q.timezone);
      return reply.send({ success: true, data: { items } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // ============================================================
  // 39.6 — Dashboard
  // ============================================================

  // GET /scheduling/dashboard?channel_id=
  app.get('/scheduling/dashboard', async (req, reply) => {
    const q = req.query as { channel_id?: string };
    if (!q.channel_id) return reply.code(400).send({ success: false, error: 'channel_id required' });
    const user = (() => {
      try { return requireAuth(req.headers.authorization).sub as string; }
      catch { return undefined; }
    })();
    const dashboard = getPlanningDashboard(q.channel_id, user);
    return reply.send({ success: true, data: dashboard });
  });

  // ============================================================
  // 39.7 — Team Tasks
  // ============================================================

  // POST /scheduling/tasks
  app.post('/scheduling/tasks', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = CreateTaskSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const task = createTask({ ...parsed.data, created_by: userId });
      return reply.code(201).send({ success: true, data: task });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // GET /scheduling/tasks?channel_id=&assignee_id=&status=&limit=
  app.get('/scheduling/tasks', async (req, reply) => {
    const q = req.query as any;
    if (!q.channel_id) return reply.code(400).send({ success: false, error: 'channel_id required' });
    const tasks = listTasks(q.channel_id, {
      assignee_id: q.assignee_id, status: q.status,
      limit: q.limit ? parseInt(q.limit) : undefined,
    });
    return reply.send({ success: true, data: { tasks } });
  });

  // GET /scheduling/tasks/:id
  app.get('/scheduling/tasks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = getTask(id);
    if (!task) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.send({ success: true, data: task });
  });

  // PATCH /scheduling/tasks/:id
  app.patch('/scheduling/tasks/:id', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const parsed = UpdateTaskSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const { id } = req.params as { id: string };
    try {
      const task = updateTask(id, parsed.data);
      return reply.send({ success: true, data: task });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /scheduling/tasks/:id
  app.delete('/scheduling/tasks/:id', async (req, reply) => {
    let userId: string;
    try { userId = requireAuth(req.headers.authorization).sub as string; }
    catch (err) { return reply.code(401).send({ success: false, error: (err as Error).message }); }
    const { id } = req.params as { id: string };
    const ok = deleteTask(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // ============================================================
  // 39.8 — Deadline Reminders
  // ============================================================

  // GET /scheduling/reminders?channel_id=&within_hours=48
  app.get('/scheduling/reminders', async (req, reply) => {
    const q = req.query as { channel_id?: string; within_hours?: string };
    if (!q.channel_id) return reply.code(400).send({ success: false, error: 'channel_id required' });
    const within = q.within_hours ? Math.min(Math.max(parseInt(q.within_hours) || 48, 1), 720) : 48;
    const reminders = listDeadlineReminders(q.channel_id, within);
    return reply.send({ success: true, data: { reminders } });
  });
}
