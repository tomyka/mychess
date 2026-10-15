# mychess UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the gamified kid-oriented dark dashboard with a clean, professional chess player interface inspired by chessreps.com.

**Architecture:** Add a persistent top NavBar to the root layout, rework the dashboard with new focused components (PlayerHeader, StatsRow, QuickActions, CoachNoteBanner), scaffold FIDE rating display, then mechanically sweep all remaining dark-themed pages to the new light palette.

**Tech Stack:** SvelteKit 2, Svelte 5 (runes mode), Tailwind CSS 4, Supabase, TypeScript

---

## Chunk 1: Design Foundations + NavBar

### Task 1: Update global theme colour and add CSS custom properties

**Files:**
- Modify: `mychess/src/app.html`
- Modify: `mychess/src/app.css`

- [ ] **Step 1: Update theme-color in app.html**

Only change the `theme-color` meta value. The current file is:

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<meta name="text-scale" content="scale" />
		<meta name="theme-color" content="#f59e0b" />
		<link rel="manifest" href="/manifest.json" />
		<link rel="icon" href="/icon-192.png" />
		<link rel="apple-touch-icon" href="/icon-192.png" />
		<link rel="stylesheet" href="%sveltekit.assets%/app.css" />
		%sveltekit.head%
	</head>
	<body data-sveltekit-preload-data="hover">
		<div style="display: contents">%sveltekit.body%</div>
	</body>
</html>
```

Change **only** the `theme-color` content from `#f59e0b` to `#4f46e5`. All other tags must remain exactly as-is.

- [ ] **Step 2: Add CSS custom properties to app.css**

```css
@import 'tailwindcss';
@import 'chessground/assets/chessground.base.css';
@import 'chessground/assets/chessground.brown.css';
@import 'chessground/assets/chessground.cburnett.css';

:root {
  --color-accent: #4f46e5;
  --color-accent-hover: #4338ca;
  --color-bg: #f9fafb;
  --color-surface: #ffffff;
  --color-border: #e5e7eb;
  --color-text: #111827;
  --color-muted: #6b7280;
}
```

- [ ] **Step 3: Commit**

```bash
git add mychess/src/app.html mychess/src/app.css
git commit -m "style: update theme colour to indigo, add CSS custom properties"
```

---

### Task 2: Create sign-out route

**Files:**
- Create: `mychess/src/routes/auth/signout/+server.ts`

- [ ] **Step 1: Create the sign-out server handler**

```typescript
// mychess/src/routes/auth/signout/+server.ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals: { supabase } }) => {
  await supabase.auth.signOut();
  throw redirect(303, '/login');
};
```

- [ ] **Step 2: Verify build passes**

```bash
cd mychess && npm run build 2>&1 | Select-Object -Last 30
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add mychess/src/routes/auth/signout/+server.ts
git commit -m "feat: add POST /auth/signout endpoint"
```

---

### Task 3: Create NavBar component

**Files:**
- Create: `mychess/src/lib/components/NavBar.svelte`

- [ ] **Step 1: Create the NavBar component**

Notes on two design decisions baked into this code:
- `userMenuOpen` and `mobileMenuOpen` are **separate states** to avoid the dropdown opening when the hamburger fires and vice versa.
- "Get started" links to `/login?signup=1` — this is correct. `/login` detects the `signup=1` query param and shows the sign-up form. The `/join/[token]` route is only for coach invite tokens and is not relevant for the public CTA.
- Coach nav does **not** include Tournaments per spec: coach-role users see only "Coach Dashboard".

```svelte
<!-- mychess/src/lib/components/NavBar.svelte -->
<script lang="ts">
  import { page } from '$app/stores';

  let { user, profile } = $props<{ user: any; profile: any }>();

  let userMenuOpen = $state(false);
  let mobileMenuOpen = $state(false);

  const isCoach = $derived((profile as any)?.role === 'coach');
  const isGuest = $derived(!user || user.is_anonymous);
  const pathname = $derived($page.url.pathname);

  function active(paths: string[]): boolean {
    return paths.some(p => pathname === p || pathname.startsWith(p + '/'));
  }

  function linkClass(paths: string[]): string {
    return active(paths)
      ? 'text-indigo-600 font-semibold border-b-2 border-indigo-600 pb-0.5'
      : 'text-gray-600 hover:text-gray-900 transition-colors';
  }
</script>

<nav class="sticky top-0 z-50 bg-white border-b border-gray-200">
  <div class="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">

    <!-- Logo -->
    <a href="/" class="flex items-center gap-2 font-bold text-gray-900 shrink-0">
      <span class="text-xl">♟</span>
      <span class="text-base">mychess</span>
    </a>

    <!-- Desktop nav links -->
    <div class="hidden md:flex items-center gap-6 text-sm">
      {#if isCoach}
        <a href="/coach" class={linkClass(['/coach'])}>Coach Dashboard</a>
      {:else if !isGuest}
        <a href="/" class={linkClass(['/'])}>Dashboard</a>
        <a href="/tournaments" class={linkClass(['/tournaments'])}>Tournaments</a>
        <a href="/learn" class={linkClass(['/learn', '/drill', '/practice', '/time-trial'])}>Learn</a>
        <a href="/repertoires" class={linkClass(['/repertoires'])}>Repertoires</a>
      {:else}
        <a href="/tournaments" class={linkClass(['/tournaments'])}>Tournaments</a>
      {/if}
    </div>

    <!-- Right side -->
    <div class="flex items-center gap-3 text-sm shrink-0">
      {#if isGuest}
        <a href="/login" class="hidden sm:inline text-gray-600 hover:text-gray-900">Sign in</a>
        <a href="/login?signup=1"
           class="bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors">
          Get started
        </a>
      {:else}
        <!-- Streak badge (player only) -->
        {#if !isCoach && (profile as any)?.streak_days > 0}
          <span class="text-orange-500 font-medium text-sm hidden sm:inline">
            🔥 {(profile as any).streak_days}
          </span>
        {/if}

        <!-- User dropdown (desktop) -->
        <div class="relative hidden md:block">
          <button
            onclick={() => { userMenuOpen = !userMenuOpen; }}
            class="flex items-center gap-1.5 text-gray-700 hover:text-gray-900 font-medium"
          >
            <span class="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center">
              {((profile as any)?.display_name ?? 'P')[0].toUpperCase()}
            </span>
            <span class="text-sm">{(profile as any)?.display_name ?? 'Player'}</span>
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {#if userMenuOpen}
            <button
              class="fixed inset-0 z-10"
              aria-label="Close menu"
              onclick={() => userMenuOpen = false}
            ></button>
            <div class="absolute right-0 mt-2 w-44 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1 text-sm">
              <a href="/settings" onclick={() => userMenuOpen = false}
                 class="block px-4 py-2 text-gray-700 hover:bg-gray-50">Settings</a>
              {#if !isCoach}
                <a href="/cosmetics" onclick={() => userMenuOpen = false}
                   class="block px-4 py-2 text-gray-700 hover:bg-gray-50">Customise</a>
                <a href="/badges" onclick={() => userMenuOpen = false}
                   class="block px-4 py-2 text-gray-700 hover:bg-gray-50">Badges</a>
              {/if}
              <div class="border-t border-gray-100 my-1"></div>
              <form method="POST" action="/auth/signout">
                <button type="submit" class="w-full text-left px-4 py-2 text-red-600 hover:bg-gray-50">
                  Sign out
                </button>
              </form>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Mobile hamburger -->
      <button
        class="md:hidden text-gray-600 hover:text-gray-900"
        aria-label="Toggle mobile menu"
        onclick={() => { mobileMenuOpen = !mobileMenuOpen; userMenuOpen = false; }}
      >
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d={mobileMenuOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'} />
        </svg>
      </button>
    </div>
  </div>

  <!-- Mobile menu -->
  {#if mobileMenuOpen}
    <div class="md:hidden border-t border-gray-100 bg-white px-4 py-3 flex flex-col gap-3 text-sm">
      {#if isCoach}
        <a href="/coach" onclick={() => mobileMenuOpen = false} class="text-gray-700 font-medium">Coach Dashboard</a>
      {:else if !isGuest}
        <a href="/" onclick={() => mobileMenuOpen = false} class="text-gray-700 font-medium">Dashboard</a>
        <a href="/tournaments" onclick={() => mobileMenuOpen = false} class="text-gray-700">Tournaments</a>
        <a href="/learn" onclick={() => mobileMenuOpen = false} class="text-gray-700">Learn</a>
        <a href="/repertoires" onclick={() => mobileMenuOpen = false} class="text-gray-700">Repertoires</a>
        <div class="border-t border-gray-100 pt-2">
          <a href="/settings" onclick={() => mobileMenuOpen = false} class="block text-gray-600">Settings</a>
          <a href="/cosmetics" onclick={() => mobileMenuOpen = false} class="block text-gray-600 mt-2">Customise</a>
          <a href="/badges" onclick={() => mobileMenuOpen = false} class="block text-gray-600 mt-2">Badges</a>
          <form method="POST" action="/auth/signout" class="mt-2">
            <button type="submit" class="text-red-600">Sign out</button>
          </form>
        </div>
      {:else}
        <a href="/tournaments" onclick={() => mobileMenuOpen = false} class="text-gray-700">Tournaments</a>
        <a href="/login" onclick={() => mobileMenuOpen = false} class="text-gray-700">Sign in</a>
        <a href="/login?signup=1" onclick={() => mobileMenuOpen = false}
           class="text-indigo-600 font-medium">Get started</a>
      {/if}
    </div>
  {/if}
</nav>

- [ ] **Step 2: Commit**

```bash
git add mychess/src/lib/components/NavBar.svelte
git commit -m "feat: add NavBar component with auth-aware nav links and user dropdown"
```

---

### Task 4: Wire NavBar into root layout + remove old guest banner

**Files:**
- Modify: `mychess/src/routes/+layout.svelte`
- Modify: `mychess/src/routes/(kid)/+layout.svelte`

- [ ] **Step 1: Update root layout to include NavBar**

The root `+layout.server.ts` already returns `{ user, session, profile }`. Exclude nav from auth-only pages.

```svelte
<!-- mychess/src/routes/+layout.svelte -->
<script lang="ts">
  import '../app.css';
  import { QueryClientProvider, QueryClient } from '@tanstack/svelte-query';
  import NavBar from '$lib/components/NavBar.svelte';
  import { page } from '$app/stores';

  let { children, data } = $props<{ children: any; data: any }>();

  const queryClient = new QueryClient();

  // Do not show nav on standalone auth pages
  const hideNav = $derived(
    ['/login', '/welcome', '/join'].some(p => $page.url.pathname.startsWith(p))
  );
