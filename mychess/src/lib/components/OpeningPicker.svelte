<script lang="ts">
  import { enhance } from '$app/forms';
  import { searchOpenings } from '$lib/openings/classify';
  import { ECO_OPENINGS } from '$lib/openings/eco-data';
  import { m } from '$lib/paraglide/messages';

  let { repId, onclose } = $props<{ repId: string; onclose: () => void }>();

  let query = $state('');
  const results = $derived(searchOpenings(query, ECO_OPENINGS).slice(0, 30));

  let errorMessage = $state<string | null>(null);

  function handleSubmit() {
    return async ({ result, update }: { result: { type: string }; update: () => Promise<void> }) => {
      if (result.type === 'success') {
        onclose();
      } else {
        errorMessage = m.opening_picker_update_error();
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
    class="bg-(--color-surface) rounded-xl shadow-lg max-w-sm w-full max-h-[80vh] overflow-y-auto"
    onclick={(e) => e.stopPropagation()}
  >
    <div class="flex items-center justify-between p-4 border-b border-gray-100">
      <h2 class="font-semibold text-(--color-text)">{m.opening_picker_heading()}</h2>
      <button
        type="button"
        onclick={onclose}
        aria-label={m.picker_close_aria()}
        class="text-(--color-muted) hover:text-gray-600 dark:hover:text-gray-400 text-xl leading-none"
      >
        &times;
      </button>
    </div>

    <div class="p-4 space-y-3">
      {#if errorMessage}
        <p class="text-red-600 text-sm bg-red-50 border border-red-200 dark:bg-red-950 dark:border-red-800 dark:text-red-400 rounded-lg px-3 py-2">{errorMessage}</p>
      {/if}

      <input
        type="text"
        bind:value={query}
        placeholder={m.opening_picker_search_placeholder()}
        aria-label={m.opening_picker_search_aria()}
        class="w-full text-sm rounded-lg px-3 py-2 border border-(--color-border) text-(--color-text) focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />

      <form method="POST" action="?/updateOpening" use:enhance={handleSubmit}>
        <input type="hidden" name="rep_id" value={repId} />
        <input type="hidden" name="eco_code" value="" />
        <input type="hidden" name="eco_name" value="" />
        <button class="w-full text-left text-sm text-(--color-muted) hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg px-3 py-2">
          <!-- Same "Unclassified" fallback label as the repertoires list
               (repertoires_unclassified_label) — deliberately shared rather
               than duplicated. -->
          {m.repertoires_unclassified_label()}
        </button>
      </form>

      {#if query.trim() && results.length === 0}
        <p class="text-sm text-(--color-muted) px-1">{m.opening_picker_no_matches()}</p>
      {/if}

      <ul class="space-y-1">
        {#each results as opening (opening.code)}
          <li>
            <form method="POST" action="?/updateOpening" use:enhance={handleSubmit}>
              <input type="hidden" name="rep_id" value={repId} />
              <input type="hidden" name="eco_code" value={opening.code} />
              <input type="hidden" name="eco_name" value={opening.name} />
              <button class="w-full text-left text-sm rounded-lg px-3 py-2 hover:bg-indigo-50">
                <span class="font-medium text-(--color-accent)">{opening.code}</span>
                <span class="text-(--color-text)"> — {opening.name}</span>
              </button>
            </form>
          </li>
        {/each}
      </ul>
    </div>
  </div>
</div>
