# Booking Webhook Relay

A small service that receives signed booking webhooks, cleans the data, de-duplicates retries, and forwards each booking to a CRM, with a dashboard to inspect and replay failures.

It is a clean, public rebuild of an integration I built in production at Unfazed (booking system to Brevo CRM, including the fix for an HTTP 400 caused by invalid phone numbers).

> Built with AI assistance (Claude) for speed. I review, understand and test everything in it.

## Status

| Block | Work | State |
|---|---|---|
| 1 | Repo, Express + TypeScript, `/health`, Docker Compose (Postgres, Redis) | Scaffolded |
| 2 | Signature check, payload validation, E.164 normalisation, `POST /webhooks/bookings` | Done |
| 3 | Postgres schema, migrations, event storage, status flow, read API | Done |
| 4 | Redis idempotency and rate limiting; CRM forwarder with retry, backoff and recovery; replay endpoint | Done |
| 5 | Test suite review, coverage thresholds, integration tests on real Postgres/Redis, compose smoke test, CI | Done locally (153 unit tests, 98.8% coverage); CI not yet run on GitHub |
| 6 | React + TypeScript dashboard (event list, filters, detail, replay) | Done (38 dashboard tests) |
| 7 | Deploy on AWS (one EC2 host, Terraform, GitHub Actions with OIDC) | Written, not yet applied or tested on a real AWS account |
| 8 | README polish, architecture diagram, ADRs, demo GIF | TODO |

## How a webhook flows

```
POST /webhooks/bookings
  1. rate limit per client IP (Redis)            -> 429 + Retry-After when exceeded
  2. read raw body, verify HMAC signature        -> 401 / 415
  3. parse JSON, validate payload                -> 400 / 422
  4. Redis SET NX on the event id                -> duplicate: acknowledge with 202, stop
  5. INSERT into Postgres (event_id primary key) -> duplicate: acknowledge with 202, stop
  6. respond 202 immediately
  7. in the background: forward to the CRM with retries
        received -> retrying -> forwarded | failed
```

Redis is an optimisation, not the source of truth. If Redis is down, the rate limiter lets requests through (signatures still protect the endpoint) and idempotency falls back to the Postgres primary key.

## Quick start

```bash
npm install
npm test          # uses in-process Postgres (PGlite) and an in-memory Redis, so no Docker needed
```

The full stack needs Docker:

```bash
cp .env.example .env
docker compose up --build        # api + postgres + redis + mock CRM
```

To watch retries and the failed/replay flow, make the mock CRM unreliable:

```bash
MOCK_CRM_FAIL_RATE=0.5 docker compose up --build
```

Send a signed test webhook (same secret as the server) and inspect the result:

```bash
WEBHOOK_SECRET=change-me npm run webhook:test
WEBHOOK_SECRET=change-me npm run webhook:test -- http://localhost:3000 "12345"   # invalid phone: still accepted
curl -H "X-API-Key: change-me-too" "http://localhost:3000/events?status=failed"
curl -X POST -H "X-API-Key: change-me-too" http://localhost:3000/events/<eventId>/replay
```

## API

### `POST /webhooks/bookings`
Header `X-Webhook-Signature: sha256=<hex HMAC-SHA256 of the raw body>`.

| Status | Meaning |
|---|---|
| 202 | Accepted and stored. `duplicate: true` when this event id was already seen (nothing new is written or forwarded). |
| 400 | Signed body is not valid JSON |
| 401 | Missing or invalid signature |
| 415 | Content-Type is not `application/json` |
| 422 | Payload failed validation (details in the response) |
| 429 | Rate limit exceeded; see the `Retry-After` header |
| 500 | No `WEBHOOK_SECRET` configured (fails closed), or the database write failed (the sender should retry) |

### `GET /events`, `GET /events/stats`, `GET /events/:eventId`, `POST /events/:eventId/replay`
Require header `X-API-Key: <ADMIN_API_KEY>` (customer details are returned). With no key configured they answer 500 rather than serving data openly.

- `GET /events/stats` returns the number of events in each status and the total.
- `GET /events` accepts `status` (`received|retrying|forwarded|failed`), `limit` (1-200, default 50) and `offset`.
- `POST /events/:eventId/replay` re-queues an event that is `failed` (202). It returns 409 for any other status, 404 if unknown, 503 if CRM forwarding is not configured.

## Dashboard

A React 18 + TypeScript single-page app in `dashboard/` (Vite, TanStack Table, Zustand). The API serves the built app at **`/dashboard/`**, so it shares the API's origin and needs no CORS configuration.

