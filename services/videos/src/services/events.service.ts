// melodyflix videos — Events & Ticketing (23.1 Event Creation,
// 23.2 Ticket Booking, 23.3 Virtual Event, 23.4 Event Reminder)

import { randomUUID, createHash } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type EventType = 'in_person' | 'virtual' | 'hybrid';
export type EventStatus = 'draft' | 'published' | 'sold_out' | 'live' | 'ended' | 'cancelled';
export type TicketState = 'reserved' | 'paid' | 'checked_in' | 'cancelled' | 'refunded';

export function ensureEventsSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      channel_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      cover_url TEXT,
      event_type TEXT NOT NULL DEFAULT 'in_person'
        CHECK (event_type IN ('in_person','virtual','hybrid')),
      venue_name TEXT,
      venue_address TEXT,
      virtual_stream_id TEXT,        -- ties to live_streams (23.3)
      virtual_join_url TEXT,
      starts_at TEXT NOT NULL,
      ends_at TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      capacity INTEGER,              -- null = unlimited
      tickets_sold INTEGER NOT NULL DEFAULT 0,
      price_cents INTEGER NOT NULL DEFAULT 0,   -- 0 = free
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','published','sold_out','live','ended','cancelled')),
      is_public INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_owner
      ON events(owner_id, starts_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_time
      ON events(starts_at, status);
    CREATE INDEX IF NOT EXISTS idx_events_status
      ON events(status, starts_at);

    CREATE TABLE IF NOT EXISTS event_tickets (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      price_cents INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      state TEXT NOT NULL DEFAULT 'reserved'
        CHECK (state IN ('reserved','paid','checked_in','cancelled','refunded')),
      transaction_id TEXT,
      qr_token TEXT NOT NULL UNIQUE,
      seat_label TEXT,
      checked_in_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tickets_event
      ON event_tickets(event_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tickets_user
      ON event_tickets(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tickets_qr
      ON event_tickets(qr_token);

    CREATE TABLE IF NOT EXISTS event_reminders (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      remind_minutes_before INTEGER NOT NULL DEFAULT 60,
      notified_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (event_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_reminders_due
      ON event_reminders(notified_at, event_id);
  `);
}

// ============================================================
// 23.1 Event Creation
// ============================================================

export interface Event {
  id: string;
  owner_id: string;
  channel_id: string | null;
  title: string;
  description: string | null;
  cover_url: string | null;
  event_type: EventType;
  venue_name: string | null;
  venue_address: string | null;
  virtual_stream_id: string | null;
  virtual_join_url: string | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  capacity: number | null;
  tickets_sold: number;
  price_cents: number;
  currency: string;
  status: EventStatus;
  is_public: number;
  created_at: string;
  updated_at: string;
}

export interface CreateEventInput {
  owner_id: string;
  channel_id?: string | null;
  title: string;
  description?: string | null;
  cover_url?: string | null;
  event_type?: EventType;
  venue_name?: string | null;
  venue_address?: string | null;
  virtual_stream_id?: string | null;
  virtual_join_url?: string | null;
  starts_at: string;
  ends_at?: string | null;
  timezone?: string;
  capacity?: number | null;
  price_cents?: number;
  currency?: string;
  is_public?: boolean;
}

const MAX_CAPACITY = 10_000_000;
const MAX_PRICE_CENTS = 100_000_00; // $100,000

export function createEvent(input: CreateEventInput): Event {
  const title = (input.title ?? '').trim();
  if (title.length < 1 || title.length > 200) throw new Error('title must be 1-200 chars');
  const startsMs = new Date(input.starts_at).getTime();
  if (isNaN(startsMs)) throw new Error('Invalid starts_at');
  if (input.ends_at && new Date(input.ends_at).getTime() <= startsMs) {
    throw new Error('ends_at must be after starts_at');
  }
  if (input.capacity !== undefined && input.capacity !== null) {
    if (input.capacity < 1 || input.capacity > MAX_CAPACITY) throw new Error('capacity out of range');
  }
  const price = input.price_cents ?? 0;
  if (price < 0 || price > MAX_PRICE_CENTS) throw new Error('price_cents out of range');

  const type: EventType = input.event_type ?? 'in_person';
  if ((type === 'virtual' || type === 'hybrid')) {
    if (!input.virtual_stream_id && !input.virtual_join_url) {
      throw new Error('virtual/hybrid events require virtual_stream_id or virtual_join_url');
    }
  }

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO events
      (id, owner_id, channel_id, title, description, cover_url, event_type,
       venue_name, venue_address, virtual_stream_id, virtual_join_url,
       starts_at, ends_at, timezone, capacity, tickets_sold, price_cents,
       currency, status, is_public, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?,
            'draft', ?, ?, ?)
  `).run(
    id, input.owner_id, input.channel_id ?? null, title,
    input.description ?? null, input.cover_url ?? null, type,
    input.venue_name ?? null, input.venue_address ?? null,
    input.virtual_stream_id ?? null, input.virtual_join_url ?? null,
    new Date(startsMs).toISOString(),
    input.ends_at ? new Date(input.ends_at).toISOString() : null,
    input.timezone ?? 'UTC',
    input.capacity ?? null,
    price,
    (input.currency ?? 'USD').toUpperCase().slice(0, 3),
    input.is_public === false ? 0 : 1,
    now, now,
  );
  return getEvent(id)!;
}

export function getEvent(id: string): Event | null {
  return (getDb().prepare('SELECT * FROM events WHERE id = ?').get(id) as Event | undefined) ?? null;
}

export interface ListEventsOpts {
  owner_id?: string;
  status?: EventStatus;
  type?: EventType;
  from?: string;
  to?: string;
  public_only?: boolean;
  limit?: number;
}

export function listEvents(opts: ListEventsOpts = {}): Event[] {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];
  if (opts.owner_id) { where.push('owner_id = ?'); params.push(opts.owner_id); }
  if (opts.status) { where.push('status = ?'); params.push(opts.status); }
  if (opts.type) { where.push('event_type = ?'); params.push(opts.type); }
  if (opts.from) { where.push('starts_at >= ?'); params.push(opts.from); }
  if (opts.to) { where.push('starts_at <= ?'); params.push(opts.to); }
  if (opts.public_only) where.push('is_public = 1');
  const n = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  params.push(n);
  return db.prepare(`
    SELECT * FROM events
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY starts_at ASC LIMIT ?
  `).all(...params) as Event[];
}

export interface UpdateEventInput {
  title?: string;
  description?: string | null;
  cover_url?: string | null;
  venue_name?: string | null;
  venue_address?: string | null;
  virtual_join_url?: string | null;
  starts_at?: string;
  ends_at?: string | null;
  timezone?: string;
  capacity?: number | null;
  price_cents?: number;
  is_public?: boolean;
}

export function updateEvent(id: string, ownerId: string, patch: UpdateEventInput): Event | null {
  const cur = getEvent(id);
  if (!cur) return null;
  if (cur.owner_id !== ownerId) throw new Error('Not your event');
  if (cur.status === 'live' || cur.status === 'ended') throw new Error('Cannot edit live or ended event');

  const fields: string[] = [];
  const values: any[] = [];
  const map: Record<string, any> = {
    title: patch.title,
    description: patch.description,
    cover_url: patch.cover_url,
    venue_name: patch.venue_name,
    venue_address: patch.venue_address,
    virtual_join_url: patch.virtual_join_url,
    starts_at: patch.starts_at ? new Date(patch.starts_at).toISOString() : undefined,
    ends_at: patch.ends_at === undefined ? undefined : (patch.ends_at ? new Date(patch.ends_at).toISOString() : null),
    timezone: patch.timezone,
    capacity: patch.capacity,
    price_cents: patch.price_cents,
    is_public: patch.is_public === undefined ? undefined : (patch.is_public ? 1 : 0),
  };
  for (const [k, v] of Object.entries(map)) {
    if (v === undefined) continue;
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (fields.length === 0) return cur;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  getDb().prepare(`UPDATE events SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getEvent(id);
}

export function publishEvent(id: string, ownerId: string): Event | null {
  const cur = getEvent(id);
  if (!cur) return null;
  if (cur.owner_id !== ownerId) throw new Error('Not your event');
  if (cur.status !== 'draft') throw new Error('Only draft events can be published');
  const db = getDb();
  db.prepare(`UPDATE events SET status = 'published', updated_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), id);
  return getEvent(id);
}

export function cancelEvent(id: string, ownerId: string): Event | null {
  const cur = getEvent(id);
  if (!cur) return null;
  if (cur.owner_id !== ownerId) throw new Error('Not your event');
  if (cur.status === 'ended') throw new Error('Cannot cancel ended event');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`UPDATE events SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(now, id);
  // Refund all active tickets
  db.prepare(`
    UPDATE event_tickets SET state = 'refunded', updated_at = ?
    WHERE event_id = ? AND state IN ('reserved','paid','checked_in')
  `).run(now, id);
  return getEvent(id);
}

export function deleteEvent(id: string, ownerId: string): boolean {
  const cur = getEvent(id);
  if (!cur) return false;
  if (cur.owner_id !== ownerId) throw new Error('Not your event');
  const db = getDb();
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM event_tickets WHERE event_id = ?').run(id);
    db.prepare('DELETE FROM event_reminders WHERE event_id = ?').run(id);
    db.prepare('DELETE FROM events WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return true;
}

// ============================================================
// 23.2 Ticket Booking
// ============================================================

export interface EventTicket {
  id: string;
  event_id: string;
  user_id: string;
  quantity: number;
  price_cents: number;
  total_cents: number;
  currency: string;
  state: TicketState;
  transaction_id: string | null;
  qr_token: string;
  seat_label: string | null;
  checked_in_at: string | null;
  created_at: string;
  updated_at: string;
}

function makeQrToken(eventId: string, userId: string): string {
  const raw = `${eventId}:${userId}:${randomUUID()}`;
  return 'TKT-' + createHash('sha256').update(raw).digest('hex').slice(0, 24).toUpperCase();
}

export interface BookTicketInput {
  event_id: string;
  user_id: string;
  quantity?: number;
  transaction_id?: string | null;
  seat_label?: string | null;
}

export function bookTicket(input: BookTicketInput): EventTicket {
  const ev = getEvent(input.event_id);
  if (!ev) throw new Error('Event not found');
  if (ev.status !== 'published' && ev.status !== 'sold_out') {
    throw new Error('Event is not open for booking');
  }
  if (ev.status === 'sold_out') throw new Error('Event is sold out');

  const qty = Math.max(1, Math.min(input.quantity ?? 1, 10));

  // Capacity check + atomic reservation
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const total = ev.price_cents * qty;

  db.exec('BEGIN');
  try {
    if (ev.capacity !== null) {
      const soldNow = (db.prepare(
        `SELECT COALESCE(SUM(quantity),0) as n FROM event_tickets
         WHERE event_id = ? AND state IN ('reserved','paid','checked_in')`
      ).get(ev.id) as { n: number }).n;
      if (soldNow + qty > ev.capacity) {
        throw new Error('Not enough tickets remaining');
      }
    }

    db.prepare(`
      INSERT INTO event_tickets
        (id, event_id, user_id, quantity, price_cents, total_cents, currency,
         state, transaction_id, qr_token, seat_label, checked_in_at,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, NULL, ?, ?)
    `).run(
      id, ev.id, input.user_id, qty, ev.price_cents, total, ev.currency,
      input.transaction_id ?? null, makeQrToken(ev.id, input.user_id),
      input.seat_label ?? null, now, now,
    );

    db.prepare(`
      UPDATE events SET tickets_sold = tickets_sold + ?, updated_at = ?
      WHERE id = ?
    `).run(qty, now, ev.id);

    // If sold out — flag
    if (ev.capacity !== null) {
      const newSold = (db.prepare('SELECT tickets_sold FROM events WHERE id = ?')
        .get(ev.id) as { tickets_sold: number }).tickets_sold;
      if (newSold >= ev.capacity) {
        db.prepare(`UPDATE events SET status = 'sold_out', updated_at = ? WHERE id = ?`)
          .run(now, ev.id);
      }
    }

    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return getTicket(id)!;
}

export function getTicket(id: string): EventTicket | null {
  return (getDb().prepare('SELECT * FROM event_tickets WHERE id = ?').get(id) as EventTicket | undefined) ?? null;
}

export function getTicketByQr(qrToken: string): EventTicket | null {
  return (getDb().prepare('SELECT * FROM event_tickets WHERE qr_token = ?').get(qrToken) as EventTicket | undefined) ?? null;
}

export function markTicketPaid(id: string, transactionId?: string | null): EventTicket | null {
  const cur = getTicket(id);
  if (!cur) return null;
  if (cur.state !== 'reserved') throw new Error('Ticket is not reserved');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE event_tickets
    SET state = 'paid', transaction_id = COALESCE(?, transaction_id), updated_at = ?
    WHERE id = ?
  `).run(transactionId ?? null, now, id);
  return getTicket(id);
}

export function cancelTicket(id: string, userId: string): EventTicket | null {
  const cur = getTicket(id);
  if (!cur) return null;
  if (cur.user_id !== userId) throw new Error('Not your ticket');
  if (cur.state === 'cancelled' || cur.state === 'refunded') throw new Error('Ticket already inactive');

  const db = getDb();
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE event_tickets SET state = 'cancelled', updated_at = ? WHERE id = ?`).run(now, id);
    db.prepare(`
      UPDATE events SET tickets_sold = MAX(0, tickets_sold - ?), updated_at = ?
      WHERE id = ?
    `).run(cur.quantity, now, cur.event_id);
    // If sold_out and now we have room, revert to published
    const ev = getEvent(cur.event_id);
    if (ev && ev.status === 'sold_out' && ev.capacity !== null) {
      const newSold = (db.prepare('SELECT tickets_sold FROM events WHERE id = ?')
        .get(cur.event_id) as { tickets_sold: number }).tickets_sold;
      if (newSold < ev.capacity) {
        db.prepare(`UPDATE events SET status = 'published', updated_at = ? WHERE id = ?`)
          .run(now, cur.event_id);
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return getTicket(id);
}

export function refundTicket(id: string, requesterId: string): EventTicket | null {
  const cur = getTicket(id);
  if (!cur) return null;
  const ev = getEvent(cur.event_id);
  if (cur.user_id !== requesterId && ev?.owner_id !== requesterId) {
    throw new Error('Not allowed');
  }
  if (cur.state === 'refunded') throw new Error('Already refunded');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`UPDATE event_tickets SET state = 'refunded', updated_at = ? WHERE id = ?`).run(now, id);
  return getTicket(id);
}

export function checkInTicket(qrToken: string, requesterId: string): EventTicket | null {
  const cur = getTicketByQr(qrToken);
  if (!cur) return null;
  const ev = getEvent(cur.event_id);
  if (ev?.owner_id !== requesterId) throw new Error('Not your event');
  if (cur.state !== 'paid') throw new Error('Ticket is not paid');
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE event_tickets SET state = 'checked_in', checked_in_at = ?, updated_at = ?
    WHERE id = ?
  `).run(now, now, cur.id);
  return getTicket(cur.id);
}

export function listEventTickets(eventId: string, limit = 200): EventTicket[] {
  const n = Math.min(Math.max(limit, 1), 500);
  return getDb().prepare(
    'SELECT * FROM event_tickets WHERE event_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(eventId, n) as EventTicket[];
}

export function listMyTickets(userId: string, limit = 100): EventTicket[] {
  const n = Math.min(Math.max(limit, 1), 500);
  return getDb().prepare(
    'SELECT * FROM event_tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(userId, n) as EventTicket[];
}

// ============================================================
// 23.3 Virtual Event — join info resolver
// ============================================================

export interface EventJoinInfo {
  event_id: string;
  mode: 'virtual' | 'in_person' | 'hybrid';
  join_url: string | null;
  stream_id: string | null;
  venue_name: string | null;
  venue_address: string | null;
  starts_at: string;
  user_has_valid_ticket: boolean;
  ticket_id: string | null;
}

export function getEventJoinInfo(eventId: string, userId: string | null): EventJoinInfo {
  const ev = getEvent(eventId);
  if (!ev) throw new Error('Event not found');

  let validTicket: EventTicket | null = null;
  if (userId) {
    validTicket = (getDb().prepare(`
      SELECT * FROM event_tickets
      WHERE event_id = ? AND user_id = ?
        AND state IN ('paid','checked_in')
      ORDER BY created_at DESC LIMIT 1
    `).get(eventId, userId) as EventTicket | undefined) ?? null;
  }

  const isVirtual = ev.event_type === 'virtual' || ev.event_type === 'hybrid';
  const priceFree = ev.price_cents === 0;
  const hasAccess = priceFree || !!validTicket || ev.owner_id === userId;

  return {
    event_id: ev.id,
    mode: ev.event_type,
    join_url: isVirtual && hasAccess ? ev.virtual_join_url : null,
    stream_id: isVirtual && hasAccess ? ev.virtual_stream_id : null,
    venue_name: ev.venue_name,
    venue_address: hasAccess ? ev.venue_address : null,
    starts_at: ev.starts_at,
    user_has_valid_ticket: !!validTicket,
    ticket_id: validTicket?.id ?? null,
  };
}

// ============================================================
// 23.4 Event Reminder
// ============================================================

export interface EventReminder {
  id: string;
  event_id: string;
  user_id: string;
  remind_minutes_before: number;
  notified_at: string | null;
  created_at: string;
}

export function setReminder(input: {
  event_id: string;
  user_id: string;
  remind_minutes_before?: number;
}): EventReminder {
  const ev = getEvent(input.event_id);
  if (!ev) throw new Error('Event not found');
  if (ev.status === 'ended' || ev.status === 'cancelled') throw new Error('Event already ended');
  const before = Math.max(1, Math.min(input.remind_minutes_before ?? 60, 7 * 24 * 60));

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO event_reminders (id, event_id, user_id, remind_minutes_before, notified_at, created_at)
    VALUES (?, ?, ?, ?, NULL, ?)
    ON CONFLICT(event_id, user_id) DO UPDATE SET
      remind_minutes_before = excluded.remind_minutes_before,
      notified_at = NULL
  `).run(id, input.event_id, input.user_id, before, now);
  return db.prepare(
    'SELECT * FROM event_reminders WHERE event_id = ? AND user_id = ?'
  ).get(input.event_id, input.user_id) as EventReminder;
}

export function removeReminder(eventId: string, userId: string): boolean {
  return getDb().prepare(
    'DELETE FROM event_reminders WHERE event_id = ? AND user_id = ?'
  ).run(eventId, userId).changes > 0;
}

export function listMyReminders(userId: string, limit = 50): EventReminder[] {
  const n = Math.min(Math.max(limit, 1), 200);
  return getDb().prepare(
    'SELECT * FROM event_reminders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(userId, n) as EventReminder[];
}

// Worker: due reminders
export function listDueReminders(nowIso = new Date().toISOString()): EventReminder[] {
  const db = getDb();
  const now = new Date(nowIso).getTime();
  const rows = db.prepare(`
    SELECT r.* FROM event_reminders r
    JOIN events e ON e.id = r.event_id
    WHERE r.notified_at IS NULL
      AND e.status NOT IN ('cancelled','ended')
  `).all() as EventReminder[];
  return rows.filter((r) => {
    const ev = getEvent(r.event_id);
    if (!ev) return false;
    const remindMs = new Date(ev.starts_at).getTime() - r.remind_minutes_before * 60_000;
    return remindMs <= now;
  });
}

export function markReminderNotified(id: string): void {
  getDb().prepare('UPDATE event_reminders SET notified_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id);
}

// ============================================================
// Stats
// ============================================================

export interface EventStats {
  event_id: string;
  tickets_reserved: number;
  tickets_paid: number;
  tickets_checked_in: number;
  tickets_cancelled: number;
  tickets_refunded: number;
  revenue_cents: number;
  capacity: number | null;
  fill_rate: number;
}

export function getEventStats(eventId: string): EventStats {
  const db = getDb();
  const ev = getEvent(eventId);
  const rows = db.prepare(`
    SELECT state, SUM(quantity) as qty FROM event_tickets
    WHERE event_id = ? GROUP BY state
  `).all(eventId) as { state: string; qty: number }[];
  const map = new Map(rows.map((r) => [r.state, r.qty]));
  const reserved = map.get('reserved') ?? 0;
  const paid = map.get('paid') ?? 0;
  const checked = map.get('checked_in') ?? 0;
  const cancelled = map.get('cancelled') ?? 0;
  const refunded = map.get('refunded') ?? 0;
  const revenueRow = db.prepare(`
    SELECT COALESCE(SUM(total_cents), 0) as c FROM event_tickets
    WHERE event_id = ? AND state IN ('paid','checked_in')
  `).get(eventId) as { c: number };
  const cap = ev?.capacity ?? null;
  const fill = cap ? Math.min(1, (paid + checked + reserved) / cap) : 0;
  return {
    event_id: eventId,
    tickets_reserved: reserved,
    tickets_paid: paid,
    tickets_checked_in: checked,
    tickets_cancelled: cancelled,
    tickets_refunded: refunded,
    revenue_cents: revenueRow.c ?? 0,
    capacity: cap,
    fill_rate: Number(fill.toFixed(3)),
  };
}
