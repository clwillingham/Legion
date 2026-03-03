import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['packages/*/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/index.ts'],
    },
  },
});

/**
 * Test naming convention:
 *   *.test.ts              — unit tests (fast, mocked dependencies)
 *   *.integration.test.ts  — integration tests (real I/O, spawned processes)
 *
 * npm scripts:
 *   npm test                 — all tests
 *   npm run test:unit        — unit tests only (excludes *.integration.test.ts)
 *   npm run test:integration — integration tests only (path filter: "integration")
 *   npm run test:watch       — all tests in watch mode
 */
