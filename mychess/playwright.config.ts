import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173,
		timeout: 120 * 1000,
		reuseExistingServer: !process.env.CI
	},
	testDir: 'tests',
	// Matches local test filenames on disk at config-time only — never
	// evaluated against untrusted/attacker-controlled input.
	// eslint-disable-next-line security/detect-unsafe-regex
	testMatch: /(.+\/)?(.*\.e2e)\.[jt]s/,
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		},
		{
			name: 'mobile',
			use: { ...devices['Pixel 5'] }
		}
	]
});
