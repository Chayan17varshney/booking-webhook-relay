import { createRedis } from '../src/redis/client';

describe('createRedis (no server running)', () => {
  it('fails fast instead of queueing commands while Redis is unreachable', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    const redis = createRedis('redis://127.0.0.1:1'); // closed port

    const started = Date.now();
    await expect(redis.set('key', 'value')).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5000); // no waiting for a reconnect that never comes

    redis.disconnect();
    errorLog.mockRestore();
  });
});
