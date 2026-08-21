<script lang="ts">
  import { page } from '$app/stores';
  import LanguageSwitcher from './LanguageSwitcher.svelte';
  import { m } from '$lib/paraglide/messages';

  let { user, profile } = $props<{ user: any; profile: any }>();

  let userMenuOpen = $state(false);
  let mobileMenuOpen = $state(false);

  const isCoach = $derived((profile as any)?.role === 'coach');
  const isSignedOut = $derived(!user);
  const pathname = $derived($page.url.pathname);

  function active(paths: string[]): boolean {
    return paths.some(p => pathname === p || pathname.startsWith(p + '/'));
  }

  function linkClass(paths: string[]): string {
    return active(paths)
      ? 'text-(--color-accent) font-semibold border-b-2 border-(--color-accent) pb-0.5'
      : 'text-(--color-muted) hover:text-gray-900 dark:hover:text-gray-200 transition-colors';
  }
</script>

<nav class="sticky top-0 z-50 bg-(--color-surface) border-b border-(--color-border)">
  <div class="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">

    <!-- Logo -->
    <a href="/" class="flex items-center gap-2 font-bold text-(--color-text) shrink-0">
      <img src="/favicon.svg" alt="MyChess" class="w-7 h-7" />
      <span class="text-base">MyChess</span>
    </a>

    <!-- Desktop nav links -->
    <div class="hidden md:flex items-center gap-6 text-sm">
      {#if isCoach}
        <a href="/coach"
           class={pathname === '/coach' || active(['/coach/students', '/coach/invite', '/coach/players'])
             ? 'text-(--color-accent) font-semibold border-b-2 border-(--color-accent) pb-0.5'
             : 'text-(--color-muted) hover:text-gray-900 dark:hover:text-gray-200 transition-colors'}>{m.nav_players()}</a>
        <a href="/coach/repertoires" class={linkClass(['/coach/repertoires', '/coach/pgn'])}>{m.nav_repertoires()}</a>
        <a href="/support" class={linkClass(['/support'])}>{m.nav_support()}</a>
      {:else if !isSignedOut}
        <a href="/" class={linkClass(['/'])}>{m.nav_dashboard()}</a>
        <a href="/tournaments" class={linkClass(['/tournaments'])}>{m.nav_tournaments()}</a>
        <a href="/learn" class={linkClass(['/learn'])}>{m.nav_learn()}</a>
        <a href="/practice" class={linkClass(['/practice'])}>{m.nav_practice()}</a>
        <a href="/repertoires" class={linkClass(['/repertoires'])}>{m.nav_repertoires()}</a>
        <a href="/games" class={linkClass(['/games'])}>{m.nav_games()}</a>
        <a href="/coaches" class={linkClass(['/coaches'])}>{m.nav_coaches()}</a>
        <a href="/support" class={linkClass(['/support'])}>{m.nav_support()}</a>
      {:else}
        <a href="/tournaments" class={linkClass(['/tournaments'])}>{m.nav_tournaments()}</a>
        <a href="/support" class={linkClass(['/support'])}>{m.nav_support()}</a>
      {/if}
    </div>

    <!-- Right side -->
    <div class="flex items-center gap-3 text-sm shrink-0">
      {#if isSignedOut}
        <!-- One CTA only: "Get started" pointed at /login?signup=1, but no route
             ever reads a `signup` param, so it rendered the same page as "Sign in".
             Not `hidden sm:inline` — this is now the only signed-out CTA in the top bar,
             so it has to stay visible at every width. -->
        <LanguageSwitcher />
        <a href="/login"
           class="bg-(--color-accent) text-white px-3 py-1.5 rounded-lg font-medium hover:bg-(--color-accent-hover) transition-colors">
          {m.nav_sign_in()}
        </a>
      {:else}
        <!-- Streak badge (player only) -->
        {#if !isCoach && (profile as any)?.streak_days > 0}
          <span class="text-orange-500 font-medium text-sm hidden sm:inline">
            🔥 {(profile as any).streak_days}
          </span>
        {/if}

        <LanguageSwitcher />

        <!-- User dropdown (desktop) -->
        <div class="relative hidden md:block">
          <button
            onclick={() => { userMenuOpen = !userMenuOpen; }}
            class="flex items-center gap-1.5 text-(--color-text) hover:text-gray-900 dark:hover:text-gray-200 font-medium"
          >
            <span class="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 text-xs font-bold flex items-center justify-center">
              {((profile as any)?.display_name ?? 'P')[0].toUpperCase()}
            </span>
            <span class="text-sm">{(profile as any)?.display_name ?? m.nav_player_fallback()}</span>
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {#if userMenuOpen}
            <button
              class="fixed inset-0 z-10"
              aria-label={m.nav_close_menu()}
              onclick={() => userMenuOpen = false}
            ></button>
            <div class="absolute right-0 mt-2 w-44 bg-(--color-surface) border border-(--color-border) rounded-xl shadow-lg z-20 py-1 text-sm">
              <a href="/settings" onclick={() => userMenuOpen = false}
                 class="block px-4 py-2 text-(--color-text) hover:bg-gray-50 dark:hover:bg-gray-800">{m.nav_settings()}</a>
              {#if !isCoach}
                <a href="/cosmetics" onclick={() => userMenuOpen = false}
                   class="block px-4 py-2 text-(--color-text) hover:bg-gray-50 dark:hover:bg-gray-800">{m.nav_customise()}</a>
                <a href="/badges" onclick={() => userMenuOpen = false}
                   class="block px-4 py-2 text-(--color-text) hover:bg-gray-50 dark:hover:bg-gray-800">{m.nav_badges()}</a>
              {/if}
              <div class="border-t border-gray-100 my-1"></div>
              <form method="POST" action="/auth/signout">
                <button type="submit" class="w-full text-left px-4 py-2 text-red-600 dark:text-red-400 hover:bg-gray-50 dark:hover:bg-gray-800">
                  {m.nav_sign_out()}
                </button>
              </form>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Mobile hamburger -->
      <button
        class="md:hidden text-(--color-muted) hover:text-gray-900 dark:hover:text-gray-200"
        aria-label={m.nav_toggle_mobile_menu()}
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
    <div class="md:hidden border-t border-gray-100 bg-(--color-surface) px-4 py-3 flex flex-col gap-3 text-sm">
      {#if isCoach}
        <a href="/coach" onclick={() => mobileMenuOpen = false} class="text-(--color-text) font-medium">{m.nav_players()}</a>
        <a href="/coach/repertoires" onclick={() => mobileMenuOpen = false} class="text-(--color-text)">{m.nav_repertoires()}</a>
        <a href="/support" onclick={() => mobileMenuOpen = false} class="text-(--color-text)">{m.nav_support()}</a>
      {:else if !isSignedOut}
        <a href="/" onclick={() => mobileMenuOpen = false} class="text-(--color-text) font-medium">{m.nav_dashboard()}</a>
        <a href="/tournaments" onclick={() => mobileMenuOpen = false} class="text-(--color-text)">{m.nav_tournaments()}</a>
        <a href="/learn" onclick={() => mobileMenuOpen = false} class="text-(--color-text)">{m.nav_learn()}</a>
        <a href="/practice" onclick={() => mobileMenuOpen = false} class="text-(--color-text)">{m.nav_practice()}</a>
        <a href="/repertoires" onclick={() => mobileMenuOpen = false} class="text-(--color-text)">{m.nav_repertoires()}</a>
        <a href="/games" onclick={() => mobileMenuOpen = false} class="text-(--color-text)">{m.nav_games()}</a>
        <a href="/coaches" onclick={() => mobileMenuOpen = false} class="text-(--color-text)">{m.nav_coaches()}</a>
        <a href="/support" onclick={() => mobileMenuOpen = false} class="text-(--color-text)">{m.nav_support()}</a>
      {:else}
        <a href="/tournaments" onclick={() => mobileMenuOpen = false} class="text-(--color-text)">{m.nav_tournaments()}</a>
        <a href="/support" onclick={() => mobileMenuOpen = false} class="text-(--color-text)">{m.nav_support()}</a>
        <a href="/login" onclick={() => mobileMenuOpen = false}
           class="bg-(--color-accent) text-white px-3 py-1.5 rounded-lg font-medium text-center hover:bg-(--color-accent-hover) transition-colors">{m.nav_sign_in()}</a>
      {/if}

      <!-- Account section: Settings + Sign out for every signed-in user
           (coach and player); Customise/Badges are player-only, mirroring the
           desktop dropdown. Previously this lived inside the player branch, so
           coaches on mobile had no way to reach Settings or sign out. -->
      {#if !isSignedOut}
        <div class="border-t border-gray-100 pt-2">
          <a href="/settings" onclick={() => mobileMenuOpen = false} class="block text-(--color-muted)">{m.nav_settings()}</a>
          {#if !isCoach}
            <a href="/cosmetics" onclick={() => mobileMenuOpen = false} class="block text-(--color-muted) mt-2">{m.nav_customise()}</a>
            <a href="/badges" onclick={() => mobileMenuOpen = false} class="block text-(--color-muted) mt-2">{m.nav_badges()}</a>
          {/if}
          <form method="POST" action="/auth/signout" class="mt-2">
            <button type="submit" class="text-red-600 dark:text-red-400">{m.nav_sign_out()}</button>
          </form>
        </div>
      {/if}
    </div>
  {/if}
</nav>
