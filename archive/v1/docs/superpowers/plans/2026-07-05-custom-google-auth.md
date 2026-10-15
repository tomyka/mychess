# Custom Google Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase-managed Google OAuth with a self-hosted PKCE flow so Google's consent screen shows the app's own domain, while still producing a real Supabase Auth session via `signInWithIdToken`.

**Architecture:** Two new routes (`/auth/google` to initiate, `/auth/callback/google` to complete) reuse the existing `$lib/server/oauth.ts` PKCE/state helpers — the exact same pattern already used for Lichess and Chess.com. The callback exchanges the code with Google directly, then hands the resulting ID token to Supabase's `signInWithIdToken`, which creates the session. The old `startGoogle` client-side flow is deleted.

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes), `@supabase/ssr`, vitest.

Spec: `docs/superpowers/specs/2026-07-05-custom-google-auth-design.md`

---

### Task 1: `GET /auth/google` — initiate the flow

**Files:**
- Create: `mychess/src/routes/auth/google/+server.ts`

- [ ] **Step 1: Write the route**

```ts
// mychess/src/routes/auth/google/+server.ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { generateCodeVerifier, generateCodeChallenge, createState } from '$lib/server/oauth';

export const GET: RequestHandler = async ({ url, cookies }) => {
  const { GOOGLE_CLIENT_ID, OAUTH_STATE_SECRET } = env;
  const redirectUri = `${url.origin}/auth/callback/google`;
  const persist = url.searchParams.get('persist') !== '0';

  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  // No logged-in user yet for a fresh sign-in — pass a random correlator.
  // verifyState only checks the HMAC signature and expiry here, not identity.
  const state = await createState(crypto.randomUUID(), OAUTH_STATE_SECRET);

  // OIDC nonce: raw value stored for later, its hash sent to Google. Google
  // embeds whatever it receives into the ID token's `nonce` claim; Supabase's
  // signInWithIdToken is given the raw value and re-hashes it to compare.
  const nonce = generateCodeVerifier();
  const hashedNonce = await generateCodeChallenge(nonce);

  const cookieOptions = {
    httpOnly: true,
    secure: !dev,
    sameSite: 'lax' as const,
    maxAge: 300,
    path: '/'
  };
  cookies.set('oauth_pkce_verifier_google', verifier, cookieOptions);
  cookies.set('oauth_nonce_google', nonce, cookieOptions);

  if (persist) {
    cookies.delete('sb-no-persist', { path: '/' });
  } else {
    cookies.set('sb-no-persist', '1', { path: '/' });
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    nonce: hashedNonce
  });

  throw redirect(303, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
};
```

- [ ] **Step 2: Type-check the project**

Run: `npm run check` (from `mychess/`)
Expected: no new errors related to this file. (`GOOGLE_CLIENT_ID` will show as an unresolved private env var until Task 4 documents it in `.env.example` and you add a real value to your local `.env` — that's expected and doesn't fail the type-check, since `$env/dynamic/private` types are permissive.)

- [ ] **Step 3: Commit**

```bash
git add mychess/src/routes/auth/google/+server.ts
git commit -m "feat: add custom Google OAuth initiation route"
```

---

### Task 2: `GET /auth/callback/google` — complete the flow

**Files:**
- Create: `mychess/src/routes/auth/callback/google/+server.ts`

- [ ] **Step 1: Write the route**

