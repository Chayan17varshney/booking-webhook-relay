import type Redis from 'ioredis';
import RedisMock from 'ioredis-mock';

let shared: Redis | undefined;

/**
 * An in-memory Redis with the same commands as ioredis. One instance is reused within a test
 * file (creating many adds process listeners), and it is flushed so each test starts clean.
 * Tests that stub a method with jest.spyOn must call jest.restoreAllMocks() afterwards.
 */
export async function createTestRedis(): Promise<Redis> {
  shared ??= new RedisMock() as unknown as Redis;
  await shared.flushall();
  return shared;
}
