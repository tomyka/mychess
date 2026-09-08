import { defineConfig, devices } from '@playwright/test';

// `tests/global-setup.ts` needs PUBLIC_SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY from mychess/.env, and Playwright loads no .env of
// its own. The other .env-dependent entry points are npm scripts passing
// `tsx --env-file=.env` (see package.json), but that flag does not exist on the
// Playwright CLI and Node refuses it inside NODE_OPTIONS, so the load happens
// here — which also keeps the bare `npx playwright test` in
// .github/ISSUE_TEMPLATE/small-task.yml working, rather than only a wrapper
// script.
//
// Swallowed deliberately: a missing .env must fall through to global-setup's
// own "must be set (see mychess/.env)" error, which says what to do about it,
// instead of an ENOENT thrown while merely reading this config.
try {
	process.loadEnvFile();
} catch {
	// no .env here — global-setup reports it properly
}

export default defineConfig({
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173,
		timeout: 120 * 1000,
		reuseExistingServer: !process.env.CI
	},
	// Relative page.goto('/login')-style navigation needs this to resolve at
	// all — matches webServer.port above, and can be overridden locally via
	// PLAYWRIGHT_TEST_BASE_URL when running against a server already started
	// by hand (e.g. `npm run dev`) instead of the build+preview command
	// above.
	use: { baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL ?? 'http://localhost:4173' },
	// Authenticated e2e fixture (GitHub issue #133): signs in a single,
	// reused fixture account once before the suite and saves its session for
	// tests that opt in via `test.use({ storageState: AUTH_STATE_PATH })` —
	// see global-setup.ts for why this repo (no staging Supabase project)
	// drives the real magic-link callback rather than faking cookies.
	globalSetup: './tests/global-setup.ts',
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
