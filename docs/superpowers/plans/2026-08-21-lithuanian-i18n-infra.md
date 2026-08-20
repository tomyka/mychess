# Lithuanian i18n Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the locale mechanism — Paraglide JS build wiring, cookie/DB-backed locale resolution, and a navbar EN/LT switcher — so the app can render in English or Lithuanian, with English fully wired today and Lithuanian ready for Epic 2 to fill in real translations.

**Architecture:** `@inlang/paraglide-js`'s Vite plugin compiles `messages/{locale}.json` into typed message functions under `src/lib/paraglide/`. `src/hooks.server.ts` resolves the active locale per request via a custom Paraglide strategy that reads the already-fetched `profiles.locale` for signed-in users, falling back to a `PARAGLIDE_LOCALE` cookie, then the `en` base locale — no URL restructuring. A new `LanguageSwitcher.svelte` component (embedded in `NavBar.svelte`, left of the login/user control) posts a locale choice to `/api/locale` (which updates `profiles.locale` when signed in) and then calls Paraglide's `setLocale()`, which sets the cookie and reloads.

**Tech Stack:** SvelteKit 2 / Svelte 5, `@inlang/paraglide-js` 2.24.x, Supabase (`profiles.locale` column), Vitest + `@testing-library/svelte`.

Spec: `docs/superpowers/specs/2026-08-21-lithuanian-i18n-infra-design.md`

All commands below run from `mychess/` (the SvelteKit app directory), per this repo's `CLAUDE.md`.

---

### Task 1: Paraglide build setup

**Files:**
- Create: `mychess/project.inlang/settings.json`
- Create: `mychess/messages/en.json`
- Create: `mychess/messages/lt.json`
- Modify: `mychess/package.json`
- Modify: `mychess/vite.config.ts`
- Modify: `mychess/.gitignore`

- [ ] **Step 1: Install the Paraglide compiler**

Run: `npm install --save-dev @inlang/paraglide-js@2.24.1`

Expected: `package.json`'s `devDependencies` gains `"@inlang/paraglide-js": "^2.24.1"` (or whatever caret range `npm install` writes — leave it as npm writes it).

- [ ] **Step 2: Create the inlang project settings**

Create `mychess/project.inlang/settings.json`:

```json
{
	"$schema": "https://inlang.com/schema/project-settings",
	"baseLocale": "en",
	"locales": ["en", "lt"],
	"modules": [
		"https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@4/dist/index.js"
	],
	"plugin.inlang.messageFormat": {
		"pathPattern": "./messages/{locale}.json"
	}
}
```

- [ ] **Step 3: Create the message files**

Create `mychess/messages/en.json`:

```json
{
	"$schema": "https://inlang.com/schema/inlang-message-format",
	"language_switcher_label": "Select language"
}
```

Create `mychess/messages/lt.json` — intentionally identical values for now. Per the spec, Epic 1 ships the mechanism only; real Lithuanian text is Epic 2's job, and a duplicated English value avoids missing-key fallback ambiguity in the meantime:

```json
{
	"$schema": "https://inlang.com/schema/inlang-message-format",
	"language_switcher_label": "Select language"
}
```

- [ ] **Step 4: Wire the Vite plugin**

