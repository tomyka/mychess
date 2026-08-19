# Remove anonymous guest auth

**Date:** 2026-08-19
**Status:** approved, ready to plan

## Problem

Production accumulated a large number of anonymous `auth.users` rows. The cause is that `ensureGuestSession()` is called from the **`load` function** of two routes:

- `src/routes/(player)/drill/+page.server.ts:5`
- `src/routes/(player)/time-trial/+page.server.ts:5`

A SvelteKit `load` runs on every GET. No user gesture is required, so a full anonymous account is minted by any crawler, any link-unfurl bot (Slack/WhatsApp/Discord), any uptime check, and every incognito or cleared-cookie visit. `static/robots.txt` currently reads `Disallow:` with an empty value — everything is crawlable, so search engines are actively invited to mint accounts.

Each mint writes **four rows**: `auth.users`, plus `profiles`, `player_stats`, and `equipped_cosmetics` from `ensureGuestProfile` (`src/lib/server/guest.ts:5-17`). Nothing ever deletes them.

The account is also useless at the moment of creation. A brand-new guest owns no repertoires, so both loads immediately hit `repIds.length === 0` and return an empty move list. The row exists solely to render an empty page.

### The same bug is also a broken feature

Every write path already refuses guests. `api/import/*`, `api/repertoires/*`, `api/drill`, and `api/time-trial` all call `requireApiUser` (`src/lib/server/auth.ts:16-20`), which throws 401 when there is no session. None of them mint.

So the two `load` functions are the only minting sites in the codebase, and guest mode only appears to work if a visitor happens to land on `/drill` or `/time-trial` first and picks up a cookie. Arriving at `/repertoires` first yields 401s instead. Try-before-signup was never coherently wired.

## Decision

Remove anonymous authentication entirely. Guests get read-only access to public pages; anything DB-backed requires a real account.

Rationale:

1. **The payoff is structurally weak in this product.** Every meaningful surface needs the user's own repertoire, imported from Lichess, Chess.com, or Google Drive. There is nothing to try before signing up, so guest mode saves a click nobody is bouncing on.
2. **Acquisition is invite-based, not drive-by.** The coach role, `assigned_repertoires`, and `/join/[token]` mean new players arrive through a coach's invite and need a real account to be assigned anything.
3. **It kills the bug by construction.** Relocating the mint (to a click, or to first write) would leave "never mint on GET" as a rule future routes must keep obeying. Deleting the capability means no `signInAnonymously` call exists to misuse.
4. **It removes code instead of adding it.** The alternative required a mint-on-write helper, a reaper cron, and a retention policy to tune.

Rejected alternatives: mint-on-first-write plus a reaper cron (keeps the footgun and adds machinery); ephemeral client-only trial with sample content (real value, but new work and a separate concern from the leak).

## Scope of gating

`(player)/+layout.server.ts` waves everyone through today, including no-session visitors. Gating stays **per-page**, and `/` stays public:

| Route | Current guard | After |
| --- | --- | --- |
| `(player)/+page.server.ts` (`/`) | `safeGetSession`, public | unchanged — stays public |
| `badges` | `requireAccount` | unchanged |
| `coaches` | `requireAccount` | unchanged |
| `cosmetics` | `requireAccount` | unchanged |
| `practice` | `requireAccount` | unchanged |
| `repertoires` | `requireAccount` | unchanged |
| `drill` | `ensureGuestSession` | **`requireAccount`** |
| `time-trial` | `ensureGuestSession` | **`requireAccount`** |

Five of seven sub-pages already guard correctly. This is a two-file change, not a sweep. Gating the whole group in the layout was rejected because `/` lives inside `(player)`, so it would bounce mychess.lt straight to `/login` with no landing page to fall back on.

## Changes

### 1. Remove the minting capability

- Delete `ensureGuestSession` from `src/lib/server/auth.ts` (currently lines 34-49, plus its docstring at 22-33).
- Delete `src/lib/server/guest.ts` entirely.
- Remove the `ensureGuestProfile` import and its call in `src/hooks.server.ts` (line 6 import, line 47 call), along with the "A lazily-created anonymous session may not have its guest profile yet" branch.
- Delete the `describe('ensureGuestSession')` block and the `vi.mock('./guest', ...)` line in `src/lib/server/auth.test.ts`.

Post-condition: `grep -rn "signInAnonymously" src/` returns nothing.

### 2. Gate the two ungated pages

In both `drill/+page.server.ts` and `time-trial/+page.server.ts`:

- Replace `ensureGuestSession(locals)` with `requireAccount(locals)`, following the pattern in the five already-guarded siblings.
- Delete the `if (!guest) return { needsAccount: true }` and `if (!user) return { needsAccount: true }` early returns.
- Per CLAUDE.md, call sites use `user!.id` after `requireAccount` because TypeScript cannot narrow its return type. This is the established convention, not a defect.

In the matching components, delete the now-unreachable signed-out markup. **These are not standalone blocks — they are `{#if} / {:else}` wrappers around the entire page body.** Removing four lines and stopping would leave a dangling `{:else}` and fail the build. Each file needs three separate edits:

