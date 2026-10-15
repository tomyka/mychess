# Passwordless Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace email+password login with Google OAuth + email magic links, add a "Keep me signed in" toggle, and preserve guest progress on sign-in.

**Architecture:** Thin client helpers wrap Supabase auth (fresh vs anonymous-upgrade branch); the callback handles both PKCE `code` and OTP `token_hash`; a `sb-no-persist` marker cookie + a pure `sessionCookieOptions` helper (applied in `hooks.server.ts`) make sessions cookie-only when the box is unchecked.

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), Supabase (`@supabase/ssr`), Vitest, jsdom.

**Working directory:** run `npm`/`npx` from `mychess/`. Repo root is its parent.

**Spec:** `docs/superpowers/specs/2026-07-03-passwordless-auth-design.md`

**Known pre-existing `npm run check` errors (ignore):** `hooks.server.ts`, `lib/supabase/client.ts`, `auth/**`, `api/fide/import`, `api/tournaments/scrape`.

**Prereqs (Supabase, user — not code):** enable Google provider (+ OAuth client/secret/redirect), configure SMTP for magic links, add app origin to Site URL + Redirect URLs, keep Anonymous sign-ins enabled.

---

## Task 1: `sessionCookieOptions` helper (keep-signed-in core)

**Files:**
- Create: `mychess/src/lib/server/cookies.ts`
- Test: `mychess/src/lib/server/cookies.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mychess/src/lib/server/cookies.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { sessionCookieOptions } from './cookies';

describe('sessionCookieOptions', () => {
  it('returns options unchanged when persistence is allowed', () => {
    const opts = { path: '/', maxAge: 3600, sameSite: 'lax' as const };
    expect(sessionCookieOptions(opts, false)).toEqual(opts);
  });

  it('strips maxAge and expires when noPersist is true (session cookie)', () => {
    const opts = { path: '/', maxAge: 3600, expires: new Date(0), sameSite: 'lax' as const, httpOnly: true };
    const out = sessionCookieOptions(opts, true);
    expect('maxAge' in out).toBe(false);
    expect('expires' in out).toBe(false);
    expect(out).toMatchObject({ path: '/', sameSite: 'lax', httpOnly: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `mychess/`): `npx vitest run src/lib/server/cookies.test.ts`
Expected: FAIL — cannot resolve `./cookies`.

- [ ] **Step 3: Implement**

Create `mychess/src/lib/server/cookies.ts`:
```ts
export interface CookieOptions {
  path?: string;
  maxAge?: number;
  expires?: Date;
  [key: string]: unknown;
}

/**
 * When noPersist is true, remove maxAge/expires so the cookie becomes a
 * session cookie (cleared when the browser closes). Otherwise unchanged.
 */
export function sessionCookieOptions<T extends CookieOptions>(options: T, noPersist: boolean): T {
  if (!noPersist) return options;
  const { maxAge, expires, ...rest } = options;
  return rest as T;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `mychess/`): `npx vitest run src/lib/server/cookies.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**
```bash
git add mychess/src/lib/server/cookies.ts mychess/src/lib/server/cookies.test.ts
git commit -m "feat: add sessionCookieOptions helper for keep-signed-in"
```

---

## Task 2: Apply keep-signed-in in hooks

**Files:**
- Modify: `mychess/src/hooks.server.ts`

- [ ] **Step 1: Import the helper**

In `mychess/src/hooks.server.ts`, add near the other imports:
```ts
import { sessionCookieOptions } from '$lib/server/cookies';
```

- [ ] **Step 2: Use it in `setAll`**

Replace the `setAll` cookie block:
```ts
			setAll: (cookies) =>
				cookies.forEach(({ name, value, options }) =>
					event.cookies.set(name, value, { ...options, path: '/' })
				)
```
with:
```ts
			setAll: (cookies) => {
				const noPersist = event.cookies.get('sb-no-persist') === '1';
				cookies.forEach(({ name, value, options }) =>
					event.cookies.set(name, value, sessionCookieOptions({ ...options, path: '/' }, noPersist))
				);
			}
```

- [ ] **Step 3: Verify**

Run (from `mychess/`): `npx vitest run 2>&1 | tail -3` → all pass.
Run: `npm run check 2>&1 | grep -c ERROR` → unchanged known count.

- [ ] **Step 4: Commit**
```bash
git add mychess/src/hooks.server.ts
git commit -m "feat: honor sb-no-persist marker for session-only cookies"
```

---

## Task 3: Callback handles code + magic-link token

**Files:**
- Modify: `mychess/src/routes/auth/callback/+server.ts`

- [ ] **Step 1: Replace the handler**

Replace the whole body of `mychess/src/routes/auth/callback/+server.ts` with:
```ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { EmailOtpType } from '@supabase/supabase-js';

