import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// apps/web's feature suite: route handlers and server actions against a real,
// migrated Postgres (Testcontainers, via @mychess/db/testing).
export default defineConfig({
  resolve: {
    alias: {
      'server-only': fileURLToPath(
        new URL('./test/server-only-stub.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['test/feature/**/*.test.ts'],
    globalSetup: ['test/feature/global-setup.ts'],
    // Files run in parallel, each vitest worker on its own copy of the
    // migrated template database (R-211, @mychess/db/testing).
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