```ts
// mychess/src/routes/auth/callback/google/+server.ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { verifyState } from '$lib/server/oauth';

export const GET: RequestHandler = async ({ url, cookies, locals: { supabase } }) => {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_STATE_SECRET } = env;
  const redirectUri = `${url.origin}/auth/callback/google`;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error || !code || !state) {
    throw redirect(303, '/login?error=Google+sign-in+was+denied+or+failed');
  }

  const verifier = cookies.get('oauth_pkce_verifier_google');
  const nonce = cookies.get('oauth_nonce_google');
  cookies.delete('oauth_pkce_verifier_google', { path: '/' });
  cookies.delete('oauth_nonce_google', { path: '/' });

  if (!verifier || !nonce) {
    throw redirect(303, '/login?error=Sign-in+session+expired.+Please+try+again');
  }

  try {
    await verifyState(state, OAUTH_STATE_SECRET);
  } catch {
    throw redirect(303, '/login?error=Invalid+sign-in+state.+Please+try+again');
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET
    })
  });

  if (!tokenRes.ok) {
    throw redirect(303, '/login?error=Failed+to+exchange+Google+token');
  }

  const tokenData = await tokenRes.json();
  const idToken: string | undefined = tokenData.id_token;

  if (!idToken) {
    throw redirect(303, '/login?error=Google+did+not+return+an+ID+token');
  }

  const { error: signInError } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
    nonce
  });

  if (signInError) {
    throw redirect(303, `/login?error=${encodeURIComponent(signInError.message)}`);
  }

  throw redirect(303, '/');
};
```

- [ ] **Step 2: Type-check the project**

Run: `npm run check` (from `mychess/`)
Expected: no new errors related to this file.

- [ ] **Step 3: Commit**

```bash
git add mychess/src/routes/auth/callback/google/+server.ts
git commit -m "feat: add custom Google OAuth callback, signs in via signInWithIdToken"
```

---

### Task 3: Wire the login page to the new flow, remove the old one

**Files:**
- Modify: `mychess/src/lib/auth/client.ts`
- Modify: `mychess/src/routes/login/+page.svelte`
- Modify: `mychess/src/routes/login/login.test.ts`

- [ ] **Step 1: Remove `startGoogle` from the auth client**

Replace the full contents of `mychess/src/lib/auth/client.ts` with:

```ts
// mychess/src/lib/auth/client.ts
import { createSupabaseClient } from '$lib/supabase/client';

export type AuthResult = { ok: boolean; error?: string };

function setPersistMarker(keepSignedIn: boolean): void {
	document.cookie = keepSignedIn ? 'sb-no-persist=; path=/; max-age=0' : 'sb-no-persist=1; path=/';
}

function callbackUrl(): string {
	return `${window.location.origin}/auth/callback`;
}

/** Sends a magic link. On an anonymous user, converts it (preserving progress). */
export async function sendMagicLink(email: string, keepSignedIn: boolean): Promise<AuthResult> {
	const sb = createSupabaseClient();
	setPersistMarker(keepSignedIn);
	const {
		data: { user }
	} = await sb.auth.getUser();
	if (user?.is_anonymous) {
		// Convert the anonymous account to permanent, keeping its progress. The
		// confirmation link must return to our callback (not the Supabase Site URL).
		const { error } = await sb.auth.updateUser({ email }, { emailRedirectTo: callbackUrl() });
		return error ? { ok: false, error: error.message } : { ok: true };
	}
	const { error } = await sb.auth.signInWithOtp({
		email,
		options: { emailRedirectTo: callbackUrl(), shouldCreateUser: true }
	});
	return error ? { ok: false, error: error.message } : { ok: true };
}
```

- [ ] **Step 2: Update the login page**

Replace the full contents of `mychess/src/routes/login/+page.svelte` with:

```svelte
<script lang="ts">
  import { sendMagicLink } from '$lib/auth/client';

  let { data } = $props<{ data: { error: string | null } }>();

  let email = $state('');
  let keepSignedIn = $state(true);
  let error = $state(data.error ?? '');
  let loading = $state(false);
  let sent = $state(false);

  async function magicLink() {
    if (!email.trim()) { error = 'Enter your email address'; return; }
    loading = true; error = '';
    const r = await sendMagicLink(email.trim(), keepSignedIn);
    loading = false;
    if (r.ok) sent = true;
    else error = r.error ?? 'Could not send the link';
  }
</script>

<main class="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-8 p-6">
  <div class="text-center">
    <a href="/" class="flex items-center justify-center gap-2 font-bold text-gray-900 mb-2">
      <span class="text-3xl">♟</span>
      <span class="text-2xl">MyChess</span>
    </a>
    <p class="text-gray-500">Sign in to save your progress</p>
  </div>

  <div class="bg-white border border-gray-200 rounded-2xl shadow-sm p-8 w-full max-w-sm flex flex-col gap-5">
    {#if error}
      <p class="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
    {/if}

    {#if sent}
      <div class="text-center space-y-2">
        <h1 class="text-lg font-semibold text-gray-900">Check your email</h1>
        <p class="text-sm text-gray-500">We sent a sign-in link to <span class="font-medium">{email}</span>. Open it on this device to continue.</p>
        <button onclick={() => { sent = false; }} class="text-sm text-indigo-600 hover:underline">Use a different email</button>
      </div>
    {:else}
      <a
        href={`/auth/google?persist=${keepSignedIn ? '1' : '0'}`}
        class="flex items-center justify-center gap-2 border border-gray-300 rounded-xl py-3 font-medium text-gray-700 hover:bg-gray-50 transition">
        <span aria-hidden="true">G</span> Continue with Google
      </a>

      <div class="flex items-center gap-3 text-xs text-gray-400">
        <span class="flex-1 border-t border-gray-200"></span>or<span class="flex-1 border-t border-gray-200"></span>
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="email">Email</label>
        <input
          id="email"
          type="email"
          bind:value={email}
          placeholder="you@example.com"
          class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <label class="flex items-center gap-2 text-sm text-gray-600">
        <input type="checkbox" bind:checked={keepSignedIn} class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
        Keep me signed in
      </label>

      <button
        onclick={magicLink}
        disabled={loading}
        class="bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 transition disabled:opacity-50">
        {loading ? 'Please wait…' : 'Email me a magic link'}
      </button>
    {/if}

    <a href="/" class="text-center text-sm text-gray-500 hover:underline">Continue without account →</a>
  </div>
</main>
```

- [ ] **Step 3: Update the login page test**

Replace the full contents of `mychess/src/routes/login/login.test.ts` with:

```ts
// mychess/src/routes/login/login.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/auth/client', () => ({
  sendMagicLink: vi.fn(async () => ({ ok: true }))
}));

import Login from './+page.svelte';

afterEach(() => cleanup());

describe('login page', () => {
  it('renders a Google sign-in link, email, and keep-signed-in — no password field', () => {
    render(Login, { props: { data: { error: null } } });
    const googleLink = screen.getByRole('link', { name: /Google/i });
    expect(googleLink).toBeTruthy();
    expect(googleLink.getAttribute('href')).toBe('/auth/google?persist=1');
    expect(screen.getByLabelText(/Email/i)).toBeTruthy();
    expect(screen.getByLabelText(/Keep me signed in/i)).toBeTruthy();
    expect(screen.queryByLabelText(/Password/i)).toBeNull();
  });

  it('reflects an unchecked keep-signed-in box in the Google link\'s persist param', async () => {
    render(Login, { props: { data: { error: null } } });
    await fireEvent.click(screen.getByLabelText(/Keep me signed in/i));
    const googleLink = screen.getByRole('link', { name: /Google/i });
    expect(googleLink.getAttribute('href')).toBe('/auth/google?persist=0');
  });

  it('shows a check-your-email panel after requesting a magic link', async () => {
    render(Login, { props: { data: { error: null } } });
    await fireEvent.input(screen.getByLabelText(/Email/i), { target: { value: 'a@b.com' } });
    await fireEvent.click(screen.getByRole('button', { name: /magic link/i }));
    expect(await screen.findByText(/check your email/i)).toBeTruthy();
  });

  it('shows an error passed via load data', () => {
    render(Login, { props: { data: { error: 'Link expired' } } });
    expect(screen.getByText(/Link expired/i)).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run the test file to verify it passes**

Run: `PATH="/c/Users/tomyk/.config/herd/bin/nvm/v22.22.3:$PATH" npx vitest run src/routes/login/login.test.ts` (this machine's default Node v20.17.0 is too old for jsdom's dependency chain — use the newer Node install on PATH for this command only)
Expected: PASS (4 tests)

- [ ] **Step 5: Type-check the project**

Run: `npm run check` (from `mychess/`)
Expected: no errors referencing `login/+page.svelte` or `lib/auth/client.ts`. No remaining references to `startGoogle` anywhere.

- [ ] **Step 6: Commit**

```bash
git add mychess/src/lib/auth/client.ts "mychess/src/routes/login/+page.svelte" "mychess/src/routes/login/login.test.ts"
git commit -m "refactor: switch login page to the custom Google OAuth route"
```

---

### Task 4: Document the new environment variables

**Files:**
- Modify: `mychess/.env.example`

- [ ] **Step 1: Add the Google env vars**

In `mychess/.env.example`, change:

```
# Chess.com: https://www.chess.com/club/chess-com-developer-community
CHESSCOM_CLIENT_ID=your-chesscom-client-id
CHESSCOM_CLIENT_SECRET=your-chesscom-client-secret
CHESSCOM_REDIRECT_URI=http://localhost:5173/auth/callback/chesscom

