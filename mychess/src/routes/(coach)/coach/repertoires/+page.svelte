<script lang="ts">
  import { enhance } from '$app/forms';

  let { data, form } = $props<{ data: { repertoires: any[] }; form: any }>();

  function confirmDelete(e: SubmitEvent, name: string) {
    if (!confirm(`Delete "${name}"? This can't be undone, and it will also remove it from any student it's assigned to.`)) {
      e.preventDefault();
    }
  }
</script>

<svelte:head>
  <title>Repertoires — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
  <div class="max-w-2xl mx-auto px-4 py-6">
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-2xl font-bold text-gray-900">Repertoires</h1>
      <a href="/coach/pgn"
         class="text-sm bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors">
        + Upload PGN
      </a>
    </div>

    {#if form?.error}
      <p class="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{form.error}</p>
    {/if}

    {#if data.repertoires.length === 0}
      <div class="text-center py-16 text-gray-400">
        <p class="text-4xl mb-4">📚</p>
        <p class="font-semibold text-lg text-gray-500">No repertoires yet</p>
        <p class="text-sm mt-1">Upload a PGN to build your library, then assign it to students.</p>
      </div>
    {:else}
      <ul class="space-y-2">
        {#each data.repertoires as rep}
          <li class="flex items-center gap-3 bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <span class="w-3 h-3 rounded-full shrink-0" style="background:{rep.color ?? '#4f46e5'}"></span>
            <div class="flex-1 min-w-0">
              <h2 class="font-medium text-gray-900 truncate">{rep.name}</h2>
              <p class="text-sm text-gray-400">{rep.moves?.[0]?.count ?? 0} moves</p>
            </div>
            <form method="POST" action="?/delete" use:enhance onsubmit={(e) => confirmDelete(e, rep.name)}>
              <input type="hidden" name="rep_id" value={rep.id} />
              <button class="text-sm text-red-600 hover:underline">Delete</button>
            </form>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</main>
