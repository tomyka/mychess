<script lang="ts">
  let { query = '', result = null } = $props<{
    query?: string;
    result?: { found: boolean; player?: {
      name: string;
      stdRating: number | null; rapidRating: number | null; blitzRating: number | null;
      countryRankStandard: number | null; countryRankRapid: number | null; countryRankBlitz: number | null;
      ageBracket: string | null;
      ageGroupRankStandard: number | null; ageGroupRankRapid: number | null; ageGroupRankBlitz: number | null;
    } } | null;
  }>();

  const p = $derived(result?.player ?? null);
  const ageLabel = $derived(
    p?.ageBracket && p.ageBracket !== 'open' ? `${p.ageBracket} rank` : 'Age group rank'
  );
  const rank = (n: number | null | undefined) => (n != null ? `#${n}` : '––');
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
    {#if result.found && p}
      <div class="mt-4 border-t border-gray-100 pt-4">
        <p class="font-semibold text-gray-900 mb-3">{p.name}</p>
        <table class="w-full text-sm">
          <thead>
            <tr class="text-xs text-gray-400">
              <th class="text-left font-normal pb-1"></th>
              <th class="text-right font-normal pb-1">Standard</th>
              <th class="text-right font-normal pb-1">Rapid</th>
              <th class="text-right font-normal pb-1">Blitz</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="text-left text-gray-500 py-1">Rating</td>
              <td class="text-right font-semibold text-gray-900">{p.stdRating ?? '––'}</td>
              <td class="text-right font-semibold text-gray-900">{p.rapidRating ?? '––'}</td>
              <td class="text-right font-semibold text-gray-900">{p.blitzRating ?? '––'}</td>
            </tr>
            <tr>
              <td class="text-left text-gray-500 py-1">National rank</td>
              <td class="text-right text-gray-900">{rank(p.countryRankStandard)}</td>
              <td class="text-right text-gray-900">{rank(p.countryRankRapid)}</td>
              <td class="text-right text-gray-900">{rank(p.countryRankBlitz)}</td>
            </tr>
            {#if p.ageBracket}
              <tr>
                <td class="text-left text-gray-500 py-1">{ageLabel}</td>
                <td class="text-right text-gray-900">{rank(p.ageGroupRankStandard)}</td>
                <td class="text-right text-gray-900">{rank(p.ageGroupRankRapid)}</td>
                <td class="text-right text-gray-900">{rank(p.ageGroupRankBlitz)}</td>
              </tr>
            {/if}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="mt-4 text-sm text-gray-500">No FIDE record found for that ID.</p>
    {/if}
  {/if}
</section>
