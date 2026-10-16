import { defineConfig, devices } from '@playwright/test';

// apps/web's E2E suite (test:e2e): a production build served by `next start`
// on its own port, driven in desktop Chromium and a phone profile. Both
// profiles run on Chromium, so CI installs only that browser.
const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${String(PORT)}`;
const CI = process.env['CI'] === 'true';

/** A variable from the environment, or its local default. */
const fromEnv = (name: string, fallback: string): string =>
  process.env[name] ?? fallback;

// The app's environment (src/server/env.ts). CI's e2e job sets every one;
// locally the defaults are infra/compose.yaml's Postgres and Mailpit, so
// `pnpm test:e2e` works after `docker compose -f infra/compose.yaml up -d`
// and the migrate step (docs/operations.md). The secret only signs throwaway
// local sessions.
const APP_ENV = {
  DATABASE_URL: fromEnv(
    'DATABASE_URL',
    'postgres://mychess:mychess@127.0.0.1:5432/mychess',
  ),
  MYCHESS_ENV: fromEnv('MYCHESS_ENV', 'local'),
  BETTER_AUTH_SECRET: fromEnv(
    'BETTER_AUTH_SECRET',
    'local-e2e-only-secret-signs-throwaway-sessions',
  ),
  BETTER_AUTH_URL: BASE_URL,
  MAIL_TRANSPORT: fromEnv('MAIL_TRANSPORT', 'mailpit'),
  MAIL_FROM: fromEnv('MAIL_FROM', 'mychess <noreply@mychess.test>'),
  MAILPIT_URL: fromEnv('MAILPIT_URL', 'http://127.0.0.1:8025'),
  LICHESS_CLIENT_ID: fromEnv('LICHESS_CLIENT_ID', 'mychess-local'),
};

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // One at a time: the tests share one Mailpit inbox and one database.
  workers: 1,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'pixel-7', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `pnpm build && pnpm start --hostname 127.0.0.1 --port ${String(PORT)}`,
    url: BASE_URL,
    // Merged over the runner's own environment; these win over a developer's
    // apps/web/.env.local, which Next.js reads only for unset variables.
    env: APP_ENV,
    // Locally a server already on the port is reused (e.g. a manual
    // `next start`); CI always builds and starts its own.
    reuseExistingServer: !CI,
    timeout: 300_000,
  },
});
