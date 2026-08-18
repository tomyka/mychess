# Google Drive PGN Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a client-side "…or import from Google Drive" option to the repertoire PGN upload form, letting a user pick a file from Google Drive and feed its text into the existing PGN import pipeline.

**Architecture:** A new client-only module, `src/lib/googleDrivePicker.ts`, wraps Google's Identity Services (OAuth token client, `drive.file` scope) and Picker API behind one function, `pickPgnFromGoogleDrive()`, that resolves the picked file's name + text or `null` on cancel. `PgnImportForm.svelte` calls it from a new button and reuses its existing `pgnText`/`name`/`fileName` state — no new server routes, no DB changes, no persisted tokens.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, TypeScript, Vitest, `@testing-library/svelte`. External: Google Identity Services (`accounts.google.com/gsi/client`), Google Picker API (`apis.google.com/js/api.js`), Drive API v3.

**Spec:** `docs/superpowers/specs/2026-08-18-google-drive-pgn-import-design.md`
**Issue:** tomyka/mychess#80

**External setup note (does not block writing/testing this code):** This feature needs two new env vars (`PUBLIC_GOOGLE_CLIENT_ID`, `PUBLIC_GOOGLE_API_KEY`) and Google Cloud Console configuration (enabling the Drive API + Picker API, creating a Picker API key) that only the user can do — see the design spec's "Configuration" section for exact steps. `requireEnv()` only throws when the button is actually clicked, so the app builds, type-checks, and passes its full test suite with zero code changes needed once those are configured — Task 3's manual verification step is the only part that needs them.

---

## Task 1: `googleDrivePicker.ts` module

**Files:**
- Create: `mychess/src/lib/googleDrivePicker.ts`

No test file for this task — per this codebase's convention, a thin wrapper around untyped external
SDK globals (`window.google`, `window.gapi`) and `fetch` isn't unit-tested directly (matching
`src/lib/fide/download.ts`, which wraps `fetch`/an external unzip library the same way). It's
exercised through `PgnImportForm.test.ts`'s mocked-wiring tests (Task 2) and manual verification.

- [ ] **Step 1: Write the module**

```ts
// mychess/src/lib/googleDrivePicker.ts
import { env } from '$env/dynamic/public';
import { requireEnv } from '$lib/env';

// Google's own JS SDKs (Identity Services + the classic gapi loader for
// Picker) ship no first-party TypeScript types, and this repo already
// avoids pulling in a generic OAuth/SDK library for its hand-rolled
// Lichess/Chess.com/Google integrations — `any` here is a deliberate,
// contained exception rather than adding @types/gapi.picker for two globals.
declare global {
	interface Window {
		google?: any;
		gapi?: any;
	}
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const GAPI_SRC = 'https://apis.google.com/js/api.js';
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

function loadScript(src: string): Promise<void> {
	return new Promise((resolve, reject) => {
		if (document.querySelector(`script[src="${src}"]`)) {
			resolve();
			return;
		}
		const script = document.createElement('script');
		script.src = src;
		script.async = true;
		script.onload = () => resolve();
		script.onerror = () => reject(new Error(`Failed to load ${src}`));
		document.head.appendChild(script);
	});
}

async function ensureGoogleSdksLoaded(): Promise<void> {
	if (!window.google?.accounts?.oauth2) {
		await loadScript(GIS_SRC);
	}
	if (!window.gapi?.picker) {
		await loadScript(GAPI_SRC);
		await new Promise<void>((resolve) => window.gapi.load('picker', resolve));
	}
}

function requestAccessToken(clientId: string): Promise<string | null> {
	return new Promise((resolve, reject) => {
		try {
			const tokenClient = window.google.accounts.oauth2.initTokenClient({
				client_id: clientId,
				scope: DRIVE_FILE_SCOPE,
				callback: (response: any) => {
					if (response.error) {
						// Includes the user closing/dismissing the consent popup —
						// treated as a cancel, not a hard failure.
						resolve(null);
						return;
					}
					resolve(response.access_token as string);
				}
			});
			tokenClient.requestAccessToken();
		} catch (err) {
			reject(err instanceof Error ? err : new Error('Failed to start Google sign-in'));
		}
	});
}

function showPicker(token: string, apiKey: string): Promise<{ id: string; name: string } | null> {
	return new Promise((resolve) => {
		const picker = new window.google.picker.PickerBuilder()
			.addView(window.google.picker.ViewId.DOCS)
			.setOAuthToken(token)
			.setDeveloperKey(apiKey)
			.setCallback((data: any) => {
				if (data.action === window.google.picker.Action.PICKED) {
					const doc = data.docs[0];
					resolve({ id: doc.id, name: doc.name });
				} else if (data.action === window.google.picker.Action.CANCEL) {
					resolve(null);
				}
			})
			.build();
		picker.setVisible(true);
	});
}

async function fetchFileText(fileId: string, token: string): Promise<string> {
	const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (!res.ok) throw new Error('Could not download that file from Google Drive.');
	return res.text();
}

/**
 * Opens Google's file picker, scoped to `drive.file` (only files the user
 * explicitly selects here — never standing access to their whole Drive).
 * No token is ever persisted; it lives only for the duration of this call.
 * Resolves `null` on any cancellation (closed consent popup, closed picker
 * without selecting); throws on a real failure (SDK failed to load, the
 * picked file's content failed to fetch).
 */
export async function pickPgnFromGoogleDrive(): Promise<{ name: string; text: string } | null> {
	const clientId = requireEnv(env.PUBLIC_GOOGLE_CLIENT_ID, 'PUBLIC_GOOGLE_CLIENT_ID');
	const apiKey = requireEnv(env.PUBLIC_GOOGLE_API_KEY, 'PUBLIC_GOOGLE_API_KEY');

	await ensureGoogleSdksLoaded();

	const token = await requestAccessToken(clientId);
	if (!token) return null;

	const picked = await showPicker(token, apiKey);
	if (!picked) return null;

	const text = await fetchFileText(picked.id, token);
	return { name: picked.name, text };
}
```

