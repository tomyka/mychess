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
      <img src="/favicon.svg" alt="MyChess" class="w-7 h-7" />
      <span class="text-base">MyChess</span>
    </a>

    <!-- Desktop nav links -->
    <div class="hidden md:flex items-center gap-6 text-sm">
      {#if isCoach}
        <a href="/coach"
           class={pathname === '/coach' || active(['/coach/students', '/coach/invite', '/coach/players'])
             ? 'text-indigo-600 font-semibold border-b-2 border-indigo-600 pb-0.5'
             : 'text-gray-600 hover:text-gray-900 transition-colors'}>Players</a>
        <a href="/coach/repertoires" class={linkClass(['/coach/repertoires', '/coach/pgn'])}>Repertoires</a>
      {:else if !isGuest}
        <a href="/" class={linkClass(['/'])}>Dashboard</a>
        <a href="/tournaments" class={linkClass(['/tournaments'])}>Tournaments</a>
        <a href="/practice" class={linkClass(['/practice'])}>Practice</a>
        <a href="/repertoires" class={linkClass(['/repertoires'])}>Repertoires</a>
        <a href="/coaches" class={linkClass(['/coaches'])}>Coaches</a>
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
        <a href="/coach" onclick={() => mobileMenuOpen = false} class="text-gray-700 font-medium">Players</a>
        <a href="/coach/repertoires" onclick={() => mobileMenuOpen = false} class="text-gray-700">Repertoires</a>
      {:else if !isGuest}
        <a href="/" onclick={() => mobileMenuOpen = false} class="text-gray-700 font-medium">Dashboard</a>
        <a href="/tournaments" onclick={() => mobileMenuOpen = false} class="text-gray-700">Tournaments</a>
        <a href="/practice" onclick={() => mobileMenuOpen = false} class="text-gray-700">Practice</a>
        <a href="/repertoires" onclick={() => mobileMenuOpen = false} class="text-gray-700">Repertoires</a>
        <a href="/coaches" onclick={() => mobileMenuOpen = false} class="text-gray-700">Coaches</a>
      {:else}
        <a href="/tournaments" onclick={() => mobileMenuOpen = false} class="text-gray-700">Tournaments</a>
        <a href="/login" onclick={() => mobileMenuOpen = false} class="text-gray-700">Sign in</a>
        <a href="/login?signup=1" onclick={() => mobileMenuOpen = false}
           class="text-indigo-600 font-medium">Get started</a>
      {/if}

      <!-- Account section: Settings + Sign out for every signed-in user
           (coach and player); Customise/Badges are player-only, mirroring the
           desktop dropdown. Previously this lived inside the player branch, so
           coaches on mobile had no way to reach Settings or sign out. -->
      {#if !isGuest}
        <div class="border-t border-gray-100 pt-2">
          <a href="/settings" onclick={() => mobileMenuOpen = false} class="block text-gray-600">Settings</a>
          {#if !isCoach}
            <a href="/cosmetics" onclick={() => mobileMenuOpen = false} class="block text-gray-600 mt-2">Customise</a>
            <a href="/badges" onclick={() => mobileMenuOpen = false} class="block text-gray-600 mt-2">Badges</a>
          {/if}
          <form method="POST" action="/auth/signout" class="mt-2">
            <button type="submit" class="text-red-600">Sign out</button>
          </form>
        </div>
      {/if}
    </div>
  {/if}
</nav>
