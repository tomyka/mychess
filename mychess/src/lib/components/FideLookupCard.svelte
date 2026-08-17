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
      europeAgeGroupRankStandard: number | null; europeAgeGroupRankRapid: number | null; europeAgeGroupRankBlitz: number | null;
    } } | null;
  }>();

  const p = $derived(result?.player ?? null);
  const ageLabel = $derived(
    p?.ageBracket && p.ageBracket !== 'open' ? `${p.ageBracket} rank` : 'Age group rank'
  );
  const europeAgeLabel = $derived(
    p?.ageBracket && p.ageBracket !== 'open' ? `${p.ageBracket} rank (Europe)` : 'Age group rank (Europe)'
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

<section class="bg-(--color-surface) rounded-xl border border-(--color-border) shadow-sm p-5">
  <h2 class="font-semibold text-(--color-text) mb-3">Look up a FIDE rank</h2>
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
        class="w-full border border-(--color-border) rounded-lg px-4 py-2 text-(--color-text) placeholder-(--color-muted) focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      {#if open && matches.length > 0}
        <ul class="absolute z-10 left-0 right-0 mt-1 bg-(--color-surface) border border-(--color-border) rounded-lg shadow-lg max-h-64 overflow-auto">
          {#each matches as m (m.fideId)}
            <li>
              <button
                type="button"
                onclick={() => select(m.fideId)}
                class="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-between gap-3">
                <span class="text-(--color-text) truncate">{m.name}</span>
                <span class="text-xs text-(--color-muted) shrink-0">{m.federation}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    <button type="submit" class="bg-(--color-accent) text-white px-4 py-2 rounded-lg font-medium hover:bg-(--color-accent-hover) transition-colors">
      Look up
    </button>
  </form>

  {#if result}
    {#if result.found && p}
      <div class="mt-4 border-t border-gray-100 pt-4">
        <p class="font-semibold text-(--color-text) mb-3">{p.name}</p>
        <table class="w-full text-sm">
          <thead>
            <tr class="text-xs text-(--color-muted)">
              <th class="text-left font-normal pb-1"></th>
              <th class="text-right font-normal pb-1">Standard</th>
              <th class="text-right font-normal pb-1">Rapid</th>
              <th class="text-right font-normal pb-1">Blitz</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="text-left text-(--color-muted) py-1">Rating</td>
              <td class="text-right font-semibold text-(--color-text)">{p.stdRating ?? '––'}</td>
              <td class="text-right font-semibold text-(--color-text)">{p.rapidRating ?? '––'}</td>
              <td class="text-right font-semibold text-(--color-text)">{p.blitzRating ?? '––'}</td>
            </tr>
            <tr>
              <td class="text-left text-(--color-muted) py-1">National rank</td>
              <td class="text-right text-(--color-text)">{rank(p.countryRankStandard)}</td>
              <td class="text-right text-(--color-text)">{rank(p.countryRankRapid)}</td>
              <td class="text-right text-(--color-text)">{rank(p.countryRankBlitz)}</td>
            </tr>
            {#if p.ageBracket}
              <tr>
                <td class="text-left text-(--color-muted) py-1">{ageLabel}</td>
                <td class="text-right text-(--color-text)">{rank(p.ageGroupRankStandard)}</td>
                <td class="text-right text-(--color-text)">{rank(p.ageGroupRankRapid)}</td>
                <td class="text-right text-(--color-text)">{rank(p.ageGroupRankBlitz)}</td>
              </tr>
              <tr>
                <td class="text-left text-(--color-muted) py-1">{europeAgeLabel}</td>
                <td class="text-right text-(--color-text)">{rank(p.europeAgeGroupRankStandard)}</td>
                <td class="text-right text-(--color-text)">{rank(p.europeAgeGroupRankRapid)}</td>
                <td class="text-right text-(--color-text)">{rank(p.europeAgeGroupRankBlitz)}</td>
              </tr>
            {/if}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="mt-4 text-sm text-(--color-muted)">No FIDE record found for that ID.</p>
    {/if}
  {/if}
</section>