</script>

<QueryClientProvider client={queryClient}>
  {#if !hideNav}
    <NavBar user={(data as any)?.user} profile={(data as any)?.profile} />
  {/if}
  {@render children()}
</QueryClientProvider>
```

- [ ] **Step 2: Remove yellow guest banner from (kid) layout**

The NavBar now handles the guest state (no authenticated links shown). Replace the banner with minimal passthrough:

```svelte
<!-- mychess/src/routes/(kid)/+layout.svelte -->
<script lang="ts">
  let { children } = $props<{ children: any }>();
</script>

{@render children()}
```

- [ ] **Step 3: Run build to verify no errors**

```bash
cd mychess && npm run build 2>&1 | Select-Object -Last 30
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add mychess/src/routes/+layout.svelte mychess/src/routes/(kid)/+layout.svelte
git commit -m "feat: wire NavBar into root layout, remove kid guest banner"
```

---

## Chunk 2: Dashboard + New Components + FIDE Scaffold

### Task 5: Add fide_id and fide_rating to profiles table

**Files:**
- Create: `mychess/supabase/migrations/0010_fide_fields.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- mychess/supabase/migrations/0010_fide_fields.sql
alter table profiles add column if not exists fide_id text;
alter table profiles add column if not exists fide_rating integer;
```

- [ ] **Step 2: Apply the migration to Supabase**

Run via the Supabase dashboard SQL editor, or using the Supabase CLI if configured:

```bash
# If supabase CLI is available:
cd mychess && npx supabase db push
# Otherwise: paste the SQL into Supabase Dashboard → SQL Editor and run it
```

- [ ] **Step 3: Commit the migration file**

```bash
git add mychess/supabase/migrations/0010_fide_fields.sql
git commit -m "db: add fide_id and fide_rating columns to profiles"
```

---

### Task 6: Create PlayerHeader component

**Files:**
- Create: `mychess/src/lib/components/PlayerHeader.svelte`

- [ ] **Step 1: Create the component**

```svelte
<!-- mychess/src/lib/components/PlayerHeader.svelte -->
<script lang="ts">
  let { profile } = $props<{ profile: any }>();

  const p = $derived(profile as any);
  const initials = $derived((p?.display_name ?? 'P').slice(0, 2).toUpperCase());
</script>

<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-center gap-4">
  <!-- Avatar circle -->
  <div class="w-14 h-14 rounded-full bg-indigo-100 text-indigo-700 font-bold text-xl flex items-center justify-center shrink-0">
    {initials}
  </div>

  <!-- Identity -->
  <div class="flex-1 min-w-0">
    <h1 class="text-xl font-bold text-gray-900 truncate">{p?.display_name ?? 'Player'}</h1>
    {#if p?.fide_id}
      <p class="text-sm text-gray-500">FIDE ID: {p.fide_id}</p>
    {:else}
      <a href="/settings" class="text-xs text-indigo-600 hover:underline">Link FIDE account →</a>
    {/if}
  </div>

  <!-- FIDE Rating badge -->
  <div class="text-right shrink-0">
    {#if p?.fide_rating}
      <p class="text-3xl font-bold text-gray-900">{p.fide_rating}</p>
      <p class="text-xs text-gray-400 uppercase tracking-wide">FIDE Classical</p>
    {:else}
      <p class="text-3xl font-bold text-gray-300">––</p>
      <p class="text-xs text-gray-400 uppercase tracking-wide">FIDE Rating</p>
    {/if}
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add mychess/src/lib/components/PlayerHeader.svelte
git commit -m "feat: add PlayerHeader component with FIDE rating display"
```

---

### Task 7: Create StatsRow component

**Files:**
- Create: `mychess/src/lib/components/StatsRow.svelte`

- [ ] **Step 1: Create the component**

```svelte
<!-- mychess/src/lib/components/StatsRow.svelte -->
<script lang="ts">
  let { streakDays = 0 } = $props<{ streakDays?: number }>();
</script>

<div class="grid grid-cols-3 gap-3">
  <!-- Country rank — placeholder until FIDE API integration -->
  <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-3 text-center">
    <p class="text-xl font-bold text-gray-400">––</p>
    <p class="text-xs text-gray-400 mt-0.5">Country rank</p>
  </div>

  <!-- Age group rank — placeholder -->
  <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-3 text-center">
    <p class="text-xl font-bold text-gray-400">––</p>
    <p class="text-xs text-gray-400 mt-0.5">Age group rank</p>
  </div>

  <!-- Streak -->
  <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-3 text-center">
    <p class="text-xl font-bold {streakDays > 0 ? 'text-orange-500' : 'text-gray-300'}">
      {streakDays > 0 ? `🔥 ${streakDays}` : '–'}
    </p>
    <p class="text-xs text-gray-400 mt-0.5">Day streak</p>
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add mychess/src/lib/components/StatsRow.svelte
git commit -m "feat: add StatsRow component (country/age rank placeholders + streak)"
```

---

### Task 8: Create QuickActions component

**Files:**
- Create: `mychess/src/lib/components/QuickActions.svelte`

- [ ] **Step 1: Create the component**

```svelte
<!-- mychess/src/lib/components/QuickActions.svelte -->
<script lang="ts">
  let { totalReviews = 0 } = $props<{ totalReviews?: number }>();

  const actions = [
    {
      href: '/learn',
      label: 'Daily Review',
      sublabel: `${totalReviews} cards done`,
      primary: true
    },
    { href: '/practice', label: 'Practice', sublabel: 'Full board', primary: false },
    { href: '/drill',    label: 'Drill',    sublabel: 'No mistakes', primary: false },
    { href: '/time-trial', label: 'Time Trial', sublabel: '60 seconds', primary: false }
  ];
</script>

<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
  {#each actions as action}
    <a
      href={action.href}
      class="flex flex-col items-center justify-center p-4 rounded-xl border transition-all
             {action.primary
               ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
               : 'bg-white text-gray-700 border-gray-200 shadow-sm hover:shadow-md hover:border-gray-300'}"
    >
      <span class="font-semibold text-sm">{action.label}</span>
      <span class="text-xs mt-0.5 {action.primary ? 'text-indigo-200' : 'text-gray-400'}">
        {action.sublabel}
      </span>
    </a>
  {/each}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add mychess/src/lib/components/QuickActions.svelte
git commit -m "feat: add QuickActions component (4 study mode buttons)"
```

---

### Task 9: Create CoachNoteBanner component

**Files:**
- Create: `mychess/src/lib/components/CoachNoteBanner.svelte`

- [ ] **Step 1: Create the component**

```svelte
<!-- mychess/src/lib/components/CoachNoteBanner.svelte -->
<script lang="ts">
  let { note, ondismiss } = $props<{ note: { id: string; message: string }; ondismiss: () => void }>();
</script>

<div class="bg-indigo-50 border-l-4 border-indigo-400 rounded-r-xl p-4 flex items-start gap-3">
  <div class="flex-1">
    <p class="text-indigo-700 font-semibold text-sm">Coach note</p>
    <p class="text-gray-700 text-sm mt-0.5">{note.message}</p>
  </div>
  <button
    onclick={ondismiss}
    class="text-gray-400 hover:text-gray-600 text-sm mt-0.5 shrink-0"
    aria-label="Dismiss"
  >✕</button>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add mychess/src/lib/components/CoachNoteBanner.svelte
git commit -m "feat: add CoachNoteBanner replacing SirKnight on dashboard"
```

---

### Task 10: Update dashboard server load — add isGuest flag

**Files:**
- Modify: `mychess/src/routes/(kid)/+page.server.ts`

The `safeGetSession` in `hooks.server.ts` always creates an anonymous session — so `user` is almost never null. The correct way to detect guests is via `user.is_anonymous`. The root `+layout.server.ts` already returns `isGuest`, but `(kid)/+page.server.ts` must also pass it down and the profile query already returns `fide_id`/`fide_rating` via `select('*')` in hooks.server.ts.

- [ ] **Step 1: Add isGuest to +page.server.ts return value**

In `mychess/src/routes/(kid)/+page.server.ts`, change the early return and final return to include `isGuest`:

```typescript
// Change the early-return line from:
if (!user) return { session: null, profile: null, upcomingTournaments: upcomingTournaments ?? [] };

// to:
const isGuest = !user || !!(user as any).is_anonymous;
if (!user) return { session: null, isGuest: true, profile: null, upcomingTournaments: upcomingTournaments ?? [] };
```

And in the final return object, add `isGuest`:

```typescript
return {
  session,
  isGuest,
  profile,
  stats: { ... },  // unchanged
  quests,
  leaderboard: lbEntries,
  unreadNote: noteRes.data ?? null,
  avatarId: p?.avatar_id ?? 'knight',
  upcomingTournaments: upcomingTournaments ?? []
};
```

- [ ] **Step 2: Verify fide fields are included in profile**

`safeGetSession` in `hooks.server.ts` does `select('*')`, so after migration 0010 the `fide_id` and `fide_rating` fields will be on the profile object automatically. No changes needed there.

```bash
cd D:\Projects\mychess
Select-String -Path "mychess\src\hooks.server.ts" -Pattern "select\(" | Select-Object -First 5
```

Expected: `select('*')` — confirms all columns are fetched.

- [ ] **Step 3: Commit**

```bash
git add mychess/src/routes/(kid)/+page.server.ts
git commit -m "fix: pass isGuest flag from dashboard server load to page"
```

---

### Task 11: Rework the dashboard page

**Files:**
- Modify: `mychess/src/routes/(kid)/+page.svelte`

- [ ] **Step 1: Rewrite the dashboard page**

Replace the entire contents of `mychess/src/routes/(kid)/+page.svelte` with:

```svelte
<script lang="ts">
  import PlayerHeader from '$lib/components/PlayerHeader.svelte';
  import StatsRow from '$lib/components/StatsRow.svelte';
  import QuickActions from '$lib/components/QuickActions.svelte';
  import CoachNoteBanner from '$lib/components/CoachNoteBanner.svelte';

  let { data } = $props<{ data: any }>();

  const d = $derived(data as any);
  const stats = $derived(d.stats ?? {});
  const profile = $derived(d.profile as any);
  const quests = $derived(d.quests ?? []);

  let noteDismissed = $state(false);

  async function dismissNote() {
    if (!d.unreadNote) return;
    noteDismissed = true;
    await fetch('/api/notes/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteId: d.unreadNote.id })
    });
  }
</script>

<svelte:head>
  <title>Dashboard — mychess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
  <div class="max-w-3xl mx-auto px-4 py-6 space-y-4">

    {#if data.isGuest}
      <!-- Guest landing -->
      <div class="py-12 text-center">
        <h1 class="text-3xl font-bold text-gray-900 mb-3">Your chess, all in one place</h1>
        <p class="text-gray-500 mb-8">
          FIDE rating, national standings, and local OTB tournaments — your daily dashboard.
        </p>
        <div class="flex justify-center gap-3 mb-12">
          <a href="/tournaments"
             class="px-5 py-2.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors">
            Browse tournaments
          </a>
          <a href="/login"
             class="px-5 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors">
            Sign in
          </a>
        </div>

        {#if data.upcomingTournaments?.length > 0}
          <h2 class="text-lg font-semibold text-gray-900 mb-4 text-left">Upcoming tournaments</h2>
          <div class="grid gap-3 sm:grid-cols-3 text-left">
            {#each data.upcomingTournaments as t}
              <a href="/tournaments/{t.id}"
                 class="bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:shadow-md transition-shadow block">
                <p class="font-medium text-sm text-gray-900 mb-1">{t.name}</p>
                <p class="text-xs text-gray-500">
                  {t.start_date ? new Date(t.start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}
                  {t.city ? ` · ${t.city}` : ''}
                </p>
              </a>
            {/each}
          </div>
          <a href="/tournaments" class="text-sm text-indigo-600 hover:underline mt-4 inline-block">
            View all tournaments →
          </a>
        {/if}
      </div>

    {:else}
      <!-- Authenticated dashboard -->

      <!-- Coach note banner -->
      {#if d.unreadNote && !noteDismissed}
        <CoachNoteBanner note={d.unreadNote} ondismiss={dismissNote} />
      {/if}

      <!-- Player identity + FIDE rating -->
      <PlayerHeader {profile} />

      <!-- Country/age/streak stats -->
      <StatsRow streakDays={stats.streak_days ?? 0} />

      <!-- Quick study actions -->
      <QuickActions totalReviews={stats.total_reviews ?? 0} />

      <!-- Today's tasks -->
      {#if quests.length > 0}
        <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 class="font-semibold text-gray-900 mb-4">Today's tasks</h2>
          <ul class="space-y-4">
            {#each quests as quest}
              <li class="flex items-center gap-3">
                <div class="flex-1">
                  <div class="flex justify-between text-sm mb-1.5">
                    <span class="{quest.completed ? 'line-through text-gray-400' : 'text-gray-700'}">
                      {quest.description}
                    </span>
                    <span class="text-gray-400 text-xs">{quest.progress}/{quest.target}</span>
                  </div>
                  <div class="bg-gray-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      class="h-full rounded-full transition-all {quest.completed ? 'bg-green-500' : 'bg-indigo-500'}"
                      style="width: {Math.min(100, (quest.progress / quest.target) * 100)}%"
                    ></div>
                  </div>
                </div>
                {#if quest.completed}
                  <span class="text-green-500 shrink-0" aria-label="Complete">✓</span>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <!-- Upcoming tournaments widget -->
      {#if data.upcomingTournaments?.length > 0}
        <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div class="flex items-center justify-between mb-4">
            <h2 class="font-semibold text-gray-900">Upcoming tournaments</h2>
            <a href="/tournaments" class="text-sm text-indigo-600 hover:underline">View all →</a>
          </div>
          <div class="space-y-3">
            {#each data.upcomingTournaments as t}
              <a href="/tournaments/{t.id}"
                 class="flex justify-between items-center py-2 border-b border-gray-100 last:border-0 hover:bg-gray-50 -mx-2 px-2 rounded transition-colors">
                <div>
                  <p class="text-sm font-medium text-gray-900">{t.name}</p>
                  <p class="text-xs text-gray-500">
                    {t.city ?? ''}
                    {t.start_date ? new Date(t.start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}
                  </p>
                </div>
                <span class="text-gray-400 text-xs">→</span>
              </a>
            {/each}
          </div>
        </section>
      {/if}

    {/if}
  </div>
</main>
```

- [ ] **Step 2: Run build to verify no errors**

```bash
cd mychess && npm run build 2>&1 | Select-Object -Last 30
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add mychess/src/routes/(kid)/+page.svelte
git commit -m "feat: rework dashboard with PlayerHeader, StatsRow, QuickActions, CoachNoteBanner"
```

---

## Chunk 3: Global Light Theme Cleanup

### Task 12: Settings page — FIDE field + light theme

**Files:**
- Modify: `mychess/src/routes/(kid)/settings/+page.svelte`
- Modify: `mychess/src/routes/(kid)/settings/+page.server.ts`

- [ ] **Step 1: Update settings server to save fide_id**

In `mychess/src/routes/(kid)/settings/+page.server.ts`, update the load and save action:

In the `load` function, add to the profile select:

```typescript
const { data: p } = await supabase
  .from('profiles')
  .select('display_name, chesscom_username, lichess_username, fide_id')
  .eq('id', user.id)
  .single();

return {
  session,
  profile,
  displayName: p?.display_name ?? '',
  chesscomUsername: (p as any)?.chesscom_username ?? '',
  lichessUsername: (p as any)?.lichess_username ?? '',
  fideId: (p as any)?.fide_id ?? ''
};
```

In the `save` action, handle `fide_id`:

```typescript
const fideId = (fd.get('fide_id') as string ?? '').trim();

const { error } = await supabase
  .from('profiles')
  .update({
    chesscom_username: chesscomUsername || null,
    lichess_username: lichessUsername || null,
    fide_id: fideId || null
  } as any)
  .eq('id', user.id);
```

- [ ] **Step 2: Rewrite settings page with light theme + FIDE field**

Replace `mychess/src/routes/(kid)/settings/+page.svelte` with:

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';

  let { data, form } = $props<{ data: any; form: any }>();

  const d = $derived(data as any);
  let importing = $state<'chesscom' | 'lichess' | null>(null);
  let importResult = $state<string | null>(null);

  async function importGames(platform: 'chesscom' | 'lichess') {
    importing = platform;
    importResult = null;
    try {
      const res = await fetch(`/api/import/${platform}`, { method: 'POST' });
      const body = await res.json();
      if (body.count !== undefined) {
        importResult = `Imported ${body.count} game(s) as a new repertoire.`;
      } else {
        importResult = body.error ?? 'Import failed';
      }
    } catch {
      importResult = 'Network error';
    } finally {
      importing = null;
    }
  }
</script>

<svelte:head>
  <title>Settings — mychess</title>
</svelte:head>

<div class="min-h-screen bg-gray-50">
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-5">
    <h1 class="text-2xl font-bold text-gray-900">Settings</h1>

    {#if form?.success}
      <p class="text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-sm">
        Saved successfully.
      </p>
    {/if}
    {#if form?.error}
      <p class="text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm">
        {form.error}
      </p>
    {/if}

    <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h2 class="font-semibold text-gray-900 mb-4">Connected accounts</h2>
      <form method="POST" action="?/save" use:enhance class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1" for="fide_id">FIDE ID</label>
          <input
            id="fide_id"
            name="fide_id"
            type="text"
            value={d.fideId}
            placeholder="e.g. 1503014"
            class="w-full bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          <p class="text-xs text-gray-400 mt-1">Your FIDE ID number (find it at ratings.fide.com)</p>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1" for="chesscom">Chess.com username</label>
          <input
            id="chesscom"
            name="chesscom_username"
            type="text"
            value={d.chesscomUsername}
            placeholder="e.g. MagnusCarlsen"
            class="w-full bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1" for="lichess">Lichess username</label>
          <input
            id="lichess"
            name="lichess_username"
            type="text"
            value={d.lichessUsername}
            placeholder="e.g. DrNykterstein"
            class="w-full bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        <button
          type="submit"
          class="bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors">
          Save
        </button>
      </form>
    </section>

    <!-- Game import -->
    <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h2 class="font-semibold text-gray-900 mb-4">Import games</h2>
      <p class="text-sm text-gray-500 mb-4">
        Import your recent games as a new repertoire. Connect your platform usernames above first.
      </p>

      {#if importResult}
        <p class="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 mb-4">
          {importResult}
        </p>
      {/if}

      <div class="flex gap-3">
        <button
          onclick={() => importGames('chesscom')}
          disabled={importing !== null}
          class="flex-1 border border-gray-300 text-gray-700 px-4 py-2.5 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors text-sm">
          {importing === 'chesscom' ? 'Importing…' : 'Import from Chess.com'}
        </button>
        <button
          onclick={() => importGames('lichess')}
          disabled={importing !== null}
          class="flex-1 border border-gray-300 text-gray-700 px-4 py-2.5 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors text-sm">
          {importing === 'lichess' ? 'Importing…' : 'Import from Lichess'}
        </button>
      </div>
    </section>
  </div>
</div>
```

- [ ] **Step 3: Build verify**

```bash
cd mychess && npm run build 2>&1 | Select-Object -Last 30
```

- [ ] **Step 4: Commit**

```bash
git add mychess/src/routes/(kid)/settings/+page.svelte mychess/src/routes/(kid)/settings/+page.server.ts
git commit -m "feat: settings page light theme + FIDE ID field"
```

---

### Task 13: Login page light theme

**Files:**
- Modify: `mychess/src/routes/login/+page.svelte`

- [ ] **Step 1: Rewrite login page with light theme**

Replace `mychess/src/routes/login/+page.svelte` with:

```svelte
<script lang="ts">
  import { createSupabaseClient } from '$lib/supabase/client';
  import { page } from '$app/stores';

  const sb = createSupabaseClient();

  let email = $state('');
  let password = $state('');
  let mode = $state<'login' | 'signup'>($page.url.searchParams.get('signup') === '1' ? 'signup' : 'login');
  let error = $state('');
  let loading = $state(false);

  async function submit() {
    loading = true;
    error = '';
    try {
      if (mode === 'login') {
        const { error: err } = await sb.auth.signInWithPassword({ email, password });
        if (err) { error = err.message; loading = false; return; }
      } else {
        const { data: { user } } = await sb.auth.getUser();
        if (user?.is_anonymous) {
          const { error: err } = await sb.auth.updateUser({ email, password });
          if (err) { error = err.message; loading = false; return; }
        } else {
          const { error: err } = await sb.auth.signUp({ email, password });
          if (err) { error = err.message; loading = false; return; }
        }
      }
      window.location.href = '/';
    } catch (e: any) {
      error = e.message ?? 'Something went wrong';
      loading = false;
    }
  }
</script>

<main class="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-8 p-6">
  <div class="text-center">
    <a href="/" class="flex items-center justify-center gap-2 font-bold text-gray-900 mb-2">
      <span class="text-3xl">♟</span>
      <span class="text-2xl">mychess</span>
    </a>
    <p class="text-gray-500">Your daily chess dashboard</p>
  </div>

  {#if mode === 'signup'}
    <p class="text-indigo-700 text-sm bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2 max-w-sm text-center">
      Create a free account to save your progress forever.
    </p>
  {/if}

  <div class="bg-white border border-gray-200 rounded-2xl shadow-sm p-8 w-full max-w-sm flex flex-col gap-5">
    <!-- Mode tabs -->
    <div class="flex rounded-lg overflow-hidden border border-gray-200">
      <button
        onclick={() => { mode = 'login'; error = ''; }}
        class="flex-1 py-2 text-sm font-semibold transition {mode === 'login' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'}">
        Sign in
      </button>
      <button
        onclick={() => { mode = 'signup'; error = ''; }}
        class="flex-1 py-2 text-sm font-semibold transition {mode === 'signup' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'}">
        Create account
      </button>
    </div>

    {#if error}
      <p class="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
    {/if}

    <div class="flex flex-col gap-3">
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
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="password">Password</label>
        <input
          id="password"
          type="password"
          bind:value={password}
          placeholder="••••••••"
          class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
    </div>

    <button
      onclick={submit}
      disabled={loading}
      class="bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 transition disabled:opacity-50">
      {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
    </button>

    <a href="/" class="text-center text-sm text-gray-500 hover:underline">Continue without account →</a>
  </div>
</main>
```

- [ ] **Step 2: Commit**

```bash
git add mychess/src/routes/login/+page.svelte
git commit -m "style: login page light theme"
```

---

### Task 14: Welcome page light theme

**Files:**
- Modify: `mychess/src/routes/welcome/+page.svelte`

- [ ] **Step 1: Rewrite with light theme**

Replace `mychess/src/routes/welcome/+page.svelte` with:

```svelte
<script lang="ts">
  let role = $state('kid');
  let { form } = $props<{ form: any }>();
</script>

<main class="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-8 p-6">
  <div class="text-center">
    <div class="flex items-center justify-center gap-2 font-bold text-gray-900 mb-3">
      <span class="text-3xl">♟</span>
      <span class="text-2xl">mychess</span>
    </div>
    <h1 class="text-2xl font-bold text-gray-900">Welcome! Tell us about yourself</h1>
    <p class="mt-1 text-gray-500">So we can set up your dashboard</p>
  </div>

  {#if form?.error}
    <p class="text-red-600 bg-red-50 border border-red-200 px-4 py-2 rounded-xl text-sm">{form.error}</p>
  {/if}

  <form method="POST" class="flex flex-col gap-4 w-full max-w-sm bg-white border border-gray-200 rounded-2xl shadow-sm p-8">
    <label class="flex flex-col gap-1.5">
      <span class="text-sm font-medium text-gray-700">Your name</span>
      <input
        name="display_name"
        required
        placeholder="e.g. Alex"
        class="rounded-lg px-4 py-2.5 border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </label>

    <div class="flex gap-3">
      {#each [{ id: 'kid', label: 'I am a Player' }, { id: 'coach', label: 'I am a Coach' }] as r}
        <button
          type="button"
          onclick={() => (role = r.id)}
          class="flex-1 py-3 px-2 rounded-xl font-semibold transition-all border-2
                 {role === r.id ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}"
        >
          <span class="text-sm">{r.label}</span>
        </button>
      {/each}
    </div>

    <input type="hidden" name="role" value={role} />

    <button
      type="submit"
      class="bg-indigo-600 text-white py-3 rounded-xl font-bold text-base hover:bg-indigo-700 transition-colors">
      Get started →
    </button>
  </form>
</main>
```

- [ ] **Step 2: Commit**

```bash
git add mychess/src/routes/welcome/+page.svelte
git commit -m "style: welcome page light theme"
```

---

### Task 15: Join page light theme

**Files:**
- Modify: `mychess/src/routes/join/[token]/+page.svelte`

- [ ] **Step 1: Rewrite with light theme**

Replace `mychess/src/routes/join/[token]/+page.svelte` with:

```svelte
<script lang="ts">
  import { createSupabaseClient } from '$lib/supabase/client';
  let { data } = $props<{ data: any }>();

  const sb = createSupabaseClient();

  async function signIn() {
    await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/join/${data.token}` }
    });
  }
</script>

<main class="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-8 p-6">
  {#if !data.valid}
    <div class="text-center">
      <p class="text-5xl mb-4">✕</p>
      <h1 class="text-2xl font-bold text-red-600">Invalid Invite</h1>
      <p class="text-gray-500 mt-2">This link is invalid or has expired.</p>
      <a href="/" class="mt-4 inline-block text-indigo-600 hover:underline text-sm">Go to dashboard →</a>
    </div>
  {:else if data.needsLogin}
    <div class="text-center bg-white border border-gray-200 rounded-2xl shadow-sm p-10 max-w-sm w-full">
      <span class="text-4xl">♟</span>
      <h1 class="text-2xl font-bold text-gray-900 mt-3">You've been invited to mychess</h1>
      <p class="text-gray-500 mt-2 mb-8">Sign in to join your coach and start training.</p>
      <button
        onclick={signIn}
        class="flex items-center justify-center gap-3 w-full bg-white border border-gray-300 text-gray-700 px-8 py-3.5 rounded-xl font-semibold hover:bg-gray-50 transition">
        Sign in with Google to accept
      </button>
    </div>
  {:else}
    <div class="text-center">
      <p class="text-gray-600">Setting up your account…</p>
    </div>
  {/if}
</main>
```

- [ ] **Step 2: Commit**

```bash
git add mychess/src/routes/join/[token]/+page.svelte
git commit -m "style: join/invite page light theme"
```

---

### Task 16: Repertoires page light theme

**Files:**
- Modify: `mychess/src/routes/(kid)/repertoires/+page.svelte`

- [ ] **Step 1: Update classes**

Replace `mychess/src/routes/(kid)/repertoires/+page.svelte` with:

```svelte
<script lang="ts">
  let { data } = $props<{ data: { repertoires: any[] } }>();
</script>

<svelte:head>
  <title>Repertoires — mychess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
  <div class="max-w-2xl mx-auto px-4 py-6">
    <h1 class="text-2xl font-bold text-gray-900 mb-6">My Repertoires</h1>

    {#if data.repertoires.length === 0}
      <div class="text-center py-16 text-gray-400">
        <p class="text-4xl mb-4">📚</p>
        <p class="font-semibold text-lg text-gray-500">No repertoires yet</p>
        <p class="text-sm mt-1">Ask your coach to upload a PGN for you.</p>
      </div>
    {:else}
      <ul class="space-y-2">
        {#each data.repertoires as rep}
          <li>
            <a href="/repertoires/{rep.id}"
               class="flex items-center gap-3 bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:shadow-md transition-shadow">
              <span class="w-3 h-3 rounded-full shrink-0" style="background:{rep.color ?? '#4f46e5'}"></span>
              <div class="flex-1 min-w-0">
                <h2 class="font-medium text-gray-900 truncate">{rep.name}</h2>
                <p class="text-sm text-gray-400">{rep.moves?.[0]?.count ?? 0} moves</p>
              </div>
              <span class="text-gray-400 text-sm">→</span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</main>
```

- [ ] **Step 2: Commit**

```bash
git add mychess/src/routes/(kid)/repertoires/+page.svelte
git commit -m "style: repertoires page light theme"
```

---

### Task 17: Learn page — full light theme rewrite

**Files:**
- Modify: `mychess/src/routes/(kid)/learn/+page.svelte`

Keep the entire `<script>` block (lines 1–77) unchanged. Replace everything below `</script>` with the new template:

- [ ] **Step 1: Replace the template section (below </script>)**

```svelte
<svelte:head>
  <title>Learn — mychess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50 p-4 max-w-lg mx-auto pb-24">
  {#if done}
    <div class="flex flex-col items-center justify-center min-h-screen gap-6 text-center">
      <p class="text-7xl">🎉</p>
      <h1 class="text-4xl font-bold text-gray-900">Session Complete!</h1>
      <div class="bg-white border border-gray-200 rounded-2xl p-6 w-full max-w-xs space-y-3 shadow-sm">
        <div class="flex justify-between">
          <span class="text-gray-400">XP Earned</span>
          <span class="text-indigo-600 font-bold">+{sessionXp}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-gray-400">Correct</span>
          <span class="text-green-600 font-bold">{correct}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-gray-400">Incorrect</span>
          <span class="text-red-600 font-bold">{incorrect}</span>
        </div>
      </div>
      <a href="/" class="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold text-lg hover:bg-indigo-700 transition">
        Back Home
      </a>
    </div>

  {:else if !current}
    <div class="flex flex-col items-center justify-center min-h-screen text-center gap-4">
      <p class="text-5xl">✅</p>
      <h1 class="text-2xl font-bold text-green-600">All caught up!</h1>
      <p class="text-gray-400">No cards due today. Come back tomorrow!</p>
      <a href="/" class="text-indigo-600 hover:underline">Back to Home</a>
    </div>

  {:else}
    <div class="flex items-center justify-between mb-4">
      <a href="/" class="text-gray-400 text-sm hover:text-gray-600">Home</a>
      <div class="flex items-center gap-3">
        <span class="text-indigo-600 font-bold text-sm">+{sessionXp} XP</span>
        <span class="text-gray-400 text-sm">{currentIdx + 1}/{initialQueue.length}</span>
      </div>
    </div>

    <div class="bg-gray-200 rounded-full h-2 mb-6 overflow-hidden">
      <div class="h-full bg-indigo-500 rounded-full transition-all duration-300"
           style="width: {(currentIdx / initialQueue.length) * 100}%"></div>
    </div>

    <p class="text-center text-gray-400 text-sm font-medium mb-2">
      {current.move?.repertoire?.name ?? 'Repertoire'} · {current.isNew ? '🆕 New' : '🔄 Review'}
    </p>
    <p class="text-center text-gray-700 font-semibold mb-4">{phase === 'guess' ? 'What is the best move?' : ''}</p>

    <ChessBoard fen={boardFen} interactable={phase === 'guess'} onmove={handleMove} />

    {#if wrongMove && phase === 'guess'}
      <p class="text-red-600 text-center mt-3 font-semibold animate-pulse">Not quite! Try again...</p>
    {/if}

    {#if phase === 'guess'}
      <div class="flex gap-3 mt-6">
        {#if !showHint}
          <button onclick={hint}
                  class="flex-1 bg-white border border-gray-300 py-3 rounded-xl font-semibold hover:bg-gray-50 transition text-gray-700">
            💡 Hint
          </button>
        {:else}
          <div class="flex-1 bg-gray-50 border border-gray-200 py-3 rounded-xl text-center text-sm text-gray-500">
            Hint: Play <strong class="text-indigo-600">{current.move?.san}</strong>
          </div>
        {/if}
        <button onclick={giveUp}
                class="flex-1 bg-red-50 border border-red-200 py-3 rounded-xl font-semibold hover:bg-red-100 transition text-red-600">
          Show Answer
        </button>
      </div>
    {:else}
      <div class="mt-6 p-5 bg-white border border-gray-200 rounded-2xl text-center shadow-sm">
        <p class="text-xl font-bold mb-1 {wrongMove ? 'text-gray-700' : 'text-green-600'}">
          {wrongMove ? 'Answer: ' + current.move?.san : '✅ Correct! ' + current.move?.san}
        </p>
        <button onclick={next}
                class="mt-4 w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-indigo-700 transition">
          {currentIdx + 1 < initialQueue.length ? 'Next →' : 'Finish'}
        </button>
      </div>
    {/if}
  {/if}
</main>
```

- [ ] **Step 2: Build verify**

```powershell
cd D:\Projects\mychess\mychess; npm run build 2>&1 | Select-Object -Last 30
```

- [ ] **Step 3: Commit**

```bash
git add "mychess/src/routes/(kid)/learn/+page.svelte"
git commit -m "style: learn page full light theme rewrite"
```

---

### Task 18: Practice page — full light theme rewrite

**Files:**
- Modify: `mychess/src/routes/(kid)/practice/+page.svelte`

Keep `<script>` block (lines 1–55) unchanged. Replace everything below `</script>`:

- [ ] **Step 1: Replace template section**

```svelte
<svelte:head>
  <title>Practice — mychess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50 p-4 max-w-lg mx-auto pb-24">
  {#if moves.length === 0}
    <div class="flex flex-col items-center justify-center min-h-screen text-center gap-4">
      <p class="text-5xl">📭</p>
      <h1 class="text-2xl font-bold text-gray-700">No moves to practice</h1>
      <p class="text-gray-400">Add a repertoire first!</p>
      <a href="/" class="text-indigo-600 hover:underline">Back to Home</a>
    </div>
  {:else if done}
    <div class="flex flex-col items-center justify-center min-h-screen gap-6 text-center">
      <p class="text-7xl">🎉</p>
      <h1 class="text-4xl font-bold text-gray-900">Practice Complete!</h1>
      <div class="bg-white border border-gray-200 rounded-2xl p-6 w-full max-w-xs space-y-3 shadow-sm">
        <div class="flex justify-between">
          <span class="text-gray-400">Correct</span>
          <span class="text-green-600 font-bold">{correct}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-gray-400">Incorrect</span>
          <span class="text-red-600 font-bold">{incorrect}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-gray-400">Accuracy</span>
          <span class="text-indigo-600 font-bold">{Math.round((correct / moves.length) * 100)}%</span>
        </div>
      </div>
      <div class="flex gap-3">
        <button onclick={restart}
                class="border border-gray-300 text-gray-700 px-6 py-3 rounded-2xl font-bold hover:bg-gray-50 transition">
          Practice Again
        </button>
        <a href="/" class="bg-indigo-600 text-white px-6 py-3 rounded-2xl font-bold hover:bg-indigo-700 transition">
          Back Home
        </a>
      </div>
    </div>
  {:else}
    <div class="flex items-center justify-between mb-4">
      <a href="/" class="text-gray-400 text-sm hover:text-gray-600">Home</a>
      <span class="text-gray-400 text-sm">{currentIdx + 1}/{moves.length}</span>
    </div>

    <div class="bg-gray-200 rounded-full h-2 mb-6 overflow-hidden">
      <div class="h-full bg-green-500 rounded-full transition-all duration-300"
           style="width: {(currentIdx / moves.length) * 100}%"></div>
    </div>

    <p class="text-center text-gray-400 text-sm font-medium mb-2">
      {current?.repertoire?.name ?? 'Practice'} · Move {currentIdx + 1}
    </p>
    <p class="text-center text-gray-700 font-semibold mb-4">
      {showAnswer ? '' : 'What is the best move?'}
    </p>

    <ChessBoard fen={boardFen} interactable={!showAnswer} onmove={handleMove} />

    {#if wrongMove && !showAnswer}
      <p class="text-red-600 text-center mt-3 font-semibold animate-pulse">Not quite! Try again...</p>
    {/if}

    {#if !showAnswer}
      <button onclick={reveal}
              class="mt-6 w-full bg-white border border-gray-300 py-3 rounded-xl font-semibold hover:bg-gray-50 transition text-gray-700">
        Show Answer
      </button>
    {:else}
      <div class="mt-6 p-5 bg-white border border-gray-200 rounded-2xl text-center shadow-sm">
        <p class="text-xl font-bold mb-1 {wrongMove ? 'text-gray-700' : 'text-green-600'}">
          {wrongMove ? 'Answer: ' + current?.san : '✅ Correct! ' + current?.san}
        </p>
        <button onclick={next}
                class="mt-4 w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-indigo-700 transition">
          {currentIdx + 1 < moves.length ? 'Next →' : 'Finish'}
        </button>
      </div>
    {/if}
  {/if}
</main>
```

- [ ] **Step 2: Build verify**

```powershell
cd D:\Projects\mychess\mychess; npm run build 2>&1 | Select-Object -Last 30
```

- [ ] **Step 3: Commit**

```bash
git add "mychess/src/routes/(kid)/practice/+page.svelte"
git commit -m "style: practice page full light theme rewrite"
```

---

### Task 19: Drill and Time-Trial — full rewrites removing SirKnight

**Files:**
- Modify: `mychess/src/routes/(kid)/drill/+page.svelte`
- Modify: `mychess/src/routes/(kid)/time-trial/+page.svelte`

- [ ] **Step 1: Rewrite drill/+page.svelte (entire file)**

```svelte
<script lang="ts">
  import ChessBoard from '$lib/components/ChessBoard.svelte';
  import type { Key } from 'chessground/types';
  import { playCorrect, playWrong, playLevelUp } from '$lib/sounds';

  let { data } = $props<{ data: any }>();

  const allMoves = $derived((data as any).drillMoves ?? []);

  let currentIdx = $state(0);
  let chain = $state(0);
  let bestChain = $state(0);
  let sessionXp = $state(0);
  let failed = $state(false);
  let wrongMove = $state(false);
  let finished = $state(false);

  const current = $derived(allMoves[currentIdx]);
  const boardFen = $derived(
    current?.from_position?.fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  );

  function handleMove(detail: { from: Key; to: Key; san: string }) {
    if (failed || finished) return;
    const targetSan = current?.san;

    if (detail.san === targetSan) {
      playCorrect();
      wrongMove = false;
      chain++;
      if (chain > bestChain) bestChain = chain;
      sessionXp += 2;

      if (chain === 10) {
        playLevelUp();
        sessionXp += 50;
        finished = true;
        submitDrillResult();
        return;
      }

      if (currentIdx + 1 >= allMoves.length) {
        finished = true;
        submitDrillResult();
      } else {
        currentIdx++;
      }
    } else {
      playWrong();
      wrongMove = true;
      failed = true;
      submitDrillResult();
    }
  }

  function restart() {
    currentIdx = 0;
    chain = 0;
    failed = false;
    finished = false;
    wrongMove = false;
  }

  async function submitDrillResult() {
    await fetch('/api/drill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain, sessionXp, bestChain })
    });
  }
</script>

<svelte:head>
  <title>Drill Mode — mychess</title>
</svelte:head>

<div class="min-h-screen bg-gray-50 p-4">
  <div class="max-w-lg mx-auto">
    <div class="flex justify-between items-center mb-4">
      <a href="/" class="text-gray-400 text-sm hover:text-gray-600">← Home</a>
      <h1 class="text-xl font-bold text-gray-900">Drill Mode</h1>
      <div class="text-right">
        <div class="text-base font-bold text-indigo-600">Chain: {chain}</div>
        <div class="text-xs text-gray-400">XP: {sessionXp}</div>
      </div>
    </div>

    {#if allMoves.length === 0}
      <div class="bg-white border border-gray-200 rounded-2xl p-6 text-center shadow-sm">
        <p class="text-xl text-gray-700">No mastered moves yet!</p>
        <p class="text-gray-400 mt-2">Keep reviewing in Learn mode to unlock Drill mode.</p>
        <a href="/learn"
           class="mt-4 inline-block bg-indigo-600 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-indigo-700 transition">
          Go to Learn
        </a>
      </div>
    {:else if failed}
      <div class="bg-white border border-gray-200 rounded-2xl p-6 text-center shadow-sm">
        <p class="text-4xl mb-2">😢</p>
        <h2 class="text-2xl font-bold text-red-600">Chain Broken!</h2>
        <p class="text-gray-500 mt-2">Best chain: <strong>{bestChain}</strong> moves</p>
        {#if bestChain >= 10}
          <p class="text-green-600 font-bold mt-1">+50 bonus XP for 10-chain!</p>
        {/if}
        <button onclick={restart}
                class="mt-4 w-full bg-indigo-600 text-white py-3 rounded-xl font-bold text-lg hover:bg-indigo-700 transition">
          Try Again
        </button>
        <a href="/" class="mt-2 block text-center text-gray-400 hover:underline text-sm">Back to Home</a>
      </div>
    {:else if finished}
      <div class="bg-white border border-gray-200 rounded-2xl p-6 text-center shadow-sm">
        <p class="text-4xl mb-2">🏆</p>
        <h2 class="text-2xl font-bold text-green-600">All Done!</h2>
        <p class="text-gray-500 mt-2">You drilled all {allMoves.length} moves!</p>
        <button onclick={restart}
                class="mt-4 w-full bg-indigo-600 text-white py-3 rounded-xl font-bold text-lg hover:bg-indigo-700 transition">
          Go Again
        </button>
        <a href="/" class="mt-2 block text-center text-gray-400 hover:underline text-sm">Back to Home</a>
      </div>
    {:else}
      <div class="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm mb-4">
        <p class="text-center text-gray-400 text-sm mb-2">
          Move {currentIdx + 1} / {allMoves.length} · Play the correct move!
        </p>
        {#if wrongMove}
          <p class="text-center text-red-600 font-bold text-sm mb-2">Wrong move! Chain broken!</p>
        {/if}
        <ChessBoard fen={boardFen} interactable={true} onmove={handleMove} />
      </div>

      <div class="flex gap-2 justify-center">
        <div class="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2 text-center">
          <div class="text-xs text-indigo-400">Current Chain</div>
          <div class="text-2xl font-bold text-indigo-700">{chain}</div>
        </div>
        <div class="bg-green-50 border border-green-100 rounded-xl px-4 py-2 text-center">
          <div class="text-xs text-green-500">Best Chain</div>
          <div class="text-2xl font-bold text-green-700">{bestChain}</div>
        </div>
        <div class="bg-gray-50 border border-gray-100 rounded-xl px-4 py-2 text-center">
          <div class="text-xs text-gray-400">Session XP</div>
          <div class="text-2xl font-bold text-gray-700">{sessionXp}</div>
        </div>
      </div>
    {/if}
  </div>
</div>
```

- [ ] **Step 2: Rewrite time-trial/+page.svelte (entire file)**

```svelte
<script lang="ts">
  import ChessBoard from '$lib/components/ChessBoard.svelte';
  import { onDestroy } from 'svelte';
  import type { Key } from 'chessground/types';
  import { playCorrect, playWrong } from '$lib/sounds';

  let { data } = $props<{ data: any }>();

  const allMoves = $derived((data as any).trialMoves ?? []);

  const DURATION = 60;

  let currentIdx = $state(0);
  let correct = $state(0);
  let timeLeft = $state(DURATION);
  let started = $state(false);
  let finished = $state(false);
  let wrongMove = $state(false);
  let sessionXp = $state(0);

  let timer: ReturnType<typeof setInterval> | null = null;

  const current = $derived(allMoves[currentIdx % allMoves.length]);
  const boardFen = $derived(
    current?.from_position?.fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  );

  function start() {
    started = true;
    timer = setInterval(() => {
      timeLeft--;
      if (timeLeft <= 0) {
        clearInterval(timer!);
        timer = null;
        finished = true;
        submitResult();
      }
    }, 1000);
  }

  function handleMove(detail: { from: Key; to: Key; san: string }) {
    if (!started || finished) return;
    const targetSan = current?.san;

    if (detail.san === targetSan) {
      playCorrect();
      wrongMove = false;
      correct++;
      sessionXp += 5;
      currentIdx++;
    } else {
      playWrong();
      wrongMove = true;
    }
  }

  function restart() {
    if (timer) clearInterval(timer);
    timer = null;
    currentIdx = 0;
    correct = 0;
    timeLeft = DURATION;
    started = false;
    finished = false;
    wrongMove = false;
    sessionXp = 0;
  }

  async function submitResult() {
    const bonus = correct >= 20 ? 200 : 0;
    await fetch('/api/time-trial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correct, sessionXp: sessionXp + bonus, bonus })
    });
    if (bonus > 0) sessionXp += bonus;
  }

  onDestroy(() => { if (timer) clearInterval(timer); });
</script>

<svelte:head>
  <title>Time Trial — mychess</title>
</svelte:head>

<div class="min-h-screen bg-gray-50 p-4">
  <div class="max-w-lg mx-auto">
    <div class="flex justify-between items-center mb-4">
      <a href="/" class="text-gray-400 text-sm hover:text-gray-600">← Home</a>
      <h1 class="text-xl font-bold text-gray-900">Time Trial</h1>
      <div class="text-right">
        <div class="text-2xl font-bold {timeLeft <= 10 ? 'text-red-600 animate-pulse' : 'text-indigo-600'}">{timeLeft}s</div>
        <div class="text-xs text-gray-400">✅ {correct}</div>
      </div>
    </div>

    {#if allMoves.length === 0}
      <div class="bg-white border border-gray-200 rounded-2xl p-6 text-center shadow-sm">
        <p class="text-xl text-gray-700">No moves to drill yet!</p>
        <p class="text-gray-400 mt-2">Add moves in Learn mode first.</p>
        <a href="/learn"
           class="mt-4 inline-block bg-indigo-600 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-indigo-700 transition">
          Go to Learn
        </a>
      </div>
    {:else if finished}
      <div class="bg-white border border-gray-200 rounded-2xl p-6 text-center shadow-sm">
        <p class="text-4xl mb-2">{correct >= 20 ? '🏆' : correct >= 10 ? '🎉' : '⏱️'}</p>
        <h2 class="text-2xl font-bold text-indigo-700">Time's Up!</h2>
        <p class="text-gray-500 mt-2">You got <strong>{correct}</strong> correct in 60 seconds</p>
        {#if correct >= 20}
          <p class="text-green-600 font-bold mt-1">+200 Bonus XP for 20+ correct!</p>
        {/if}
        <button onclick={restart}
                class="mt-4 w-full bg-indigo-600 text-white py-3 rounded-xl font-bold text-lg hover:bg-indigo-700 transition">
          Play Again
        </button>
        <a href="/" class="mt-2 block text-center text-gray-400 hover:underline text-sm">Back to Home</a>
      </div>
    {:else if !started}
      <div class="bg-white border border-gray-200 rounded-2xl p-6 text-center shadow-sm">
        <p class="text-4xl mb-3">⏱️</p>
        <h2 class="text-xl font-bold text-gray-900 mb-2">60-Second Challenge!</h2>
        <p class="text-gray-500 mb-4">Answer as many opening moves as you can. +5 XP per correct, +200 bonus for 20+!</p>
        <button onclick={start}
                class="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-xl hover:bg-indigo-700 transition">
          Start!
        </button>
      </div>
    {:else}
      <div class="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm mb-4">
        <p class="text-center text-gray-400 text-sm mb-2">
          {#if wrongMove}
            <span class="text-red-600 font-bold">Wrong move! Try again!</span>
          {:else}
            Play the correct opening move!
          {/if}
        </p>
        <ChessBoard fen={boardFen} interactable={true} onmove={handleMove} />
      </div>

      <div class="flex gap-2 justify-center">
        <div class="bg-green-50 border border-green-100 rounded-xl px-4 py-2 text-center">
          <div class="text-xs text-green-500">Correct</div>
          <div class="text-2xl font-bold text-green-700">{correct}</div>
        </div>
        <div class="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2 text-center">
          <div class="text-xs text-indigo-400">XP</div>
          <div class="text-2xl font-bold text-indigo-700">{sessionXp}</div>
        </div>
        <div class="bg-red-50 border border-red-100 rounded-xl px-4 py-2 text-center">
          <div class="text-xs text-red-400">Time</div>
          <div class="text-2xl font-bold text-red-600">{timeLeft}s</div>
        </div>
      </div>
    {/if}
  </div>
</div>
```

- [ ] **Step 3: Build verify**

```powershell
cd D:\Projects\mychess\mychess; npm run build 2>&1 | Select-Object -Last 30
```

- [ ] **Step 4: Commit**

```bash
git add "mychess/src/routes/(kid)/drill/+page.svelte" "mychess/src/routes/(kid)/time-trial/+page.svelte"
git commit -m "style: drill and time-trial full rewrite — remove SirKnight, light theme"
```

---

### Task 20: Coach pages — full light theme rewrites

**Files:**
- Modify: `mychess/src/routes/(coach)/coach/+page.svelte`
- Modify: `mychess/src/routes/(coach)/coach/invite/+page.svelte`
- Modify: `mychess/src/routes/(coach)/coach/pgn/+page.svelte`
- Modify: `mychess/src/routes/(coach)/coach/kids/[kid_id]/+page.svelte`

- [ ] **Step 1: Rewrite coach/+page.svelte**

```svelte
<script lang="ts">
  let { data } = $props<{ data: any }>();
  const profile = $derived(data.profile as any);
  const kids = $derived<any[]>(data.kids ?? []);
</script>

<svelte:head>
  <title>Coach Dashboard — mychess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
  <div class="max-w-2xl mx-auto px-4 py-6">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Coach Dashboard</h1>
        <p class="text-gray-500 text-sm">Welcome back, {profile?.display_name ?? 'Coach'}</p>
      </div>
      <a href="/coach/invite"
         class="bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors">
        + Invite Player
      </a>
    </div>

    <div class="grid grid-cols-2 gap-4 mb-6">
      <a href="/coach/invite"
         class="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
        <p class="text-2xl mb-2">🔗</p>
        <p class="font-semibold text-gray-900">Invite Links</p>
        <p class="text-sm text-gray-400">Invite students to join</p>
      </a>
      <a href="/coach/pgn"
         class="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
        <p class="text-2xl mb-2">📂</p>
        <p class="font-semibold text-gray-900">Upload PGN</p>
        <p class="text-sm text-gray-400">Add repertoires</p>
      </a>
    </div>

    {#if kids.length > 0}
      <section class="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
        <h2 class="font-semibold text-gray-900 mb-4">Your Players ({kids.length})</h2>
        <ul class="space-y-1">
          {#each kids as kid}
            <li>
              <a href="/coach/kids/{kid.id}"
                 class="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                <div class="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 font-bold text-sm flex items-center justify-center">
                  {(kid.display_name ?? 'P')[0].toUpperCase()}
                </div>
                <span class="font-medium text-gray-900">{kid.display_name}</span>
                <span class="ml-auto text-gray-400 text-sm">→</span>
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {:else}
      <div class="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400">
        <p class="text-4xl mb-3">👤</p>
        <p class="font-medium text-gray-500">No players yet</p>
        <p class="text-sm mt-1">Use Invite Links to add your first student.</p>
      </div>
    {/if}
  </div>
</main>
```

- [ ] **Step 2: Rewrite coach/invite/+page.svelte**

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';
  let { data, form } = $props<{ data: { invites: any[] }; form: any }>();
  let origin = $state('');
  $effect(() => { origin = typeof window !== 'undefined' ? window.location.origin : ''; });
</script>

<svelte:head>
  <title>Invite Player — mychess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
  <div class="max-w-lg mx-auto px-4 py-6">
    <a href="/coach" class="text-gray-400 text-sm hover:text-gray-600 mb-6 block">← Back to Dashboard</a>
    <h1 class="text-2xl font-bold text-gray-900 mb-6">Invite a Player</h1>

    <form method="POST" action="?/create" use:enhance class="mb-6">
      <button class="bg-indigo-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-indigo-700 transition-colors">
        Generate Invite Link
      </button>
    </form>

    {#if form?.token}
      <div class="mb-8 bg-white border border-indigo-200 rounded-xl p-5 shadow-sm">
        <p class="text-sm text-gray-500 mb-2 font-medium">Share this link:</p>
        <p class="font-mono text-indigo-600 break-all text-sm">{origin}/join/{form.token}</p>
        <button
          onclick={() => navigator.clipboard.writeText(`${origin}/join/${form.token}`)}
          class="mt-3 text-sm bg-gray-100 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-200 transition text-gray-700"
        >
          Copy Link
        </button>
      </div>
    {/if}

    <h2 class="text-lg font-semibold text-gray-900 mb-4">Past Invites</h2>
    {#if data.invites.length === 0}
      <p class="text-gray-400">No invites yet.</p>
    {:else}
      <ul class="space-y-2">
        {#each data.invites as inv}
          <li class="bg-white border border-gray-200 rounded-xl p-4 text-sm flex justify-between items-center">
            <span class="font-mono text-gray-500 truncate">/join/{inv.token.slice(0, 16)}...</span>
            {#if inv.redeemed_at}
              <span class="text-green-600 font-medium ml-2 shrink-0">Redeemed</span>
            {:else if new Date(inv.expires_at) < new Date()}
              <span class="text-red-500 font-medium ml-2 shrink-0">Expired</span>
            {:else}
              <span class="text-gray-400 ml-2 shrink-0">Pending</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</main>
```

- [ ] **Step 3: Rewrite coach/pgn/+page.svelte**

```svelte
<script lang="ts">
  import PgnUpload from '$lib/components/PgnUpload.svelte';
  import { enhance } from '$app/forms';

  let { data, form } = $props<{ data: { kids: any[] }; form: any }>();
</script>

<svelte:head>
  <title>Upload Repertoire — mychess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
  <div class="max-w-lg mx-auto px-4 py-6">
    <a href="/coach" class="text-gray-400 text-sm hover:text-gray-600 mb-6 block">← Back to Dashboard</a>
    <h1 class="text-2xl font-bold text-gray-900 mb-6">Upload Repertoire</h1>

    {#if form?.success}
      <div class="bg-green-50 border border-green-200 rounded-xl p-5 mb-6">
        <p class="text-green-700 font-bold">{form.gameCount} game(s) imported!</p>
        <a href="/coach" class="text-sm text-green-600 hover:underline mt-1 block">Back to Dashboard</a>
      </div>
    {/if}
    {#if form?.error}
      <p class="text-red-600 mb-4 bg-red-50 border border-red-200 px-4 py-2 rounded-xl text-sm">{form.error}</p>
    {/if}

    <form method="POST" action="?/upload" use:enhance
          class="bg-white border border-gray-200 rounded-xl shadow-sm p-5 space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="name">Repertoire Name</label>
        <input id="name" name="name" required placeholder="e.g. Sicilian Defense"
               class="w-full rounded-lg px-4 py-2.5 border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      </div>

      {#if data.kids.length > 0}
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1" for="kid_id">Assign to player</label>
          <select id="kid_id" name="kid_id"
                  class="w-full rounded-lg px-4 py-2.5 border border-gray-300 text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">Myself</option>
            {#each data.kids as kid}
              <option value={kid.id}>{kid.display_name}</option>
            {/each}
          </select>
        </div>
      {/if}

      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="pgn_text">Paste PGN text</label>
        <textarea id="pgn_text" name="pgn_text" rows="8"
                  placeholder="[Event &quot;Example&quot;]&#10;&#10;1. e4 e5 *"
                  class="w-full rounded-lg px-4 py-2.5 border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm resize-none"
        ></textarea>
      </div>

      <button type="submit"
              class="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold text-base hover:bg-indigo-700 transition-colors">
        Upload Repertoire
      </button>
    </form>
  </div>
</main>
```

- [ ] **Step 4: Rewrite coach/kids/[kid_id]/+page.svelte**

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';

  let { data, form } = $props<{ data: any; form: any }>();
  const d = $derived(data);
</script>

<svelte:head>
  <title>{d.kid?.display_name ?? 'Player'} — mychess Coach</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
  <div class="max-w-lg mx-auto px-4 py-6 space-y-5">
    <a href="/coach" class="text-gray-400 text-sm hover:text-gray-600 block">← Back to Dashboard</a>

    <div class="bg-white border border-gray-200 rounded-xl shadow-sm p-5 flex items-center gap-4">
      <div class="w-12 h-12 rounded-full bg-indigo-100 text-indigo-700 font-bold text-lg flex items-center justify-center">
        {(d.kid?.display_name ?? 'P')[0].toUpperCase()}
      </div>
      <div class="flex-1">
        <h1 class="text-xl font-bold text-gray-900">{d.kid?.display_name}</h1>
        <p class="text-gray-400 text-sm">Lv {d.stats?.level ?? 0} · {d.stats?.streak_days ?? 0} day streak</p>
      </div>
    </div>

    <section class="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      <h2 class="font-semibold text-gray-900 mb-4">Repertoires ({d.repertoires.length})</h2>
      {#if d.repertoires.length === 0}
        <p class="text-gray-400 text-sm mb-3">No repertoires yet.</p>
      {:else}
        <ul class="space-y-2 mb-3">
          {#each d.repertoires as rep}
            <li class="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
              <span class="w-3 h-3 rounded-full shrink-0" style="background:{rep.color ?? '#4f46e5'}"></span>
              <span class="font-medium text-gray-900 text-sm">{rep.name}</span>
            </li>
          {/each}
        </ul>
      {/if}
      <a href="/coach/pgn?kid={d.kid?.id}"
         class="block w-full text-center bg-indigo-600 text-white py-2.5 rounded-xl font-medium hover:bg-indigo-700 transition-colors text-sm">
        + Upload Repertoire
      </a>
    </section>

    {#if d.coachReps.length > 0}
      <section class="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
        <h2 class="font-semibold text-gray-900 mb-3">Assign Repertoire</h2>
        <form method="POST" action="?/assignRep" use:enhance>
          <select name="rep_id"
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 mb-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500">
            {#each d.coachReps as rep}
              <option value={rep.id}>{rep.name}</option>
            {/each}
          </select>
          <button class="w-full bg-indigo-600 text-white py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors text-sm">
            Assign
          </button>
        </form>
      </section>
    {/if}

    <section class="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      <h2 class="font-semibold text-gray-900 mb-1">Weekly XP Goal</h2>
      <p class="text-gray-400 text-xs mb-3">Current: {d.kid?.weekly_xp_goal ?? 200} XP/week</p>
      <form method="POST" action="?/setGoal" use:enhance class="flex gap-2">
        <input type="number" name="weekly_xp_goal" min="0" max="5000" step="50"
               value={d.kid?.weekly_xp_goal ?? 200}
               class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <button class="bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors text-sm">
          Set
        </button>
      </form>
      {#if form?.success}
        <p class="text-green-600 text-xs mt-2">Saved!</p>
      {/if}
    </section>

    <section class="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      <h2 class="font-semibold text-gray-900 mb-3">Coach Notes</h2>
      {#if d.notes.length > 0}
        <ul class="space-y-2 mb-4">
          {#each d.notes as note}
            <li class="bg-gray-50 border border-gray-100 rounded-lg p-3 text-sm">
              <p class="text-gray-700">{note.message}</p>
              <p class="text-gray-400 text-xs mt-1">
                {new Date(note.created_at).toLocaleDateString()}
                {note.read_at ? ' · Read' : ' · Unread'}
              </p>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-gray-400 text-sm mb-3">No notes yet.</p>
      {/if}
      <form method="POST" action="?/addNote" use:enhance>
        <textarea name="message" rows="2" placeholder="Write a note for {d.kid?.display_name}..."
                  class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 mb-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
        <button class="w-full bg-green-600 text-white py-2 rounded-lg font-medium hover:bg-green-700 transition-colors text-sm">
          Send Note
        </button>
      </form>
    </section>
  </div>
</main>
```

- [ ] **Step 5: Build verify**

```powershell
cd D:\Projects\mychess\mychess; npm run build 2>&1 | Select-Object -Last 30
```

- [ ] **Step 6: Commit**

```bash
git add "mychess/src/routes/(coach)/coach/+page.svelte"
git add "mychess/src/routes/(coach)/coach/invite/+page.svelte"
git add "mychess/src/routes/(coach)/coach/pgn/+page.svelte"
git add "mychess/src/routes/(coach)/coach/kids/[kid_id]/+page.svelte"
git commit -m "style: coach portal pages full light theme rewrites"
```

---

### Task 21: Badges and cosmetics minor cleanup

**Files:**
- Modify: `mychess/src/routes/(kid)/badges/+page.svelte`
- Modify: `mychess/src/routes/(kid)/cosmetics/+page.svelte`

Both pages already have light backgrounds (amber/purple gradients). Apply minimal cleanup:

- [ ] **Step 1: Badges page**

In `mychess/src/routes/(kid)/badges/+page.svelte`:
- `from-yellow-50 to-amber-100` → `bg-gray-50` (flat, no gradient)
- `text-amber-800` (heading) → `text-gray-900`
- `text-amber-600` (subtitle) → `text-gray-500`
- `bg-amber-200 rounded-full h-3` (progress bar bg) → `bg-gray-200 rounded-full h-3`
- `bg-amber-500` (progress bar fill) → `bg-indigo-500`
- `border-amber-300` (earned badge border) → `border-indigo-200`
- `text-amber-600 font-bold mt-1` (XP text) → `text-indigo-600 font-medium`

- [ ] **Step 2: Cosmetics page**

In `mychess/src/routes/(kid)/cosmetics/+page.svelte`:
- `from-purple-50 to-pink-100` → `bg-gray-50`
- `text-purple-800` heading → `text-gray-900`
- `text-purple-700` subheadings → `text-indigo-600`
- `border-purple-500` (selected) → `border-indigo-500`
- `bg-purple-50` (selected bg) → `bg-indigo-50`
- `hover:border-purple-200` → `hover:border-indigo-200`
- Save button: `bg-yellow-400 text-slate-900` → `bg-indigo-600 text-white hover:bg-indigo-700`

- [ ] **Step 3: Commit**

```bash
git add "mychess/src/routes/(kid)/badges/+page.svelte" "mychess/src/routes/(kid)/cosmetics/+page.svelte"
git commit -m "style: badges and cosmetics pages aligned to indigo/neutral palette"
```

---

### Task 22: Tournament components style alignment

**Files:**
- Modify: `mychess/src/lib/components/tournaments/TournamentCard.svelte`
- Modify: `mychess/src/lib/components/tournaments/TournamentFilters.svelte`

- [ ] **Step 1: Update TournamentFilters active button colour**

In `TournamentFilters.svelte`, find all instances of `bg-blue-600` active state and replace with `bg-indigo-600`. Find `text-blue-600` and replace with `text-indigo-600`.

- [ ] **Step 2: Update TournamentCard**

In `TournamentCard.svelte`, remove any `dark:` variant classes. Ensure card styling matches: `bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md`.

- [ ] **Step 3: View and update the tournament list page**

In `mychess/src/routes/tournaments/+page.svelte`:
- Replace `bg-blue-600` on active view toggle → `bg-indigo-600`
- Any `dark:` variants → remove

- [ ] **Step 4: Final build verify**

```bash
cd mychess && npm run build 2>&1 | Select-Object -Last 30
```

Expected: build succeeds, zero TypeScript errors.

- [ ] **Step 5: Final commit**

```bash
git add mychess/src/lib/components/tournaments/TournamentCard.svelte \
        mychess/src/lib/components/tournaments/TournamentFilters.svelte \
        mychess/src/routes/tournaments/+page.svelte
git commit -m "style: tournament components aligned to indigo accent, remove dark: classes"
```

---

## Verification Checklist

After all tasks are complete, verify:

- [ ] `npm run build` passes with zero errors
- [ ] Open the app in a browser — no dark slate backgrounds visible on any page
- [ ] Dashboard loads: PlayerHeader shows player name + FIDE placeholder
- [ ] NavBar shows on all pages except /login, /welcome, /join
- [ ] Authenticated: nav shows Dashboard, Tournaments, Learn, Repertoires
- [ ] Guest: nav shows Tournaments + Sign in + Get started
- [ ] Coach: nav shows Coach Dashboard
- [ ] User dropdown opens: Settings, Cosmetics, Badges, Sign out
- [ ] Sign out works: POST /auth/signout → redirected to /login
- [ ] Tournaments page: indigo active filter buttons, light card style
- [ ] Learn/Drill/Time-Trial: no SirKnight, light backgrounds
- [ ] Settings: FIDE ID field saves and loads correctly
