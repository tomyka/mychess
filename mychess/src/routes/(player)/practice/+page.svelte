<script lang="ts">
  import RepertoirePracticeRow from '$lib/components/RepertoirePracticeRow.svelte';
  import { m } from '$lib/paraglide/messages';

  let { data } = $props<{ data: { repertoires: any[]; hasAnyRepertoires?: boolean } }>();
</script>

<svelte:head>
  <title>{m.seo_practice_title()}</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
  <div class="max-w-2xl mx-auto px-4 py-6">
    <h1 class="text-2xl font-bold text-(--color-text) mb-1">{m.practice_list_title()}</h1>
    <p class="text-sm text-(--color-muted) mb-4">
      {m.practice_list_subtitle_prefix()}<a href="/learn" class="text-(--color-accent) hover:underline">{m.practice_learn_link_anchor()}</a>.
    </p>

    {#if data.repertoires.length === 0}
      <div class="text-center py-16 text-(--color-muted)">
        <p class="text-4xl mb-4">📚</p>
        {#if data.hasAnyRepertoires}
          <p class="font-semibold text-lg text-(--color-muted)">{m.practice_list_empty_ready_title()}</p>
          <p class="text-sm mt-1">
            {m.practice_list_empty_ready_prefix()}<a href="/learn" class="text-(--color-accent) hover:underline">{m.practice_learn_link_anchor()}</a>{m.practice_list_empty_ready_suffix()}
          </p>
        {:else}
          <!-- Word-for-word the same copy as Learn's own no-repertoires state
               (learn_no_repertoires_title/_body) — deliberately shared rather
               than duplicated. -->
          <p class="font-semibold text-lg text-(--color-muted)">{m.learn_no_repertoires_title()}</p>
          <p class="text-sm mt-1">{m.learn_no_repertoires_body()}</p>
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
