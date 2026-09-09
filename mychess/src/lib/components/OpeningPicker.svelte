<script lang="ts">
  import { enhance } from '$app/forms';
  import { searchOpenings } from '$lib/openings/classify';
  import { ECO_OPENINGS } from '$lib/openings/eco-data';
  import { ECO_NAMES_LT } from '$lib/openings/eco-data-lt';
  import { localizedOpeningName } from '$lib/openings/name';
  import { m } from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import PickerModal from './PickerModal.svelte';

  let { repId, onclose } = $props<{ repId: string; onclose: () => void }>();

  let query = $state('');
  // The Lithuanian names go in whatever the locale: the list shows them under
  // `lt`, and searching has to find what it shows (GitHub issue #200).
  const results = $derived(searchOpenings(query, ECO_OPENINGS, ECO_NAMES_LT).slice(0, 30));

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

<PickerModal heading={m.opening_picker_heading()} closeLabel={m.picker_close_aria()} {onclose}>
  <div class="space-y-3">
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
              <span class="text-(--color-text)">
                — {localizedOpeningName({
                  code: opening.code,
                  englishName: opening.name,
                  locale: getLocale()
                })}
              </span>
            </button>
          </form>
        </li>
      {/each}
    </ul>
  </div>
</PickerModal>
