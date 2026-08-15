# Dark/Light Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Light/Dark/System theme toggle to Settings, dark by default for everyone (including existing users), no flash on load, and a dark palette across every page and shared component in one pass.

**Architecture:** A `theme` cookie (`'dark' | 'light' | 'system'`, default `'dark'`) resolved entirely client-side — a blocking inline script in `app.html` sets `<html class="dark">` before first paint, a shared `$state` store (`src/lib/theme.svelte.ts`) keeps the root layout and the Settings toggle in sync, and Tailwind's `@custom-variant dark` plus a set of CSS custom-property tokens (already defined but unused in `src/app.css`) drive every page's actual colors. 36 files get their hardcoded Tailwind color utilities swapped for the token-based equivalents.

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), Tailwind CSS v4 (CSS-first config), vitest.

**Design doc:** `docs/superpowers/specs/2026-08-15-dark-light-theme.md`

---

### Task 1: `src/lib/theme.ts` — pure cookie/theme logic

**Files:**
- Create: `mychess/src/lib/theme.ts`
- Test: `mychess/src/lib/theme.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `mychess/src/lib/theme.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseThemeCookie, resolveTheme, themeCookieString, THEME_COOKIE_NAME } from './theme';

describe('parseThemeCookie', () => {
	it('defaults to dark when the cookie is entirely absent', () => {
		expect(parseThemeCookie('')).toBe('dark');
	});

	it('defaults to dark when other cookies exist but not theme', () => {
		expect(parseThemeCookie('foo=bar; baz=qux')).toBe('dark');
	});

	it('reads an explicit light value', () => {
		expect(parseThemeCookie('theme=light')).toBe('light');
	});

	it('reads an explicit dark value', () => {
		expect(parseThemeCookie('theme=dark')).toBe('dark');
	});

	it('reads an explicit system value', () => {
		expect(parseThemeCookie('theme=system')).toBe('system');
	});

	it('finds theme among other cookies regardless of position', () => {
		expect(parseThemeCookie('foo=bar; theme=light; baz=qux')).toBe('light');
		expect(parseThemeCookie('theme=system; foo=bar')).toBe('system');
	});

	it('defaults to dark for an unrecognized value', () => {
		expect(parseThemeCookie('theme=blue')).toBe('dark');
	});
});

describe('resolveTheme', () => {
	it('resolves system to light when the OS prefers light', () => {
		expect(resolveTheme('system', true)).toBe('light');
	});

	it('resolves system to dark when the OS does not prefer light', () => {
		expect(resolveTheme('system', false)).toBe('dark');
	});

	it('passes dark through unchanged regardless of OS preference', () => {
		expect(resolveTheme('dark', true)).toBe('dark');
		expect(resolveTheme('dark', false)).toBe('dark');
	});

	it('passes light through unchanged regardless of OS preference', () => {
		expect(resolveTheme('light', true)).toBe('light');
		expect(resolveTheme('light', false)).toBe('light');
	});
});

