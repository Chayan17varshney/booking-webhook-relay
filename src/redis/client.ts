import Redis from 'ioredis';

/**
 * Create a Redis client that fails fast when Redis is down (no offline queue, one retry
 * per command), because callers treat Redis as an optimisation and fall back to Postgres.
 */
export function createRedis(url: string): Redis {
  const redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
  });
  redis.on('error', (err) => {
    console.error('Redis error:', err.message);
  });
  return redis;
}
