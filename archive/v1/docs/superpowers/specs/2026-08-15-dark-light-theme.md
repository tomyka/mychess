# Dark/light theme

## Problem

MyChess has zero theming support today — every page hardcodes light-mode Tailwind utilities (`bg-white`, `text-gray-900`, `border-gray-200`, etc.) directly, with no dark-mode variants anywhere in the codebase. There's an unused, vestigial token system already sitting in `src/app.css` (`--color-accent`, `--color-bg`, `--color-surface`, `--color-border`, `--color-text`, `--color-muted`) that nothing actually references — a prior attempt at exactly this that was never finished.

## Goals

- A Light / Dark / System control in Settings.
- Dark is the default for anyone who hasn't explicitly chosen a theme — including people who've already used the site before this ships, not just new visitors (there's no way to distinguish the two without adding new tracking, so this is effectively unavoidable).
- No flash of the wrong theme on load, for all three states — including `system`, which needs resolving against the OS's own preference before first paint.
- Every page and shared component gets a dark palette in this same pass — not a partial rollout.
- Chessboard square/piece theming (`src/lib/board/board-themes.css`, the player's own board-theme preference) is untouched — orthogonal to page chrome.

## Non-goals

- No per-component/per-page opt-out — theme is global.
- No new semantic-color token additions beyond what's already informally used (amber/green/red) — those get the same one-step-lighter treatment inline, not a new formal token per color.
- No animated theme-transition effects — an instant swap is fine.
- No admin/coach-specific default override — same three-way choice for every account type.

## Architecture

### Persistence: cookie, not localStorage

A `theme` cookie (`'dark' | 'light' | 'system'`), `path=/`, long-lived, `SameSite=Lax`. Missing cookie is treated identically to `'dark'` — no migration needed, no explicit write-on-first-visit required.

For the no-flash mechanism itself (below), a cookie and `localStorage` would behave identically — both are readable synchronously by a blocking inline script before first paint. Cookie is still the better choice here because it's visible to the *server* too: nothing in this version actually reads it server-side (see below), but it means a future page that needs server-rendered theme-aware content (e.g. an email template, or any page that wants to avoid even the client-side script) can read `locals`/the request cookie directly later, with no migration — `localStorage` would rule that out permanently.

### No server-side involvement needed

Cookies are readable synchronously by client-side JS via `document.cookie` — including on the very first response after a previous visit set one via `Set-Cookie` — so there's no need to thread theme state through SvelteKit's server load chain (`hooks.server.ts`, a root `+layout.server.ts`) at all. The entire no-flash mechanism, for all three states including `'system'`, lives in one place:

- `app.html`: one small **synchronous, blocking inline script**, placed as early as possible in `<head>` — before `%sveltekit.head%`, so it runs before any stylesheet or page content — that:
  1. Reads the `theme` cookie from `document.cookie`, defaulting to `'dark'` if absent or malformed.
  2. If the value is `'system'`, resolves it via `matchMedia('(prefers-color-scheme: light)')` right there (no server guess-then-correct step needed — the resolution happens once, synchronously, before first paint).
  3. Sets `document.documentElement.classList` (`dark`, or nothing for light) accordingly.

  This is the same technique every "no-flash dark mode" implementation uses (Tailwind's own docs recommend it) — a blocking inline script is the only way to act before paint without a server round-trip.

- Root `src/routes/+layout.svelte`: while the resolved theme is `'system'`, registers a `matchMedia('(prefers-color-scheme: light)').addEventListener('change', ...)` listener (via `$effect`) that live-updates the `<html>` class if the OS setting changes while the tab is open. Not blocking, not inline — ordinary component code, since it only matters after the page has already painted once.
- Settings page: reads/writes the same cookie directly (via a tiny shared helper, see below), and updates the live class immediately on change — no reload needed.
- A tiny shared module `src/lib/theme.ts` (pure logic, fully unit-tested) exports the cookie-parsing and system-preference-resolution functions. The blocking inline script in `app.html` can't `import` a module, so it's a deliberately minimal, hand-inlined copy of those same two functions — small enough to visually diff against the tested source at review time (see Testing).

### Tailwind dark-mode wiring

Tailwind v4 (CSS-first config, no `tailwind.config.js`) needs an explicit `@custom-variant` to use class-based (not just OS-preference-based) dark mode:

```css
/* src/app.css */
@custom-variant dark (&:where(.dark, .dark *));
```

Combined with the `.dark` class toggled on `<html>` as above. (This project has no dark-mode Tailwind config at all today — confirmed via `grep` — so this is new, not a change to existing behavior.)

### Token palette

`src/app.css`'s existing (currently unused) tokens get dark overrides, guarded under `.dark`:

```css
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

| Token | Used for | Light | Dark |
|---|---|---|---|
| `--color-bg` | Page background | `#f9fafb` (gray-50) | `#0a0e14` |
| `--color-surface` | Cards, panels, nav bar | `#ffffff` | `#161b26` |
| `--color-border` | Card/input borders | `#e5e7eb` (gray-200) | `#2a3040` |
| `--color-text` | Primary text | `#111827` (gray-900) | `#e8eaed` |
| `--color-muted` | Secondary/tertiary text | `#6b7280` (gray-500) | `#8b93a3` |
| `--color-accent` | Links, primary buttons, active states | `#4f46e5` (indigo-600) | `#818cf8` (indigo-400) |
| `--color-accent-hover` | Hover state of the above | `#4338ca` | `#a5b4fc` (indigo-300) |

Tailwind v4's arbitrary-value syntax consumes these directly as utility classes: `bg-(--color-surface)`, `text-(--color-text)`, `border-(--color-border)`, etc.

Semantic colors (amber-600 hints, green success/positive-eval, red mistakes/errors) aren't tokenized — there are only a handful of usages across the app, and they get a plain `dark:` variant one step lighter (e.g. `text-amber-600 dark:text-amber-400`) inline at each of their few call sites, rather than adding 3 more tokens for something used in 2-3 places each.

### Sweep scope

36 files get their hardcoded Tailwind color utilities swapped for the token-based equivalents:

**Shared components (13):** `CoachNoteBanner`, `EngineEval`, `FideLookupCard`, `LichessStatsCard`, `NavBar`, `OpeningPicker`, `PgnImportForm`, `PlatformRatingsCard`, `PlayerHeader`, `QuickActions`, `RepertoirePracticeRow`, `StatsRow`, `VariationPicker`, plus `tournaments/TournamentCard`, `tournaments/TournamentCarousel`, `tournaments/TournamentFilters`.

**Coach pages (8):** `(coach)/coach/+page`, `coach/invite`, `coach/pgn`, `coach/players/[player_id]`, `coach/repertoires`, `coach/reports`, `coach/students`.

**Player pages (11):** `(player)/+page`, `badges`, `coaches`, `cosmetics`, `drill`, `practice`, `practice/[repertoire_id]`, `repertoires`, `repertoires/new`, `time-trial`.

**Top-level routes (4):** `login`, `settings`, `tournaments`, `welcome`.

`ChessBoard.svelte` itself is NOT in this list (its colors are the board theme, already separately themeable — see Non-goals).

## Testing

- `src/lib/theme.ts` (new, pure logic): cookie-string parsing (`parseThemeCookie(cookieHeader: string): 'dark' | 'light' | 'system'`, defaulting to `'dark'` for anything absent/malformed), and system-preference resolution (`resolveSystemTheme(prefersLight: boolean): 'dark' | 'light'`) — both fully unit-tested, no DOM/browser APIs involved.
- The `app.html` inline script and the Settings page's live-update logic both call into simple enough logic that they're kept intentionally tiny and mirror `theme.ts`'s tested functions exactly (the inline script can't `import` a module, so it's a deliberately minimal, directly-inlined duplicate of the same two functions — small enough to visually diff against the tested source at review time).
- Settings page component test: toggling each of the three options writes the expected cookie value and updates `document.documentElement.classList` immediately.
- No automated visual/screenshot testing of the palette itself — verified manually in a browser (both themes, a handful of representative pages) before considering this done, consistent with how this codebase already treats other visual-only work in this session.

## Rollout

- No migration, no new env vars, no server route changes beyond the two tiny additions above.
- Ships as a single deploy; every visitor without an existing `theme` cookie sees dark immediately on their next request.
