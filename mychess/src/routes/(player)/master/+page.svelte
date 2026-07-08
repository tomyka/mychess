<!-- mychess/src/routes/(player)/master/+page.svelte -->
<script lang="ts">
  let { data } = $props<{ data: { repertoires: any[] } }>();
</script>

<svelte:head>
  <title>Master Your Repertoires — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
  <div class="max-w-2xl mx-auto px-4 py-6">
    <h1 class="text-2xl font-bold text-gray-900 mb-4">Master Your Repertoires</h1>

    {#if data.repertoires.length === 0}
      <div class="text-center py-16 text-gray-400">
        <p class="text-4xl mb-4">📚</p>
        <p class="font-semibold text-lg text-gray-500">No repertoires yet</p>
        <p class="text-sm mt-1">Ask your coach to assign one, or create your own.</p>
      </div>
    {:else}
      <ul class="space-y-2">
        {#each data.repertoires as rep}
          <li>
            <a href="/master/{rep.id}"
               class="flex items-center gap-3 bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:shadow-md transition-shadow">
              <span class="w-3 h-3 rounded-full shrink-0" style="background:{rep.color === 'black' ? '#1f2937' : '#e5e7eb'}"></span>
              <div class="flex-1 min-w-0">
                <h2 class="font-medium text-gray-900 truncate">{rep.name}</h2>
                <p class="text-sm text-gray-400">
                  {rep.level === 'mastered' ? '🏆 Mastered' : `Level ${rep.level} · ${rep.totalVariations} variations`}
                </p>
              </div>
              <span class="text-gray-400 text-sm">→</span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</main>
