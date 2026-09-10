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
  import { CURATED_OPENINGS, type OpeningSide } from '$lib/openings/taxonomy';
  import { curatedOpeningName, resolveOpening } from '$lib/openings/resolve';
  import PickerModal from './PickerModal.svelte';

  // `currentOpeningId` is the STORED override, not the resolved answer. The two
  // differ on almost every repertoire — the column is null by design and the
  // opening is derived — and it is the stored value the picker writes, so it is
  // the stored value that decides which row reads as chosen. Showing the
  // derived entry as selected would tell a coach they had made a choice they
  // never made (GitHub issue #205).
  let {
    repId,
    color,
    ecoCode,
    currentOpeningId,
    onclose
  }: {
    repId: string;
    color: OpeningSide | null;
    ecoCode: string | null;
    currentOpeningId: string | null;
    onclose: () => void;
  } = $props();

  const choices = $derived(CURATED_OPENINGS.filter((opening) => opening.side === color));

  // What "Auto" would land on right now, so the row says what it means rather
  // than leaving the coach to guess what the ECO code derives to.
  const autoOpening = $derived(resolveOpening({ eco_code: ecoCode, color, opening_id: null }));

  const SELECTED_CLASS = 'bg-indigo-50 text-(--color-accent) font-medium dark:bg-indigo-950';

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

<PickerModal
  heading={m.curated_opening_picker_heading()}
  closeLabel={m.curated_opening_picker_close_label()}
  {onclose}
>
  <div class="space-y-1">
    {#if errorMessage}
      <p class="text-red-600 text-sm bg-red-50 border border-red-200 dark:bg-red-950 dark:border-red-800 dark:text-red-400 rounded-lg px-3 py-2">{errorMessage}</p>
    {/if}

    <form method="POST" action="?/updateCuratedOpening" use:enhance={handleSubmit}>
      <input type="hidden" name="rep_id" value={repId} />
      <input type="hidden" name="opening_id" value="" />
      <button
        aria-current={currentOpeningId === null ? 'true' : undefined}
        class="w-full text-left text-sm rounded-lg px-3 py-2 flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800 {currentOpeningId ===
        null
          ? SELECTED_CLASS
          : 'text-(--color-muted)'}"
      >
        <span aria-hidden="true" class="w-3 shrink-0">{currentOpeningId === null ? '✓' : ''}</span>
        <span>
          {m.curated_opening_picker_auto()}
          {#if autoOpening}
            <span class="text-(--color-muted) font-normal"
              >— {m.curated_opening_picker_auto_current({ name: curatedOpeningName(autoOpening, getLocale()) ?? '' })}</span
            >
          {/if}
        </span>
      </button>
    </form>

    {#if choices.length === 0}
      <p class="text-sm text-(--color-muted) px-1">{m.curated_opening_picker_none_for_colour()}</p>
    {/if}

    <ul class="space-y-1">
      {#each choices as opening (opening.id)}
        <li>
          <form method="POST" action="?/updateCuratedOpening" use:enhance={handleSubmit}>
            <input type="hidden" name="rep_id" value={repId} />
            <input type="hidden" name="opening_id" value={opening.id} />
            <button
              aria-current={currentOpeningId === opening.id ? 'true' : undefined}
              class="w-full text-left text-sm rounded-lg px-3 py-2 flex items-center gap-2 hover:bg-indigo-50 dark:hover:bg-indigo-950 {currentOpeningId ===
              opening.id
                ? SELECTED_CLASS
                : 'text-(--color-text)'}"
            >
              <span aria-hidden="true" class="w-3 shrink-0">{currentOpeningId === opening.id ? '✓' : ''}</span>
              <span>{curatedOpeningName(opening, getLocale())}</span>
            </button>
          </form>
        </li>
      {/each}
    </ul>
  </div>
</PickerModal>
