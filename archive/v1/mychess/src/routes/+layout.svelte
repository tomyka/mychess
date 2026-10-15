<script lang="ts">
  import '../app.css';
  import { QueryClientProvider, QueryClient } from '@tanstack/svelte-query';
  import NavBar from '$lib/components/NavBar.svelte';
  import { page } from '$app/stores';
  import { initThemeFromCookie, applyResolvedThemeClass, themeStore } from '$lib/theme.svelte';
  import { clearStaleChunkGuard } from '$lib/staleChunk';

  let { children, data } = $props<{ children: any; data: any }>();

  const queryClient = new QueryClient();

  // Do not show nav on standalone auth pages
  const hideNav = $derived(
    ['/login', '/welcome', '/join'].some(p => $page.url.pathname.startsWith(p))
  );

  // Safe during SSR too — initThemeFromCookie() itself guards on
  // `typeof document`. On the client this re-reads whatever app.html's
  // blocking script already used, so the store starts in sync with what's
  // already painted.
  initThemeFromCookie();

  // Reaching here means the app rendered, so whatever stale-chunk recovery may
  // have run on a previous load is spent and shouldn't count against a LATER
  // deploy landing while this same tab stays open (we redeploy on every push).
  $effect(() => {
    clearStaleChunkGuard();
  });

  // Only relevant while 'system' is the active choice — if the OS's own
  // light/dark setting changes while this tab is open, follow it live
  // instead of requiring a reload.
  $effect(() => {
    if (themeStore.current !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const update = () => applyResolvedThemeClass('system');
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  });
</script>

<svelte:head>
  <title>MyChess</title>
</svelte:head>

<QueryClientProvider client={queryClient}>
  {#if !hideNav}
    <NavBar user={(data as any)?.user} profile={(data as any)?.profile} />
  {/if}
  {@render children()}
</QueryClientProvider>
