import type { Db } from '../db/db';
import type { BookingEvent } from '../webhook/schema';
import { allowedFrom, type EventStatus } from './status';

export interface EventRecord {
  eventId: string;
  type: string;
  status: EventStatus;
  payload: BookingEvent;
  attempts: number;
  lastError: string | null;
  receivedAt: Date;
  updatedAt: Date;
  forwardedAt: Date | null;
}

interface EventRow {
  event_id: string;
  type: string;
  status: EventStatus;
  payload: BookingEvent;
  attempts: number;
  last_error: string | null;
  received_at: Date;
  updated_at: Date;
  forwarded_at: Date | null;
}

export type InsertResult = { created: boolean; record: EventRecord };

export type TransitionResult =
  | { ok: true; record: EventRecord }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'invalid_transition'; current: EventStatus };

export interface ListOptions {
  status?: EventStatus;
  limit?: number;
  offset?: number;
}

function toRecord(row: EventRow): EventRecord {
  return {
    eventId: row.event_id,
    type: row.type,
    status: row.status,
    payload: row.payload,
    attempts: row.attempts,
    lastError: row.last_error,
    receivedAt: new Date(row.received_at),
    updatedAt: new Date(row.updated_at),
    forwardedAt: row.forwarded_at ? new Date(row.forwarded_at) : null,
  };
}

export class EventRepository {
  constructor(private readonly db: Db) {}

  /**
   * Store a newly received event. The primary key makes this idempotent at the database
   * level: a repeated event_id changes nothing and is reported as created: false.
   */
  async insertReceived(event: BookingEvent): Promise<InsertResult> {
    const inserted = await this.db.query<EventRow>(
      `INSERT INTO events (event_id, type, payload)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING *`,
      [event.id, event.type, JSON.stringify(event)],
    );
    if (inserted.rows.length > 0) {
      return { created: true, record: toRecord(inserted.rows[0]) };
    }

    const existing = await this.getById(event.id);
    if (!existing) {
      throw new Error(`Event ${event.id} vanished between insert and select`);
    }
    return { created: false, record: existing };
  }

  async getById(eventId: string): Promise<EventRecord | null> {
    const result = await this.db.query<EventRow>('SELECT * FROM events WHERE event_id = $1', [eventId]);
    return result.rows.length > 0 ? toRecord(result.rows[0]) : null;
  }

  async list(options: ListOptions = {}): Promise<{ items: EventRecord[]; total: number }> {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const status = options.status ?? null;

    const rows = await this.db.query<EventRow>(
      `SELECT * FROM events
       WHERE ($1::text IS NULL OR status = $1::text)
       ORDER BY received_at DESC, event_id
       LIMIT $2 OFFSET $3`,
      [status, limit, offset],
    );
    const count = await this.db.query<{ total: number | string }>(
      `SELECT count(*) AS total FROM events WHERE ($1::text IS NULL OR status = $1::text)`,
      [status],
    );

    return { items: rows.rows.map(toRecord), total: Number(count.rows[0].total) };
  }

  /** How many events are in each status (zero for statuses with no events), plus the total. */
  async countByStatus(): Promise<Record<EventStatus, number> & { total: number }> {
    const result = await this.db.query<{ status: EventStatus; count: number | string }>(
      'SELECT status, count(*) AS count FROM events GROUP BY status',
    );
    const counts = { received: 0, retrying: 0, forwarded: 0, failed: 0, total: 0 };
    for (const row of result.rows) {
      counts[row.status] = Number(row.count);
      counts.total += Number(row.count);
    }
    return counts;
  }

  /**
   * Ids of events still waiting to be forwarded ('received' or 'retrying') that have not
   * changed for at least `olderThanSeconds`, oldest first. Used to recover from crashes.
   */
  async findStuck(olderThanSeconds: number, limit = 100): Promise<string[]> {
    const result = await this.db.query<{ event_id: string }>(
      `SELECT event_id FROM events
       WHERE status IN ('received', 'retrying')
         AND updated_at < now() - ($1::int * interval '1 second')
       ORDER BY updated_at
       LIMIT $2`,
      [olderThanSeconds, limit],
    );
    return result.rows.map((row) => row.event_id);
  }

  /**
   * Move an event to a new status if the lifecycle allows it. The allowed "from" states are
   * checked inside the UPDATE itself, so two workers racing on the same event cannot both win.
   * Moving to 'retrying' counts an attempt; moving to 'forwarded' clears the last error.
   */
  async transition(eventId: string, to: EventStatus, error?: string): Promise<TransitionResult> {
    const updated = await this.db.query<EventRow>(
      `UPDATE events
       SET status       = $2::text,
           attempts     = attempts + CASE WHEN $2::text = 'retrying' THEN 1 ELSE 0 END,
           last_error   = CASE WHEN $2::text = 'forwarded' THEN NULL ELSE COALESCE($3::text, last_error) END,
           forwarded_at = CASE WHEN $2::text = 'forwarded' THEN now() ELSE forwarded_at END,
           updated_at   = now()
       WHERE event_id = $1 AND status = ANY($4::text[])
       RETURNING *`,
      [eventId, to, error ?? null, allowedFrom(to)],
    );
    if (updated.rows.length > 0) {
      return { ok: true, record: toRecord(updated.rows[0]) };
    }

    const current = await this.getById(eventId);
    if (!current) {
      return { ok: false, reason: 'not_found' };
    }
    return { ok: false, reason: 'invalid_transition', current: current.status };
  }
}
