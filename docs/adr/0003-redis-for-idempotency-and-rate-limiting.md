# 0003. Redis for idempotency keys and rate limiting

Date: 2026-11-04
Status: Accepted

## Context
Booking systems retry webhooks, so the same event arrives more than once, sometimes at nearly the same moment. The relay should acknowledge repeats cheaply and must not forward an event twice. It also needs to slow down a client that floods the endpoint.

Both jobs need a small piece of shared state that expires on its own.

## Decision
Use Redis for both, and keep Postgres as the source of truth.

**Idempotency.** `claim(eventId)` runs `SET key 1 NX EX ttl`. That is one atomic command, so out of any number of concurrent deliveries of the same id exactly one gets `true`. The default TTL is 24 hours. The test suite sends 50 concurrent claims for one id and expects one winner. If storing the event fails, the claim is released, so the sender's retry is not mistaken for a duplicate. Repeats get a 202 with `duplicate: true`, so the sender stops retrying.

**Rate limiting.** A fixed-window counter per client IP: `INCR` and `TTL` in one `MULTI`. When a key has no TTL, for example after a crash between the two steps, the next hit sets it, so a counter cannot live forever. Over the limit returns 429 with the seconds until the window ends.

**Failure mode.** The Redis client has no offline queue and one retry per command, so it fails fast when Redis is down. The rate limiter then lets the request through. The idempotency check falls back to Postgres, where the primary key still prevents duplicates. Redis is an optimisation, not a requirement.

## Alternatives considered
- **Postgres only.** It is correct, but every duplicate delivery would cost a database round trip, and rate limiting would write to the main database.
- **An in-memory map.** It breaks as soon as there are two instances or a restart.
- **A sliding window or token bucket.** Smoother, but they need more Redis work. A fixed window allows up to twice the limit across a window boundary, and I accepted that for a simple version.

## Consequences
- Duplicate deliveries are answered without touching Postgres.
- If Redis loses a key, the worst case is one extra database check.
- The boundary burst of the fixed window is a known limit, written in the code comment.
- Tests use `ioredis-mock`, and CI runs the same code against a real Redis server. The first CI run of that job failed because the test sent commands before the connection was ready. The client's fail-fast setting was working as designed, and the test now waits for `ready`.
