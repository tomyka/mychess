import { defineConfig, devices } from '@playwright/test';

// apps/web's E2E suite (test:e2e): a production build served by `next start`
// on its own port, driven in desktop Chromium and a phone profile. Both
// profiles run on Chromium, so CI installs only that browser.
const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${String(PORT)}`;
const CI = process.env['CI'] === 'true';

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: CI,
  retries: CI ? 1 : 0,
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
    // Locally a server already on the port is reused (e.g. a manual
    // `next start`); CI always builds and starts its own.
    reuseExistingServer: !CI,
    timeout: 300_000,
  },
});
