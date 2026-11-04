import { Pool } from 'pg';
import type { Db } from './db';

export interface PgDb extends Db {
  close(): Promise<void>;
}

export function createPgDb(connectionString: string): PgDb {
  const pool = new Pool({ connectionString });

  return {
    async query<T>(sql: string, params?: unknown[]) {
      const result = await pool.query(sql, params as unknown[] | undefined);
      return { rows: result.rows as T[] };
    },
    async exec(sql: string) {
      await pool.query(sql); // no parameters: node-postgres uses the simple protocol, so multiple statements are allowed
    },
    close: () => pool.end(),
  };
}