export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
	const code = url.searchParams.get('code');
	const tokenHash = url.searchParams.get('token_hash');
	const type = url.searchParams.get('type') as EmailOtpType | null;
	const next = url.searchParams.get('next');

	let errorMessage: string | null = null;
	if (code) {
		const { error } = await supabase.auth.exchangeCodeForSession(code);
		errorMessage = error?.message ?? null;
	} else if (tokenHash && type) {
		const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
		errorMessage = error?.message ?? null;
	} else {
		errorMessage = 'Invalid or expired authentication link.';
	}

	if (errorMessage) throw redirect(303, `/login?error=${encodeURIComponent(errorMessage)}`);

	// Only allow local redirect targets.
	const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
	throw redirect(303, dest);
};
```

- [ ] **Step 2: Verify**

Run (from `mychess/`): `npm run check 2>&1 | grep "auth/callback/+server" | grep -i error || echo "no new callback errors"` → no new errors.
Run: `npx vitest run 2>&1 | tail -3` → all pass.

- [ ] **Step 3: Commit**
```bash
git add "mychess/src/routes/auth/callback/+server.ts"
git commit -m "feat: auth callback handles OAuth code and magic-link token_hash"
```

---

## Task 4: Client auth helpers

**Files:**
- Create: `mychess/src/lib/auth/client.ts`

These wrap Supabase auth with the fresh-vs-anonymous branch and set the persistence marker. They call `createSupabaseClient()` and touch `document`/`window`, so they run browser-side only (invoked from the login page); not unit-tested (IO) — the login component test mocks this module.

- [ ] **Step 1: Implement**

Create `mychess/src/lib/auth/client.ts`:
```ts
import { createSupabaseClient } from '$lib/supabase/client';

export type AuthResult = { ok: boolean; error?: string };

function setPersistMarker(keepSignedIn: boolean): void {
  // Session-only when unchecked; cleared when checked.
  document.cookie = keepSignedIn ? 'sb-no-persist=; path=/; max-age=0' : 'sb-no-persist=1; path=/';
}

function callbackUrl(): string {
  return `${window.location.origin}/auth/callback`;
}

/** Sends a magic link. On an anonymous user, converts it (preserving progress). */
export async function sendMagicLink(email: string, keepSignedIn: boolean): Promise<AuthResult> {
  const sb = createSupabaseClient();
  setPersistMarker(keepSignedIn);
  const { data: { user } } = await sb.auth.getUser();
  if (user?.is_anonymous) {
    const { error } = await sb.auth.updateUser({ email });
    return error ? { ok: false, error: error.message } : { ok: true };
  }
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callbackUrl(), shouldCreateUser: true }
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Starts Google OAuth. On an anonymous user, links Google to it (preserving progress). */
export async function startGoogle(keepSignedIn: boolean): Promise<AuthResult> {
  const sb = createSupabaseClient();
  setPersistMarker(keepSignedIn);
  const { data: { user } } = await sb.auth.getUser();
  const options = { redirectTo: callbackUrl() };
  const { error } = user?.is_anonymous
    ? await sb.auth.linkIdentity({ provider: 'google', options })
    : await sb.auth.signInWithOAuth({ provider: 'google', options });
  return error ? { ok: false, error: error.message } : { ok: true };
}
```

- [ ] **Step 2: Verify type-check**

Run (from `mychess/`): `npm run check 2>&1 | grep "lib/auth/client" | grep -i error || echo "no client.ts errors"` → no errors.

- [ ] **Step 3: Commit**
```bash
git add mychess/src/lib/auth/client.ts
git commit -m "feat: add passwordless client auth helpers (Google, magic link, guest upgrade)"
```

---

## Task 5: Rework the login page

**Files:**
- Create: `mychess/src/routes/login/+page.ts`
- Modify: `mychess/src/routes/login/+page.svelte`
- Test: `mychess/src/routes/login/login.test.ts`

- [ ] **Step 1: Add a universal load for the error param**

Create `mychess/src/routes/login/+page.ts`:
```ts
import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
  return { error: url.searchParams.get('error') };
};
```

- [ ] **Step 2: Write the failing component test**

Create `mychess/src/routes/login/login.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/auth/client', () => ({
  sendMagicLink: vi.fn(async () => ({ ok: true })),
  startGoogle: vi.fn(async () => ({ ok: true }))
}));

