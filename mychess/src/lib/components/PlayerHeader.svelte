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
