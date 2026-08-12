<script lang="ts">
  import RepertoirePracticeRow from '$lib/components/RepertoirePracticeRow.svelte';

  let { data } = $props<{ data: { repertoires: any[] } }>();
</script>

<svelte:head>
  <title>Practice Your Repertoires — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
  <div class="max-w-2xl mx-auto px-4 py-6">
    <h1 class="text-2xl font-bold text-gray-900 mb-4">Practice Your Repertoires</h1>

    {#if data.repertoires.length === 0}
      <div class="text-center py-16 text-gray-400">
        <p class="text-4xl mb-4">📚</p>
        <p class="font-semibold text-lg text-gray-500">No repertoires yet</p>
        <p class="text-sm mt-1">Ask your coach to assign one, or create your own.</p>
      </div>
    {:else}
      <ul class="space-y-2">
        {#each data.repertoires as rep (rep.id)}
          <RepertoirePracticeRow {rep} />
        {/each}
      </ul>
    {/if}
  </div>
</main>
