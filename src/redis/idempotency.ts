import type Redis from 'ioredis';

/**
 * Fast duplicate detection in front of Postgres.
 *
 * claim(id) does SET key NX EX ttl, which is atomic: of any number of concurrent deliveries
 * of the same event id, exactly one gets true. Postgres (event_id primary key) remains the
 * source of truth, so if Redis loses a key or is down the worst case is one extra DB check.
 */
export class IdempotencyStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds = 24 * 60 * 60,
    private readonly prefix = 'idem:booking:',
  ) {}

  /** True if this is the first time the id has been seen within the TTL. */
  async claim(eventId: string): Promise<boolean> {
    const result = await this.redis.set(this.prefix + eventId, '1', 'EX', this.ttlSeconds, 'NX');
    return result === 'OK';
  }

  /** Give the claim back (used when storing the event failed, so a retry is not mistaken for a duplicate). */
  async release(eventId: string): Promise<void> {
    await this.redis.del(this.prefix + eventId);
  }
}
