<script lang="ts">
  import OpeningPicker from '$lib/components/OpeningPicker.svelte';

  let { data } = $props<{ data: { repertoires: any[]; assignedRepertoires: any[] } }>();
  let openingModalRepId = $state<string | null>(null);
</script>

<svelte:head>
  <title>Repertoires — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-8">

    {#if data.assignedRepertoires?.length > 0}
      <section>
        <h1 class="text-2xl font-bold text-gray-900 mb-4">Assigned by your coach</h1>
        <ul class="space-y-2">
          {#each data.assignedRepertoires as rep (rep.id)}
            <li class="flex items-center gap-3 bg-white rounded-xl border border-indigo-200 shadow-sm p-4">
              <span class="w-3 h-3 rounded-full shrink-0" style="background:{rep.color ?? '#4f46e5'}"></span>
              <div class="flex-1 min-w-0">
                <h2 class="font-medium text-gray-900 truncate">{rep.name}</h2>
                <p class="text-sm text-gray-400">{rep.moves?.[0]?.count ?? 0} moves</p>
                {#if rep.eco_code}
                  <p class="text-xs text-indigo-500">{rep.eco_code} — {rep.eco_name}</p>
                {/if}
              </div>
              <a href="/practice/{rep.id}" class="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors">Train</a>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section>
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-2xl font-bold text-gray-900">My Repertoires</h1>
        <a href="/repertoires/new"
           class="text-sm bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors">
          + Create Repertoire
        </a>
      </div>
      {#if data.repertoires.length === 0}
        <div class="text-center py-16 text-gray-400">
          <p class="text-4xl mb-4">📚</p>
          <p class="font-semibold text-lg text-gray-500">No repertoires yet</p>
          {#if !data.assignedRepertoires?.length}
            <p class="text-sm mt-1">Ask your coach to assign one, or create your own.</p>
          {/if}
        </div>
      {:else}
        <ul class="space-y-2">
          {#each data.repertoires as rep (rep.id)}
            <li class="flex items-center gap-3 bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:shadow-md transition-shadow">
              <a href="/repertoires/{rep.id}" class="flex items-center gap-3 flex-1 min-w-0">
                <span class="w-3 h-3 rounded-full shrink-0" style="background:{rep.color ?? '#4f46e5'}"></span>
                <div class="flex-1 min-w-0">
                  <h2 class="font-medium text-gray-900 truncate">{rep.name}</h2>
                  <p class="text-sm text-gray-400">{rep.moves?.[0]?.count ?? 0} moves</p>
                </div>
                <span class="text-gray-400 text-sm">→</span>
              </a>
              <button type="button" onclick={() => (openingModalRepId = rep.id)}
                      class="text-xs text-indigo-500 hover:underline shrink-0">
                {rep.eco_code ?? 'Unclassified'}
              </button>
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
