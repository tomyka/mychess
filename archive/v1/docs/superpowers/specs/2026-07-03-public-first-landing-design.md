# Public-First Landing & Navigation — Design Spec

**Date:** 2026-07-03
**Status:** Approved for planning
**Sub-project:** #1 of the platform evolution (rename #0 done; auth #2 and roles #3 follow).

## Problem

Visiting `/` shows a login/registration screen instead of content. Cause: `(player)/+layout.server.ts` hard-redirects `no session → /login`, and `hooks.server.ts` eagerly creates an anonymous session for every visitor (fragile — fails/redirects when Supabase anonymous auth is off). The dashboard page itself already has a guest-landing branch and the NavBar already shows "Sign in / Get started", but the layout guard prevents guests from ever reaching them.

## Goals

- `/` is **publicly viewable with real content** — no login wall, no forced anonymous session.
- Guests see a content landing: FIDE rank lookup, upcoming Lithuania tournaments, and a "try a drill" entry.
- Logged-in players still see their personal dashboard at `/`.
- Guests can **try training** via a **lazy** anonymous session (created only when they start a drill), with a "sign in to save" nudge.
- Personal areas (repertoires, settings, cosmetics, badges) require a real account.
- Auth lives in the top-right nav (already there); no page is a dead-end sign-up screen.

## Non-goals

- Auth method changes (Google / magic link / keep-signed-in) — that's sub-project #2.
- Role/permission redesign beyond the guest/player/coach split that already exists — sub-project #3.
- Persisting guest training progress across sessions (it lives on the throwaway anonymous session).

## Prerequisite (user, one-time)

Enable **Anonymous sign-ins** in Supabase → Authentication → Sign In / Providers. Without it, the public landing still works fully; only "try a drill" as a guest degrades to a "sign in to train" prompt (handled gracefully — no crash).

## Architecture

### Session model change (`hooks.server.ts`)
`safeGetSession` **stops eagerly creating** an anonymous session. It returns `{ session: null, user: null, profile: null }` when there is no session — a pure read, no side effects on public GETs. The existing guest-profile-creation block (insert profile + `player_stats` + `equipped_cosmetics` when `session.user.is_anonymous` and no profile) is **extracted** into a reusable function so the lazy path can call it. The display-name backfill logic is unchanged.

### New server auth helpers (`src/lib/server/auth.ts`)
- `ensureGuestSession(event)` → if a session already exists, return it; otherwise call `supabase.auth.signInAnonymously()` and, on success, ensure the guest profile rows exist (reusing the extracted helper). Returns the resolved `{ session, user, profile }`, or `null` if anonymous sign-in is unavailable (provider disabled / error). Never throws.
- `requireAccount(event)` → `safeGetSession()`; if `!user || user.is_anonymous`, `throw redirect(303, '/login')`. Returns `{ session, user, profile }` for a real account. Used to gate personal routes.

### Routing guard (`(player)/+layout.server.ts`)
Replace the three hard redirects with:
- `user && !user.is_anonymous && !profile` → `redirect('/welcome')` (a real signup that hasn't picked a role/name yet).
- `profile?.role === 'coach'` → `redirect('/coach')`.
- Otherwise **return the (possibly null) session/profile** — guests (no session), anonymous, and players all pass through.

The `/login` wall is gone.

### Public dashboard (`(player)/+page.server.ts` + `+page.svelte`)
Load always returns `upcomingTournaments` (already does). When there's no real player profile → `isGuest: true` and the page renders the **content landing**; when a logged-in player → the existing personal dashboard. The load also handles the FIDE lookup: if `url.searchParams.get('fide')` is set, query `fide_players` by that id (public-read RLS already allows it) and return `fideLookup` (rating + country/age-group rank, or a "not found" flag).

Guest landing blocks (`+page.svelte`, `isGuest` branch — enrich the current thin hero):
1. Compact hero: tagline + primary CTAs ("Get started", "Browse tournaments").
2. **FIDE rank lookup** — `FideLookupCard` (new component): FIDE ID input, submits as `?fide=<id>` (GET, no account); shows the looked-up player's standard rating + national rank, or "not found".
3. **Upcoming tournaments in Lithuania** — existing `TournamentCarousel`.
4. **"Try a drill"** card → links to the training entry; copy: "No account needed — sign in later to save your progress."

### Guest training (lazy anonymous session)
The "Try a drill" CTA points at the training entry route (e.g. `/drill`). Each training route's server load (`(player)/{drill,practice,time-trial,learn}/+page.server.ts`) calls `ensureGuestSession(event)` at the top:
- returns a session (existing or freshly anonymous) → training proceeds DB-backed as today.
- returns `null` (anonymous auth disabled) → the load returns a `needsAccount: true` flag and the page shows a "Sign in to train" panel instead of the board.
"Sign in to save progress" nudge is shown whenever the current user `is_anonymous`.

### Gated personal routes
`(player)/{repertoires,settings,cosmetics,badges}/+page.server.ts` (and the settings action) call `requireAccount(event)` — anonymous or session-less users are redirected to `/login`. (These pages are meaningless without a real account.)

## New / changed files

| File | Change |
|---|---|
| `src/hooks.server.ts` | Stop eager anon session; extract `ensureGuestProfile` helper; `safeGetSession` returns null cleanly |
| `src/lib/server/auth.ts` | **New** — `ensureGuestSession`, `requireAccount` |
| `src/routes/(player)/+layout.server.ts` | Remove login wall; keep welcome/coach redirects only |
| `src/routes/(player)/+page.server.ts` | Public tournaments + FIDE lookup by `?fide=`; personal data only when logged-in |
| `src/routes/(player)/+page.svelte` | Enriched guest landing (hero + lookup + tournaments + try-a-drill) |
| `src/lib/components/FideLookupCard.svelte` | **New** — public FIDE ID → rating/rank lookup |
| `src/routes/(player)/{drill,practice,time-trial,learn}/+page.server.ts` | `ensureGuestSession`; `needsAccount` fallback |
| `src/routes/(player)/{repertoires,settings,cosmetics,badges}/+page.server.ts` | `requireAccount` gate |

## Error handling

- Anonymous sign-in disabled/errors → `ensureGuestSession` returns `null`; training shows "Sign in to train"; public pages unaffected.
- FIDE lookup: invalid/blank id → no query; id not in `fide_players` → "No FIDE record found" message (not an error).
- A real DB error on the FIDE lookup is logged (matches existing pattern) and shown as "lookup unavailable".

## Testing

- **`FideLookupCard.test.ts`** (jsdom): renders the input; shows rating + rank when a `result` prop is present; shows "not found" when the lookup returned null.
- **`requireAccount` unit test**: with a mock `event` whose `safeGetSession` returns an anonymous user → throws a redirect to `/login`; with a real user → returns the data. (`ensureGuestSession` is IO-bound on Supabase → covered by manual smoke, not unit-tested.)
- **Manual smoke:** (a) logged-out `/` shows content, no redirect; (b) FIDE lookup returns a known LTU player's rank; (c) "Try a drill" starts a drill as a guest (with anon auth on) and shows "sign in to save"; (d) `/repertoires` while logged-out redirects to `/login`; (e) logged-in player still sees the personal dashboard; (f) a coach hitting `/` lands on `/coach`.

## Risks

- **Removing the eager anon session** touches the app's core session assumption. Every route that assumed a session always exists must tolerate `null` — the layout guard and page loads are audited for this (the personal routes now gate explicitly; public/training handle null).
- **Anonymous auth toggle** is an external Supabase setting; the design degrades gracefully if it's off, so the landing is never blocked on it.
