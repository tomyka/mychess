# Passwordless Auth (Google + Magic Link + Keep-Signed-In) — Design Spec

**Date:** 2026-07-03
**Status:** Awaiting user review
**Sub-project:** #2 of the platform evolution (#0 rename + #1 public-first landing done; #3 roles follows).

**Assumed decisions (flagged — change if wrong):**
- Guest progress is **preserved** by upgrading the anonymous account (link identity), matching the "sign in to save your progress" nudge from #1.
- "Keep me signed in" is a **checkbox, default ON** (persistent); unchecking makes the session cookie-only.

## Problem / Goal

Auth is email+password today. Replace it with **passwordless** sign-in: Google OAuth and email **magic links**, with a "Keep me signed in" option, and drop passwords entirely. A guest who tried training can sign in and keep their progress.

## Non-goals

- Role/permission changes (that's #3). New real users still go through `/welcome` to pick role/name.
- Multiple OAuth providers beyond Google.
- Custom email template design (use Supabase defaults; SMTP config is an ops prereq).

## Prerequisites (Supabase config — user, one-time)

- **Google provider:** enable in Auth → Providers; set Google OAuth Client ID/Secret; add the callback `https://<project>.supabase.co/auth/v1/callback` in Google Cloud, and the app origin(s) to Supabase **Redirect URLs** + **Site URL**.
- **Email:** magic links need working email. Supabase's built-in sender is rate-limited; configure custom SMTP for anything beyond light testing.
- **Anonymous sign-ins:** already required by #1 (for guest upgrade to work).

## Auth flows

### Fresh visitor (no session or a real account)
- **Google:** `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: <origin>/auth/callback } })` → Google → `/auth/callback?code=…`.
- **Email:** `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: <origin>/auth/callback, shouldCreateUser: true } })` → "check your email" → link → `/auth/callback`.

Magic link auto-creates the user if new, so **one flow serves both sign-in and sign-up** — the login/signup mode toggle is removed.

### Anonymous guest upgrade (preserve progress)
Detect `const { data: { user } } = await supabase.auth.getUser()` → `user?.is_anonymous`:
- **Google:** `supabase.auth.linkIdentity({ provider: 'google', options: { redirectTo: <origin>/auth/callback } })` — links Google to the anon user, keeping its id + data.
- **Email:** `supabase.auth.updateUser({ email })` — converts the anonymous user to permanent (sends a confirmation link to `/auth/callback`), preserving id + data.

This keeps drills/quests created as a guest attached to the now-permanent account.

### Callback (`auth/callback/+server.ts`)
Handle both link styles so magic links work regardless of the email template:
- `?code=` present → `supabase.auth.exchangeCodeForSession(code)` (PKCE; also the OAuth path — already implemented).
- else `?token_hash=` + `?type=` present → `supabase.auth.verifyOtp({ token_hash, type })`.
- Then redirect to `?next=` if a safe local path, else `/`.
On error, redirect to `/login?error=<message>`.

## Keep me signed in

@supabase/ssr stores the session in cookies; persistence is governed by cookie expiry.

- Default (checked): Supabase's persistent auth cookies — user stays signed in across browser restarts.
- Unchecked: the login page sets a marker cookie `sb-no-persist=1` (path `/`, session cookie) before starting the auth request. In `hooks.server.ts` `setAll`, when `sb-no-persist` is present, strip `maxAge` and `expires` from each Supabase auth cookie's options so they become **session cookies** (cleared when the browser closes).

A pure helper `sessionCookieOptions(options, noPersist)` (in `src/lib/server/cookies.ts`) does the option transform and is unit-tested; `hooks.server.ts` calls it in `setAll`, reading the marker from `event.cookies`.

## Files

| File | Change |
|---|---|
| `src/routes/login/+page.svelte` | Rework: Google button + email magic-link form + keep-signed-in checkbox; no password/toggle; "check your email" state; anon-upgrade branch |
| `src/routes/auth/callback/+server.ts` | Handle `code` and `token_hash`/`type`; safe `next` redirect; error → `/login?error=` |
| `src/lib/server/cookies.ts` | **New** — `sessionCookieOptions(options, noPersist)` pure helper |
| `src/hooks.server.ts` | `setAll` applies `sessionCookieOptions` when the `sb-no-persist` marker cookie is set |
| `src/lib/auth/client.ts` | **New (optional)** — small client helpers `startGoogle(supabase, { anon })`, `sendMagicLink(supabase, email, { anon })` encapsulating the fresh-vs-anon branch, so the page stays thin and the branch is testable-by-reading |

## Error handling

- Google/email errors surface inline on the login page (existing `error` state).
- Magic-link request success → switch to a "check your email" panel (no navigation).
- Callback failure (bad/expired code) → redirect `/login?error=…`; the page shows it.
- `updateUser({ email })` on a non-anonymous user isn't hit (branch guards on `is_anonymous`).

## Testing

- **`cookies.test.ts`** (unit): `sessionCookieOptions` — with `noPersist=false` returns options unchanged; with `noPersist=true` removes `maxAge` and `expires` and keeps `path`/`sameSite`/etc.
- **`login/+page` component test** (jsdom): renders the Google button, the email input, and the keep-signed-in checkbox; after a (mocked) magic-link send, shows the "check your email" panel. (Supabase calls are mocked at the client boundary; we assert UI state transitions, not Supabase behaviour.)
- **Manual smoke** (needs Google + SMTP configured): (a) Google sign-in from logged-out → lands signed in; (b) magic link email → click → signed in; (c) guest tries a drill, then signs in with email → same account, progress intact; (d) uncheck "keep me signed in" → cookie is session-scoped (DevTools shows no expiry); (e) new real user → `/welcome`.

## Risks

- **Keep-signed-in cookie stripping** is the fiddliest part (marker cookie must exist on the request that sets auth cookies; OAuth round-trips through the provider). Isolated in `sessionCookieOptions` + the marker so it's contained and unit-tested; if it proves flaky it can be dropped to "always persist" without touching the auth flows.
- **Magic-link flow variant** (code vs token_hash) depends on the Supabase email template; the callback handles both to be safe.
- **Google/SMTP are external config**; the app can't be fully smoke-tested until they're set. Nothing else in the app depends on them.
