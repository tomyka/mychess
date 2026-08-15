<script lang="ts">
  import { enhance } from '$app/forms';
  import OpeningPicker from '$lib/components/OpeningPicker.svelte';

  let { data, form } = $props<{ data: { repertoires: any[]; players: any[] }; form: any }>();
  let filter = $state<'all' | 'white' | 'black'>('all');
  const filtered = $derived(
    filter === 'all' ? data.repertoires : data.repertoires.filter((r: any) => r.color === filter)
  );

  let assignModalRepId = $state<string | null>(null);
  const assignModalRep = $derived(
    assignModalRepId ? data.repertoires.find((r: any) => r.id === assignModalRepId) ?? null : null
  );

  let openingModalRepId = $state<string | null>(null);

  function confirmDelete(e: SubmitEvent, name: string) {
    if (!confirm(`Delete "${name}"? This can't be undone, and it will also remove it from any student it's assigned to.`)) {
      e.preventDefault();
    }
  }
</script>

<svelte:head>
  <title>Repertoires — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
  <div class="max-w-2xl mx-auto px-4 py-6">
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-2xl font-bold text-(--color-text)">Repertoires</h1>
      <a href="/coach/pgn"
         class="text-sm bg-(--color-accent) text-white px-4 py-2 rounded-lg font-medium hover:bg-(--color-accent-hover) transition-colors">
        + Upload PGN
      </a>
    </div>

    {#if form?.error}
      <p class="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4 dark:bg-red-950 dark:border-red-800 dark:text-red-400">{form.error}</p>
    {/if}

    {#if data.repertoires.length > 0}
      <div class="flex gap-2 mb-4">
        {#each [{ id: 'all', label: 'All' }, { id: 'white', label: 'White' }, { id: 'black', label: 'Black' }] as const as t (t.id)}
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
        <p class="font-semibold text-lg text-(--color-muted)">No repertoires yet</p>
        <p class="text-sm mt-1">Upload a PGN to build your library, then assign it to students.</p>
      </div>
    {:else if filtered.length === 0}
      <div class="text-center py-16 text-(--color-muted)">
        <p class="text-4xl mb-4">📚</p>
        <p class="font-semibold text-lg text-(--color-muted)">No {filter} repertoires</p>
      </div>
    {:else}
      <ul class="space-y-2">
        {#each filtered as rep (rep.id)}
          <li class="bg-(--color-surface) rounded-xl border border-(--color-border) shadow-sm p-4">
            <div class="flex items-center gap-3">
              <span class="w-3 h-3 rounded-full shrink-0" style="background:{rep.color ?? '#4f46e5'}"></span>
              <div class="flex-1 min-w-0">
                <h2 class="font-medium text-(--color-text) truncate">{rep.name}</h2>
                <p class="text-sm text-(--color-muted)">{rep.moves?.[0]?.count ?? 0} moves</p>
                <p class="text-xs mt-0.5">
                  {#if rep.eco_code}
                    <span class="text-(--color-accent) font-medium">{rep.eco_code}</span>
                    <span class="text-(--color-muted)"> — {rep.eco_name}</span>
                  {:else}
                    <span class="text-(--color-muted)">Unclassified</span>
                  {/if}
                  <button type="button" onclick={() => (openingModalRepId = rep.id)}
                          class="text-(--color-muted) hover:text-indigo-600 hover:underline ml-1">
                    change
                  </button>
                </p>
              </div>
              <button
                type="button"
                onclick={() => (assignModalRepId = rep.id)}
                title="Assign to players"
                class="w-8 h-8 shrink-0 flex items-center justify-center rounded-full bg-indigo-50 text-(--color-accent) hover:bg-indigo-100 transition-colors font-bold dark:bg-indigo-950"
              >
                +
              </button>
              <form method="POST" action="?/delete" use:enhance onsubmit={(e) => confirmDelete(e, rep.name)}>
                <input type="hidden" name="rep_id" value={rep.id} />
                <button class="text-sm bg-red-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-red-700 transition-colors shrink-0">Delete</button>
              </form>
            </div>

            <div class="mt-3 pt-3 border-t border-gray-100">
              <p class="text-xs text-(--color-muted)">
                {#if rep.assignedPlayers.length > 0}
                  Assigned to: {rep.assignedPlayers.map((p: any) => p.display_name).join(', ')}
                {:else}
                  Not assigned to anyone yet
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
          aria-label="Close"
          class="text-(--color-muted) hover:text-gray-600 dark:hover:text-gray-400 text-xl leading-none"
        >
          &times;
        </button>
      </div>

      <div class="p-4">
        {#if data.players.length === 0}
          <p class="text-sm text-(--color-muted)">You don't have any active students yet.</p>
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
                    <button class="text-sm text-red-600 hover:underline shrink-0 dark:text-red-400">Remove</button>
                  </form>
                {:else}
                  <form method="POST" action="?/assign" use:enhance>
                    <input type="hidden" name="rep_id" value={assignModalRep.id} />
                    <input type="hidden" name="player_id" value={player.id} />
                    <button class="text-sm bg-(--color-accent) text-white px-3 py-1 rounded-lg hover:bg-(--color-accent-hover) transition-colors shrink-0">
                      Assign
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
