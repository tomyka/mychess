<script lang="ts">
  let { data } = $props<{ data: any }>();

  const badges: any[] = (data as any).badges ?? [];
  const earnedCount = $derived(badges.filter((b: any) => b.earned).length);
</script>

<div class="min-h-screen bg-gradient-to-b from-yellow-50 to-amber-100 p-4">
  <div class="max-w-lg mx-auto">
    <div class="flex items-center gap-3 mb-5">
      <a href="/" class="text-2xl">⬅️</a>
      <div>
        <h1 class="text-2xl font-bold text-amber-800">🏆 Trophy Room</h1>
        <p class="text-sm text-amber-600">{earnedCount} / {badges.length} badges earned</p>
      </div>
    </div>

    <div class="bg-amber-200 rounded-full h-3 mb-5 overflow-hidden">
      <div
        class="h-full bg-amber-500 rounded-full transition-all"
        style="width: {Math.round((earnedCount / Math.max(badges.length, 1)) * 100)}%"
      ></div>
    </div>

    <div class="grid grid-cols-3 gap-3">
      {#each badges as badge}
        <div
          class="rounded-2xl p-3 text-center transition-all
                 {badge.earned
                   ? 'bg-white shadow-md border-2 border-amber-300'
                   : 'bg-gray-100 opacity-40 grayscale'}"
        >
          <div class="text-3xl mb-1">{badge.earned ? '🏅' : '🔒'}</div>
          <p class="text-xs font-bold leading-tight text-gray-800">{badge.name}</p>
          <p class="text-xs text-gray-500 mt-0.5 leading-tight">{badge.description}</p>
          {#if badge.earned}
            <p class="text-xs text-amber-600 font-bold mt-1">+{badge.xp_reward} XP</p>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>
