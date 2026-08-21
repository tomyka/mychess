# Lithuanian content translation (Epic 2 of 2)

**Date:** 2026-08-21
**Status:** approved, ready to plan

## Problem

Epic 1 (#112, merged) built the i18n mechanism — Paraglide JS, locale resolution/persistence, and a navbar switcher — but shipped with `messages/lt.json` deliberately duplicating English values as a placeholder. Nothing in the app is actually translated yet. Epic 2 is that translation work: sweeping every route and shared component's hardcoded UI copy, the auth email, and per-page SEO tags into real Lithuanian.

ECO opening-name translation (500 entries in `src/lib/openings/eco-data.ts`) is deliberately **out of scope** here — it's a separate, independent data task with its own spec, agreed during brainstorming because it has no code-sweep overlap with this work.

## Decision

Translate all in-scope surfaces in one pass (not staged by area) — see Scope below. I write both the English and Lithuanian text directly (no external translator, no separate review-and-approve step before merging), matching how Epic 1's opening-name translations were already scoped. Pluralized count strings get full, grammatically-correct Lithuanian plural forms rather than a single simplified form.

Rejected alternatives:
- **Staging by area (player-facing first, coach-facing later)** — rejected; the sweep is mechanical (extract string → message key → `en`/`lt` values → swap call site in) and the switcher already tolerates partial coverage safely (an unswept string just stays hardcoded English), so there's no technical reason to split it into two cycles.
- **External translator / review-before-merge step** — rejected for the same reason Epic 1's opening-name sourcing was: no existing translation resource for this project, and the user opted to ship AI-authored Lithuanian directly.
- **Simplified single plural form** — rejected; reads as broken Lithuanian to a native speaker for many numbers, and Paraglide already supports CLDR-correct plurals for free (see Architecture §3).
- **Per-user localized magic-link email** (switcher on `/login`, locale synced into `auth.users.user_metadata`, single-language template) — rejected as more work than it's worth for one email: `/login` currently hides the navbar entirely (`hideNav` in `+layout.svelte`), so there's no locale signal available at the moment someone requests a sign-in link anyway, and Supabase's behavior for updating an *existing* user's metadata via a fresh OTP request is unverified. A bilingual single template is simpler and correct for every recipient regardless of signed-in state.

## Scope

**In scope:**
- All ~33 route `.svelte` files under `src/routes/` (player pages, coach pages, auth/onboarding pages, settings, tournaments, games) and their `+page.server.ts`/`+layout.server.ts` where they pass user-facing strings (e.g. error messages).
- All ~22 shared components under `src/lib/components/` that render user-facing text.
- SEO tags: the `<title>`/`<meta name="description">` in every page's `<svelte:head>` (26 pages currently have one).
- The magic-link email template (`supabase/templates/magic_link.html`), converted to a single bilingual template (English then Lithuanian).
- Full Lithuanian plural forms (CLDR `one`/`few`/`many`/`other`) for every count+noun string found during the sweep.

**Out of scope:**
- ECO opening-name translations (`src/lib/openings/eco-data.ts`, 500 entries) — separate spec, tracked as its own follow-on.
- Any language beyond English/Lithuanian.
- Adding a language switcher to `/login` or otherwise changing the sign-in flow.
- PWA manifest text (`vite.config.ts`'s `SvelteKitPWA` `manifest` block) — small, static, and read by the OS install prompt rather than in-app navigation; can be picked up trivially in this same pass if convenient, but isn't a hard requirement.

## Architecture

### 1. Message files & key convention

- Continue using the flat `messages/en.json` / `messages/lt.json` set up in Epic 1 (no per-domain file splitting — Paraglide's `pathPattern` supports an array of files for this, but the added maintenance of listing every domain file explicitly in `project.inlang/settings.json` isn't worth it for what will likely be a few hundred keys; a flat JSON file is data, not code, and doesn't carry the same "file grown unwieldy" cost a logic file would).
- Keys are `snake_case`, prefixed by area to keep the flat namespace navigable: `nav_*` (shared nav/layout), `login_*`/`welcome_*`/`join_*` (auth/onboarding), `practice_*`, `learn_*`, `repertoires_*`, `drill_*`, `time_trial_*`, `coaches_*` (player-side coaches page), `settings_*`, `cosmetics_*`, `badges_*`, `tournaments_*`, `games_*`, `coach_*` (coach-side pages), `seo_<page>_title`/`seo_<page>_description` for SEO tags, plus per-component prefixes for shared components used across multiple areas (e.g. `chessboard_*`, `pgn_import_*`).
- Every existing hardcoded UI string in an in-scope file gets extracted to a key, added to both `en.json` (the current English text, verbatim — no wording changes as part of this pass) and `lt.json` (a real Lithuanian translation), then the call site swaps to `m.<key>()`.

### 2. Verified technical risk: Paraglide outside a real request

Confirmed empirically before committing to this design: calling a generated `m.xxx()` function (or `getLocale()`) with no real HTTP request in progress — i.e. exactly what happens in this repo's existing Vitest component tests — does **not** throw and resolves to the `en` base locale, without needing to mock anything. This means as call sites are swept from a hardcoded string to `m.someKey()`, existing tests asserting the exact English text (`getByText(...)`, `getByLabelText(...)`, per this repo's established testing conventions) keep passing unmodified, as long as `en.json`'s value for that key matches the string being replaced verbatim. This was the main risk to the whole approach and it's resolved — no blanket "mock Paraglide in every touched test file" burden.

### 3. Pluralization

For every count+noun string found (e.g. "5 students", "1 move", "3 chapters" — already spotted in `RepertoireDiffReview.svelte`, `coach/+page.svelte`, `drill/+page.svelte`, `badges/+page.svelte`, `learn/+page.svelte`, `settings/+page.svelte`, among others), use the inlang message-format plugin's variant syntax:

```json
"repertoires_assigned_student_count": [
	{
		"declarations": ["input count", "local countPlural = count: plural"],
		"selectors": ["countPlural"],
		"match": {
			"countPlural=one": "{count} student",
			"countPlural=other": "{count} students"
		}
	}
]
```

English only needs `one`/`other`; Lithuanian's entry for the same key needs `one`/`few`/`many`/`other`, each with the grammatically correct noun form. The `plural` formatter uses the runtime's `Intl.PluralRules` for the active locale, so Lithuanian's real CLDR plural categories are computed correctly with no extra code — only the message JSON changes per language.

### 4. SEO tags

Same mechanism as UI copy — each page's `<svelte:head>` `<title>{m.seo_x_title()}</title>` and `<meta name="description" content={m.seo_x_description()} />` swap from hardcoded strings to message keys, translated the same way.

### 5. Magic-link email

Rewrite `supabase/templates/magic_link.html` as a single bilingual template: the existing English content stays as-is, with the same content repeated in Lithuanian directly below it (e.g. separated by a divider), so every recipient sees both regardless of their locale. No changes to `src/lib/auth/client.ts`'s `sendMagicLink` or any other part of the sign-in flow.

### 6. Coverage check

After the sweep, do a manual grep pass (e.g. searching swept files for suspicious literal English text patterns) to catch anything missed — not a new automated test, just a verification step before calling the epic done, since a hardcoded string that's supposed to have been swept is invisible to `npm run check`/`npm run lint` (both are silent about a plain string literal in markup).

## Testing

- No new automated test *type* is introduced — existing component tests continue to assert exact text, now sourced through `m.xxx()` instead of a literal, and keep passing per §2's verified behavior.
- Any newly-added pluralized string gets a quick manual check (or a small test if the surrounding component already has a test file) confirming the Lithuanian plural forms render correctly for representative counts (1, 2, 10, 21 — chosen to hit Lithuanian's `one`/`few`/`many`/`other` boundaries).
- Manual verification: switch to Lithuanian and click through the app's main flows (dashboard, learn, practice, repertoires, settings, a coach's players list) confirming translated text renders and nothing regresses to English unexpectedly.
- `npm run check` / `npm run lint` / `npm test` all still required to be clean, per repo convention.

## Follow-on

ECO opening-name translations (500 entries) get their own spec once this ships.
