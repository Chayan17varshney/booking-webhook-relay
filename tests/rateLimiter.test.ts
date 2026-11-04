import type Redis from 'ioredis';
import { RateLimiter } from '../src/redis/rateLimiter';
import { createTestRedis } from './helpers/testRedis';

describe('RateLimiter', () => {
  let redis: Redis;
  let limiter: RateLimiter;

  beforeEach(async () => {
    redis = await createTestRedis();
    limiter = new RateLimiter(redis, { limit: 3, windowSeconds: 60 });
  });

  afterEach(async () => {
    await redis.flushall();
  });

  it('allows requests up to the limit and reports what is left', async () => {
    const first = await limiter.hit('1.2.3.4');
    const second = await limiter.hit('1.2.3.4');
    const third = await limiter.hit('1.2.3.4');
    expect([first.allowed, second.allowed, third.allowed]).toEqual([true, true, true]);
    expect([first.remaining, second.remaining, third.remaining]).toEqual([2, 1, 0]);
  });

  it('blocks once the limit is exceeded and says when to retry', async () => {
    for (let i = 0; i < 3; i++) await limiter.hit('1.2.3.4');
    const blocked = await limiter.hit('1.2.3.4');
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('counts each client separately', async () => {
    for (let i = 0; i < 4; i++) await limiter.hit('1.2.3.4');
    expect((await limiter.hit('5.6.7.8')).allowed).toBe(true);
  });

  it('starts a fresh window once the key has expired', async () => {
    for (let i = 0; i < 4; i++) await limiter.hit('1.2.3.4');
    await redis.del('ratelimit:1.2.3.4'); // what Redis does when the TTL runs out
    const result = await limiter.hit('1.2.3.4');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it('repairs a counter that somehow has no expiry', async () => {
    await redis.set('ratelimit:1.2.3.4', '1'); // INCR happened but EXPIRE never did
    expect(await redis.ttl('ratelimit:1.2.3.4')).toBe(-1);
    await limiter.hit('1.2.3.4');
    expect(await redis.ttl('ratelimit:1.2.3.4')).toBeGreaterThan(0);
  });
});

describe('RateLimiter error handling', () => {
  let redis: Redis;

  beforeEach(async () => {
    redis = await createTestRedis();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const stubExec = (result: unknown) =>
    jest.spyOn(redis, 'multi').mockReturnValue({
      incr() {
        return this;
      },
      ttl() {
        return this;
      },
      exec: async () => result,
    } as never);

  it('throws if the MULTI transaction was aborted', async () => {
    stubExec(null);
    await expect(new RateLimiter(redis, { limit: 3, windowSeconds: 60 }).hit('a')).rejects.toThrow(/aborted/);
  });

  it('throws if INCR or TTL reports an error', async () => {
    stubExec([[new Error('incr failed'), null], [null, 1]]);
    await expect(new RateLimiter(redis, { limit: 3, windowSeconds: 60 }).hit('a')).rejects.toThrow('incr failed');
    stubExec([[null, 1], [new Error('ttl failed'), null]]);
    await expect(new RateLimiter(redis, { limit: 3, windowSeconds: 60 }).hit('a')).rejects.toThrow('ttl failed');
  });

  it('honours a custom key prefix', async () => {
    const limiter = new RateLimiter(redis, { limit: 3, windowSeconds: 60, prefix: 'custom:' });
    await limiter.hit('a');
    expect(await redis.exists('custom:a')).toBe(1);
  });
});
