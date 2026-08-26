// mychess/tests/global-setup.ts
//
// Authenticated Playwright fixture (GitHub issue #133). This repo has no
// staging Supabase project — only production (mychess/.env) — so this signs
// in a single, clearly-named fixture account (E2E_TEST_EMAIL below) through
// the REAL magic-link callback route, rather than hand-constructing session
// cookies: it's the only path that doesn't depend on reverse-engineering
// @supabase/ssr's cookie format, and it exercises the actual auth code.
//
// Runs as a plain Node script outside SvelteKit's Vite context (no `$lib`
// alias resolution here — see package.json's other one-off `scripts/*.ts`
// for the same constraint), so the player-profile insert below is a narrow,
// deliberate duplicate of src/lib/server/onboarding.ts's createPlayerProfile
// rather than an import.
import { chromium, type FullConfig } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const E2E_TEST_EMAIL = 'e2e-fixture@mychess.lt';
export const AUTH_STATE_PATH = 'tests/.auth/player.json';

export default async function globalSetup(config: FullConfig) {
	const url = process.env.PUBLIC_SUPABASE_URL;
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !serviceRoleKey) {
		throw new Error('PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set (see mychess/.env) to run the authenticated e2e fixture.');
	}
	const baseURL = config.projects[0]?.use?.baseURL ?? process.env.PLAYWRIGHT_TEST_BASE_URL ?? 'http://localhost:4173';

	const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

	// Reuse the same fixture account across runs (mints once, never deleted) —
	// this repo has no throwaway-per-run staging environment to reset.
	const { data: existingUsers, error: listError } = await admin.auth.admin.listUsers();
	if (listError) throw listError;
	let user = existingUsers.users.find((u) => u.email === E2E_TEST_EMAIL);
	if (!user) {
		const { data, error } = await admin.auth.admin.createUser({ email: E2E_TEST_EMAIL, email_confirm: true });
		if (error) throw error;
		user = data.user;
	}

	const { data: existingProfile, error: profileReadError } = await admin
		.from('profiles')
		.select('id')
		.eq('id', user.id)
		.maybeSingle();
	if (profileReadError) throw profileReadError;
	if (!existingProfile) {
		const { error: profileInsertError } = await admin.from('profiles').insert({
			id: user.id,
			role: 'player',
			first_name: 'E2E',
			last_name: 'Fixture',
			display_name: 'E2E Fixture',
			avatar_id: 'knight'
		});
		if (profileInsertError) throw profileInsertError;
		await admin.from('player_stats').upsert({ player_id: user.id });
		await admin.from('equipped_cosmetics').upsert({ player_id: user.id });
	}

	const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
		type: 'magiclink',
		email: E2E_TEST_EMAIL,
		options: { redirectTo: `${baseURL}/auth/callback` }
	});
	if (linkError) throw linkError;

	// Built directly rather than navigating linkData.properties.action_link
	// (Supabase's own hosted verify redirector): that link's redirect back to
	// our app can land as an implicit-flow hash fragment
	// (#access_token=...), which never reaches the server at all — our own
	// /auth/callback route only understands the `code` (PKCE) or
	// `token_hash`+`type` (OTP) QUERY-param shapes (see its own source).
	// hashed_token is exactly what that second shape expects, so this goes
	// straight to our app's real verifyOtp code path with no ambiguity about
	// which flow Supabase's redirector chose.
	const callbackUrl = `${baseURL}/auth/callback?token_hash=${linkData.properties.hashed_token}&type=magiclink`;

	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		await page.goto(callbackUrl);
		// The callback route redirects to '/' (or wherever `next` pointed) once
		// verifyOtp succeeds — waiting for navigation away from both the
		// callback and an error-redirect-to-/login confirms the session (and
		// its cookies) actually landed, not just that the browser followed a
		// 303.
		await page.waitForURL((u) => !u.pathname.startsWith('/auth/callback') && !u.pathname.startsWith('/login'), {
			timeout: 15_000
		});
		if ((await page.context().cookies()).length === 0) {
			throw new Error(`Auth fixture landed on ${page.url()} with no session cookies — magic-link verification did not actually complete.`);
		}

		mkdirSync(dirname(AUTH_STATE_PATH), { recursive: true });
		await page.context().storageState({ path: AUTH_STATE_PATH });
	} finally {
		await browser.close();
	}
}
