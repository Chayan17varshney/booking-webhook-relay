/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // src is listed too so files no test imports still appear (as 0%) in the coverage report.
  roots: ['<rootDir>/tests', '<rootDir>/src'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/server.ts', // process entry points: exercised by the compose smoke test in CI
    '!src/mockCrm/server.ts',
    '!src/db/db.ts', // interface only
  ],
  coverageThreshold: {
    global: { statements: 95, branches: 90, functions: 95, lines: 95 },
  },
};