- [ ] **Step 2: Type-check**

Run (from `mychess/`): `npm run check`
Expected: 0 errors. (This file has no dedicated test, so there's no test-run step here — the
`declare global` block and untyped `any` usages are exactly why `npm run check` is the only
verification available for this task alone; Task 2 exercises the module's actual behavior via
mocking.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/googleDrivePicker.ts
git commit -m "feat: add Google Drive file picker for PGN import"
git push
```

---

## Task 2: Wire the picker into `PgnImportForm`

**Files:**
- Modify: `mychess/src/lib/components/PgnImportForm.svelte`
- Test: `mychess/src/lib/components/PgnImportForm.test.ts`

- [ ] **Step 1: Write the failing tests**

In `mychess/src/lib/components/PgnImportForm.test.ts`, add a mock for the new module right after the
existing `$app/navigation` mock (before the `afterEach` block):

```ts
vi.mock('$lib/googleDrivePicker', () => ({ pickPgnFromGoogleDrive: vi.fn() }));
import { pickPgnFromGoogleDrive } from '$lib/googleDrivePicker';
```

Update the existing `afterEach` block from:

```ts
afterEach(() => {
	cleanup();
	gotoMock.mockClear();
	vi.unstubAllGlobals();
});
```

to:

```ts
afterEach(() => {
	cleanup();
	gotoMock.mockClear();
	vi.mocked(pickPgnFromGoogleDrive).mockReset();
	vi.unstubAllGlobals();
});
```

Add these four tests inside the existing `describe('PgnImportForm', ...)` block, right after the
existing `'renders all the expected fields'` test:

```ts
	it('renders the Google Drive import button', () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		expect(screen.getByRole('button', { name: '…or import from Google Drive' })).toBeTruthy();
	});

	it('populates the form from a picked Google Drive file', async () => {
		vi.mocked(pickPgnFromGoogleDrive).mockResolvedValue({ name: 'My Line.pgn', text: '1. e4 e5 *' });
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });

		await fireEvent.click(screen.getByRole('button', { name: '…or import from Google Drive' }));

		await waitFor(() =>
			expect((screen.getByLabelText('Repertoire Name') as HTMLInputElement).value).toBe('My Line')
		);
		expect((screen.getByLabelText('Paste PGN text') as HTMLTextAreaElement).value).toBe('1. e4 e5 *');
	});

	it('does nothing when the Google Drive picker is cancelled', async () => {
		vi.mocked(pickPgnFromGoogleDrive).mockResolvedValue(null);
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });

		await fireEvent.click(screen.getByRole('button', { name: '…or import from Google Drive' }));

		await waitFor(() => expect(pickPgnFromGoogleDrive).toHaveBeenCalled());
		expect((screen.getByLabelText('Paste PGN text') as HTMLTextAreaElement).value).toBe('');
	});

	it('shows an error when the Google Drive picker fails', async () => {
		vi.mocked(pickPgnFromGoogleDrive).mockRejectedValue(new Error('Could not download that file from Google Drive.'));
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });

		await fireEvent.click(screen.getByRole('button', { name: '…or import from Google Drive' }));

		await waitFor(() => expect(screen.getByText('Could not download that file from Google Drive.')).toBeTruthy());
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `mychess/`): `npx vitest run src/lib/components/PgnImportForm.test.ts`
Expected: FAIL — no button with the name "…or import from Google Drive" exists yet.