In `mychess/vite.config.ts`, add the import and plugin entry (no URL-based routing — `strategy` omits `'url'` per the spec's decision against `/lt/...` paths; `custom-profileLocale` is registered in Task 4). Full file, for reference — only the `import` line for `paraglideVitePlugin` and the new `paraglideVitePlugin({...})` entry in `plugins` are new; everything else is unchanged from today:

```ts
import { sveltekit } from '@sveltejs/kit/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			cookieName: 'PARAGLIDE_LOCALE',
			strategy: ['custom-profileLocale', 'cookie', 'baseLocale']
		}),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			workbox: {
				globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
				runtimeCaching: [
					{
						urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/.*/i,
						handler: 'NetworkFirst',
						options: {
							cacheName: 'supabase-api',
							expiration: { maxEntries: 100, maxAgeSeconds: 3600 }
						}
					}
				]
			},
			manifest: {
				name: 'MyChess',
					short_name: 'MyChess',
				description: 'Learn chess openings. Have fun. Level up!',
				theme_color: '#1e293b',
				background_color: '#0f172a',
				display: 'standalone',
				orientation: 'portrait',
				start_url: '/',
				icons: [
					{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
					{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
				]
			}
		})
	],
	test: {
		include: ['src/**/*.test.ts'],
		// Default environment is 'node'; component tests opt into 'jsdom' via a
		// `// @vitest-environment jsdom` pragma comment in the test file itself.
		// (Vitest 4 removed the `environmentMatchGlobs` option that used to be
		// used here for path-based environment switching.)
		environment: 'node',
		setupFiles: ['./src/test-setup.ts'],
		alias: {
			$lib: '/src/lib'
		},
		// jsdom's CSS parsing pulls in @asamuzakjp/css-color, which `require()`s
		// the ESM-only @csstools/css-calc — Node throws ERR_REQUIRE_ESM on any
		// version where require(esm) isn't unflagged yet (Node 20.x before the
		// backport; fine on Node ≥22 without this). Worse, vitest's forks pool
		// swallows a worker's failure to even start as an "unhandled error"
		// rather than a test failure, so `vitest run` exits 0 with the affected
		// files silently missing from the run instead of failing loudly (see
		// GitHub issue #55). Passing this flag to every worker process fixes it
		// on all supported Node versions — it's a harmless no-op where the
		// feature is already stable and unflagged.
		execArgv: ['--experimental-require-module']
	},
	// Under Vitest (any pool), module resolution happens through Vite's SSR
	// pipeline even for jsdom-environment test files, so the "svelte" package
	// would otherwise resolve its server-only build (breaking `mount()` from
	// @testing-library/svelte). Forcing the browser export condition during
	// test runs only (never for the real dev/build) fixes that; see
	// https://svelte.dev/docs/svelte/testing#Vitest.
	resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined
});
```

- [ ] **Step 5: Gitignore the generated output**

In `mychess/.gitignore`, add a new line under the `# Vite` section:

```
# Paraglide (generated)
/src/lib/paraglide
```

- [ ] **Step 6: Generate and verify**

