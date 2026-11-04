import { createPgDb } from '../src/db/pool';

describe('createPgDb (no server running)', () => {
  it('surfaces connection failures from query and exec, and closes cleanly', async () => {
    // Port 1 is closed, so connecting fails immediately without needing any real database.
    const db = createPgDb('postgres://user:pass@127.0.0.1:1/nodb');
    await expect(db.query('SELECT 1')).rejects.toThrow();
    await expect(db.exec('SELECT 1')).rejects.toThrow();
    await expect(db.close()).resolves.toBeUndefined();
  });
});
