import type Redis from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiterOptions {
  /** Maximum requests per key per window. */
  limit: number;
  windowSeconds: number;
  prefix?: string;
}

/**
 * Fixed-window rate limiter: INCR a per-key counter and give the key a TTL equal to the window.
 * INCR and TTL run in one MULTI. If a key somehow has no TTL (for example a crash between
 * INCR and EXPIRE), the next hit repairs it, so a counter can never live forever.
 *
 * A fixed window allows a burst of up to 2x the limit across a window boundary; a sliding
 * window or token bucket would avoid that at the cost of more Redis work.
 */
export class RateLimiter {
  private readonly prefix: string;

  constructor(
    private readonly redis: Redis,
    private readonly options: RateLimiterOptions,
  ) {
    this.prefix = options.prefix ?? 'ratelimit:';
  }

  async hit(key: string): Promise<RateLimitResult> {
    const redisKey = this.prefix + key;
    const replies = await this.redis.multi().incr(redisKey).ttl(redisKey).exec();
    if (!replies) {
      throw new Error('Redis MULTI was aborted');
    }
    const [[incrErr, count], [ttlErr, ttl]] = replies as [[Error | null, number], [Error | null, number]];
    if (incrErr) throw incrErr;
    if (ttlErr) throw ttlErr;

    let retryAfterSeconds = ttl;
    if (ttl < 0) {
      await this.redis.expire(redisKey, this.options.windowSeconds);
      retryAfterSeconds = this.options.windowSeconds;
    }

    const { limit } = this.options;
    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds,
    };
  }
}
