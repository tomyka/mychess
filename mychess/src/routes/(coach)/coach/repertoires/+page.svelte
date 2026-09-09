<script lang="ts">
  import { enhance } from '$app/forms';
  import OpeningPicker from '$lib/components/OpeningPicker.svelte';
  import CuratedOpeningPicker from '$lib/components/CuratedOpeningPicker.svelte';
  import { localizedOpeningName } from '$lib/openings/name';
  import { resolveOpening, curatedOpeningName } from '$lib/openings/resolve';
  import { m } from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';

  let { data, form } = $props<{ data: { repertoires: any[]; players: any[] }; form: any }>();
  let filter = $state<'all' | 'white' | 'black'>('all');
  const filtered = $derived(
    filter === 'all' ? data.repertoires : data.repertoires.filter((r: any) => r.color === filter)
  );
  const filterNoneLabel = $derived(
    filter === 'white'
      ? m.coach_repertoires_filter_none_white()
      : filter === 'black'
        ? m.coach_repertoires_filter_none_black()
        : m.coach_repertoires_filter_none_all()
  );

  let assignModalRepId = $state<string | null>(null);
  const assignModalRep = $derived(
    assignModalRepId ? data.repertoires.find((r: any) => r.id === assignModalRepId) ?? null : null
  );

  let openingModalRepId = $state<string | null>(null);

  let prepModalRepId = $state<string | null>(null);
  const prepModalRep = $derived(
    prepModalRepId ? data.repertoires.find((r: any) => r.id === prepModalRepId) ?? null : null
  );

  function confirmDelete(e: SubmitEvent, name: string) {
    if (!confirm(m.coach_repertoires_confirm_delete({ name }))) {
      e.preventDefault();
    }
  }
</script>

