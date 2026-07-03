<script lang="ts">
  import { goto } from '$app/navigation';

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

  let q = $state(query);
  let matches = $state<Array<{ fideId: string; name: string; federation: string }>>([]);
  let open = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function search() {
    const term = q.trim();
    if (term.length < 2) {
      matches = [];
      open = false;
      return;
    }
    try {
      const res = await fetch(`/api/fide/search?q=${encodeURIComponent(term)}`);
      const body = await res.json();
      matches = body.results ?? [];
      open = matches.length > 0;
    } catch {
      matches = [];
      open = false;
    }
  }

  function onInput() {
    clearTimeout(timer);
    timer = setTimeout(search, 250);
  }

  function select(fideId: string) {
    open = false;
    goto(`/?fide=${encodeURIComponent(fideId)}`);
  }

  function onSubmit(e: Event) {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    if (/^\d+$/.test(term)) select(term);
    else if (matches.length) select(matches[0].fideId);
  }
</script>

<section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
  <h2 class="font-semibold text-gray-900 mb-3">Look up a FIDE rank</h2>
  <form method="GET" onsubmit={onSubmit} class="relative flex gap-2">
    <label class="sr-only" for="fide">Search by name or FIDE ID</label>
    <div class="relative flex-1">
      <input
        id="fide"
        name="fide"
        bind:value={q}
        oninput={onInput}
        autocomplete="off"
        placeholder="Name or FIDE ID, e.g. Carlsen or 12865168"
        class="w-full border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      {#if open && matches.length > 0}
        <ul class="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-auto">
          {#each matches as m}
            <li>
              <button
                type="button"
                onclick={() => select(m.fideId)}
                class="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center justify-between gap-3">
                <span class="text-gray-900 truncate">{m.name}</span>
                <span class="text-xs text-gray-400 shrink-0">{m.federation}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
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