- **Status filters with live counts** (All, Received, Retrying, Forwarded, Failed), server-side pagination (25 per page), and auto-refresh every 10 s (switch off if you like).
- **Event details** in an accessible dialog (focus moves in, Tab stays inside, Escape closes, focus returns to the row you opened it from): delivery history, attempts, last error, the booking, and the stored payload.
- **Replay** button for failed events. The list and detail reload afterwards, and the server's own error message is shown if a replay is refused.
- **Customer privacy:** the list shows masked addresses (`a***@example.com`); full details appear only in the detail dialog.
- **Sign-in is the admin API key.** It is held in memory only (never in localStorage, sessionStorage or the URL), so a refresh signs you out. A rejected key sends you back to the form with an explanation.
- **Strict Content-Security-Policy** on `/dashboard` (`default-src 'self'`, no inline scripts or styles, no framing), plus `nosniff` and `no-referrer`. Status is shown with a symbol and a label as well as colour, and the layout works down to phone width and in dark mode.

Run it:

```bash
# built into the Docker image, so this just works:
docker compose up --build            # then open http://localhost:3000/dashboard/

# or develop it with hot reload against a running API:
cd dashboard && npm ci && npm run dev    # http://localhost:5173/dashboard/ (proxies API calls to :3000)

# or build it so the API serves it locally:
cd dashboard && npm ci && npm run build  # then start the API as usual
```

Dashboard checks (from `dashboard/`): `npm run lint`, `npm run typecheck`, `npm test` (Vitest + Testing Library against a fake API), `npm run build`.

## Deploying to AWS

One small EC2 instance runs the whole stack with Docker Compose behind Caddy (automatic HTTPS). Terraform (`infra/`) creates the ECR repository, security group, IAM roles, instance, Elastic IP, log group, settings and a cost budget. The **Deploy** workflow (`.github/workflows/deploy.yml`) runs after CI passes on `main`: it builds the image, pushes it to ECR tagged with the commit SHA, deploys it through SSM Run Command, smoke-tests the public URL, and rolls back to the previous image if that fails.

- **No long-lived AWS keys.** GitHub proves its identity with OIDC, and the IAM role only trusts this repository's `production` environment, with permission to push to one ECR repository and run one command on one instance.
- **No SSH.** Only ports 80 and 443 are open; shell access is SSM Session Manager. IMDSv2 only, encrypted disk, automatic OS updates.
- **Secrets** are random values in SSM Parameter Store, created by `infra/set-secrets.sh`, never in the repo, image, Terraform state or logs.
- **Cost:** roughly $10-20 a month while running (check current AWS pricing), with an AWS Budget alert and a one-command teardown.

Step-by-step instructions, security notes, known limits and teardown are in [`infra/README.md`](infra/README.md). The "CRM" in the deployed stack is the mock container; this is a demo, not a production system.

## Event lifecycle

```
received --> retrying --> forwarded
    |           |  ^
    |           v  |
    +-------> failed      (failed --> retrying is a manual replay)
```

`forwarded` is terminal. Moving to `retrying` counts an attempt; moving to `forwarded` clears the last error and stamps `forwarded_at`. The allowed "from" states are enforced inside the `UPDATE` statement, and a CHECK constraint stops any invalid status being stored.

## Retries

- Each forward attempt is recorded (`attempts`, `last_error`), so the database always shows what happened.
- Transient failures (network error, timeout, 408, 425, 429, 5xx) are retried up to `FORWARD_MAX_ATTEMPTS` (default 5) with exponential backoff and full jitter, capped at 30 s.
- Permanent failures (other 4xx, such as a rejected API key) fail immediately. HTTP 409 from the CRM counts as success.
- The event id is sent as an `Idempotency-Key` header so a CRM that supports it can de-duplicate retries.
- Forwarding runs in-process. If the server crashes or is redeployed mid-flight, a recovery sweep (at startup and every 30 s) picks up events stuck in `received` or `retrying` for over 60 s. Postgres acts as the queue. At higher volume the next step would be a real queue (for example SQS) and separate workers.

## Testing

| Layer | Command | What it runs against |
|---|---|---|
| Unit and API tests | `npm test` | PGlite (Postgres compiled to WebAssembly) and `ioredis-mock`; no Docker needed |
| Coverage | `npm run test:coverage` | Same, and fails if coverage drops below 95% statements / 90% branches |
| Integration | `npm run test:integration` | A real Postgres and Redis (`TEST_DATABASE_URL`, `TEST_REDIS_URL`). It drops the `events` tables, so use a throwaway database. |
| Smoke | `docker compose up -d --build && npm run smoke` | The whole stack: signed webhook, duplicate, bad signature, auth, forwarded to the mock CRM |

