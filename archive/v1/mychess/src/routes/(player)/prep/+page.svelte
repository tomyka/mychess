<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import { curatedOpeningName } from '$lib/openings/resolve';

  let { data } = $props<{ data: any }>();

  const white = $derived(data.preparation.filter((p: any) => p.opening.side === 'white'));
  const black = $derived(data.preparation.filter((p: any) => p.opening.side === 'black'));
</script>

<svelte:head>
  <title>{m.seo_prep_title()}</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-8">
    <header>
      <h1 class="text-2xl font-bold text-(--color-text)">{m.prep_heading()}</h1>
      <p class="text-sm text-(--color-muted) mt-1">{m.prep_intro()}</p>
    </header>

    {#if data.preparation.length === 0}
      <p class="text-(--color-muted) text-sm">{m.prep_empty()}</p>
    {:else}
      {#each [{ side: 'white', label: m.prep_as_white(), rows: white }, { side: 'black', label: m.prep_as_black(), rows: black }] as group (group.side)}
        {#if group.rows.length > 0}
          <section>
            <h2 class="font-semibold text-(--color-text) mb-3">{group.label}</h2>
            <ul class="space-y-2">
              {#each group.rows as prep (prep.opening.id)}
                <li class="bg-(--color-surface) border border-(--color-border) rounded-xl shadow-sm p-4">
                  <div class="flex items-center gap-3">
                    <span
                      class="w-3 h-3 rounded-full shrink-0"
                      style="background:{prep.opening.side === 'black' ? '#1f2937' : '#e5e7eb'}"
                    ></span>
                    <div class="flex-1 min-w-0">
                      <h3 class="font-medium text-(--color-text) truncate">
                        {curatedOpeningName(prep.opening, getLocale())}
                      </h3>
                      <!-- The filename is secondary here on purpose: this view
                           exists because "which file was it" is the question a
                           student could not answer. -->
                      <p class="text-sm text-(--color-muted) truncate">{prep.repertoire.name}</p>
                    </div>
                    <a
                      href="/practice/{prep.repertoire.id}/mastery"
                      class="text-sm bg-(--color-accent) text-white px-3 py-1.5 rounded-lg font-medium hover:bg-(--color-accent-hover) transition-colors shrink-0"
                    >
                      {m.prep_view_lines()}
                    </a>
                  </div>
                </li>
              {/each}
            </ul>
          </section>
        {/if}
      {/each}
    {/if}
  </div>
</main>
