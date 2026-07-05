# Custom Google Sign-In (bypass Supabase-managed OAuth)

**Date:** 2026-07-05
**Status:** Approved for planning
**Builds on:** `2026-07-03-passwordless-auth-design.md`

## Problem

Google sign-in currently goes through Supabase's managed `signInWithOAuth`/`linkIdentity`, which redirects the user through Supabase's own backend domain (`https://<project-ref>.supabase.co/auth/v1/callback`). Google's consent screen shows that raw domain ("to continue to `vyohcbfrhcpjedhioesg.supabase.co`"), which looks unbranded and untrustworthy to end users on a real product.

## Goal

Replace the Google sign-in flow with a self-hosted OAuth exchange (mirroring the existing Lichess/Chess.com confidential-client PKCE pattern already in this codebase), so Google's consent screen shows the app's own domain instead of Supabase's. The result must still produce a real, valid Supabase Auth session, since the rest of the app (RLS policies, `auth.uid()`) depends on Supabase Auth as the source of truth.

## Decisions

- **Use Supabase's `signInWithIdToken`** to hand off the verified Google identity to Supabase, rather than reinventing session/JWT issuance. This keeps Supabase Auth as the single source of truth while moving the user-facing redirect to the app's own domain.
- **Google sign-in becomes fresh-only** — it no longer supports upgrading an anonymous guest session while preserving progress, because `signInWithIdToken` has no equivalent to `linkIdentity`'s "merge into current anonymous user" behavior. Guests who want to keep their progress use the existing email magic-link flow instead (unaffected by this change — it still uses `updateUser({ email })` on the anonymous session).
- **The old Supabase-managed Google code path is deleted**, not kept as a fallback — avoids maintaining two parallel auth mechanisms.
- **Reuse `$lib/server/oauth.ts`** (PKCE verifier/challenge, signed state, JWT payload decoding) rather than writing new crypto helpers — the Lichess/Chess.com flows already exercise this code.
- **No new redirect-target logic** — after establishing the session, the callback just redirects to `/`. The existing `(player)/+layout.server.ts` guard already redirects any real user with no `profiles` row to `/welcome`, and coaches to `/coach`. New Google users get the same onboarding path as new magic-link users for free.

## Architecture

### `GET /auth/google` (new) — initiation

1. Generate a PKCE `code_verifier`/`code_challenge` (`generateCodeVerifier`/`generateCodeChallenge` from `$lib/server/oauth.ts`).
2. Generate a signed anti-forgery `state` via `createState`. Since there may be no logged-in user yet (fresh sign-in), pass a random opaque correlator (e.g. `crypto.randomUUID()`) in the "userId" slot — `verifyState` only checks the HMAC signature and expiry here, not that it matches a real user, so this is a safe reuse of the existing helper.
3. Generate a random OIDC nonce (raw value); store it in an httpOnly cookie (`oauth_nonce_google`). Compute its SHA-256 hash (base64url) and send that hash as the `nonce` parameter to Google. (Google embeds whatever nonce value it receives into the returned ID token's `nonce` claim; Supabase's `signInWithIdToken` is given the *raw* nonce and independently hashes it to compare against the token's claim — this is Supabase's documented anti-replay mechanism.)
4. Store the PKCE verifier in an httpOnly cookie (`oauth_pkce_verifier_google`), same pattern/TTL (300s) as the Lichess/Chess.com cookies.
5. Read a `persist` query parameter (from the login page's "Keep me signed in" checkbox) and set the existing `sb-no-persist` marker cookie accordingly, matching the current magic-link/old-Google behavior in `src/lib/auth/client.ts`.
6. Redirect (303) to Google's OAuth authorize endpoint with `response_type=code`, `client_id=GOOGLE_CLIENT_ID`, `redirect_uri=<origin>/auth/callback/google`, `scope=openid email profile`, `code_challenge_method=S256`, `code_challenge`, `state`, and the hashed `nonce`.

### `GET /auth/callback/google` (new) — completion

1. Read `code`, `state`, and any `error` from the query string. On missing code/state or an `error` param, redirect to `/login?error=...`.
2. Read back the `oauth_pkce_verifier_google` and `oauth_nonce_google` cookies (clearing both). Missing verifier/nonce → `/login?error=...` (session expired).
3. Verify `state` via `verifyState` (catches tampering/expiry — 5 minute window, same as the existing helper). Failure → `/login?error=...`.
4. Exchange the code for tokens directly with Google: `POST https://oauth2.googleapis.com/token` with `grant_type=authorization_code`, `code`, `code_verifier`, `redirect_uri`, `client_id=GOOGLE_CLIENT_ID`, `client_secret=GOOGLE_CLIENT_SECRET` — mirrors the existing Chess.com callback's token exchange exactly. Non-OK response → `/login?error=...`.
5. Take the `id_token` from the response and call `event.locals.supabase.auth.signInWithIdToken({ provider: 'google', token: idToken, nonce: rawNonce })`. This validates the token's signature/claims against Google's public keys and the configured Google Client ID in Supabase, then creates or signs into the corresponding Supabase user — session cookies are written automatically via the SSR cookie adapter already wired in `hooks.server.ts`. Error → `/login?error=...`.
6. On success, redirect (303) to `/`.

### Login page changes

`src/lib/auth/client.ts`: delete `startGoogle` entirely (the `signInWithOAuth`/`linkIdentity` branch). `sendMagicLink` is untouched.

`src/routes/login/+page.svelte`: the "Continue with Google" button becomes a plain navigation to `/auth/google?persist=<0|1>` (reflecting the "Keep me signed in" checkbox state) instead of an `onclick` handler calling `startGoogle()`. No client-side Supabase call is needed for Google anymore.

## Environment variables (new)

- `GOOGLE_CLIENT_ID` (private)
- `GOOGLE_CLIENT_SECRET` (private)

Both come from the existing "MyChess" OAuth 2.0 Client (Web application type) already created in Google Cloud Console.

## External configuration (user action, not code)

1. **Google Cloud Console** → the existing OAuth client → add two more Authorized redirect URIs: `https://mychess.lt/auth/callback/google` and `http://localhost:5173/auth/callback/google`. The existing Supabase-managed redirect URI can stay (harmless, unused after this change).
2. **Supabase Dashboard** → Authentication → Sign In/Providers → Google stays enabled with the same Client ID — `signInWithIdToken` still validates the token's audience against it. No change needed there.
3. Add `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` to Vercel's project environment variables and to local `.env`.

## Error handling

Every failure branch (missing code/state, expired/tampered state, missing cookies, failed token exchange, `signInWithIdToken` error) redirects to `/login?error=<message>` — matching the existing `/login` page's error-banner rendering (already reads `data.error` from `+page.ts`) and the existing magic-link/Google error-handling convention.

## Testing

Matches the existing convention for third-party OAuth callbacks in this codebase (Lichess, Chess.com): no automated test for the live OAuth exchange itself (it depends on a real Google API round-trip), verified manually. Any new pure logic this task introduces (e.g. the nonce SHA-256 hashing, if extracted as a standalone function) gets a unit test the same way `oauth.test.ts` already covers `generateCodeChallenge`/`createState`/`verifyState`.

## Non-goals

- No change to the email magic-link flow.
- No change to Lichess/Chess.com account-linking OAuth flows.
- No support for upgrading an anonymous guest session via Google (see Decisions above).
- No removal of Google as a provider in Supabase's dashboard config — it stays enabled, just no longer reached via Supabase's own redirect.
