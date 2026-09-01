// mychess/scripts/qa-verify-learn.ts
//
// GitHub issue #179. Reusable, repeatable verification of Learn/picker
// behavior end-to-end: a persistent coach+player QA fixture pair uploads a
// real repertoire PGN through the actual upload UI (as a coach would),
// assigns it through the actual assign UI, then drills it through the real
// `/api/practice/attempt` endpoint (same server code a real player's
// browser calls) until progress is non-trivial, and finally drives a real
// browser to `/learn/<id>` to check the rendered picker's active entry sits
// at the very top of its list (GitHub issue #178) rather than asking a human
// to reproduce and screenshot the same scenario by hand every time.
//
//   npm run qa:verify-learn -- "C:\path\to\repertoire.pgn"
//
// Runs against production (mychess.lt) by default — override with
// QA_BASE_URL for a local build+preview instead. Like tests/global-setup.ts,
// this signs in through the REAL magic-link callback route rather than
// hand-constructing session cookies (see that file's own doc comment for
// why), so it also exercises the real auth code path.
//
// The fixture accounts (qa-coach@mychess.lt / qa-player@mychess.lt) and their
// coach_players relationship are meant to persist across runs, matching
// tests/global-setup.ts's fixture account — only the QA repertoire itself is
// deleted and re-uploaded fresh each run, which also means every run
// re-exercises the real upload/import path (catches regressions there too,
// e.g. GitHub issue #177's move-ordering bug) rather than reusing stale data.
//
// Uses plain `fetch` against PostgREST/GoTrue instead of `@supabase/supabase-js`
// — supabase-js's realtime client throws under this machine's Node 20 (no
// native WebSocket; see mychess/CLAUDE.md-adjacent memory on local dev node
// gotchas), and nothing here needs realtime anyway.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const COACH_EMAIL = 'qa-coach@mychess.lt';
const PLAYER_EMAIL = 'qa-player@mychess.lt';
const BASE_URL = process.env.QA_BASE_URL ?? 'https://mychess.lt';
const MAX_ATTEMPTS = 30;

const pgnPath = process.argv[2];
if (!pgnPath) {
	console.error('Usage: npm run qa:verify-learn -- "<path-to-pgn>"');
	process.exit(1);
}

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
	console.error('Missing PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (see mychess/.env)');
	process.exit(1);
}

const adminHeaders = {
	apikey: SERVICE_ROLE_KEY,
	Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
	'Content-Type': 'application/json'
};

async function rest<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
	const res = await fetch(`${SUPABASE_URL}${path}`, {
		method,
		headers: { ...adminHeaders, ...extraHeaders },
		body: body !== undefined ? JSON.stringify(body) : undefined
	});
	if (!res.ok) {
		throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
	}
	const text = await res.text();
	return (text ? JSON.parse(text) : null) as T;
}

type AuthUser = { id: string; email: string };

async function findUserByEmail(email: string): Promise<AuthUser | null> {
	// GoTrue's admin list endpoint doesn't filter by email server-side across
	// all versions reliably, so page through and match client-side — fine at
	// this project's user count.
	const data = await rest<{ users: AuthUser[] }>('GET', '/auth/v1/admin/users?per_page=1000', undefined);
	return data.users.find((u) => u.email === email) ?? null;
}

async function ensureAccount(email: string, profile: Record<string, unknown>): Promise<AuthUser> {
	let user = await findUserByEmail(email);
	if (!user) {
		user = await rest<AuthUser>('POST', '/auth/v1/admin/users', { email, email_confirm: true });
	}
	const existingProfile = await rest<{ id: string }[]>('GET', `/rest/v1/profiles?id=eq.${user.id}&select=id`);
	if (existingProfile.length === 0) {
		await rest('POST', '/rest/v1/profiles', { id: user.id, ...profile });
	}
	return user;
}

async function upsert(table: string, row: Record<string, unknown>, onConflict: string) {
	await rest('POST', `/rest/v1/${table}?on_conflict=${onConflict}`, row, { Prefer: 'resolution=merge-duplicates' });
}

