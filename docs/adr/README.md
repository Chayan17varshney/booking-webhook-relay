# Architecture decision records

Write one short file per decision, named `NNNN-short-title.md`. Write them in your own words; they are the part of this repo that shows how you think.

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

## Decisions to write as you build
- 0001 HMAC signatures on webhooks (Block 2)
- 0002 PostgreSQL for event storage (Block 3)
- 0003 Redis for idempotency keys and rate limiting (Block 4)
- 0004 Retry with exponential backoff and jitter (Block 4)
