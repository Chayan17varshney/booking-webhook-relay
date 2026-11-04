# 0004. Retry with exponential backoff and jitter

Date: 2026-11-04
Status: Accepted

## Context
After an event is stored, the relay sends it to the CRM. The CRM can be slow, rate-limited or briefly down. Some failures are worth retrying and some are not: a 503 may succeed in a second, while a 400 for a bad payload will fail every time.

## Decision
`Forwarder.forward` makes up to 5 attempts per call. After a retryable failure it waits a random time between 0 and `min(30 s, 500 ms * 2^(attempt-1))`. This is exponential backoff with full jitter.

- Each attempt first moves the event to `retrying`, which also counts the attempt, so the database always shows what is happening.
- A non-retryable `CrmError`, or running out of attempts, ends the event in `failed` with the error text, cut to 500 characters.
- If the event is already `forwarded` or missing, nothing is sent.
- The event id is sent as an `Idempotency-Key` header, so a CRM that supports it can drop a repeated request.
- Failed events can be replayed with `POST /events/:id/replay`, which is what the dashboard button calls.
- Forwarding runs in the same process as the server. A sweeper (`recoverPending`) finds events stuck in `received` or `retrying` for more than 60 seconds and forwards them again, so a crash or a deploy does not strand them.

The delay function takes `random` and `sleep` as parameters, so tests check the schedule and the retry paths without waiting.

## Alternatives considered
- **Fixed delay.** Simple, but after an outage every failed event retries at the same moment and hits the CRM together.
- **Exponential backoff without jitter.** Spreads retries over time but keeps them in lockstep with each other. Full jitter breaks that.
- **A job queue such as BullMQ or SQS with built-in retries.** More robust at scale, but it adds a component. With Postgres already holding the state, a sweep was enough for this version.

## Consequences
- A CRM outage produces spread-out retries, and events that never succeed end in `failed`, where a person can replay them.
- Delivery is at least once. If the process dies after the CRM accepted a request and before the status update, the sweeper sends it again. The idempotency header only helps if the CRM honours it.
- The sweeper's age threshold has to stay above the longest backoff, or a healthy in-flight attempt could be picked up twice.
- With more than one relay instance, two sweepers could pick the same event. That would need row locking or a real queue.
