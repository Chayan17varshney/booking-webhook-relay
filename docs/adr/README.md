# Architecture decision records

One short file per decision, named `NNNN-short-title.md`.

## Template

```
# NNNN. Title

Date: YYYY-MM-DD
Status: Proposed | Accepted | Superseded by NNNN

## Context
What problem are we solving, and what constraints matter?

## Decision
What did we choose?

## Alternatives considered
What else did we look at, and why not?

## Consequences
What gets easier, what gets harder, what will we have to revisit?
```

## Decisions
- [0001 HMAC signatures on webhooks](0001-hmac-signatures-on-webhooks.md)
- [0002 PostgreSQL for event storage](0002-postgresql-for-event-storage.md)
- [0003 Redis for idempotency keys and rate limiting](0003-redis-for-idempotency-and-rate-limiting.md)
- [0004 Retry with exponential backoff and jitter](0004-retry-with-exponential-backoff-and-jitter.md)