What the suites check beyond the happy path: 25 concurrent copies of one event store one row; 50 concurrent Redis claims give one winner; counters and rate-limit windows really expire; concurrent transitions out of `forwarded` all fail; the service keeps working when Redis is down; retries use backoff and stop at the limit; permanent CRM errors fail immediately; secrets and customer details never appear in error messages.

Coverage excludes only the two process entry points (`src/server.ts`, `src/mockCrm/server.ts`), which the smoke test exercises. Files no test imports are still counted, so the number is not flattering.

## CI (GitHub Actions)

Five jobs run on every push and pull request: **test** (lint, typecheck, unit tests with coverage thresholds, build), **dashboard** (lint, typecheck, tests, build), **infra** (`terraform validate`), **integration** (real Postgres 16 and Redis 7 as service containers), and **smoke** (builds the Docker image, starts the compose stack and runs `scripts/smoke.sh`, which also checks the dashboard is served with its security headers). Coverage is uploaded as an artifact, and compose logs are printed if the smoke test fails. A separate **Deploy** workflow handles AWS (see above).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run the API with auto-reload (tsx). Needs `DATABASE_URL`. |
| `npm run build` / `npm start` | Compile to `dist/` and run it |
| `npm test` | Unit tests (uses `--experimental-vm-modules` because PGlite loads WebAssembly) |
| `npm run test:coverage` | Unit tests with coverage thresholds |
| `npm run test:integration` | Integration tests against real Postgres and Redis |
| `npm run smoke` | End-to-end smoke test against a running compose stack |
| `cd dashboard && npm run dev` | Dashboard with hot reload (see the Dashboard section) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |
| `npm run webhook:test` | Send a signed test webhook |

## Project layout

```
src/
  app.ts               Express app factory (routes, rate limit middleware)
  server.ts            Wires Postgres, Redis, CRM client, forwarder, recovery loop
  config.ts            Environment configuration
  auth.ts              API-key middleware for the read/replay endpoints
  db/                  Database interface, node-postgres pool, SQL migrations + runner
  events/              Lifecycle rules (status.ts) and the repository (insert, get, list, transition, findStuck)
  webhook/             HMAC signature, E.164 phone normalisation, payload schema (zod)
  redis/               ioredis client, idempotency store (SET NX EX), fixed-window rate limiter
  crm/                 CRM client interface and HTTP implementation (retryable vs permanent errors)
  forwarding/          Forwarder (retry + backoff) and crash recovery
  mockCrm/             A stand-in CRM with failure injection, for development and tests
dashboard/             React + TypeScript dashboard (its own package.json, tests and build)
  src/api/             Typed API client with readable error messages
  src/components/      KeyGate, StatusTabs, EventsTable (TanStack Table), EventDrawer, StatusBadge
  src/hooks/useEvents  Loading, polling and stale-response protection
  src/store.ts         Zustand store (API key in memory only)
infra/                 Terraform for the AWS host, plus set-secrets.sh and first-boot script
deploy/                Production compose file, Caddyfile, and the scripts that run on the instance
tests/                 Jest + Supertest; helpers run migrations on PGlite and use an in-memory Redis
tests/integration/     Tests for real Postgres and Redis (*.int.ts, run by npm run test:integration)
scripts/               send-test-webhook.ts and smoke.sh
docs/adr/              Architecture decision records
```

## Notes

- The signature is computed over the exact bytes received, so the route reads the raw body (`express.raw`) and parses JSON only after verification.
- Signature and API-key comparisons use `crypto.timingSafeEqual`.
- An unusable phone number is dropped rather than rejected, because rejecting it was the cause of the original Brevo HTTP 400 failure.
- The rate limiter is a fixed window (simple, cheap) and can allow a burst of up to 2x the limit across a window boundary. Behind a load balancer set `TRUST_PROXY` so the limit applies to the real client address; with it unset, `X-Forwarded-For` is ignored so it cannot be spoofed.
- Tests run the repository's real SQL against PGlite (Postgres compiled to WebAssembly) and the Redis code against `ioredis-mock`. The production connections (`pg`, real Redis) are exercised by `docker compose up`.
- The dashboard bundle never contains the API key: the key is typed in by the operator at run time. Putting it in a `VITE_` variable would ship it to every visitor.
- TODO (yours): ADRs in `docs/adr/` for HMAC signatures (0001), PostgreSQL and `event_id` as primary key (0002), Redis for idempotency and rate limiting (0003), retry with backoff and jitter (0004).

## Environment

See `.env.example`. Never commit `.env` or real keys.
