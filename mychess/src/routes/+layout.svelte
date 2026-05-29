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