| File | Delete | Also delete | And delete |
| --- | --- | --- | --- |
| `drill/+page.svelte` (146 lines) | `{#if data.needsAccount}` + the 4-line `<div>` (lines 74-79) | the `{:else}` at line 80 | the closing `{/if}` on the final line |
| `time-trial/+page.svelte` (156 lines) | same, lines 83-88 | the `{:else}` at line 89 | the closing `{/if}` on the final line |

The page body between them stays, and de-indents by one level if the implementer chooses to reflow it (optional — not worth a noisy diff).

Both deleted blocks contain a `Get started` link pointing at `/login?signup=1`. That query param is inert — no route reads a `signup` param and `/login` has no `+page.server.ts` — so it dies with the blocks. The `allMoves.length === 0` empty states stay; a signed-in player with no repertoires still needs them.

### 3. Rename `isGuest` to `isSignedOut`

`isGuest` currently means "no session **or** anonymous session". With anonymous sessions gone it means only "no session", so the name misleads. Rename, and redefine as `!user`:

- `src/app.d.ts` — the field appears **twice**, in `Locals.safeGetSession`'s return type (line 11) and in `PageData` (line 17). Both are currently optional (`isGuest?: boolean`). Make the renamed field **required** (`isSignedOut: boolean`) in both, so every branch is forced to state it rather than leaning on `undefined` being falsy.
- `src/hooks.server.ts` — `isGuest: !!session.user.is_anonymous` becomes `isSignedOut: false` in the session branch. The no-session early return at line 37 currently omits the field entirely — legal today only because it is optional — and must now set `isSignedOut: true`. Making the field required is what forces this second site to be found; leaving it optional would let it slip through silently.
- `src/routes/(player)/+page.server.ts:11` — `!user || !!user.is_anonymous` becomes `!user`; update the `isGuest` returns at lines 47 and 137
- `src/routes/(player)/+page.svelte` and `src/lib/components/NavBar.svelte` — rename the prop and branch conditions

This is a rename, **not** a deletion. `/` stays public, so NavBar must keep its signed-out arm (the `{:else}` branch showing only the Tournaments link). Removing the branch would break the public page.

### 4. Simplify the display_name backfill

In `src/hooks.server.ts`, drop the `!session.user.is_anonymous` condition from the backfill guard — always true once anonymous users cannot exist.

**Keep everything else about this block, including `GUEST_DISPLAY_NAME` and `isPlaceholderName`.** `isPlaceholderName` (`src/lib/profile.ts:26`) treats `''` *or* `'Guest'` as a placeholder, so the backfill also serves real accounts with an empty display name. Converted-guest rows in production may also still hold the literal string `'Guest'`. Deleting this would be a live regression, not dead-code cleanup.

### 5. Deliberately out of scope

- **`static/robots.txt`** — left permissive. With no minting path, crawling `/drill` is harmless. The original plan to disallow those routes is moot.
- **Migration 0056's `is_anonymous` join in `player_directory`** — redundant once no anonymous users exist, but harmless, and DDL cannot be applied from this environment (see CLAUDE.md).
- **Purging existing anonymous rows in production** — a separate, irreversible operation, gated on reviewing the actual counts first. Not part of this change.

## Manual step (cannot be done in code)

Disable **Anonymous sign-ins** in Supabase Dashboard → Authentication → Providers.

The code changes stop *the app* from minting. They do not stop *the API*: while the provider is enabled, a hand-rolled POST to the project's `/auth/v1/signup` endpoint still creates anonymous users. Both halves are required. Consider also enabling CAPTCHA on auth endpoints as defence in depth.

## Testing

- `src/lib/server/auth.test.ts` — remove the guest-session tests; add assertions that `drill` and `time-trial` loads redirect an unauthenticated visitor to `/login`.
- Manual check: signed out, `/` renders with the signed-out NavBar; `/drill` and `/time-trial` redirect to `/login`; signed in with zero repertoires, both render their existing empty state.
- Gate before push: full `npm test` and `npm run check` at **zero errors**, per CLAUDE.md.

## Acceptance criteria

- [ ] `grep -rn "signInAnonymously\|ensureGuestSession\|ensureGuestProfile" src/` returns nothing
- [ ] `src/lib/server/guest.ts` deleted
- [ ] `drill` and `time-trial` loads use `requireAccount`; signed-out visitors are redirected to `/login`
- [ ] `needsAccount` branches removed from both components; `allMoves.length === 0` states retained
- [ ] `isGuest` renamed to `isSignedOut` throughout, defined as `!user`, and **required** (not optional) in both `app.d.ts` declarations; `/` still renders publicly with a signed-out NavBar
- [ ] `display_name` backfill retained and still fires for empty-name accounts
- [ ] `npm test` and `npm run check` both clean
- [ ] Anonymous sign-ins disabled in the Supabase dashboard (user-confirmed)

## Non-goals

- No landing/marketing page in this change. If `/`'s signed-out state proves thin, that is a separate task.
- No reaper cron, no retention policy — unnecessary once nothing is minted.
- No cleanup of existing anonymous rows.
