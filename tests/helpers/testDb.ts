import { PGlite } from '@electric-sql/pglite';
import type { Db } from '../../src/db/db';
import { migrate } from '../../src/db/migrations';

/**
 * A real PostgreSQL engine running in-process (PGlite), so the repository's actual SQL is
 * exercised without needing Docker. Each call returns a fresh, migrated, empty database.
 */
export async function createTestDb(): Promise<Db & { close(): Promise<void> }> {
  const pg = new PGlite();
  const db = {
    async query<T>(sql: string, params?: unknown[]) {
      const result = await pg.query<T>(sql, params);
      return { rows: result.rows };
    },
    async exec(sql: string) {
      await pg.exec(sql);
    },
    close: () => pg.close(),
  };
  await migrate(db);
  return db;
}
