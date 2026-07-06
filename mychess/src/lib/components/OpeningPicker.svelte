<script lang="ts">
  import { enhance } from '$app/forms';
  import { searchOpenings } from '$lib/openings/classify';
  import { ECO_OPENINGS } from '$lib/openings/eco-data';

  let { repId, onclose } = $props<{ repId: string; onclose: () => void }>();

  let query = $state('');
  const results = $derived(searchOpenings(query, ECO_OPENINGS).slice(0, 30));
  // Many ECO sub-variations share (or nearly share) the same display name
  // (e.g. ten different Najdorf codes). Showing every match's full name as
  // plain text gets noisy/redundant, so only the best match gets the full
  // "code — name" treatment; the rest are shown as compact code-only chips
  // (full name still available via title/aria-label) to stay pickable
  // without repeating near-duplicate text throughout the list.
  const topResult = $derived(results[0] ?? null);
  const otherResults = $derived(results.slice(1));
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onclick={onclose}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="bg-white rounded-xl shadow-lg max-w-sm w-full max-h-[80vh] overflow-y-auto"
    onclick={(e) => e.stopPropagation()}
  >
    <div class="flex items-center justify-between p-4 border-b border-gray-100">
      <h2 class="font-semibold text-gray-900">Change Opening</h2>
      <button
        type="button"
        onclick={onclose}
        aria-label="Close"
        class="text-gray-400 hover:text-gray-600 text-xl leading-none"
      >
        &times;
      </button>
    </div>

    <div class="p-4 space-y-3">
      <input
        type="text"
        bind:value={query}
        placeholder="Search openings (e.g. Sicilian, B90)…"
        aria-label="Search openings"
        class="w-full text-sm rounded-lg px-3 py-2 border border-gray-300 text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />

      <form method="POST" action="?/updateOpening" use:enhance onsubmit={onclose}>
        <input type="hidden" name="rep_id" value={repId} />
        <input type="hidden" name="eco_code" value="" />
        <input type="hidden" name="eco_name" value="" />
        <button class="w-full text-left text-sm text-gray-500 hover:bg-gray-50 rounded-lg px-3 py-2">
          Unclassified
        </button>
      </form>

      {#if query.trim() && results.length === 0}
        <p class="text-sm text-gray-400 px-1">No matches.</p>
      {/if}

      {#if topResult}
        <form method="POST" action="?/updateOpening" use:enhance onsubmit={onclose}>
          <input type="hidden" name="rep_id" value={repId} />
          <input type="hidden" name="eco_code" value={topResult.code} />
          <input type="hidden" name="eco_name" value={topResult.name} />
          <button class="w-full text-left text-sm rounded-lg px-3 py-2 hover:bg-indigo-50">
            <span class="font-medium text-indigo-600">{topResult.code}</span>
            <span class="text-gray-700"> — {topResult.name}</span>
          </button>
        </form>
      {/if}

      {#if otherResults.length > 0}
        <ul class="flex flex-wrap gap-1.5">
          {#each otherResults as opening}
            <li>
              <form method="POST" action="?/updateOpening" use:enhance onsubmit={onclose}>
                <input type="hidden" name="rep_id" value={repId} />
                <input type="hidden" name="eco_code" value={opening.code} />
                <input type="hidden" name="eco_name" value={opening.name} />
                <button
                  title={opening.name}
                  aria-label="{opening.code} — {opening.name}"
                  class="text-xs font-medium text-indigo-600 bg-indigo-50 rounded-full px-2.5 py-1 hover:bg-indigo-100"
                >
                  {opening.code}
                </button>
              </form>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
</div>
