<script lang="ts">
  import { enhance } from '$app/forms';
  import OpeningPicker from '$lib/components/OpeningPicker.svelte';

  let { data, form } = $props<{ data: { repertoires: any[]; assignedRepertoires: any[] }; form?: any }>();
  let openingModalRepId = $state<string | null>(null);

  function confirmDelete(e: SubmitEvent, name: string) {
    if (!confirm(`Delete "${name}"? This can't be undone and will also delete all practice history for it.`)) {
      e.preventDefault();
    }
  }
</script>

<svelte:head>
  <title>Repertoires — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-8">

    {#if form?.error}
      <p class="text-red-600 dark:text-red-400 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 dark:bg-red-950 dark:border-red-800">{form.error}</p>
    {/if}

    {#if data.assignedRepertoires?.length > 0}
      <section>
        <h1 class="text-2xl font-bold text-(--color-text) mb-4">Assigned by your coach</h1>
        <ul class="space-y-2">
          {#each data.assignedRepertoires as rep (rep.id)}
            <li class="flex items-center gap-3 bg-(--color-surface) rounded-xl border border-indigo-200 shadow-sm p-4">
              <span class="w-3 h-3 rounded-full shrink-0" style="background:{rep.color ?? '#4f46e5'}"></span>
              <div class="flex-1 min-w-0">
                <h2 class="font-medium text-(--color-text) truncate">{rep.name}</h2>
                <p class="text-sm text-(--color-muted)">{rep.moves?.[0]?.count ?? 0} moves</p>
                {#if rep.eco_code}
                  <p class="text-xs text-indigo-500">{rep.eco_code} — {rep.eco_name}</p>
                {/if}
              </div>
              <a href="/practice/{rep.id}" class="text-sm bg-(--color-accent) text-white px-3 py-1.5 rounded-lg font-medium hover:bg-(--color-accent-hover) transition-colors">Train</a>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section>
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-2xl font-bold text-(--color-text)">My Repertoires</h1>
        <a href="/repertoires/new"
           class="text-sm bg-(--color-accent) text-white px-4 py-2 rounded-lg font-medium hover:bg-(--color-accent-hover) transition-colors">
          + Create Repertoire
        </a>
      </div>
      {#if data.repertoires.length === 0}
        <div class="text-center py-16 text-(--color-muted)">
          <p class="text-4xl mb-4">📚</p>
          <p class="font-semibold text-lg text-(--color-muted)">No repertoires yet</p>
          {#if !data.assignedRepertoires?.length}
            <p class="text-sm mt-1">Ask your coach to assign one, or create your own.</p>
          {/if}
        </div>
      {:else}
        <ul class="space-y-2">
          {#each data.repertoires as rep (rep.id)}
            <li class="flex items-center gap-3 bg-(--color-surface) rounded-xl border border-(--color-border) shadow-sm p-4 hover:shadow-md transition-shadow">
              <a href="/practice/{rep.id}" class="flex items-center gap-3 flex-1 min-w-0">
                <span class="w-3 h-3 rounded-full shrink-0" style="background:{rep.color ?? '#4f46e5'}"></span>
                <div class="flex-1 min-w-0">
                  <h2 class="font-medium text-(--color-text) truncate">{rep.name}</h2>
                  <p class="text-sm text-(--color-muted)">{rep.moves?.[0]?.count ?? 0} moves</p>
                </div>
                <span class="text-(--color-muted) text-sm">→</span>
              </a>
              <button type="button" onclick={() => (openingModalRepId = rep.id)}
                      class="text-xs text-indigo-500 hover:underline shrink-0">
                {rep.eco_code ?? 'Unclassified'}
              </button>
              <form method="POST" action="?/delete" use:enhance onsubmit={(e) => confirmDelete(e, rep.name)}>
                <input type="hidden" name="rep_id" value={rep.id} />
                <button class="text-sm bg-red-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-red-700 transition-colors shrink-0">Delete</button>
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
