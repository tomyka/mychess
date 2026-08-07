<script lang="ts">
  let { data } = $props<{ data: any }>();

  const badges = $derived((data as any).badges ?? []);
  const earnedCount = $derived(badges.filter((b: any) => b.earned).length);
</script>

<div class="min-h-screen bg-gray-50 p-4">
  <div class="max-w-lg mx-auto">
    <div class="flex items-center gap-3 mb-5">
      <a href="/" class="text-2xl">⬅️</a>
      <div>
        <h1 class="text-2xl font-bold text-gray-900">🏆 Trophy Room</h1>
        <p class="text-sm text-gray-500">{earnedCount} / {badges.length} badges earned</p>
      </div>
    </div>

    <div class="bg-gray-200 rounded-full h-3 mb-5 overflow-hidden">
      <div
        class="h-full bg-indigo-500 rounded-full transition-all"
        style="width: {Math.round((earnedCount / Math.max(badges.length, 1)) * 100)}%"
      ></div>
    </div>

    <div class="grid grid-cols-3 gap-3">
      {#each badges as badge (badge.id)}
        <div
          class="rounded-2xl p-3 text-center transition-all
                 {badge.earned
                   ? 'bg-white shadow-md border-2 border-indigo-200'
                   : 'bg-gray-100 opacity-40 grayscale'}"
        >
          <div class="text-3xl mb-1">{badge.earned ? '🏅' : '🔒'}</div>
          <p class="text-xs font-bold leading-tight text-gray-800">{badge.name}</p>
          <p class="text-xs text-gray-500 mt-0.5 leading-tight">{badge.description}</p>
        </div>
      {/each}
    </div>
  </div>
</div>
