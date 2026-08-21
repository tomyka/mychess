# Lithuanian language support — i18n infrastructure (Epic 1 of 2)

**Date:** 2026-08-21
**Status:** implemented (Epic 1 shipped on `worktree-lithuanian-i18n-infra`; corrections below reflect what was actually built, found during task-by-task and final whole-branch review)

## Problem

mychess is English-only. The goal is to add Lithuanian as a second language, with a switcher in the nav bar. This is split into two epics because they're genuinely independent bodies of work:

- **Epic 1 (this spec):** the mechanism — locale detection, persistence, and the switcher UI. Ships with English fully wired and Lithuanian plumbed through but not yet content-complete.
- **Epic 2 (separate spec, follow-on):** translating every existing UI string, the magic-link email, SEO/meta tags, and ECO opening names into Lithuanian. Depends on Epic 1's message-file mechanism existing first.

Framing note: the initial ask described this as being for "young kids in Lithuania." `mychess/CLAUDE.md` documents that kid-focused framing was deliberately dropped project-wide. Per discussion, this feature ships as general i18n for all users — no kid-directed tone or copy — consistent with that decision.

## Decision

Use **Paraglide JS** (`@inlang/paraglide-js`, official inlang/Vite plugin) for compile-time, tree-shaken message functions. Locale is a per-request server-resolved value, persisted via cookie (anonymous) and a `profiles.locale` DB column (signed-in), with **no URL restructuring** — routes stay exactly as they are (`/practice`, not `/lt/practice`).

Rejected alternatives:
- **URL-prefixed locales** (`/lt/practice`) — more SEO-friendly per-language, but requires restructuring every route under a `[lang]` param, a much bigger refactor against the existing `(player)`/`(coach)` route-group structure, for no benefit this product currently needs.
- **svelte-i18n** — runtime ICU-based store lookup; more familiar but no compile-time type safety and unnecessary runtime overhead compared to Paraglide's compiled approach.
- **Hand-rolled dictionary module** — avoids a dependency but reinvents pluralization/type-safety machinery Paraglide already provides for free.
- **`Accept-Language` detection** for first-time visitors — rejected in favor of always defaulting to English, to keep first-load behavior simple and predictable (no server/client mismatch on the very first request).

## Scope

**In scope (Epic 1):**
- Paraglide setup, build integration, message-file scaffolding (`messages/en.json`, `messages/lt.json`).
- Locale resolution precedence and cookie/DB persistence.
- `profiles.locale` migration.
- Navbar language switcher (desktop + mobile), for both signed-in and signed-out states.
- Two languages only: English, Lithuanian. Architecture doesn't preclude adding more later (Paraglide's model is "add a locale file"), but nothing is built speculatively for a third language.

**Out of scope (deferred to Epic 2):**
- Actually translating existing UI copy, the magic-link email template, SEO/meta tags, PWA manifest text, and ECO opening names into Lithuanian.
- Any language beyond English/Lithuanian.

## Architecture

### 1. Message files & library wiring

