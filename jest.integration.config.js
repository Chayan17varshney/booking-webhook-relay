const base = require('./jest.config');

/**
 * Integration tests run against REAL Postgres and Redis (set TEST_DATABASE_URL and TEST_REDIS_URL).
 * They live in tests/integration/*.int.ts so the normal `npm test` never picks them up.
 */
module.exports = {
  preset: base.preset,
  testEnvironment: base.testEnvironment,
  roots: ['<rootDir>/tests'],
  testMatch: ['**/tests/integration/*.int.ts'],
  testTimeout: 30000,
};