<svelte:head>
  <title>{m.seo_coach_repertoires_title()}</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
  <div class="max-w-2xl mx-auto px-4 py-6">
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-2xl font-bold text-(--color-text)">{m.coach_repertoires_heading()}</h1>
      <a href="/coach/pgn"
         class="text-sm bg-(--color-accent) text-white px-4 py-2 rounded-lg font-medium hover:bg-(--color-accent-hover) transition-colors">
        {m.coach_repertoires_upload_button()}
      </a>
    </div>

    {#if form?.error}
      <p class="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4 dark:bg-red-950 dark:border-red-800 dark:text-red-400">{form.error}</p>
    {/if}

    {#if data.repertoires.length > 0}
      <div class="flex gap-2 mb-4">
        {#each [{ id: 'all', label: m.coach_repertoires_filter_all() }, { id: 'white', label: m.coach_repertoires_filter_white() }, { id: 'black', label: m.coach_repertoires_filter_black() }] as const as t (t.id)}
          <button
            type="button"
            onclick={() => (filter = t.id)}
            class="px-4 py-1.5 rounded-lg text-sm font-medium transition-colors
                   {filter === t.id ? 'bg-(--color-accent) text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'}"
          >
            {t.label}
          </button>
        {/each}
      </div>
    {/if}

    {#if data.repertoires.length === 0}
      <div class="text-center py-16 text-(--color-muted)">
        <p class="text-4xl mb-4">📚</p>
        <p class="font-semibold text-lg text-(--color-muted)">{m.coach_repertoires_none_yet_heading()}</p>
        <p class="text-sm mt-1">{m.coach_repertoires_none_yet_subtitle()}</p>
      </div>
    {:else if filtered.length === 0}
      <div class="text-center py-16 text-(--color-muted)">
        <p class="text-4xl mb-4">📚</p>
        <p class="font-semibold text-lg text-(--color-muted)">{m.coach_repertoires_none_for_filter({ filterLabel: filterNoneLabel })}</p>
      </div>
    {:else}
      <ul class="space-y-2">
        {#each filtered as rep (rep.id)}
          {@const resolvedOpeningName = curatedOpeningName(resolveOpening(rep), getLocale())}
          <li class="bg-(--color-surface) rounded-xl border border-(--color-border) shadow-sm p-4">
            <div class="flex items-center gap-3">
              <span class="w-3 h-3 rounded-full shrink-0" style="background:{rep.color ?? '#4f46e5'}"></span>
              <div class="flex-1 min-w-0">
                <h2 class="font-medium text-(--color-text) truncate">{rep.name}</h2>
                <p class="text-sm text-(--color-muted)">{m.coach_repertoires_move_count({ count: rep.moves?.[0]?.count ?? 0 })}</p>
                <p class="text-xs mt-0.5">
                  {#if resolvedOpeningName}
                    <span class="text-(--color-accent) font-medium" title={rep.eco_code || undefined}>
                      {resolvedOpeningName}
                    </span>
                  {:else if rep.eco_code}
                    <span class="text-(--color-accent) font-medium">{rep.eco_code}</span>
                    <span class="text-(--color-muted)">
                      — {localizedOpeningName({
                        code: rep.eco_code,
                        englishName: rep.eco_name,
                        locale: getLocale()
                      })}
                    </span>
                  {:else}
                    <span class="text-(--color-muted)">{m.coach_repertoires_unclassified()}</span>
                  {/if}
                  <button type="button" onclick={() => (openingModalRepId = rep.id)}
                          class="text-(--color-muted) hover:text-indigo-600 hover:underline ml-1">
                    {m.coach_repertoires_change_button()}
                  </button>
                  <button type="button" onclick={() => (prepModalRepId = rep.id)}
                          class="text-(--color-muted) hover:text-indigo-600 hover:underline ml-1">
                    {m.coach_repertoires_prep_change_button()}
                  </button>
                </p>
              </div>
              <button
                type="button"
                onclick={() => (assignModalRepId = rep.id)}
                title={m.coach_repertoires_assign_title()}
                class="w-8 h-8 shrink-0 flex items-center justify-center rounded-full bg-indigo-50 text-(--color-accent) hover:bg-indigo-100 transition-colors font-bold dark:bg-indigo-950"
              >
                +
              </button>
              <a href="/coach/repertoires/{rep.id}/chapters"
                 class="text-sm bg-(--color-accent) text-white px-3 py-1.5 rounded-lg font-medium hover:bg-(--color-accent-hover) focus:bg-(--color-accent-hover) transition-colors shrink-0">
                {m.coach_chapters_link()}
              </a>
              <a href="/coach/repertoires/{rep.id}/update"
                 title={m.coach_repertoires_update_title()}
                 class="text-sm bg-(--color-accent) text-white px-3 py-1.5 rounded-lg font-medium hover:bg-(--color-accent-hover) focus:bg-(--color-accent-hover) transition-colors shrink-0">
                {m.coach_repertoires_update_link()}
              </a>
              <form method="POST" action="?/delete" use:enhance onsubmit={(e) => confirmDelete(e, rep.name)}>
                <input type="hidden" name="rep_id" value={rep.id} />
                <button class="text-sm bg-red-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-red-700 transition-colors shrink-0">{m.coach_repertoires_delete_button()}</button>
              </form>
            </div>

            <div class="mt-3 pt-3 border-t border-gray-100">
              <p class="text-xs text-(--color-muted)">
                {#if rep.assignedPlayers.length > 0}
                  {m.coach_repertoires_assigned_to({ names: rep.assignedPlayers.map((p: any) => p.display_name).join(', ') })}
                {:else}
                  {m.coach_repertoires_not_assigned()}
                {/if}
              </p>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</main>

{#if assignModalRep}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
    onclick={() => (assignModalRepId = null)}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="bg-(--color-surface) rounded-xl shadow-lg max-w-sm w-full max-h-[80vh] overflow-y-auto"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between p-4 border-b border-gray-100">
        <h2 class="font-semibold text-(--color-text) truncate">{assignModalRep.name}</h2>
        <button
          type="button"
          onclick={() => (assignModalRepId = null)}
          aria-label={m.coach_repertoires_close_label()}
          class="text-(--color-muted) hover:text-gray-600 dark:hover:text-gray-400 text-xl leading-none"
        >
          &times;
        </button>
      </div>

      <div class="p-4">
        {#if data.players.length === 0}
          <p class="text-sm text-(--color-muted)">{m.coach_repertoires_no_active_students()}</p>
        {:else}
          <ul class="space-y-2">
            {#each data.players as player (player.id)}
              {@const isAssigned = assignModalRep.assignedPlayers.some((p: any) => p.id === player.id)}
              <li class="flex items-center justify-between gap-3">
                <span class="text-sm text-(--color-text) truncate">{player.display_name}</span>
                {#if isAssigned}
                  <form method="POST" action="?/unassign" use:enhance>
                    <input type="hidden" name="rep_id" value={assignModalRep.id} />
                    <input type="hidden" name="player_id" value={player.id} />
                    <button class="text-sm text-red-600 hover:underline shrink-0 dark:text-red-400">{m.coach_repertoires_unassign_button()}</button>
                  </form>
                {:else}
                  <form method="POST" action="?/assign" use:enhance>
                    <input type="hidden" name="rep_id" value={assignModalRep.id} />
                    <input type="hidden" name="player_id" value={player.id} />
                    <button class="text-sm bg-(--color-accent) text-white px-3 py-1 rounded-lg hover:bg-(--color-accent-hover) transition-colors shrink-0">
                      {m.coach_repertoires_assign_button()}
                    </button>
                  </form>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if openingModalRepId}
  <OpeningPicker repId={openingModalRepId} onclose={() => (openingModalRepId = null)} />
{/if}

{#if prepModalRep}
  <CuratedOpeningPicker
    repId={prepModalRep.id}
    color={prepModalRep.color}
    onclose={() => (prepModalRepId = null)}
  />
{/if}
