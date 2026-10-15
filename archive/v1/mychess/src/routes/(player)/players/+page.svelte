<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import FideLookupCard from '$lib/components/FideLookupCard.svelte';

  let { data } = $props<{ data: { fideQuery: string; fideLookup: any } }>();
</script>

<svelte:head>
  <title>{m.seo_players_title()}</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
  <div class="max-w-lg mx-auto px-4 py-6">
    <a href="/" class="text-(--color-muted) text-sm hover:text-(--color-text) mb-6 block"
      >{m.players_back_link()}</a
    >
    <FideLookupCard query={data.fideQuery ?? ''} result={data.fideLookup ?? null} />
  </div>
</main>
