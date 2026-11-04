import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app';
import { config } from './config';
import { HttpCrmClient } from './crm/crmClient';
import { migrate } from './db/migrations';
import { createPgDb } from './db/pool';
import { EventRepository } from './events/repository';
import { Forwarder } from './forwarding/forwarder';
import { recoverPending } from './forwarding/recovery';
import { createRedis } from './redis/client';
import { IdempotencyStore } from './redis/idempotency';
import { RateLimiter } from './redis/rateLimiter';

const RECOVERY_INTERVAL_MS = 30_000;

async function main() {
  if (!config.databaseUrl) {
    console.error('DATABASE_URL is not set. Start Postgres (docker compose up postgres) and copy .env.example to .env.');
    process.exit(1);
  }

  const db = createPgDb(config.databaseUrl);
  const applied = await migrate(db);
  if (applied.length > 0) {
    console.log(`Applied migrations: ${applied.join(', ')}`);
  }
  const events = new EventRepository(db);

  // Redis is optional: without it, duplicates are still stopped by Postgres and there is no rate limit.
  const redis = config.redisUrl ? createRedis(config.redisUrl) : undefined;
  if (!redis) {
    console.warn('REDIS_URL is not set: running without Redis idempotency and rate limiting.');
  }

  // CRM forwarding is optional too: without it events are stored but not forwarded.
  let forwarder: Forwarder | undefined;
  if (config.crmBaseUrl) {
    const crm = new HttpCrmClient({ baseUrl: config.crmBaseUrl, apiKey: config.crmApiKey });
    forwarder = new Forwarder(events, crm, { maxAttempts: config.forwardMaxAttempts });
  } else {
    console.warn('CRM_BASE_URL is not set: events will be stored but not forwarded.');
  }

  const dispatch = forwarder
    ? (eventId: string) => {
        // Background work: the webhook has already been acknowledged. Only ids and outcomes are logged.
        forwarder
          .forward(eventId)
          .then((result) => console.log(`forward ${eventId}: ${result.outcome} after ${result.attempts} attempt(s)`))
          .catch((err) => console.error(`forward ${eventId} crashed:`, err instanceof Error ? err.message : err));
      }
    : undefined;

  // Serve the built dashboard if it exists (the Docker image includes it; locally run `npm run build` in dashboard/).
  const dashboardDir = path.resolve(__dirname, '..', 'dashboard', 'dist');
  const hasDashboard = fs.existsSync(path.join(dashboardDir, 'index.html'));
  if (!hasDashboard) {
    console.warn('Dashboard build not found: serving the API only.');
  }

  const app = createApp({
    events,
    dispatch,
    dashboardDir: hasDashboard ? dashboardDir : undefined,
    idempotency: redis ? new IdempotencyStore(redis, config.idempotencyTtlSeconds) : undefined,
    rateLimiter: redis
      ? new RateLimiter(redis, { limit: config.rateLimitMax, windowSeconds: config.rateLimitWindowSeconds })
      : undefined,
  });

  const server = app.listen(config.port, () => {
    console.log(`booking-webhook-relay listening on port ${config.port}`);
  });

  let recoveryTimer: NodeJS.Timeout | undefined;
  if (forwarder) {
    const recover = () =>
      recoverPending(events, forwarder)
        .then((n) => n > 0 && console.log(`recovered ${n} pending event(s)`))
        .catch((err) => console.error('recovery failed:', err instanceof Error ? err.message : err));
    void recover();
    recoveryTimer = setInterval(recover, RECOVERY_INTERVAL_MS);
    recoveryTimer.unref();
  }

  const shutdown = () => {
    if (recoveryTimer) clearInterval(recoveryTimer);
    server.close(() => {
      void Promise.all([db.close(), redis?.quit()]).then(() => process.exit(0));
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Failed to start', err);
  process.exit(1);
});
