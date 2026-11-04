/**
 * The tiny database surface the app depends on. Production uses node-postgres (see pool.ts);
 * tests use PGlite, an in-process Postgres, through the same interface.
 */
export interface Db {
  /** Run one parameterised statement ($1, $2, ...) and return the rows. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Run one or more statements with no parameters (used for migrations). */
  exec(sql: string): Promise<void>;
}