describe('themeCookieString', () => {
	it('includes the cookie name and chosen value', () => {
		expect(themeCookieString('light')).toContain(`${THEME_COOKIE_NAME}=light`);
	});

	it('is root-scoped and long-lived', () => {
		const cookie = themeCookieString('dark');
		expect(cookie).toContain('path=/');
		expect(cookie).toContain('max-age=31536000');
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd mychess
npx vitest run src/lib/theme.test.ts
```

Expected: FAIL — `Cannot find module './theme'`.

- [ ] **Step 3: Write the implementation**

Create `mychess/src/lib/theme.ts`:

```ts
// mychess/src/lib/theme.ts

export type Theme = 'dark' | 'light' | 'system';

export const THEME_COOKIE_NAME = 'theme';

/**
 * Parses a raw cookie string (document.cookie, or a request's Cookie
 * header) for the theme cookie — defaults to 'dark' for anything absent,
 * empty, or holding an unrecognized value, matching this app's
 * dark-by-default policy.
 */
export function parseThemeCookie(cookieString: string): Theme {
	const match = cookieString.match(/(?:^|;\s*)theme=([^;]*)/);
	const value = match?.[1];
	if (value === 'light' || value === 'dark' || value === 'system') return value;
	return 'dark';
}

/** Resolves 'system' against the OS's own light/dark preference; 'dark'/'light' pass through unchanged. */
export function resolveTheme(theme: Theme, prefersLight: boolean): 'dark' | 'light' {
	if (theme === 'system') return prefersLight ? 'light' : 'dark';
	return theme;
}

/** The `document.cookie` assignment string for persisting a theme choice — long-lived (1 year), root-scoped. */
export function themeCookieString(theme: Theme): string {
	const oneYearInSeconds = 60 * 60 * 24 * 365;
	return `${THEME_COOKIE_NAME}=${theme}; path=/; max-age=${oneYearInSeconds}; SameSite=Lax`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd mychess
npx vitest run src/lib/theme.test.ts
```

Expected: PASS, all 15 tests green.

- [ ] **Step 5: Commit**

```bash
cd mychess
git add src/lib/theme.ts src/lib/theme.test.ts
git commit -m "feat: add pure theme cookie parsing/resolution logic"
```

---

### Task 2: `src/lib/theme.svelte.ts` — shared reactive theme state

**Files:**
- Create: `mychess/src/lib/theme.svelte.ts`

- [ ] **Step 1: Write the file**

Create `mychess/src/lib/theme.svelte.ts`:

```ts
// mychess/src/lib/theme.svelte.ts
import { parseThemeCookie, resolveTheme, themeCookieString, type Theme } from './theme';

/**
 * Shared across the whole app — the root layout's live system-preference
 * listener and the Settings page's toggle both read/write this. The single
 * source of truth for the CURRENTLY selected theme option on this page
 * load. Starts at 'dark' (matching the app default) until
 * initThemeFromCookie() runs, which the root layout does immediately —
 * matching the blocking inline script in app.html that already set the
 * initial <html> class from the same cookie, so there's no mismatch
 * between what's already painted and this store's starting value.
 */
export const themeStore = $state<{ current: Theme }>({ current: 'dark' });

export function initThemeFromCookie() {
	themeStore.current = typeof document !== 'undefined' ? parseThemeCookie(document.cookie) : 'dark';
}

export function applyResolvedThemeClass(theme: Theme) {
	if (typeof document === 'undefined') return;
	const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
	document.documentElement.classList.toggle('dark', resolveTheme(theme, prefersLight) === 'dark');
}

/** Persists the choice (cookie), updates the shared store, and applies it immediately — no reload. */
export function setTheme(theme: Theme) {
	themeStore.current = theme;
	if (typeof document !== 'undefined') document.cookie = themeCookieString(theme);
	applyResolvedThemeClass(theme);
}
```

- [ ] **Step 2: Type-check it**

```bash
cd mychess
npm run check 2>&1 | grep -i "theme.svelte"
```

Expected: no output (no errors).

- [ ] **Step 3: Commit**

```bash
cd mychess
git add src/lib/theme.svelte.ts
git commit -m "feat: add shared reactive theme store"
```

---

### Task 3: Tailwind dark-mode wiring + token palette

**Files:**
- Modify: `mychess/src/app.css`

- [ ] **Step 1: Add the custom variant and dark token overrides**

Current `mychess/src/app.css`:

```css
@import 'tailwindcss';
@import 'chessground/assets/chessground.base.css';
@import 'chessground/assets/chessground.brown.css';
@import './lib/board/board-themes.css';
@import './lib/board/pieces.css';
@import 'chessground/assets/chessground.cburnett.css';

:root {
  --color-accent: #4f46e5;
  --color-accent-hover: #4338ca;
  --color-bg: #f9fafb;
  --color-surface: #ffffff;
  --color-border: #e5e7eb;
  --color-text: #111827;
  --color-muted: #6b7280;
}
```

Replace it with:

```css
@import 'tailwindcss';
@import 'chessground/assets/chessground.base.css';
@import 'chessground/assets/chessground.brown.css';
@import './lib/board/board-themes.css';
@import './lib/board/pieces.css';
@import 'chessground/assets/chessground.cburnett.css';

/* Class-based dark mode (Tailwind v4 defaults to prefers-color-scheme only —
   this app needs an explicit user toggle, so dark: variants apply based on
   a `.dark` class on <html> instead, set by app.html's blocking inline
   script and src/lib/theme.svelte.ts). */
@custom-variant dark (&:where(.dark, .dark *));

:root {
  --color-accent: #4f46e5;
  --color-accent-hover: #4338ca;
  --color-bg: #f9fafb;
  --color-surface: #ffffff;
  --color-border: #e5e7eb;
  --color-text: #111827;
  --color-muted: #6b7280;
}

.dark {
  --color-accent: #818cf8;
  --color-accent-hover: #a5b4fc;
  --color-bg: #0a0e14;
  --color-surface: #161b26;
  --color-border: #2a3040;
  --color-text: #e8eaed;
  --color-muted: #8b93a3;
}
```

- [ ] **Step 2: Verify the build still compiles**

```bash
cd mychess
npm run check 2>&1 | tail -5
```

Expected: same error/warning count as before this change (one pre-existing, unrelated error in an untracked WIP file — confirm nothing new).

- [ ] **Step 3: Commit**

```bash
cd mychess
git add src/app.css
git commit -m "feat: wire up Tailwind class-based dark mode and dark token palette"
```

---

### Task 4: `app.html` — no-flash blocking script

**Files:**
- Modify: `mychess/src/app.html`

- [ ] **Step 1: Add the blocking inline script**

Current `mychess/src/app.html`:

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<meta name="text-scale" content="scale" />
		<meta name="theme-color" content="#4f46e5" />
		<link rel="manifest" href="/manifest.json" />
		<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
		<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
		<link rel="apple-touch-icon" href="/icon-192.png" />
		%sveltekit.head%
	</head>
	<body data-sveltekit-preload-data="hover">
		<div style="display: contents">%sveltekit.body%</div>
	</body>
</html>
```

Replace it with:

```html
<!doctype html>
<html lang="en">
	<head>
		<script>
			// Sets the dark class before anything else loads or paints, so there's
			// no flash of the wrong theme — mirrors src/lib/theme.ts's
			// parseThemeCookie/resolveTheme exactly (can't import a module into a
			// blocking inline script, so this is a deliberate, minimal hand-copy;
			// diff it against that file if either ever changes).
			(function () {
				var m = document.cookie.match(/(?:^|;\s*)theme=([^;]*)/);
				var theme = m && (m[1] === 'light' || m[1] === 'dark' || m[1] === 'system') ? m[1] : 'dark';
				var resolved =
					theme === 'system'
						? window.matchMedia('(prefers-color-scheme: light)').matches
							? 'light'
							: 'dark'
						: theme;
				if (resolved === 'dark') document.documentElement.classList.add('dark');
			})();
		</script>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<meta name="text-scale" content="scale" />
		<meta name="theme-color" content="#4f46e5" />
		<link rel="manifest" href="/manifest.json" />
		<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
		<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
		<link rel="apple-touch-icon" href="/icon-192.png" />
		%sveltekit.head%
	</head>
	<body data-sveltekit-preload-data="hover">
		<div style="display: contents">%sveltekit.body%</div>
	</body>
</html>
```

- [ ] **Step 2: Verify the build still compiles**

```bash
cd mychess
npm run check 2>&1 | tail -5
```

Expected: same error/warning count as before.

- [ ] **Step 3: Commit**

```bash
cd mychess
git add src/app.html
git commit -m "feat: add no-flash blocking theme script to app.html"
```

---

### Task 5: Root layout — init store + live system-preference listener

**Files:**
- Modify: `mychess/src/routes/+layout.svelte`

- [ ] **Step 1: Wire in the theme store**

Current `mychess/src/routes/+layout.svelte`:

```svelte
<script lang="ts">
  import '../app.css';
  import { QueryClientProvider, QueryClient } from '@tanstack/svelte-query';
  import NavBar from '$lib/components/NavBar.svelte';
  import { page } from '$app/stores';

  let { children, data } = $props<{ children: any; data: any }>();

  const queryClient = new QueryClient();

  // Do not show nav on standalone auth pages
  const hideNav = $derived(
    ['/login', '/welcome', '/join'].some(p => $page.url.pathname.startsWith(p))
  );
</script>

<svelte:head>
  <title>MyChess</title>
</svelte:head>

<QueryClientProvider client={queryClient}>
  {#if !hideNav}
    <NavBar user={(data as any)?.user} profile={(data as any)?.profile} />
  {/if}
  {@render children()}
</QueryClientProvider>
```

Replace it with:

```svelte
<script lang="ts">
  import '../app.css';
  import { QueryClientProvider, QueryClient } from '@tanstack/svelte-query';
  import NavBar from '$lib/components/NavBar.svelte';
  import { page } from '$app/stores';
  import { initThemeFromCookie, applyResolvedThemeClass, themeStore } from '$lib/theme.svelte';

  let { children, data } = $props<{ children: any; data: any }>();

  const queryClient = new QueryClient();

  // Do not show nav on standalone auth pages
  const hideNav = $derived(
    ['/login', '/welcome', '/join'].some(p => $page.url.pathname.startsWith(p))
  );

  // Safe during SSR too — initThemeFromCookie() itself guards on
  // `typeof document`. On the client this re-reads whatever app.html's
  // blocking script already used, so the store starts in sync with what's
  // already painted.
  initThemeFromCookie();

  // Only relevant while 'system' is the active choice — if the OS's own
  // light/dark setting changes while this tab is open, follow it live
  // instead of requiring a reload.
  $effect(() => {
    if (themeStore.current !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const update = () => applyResolvedThemeClass('system');
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  });
</script>

<svelte:head>
  <title>MyChess</title>
</svelte:head>

<QueryClientProvider client={queryClient}>
  {#if !hideNav}
    <NavBar user={(data as any)?.user} profile={(data as any)?.profile} />
  {/if}
  {@render children()}
</QueryClientProvider>
```

- [ ] **Step 2: Verify the build still compiles**

```bash
cd mychess
npm run check 2>&1 | tail -5
```

Expected: same error/warning count as before.

- [ ] **Step 3: Commit**

```bash
cd mychess
git add src/routes/+layout.svelte
git commit -m "feat: init theme store and live system-preference listener in root layout"
```

---

### Task 6: Settings page — Appearance toggle

**Files:**
- Modify: `mychess/src/routes/settings/+page.svelte`

- [ ] **Step 1: Import the theme store**

Find this line near the top of the `<script>`:

```svelte
  import PlatformRatingsCard from '$lib/components/PlatformRatingsCard.svelte';
```

Add right after it:

```svelte
  import { setTheme, themeStore } from '$lib/theme.svelte';
  import type { Theme } from '$lib/theme';
```

- [ ] **Step 2: Add the Appearance section**

Find the very first `<section>` in the template:

```svelte
    <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h2 class="font-semibold text-gray-900 mb-4">Profile</h2>
```

Insert a new section immediately before it:

```svelte
    <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h2 class="font-semibold text-gray-900 mb-4">Appearance</h2>
      <div class="flex gap-3">
        {#each [{ id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }, { id: 'system', label: 'System' }] as const as t (t.id)}
          <button
            type="button"
            onclick={() => setTheme(t.id as Theme)}
            class="flex-1 py-2.5 px-2 rounded-xl font-semibold transition-all border-2 text-sm
                   {themeStore.current === t.id ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}"
          >
            {t.label}
          </button>
        {/each}
      </div>
    </section>

    <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h2 class="font-semibold text-gray-900 mb-4">Profile</h2>
```

(This new section deliberately uses the same hardcoded light-theme classes as the rest of the file for now — Task 11 sweeps the *entire* settings page, this section included, to the token-based equivalents. Keeping it consistent with its surroundings until then avoids a half-tokenized file mid-implementation.)

- [ ] **Step 3: Verify the build still compiles**

```bash
cd mychess
npm run check 2>&1 | tail -5
```

Expected: same error/warning count as before.

- [ ] **Step 4: Commit**

```bash
cd mychess
git add "src/routes/settings/+page.svelte"
git commit -m "feat: add Light/Dark/System appearance toggle to Settings"
```

---

### Task 7: Settings appearance toggle — tests

**Files:**
- Create: `mychess/src/routes/settings/settings.test.ts`

- [ ] **Step 1: Write the test file**

Create `mychess/src/routes/settings/settings.test.ts`. `+page.svelte` destructures its props as `let { data, form } = $props<{ data: any; form: any }>();` (confirmed in the current file) — pass both:

```ts
// @vitest-environment jsdom
// mychess/src/routes/settings/settings.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import Settings from './+page.svelte';
import { themeStore } from '$lib/theme.svelte';

beforeEach(() => {
	// themeStore is a module-level singleton shared across every test in
	// this file (and every other file importing it in the same process) —
	// reset it explicitly rather than relying on it starting fresh.
	themeStore.current = 'dark';
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	document.cookie = 'theme=; path=/; max-age=0';
	document.documentElement.classList.remove('dark');
});

describe('Settings appearance toggle', () => {
	it('shows Dark as selected by default', () => {
		const { getByText } = render(Settings, { props: { data: {}, form: null } });
		expect(getByText('Dark').className).toContain('border-indigo-600');
	});

	it('switching to Light removes the dark class and persists the cookie', async () => {
		const { getByText } = render(Settings, { props: { data: {}, form: null } });
		await fireEvent.click(getByText('Light'));
		expect(document.documentElement.classList.contains('dark')).toBe(false);
		expect(document.cookie).toContain('theme=light');
	});

	it('switching back to Dark re-adds the dark class and persists the cookie', async () => {
		const { getByText } = render(Settings, { props: { data: {}, form: null } });
		await fireEvent.click(getByText('Light'));
		await fireEvent.click(getByText('Dark'));
		expect(document.documentElement.classList.contains('dark')).toBe(true);
		expect(document.cookie).toContain('theme=dark');
	});

	it('switching to System resolves against the OS preference', async () => {
		vi.stubGlobal('matchMedia', (query: string) => ({
			matches: query.includes('light'), // simulate an OS set to light
			media: query,
			addEventListener: () => {},
			removeEventListener: () => {}
		}));

		const { getByText } = render(Settings, { props: { data: {}, form: null } });
		await fireEvent.click(getByText('System'));
		expect(document.documentElement.classList.contains('dark')).toBe(false);
		expect(document.cookie).toContain('theme=system');
	});
});
```

- [ ] **Step 2: Run the test**

```bash
cd mychess
npx vitest run "src/routes/settings/settings.test.ts"
```

Expected: PASS, all 4 tests green.

- [ ] **Step 3: Commit**

```bash
cd mychess
git add "src/routes/settings/settings.test.ts"
git commit -m "test: cover the Settings appearance toggle"
```

---

### Task 8: Sweep — shared components (16 files)

**Files (modify only, no new files):**
- `mychess/src/lib/components/CoachNoteBanner.svelte`
- `mychess/src/lib/components/EngineEval.svelte`
- `mychess/src/lib/components/FideLookupCard.svelte`
- `mychess/src/lib/components/LichessStatsCard.svelte`
- `mychess/src/lib/components/NavBar.svelte`
- `mychess/src/lib/components/OpeningPicker.svelte`
- `mychess/src/lib/components/PgnImportForm.svelte`
- `mychess/src/lib/components/PlatformRatingsCard.svelte`
- `mychess/src/lib/components/PlayerHeader.svelte`
- `mychess/src/lib/components/QuickActions.svelte`
- `mychess/src/lib/components/RepertoirePracticeRow.svelte`
- `mychess/src/lib/components/StatsRow.svelte`
- `mychess/src/lib/components/VariationPicker.svelte`
- `mychess/src/lib/components/tournaments/TournamentCard.svelte`
- `mychess/src/lib/components/tournaments/TournamentCarousel.svelte`
- `mychess/src/lib/components/tournaments/TournamentFilters.svelte`

- [ ] **Step 1: Apply the token mapping to every file in the list above**

For each file, find every Tailwind color utility class matching the left column below and replace it with the right column's token-based equivalent. These are the exact, complete mapping rules — apply them consistently, do not invent new mappings:

| Find | Replace with |
|---|---|
| `bg-white` | `bg-(--color-surface)` |
| `bg-gray-50` (page/section backgrounds) | `bg-(--color-bg)` |
| `text-gray-900` | `text-(--color-text)` |
| `text-gray-700` | `text-(--color-text)` |
| `text-gray-600` | `text-(--color-muted)` |
| `text-gray-500` | `text-(--color-muted)` |
| `text-gray-400` | `text-(--color-muted)` |
| `border-gray-200` | `border-(--color-border)` |
| `border-gray-300` | `border-(--color-border)` |
| `divide-gray-200` | `divide-(--color-border)` |
| `text-indigo-600` | `text-(--color-accent)` |
| `bg-indigo-600` | `bg-(--color-accent)` |
| `border-indigo-600` | `border-(--color-accent)` |
| `hover:bg-indigo-700` | `hover:bg-(--color-accent-hover)` |
| `hover:text-indigo-700` | `hover:text-(--color-accent-hover)` |
| `bg-indigo-50` (selected/active chip background) | append `dark:bg-indigo-950` (keep the light class, add the dark variant — this one has no direct token since it's a *tinted* background, not a solid one) |
| `placeholder-gray-400` | `placeholder-(--color-muted)` |

Semantic (non-token) colors — append a `dark:` variant one step lighter, keep the existing light class as-is:

| Existing pattern | Add |
|---|---|
| `text-amber-600` | `dark:text-amber-400` |
| `text-green-600` / `text-green-700` | `dark:text-green-400` |
| `bg-green-50 border-green-200 text-green-700` (success banners) | append `dark:bg-green-950 dark:border-green-800 dark:text-green-400` |
| `bg-red-50 border-red-200 text-red-700` (error banners) | append `dark:bg-red-950 dark:border-red-800 dark:text-red-400` |
| `text-red-600` / `text-red-700` (standalone, not a banner) | `dark:text-red-400` |

Do not touch: `ChessBoard.svelte` (not in this sweep — see the design doc's Non-goals), chessground/board-theme CSS, or any color that isn't listed above (if a file has a color pattern not covered by this table, leave it as-is and note it in your report rather than guessing a mapping).

- [ ] **Step 2: Run the full test suite and type check**

```bash
cd mychess
npm test 2>&1 | tail -15
npm run check 2>&1 | tail -10
```

Expected: all tests still pass (swapping class names doesn't change any component's DOM structure, text content, or behavior — every existing test should be unaffected); same error/warning count as before this change.

- [ ] **Step 3: Commit**

```bash
cd mychess
git add src/lib/components/
git commit -m "feat: dark-mode the shared components"
```

---

### Task 9: Sweep — coach pages (7 files)

**Files (modify only):**
- `mychess/src/routes/(coach)/coach/+page.svelte`
- `mychess/src/routes/(coach)/coach/invite/+page.svelte`
- `mychess/src/routes/(coach)/coach/pgn/+page.svelte`
- `mychess/src/routes/(coach)/coach/players/[player_id]/+page.svelte`
- `mychess/src/routes/(coach)/coach/repertoires/+page.svelte`
- `mychess/src/routes/(coach)/coach/reports/+page.svelte`
- `mychess/src/routes/(coach)/coach/students/+page.svelte`

- [ ] **Step 1: Apply the exact same token mapping table from Task 8, Step 1, to every file in this list.**

- [ ] **Step 2: Run the full test suite and type check**

```bash
cd mychess
npm test 2>&1 | tail -15
npm run check 2>&1 | tail -10
```

Expected: all tests pass; same error/warning count as before.

- [ ] **Step 3: Commit**

```bash
cd mychess
git add "src/routes/(coach)/"
git commit -m "feat: dark-mode the coach pages"
```

---

### Task 10: Sweep — player pages (10 files)

**Files (modify only):**
- `mychess/src/routes/(player)/+page.svelte`
- `mychess/src/routes/(player)/badges/+page.svelte`
- `mychess/src/routes/(player)/coaches/+page.svelte`
- `mychess/src/routes/(player)/cosmetics/+page.svelte`
- `mychess/src/routes/(player)/drill/+page.svelte`
- `mychess/src/routes/(player)/practice/+page.svelte`
- `mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte`
- `mychess/src/routes/(player)/repertoires/+page.svelte`
- `mychess/src/routes/(player)/repertoires/new/+page.svelte`
- `mychess/src/routes/(player)/time-trial/+page.svelte`

- [ ] **Step 1: Apply the exact same token mapping table from Task 8, Step 1, to every file in this list.**

For `practice/[repertoire_id]/+page.svelte` specifically: the eval bar/meter (`bg-gray-800` track, `bg-white` fill, inside `EngineEval.svelte` — already covered by Task 8) and the board itself are NOT touched here; only this page's own surrounding chrome (cards, buttons, text) gets the token swap.

- [ ] **Step 2: Run the full test suite and type check**

```bash
cd mychess
npm test 2>&1 | tail -15
npm run check 2>&1 | tail -10
```

Expected: all tests pass; same error/warning count as before.

- [ ] **Step 3: Commit**

```bash
cd mychess
git add "src/routes/(player)/"
git commit -m "feat: dark-mode the player pages"
```

---

### Task 11: Sweep — top-level routes (4 files)

**Files (modify only):**
- `mychess/src/routes/login/+page.svelte`
- `mychess/src/routes/settings/+page.svelte` (including the Appearance section added in Task 6 — sweep it along with the rest of the file, no special-casing)
- `mychess/src/routes/tournaments/+page.svelte`
- `mychess/src/routes/welcome/+page.svelte`

- [ ] **Step 1: Apply the exact same token mapping table from Task 8, Step 1, to every file in this list.**

- [ ] **Step 2: Run the full test suite and type check**

```bash
cd mychess
npm test 2>&1 | tail -15
npm run check 2>&1 | tail -10
```

Expected: all tests pass (including the `settings.test.ts` from Task 7 — the appearance toggle's `border-indigo-600`/`border-gray-200` assertions still match, since the token swap keeps the *selected-state logic* the same, only the color values move to variables); same error/warning count as before.

- [ ] **Step 3: Commit**

```bash
cd mychess
git add src/routes/login/ "src/routes/settings/" src/routes/tournaments/ src/routes/welcome/
git commit -m "feat: dark-mode the remaining top-level routes"
```

---

### Task 12: Manual browser verification + push

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

```bash
cd mychess
npm run dev
```

- [ ] **Step 2: In a browser, confirm:**

- Fresh visit (no cookie, e.g. an incognito window or after clearing site data): the site loads in dark immediately, no flash of light first.
- Settings → Appearance: clicking Light switches instantly (no reload), clicking Dark switches back, clicking System matches your OS's current setting.
- With System selected, changing your OS's light/dark setting while the tab is open updates the site live.
- Spot-check a handful of representative pages in BOTH themes for legibility (no light-on-light or dark-on-dark invisible text, no leftover hardcoded-white boxes on a dark page): the nav bar, `/practice`, a repertoire's practice detail page, `/settings`, `/tournaments`, a coach page if you have a coach account.
- Refresh on each theme — confirm no flash on reload either.

- [ ] **Step 3: Stop the dev server**

```bash
pkill -f "vite dev"
```

- [ ] **Step 4: Push**

```bash
cd mychess
git push origin main
```
