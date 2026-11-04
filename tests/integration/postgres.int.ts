import { migrate } from '../../src/db/migrations';
import { createPgDb, type PgDb } from '../../src/db/pool';
import { EventRepository } from '../../src/events/repository';
import type { BookingEvent } from '../../src/webhook/schema';

/**
 * Runs against a REAL PostgreSQL server (TEST_DATABASE_URL). It DROPS the `events` and
 * `schema_migrations` tables first, so point it at a throwaway database, never at real data.
 */
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error('Set TEST_DATABASE_URL to a throwaway Postgres database to run the integration tests.');
}

const makeEvent = (id: string): BookingEvent => ({
  id,
  type: 'booking.created',
  customer: { name: 'Asha Rao', email: 'asha@example.com', phone: '+919876543210' },
  service: 'Discovery call',
  startsAt: '2026-12-01T10:00:00Z',
});

describe('PostgreSQL (real server)', () => {
  let db: PgDb;
  let repo: EventRepository;

  beforeAll(async () => {
    db = createPgDb(url);
    await db.exec('DROP TABLE IF EXISTS events; DROP TABLE IF EXISTS schema_migrations;');
    await migrate(db);
    repo = new EventRepository(db);
  });

  beforeEach(async () => {
    await db.exec('TRUNCATE events');
  });

  afterAll(async () => {
    await db.close();
  });

  it('applies migrations once and records them', async () => {
    expect(await migrate(db)).toEqual([]);
    const rows = await db.query<{ name: string }>('SELECT name FROM schema_migrations');
    expect(rows.rows.map((r) => r.name)).toEqual(['001_create_events']);
  });

  it('stores and reads back an event, with a real timestamp and jsonb payload', async () => {
    const { created, record } = await repo.insertReceived(makeEvent('evt_1'));
    expect(created).toBe(true);
    expect(record.receivedAt).toBeInstanceOf(Date);
    expect(record.payload.customer.phone).toBe('+919876543210');
  });

  it('stores exactly one row when the same event arrives 25 times at once', async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => repo.insertReceived(makeEvent('evt_race'))));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect((await repo.list()).total).toBe(1);
  });

  it('counts every concurrent attempt and never loses an update', async () => {
    await repo.insertReceived(makeEvent('evt_1'));
    await Promise.all(Array.from({ length: 10 }, () => repo.transition('evt_1', 'retrying')));
    expect((await repo.getById('evt_1'))?.attempts).toBe(10);
  });

  it('blocks every transition out of forwarded, even concurrently', async () => {
    await repo.insertReceived(makeEvent('evt_1'));
    await repo.transition('evt_1', 'forwarded');
    const results = await Promise.all(Array.from({ length: 10 }, () => repo.transition('evt_1', 'retrying')));
    expect(results.every((r) => !r.ok)).toBe(true);
    expect((await repo.getById('evt_1'))?.status).toBe('forwarded');
  });

  it('filters, paginates and finds stuck events', async () => {
    for (const id of ['evt_1', 'evt_2', 'evt_3']) await repo.insertReceived(makeEvent(id));
    await repo.transition('evt_2', 'failed', 'boom');
    expect((await repo.list({ status: 'failed' })).total).toBe(1);
    expect((await repo.list({ limit: 2 })).items).toHaveLength(2);

    await db.exec(`UPDATE events SET updated_at = now() - interval '5 minutes' WHERE event_id = 'evt_1'`);
    expect(await repo.findStuck(60)).toEqual(['evt_1']);
  });

  it('rejects an invalid status at the database level', async () => {
    await repo.insertReceived(makeEvent('evt_1'));
    await expect(db.query("UPDATE events SET status = 'bogus' WHERE event_id = 'evt_1'")).rejects.toThrow();
  });
});
