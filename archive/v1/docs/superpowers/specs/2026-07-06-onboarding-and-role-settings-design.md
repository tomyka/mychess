# Onboarding Name Fix + Google Prefill + Switchable Role

**Date:** 2026-07-06
**Status:** Approved for planning

## Problems

1. `/welcome` collects a single `display_name` field and never populates `profiles.first_name`/`last_name`. The dashboard (which reads `display_name`) shows the name correctly, but Settings (which shows separate First/Last Name inputs) appears empty.
2. Google sign-ups are asked to type their name on `/welcome` even though Google already gave us it.
3. Role (Player/Coach) is a one-time choice made during `/welcome` onboarding. It should be a switchable Settings setting instead.

## Decisions

- **Role becomes freely switchable, no confirmation step.** Coach-only actions (assigning repertoires, reading a student's profile) are already gated by an actual coach↔student relationship (`profiles.coach_id` pointing at the coach), not by `role` alone — the one exception is the `assigned_repertoires` RLS policy, which does check `role = 'coach'`, but flipping that flag doesn't grant access to anyone else's data since a fresh coach has no students until someone's `coach_id` points at them via the invite flow. Switching is therefore safe to make instant and unrestricted.
- **No data backfill for existing broken profiles.** The site has no real users yet; any existing test accounts with an empty first/last name can be fixed manually in Settings or wiped (per prior discussion).
- **`/settings` moves out of the `(player)` route group to a top-level route** (`src/routes/settings/`, alongside `/login` and `/welcome`). This is a necessary correction, not scope creep: `(player)/+layout.server.ts` currently redirects any `role = 'coach'` profile away from every page in that group, including Settings — which would make it impossible for a coach to switch back to Player. Route groups are purely organizational in SvelteKit (they don't appear in the URL), and `/settings` already does its own auth check (`requireAccount`) independently of the group layout, so this is a safe, link-free file move — every existing `href="/settings"` in the app keeps working unchanged.

## Architecture

### `/welcome` collects First + Last Name, no role picker

- `+page.svelte`: replace the single "Your name" input and the Player/Coach button pair with two inputs — First Name, Last Name — matching Settings' fields exactly.
- `+page.server.ts`: the `default` action reads `first_name`/`last_name`, computes `display_name` via the existing `fullNameOrNull()` helper (`$lib/profile.ts`, already used identically by Settings' save action), and creates the profile via a new shared helper (see below) with `role` hardcoded to `'player'`. New users can switch to Coach immediately after landing on `/`, via Settings.

### New shared helper: `$lib/server/onboarding.ts`

Both `/welcome`'s action and the Google callback's new-user branch need to do the same three inserts (profile row, `player_stats`, `equipped_cosmetics`) — currently only `/welcome` does this inline, and `$lib/server/guest.ts`'s `ensureGuestProfile` does an equivalent thing for anonymous guests. Extract a shared `createPlayerProfile(supabase, { id, firstName, lastName, displayName })` function so this logic exists in exactly one place instead of being duplicated between `/welcome` and the Google callback.

### Google callback creates the profile directly, skipping `/welcome`

`auth/callback/google/+server.ts`, right after a successful `signInWithIdToken`: check whether a `profiles` row already exists for the signed-in user id. If not (brand-new Google sign-up), decode the Google ID token (reusing the existing `decodeJwtPayload` helper already used for Chess.com's username claim) to read the `given_name`/`family_name` claims, and call `createPlayerProfile` with that name. Because `(player)/+layout.server.ts`'s "no profile yet → `/welcome`" check will now find a profile already there, new Google users land straight on `/` — no name prompt. Existing Google users signing back in are unaffected (their profile already exists, so the branch is skipped).

Fallback if Google's `given_name`/`family_name` are ever missing (rare, but the scope only guarantees `profile` access, not specific claims): fall back to the token's `name` claim, then to the literal string `"Player"` — mirroring the existing `GUEST_DISPLAY_NAME` fallback pattern.

### Settings gains a Player/Coach switch

`settings/+page.server.ts`: `load` returns `role: profile?.role ?? 'player'`. The `save` action reads `role` from the form, validates it's `'player'` or `'coach'` (defaulting to `'player'` otherwise), and includes it in the `profiles` update alongside the existing fields.

`settings/+page.svelte`: a new "I am a" control next to the name fields, reusing the exact two-button toggle visual already established by the (now-removed) `/welcome` role picker — active button highlighted, inactive one plain — submitted as a hidden `role` field with the rest of the Profile form. Saves instantly with no separate confirmation step.

## Data flow / files touched

- `mychess/src/lib/server/onboarding.ts` (new) — `createPlayerProfile` helper.
- `mychess/src/routes/welcome/+page.svelte`, `+page.server.ts` — collect name only, no role; use the shared helper.
- `mychess/src/routes/auth/callback/google/+server.ts` — create profile from Google claims for brand-new sign-ups.
- `mychess/src/routes/(player)/settings/` → moved to `mychess/src/routes/settings/` — add the role switch; otherwise unchanged.
- `mychess/src/routes/(player)/+layout.server.ts` — unaffected (no code change; it simply no longer applies to Settings once the file moves).

## Error handling

- `/welcome`: missing first or last name → existing `fail(400, { error: ... })` pattern, unchanged in spirit (just validates two fields instead of one, no role validation needed since it's no longer submitted).
- Google callback: if decoding the ID token or creating the profile fails, the user still lands on `/` (already successfully signed in) rather than being blocked — `(player)/+layout.server.ts`'s existing "no profile → `/welcome`" check acts as a safety net, sending them through the normal name-entry flow as a fallback if profile creation silently failed.
- Settings: invalid/missing `role` value defaults to `'player'` rather than rejecting the save — consistent with how `rank_basis` was validated before its removal.

## Testing

- New `mychess/src/lib/server/onboarding.test.ts` for `createPlayerProfile`, following the existing pattern for server helpers that touch Supabase (mocking the client) — actually, checking precedent: `ensureGuestProfile` (the closest analogous helper) has no test file today, so this task will follow that same established precedent and skip a dedicated test for the new helper too, relying on manual verification.
- No changes needed to any existing test file — `/welcome` and Settings currently have no test coverage (matches the established untested-page-wiring pattern already noted in prior specs).
- Manual verification: sign up fresh via email magic link (should ask for first/last name, no role picker), sign up fresh via Google (should skip `/welcome` entirely, land on `/` with the Google name already set), switch role in Settings as both a player and (after switching) a coach, and confirm a coach can still reach `/settings` to switch back.

## Non-goals

- No change to how coach-student relationships are established (still via the existing invite flow).
- No change to the `assigned_repertoires` RLS policy or any other permission logic.
- No backfill migration for existing profiles with empty first/last name.
