import type Redis from 'ioredis';
import { IdempotencyStore } from '../src/redis/idempotency';
import { createTestRedis } from './helpers/testRedis';

describe('IdempotencyStore', () => {
  let redis: Redis;
  let store: IdempotencyStore;

  beforeEach(async () => {
    redis = await createTestRedis();
    store = new IdempotencyStore(redis, 60);
  });

  afterEach(async () => {
    await redis.flushall();
  });

  it('lets the first claim win and rejects repeats', async () => {
    expect(await store.claim('evt_1')).toBe(true);
    expect(await store.claim('evt_1')).toBe(false);
    expect(await store.claim('evt_1')).toBe(false);
  });

  it('keeps different event ids independent', async () => {
    expect(await store.claim('evt_1')).toBe(true);
    expect(await store.claim('evt_2')).toBe(true);
  });

  it('gives exactly one winner among concurrent claims', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => store.claim('evt_race')));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('sets an expiry so keys cannot live forever', async () => {
    await store.claim('evt_1');
    const ttl = await redis.ttl('idem:booking:evt_1');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it('allows a new claim after release', async () => {
    await store.claim('evt_1');
    await store.release('evt_1');
    expect(await store.claim('evt_1')).toBe(true);
  });
});

describe('IdempotencyStore defaults', () => {
  it('uses a 24 hour expiry and the standard key prefix when none are given', async () => {
    const redis = await createTestRedis();
    await new IdempotencyStore(redis).claim('evt_default');
    const ttl = await redis.ttl('idem:booking:evt_default');
    expect(ttl).toBeGreaterThan(24 * 60 * 60 - 5);
    expect(ttl).toBeLessThanOrEqual(24 * 60 * 60);
  });
});
