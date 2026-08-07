<script lang="ts">
  import { enhance } from '$app/forms';
  import { searchOpenings } from '$lib/openings/classify';
  import { ECO_OPENINGS } from '$lib/openings/eco-data';

  let { repId, onclose } = $props<{ repId: string; onclose: () => void }>();

  let query = $state('');
  const results = $derived(searchOpenings(query, ECO_OPENINGS).slice(0, 30));

  let errorMessage = $state<string | null>(null);

  function handleSubmit() {
    return async ({ result, update }: { result: { type: string }; update: () => Promise<void> }) => {
      if (result.type === 'success') {
        onclose();
      } else {
        errorMessage = 'Could not update the opening — try again.';
      }
      await update();
    };
  }
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
      {#if errorMessage}
        <p class="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{errorMessage}</p>
      {/if}

      <input
        type="text"
        bind:value={query}
        placeholder="Search openings (e.g. Sicilian, B90)…"
        aria-label="Search openings"
        class="w-full text-sm rounded-lg px-3 py-2 border border-gray-300 text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />

      <form method="POST" action="?/updateOpening" use:enhance={handleSubmit}>
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

      <ul class="space-y-1">
        {#each results as opening (opening.code)}
          <li>
            <form method="POST" action="?/updateOpening" use:enhance={handleSubmit}>
              <input type="hidden" name="rep_id" value={repId} />
              <input type="hidden" name="eco_code" value={opening.code} />
              <input type="hidden" name="eco_name" value={opening.name} />
              <button class="w-full text-left text-sm rounded-lg px-3 py-2 hover:bg-indigo-50">
                <span class="font-medium text-indigo-600">{opening.code}</span>
                <span class="text-gray-700"> — {opening.name}</span>
              </button>
            </form>
          </li>
        {/each}
      </ul>
    </div>
  </div>
</div>
