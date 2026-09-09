<script lang="ts">
  import { enhance } from '$app/forms';
  import OpeningPicker from '$lib/components/OpeningPicker.svelte';
  import { localizedOpeningName } from '$lib/openings/name';
  import { resolveOpening, curatedOpeningName } from '$lib/openings/resolve';
  import { m } from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';

  let { data, form } = $props<{ data: { repertoires: any[]; assignedRepertoires: any[] }; form?: any }>();
  let openingModalRepId = $state<string | null>(null);

  function confirmDelete(e: SubmitEvent, name: string) {
    if (!confirm(m.repertoires_delete_confirm({ name }))) {
      e.preventDefault();
    }
  }
</script>

<svelte:head>
  <title>{m.seo_repertoires_title()}</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-8">

    {#if form?.error}
      <p class="text-red-600 dark:text-red-400 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 dark:bg-red-950 dark:border-red-800">{form.error}</p>
    {/if}

    {#if data.assignedRepertoires?.length > 0}
      <section>
        <h1 class="text-2xl font-bold text-(--color-text) mb-4">{m.repertoires_assigned_heading()}</h1>
        <ul class="space-y-2">
          {#each data.assignedRepertoires as rep (rep.id)}
            {@const resolvedOpeningName = curatedOpeningName(resolveOpening(rep), getLocale())}
            <li class="flex items-center gap-3 bg-(--color-surface) rounded-xl border border-indigo-200 shadow-sm p-4">
              <span class="w-3 h-3 rounded-full shrink-0" style="background:{rep.color ?? '#4f46e5'}"></span>
              <div class="flex-1 min-w-0">
                <h2 class="font-medium text-(--color-text) truncate">{rep.name}</h2>
                <p class="text-sm text-(--color-muted)">{m.repertoires_moves_count({ count: rep.moves?.[0]?.count ?? 0 })}</p>
                {#if resolvedOpeningName}
                  <p class="text-xs text-indigo-500">{resolvedOpeningName}</p>
                {:else if rep.eco_code}
                  <p class="text-xs text-indigo-500">
                    {rep.eco_code} — {localizedOpeningName({
                      code: rep.eco_code,
                      englishName: rep.eco_name,
                      locale: getLocale()
                    })}
                  </p>
                {/if}
              </div>
              <a href={rep.allSolved ? `/practice/${rep.id}` : `/learn/${rep.id}`}
                 class="text-sm bg-(--color-accent) text-white px-3 py-1.5 rounded-lg font-medium hover:bg-(--color-accent-hover) transition-colors">
                {rep.allSolved ? m.repertoires_action_practice() : m.repertoires_action_learn()}
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section>
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-2xl font-bold text-(--color-text)">{m.repertoires_title()}</h1>
        <a href="/repertoires/new"
           class="text-sm bg-(--color-accent) text-white px-4 py-2 rounded-lg font-medium hover:bg-(--color-accent-hover) transition-colors">
          {m.repertoires_create_button()}
        </a>
      </div>
      {#if data.repertoires.length === 0}
        <div class="text-center py-16 text-(--color-muted)">
          <p class="text-4xl mb-4">📚</p>
          <!-- Word-for-word the same copy as Learn's own no-repertoires state
               (learn_no_repertoires_title/_body) — deliberately shared rather
               than duplicated. -->
          <p class="font-semibold text-lg text-(--color-muted)">{m.learn_no_repertoires_title()}</p>
          {#if !data.assignedRepertoires?.length}
            <p class="text-sm mt-1">{m.learn_no_repertoires_body()}</p>
          {/if}
        </div>
      {:else}
        <ul class="space-y-2">
          {#each data.repertoires as rep (rep.id)}
            <li class="flex items-center gap-3 bg-(--color-surface) rounded-xl border border-(--color-border) shadow-sm p-4 hover:shadow-md transition-shadow">
              <a href={rep.allSolved ? `/practice/${rep.id}` : `/learn/${rep.id}`} class="flex items-center gap-3 flex-1 min-w-0">
                <span class="w-3 h-3 rounded-full shrink-0" style="background:{rep.color ?? '#4f46e5'}"></span>
                <div class="flex-1 min-w-0">
                  <h2 class="font-medium text-(--color-text) truncate">{rep.name}</h2>
                  <p class="text-sm text-(--color-muted)">{m.repertoires_moves_count({ count: rep.moves?.[0]?.count ?? 0 })}</p>
                </div>
                <span class="shrink-0 text-sm font-medium text-(--color-accent)">
                  {rep.allSolved ? m.repertoires_action_practice() : m.repertoires_action_learn()} →
                </span>
              </a>
              <button type="button" onclick={() => (openingModalRepId = rep.id)}
                      class="text-xs text-indigo-500 hover:underline shrink-0">
                {rep.eco_code ?? m.repertoires_unclassified_label()}
              </button>
              <form method="POST" action="?/delete" use:enhance onsubmit={(e) => confirmDelete(e, rep.name)}>
                <input type="hidden" name="rep_id" value={rep.id} />
                <button class="text-sm bg-red-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-red-700 transition-colors shrink-0">{m.repertoires_delete_button()}</button>
              </form>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

  </div>
</main>

{#if openingModalRepId}
  <OpeningPicker repId={openingModalRepId} onclose={() => (openingModalRepId = null)} />
{/if}
