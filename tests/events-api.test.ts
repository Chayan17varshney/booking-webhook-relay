import crypto from 'node:crypto';
import request from 'supertest';
import { createApp, SIGNATURE_HEADER } from '../src/app';
import { API_KEY_HEADER } from '../src/auth';
import type { Db } from '../src/db/db';
import { EventRepository } from '../src/events/repository';
import { createTestDb } from './helpers/testDb';

const secret = 'test-secret';
const apiKey = 'admin-key';
const sign = (body: string) => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

const event = (id: string, phone = '+91 98765 43210') => ({
  id,
  type: 'booking.created',
  customer: { name: 'Asha Rao', email: 'asha@example.com', phone },
  service: 'Discovery call',
  startsAt: '2026-12-01T10:00:00Z',
});

describe('stored events API', () => {
  let db: Db & { close(): Promise<void> };
  let repo: EventRepository;
  let app: ReturnType<typeof createApp>;

  const send = (payload: object) => {
    const body = JSON.stringify(payload);
    return request(app)
      .post('/webhooks/bookings')
      .set('Content-Type', 'application/json')
      .set(SIGNATURE_HEADER, sign(body))
      .send(body);
  };

  beforeEach(async () => {
    db = await createTestDb();
    repo = new EventRepository(db);
    app = createApp({ webhookSecret: secret, adminApiKey: apiKey, events: repo });
  });

  afterEach(async () => {
    await db.close();
  });

  it('stores a valid webhook with the normalised phone', async () => {
    const res = await send(event('evt_1'));
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'accepted', eventId: 'evt_1', duplicate: false });
    const stored = await repo.getById('evt_1');
    expect(stored?.status).toBe('received');
    expect(stored?.payload.customer.phone).toBe('+919876543210');
  });

  it('stores an event with an invalid phone, without the phone', async () => {
    await send(event('evt_1', '12345'));
    const stored = await repo.getById('evt_1');
    expect(stored).not.toBeNull();
    expect(stored?.payload.customer.phone).toBeUndefined();
  });

  it('acknowledges a duplicate delivery without storing a second copy', async () => {
    await send(event('evt_1'));
    const again = await send(event('evt_1'));
    expect(again.status).toBe(202);
    expect(again.body.duplicate).toBe(true);
    expect((await repo.list()).total).toBe(1);
  });

  it('does not store events that fail validation', async () => {
    const res = await send({ ...event('evt_1'), type: 'booking.deleted' });
    expect(res.status).toBe(422);
    expect((await repo.list()).total).toBe(0);
  });

  it('returns 500 storage_error when the database fails, so the sender retries', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await db.exec('DROP TABLE events');
    const res = await send(event('evt_1'));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('storage_error');
    spy.mockRestore();
  });

  describe('GET /events', () => {
    it('requires the API key', async () => {
      expect((await request(app).get('/events')).status).toBe(401);
      expect((await request(app).get('/events').set(API_KEY_HEADER, 'wrong')).status).toBe(401);
    });

    it('fails closed with 500 when no admin key is configured', async () => {
      const open = createApp({ webhookSecret: secret, adminApiKey: '', events: repo });
      const res = await request(open).get('/events').set(API_KEY_HEADER, '');
      expect(res.status).toBe(500);
    });

    it('lists events and filters by status', async () => {
      await send(event('evt_1'));
      await send(event('evt_2'));
      await repo.transition('evt_2', 'failed', 'boom');

      const all = await request(app).get('/events').set(API_KEY_HEADER, apiKey);
      expect(all.status).toBe(200);
      expect(all.body.total).toBe(2);

      const failed = await request(app).get('/events?status=failed').set(API_KEY_HEADER, apiKey);
      expect(failed.body.total).toBe(1);
      expect(failed.body.items[0].eventId).toBe('evt_2');
      expect(failed.body.items[0].lastError).toBe('boom');
    });

    it('validates the query parameters', async () => {
      const badStatus = await request(app).get('/events?status=nope').set(API_KEY_HEADER, apiKey);
      expect(badStatus.status).toBe(400);
      const badLimit = await request(app).get('/events?limit=0').set(API_KEY_HEADER, apiKey);
      expect(badLimit.status).toBe(400);
      const hugeLimit = await request(app).get('/events?limit=500').set(API_KEY_HEADER, apiKey);
      expect(hugeLimit.status).toBe(400);
    });
  });

  describe('GET /events/:eventId', () => {
    it('returns one event, or 404', async () => {
      await send(event('evt_1'));
      const found = await request(app).get('/events/evt_1').set(API_KEY_HEADER, apiKey);
      expect(found.status).toBe(200);
      expect(found.body.eventId).toBe('evt_1');

      const missing = await request(app).get('/events/nope').set(API_KEY_HEADER, apiKey);
      expect(missing.status).toBe(404);
    });

    it('requires the API key', async () => {
      await send(event('evt_1'));
      expect((await request(app).get('/events/evt_1')).status).toBe(401);
    });
  });
});

describe('GET /events pagination validation', () => {
  it.each(['limit=abc', 'limit=1.5', 'limit=-1', 'offset=-1', 'offset=abc'])('rejects %s with 400', async (query) => {
    const db = await createTestDb();
    const app = createApp({ webhookSecret: secret, adminApiKey: apiKey, events: new EventRepository(db) });
    const res = await request(app).get(`/events?${query}`).set(API_KEY_HEADER, apiKey);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_pagination');
    await db.close();
  });

  it('applies limit and offset', async () => {
    const db = await createTestDb();
    const repo = new EventRepository(db);
    const app = createApp({ webhookSecret: secret, adminApiKey: apiKey, events: repo });
    for (const id of ['evt_1', 'evt_2', 'evt_3']) {
      await repo.insertReceived({
        id,
        type: 'booking.created',
        customer: { name: 'Asha Rao', email: 'asha@example.com' },
        service: 'Discovery call',
        startsAt: '2026-12-01T10:00:00Z',
      });
    }
    const res = await request(app).get('/events?limit=2&offset=2').set(API_KEY_HEADER, apiKey);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(3);
    expect(res.body.limit).toBe(2);
    expect(res.body.offset).toBe(2);
    await db.close();
  });
});
