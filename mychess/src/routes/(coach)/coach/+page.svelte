<script lang="ts">
  let { data } = $props<{ data: any }>();
  const profile = $derived(data.profile as any);
  const players = $derived<any[]>(data.players ?? []);
  const pendingCount = $derived(data.pendingCount ?? 0);
</script>

<svelte:head>
  <title>Coach Dashboard — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
  <div class="max-w-2xl mx-auto px-4 py-6">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Coach Dashboard</h1>
        <p class="text-gray-500 text-sm">Welcome back, {profile?.display_name ?? 'Coach'}</p>
      </div>
      <a href="/coach/invite"
         class="bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors">
        + Invite Player
      </a>
    </div>

    {#if pendingCount > 0}
      <a href="/coach/students"
         class="block mb-6 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 hover:bg-amber-100 transition-colors">
        You have {pendingCount} pending student {pendingCount === 1 ? 'request' : 'requests'} — review them →
      </a>
    {/if}

    <div class="grid grid-cols-2 gap-4 mb-6">
      <a href="/coach/students"
         class="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
        <p class="text-2xl mb-2">👥</p>
        <p class="font-semibold text-gray-900">Find Players</p>
        <p class="text-sm text-gray-400">Browse and request students</p>
      </a>
      <a href="/coach/invite"
         class="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
        <p class="text-2xl mb-2">🔗</p>
        <p class="font-semibold text-gray-900">Invite Links</p>
        <p class="text-sm text-gray-400">Invite students to join</p>
      </a>
    </div>

    {#if players.length > 0}
      <section class="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
        <h2 class="font-semibold text-gray-900 mb-4">Your Players ({players.length})</h2>
        <ul class="space-y-1">
          {#each players as player}
            <li>
              <a href="/coach/players/{player.id}"
                 class="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                <div class="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 font-bold text-sm flex items-center justify-center">
                  {(player.display_name ?? 'P')[0].toUpperCase()}
                </div>
                <span class="font-medium text-gray-900">{player.display_name}</span>
                <span class="ml-auto text-gray-400 text-sm">→</span>
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {:else}
      <div class="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400">
        <p class="text-4xl mb-3">👤</p>
        <p class="font-medium text-gray-500">No players yet</p>
        <p class="text-sm mt-1">Use Invite Links to add your first student.</p>
      </div>
    {/if}
  </div>
</main>
