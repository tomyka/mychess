<!-- MyChess/src/lib/components/PlayerHeader.svelte -->
<script lang="ts">
  type FideTypeRatings = { rating: number | null; countryRank: number | null; ageGroupRank: number | null };
  type FideRatings = { standard: FideTypeRatings; rapid: FideTypeRatings; blitz: FideTypeRatings } | null;

  let { profile, fideRatings = null } = $props<{ profile: any; fideRatings?: FideRatings }>();

  const p = $derived(profile as any);
  const initials = $derived(
    p?.first_name && p?.last_name
      ? `${p.first_name[0]}${p.last_name[0]}`.toUpperCase()
      : (p?.display_name ?? 'P').slice(0, 2).toUpperCase()
  );

  const EMPTY_TILE: FideTypeRatings = { rating: null, countryRank: null, ageGroupRank: null };

  const TILES = [
    { key: 'standard' as const, label: 'Standard' },
    { key: 'rapid' as const, label: 'Rapid' },
    { key: 'blitz' as const, label: 'Blitz' }
  ];

  function tileFor(key: 'standard' | 'rapid' | 'blitz'): FideTypeRatings {
    return fideRatings?.[key] ?? EMPTY_TILE;
  }
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

  <!-- FIDE rating tiles: Standard / Rapid / Blitz -->
  {#if p?.fide_id}
    <div class="flex gap-2 shrink-0">
      {#each TILES as tile (tile.key)}
        {@const entry = tileFor(tile.key)}
        <div class="w-[92px] text-center bg-gray-50 border border-gray-100 rounded-lg px-1 py-2">
          <div class="flex items-center justify-center gap-1 text-gray-400">
            {#if tile.key === 'standard'}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
              </svg>
            {:else if tile.key === 'rapid'}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="13" r="8" /><path d="M12 13v-3" /><path d="M9.5 3h5" /><path d="M12 3v2" />
              </svg>
            {:else}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 2L4.5 14h5.5l-1 8L19 10h-5.5l-.5-8z" />
              </svg>
            {/if}
            <span class="text-[9px] uppercase tracking-wide">{tile.label}</span>
          </div>
          <p class="text-lg font-bold text-gray-900 mt-0.5">{entry.rating ?? '–'}</p>
          <div class="flex mt-1 border-t border-gray-200 pt-1">
            <div class="flex-1 border-r border-gray-200">
              <p class="text-[11px] font-semibold text-gray-700">{entry.countryRank != null ? `#${entry.countryRank}` : 'N/A'}</p>
              <p class="text-[8px] text-gray-400">LTU</p>
            </div>
            <div class="flex-1">
              <p class="text-[11px] font-semibold text-gray-700">{entry.ageGroupRank != null ? `#${entry.ageGroupRank}` : 'N/A'}</p>
              <p class="text-[8px] text-gray-400">AGE</p>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