async function ensureCoachPlayerRelationship(coachId: string, playerId: string) {
	const existing = await rest<{ id: string; status: string }[]>(
		'GET',
		`/rest/v1/coach_players?coach_id=eq.${coachId}&player_id=eq.${playerId}&select=id,status`
	);
	if (existing[0]?.status === 'active') return;
	if (existing[0]) {
		await rest('PATCH', `/rest/v1/coach_players?id=eq.${existing[0].id}`, {
			status: 'active',
			responded_at: new Date().toISOString()
		});
		return;
	}
	// Direct 'active' insert, matching the documented invite-link-redemption
	// path (migration 0019's own comment) rather than the two-step
	// pending->accepted flow a real client is restricted to by RLS.
	await rest('POST', '/rest/v1/coach_players', {
		coach_id: coachId,
		player_id: playerId,
		status: 'active',
		requested_by: coachId,
		responded_at: new Date().toISOString()
	});
}

// Scopes on the QA coach's own repertoires by name (derived from the PGN's
// filename below), so two different input PGNs that happen to share a
// filename would collide — acceptable for a single-PGN fixture used
// consistently for one scenario (GitHub issue #179's own framing), but worth
// knowing if this is ever pointed at several different PGNs in the same run.
async function deleteExistingRepertoire(coachId: string, name: string) {
	const rows = await rest<{ id: string }[]>('GET', `/rest/v1/repertoires?player_id=eq.${coachId}&name=eq.${encodeURIComponent(name)}&select=id`);
	for (const rep of rows) {
		await rest('DELETE', `/rest/v1/repertoires?id=eq.${rep.id}`);
	}
}

async function loginViaMagicLink(email: string) {
	const link = await rest<{ hashed_token: string }>('POST', '/auth/v1/admin/generate_link', {
		type: 'magiclink',
		email,
		redirect_to: `${BASE_URL}/auth/callback`
	});
	const callbackUrl = `${BASE_URL}/auth/callback?token_hash=${link.hashed_token}&type=magiclink`;

	const browser = await chromium.launch();
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const page = await context.newPage();
	await page.goto(callbackUrl, { waitUntil: 'networkidle' });
	await page.waitForURL((u) => !u.pathname.startsWith('/auth/callback') && !u.pathname.startsWith('/login'), { timeout: 15_000 });
	if ((await context.cookies()).length === 0) {
		throw new Error(`Magic-link sign-in for ${email} landed on ${page.url()} with no session cookies.`);
	}
	return { browser, context, page };
}

