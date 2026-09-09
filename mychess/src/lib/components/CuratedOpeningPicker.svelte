<!-- mychess/src/lib/components/CuratedOpeningPicker.svelte -->
<!--
	Sets `repertoires.opening_id` — a coach's explicit answer to "which prep item
	is this file for" (GitHub issue #201).

	Deliberately NOT a mode of `OpeningPicker.svelte`. That one searches 500 ECO
	entries and posts `eco_code`/`eco_name`, classifying the repertoire; this one
	lists a few dozen curated openings and posts `opening_id`. They are different
	questions that happen to be linked, and one component serving both is how a
	coach ends up changing an ECO code to move a file between prep categories.

	Only entries matching the repertoire's own colour are offered — a white file
	cannot be preparation for Black's side of anything.
-->
<script lang="ts">
  import { enhance } from '$app/forms';
  import { getLocale } from '$lib/paraglide/runtime';
  import { m } from '$lib/paraglide/messages';
  import { CURATED_OPENINGS } from '$lib/openings/taxonomy';
  import { curatedOpeningName } from '$lib/openings/resolve';

  let {
    repId,
    color,
    onclose
  }: { repId: string; color: string | null; onclose: () => void } = $props();

  const choices = $derived(CURATED_OPENINGS.filter((opening) => opening.side === color));

  function handleSubmit() {
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      onclose();
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
      <h2 class="font-semibold text-(--color-text)">{m.curated_opening_picker_heading()}</h2>
      <button
        type="button"
        onclick={onclose}
        aria-label={m.curated_opening_picker_close_label()}
        class="text-(--color-muted) hover:text-gray-600 dark:hover:text-gray-400 text-xl leading-none"
      >
        &times;
      </button>
    </div>

    <div class="p-4 space-y-1">
      <form method="POST" action="?/updateRepertoireOpening" use:enhance={handleSubmit}>
        <input type="hidden" name="rep_id" value={repId} />
        <input type="hidden" name="opening_id" value="" />
        <button class="w-full text-left text-sm text-(--color-muted) hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg px-3 py-2">
          {m.curated_opening_picker_auto()}
        </button>
      </form>

      {#if choices.length === 0}
        <p class="text-sm text-(--color-muted) px-1">{m.curated_opening_picker_none_for_colour()}</p>
      {/if}

      {#each choices as opening (opening.id)}
        <form method="POST" action="?/updateRepertoireOpening" use:enhance={handleSubmit}>
          <input type="hidden" name="rep_id" value={repId} />
          <input type="hidden" name="opening_id" value={opening.id} />
          <button class="w-full text-left text-sm rounded-lg px-3 py-2 hover:bg-indigo-50 text-(--color-text)">
            {curatedOpeningName(opening, getLocale())}
          </button>
        </form>
      {/each}
    </div>
  </div>
</div>