- [ ] **Step 3: Add the state, handler, and markup**

In `mychess/src/lib/components/PgnImportForm.svelte`, add the import right after the existing one:

```svelte
	import { goto } from '$app/navigation';
	import { planMultiImport } from '$lib/pgn-import';
	import { pickPgnFromGoogleDrive } from '$lib/googleDrivePicker';
```

Add two new state variables right after the existing `fileError`/`fileName` declarations:

```ts
	let fileError = $state('');
	let fileName = $state('');
	let driveError = $state('');
	let drivePicking = $state(false);
```

Add this new handler right after `onFileChange`:

```ts
	async function onGoogleDriveClick() {
		driveError = '';
		drivePicking = true;
		try {
			const result = await pickPgnFromGoogleDrive();
			if (result) {
				pgnText = result.text;
				name = result.name.replace(/\.[^/.]+$/, '');
				fileName = result.name;
			}
		} catch (err) {
			driveError = err instanceof Error ? err.message : 'Could not import from Google Drive.';
		} finally {
			drivePicking = false;
		}
	}
```

Add this new block in the markup, right after the closing `</div>` of the existing "…or upload a
.pgn file" block (i.e. right after its `{#if fileError}...{/if}`, before the `{#if chapters.length > 0}`
block):

```svelte
	<div>
		<div class="flex items-center gap-3">
			<button type="button" onclick={onGoogleDriveClick} disabled={importing || drivePicking}
			        class="cursor-pointer inline-block bg-gray-100 border border-(--color-border) text-(--color-text) px-4 py-2.5 rounded-lg font-medium text-sm hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
				{drivePicking ? 'Opening Google Drive…' : '…or import from Google Drive'}
			</button>
		</div>
		{#if driveError}
			<p class="text-red-600 dark:text-red-400 text-sm mt-1">{driveError}</p>
		{/if}
	</div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/components/PgnImportForm.test.ts`
Expected: PASS (all existing tests + 4 new ones)

- [ ] **Step 5: Type-check**

Run: `npm run check`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/PgnImportForm.svelte src/lib/components/PgnImportForm.test.ts
git commit -m "feat: add Google Drive import button to the PGN upload form"
git push
```

---

## Task 3: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run (from `mychess/`): `npm test`
Expected: all test files pass, no regressions

- [ ] **Step 2: Run the full type/Svelte check**

Run: `npm run check`
Expected: 0 errors

- [ ] **Step 3: Confirm the Google Cloud Console setup (user action, not blocking)**

Ask the user to confirm whether they've done the external setup described in the design spec's
"Configuration" section (enabling the Drive API + Picker API, confirming authorized JS origins,
creating a Picker API key, and setting `PUBLIC_GOOGLE_CLIENT_ID`/`PUBLIC_GOOGLE_API_KEY` in Vercel and
local `.env`). Unlike a database migration, this doesn't block calling the code-complete — the button
renders and the rest of the app works either way; only clicking "…or import from Google Drive" without
these configured will show the "Missing required environment variable" error from `requireEnv()`
(a real production 500, but confined to that one button, not a page crash).

- [ ] **Step 4: Manual sanity check (optional, needs the above configured)**

If the env vars are set: open the repertoire upload page, click "…or import from Google Drive", grant
access when prompted, pick a `.pgn` file from Drive, and confirm the repertoire name and PGN text
fields populate correctly and the form still submits normally. This step is optional and doesn't
block calling the feature done.
