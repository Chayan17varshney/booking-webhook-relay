import type Redis from 'ioredis';
import { createRedis } from '../../src/redis/client';
import { IdempotencyStore } from '../../src/redis/idempotency';
import { RateLimiter } from '../../src/redis/rateLimiter';

/** Runs against a REAL Redis server (TEST_REDIS_URL). It flushes the selected database. */
const url = process.env.TEST_REDIS_URL;
if (!url) {
  throw new Error('Set TEST_REDIS_URL to a throwaway Redis to run the integration tests.');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Redis (real server)', () => {
  let redis: Redis;

  beforeAll(async () => {
    redis = createRedis(url);
    // The client has no offline queue, so wait until the connection is ready before any command.
    if (redis.status !== 'ready') {
      await new Promise<void>((resolve, reject) => {
        redis.once('ready', () => resolve());
        redis.once('end', () => reject(new Error('Redis connection ended before it was ready')));
      });
    }
  });

  beforeEach(async () => {
    await redis.flushdb();
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('gives exactly one winner among 50 concurrent claims of the same event', async () => {
    const store = new IdempotencyStore(redis, 60);
    const results = await Promise.all(Array.from({ length: 50 }, () => store.claim('evt_race')));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('expires idempotency keys', async () => {
    const store = new IdempotencyStore(redis, 1);
    expect(await store.claim('evt_1')).toBe(true);
    await sleep(1500);
    expect(await store.claim('evt_1')).toBe(true);
  });

  it('counts requests per client and blocks beyond the limit', async () => {
    const limiter = new RateLimiter(redis, { limit: 3, windowSeconds: 60 });
    const results = [];
    for (let i = 0; i < 5; i++) results.push((await limiter.hit('1.2.3.4')).allowed);
    expect(results).toEqual([true, true, true, false, false]);
    expect((await limiter.hit('5.6.7.8')).allowed).toBe(true);
  });

  it('starts a new window after the real TTL expires', async () => {
    const limiter = new RateLimiter(redis, { limit: 1, windowSeconds: 1 });
    expect((await limiter.hit('1.2.3.4')).allowed).toBe(true);
    expect((await limiter.hit('1.2.3.4')).allowed).toBe(false);
    await sleep(1500);
    expect((await limiter.hit('1.2.3.4')).allowed).toBe(true);
  });

  it('gives every counter a TTL', async () => {
    await new RateLimiter(redis, { limit: 3, windowSeconds: 30 }).hit('1.2.3.4');
    const ttl = await redis.ttl('ratelimit:1.2.3.4');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);
  });
});
