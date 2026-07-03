<script lang="ts">
  let { query = '', result = null } = $props<{
    query?: string;
    result?: { found: boolean; player?: {
      name: string;
      stdRating: number | null; rapidRating: number | null; blitzRating: number | null;
      countryRankStandard: number | null; ageBracket: string | null; ageGroupRankStandard: number | null;
    } } | null;
  }>();
</script>

<section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
  <h2 class="font-semibold text-gray-900 mb-3">Look up a FIDE rank</h2>
  <form method="GET" class="flex gap-2">
    <label class="sr-only" for="fide">FIDE ID</label>
    <input
      id="fide"
      name="fide"
      value={query}
      inputmode="numeric"
      placeholder="FIDE ID, e.g. 12865168"
      class="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
    />
    <button type="submit" class="bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors">
      Look up
    </button>
  </form>

  {#if result}
    {#if result.found && result.player}
      <div class="mt-4 border-t border-gray-100 pt-4">
        <p class="font-semibold text-gray-900">{result.player.name}</p>
        <div class="mt-2 grid grid-cols-3 gap-3 text-center">
          <div><p class="text-lg font-bold text-gray-900">{result.player.stdRating ?? '––'}</p><p class="text-xs text-gray-400">Standard</p></div>
          <div><p class="text-lg font-bold text-gray-900">{result.player.rapidRating ?? '––'}</p><p class="text-xs text-gray-400">Rapid</p></div>
          <div><p class="text-lg font-bold text-gray-900">{result.player.blitzRating ?? '––'}</p><p class="text-xs text-gray-400">Blitz</p></div>
        </div>
        <p class="mt-3 text-sm text-gray-500">
          National rank (standard): <span class="font-medium text-gray-900">{result.player.countryRankStandard ?? '––'}</span>
        </p>
      </div>
    {:else}
      <p class="mt-4 text-sm text-gray-500">No FIDE record found for that ID.</p>
    {/if}
  {/if}
</section>
