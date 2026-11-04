import type { Db } from '../src/db/db';
import { migrate } from '../src/db/migrations';
import { EventRepository } from '../src/events/repository';
import type { BookingEvent } from '../src/webhook/schema';
import { createTestDb } from './helpers/testDb';

const makeEvent = (id: string): BookingEvent => ({
  id,
  type: 'booking.created',
  customer: { name: 'Asha Rao', email: 'asha@example.com', phone: '+919876543210' },
  service: 'Discovery call',
  startsAt: '2026-12-01T10:00:00Z',
});

describe('EventRepository (real Postgres engine)', () => {
  let db: Db & { close(): Promise<void> };
  let repo: EventRepository;

  beforeEach(async () => {
    db = await createTestDb();
    repo = new EventRepository(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('stores a new event as received and reads it back', async () => {
    const { created, record } = await repo.insertReceived(makeEvent('evt_1'));
    expect(created).toBe(true);
    expect(record.status).toBe('received');
    expect(record.attempts).toBe(0);
    expect(record.payload.customer.phone).toBe('+919876543210');

    const fetched = await repo.getById('evt_1');
    expect(fetched?.eventId).toBe('evt_1');
    expect(fetched?.receivedAt).toBeInstanceOf(Date);
  });

  it('is idempotent: the same event id is stored once', async () => {
    await repo.insertReceived(makeEvent('evt_1'));
    const second = await repo.insertReceived(makeEvent('evt_1'));
    expect(second.created).toBe(false);
    const all = await repo.list();
    expect(all.total).toBe(1);
  });

  it('returns null for an unknown event', async () => {
    expect(await repo.getById('nope')).toBeNull();
  });

  it('moves received to retrying and counts the attempt', async () => {
    await repo.insertReceived(makeEvent('evt_1'));
    const result = await repo.transition('evt_1', 'retrying');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.status).toBe('retrying');
      expect(result.record.attempts).toBe(1);
    }
  });

  it('records the error when an event fails and keeps it', async () => {
    await repo.insertReceived(makeEvent('evt_1'));
    await repo.transition('evt_1', 'retrying');
    const failed = await repo.transition('evt_1', 'failed', 'CRM returned 503');
    expect(failed.ok && failed.record.lastError).toBe('CRM returned 503');
    expect(failed.ok && failed.record.status).toBe('failed');
  });

  it('replays a failed event: failed to retrying increments attempts', async () => {
    await repo.insertReceived(makeEvent('evt_1'));
    await repo.transition('evt_1', 'retrying');
    await repo.transition('evt_1', 'failed', 'boom');
    const replay = await repo.transition('evt_1', 'retrying');
    expect(replay.ok && replay.record.attempts).toBe(2);
    expect(replay.ok && replay.record.lastError).toBe('boom'); // kept until it succeeds
  });

  it('sets forwarded_at and clears the error on success', async () => {
    await repo.insertReceived(makeEvent('evt_1'));
    await repo.transition('evt_1', 'retrying');
    await repo.transition('evt_1', 'failed', 'boom');
    await repo.transition('evt_1', 'retrying');
    const done = await repo.transition('evt_1', 'forwarded');
    expect(done.ok && done.record.status).toBe('forwarded');
    expect(done.ok && done.record.lastError).toBeNull();
    expect(done.ok && done.record.forwardedAt).toBeInstanceOf(Date);
  });

  it('refuses an invalid transition and reports the current status', async () => {
    await repo.insertReceived(makeEvent('evt_1'));
    await repo.transition('evt_1', 'forwarded');
    const result = await repo.transition('evt_1', 'retrying');
    expect(result).toEqual({ ok: false, reason: 'invalid_transition', current: 'forwarded' });
    expect((await repo.getById('evt_1'))?.status).toBe('forwarded');
  });

  it('reports not_found when transitioning an unknown event', async () => {
    const result = await repo.transition('nope', 'forwarded');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('lists newest first, filters by status and paginates', async () => {
    await repo.insertReceived(makeEvent('evt_1'));
    await repo.insertReceived(makeEvent('evt_2'));
    await repo.insertReceived(makeEvent('evt_3'));
    await repo.transition('evt_2', 'failed', 'boom');

    const failed = await repo.list({ status: 'failed' });
    expect(failed.total).toBe(1);
    expect(failed.items[0].eventId).toBe('evt_2');

    const page = await repo.list({ limit: 2, offset: 0 });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);
    const rest = await repo.list({ limit: 2, offset: 2 });
    expect(rest.items).toHaveLength(1);
  });

  it('enforces the status check constraint in the database itself', async () => {
    await repo.insertReceived(makeEvent('evt_1'));
    await expect(db.query("UPDATE events SET status = 'bogus' WHERE event_id = 'evt_1'")).rejects.toThrow();
  });
});

describe('migrate', () => {
  it('applies migrations once and is safe to run again', async () => {
    const db = await createTestDb(); // already migrated once
    const again = await migrate(db);
    expect(again).toEqual([]);
    const rows = await db.query<{ name: string }>('SELECT name FROM schema_migrations');
    expect(rows.rows.map((r) => r.name)).toEqual(['001_create_events']);
    await db.close();
  });
});

describe('EventRepository defensive paths', () => {
  it('throws if a conflicting event disappears before it can be read back', async () => {
    const db: Db = { query: jest.fn().mockResolvedValue({ rows: [] }), exec: jest.fn() };
    await expect(new EventRepository(db).insertReceived(makeEvent('evt_1'))).rejects.toThrow(/vanished/);
  });
});

describe('EventRepository.countByStatus', () => {
  it('counts events per status, with zeros for empty statuses', async () => {
    const db = await createTestDb();
    const repo = new EventRepository(db);
    expect(await repo.countByStatus()).toEqual({ received: 0, retrying: 0, forwarded: 0, failed: 0, total: 0 });

    for (const id of ['a', 'b', 'c', 'd']) await repo.insertReceived(makeEvent(id));
    await repo.transition('b', 'forwarded');
    await repo.transition('c', 'failed', 'boom');
    await repo.transition('d', 'failed', 'boom');
    expect(await repo.countByStatus()).toEqual({ received: 1, retrying: 0, forwarded: 1, failed: 2, total: 4 });
    await db.close();
  });
});