# Shared OAuth state signing secret (min 32 chars random string)
OAUTH_STATE_SECRET=your-random-secret-min-32-chars
```

to:

```
# Chess.com: https://www.chess.com/club/chess-com-developer-community
CHESSCOM_CLIENT_ID=your-chesscom-client-id
CHESSCOM_CLIENT_SECRET=your-chesscom-client-secret
CHESSCOM_REDIRECT_URI=http://localhost:5173/auth/callback/chesscom

# Google Sign-In (custom flow — Google Cloud Console → APIs & Services → Credentials)
# Add http://localhost:5173/auth/callback/google as an Authorized redirect URI on this client.
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret

# Shared OAuth state signing secret (min 32 chars random string)
OAUTH_STATE_SECRET=your-random-secret-min-32-chars
```

- [ ] **Step 2: Commit**

```bash
git add mychess/.env.example
git commit -m "docs: document GOOGLE_CLIENT_ID/SECRET env vars"
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `PATH="/c/Users/tomyk/.config/herd/bin/nvm/v22.22.3:$PATH" npx vitest run` (from `mychess/`)
Expected: PASS — all tests including the updated `login.test.ts`.

- [ ] **Step 2: Run the full type-check**

Run: `npm run check` (from `mychess/`)
Expected: no new errors (same pre-existing unrelated error count as before this feature).

- [ ] **Step 3: Grep for any remaining references to the deleted flow**

Run: `grep -rn "startGoogle\|linkIdentity" mychess/src`
Expected: no matches.

- [ ] **Step 4: Add local environment variables**

Add real values for `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to your local `mychess/.env` (from the same Google Cloud OAuth client shown in your screenshot earlier).

- [ ] **Step 5: Google Cloud Console — add redirect URIs**

In that same OAuth 2.0 Client (the one already showing `https://vyohcbfrhcpjedhioesg.supabase.co/auth/v1/callback`), click **+ Add URI** under Authorized redirect URIs twice, adding:
- `https://mychess.lt/auth/callback/google`
- `http://localhost:5173/auth/callback/google`

Save. (Google's own UI warns this can take a few minutes to a few hours to propagate.)

- [ ] **Step 6: Manually verify locally**

Run: `npm run dev` (from `mychess/`), then in a browser:
- Visit `/login`, confirm "Continue with Google" is now a link (not a loading spinner button) and its href includes `?persist=1` by default, `?persist=0` if you uncheck "Keep me signed in".
- Click it — you should land on Google's consent screen showing `localhost:5173` (or whatever your dev origin's associated OAuth client shows) rather than any Supabase domain, once redirect URIs have propagated.
- Complete sign-in — you should land back on `/`, signed in with a real Supabase session (check DevTools → Application → Cookies for `sb-` prefixed auth cookies).
- If you're a genuinely new Google account (no existing profile), confirm you're redirected to `/welcome` to pick a name/role.

- [ ] **Step 7: Manually verify in production**

After deploying (Vercel env vars `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` must be set first — see spec's "External configuration" section), repeat the same check at `https://mychess.lt/login`, confirming the consent screen now shows `mychess.lt` instead of the Supabase project domain.

No commit for this task — it's verification only. If any step surfaces a bug, fix it as part of the task where the bug was introduced and re-run this task's steps.
