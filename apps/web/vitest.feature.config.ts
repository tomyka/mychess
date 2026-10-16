import { defineConfig } from 'vitest/config';

// apps/web's feature suite: route handlers and server actions against a real,
// migrated Postgres (Testcontainers, via @mychess/db/testing).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/feature/**/*.test.ts'],
    globalSetup: ['test/feature/global-setup.ts'],
    // One database for the run; files take turns so truncation cannot race.
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
