# 0002. PostgreSQL for event storage

Date: 2026-11-04
Status: Accepted

## Context
Every verified booking event has to be stored before the relay tries to forward it. The record needs to survive a crash. The dashboard needs to list events by status and show why one failed. Two deliveries of the same event must never produce two rows.

## Decision
Store events in PostgreSQL, in one `events` table:
- `event_id text PRIMARY KEY`, taken from the booking payload.
- `status` limited by a CHECK constraint to `received`, `retrying`, `forwarded` or `failed`.
- `payload jsonb`, `attempts`, `last_error`, and timestamps for received, updated and forwarded.
- An index on `(status, received_at DESC)` for the dashboard's filtered, newest-first list.

The primary key is what guarantees one row per event. `INSERT ... ON CONFLICT` reports whether the row was new, so a duplicate is acknowledged without a second forward. The table also works as the queue: events stuck in `received` or `retrying` past a threshold are found with a query and forwarded again.

## Alternatives considered
- **MongoDB.** A good fit for a raw payload, but the rest of the record is relational and I wanted constraints on status and a real primary key.
- **Redis only.** Fast, but a restart or eviction can lose events, and the relay should not drop a booking.
- **A message broker such as SQS.** It would give retries for free, but it adds a service and still needs a place to show event history and errors.
- **SQLite.** Simple for one machine, but the deploy runs the app in a container next to a separate database.

## Consequences
- Status changes are visible in one place, and a failed event keeps its error text.
- Tests run the real SQL against PGlite (Postgres compiled to WebAssembly), so they need no Docker. CI also runs the same queries against a real Postgres 16.
- Using the table as a queue works at this volume. A sweep that polls the table would need `FOR UPDATE SKIP LOCKED` or a broker if several relay instances ran at once. Today there is one instance.
- Migrations are a small hand-written runner with a `schema_migrations` table. A migration tool would be worth adding if the schema grows.
