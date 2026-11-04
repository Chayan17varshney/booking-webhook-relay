import type { Db } from './db';

export interface Migration {
  name: string;
  sql: string;
}

/**
 * Migrations are plain SQL kept in code so they ship inside the compiled build
 * (no .sql files to copy into the Docker image). Never edit one after it has been
 * applied anywhere: add a new, higher-numbered migration instead.
 */
export const migrations: Migration[] = [
  {
    name: '001_create_events',
    sql: `
      CREATE TABLE events (
        event_id     text PRIMARY KEY,
        type         text NOT NULL,
        status       text NOT NULL DEFAULT 'received'
                     CHECK (status IN ('received', 'retrying', 'forwarded', 'failed')),
        payload      jsonb NOT NULL,
        attempts     integer NOT NULL DEFAULT 0,
        last_error   text,
        received_at  timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        forwarded_at timestamptz
      );

      CREATE INDEX events_status_received_at_idx ON events (status, received_at DESC);
    `,
  },
];

/**
 * Apply any migrations that have not run yet, each inside its own transaction,
 * and record them in schema_migrations. Safe to call on every startup.
 */
export async function migrate(db: Db, list: Migration[] = migrations): Promise<string[]> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const applied = await db.query<{ name: string }>('SELECT name FROM schema_migrations');
  const done = new Set(applied.rows.map((row) => row.name));
  const ran: string[] = [];

  for (const migration of list) {
    if (done.has(migration.name)) {
      continue;
    }
    const safeName = migration.name.replace(/'/g, "''");
    await db.exec(`
      BEGIN;
      ${migration.sql}
      INSERT INTO schema_migrations (name) VALUES ('${safeName}');
      COMMIT;
    `);
    ran.push(migration.name);
  }

  return ran;
}