- Add `@inlang/paraglide-js` and its Vite plugin to `vite.config.ts`.
- `messages/en.json` and `messages/lt.json` at the project root (`mychess/messages/`), flat key namespace (e.g. `nav_practice`, `login_signin_button`, `switcher_language_label`).
- For Epic 1, `lt.json` contains the same keys as `en.json` with English values duplicated (not machine-translated placeholders) — this keeps the app functionally correct in "Lithuanian mode" (no missing-key fallback ambiguity) while leaving real translation entirely to Epic 2.
- Paraglide compiles these into typed `m.someKey()` functions; components import and call them instead of hardcoding strings. Epic 1 only needs to convert the handful of strings the switcher itself introduces — it does **not** sweep existing components (that's Epic 2's job, since it's coupled to actually having translations to put in).

### 2. Locale resolution & persistence

Resolution order, computed once per request in `src/hooks.server.ts`:

1. Signed-in user → `profiles.locale`.
2. Otherwise → `locale` cookie, if present and valid (`'en' | 'lt'`).
3. Otherwise → `'en'`.

The resolved locale is used to set Paraglide's active locale for that request's render (SSR), so there's no client-side flash of the wrong language. **Correction from implementation:** the precedence above isn't a hand-rolled function attached to `event.locals` — it's expressed declaratively as Paraglide's own `strategy` array (`['custom-profileLocale', 'cookie', 'baseLocale']` in `vite.config.ts`), with `custom-profileLocale` registered via `defineCustomServerStrategy` in `hooks.server.ts`, reading the already-memoized `profile.locale` from `safeGetSession()` (no extra DB round trip). This reuses Paraglide's own strategy-resolution machinery instead of duplicating it, and is the reason there's no standalone "resolution precedence" function to unit-test (see Testing, below).

**Switching language:** a small POST action (e.g. `src/routes/api/locale/+server.ts` or a form action on a shared component) that:
- Sets the `locale` cookie (`SameSite=Lax`, long-lived). **Correction from implementation (Task 4 review):** this must be `httpOnly: false`, not `true` — Paraglide's own client-side `setLocale()` writes this cookie directly via `document.cookie`, so client JS needs read/write access to it. Not a security concern; a locale preference isn't sensitive.
- If signed in, also updates `profiles.locale` in the same request.
- Triggers a full navigation/reload so the next SSR render picks up the new locale immediately, rather than relying on client-side reactivity to swap every visible string.

### 3. DB migration

New file `supabase/migrations/0062_profiles_locale.sql` (there's an unmigrated `0061_games.sql` already in the tree — this one is `0062`, applied after it):

```sql
alter table public.profiles
  add column locale text not null default 'en' check (locale in ('en', 'lt'));
```

Per this repo's migration workflow, Claude writes the file; the user applies it manually via the Supabase dashboard SQL editor before the feature can rely on the column existing.

### 4. Navbar switcher

In `src/lib/components/NavBar.svelte`:

- A small text button showing the current locale (`EN` / `LT`), opening a 2-item dropdown (`English` / `Lietuviškai`) — same open/close/overlay interaction pattern already used for the user menu (`userMenuOpen` state, `fixed inset-0` close-overlay).
- **Placement:** immediately to the left of the user-menu button when signed in; immediately to the left of the "Sign in" CTA when signed out. **Correction from implementation:** rather than a separate copy inside the collapsible mobile hamburger menu, a single `<LanguageSwitcher />` sits in the top bar's always-visible "Right side" flex container (not gated by `hidden md:block` the way the user-menu dropdown is) — one instance satisfies "visible at every width" without duplication, confirmed via Playwright screenshots at both desktop and mobile viewports.
- Selecting a language posts to the switch action described above.

## Testing

- Unit test for `isSupportedLocale` (pure logic, colocated `*.test.ts`, following the repo's pure-logic-in-`lib` convention). **Correction from implementation:** there's no separate "resolution precedence" function to test beyond this — precedence is Paraglide's own declarative `strategy` array (see Architecture §2), which is Paraglide's tested code, not this app's; the one piece of actual app logic in the resolution path (`isSupportedLocale`) has its test.
- Component test for the switcher's open/close/select behavior, `jsdom` pragma per existing convention. Also covers the POST-failure fallback path (added after code review flagged that a failed persist can cause a silent revert for signed-in users on reload — see Follow-on).
- Manual verification: done via real Playwright screenshots (desktop + mobile, signed-in + signed-out) plus a zero-cookie fresh-session check confirming the DB-backed strategy resolves correctly on first load — not just eyeballed.

## Follow-on

Epic 2 (content translation) gets its own brainstorm/spec cycle once this ships, and will need to separately resolve: translation source/quality process (machine vs. reviewed), which of the ~29 route files and ~19 shared components get swept and in what order, and — flagged during discussion — that the ECO opening dataset (`src/lib/openings/eco-data.ts`) has on the order of several thousand entries; not all of them have an established Lithuanian name to source online, so Epic 2's spec needs to decide how to handle the long tail (e.g. real Lithuanian names for well-known openings, English fallback for obscure ones) rather than fabricating translations for entries with no real-world Lithuanian usage.

**Known accepted gap (tracked separately, not blocking Epic 1):** because `custom-profileLocale` outranks the cookie for signed-in users, a failed `POST /api/locale` (network blip, RLS hiccup) means the client-side `setLocale()` call still reloads the page, but the reload resolves locale from the unchanged DB value — silently reverting the switch with no indication to the user why. This is now logged server-side (`console.error`) instead of swallowed, and the fallback path has a test, but there's no user-facing feedback. See the tracking issue for a fast-follow (e.g. a toast on POST failure).