async function main() {
	const pgnText = readFileSync(pgnPath, 'utf8');
	const repName = basename(pgnPath).replace(/\.[^/.]+$/, '');
	console.log(`Repertoire: "${repName}" (${pgnText.length} chars) against ${BASE_URL}`);

	const coach = await ensureAccount(COACH_EMAIL, {
		role: 'coach',
		first_name: 'QA',
		last_name: 'Coach',
		display_name: 'QA Coach',
		avatar_id: 'knight'
	});
	const player = await ensureAccount(PLAYER_EMAIL, {
		role: 'player',
		first_name: 'QA',
		last_name: 'Player',
		display_name: 'QA Player',
		avatar_id: 'knight'
	});
	await upsert('player_stats', { player_id: player.id }, 'player_id');
	await upsert('equipped_cosmetics', { player_id: player.id }, 'player_id');
	await ensureCoachPlayerRelationship(coach.id, player.id);
	await deleteExistingRepertoire(coach.id, repName);
	console.log('Fixture accounts + relationship ready.');

	// --- Coach: upload + assign, through the real UI ---
	const coachSession = await loginViaMagicLink(COACH_EMAIL);
	try {
		await coachSession.page.goto(`${BASE_URL}/coach/pgn`, { waitUntil: 'networkidle' });
		await coachSession.page.getByLabel('Repertoire Name', { exact: true }).fill(repName);
		// The PGN's own filename convention ("baltais" = Lithuanian for "as
		// White") — this fixture always imports as White to match the coach's
		// own repertoire; not derived from PGN content, since [White "..."] here
		// names each chapter, not which side the repertoire is for. Color
		// defaults to White in the form already, so no extra click needed.
		await coachSession.page.setInputFiles('#pgn_file', pgnPath);
		await coachSession.page.getByRole('button', { name: 'Upload Repertoire' }).click();
		await coachSession.page.waitForURL((u) => u.pathname === '/coach/repertoires', { timeout: 60_000 });

		const repRows = await rest<{ id: string }[]>(
			'GET',
			`/rest/v1/repertoires?player_id=eq.${coach.id}&name=eq.${encodeURIComponent(repName)}&select=id&order=created_at.desc&limit=1`
		);
		const repertoireId = repRows[0]?.id;
		if (!repertoireId) throw new Error('Upload did not produce a repertoire row.');
		console.log('Uploaded repertoire:', repertoireId);

		const repCard = coachSession.page.locator('li', { has: coachSession.page.getByRole('heading', { name: repName, exact: true }) });
		await repCard.getByTitle('Assign to players').click();
		const assignModal = coachSession.page.locator('div.fixed.inset-0');
		const playerRow = assignModal.locator('li', { hasText: 'QA Player' });
		await playerRow.getByRole('button', { name: 'Assign', exact: true }).click();
		// A successful `?/assign` action re-renders this same row with a
		// "Remove" button (`coach_repertoires_unassign_button`) in place of
		// "Assign" (see +page.server.ts's `assign` action + the `isAssigned`
		// conditional) — waiting for that is a real UI signal that the
		// assignment actually landed, not a fixed guess at how long the form
		// action + invalidation takes.
		await playerRow.getByRole('button', { name: 'Remove', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });

		const assignedRows = await rest<{ id: string }[]>(
			'GET',
			`/rest/v1/assigned_repertoires?coach_id=eq.${coach.id}&player_id=eq.${player.id}&repertoire_id=eq.${repertoireId}&select=id`
		);
		if (assignedRows.length === 0) throw new Error('Assign click did not create an assigned_repertoires row.');
		console.log('Assigned to QA player.');

		// --- Player: drill for real, through the real attempt endpoint ---
		const playerSession = await loginViaMagicLink(PLAYER_EMAIL);
		try {
			await playerSession.page.goto(`${BASE_URL}/learn/${repertoireId}`, { waitUntil: 'networkidle' });

			const initialActive = await rest<{ active_variation_key: string | null }[]>(
				'GET',
				`/rest/v1/practice_active_variation?player_id=eq.${player.id}&repertoire_id=eq.${repertoireId}&select=active_variation_key`
			);
			let currentKey: string | null = initialActive[0]?.active_variation_key ?? null;
			if (!currentKey) throw new Error('No active variation after first Learn page load.');

			let attempts = 0;
			for (; attempts < MAX_ATTEMPTS && currentKey; attempts++) {
				const res = await playerSession.page.request.post(`${BASE_URL}/api/practice/attempt`, {
					data: { repertoireId, variationKey: currentKey, hadMistake: false, sessionStart: attempts === 0 }
				});
				if (!res.ok()) throw new Error(`Attempt ${attempts} failed: ${res.status()} ${await res.text()}`);
				const body = (await res.json()) as { attempt: { variationKey: string } | null };
				currentKey = body.attempt?.variationKey ?? null;
			}
			console.log(`Played ${attempts} clean attempts (stopped at ${currentKey ? 'attempt cap' : 'fully solved'}).`);

			await playerSession.page.goto(`${BASE_URL}/learn/${repertoireId}`, { waitUntil: 'networkidle' });
			const syncedActive = await rest<{ active_variation_key: string | null }[]>(
				'GET',
				`/rest/v1/practice_active_variation?player_id=eq.${player.id}&repertoire_id=eq.${repertoireId}&select=active_variation_key`
			);
			const expectedActiveKey = syncedActive[0]?.active_variation_key ?? null;
			console.log('Expected active variation (server-side ground truth):', expectedActiveKey);

			// --- Check the rendered picker ---
			// No semantic hook (data-testid/aria-current) marks the active row in
			// VariationPicker.svelte — only its Tailwind `ring-2` class does — so
			// this reads that class directly rather than adding a test-only
			// attribute to the component for this one script. Tradeoff: a future
			// restyle of the active-row treatment would need this selector
			// updated alongside it.
			const rail = playerSession.page.locator('div[class*="lg:w-64"]');
			const leafButtons = rail.locator('ul > li > button[class*="pr-8"], ul > li > button[class*="pr-12"]');
			await leafButtons.first().waitFor({ state: 'visible', timeout: 10_000 });

			// The float-to-front fix under test (GitHub issue #178) lives in
			// `pickerEntries` — the top-level list WITHIN a chapter — not in the
			// drilled-in "leaf" view of one multi-item group's own rows, which the
			// component's auto-open effect lands on instead whenever the active
			// variation's own entry happens to be a multi-item regular group. Both
			// views render visually similar button lists, so rather than guess
			// which one is showing, force a known state: walk back to the
			// top-level chapter list (however many "Back" clicks that takes), then
			// click directly into the chapter holding the active variation — a
			// chapter-heading click only ever sets `openChapter`, never
			// `openEntryKey` (see VariationPicker.svelte's chapter button onclick),
			// so this always lands on the entries view, never the leaf view.
			if (expectedActiveKey !== null) {
				const backLink = playerSession.page.getByRole('button', { name: '← Back' });
				for (let i = 0; i < 2 && (await backLink.isVisible().catch(() => false)); i++) {
					await backLink.click();
					await playerSession.page.waitForTimeout(200);
				}

				const variationsRes = await playerSession.page.request.get(`${BASE_URL}/api/repertoires/${repertoireId}/variations`);
				if (!variationsRes.ok()) throw new Error(`Fetching variations failed: ${variationsRes.status()}`);
				const rows = (await variationsRes.json()) as { variationKey: string; chapterNames: string[] }[];
				const activeRow = rows.find((r) => r.variationKey === expectedActiveKey);
				const activeChapterName = activeRow?.chapterNames[0] ?? 'Lines without a chapter';

				// Chapter buttons also carry a trailing progress badge ("3/5" or
				// "✓") in the same accessible name, so matching on the whole
				// button's name would need a fragile prefix match — this matches
				// the chapter label's own `<span>` exactly instead, then walks up
				// to its enclosing button.
				const chapterLabel = rail.getByText(activeChapterName, { exact: true });
				if (await chapterLabel.isVisible().catch(() => false)) {
					await chapterLabel.locator('xpath=ancestor::button[1]').click();
					await playerSession.page.waitForTimeout(200);
				}
				// If the chapter heading isn't visible, the repertoire has no
				// chapters at all (`chapters === null`) and the entries view is
				// already the only thing the rail ever shows — nothing to click.
			}

			const buttons = rail.locator('ul > li > button');
			const count = await buttons.count();
			let activeIndex = -1;
			for (let i = 0; i < count; i++) {
				const cls = (await buttons.nth(i).getAttribute('class')) ?? '';
				if (cls.includes('ring-2')) {
					activeIndex = i;
					break;
				}
			}

			const screenshotPath = 'scratch-qa-verify-learn.png';
			await playerSession.page.screenshot({ path: screenshotPath, fullPage: true });
			console.log('Screenshot saved to', screenshotPath);

			if (expectedActiveKey === null) {
				console.log('Repertoire is fully solved — no active entry to check. PASS (trivially).');
			} else if (activeIndex === 0) {
				console.log(`PASS: the active entry (index 0 of ${count}) is floated to the top of the picker.`);
			} else if (activeIndex === -1) {
				console.log(`FAIL: no entry in the picker is marked active at all (expected ${expectedActiveKey}).`);
				process.exitCode = 1;
			} else {
				console.log(`FAIL: the active entry is at index ${activeIndex} of ${count}, not the top (expected ${expectedActiveKey}).`);
				process.exitCode = 1;
			}
		} finally {
			await playerSession.browser.close();
		}
	} finally {
		await coachSession.browser.close();
	}
}

main().catch((e) => {
	console.error('QA verification failed:', e);
	process.exit(1);
});
