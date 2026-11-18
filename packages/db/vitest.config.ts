import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Files run in parallel, each vitest worker on its own copy of the
    // migrated template database (R-211, @mychess/db/testing).
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
