<script lang="ts">
  import { goto } from '$app/navigation';
  import { m } from '$lib/paraglide/messages';

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
  // Each of the four real rendered forms is its own message key rather than a
  // suffix-appended string — Lithuanian word order isn't guaranteed to match
  // English's "{bracket} rank" + " (Europe)" concatenation pattern.
  const ageLabel = $derived(
    p?.ageBracket && p.ageBracket !== 'open'
      ? m.fide_lookup_age_rank_bracket({ bracket: p.ageBracket })
      : m.fide_lookup_age_rank_fallback()
  );
  const europeAgeLabel = $derived(
    p?.ageBracket && p.ageBracket !== 'open'
      ? m.fide_lookup_age_rank_bracket_europe({ bracket: p.ageBracket })
      : m.fide_lookup_age_rank_fallback_europe()
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
  <h2 class="font-semibold text-(--color-text) mb-3">{m.fide_lookup_heading()}</h2>
  <form method="GET" onsubmit={onSubmit} class="relative flex gap-2">
    <label class="sr-only" for="fide">{m.fide_lookup_search_label()}</label>
    <div class="relative flex-1">
      <input
        id="fide"
        name="fide"
        bind:value={q}
        oninput={onInput}
        autocomplete="off"
        placeholder={m.fide_lookup_search_placeholder()}
        class="w-full border border-(--color-border) rounded-lg px-4 py-2 text-(--color-text) placeholder-(--color-muted) focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      {#if open && matches.length > 0}
        <ul class="absolute z-10 left-0 right-0 mt-1 bg-(--color-surface) border border-(--color-border) rounded-lg shadow-lg max-h-64 overflow-auto">
          {#each matches as match (match.fideId)}
            <li>
              <button
                type="button"
                onclick={() => select(match.fideId)}
                class="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-between gap-3">
                <span class="text-(--color-text) truncate">{match.name}</span>
                <span class="text-xs text-(--color-muted) shrink-0">{match.federation}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    <button type="submit" class="bg-(--color-accent) text-white px-4 py-2 rounded-lg font-medium hover:bg-(--color-accent-hover) transition-colors">
      {m.fide_lookup_submit_button()}
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
              <th class="text-right font-normal pb-1">{m.player_header_tile_standard()}</th>
              <th class="text-right font-normal pb-1">{m.player_header_tile_rapid()}</th>
              <th class="text-right font-normal pb-1">{m.player_header_tile_blitz()}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="text-left text-(--color-muted) py-1">{m.fide_lookup_rating_row_label()}</td>
              <td class="text-right font-semibold text-(--color-text)">{p.stdRating ?? '––'}</td>
              <td class="text-right font-semibold text-(--color-text)">{p.rapidRating ?? '––'}</td>
              <td class="text-right font-semibold text-(--color-text)">{p.blitzRating ?? '––'}</td>
            </tr>
            <tr>
              <td class="text-left text-(--color-muted) py-1">{m.fide_lookup_national_rank_row_label()}</td>
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
      <p class="mt-4 text-sm text-(--color-muted)">{m.fide_lookup_not_found()}</p>
    {/if}
  {/if}
</section>