import Login from './+page.svelte';

afterEach(() => cleanup());

describe('login page', () => {
  it('renders Google, email, and keep-signed-in — no password field', () => {
    render(Login, { props: { data: { error: null } } });
    expect(screen.getByRole('button', { name: /Google/i })).toBeTruthy();
    expect(screen.getByLabelText(/Email/i)).toBeTruthy();
    expect(screen.getByLabelText(/Keep me signed in/i)).toBeTruthy();
    expect(screen.queryByLabelText(/Password/i)).toBeNull();
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

- [ ] **Step 3: Run test to verify it fails**

Run (from `mychess/`): `npx vitest run src/routes/login/login.test.ts`
Expected: FAIL — the current page has password fields / no Google button / no `data` prop.

- [ ] **Step 4: Replace the login page**

Replace the entire contents of `mychess/src/routes/login/+page.svelte` with:
```svelte
<script lang="ts">
  import { sendMagicLink, startGoogle } from '$lib/auth/client';

  let { data } = $props<{ data: { error: string | null } }>();

  let email = $state('');
  let keepSignedIn = $state(true);
  let error = $state(data.error ?? '');
  let loading = $state(false);
  let sent = $state(false);

  async function google() {
    loading = true; error = '';
    const r = await startGoogle(keepSignedIn);
    if (!r.ok) { error = r.error ?? 'Google sign-in failed'; loading = false; }
    // On success the browser redirects to Google.
  }

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
      <button
        onclick={google}
        disabled={loading}
        class="flex items-center justify-center gap-2 border border-gray-300 rounded-xl py-3 font-medium text-gray-700 hover:bg-gray-50 transition disabled:opacity-50">
        <span aria-hidden="true">G</span> Continue with Google
      </button>

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

- [ ] **Step 5: Run test to verify it passes**

Run (from `mychess/`): `npx vitest run src/routes/login/login.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**
```bash
git add "mychess/src/routes/login/+page.ts" "mychess/src/routes/login/+page.svelte" "mychess/src/routes/login/login.test.ts"
git commit -m "feat: passwordless login page (Google + magic link + keep-signed-in)"
```

---

## Task 6: Full verification

**Files:** none.

- [ ] **Step 1: Suite + type-check**

Run (from `mychess/`):
```bash
npx vitest run 2>&1 | tail -4
npm run check 2>&1 | tail -3
```
Expected: all tests pass (prior count + `cookies` (2) + `login` (3)); `npm run check` error count equals the known pre-existing set only (no new files with errors).

- [ ] **Step 2: Manual smoke (after Supabase Google + SMTP configured, deployed)**
  - Logged-out `/login`: Google button + email + "Keep me signed in", no password field.
  - Google sign-in → returns via `/auth/callback` → signed in on `/`.
  - Email → "check your email" → click link → signed in.
  - Guest: try a drill, then `/login` → sign in with email → same account (progress intact).
  - Uncheck "Keep me signed in" → after sign-in, DevTools shows the `sb-…-auth-token` cookie has no Expires/Max-Age (session cookie).
  - Brand-new real user → redirected to `/welcome` to pick role/name.

- [ ] **Step 3: Commit any residual fixes** (otherwise nothing).

---

## Self-Review Notes

- **Spec coverage:** Google + magic-link fresh flows — Task 4/5; anonymous upgrade (linkIdentity/updateUser) — Task 4; callback code+token_hash+next+error — Task 3; keep-signed-in (marker + `sessionCookieOptions` + hooks) — Tasks 1/2/4/5; login rework (no password/toggle, check-email) — Task 5; testing — Tasks 1/5/6. All spec sections mapped.
- **Type consistency:** `sendMagicLink(email, keepSignedIn)` / `startGoogle(keepSignedIn)` return `AuthResult` (`{ ok, error? }`) — defined in Task 4, consumed in Task 5's page and mocked in its test. `sessionCookieOptions(options, noPersist)` signature identical in Tasks 1 and 2. `sb-no-persist` marker value `'1'` written in Task 4 and read in Task 2. Login page `data: { error }` shape from Task 5's `+page.ts` matches the test props.
- **Placeholder scan:** every code step has full code + exact commands.
- **Risk:** keep-signed-in is contained in `sessionCookieOptions` (unit-tested) + the marker cookie; if flaky it can be reverted to always-persist without touching the auth flows. Google/SMTP are external prereqs; the component test mocks the client so the suite is independent of them.