Run: `npm run dev` (let it start, then stop it with Ctrl+C once the terminal shows the local URL — this is just to trigger the Vite plugin's first generation pass)

Expected: `src/lib/paraglide/` now exists on disk containing at least `messages.js`, `runtime.js`, and `server.js`.

- [ ] **Step 7: Commit**

```bash
git add project.inlang messages package.json package-lock.json vite.config.ts .gitignore
git commit -m "feat(i18n): add Paraglide build setup for en/lt messages"
```

---

### Task 2: `isSupportedLocale` pure logic

**Files:**
- Create: `mychess/src/lib/locale.ts`
- Test: `mychess/src/lib/locale.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mychess/src/lib/locale.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isSupportedLocale } from './locale';

describe('isSupportedLocale', () => {
	it('accepts en and lt', () => {
		expect(isSupportedLocale('en')).toBe(true);
		expect(isSupportedLocale('lt')).toBe(true);
	});

	it('rejects anything else', () => {
		expect(isSupportedLocale('fr')).toBe(false);
		expect(isSupportedLocale('')).toBe(false);
		expect(isSupportedLocale(undefined)).toBe(false);
		expect(isSupportedLocale(null)).toBe(false);
		expect(isSupportedLocale(1)).toBe(false);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/locale.test.ts`
Expected: FAIL — `Cannot find module './locale'` (the file doesn't exist yet).

- [ ] **Step 3: Implement**

Create `mychess/src/lib/locale.ts`:

```ts
export type Locale = 'en' | 'lt';

export function isSupportedLocale(value: unknown): value is Locale {
	return value === 'en' || value === 'lt';
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/locale.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/locale.ts src/lib/locale.test.ts
git commit -m "feat(i18n): add isSupportedLocale helper"
```

---

### Task 3: `profiles.locale` migration

**Files:**
- Create: `mychess/supabase/migrations/0062_profiles_locale.sql`

- [ ] **Step 1: Write the migration**

Create `mychess/supabase/migrations/0062_profiles_locale.sql`:

```sql
alter table public.profiles
  add column locale text not null default 'en' check (locale in ('en', 'lt'));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0062_profiles_locale.sql
git commit -m "feat(i18n): add profiles.locale column"
```

- [ ] **Step 3: STOP — hand off to the user**

Paste the migration's contents to the user and ask them to run it in the Supabase dashboard SQL editor now. **Do not proceed to Task 4 or Task 5 until they confirm it's been applied** — both rely on the `locale` column existing on `profiles`. This matches this repo's documented migration workflow (`mychess/CLAUDE.md`): Claude cannot execute DDL directly.

---

### Task 4: Locale resolution in `hooks.server.ts`

**Files:**
- Modify: `mychess/src/hooks.server.ts`
- Modify: `mychess/src/app.html`

**Precondition:** Task 3's migration has been confirmed applied.

- [ ] **Step 1: Rename the existing handle and register the custom strategy**

Rewrite `mychess/src/hooks.server.ts` in full:

```ts
import { createServerClient } from '@supabase/ssr';
import { env } from '$env/dynamic/public';
import { dev } from '$app/environment';
import { getRequestEvent } from '$app/server';
import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { fullNameOrNull, isPlaceholderName } from '$lib/profile';
import { sessionCookieOptions } from '$lib/server/cookies';
import { requireEnv } from '$lib/env';
import { isSupportedLocale } from '$lib/locale';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { cookieName as LOCALE_COOKIE_NAME, defineCustomServerStrategy } from '$lib/paraglide/runtime';

const supabaseHandle: Handle = async ({ event, resolve }) => {
	const PUBLIC_SUPABASE_URL = requireEnv(env.PUBLIC_SUPABASE_URL, 'PUBLIC_SUPABASE_URL');
	const PUBLIC_SUPABASE_ANON_KEY = requireEnv(env.PUBLIC_SUPABASE_ANON_KEY, 'PUBLIC_SUPABASE_ANON_KEY');
	event.locals.supabase = createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
		// @supabase/ssr's own DEFAULT_COOKIE_OPTIONS sets httpOnly: false —
		// without this override it silently beats SvelteKit's httpOnly: true
		// framework default (the caller's options win in cookies.set's merge),
		// leaving the session/refresh-token cookies readable via document.cookie
		// and stealable by any future XSS. Force it back on explicitly.
		cookieOptions: { httpOnly: true, secure: !dev, sameSite: 'lax' },
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (cookies) => {
				const noPersist = event.cookies.get('sb-no-persist') === '1';
				cookies.forEach(({ name, value, options }) =>
					event.cookies.set(name, value, sessionCookieOptions({ ...options, path: '/' }, noPersist))
				);
			}
		}
	});

	async function computeSession() {
		const {
			data: { session }
		} = await event.locals.supabase.auth.getSession();

		// No eager anonymous session — public pages are viewable without any session.
		if (!session) return { session: null, user: null, profile: null, isSignedOut: true };

		const { data: profile } = await event.locals.supabase
			.from('profiles')
			.select('*')
			.eq('id', session.user.id)
			.single();

		let resolvedProfile = profile;

		// Backfill display_name for an account that never set one. Once first/last
		// name exist, adopt them.
		if (resolvedProfile && isPlaceholderName((resolvedProfile as any).display_name)) {
			const displayName = fullNameOrNull(
				(resolvedProfile as any).first_name,
				(resolvedProfile as any).last_name
			);
			if (displayName) {
				await event.locals.supabase
					.from('profiles')
					.update({ display_name: displayName } as any)
					.eq('id', session.user.id);
				resolvedProfile = { ...(resolvedProfile as any), display_name: displayName };
			}
		}

		// A session now means a real account, full stop — anonymous auth is
		// retired: the code path that minted guests went in #88, the 3,811 rows it
		// left were purged in #90, and the Supabase provider itself is disabled,
		// so nothing can present an anonymous session any more.
		return { session, user: session.user, profile: resolvedProfile, isSignedOut: false };
	}

	// Every layout in a route's tree runs its `load` on each navigation, and
	// most pages' own `load`/actions call this again via requireAccount/
	// requireApiUser — for a typical (player) page that's 3+ independent
	// calls per single page view. Without caching, each one redoes the full
	// auth+profile round trip, multiplying Supabase round trips 3x-4x on
	// every single page load across the whole app. Memoize per-request (this
	// `handle` call, and therefore `sessionPromise`, is fresh per request) so
	// every call after the first reuses the same in-flight/resolved promise.
	let sessionPromise: ReturnType<typeof computeSession> | undefined;
	event.locals.safeGetSession = () => (sessionPromise ??= computeSession());

	return resolve(event);
};

// Reuses the request's already-memoized session/profile lookup (safeGetSession)
// instead of a second DB round trip — this strategy costs nothing extra on top
// of what every page already does.
defineCustomServerStrategy('custom-profileLocale', {
	getLocale: async () => {
		const event = getRequestEvent();
		const { profile } = await event.locals.safeGetSession();
		const locale = (profile as any)?.locale;
		return isSupportedLocale(locale) ? locale : undefined;
	}
});

const paraglideHandle: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, async ({ request: localizedRequest, locale }) => {
		event.request = localizedRequest;

		// Keep the cookie in sync with the DB-backed preference so a future
		// request (or a signed-out visit right after signing out) doesn't need
		// custom-profileLocale to re-resolve it.
		const { user } = await event.locals.safeGetSession();
		if (user && event.cookies.get(LOCALE_COOKIE_NAME) !== locale) {
			event.cookies.set(LOCALE_COOKIE_NAME, locale, {
				path: '/',
				httpOnly: false, // Paraglide's client runtime reads/writes this cookie directly
				sameSite: 'lax',
				maxAge: 60 * 60 * 24 * 400
			});
		}

		return resolve(event, {
			filterSerializedResponseHeaders: (name) =>
				name === 'content-range' || name === 'x-supabase-api-version',
			transformPageChunk: ({ html }) => html.replace('%paraglide.lang%', locale)
		});
	});

export const handle = sequence(supabaseHandle, paraglideHandle);
```

- [ ] **Step 2: Point `app.html`'s `lang` attribute at Paraglide**

In `mychess/src/app.html`, change:

```html
<html lang="en">
```

to:

```html
<html lang="%paraglide.lang%">
```

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: 0 errors. (If `$app/server`'s `getRequestEvent` or `$lib/paraglide/*` don't resolve, re-run `npm run dev` briefly first so `svelte-kit sync` and the Paraglide plugin regenerate their output, then re-run `npm run check`.)

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`, visit the app in a browser, open dev tools' Application/Storage tab, and confirm a `PARAGLIDE_LOCALE` cookie appears after the first request (value `en`). Confirm the page still loads normally (session-gated pages, sign-in, etc. all still work — this task didn't change any auth behavior, only restructured it into `sequence()`).

- [ ] **Step 5: Commit**

```bash
git add src/hooks.server.ts src/app.html
git commit -m "feat(i18n): resolve request locale via profile, cookie, then base locale"
```

---

### Task 5: `/api/locale` endpoint

**Files:**
- Create: `mychess/src/routes/api/locale/+server.ts`

**Precondition:** Task 3's migration has been confirmed applied.

- [ ] **Step 1: Implement the endpoint**

Create `mychess/src/routes/api/locale/+server.ts`:

```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isSupportedLocale } from '$lib/locale';

export const POST: RequestHandler = async ({ request, locals }) => {
  const body = await request.json().catch(() => null);
  const locale = (body as { locale?: unknown } | null)?.locale;

  if (!isSupportedLocale(locale)) throw error(400, 'Unsupported locale');

  const { user } = await locals.safeGetSession();
  if (user) {
    const { error: dbError } = await locals.supabase
      .from('profiles')
      .update({ locale } as any)
      .eq('id', user.id);
    if (dbError) throw error(500, dbError.message);
  }

  return json({ ok: true });
};
```

Signed-out callers reach the same 200 response with no DB write — the switcher (Task 6) doesn't need to know whether anyone's signed in.

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 3: Manual verification**

With `npm run dev` running and signed in as a test account, run:

```bash
curl -i -X POST http://localhost:5173/api/locale \
  -H 'content-type: application/json' \
  -b "<paste your sb-access-token/sb-refresh-token cookies from dev tools here>" \
  -d '{"locale":"lt"}'
```

Expected: `200 {"ok":true}`, and the account's `profiles.locale` row now reads `lt` (check via the Supabase dashboard or the service-role key per `mychess/CLAUDE.md`'s Database section).

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/locale/+server.ts
git commit -m "feat(i18n): add POST /api/locale to persist locale preference"
```

---

### Task 6: `LanguageSwitcher` component

**Files:**
- Create: `mychess/src/lib/components/LanguageSwitcher.svelte`
- Test: `mychess/src/lib/components/LanguageSwitcher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mychess/src/lib/components/LanguageSwitcher.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/paraglide/runtime', () => ({
  getLocale: vi.fn(() => 'en'),
  setLocale: vi.fn()
}));
vi.mock('$lib/paraglide/messages', () => ({
  m: { language_switcher_label: () => 'Select language' }
}));

import { setLocale } from '$lib/paraglide/runtime';
import LanguageSwitcher from './LanguageSwitcher.svelte';

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true })) as any;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LanguageSwitcher', () => {
  it('shows the current locale code as the trigger label', () => {
    render(LanguageSwitcher);
    expect(screen.getByRole('button', { name: /select language/i })).toHaveTextContent('en');
  });

  it('opens a dropdown listing both languages', async () => {
    render(LanguageSwitcher);
    await fireEvent.click(screen.getByRole('button', { name: /select language/i }));
    expect(screen.getByText('English')).toBeTruthy();
    expect(screen.getByText('Lietuviškai')).toBeTruthy();
  });

  it('posts the choice and switches locale when a different language is selected', async () => {
    render(LanguageSwitcher);
    await fireEvent.click(screen.getByRole('button', { name: /select language/i }));
    await fireEvent.click(screen.getByText('Lietuviškai'));

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/locale',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ locale: 'lt' }) })
    );
    expect(setLocale).toHaveBeenCalledWith('lt');
  });

  it('does nothing when selecting the already-active language', async () => {
    render(LanguageSwitcher);
    await fireEvent.click(screen.getByRole('button', { name: /select language/i }));
    await fireEvent.click(screen.getByText('English'));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(setLocale).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/components/LanguageSwitcher.test.ts`
Expected: FAIL — `Cannot find module './LanguageSwitcher.svelte'`.

- [ ] **Step 3: Implement the component**

Create `mychess/src/lib/components/LanguageSwitcher.svelte`:

```svelte
<script lang="ts">
  import { getLocale, setLocale } from '$lib/paraglide/runtime';
  import { m } from '$lib/paraglide/messages';

  const LANGUAGES = [
    { code: 'en', label: 'English' },
    { code: 'lt', label: 'Lietuviškai' }
  ] as const;

  let open = $state(false);
  const current = LANGUAGES.find((l) => l.code === getLocale()) ?? LANGUAGES[0];

  async function select(code: 'en' | 'lt') {
    open = false;
    if (code === getLocale()) return;

    try {
      await fetch('/api/locale', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: code })
      });
    } catch {
      // Persisting the preference is best-effort — still switch the active
      // locale client-side even if the request fails.
    }

    setLocale(code);
  }
</script>

<div class="relative">
  <button
    onclick={() => { open = !open; }}
    aria-label={m.language_switcher_label()}
    class="text-(--color-muted) hover:text-gray-900 dark:hover:text-gray-200 font-medium text-sm uppercase"
  >
    {current.code}
  </button>

  {#if open}
    <button
      class="fixed inset-0 z-10"
      aria-label="Close menu"
      onclick={() => { open = false; }}
    ></button>
    <div class="absolute right-0 mt-2 w-36 bg-(--color-surface) border border-(--color-border) rounded-xl shadow-lg z-20 py-1 text-sm">
      {#each LANGUAGES as lang (lang.code)}
        <button
          onclick={() => select(lang.code)}
          class="block w-full text-left px-4 py-2 text-(--color-text) hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          {lang.label}
        </button>
      {/each}
    </div>
  {/if}
</div>
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/components/LanguageSwitcher.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/LanguageSwitcher.svelte src/lib/components/LanguageSwitcher.test.ts
git commit -m "feat(i18n): add LanguageSwitcher component"
```

---

### Task 7: Wire the switcher into `NavBar`

**Files:**
- Modify: `mychess/src/lib/components/NavBar.svelte`

- [ ] **Step 1: Import the component and place it left of the login/user control**

In `mychess/src/lib/components/NavBar.svelte`, add the import at the top of the `<script>` block:

```ts
  import LanguageSwitcher from './LanguageSwitcher.svelte';
```

Then in the "Right side" block, insert `<LanguageSwitcher />` immediately before the sign-in CTA and immediately before the user dropdown (i.e. left of whichever one renders), leaving the streak badge and hamburger untouched:

```svelte
    <!-- Right side -->
    <div class="flex items-center gap-3 text-sm shrink-0">
      {#if isSignedOut}
        <LanguageSwitcher />
        <a href="/login"
           class="bg-(--color-accent) text-white px-3 py-1.5 rounded-lg font-medium hover:bg-(--color-accent-hover) transition-colors">
          Sign in
        </a>
      {:else}
        <!-- Streak badge (player only) -->
        {#if !isCoach && (profile as any)?.streak_days > 0}
          <span class="text-orange-500 font-medium text-sm hidden sm:inline">
            🔥 {(profile as any).streak_days}
          </span>
        {/if}

        <LanguageSwitcher />

        <!-- User dropdown (desktop) -->
        <div class="relative hidden md:block">
```

(Everything else in the file — the mobile menu panel, the hamburger button, the rest of the dropdown — is unchanged. `LanguageSwitcher` is not `hidden md:block`, so it's visible in the top bar at every width, satisfying "present on mobile too" without a second instance inside the slide-down panel.)

- [ ] **Step 2: Type-check and lint**

Run: `npm run check && npm run lint`
Expected: 0 errors from either.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`. Visit the app signed out — confirm the `EN` button appears left of "Sign in", at both a desktop and a narrow (mobile-width) viewport. Sign in — confirm it appears left of the user-menu button, at both widths. Click it, confirm the dropdown lists "English" and "Lietuviškai". Select "Lietuviškai" — confirm the page reloads, a `PARAGLIDE_LOCALE=lt` cookie is set, and the button now reads `LT`. Reload again — confirm it stays `LT`. If signed in, confirm `profiles.locale` is now `lt` for that account (service-role query, per `mychess/CLAUDE.md`).

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/NavBar.svelte
git commit -m "feat(i18n): show LanguageSwitcher in the navbar"
```

---

### Task 8: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the new `locale.test.ts` and `LanguageSwitcher.test.ts`.

- [ ] **Step 2: Run type-check and lint**

Run: `npm run check && npm run lint`
Expected: 0 errors from either (per `mychess/CLAUDE.md`, both are required to be clean before pushing to `main`).

- [ ] **Step 3: Cross-device persistence check**

Signed in as a test account with `profiles.locale = 'lt'` (set via Task 7's manual check), clear cookies for the site (or open a fresh private/incognito window) and sign in again. Confirm the page renders with the `LT` switcher state on the very first load — i.e. `custom-profileLocale` picked up the DB value even with no cookie present yet.

- [ ] **Step 4: Clean up any test account**

If a throwaway account was created for this verification, delete it via the service-role key per `mychess/CLAUDE.md`'s workflow notes, and say what was deleted.

- [ ] **Step 5: Push**

```bash
git push
```

---

## Notes for Epic 2

Epic 2 (content translation, a separate spec) will add real Lithuanian strings to `messages/lt.json`, sweep existing components' hardcoded copy into `m.xxx()` calls, translate the magic-link email template and SEO/meta tags, and resolve Lithuanian names for ECO opening data — none of that is in scope here.
