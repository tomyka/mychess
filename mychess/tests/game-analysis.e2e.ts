// mychess/tests/game-analysis.e2e.ts
// GitHub issue #133: the upload -> list -> open golden path for Game
// Analysis (#110), authenticated via the fixture in global-setup.ts.
//
// Deliberately does not assert on the analysis actually completing —
// running the real client-side Stockfish engine to a finished eval in
// headless CI is slow/heavy, and #127 tracks making that path lighter. This
// only confirms the page a player lands on after uploading a game actually
// renders the board and move controls, not a blank or error page.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { AUTH_STATE_PATH } from './global-setup';

test.use({ storageState: AUTH_STATE_PATH });

// The fixture account is reused across every run (no per-run throwaway
// account, no staging project to reset — see global-setup.ts), so each
// game this suite uploads is deleted afterwards rather than left to
// accumulate under it indefinitely.
let uploadedGameId: string | null = null;

test.afterEach(async () => {
	if (!uploadedGameId) return;
	const admin = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
		auth: { autoRefreshToken: false, persistSession: false }
	});
	await admin.from('games').delete().eq('id', uploadedGameId);
	uploadedGameId = null;
});

// A short, complete game — just enough for extractSingleGame's PGN parsing
// (src/lib/games/parse.ts) to accept it and for the board to have real moves
// to show.
const SHORT_PGN = `[Event "E2E fixture"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 1-0`;

test.describe('Game Analysis golden path', () => {
	test('upload a PGN, land on the game page, and see the board render', async ({ page }) => {
		await page.goto('/games/new');
		await expect(page.getByRole('heading', { name: 'Upload a game' })).toBeVisible();
		// Playwright's own actionability checks (visible, enabled, stable) don't
		// know about SvelteKit CLIENT hydration — clicking too early lands on a
		// server-rendered button whose onsubmit handler isn't attached yet, so
		// the browser falls back to a native GET form submission instead
		// (observed directly: a request for /games/new?pgn_text=... appears).
		// Waiting for the network to go quiet after the initial module fetch
		// flurry is what actually waits long enough for hydration to finish.
		await page.waitForLoadState('networkidle');

		await page.getByLabel('Paste PGN text').fill(SHORT_PGN);
		await page.getByRole('button', { name: 'Upload and analyze' }).click();

		// Not /\/games\/[^/]+$/ alone — that also matches /games/new itself
		// (the page this test starts on), so waitForURL would resolve
		// immediately without the click having navigated anywhere at all.
		await page.waitForURL((u) => /^\/games\/[^/]+$/.test(u.pathname) && u.pathname !== '/games/new', {
			timeout: 15_000
		});
		uploadedGameId = new URL(page.url()).pathname.split('/').pop()!;

		// Confirms the destination page rendered with real content, not a
		// blank or error state — the two headers pulled straight from the
		// uploaded PGN, and chessground's own board wrapper mounted.
		await expect(page.getByRole('heading', { name: 'Alice vs Bob' })).toBeVisible();
		await expect(page.locator('.cg-wrap')).toBeVisible();
	});
});
