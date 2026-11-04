import crypto from 'node:crypto';
import type Redis from 'ioredis';
import request from 'supertest';
import { createApp, SIGNATURE_HEADER } from '../src/app';
import { API_KEY_HEADER } from '../src/auth';
import type { Db } from '../src/db/db';
import { EventRepository } from '../src/events/repository';
import { IdempotencyStore } from '../src/redis/idempotency';
import { RateLimiter } from '../src/redis/rateLimiter';
import { createTestDb } from './helpers/testDb';
import { createTestRedis } from './helpers/testRedis';

const secret = 'test-secret';
const apiKey = 'admin-key';
const sign = (body: string) => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

const event = (id: string) => ({
  id,
  type: 'booking.created',
  customer: { name: 'Asha Rao', email: 'asha@example.com', phone: '+91 98765 43210' },
  service: 'Discovery call',
  startsAt: '2026-12-01T10:00:00Z',
});

describe('webhook flow with Redis, rate limiting and dispatch', () => {
  let db: Db & { close(): Promise<void> };
  let redis: Redis;
  let repo: EventRepository;
  let dispatch: jest.Mock;
  let app: ReturnType<typeof createApp>;

  const build = (limit = 100, trustProxy = 0, withDispatch = true) =>
    createApp({
      webhookSecret: secret,
      adminApiKey: apiKey,
      events: repo,
      idempotency: new IdempotencyStore(redis, 60),
      rateLimiter: new RateLimiter(redis, { limit, windowSeconds: 60 }),
      dispatch: withDispatch ? dispatch : undefined,
      trustProxy,
    });

  const send = (payload: object, headers: Record<string, string> = {}, target = app) => {
    const body = JSON.stringify(payload);
    return request(target)
      .post('/webhooks/bookings')
      .set('Content-Type', 'application/json')
      .set(SIGNATURE_HEADER, sign(body))
      .set(headers)
      .send(body);
  };

  beforeEach(async () => {
    db = await createTestDb();
    redis = await createTestRedis();
    repo = new EventRepository(db);
    dispatch = jest.fn();
    app = build();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await redis.flushall();
    await db.close();
  });

  describe('idempotency', () => {
    it('dispatches a new event once and treats a repeat as a duplicate without touching Postgres', async () => {
      const first = await send(event('evt_1'));
      expect(first.body).toEqual({ status: 'accepted', eventId: 'evt_1', duplicate: false });

      const insertSpy = jest.spyOn(repo, 'insertReceived');
      const second = await send(event('evt_1'));
      expect(second.status).toBe(202);
      expect(second.body.duplicate).toBe(true);
      expect(insertSpy).not.toHaveBeenCalled(); // caught by Redis
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect((await repo.list()).total).toBe(1);
    });

    it('releases the claim when storing fails, so the sender can retry', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      await db.exec('ALTER TABLE events RENAME TO events_broken');
      const failed = await send(event('evt_1'));
      expect(failed.status).toBe(500);
      expect(await redis.exists('idem:booking:evt_1')).toBe(0);

      await db.exec('ALTER TABLE events_broken RENAME TO events');
      const retry = await send(event('evt_1'));
      expect(retry.status).toBe(202);
      expect(retry.body.duplicate).toBe(false);
      expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it('falls back to Postgres when Redis is down and still prevents duplicates', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(redis, 'set').mockRejectedValue(new Error('Redis is down'));

      const first = await send(event('evt_1'));
      expect(first.body.duplicate).toBe(false);
      const second = await send(event('evt_1'));
      expect(second.status).toBe(202);
      expect(second.body.duplicate).toBe(true);
      expect((await repo.list()).total).toBe(1);
      expect(dispatch).toHaveBeenCalledTimes(1);
    });
  });

  describe('rate limiting', () => {
    it('returns 429 with Retry-After once the limit is exceeded', async () => {
      app = build(3);
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        const res = await send(event(`evt_${i}`));
        statuses.push(res.status);
        if (res.status === 429) {
          expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
          expect(res.body.error).toBe('rate_limited');
        }
      }
      expect(statuses).toEqual([202, 202, 202, 429]);
      expect((await repo.list()).total).toBe(3);
    });

    it('reports the limit in response headers', async () => {
      app = build(5);
      const res = await send(event('evt_1'));
      expect(res.headers['ratelimit-limit']).toBe('5');
      expect(res.headers['ratelimit-remaining']).toBe('4');
    });

    it('limits per client address, using X-Forwarded-For only when a proxy is trusted', async () => {
      app = build(1, 1);
      const a1 = await send(event('evt_1'), { 'X-Forwarded-For': '10.0.0.1' });
      const b1 = await send(event('evt_2'), { 'X-Forwarded-For': '10.0.0.2' });
      const a2 = await send(event('evt_3'), { 'X-Forwarded-For': '10.0.0.1' });
      expect([a1.status, b1.status, a2.status]).toEqual([202, 202, 429]);

      // Without a trusted proxy, a spoofed header must not give a client a fresh allowance.
      await redis.flushall();
      app = build(1, 0);
      const s1 = await send(event('evt_4'), { 'X-Forwarded-For': '10.0.0.1' });
      const s2 = await send(event('evt_5'), { 'X-Forwarded-For': '10.0.0.2' });
      expect([s1.status, s2.status]).toEqual([202, 429]);
    });

    it('lets requests through when the rate limiter cannot reach Redis (fail open)', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(redis, 'multi').mockImplementation(() => {
        throw new Error('Redis is down');
      });
      const res = await send(event('evt_1'));
      expect(res.status).toBe(202);
    });

    it('does not rate limit bad signatures differently: they still get 401 within the limit', async () => {
      const res = await request(app).post('/webhooks/bookings').set('Content-Type', 'application/json').send('{}');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /events/:eventId/replay', () => {
    const replay = (id: string, key: string | null = apiKey, target = app) => {
      const req = request(target).post(`/events/${id}/replay`);
      return key ? req.set(API_KEY_HEADER, key) : req;
    };

    it('schedules a replay for a failed event', async () => {
      await send(event('evt_1'));
      await repo.transition('evt_1', 'failed', 'boom');
      dispatch.mockClear();

      const res = await replay('evt_1');
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ status: 'replay_scheduled', eventId: 'evt_1' });
      expect(dispatch).toHaveBeenCalledWith('evt_1');
    });

    it('refuses to replay an event that has not failed', async () => {
      await send(event('evt_1'));
      const res = await replay('evt_1');
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'not_replayable', current: 'received' });
    });

    it('returns 404 for an unknown event and 401 without the API key', async () => {
      expect((await replay('nope')).status).toBe(404);
      expect((await replay('evt_1', null)).status).toBe(401);
    });

    it('returns 503 when forwarding is not configured', async () => {
      const noForwarding = build(100, 0, false);
      await send(event('evt_1'), {}, noForwarding);
      await repo.transition('evt_1', 'failed', 'boom');
      expect((await replay('evt_1', apiKey, noForwarding)).status).toBe(503);
    });
  });
});
