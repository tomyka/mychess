<script lang="ts">
  import RepertoirePracticeRow from '$lib/components/RepertoirePracticeRow.svelte';

  let { data } = $props<{ data: { repertoires: any[]; hasAnyRepertoires?: boolean } }>();
</script>

<svelte:head>
  <title>Practice — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
  <div class="max-w-2xl mx-auto px-4 py-6">
    <h1 class="text-2xl font-bold text-(--color-text) mb-1">Practice</h1>
    <p class="text-sm text-(--color-muted) mb-4">
      Drill the lines you already know. New material lives in <a href="/learn" class="text-(--color-accent) hover:underline">Learn</a>.
    </p>

    {#if data.repertoires.length === 0}
      <div class="text-center py-16 text-(--color-muted)">
        <p class="text-4xl mb-4">📚</p>
        {#if data.hasAnyRepertoires}
          <p class="font-semibold text-lg text-(--color-muted)">Nothing ready to practice yet</p>
          <p class="text-sm mt-1">
            Finish a whole chapter in <a href="/learn" class="text-(--color-accent) hover:underline">Learn</a> and it'll
            show up here.
          </p>
        {:else}
          <p class="font-semibold text-lg text-(--color-muted)">No repertoires yet</p>
          <p class="text-sm mt-1">Ask your coach to assign one, or create your own.</p>
        {/if}
      </div>
    {:else}
      <ul class="space-y-2">
        {#each data.repertoires as rep (rep.id)}
          <RepertoirePracticeRow {rep} mode="practice" />
        {/each}
      </ul>
    {/if}
  </div>
</main>
