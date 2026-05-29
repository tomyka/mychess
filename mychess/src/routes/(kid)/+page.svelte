<script lang="ts">
  import SirKnight from '$lib/components/SirKnight.svelte';
  import LeaderboardPodium from '$lib/components/LeaderboardPodium.svelte';

  let { data } = $props<{ data: any }>();

  const d = $derived(data as any);
  const stats = $derived(d.stats ?? {});
  const profile = $derived(d.profile as any);
  const quests = $derived(d.quests ?? []);
  const leaderboard = $derived(d.leaderboard ?? []);
  const unreadNote = $derived(d.unreadNote);

  const AVATAR_EMOJI: Record<string, string> = {
    knight: '♞', queen: '♛', king: '♚', rook: '♜', bishop: '♝', pawn: '♟'
  };
  const avatarEmoji = $derived(AVATAR_EMOJI[d.avatarId ?? 'knight'] ?? '♞');

  let noteDismissed = $state(false);

  async function dismissNote() {
    if (!unreadNote) return;
    noteDismissed = true;
    await fetch('/api/notes/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteId: unreadNote.id })
    });
  }
</script>

<main class="min-h-screen bg-slate-900 text-white p-4 max-w-lg mx-auto pb-24">

{#if !data.session}
  <!-- Guest landing page -->
  <div class="max-w-3xl mx-auto px-4 py-12 text-center">
    <h1 class="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-3">
      Your chess, in one place
    </h1>
    <p class="text-gray-500 dark:text-gray-400 mb-8">
      FIDE rating, national standings, and local OTB tournaments — all on your daily dashboard.
    </p>
    <div class="flex justify-center gap-3 mb-12">
      <a href="/tournaments" class="px-5 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700">
        Browse tournaments
      </a>
      <a href="/login" class="px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-800">
        Sign in
      </a>
    </div>

    {#if data.upcomingTournaments?.length > 0}
      <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 text-left">Upcoming tournaments</h2>
      <div class="grid gap-3 sm:grid-cols-3 text-left">
        {#each data.upcomingTournaments as t}
          <a href="/tournaments/{t.id}"
             class="rounded-xl border border-gray-200 dark:border-gray-700 p-4 hover:shadow-md transition-shadow block">
            <p class="font-medium text-sm text-gray-900 dark:text-gray-100 mb-1">{t.name}</p>
            <p class="text-xs text-gray-500">
              {t.start_date ? new Date(t.start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}
              {t.city ? ` · ${t.city}` : ''}
            </p>
          </a>
        {/each}
      </div>
      <a href="/tournaments" class="text-sm text-blue-600 dark:text-blue-400 hover:underline mt-4 inline-block">
        View all tournaments →
      </a>
    {/if}
  </div>
{:else}

  <!-- Header -->
  <div class="flex items-center justify-between mb-5">
    <div class="flex items-center gap-3">
      <a href="/cosmetics" class="w-14 h-14 bg-yellow-400 rounded-2xl flex items-center justify-center text-3xl shadow-lg hover:bg-yellow-300 transition" title="Customize">
        {avatarEmoji}
      </a>
      <div>
        <h1 class="text-xl font-bold">{profile?.display_name ?? 'Player'}</h1>
        <div class="flex items-center gap-2">
          <span class="text-yellow-400 font-bold text-sm">Lv {stats.level ?? 0}</span>
          <span class="text-slate-400 text-xs">· {stats.total_xp ?? 0} XP</span>
          <span class="text-orange-400 text-sm">🔥 {stats.streak_days ?? 0}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- XP Bar -->
  <div class="bg-slate-800 rounded-full h-2 mb-1 overflow-hidden">
    <div class="h-full bg-yellow-400 rounded-full transition-all"
         style="width: {Math.min(100, ((stats.xp_in_level ?? 0) / (stats.xp_to_next ?? 100)) * 100)}%">
    </div>
  </div>
  <p class="text-xs text-slate-400 mb-5">{stats.xp_in_level ?? 0} / {stats.xp_to_next ?? 100} XP to next level</p>

  <!-- SirKnight with coach note or default message -->
  <div class="mb-5">
    {#if unreadNote && !noteDismissed}
      <div class="relative">
        <SirKnight mood="surprise" message="Coach says: {unreadNote.message}" />
        <button onclick={dismissNote}
                class="absolute top-0 right-0 text-slate-400 hover:text-white text-xs px-2 py-1">
          ✕ Got it
        </button>
      </div>
    {:else}
      <SirKnight mood="idle" />
    {/if}
  </div>

  <!-- Daily Quests -->
  {#if quests.length > 0}
    <section class="bg-slate-800 rounded-2xl p-4 mb-4">
      <h2 class="font-bold text-base mb-3">📋 Today's Quests</h2>
      <ul class="space-y-2">
        {#each quests as quest}
          <li class="flex items-center gap-3">
            <div class="flex-1">
              <div class="flex justify-between text-sm mb-1">
                <span class="{quest.completed ? 'line-through text-slate-500' : 'text-white'}">{quest.description}</span>
                <span class="text-yellow-400 text-xs">+{quest.xp_reward} XP</span>
              </div>
              <div class="bg-slate-700 rounded-full h-1.5 overflow-hidden">
                <div class="h-full rounded-full transition-all {quest.completed ? 'bg-green-400' : 'bg-yellow-400'}"
                     style="width: {Math.min(100, (quest.progress / quest.target) * 100)}%">
                </div>
              </div>
              <p class="text-xs text-slate-400 mt-0.5">{quest.progress}/{quest.target}</p>
            </div>
            {#if quest.completed}
              <span class="text-green-400 text-xl">✅</span>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <!-- Main Training Buttons -->
  <div class="grid grid-cols-2 gap-3 mb-4">
    <a href="/learn"
       class="bg-yellow-400 text-slate-900 rounded-2xl p-5 hover:bg-yellow-300 transition text-center">
      <p class="text-3xl mb-1">🎯</p>
      <p class="font-bold">Daily Review</p>
      <p class="text-xs opacity-70">{stats.total_reviews ?? 0} cards done</p>
    </a>
    <a href="/practice"
       class="bg-slate-800 rounded-2xl p-5 hover:bg-slate-700 transition text-center">
      <p class="text-3xl mb-1">♟️</p>
      <p class="font-semibold">Practice</p>
      <p class="text-xs text-slate-400">Full board</p>
    </a>
  </div>

  <!-- Drill + Time Trial -->
  <div class="grid grid-cols-2 gap-3 mb-4">
    <a href="/drill"
       class="bg-amber-600 rounded-2xl p-4 hover:bg-amber-500 transition text-center">
      <p class="text-2xl mb-1">⚡</p>
      <p class="font-bold text-sm">Drill Mode</p>
      <p class="text-xs opacity-70">No mistakes!</p>
    </a>
    <a href="/time-trial"
       class="bg-blue-600 rounded-2xl p-4 hover:bg-blue-500 transition text-center">
      <p class="text-2xl mb-1">⏱️</p>
      <p class="font-bold text-sm">Time Trial</p>
      <p class="text-xs opacity-70">60 seconds</p>
    </a>
  </div>

  <!-- Repertoires + Cosmetics row -->
  <div class="grid grid-cols-2 gap-3 mb-5">
    <a href="/repertoires"
       class="bg-slate-800 rounded-2xl p-4 hover:bg-slate-700 transition text-center">
      <p class="text-2xl mb-1">📚</p>
      <p class="font-semibold text-sm">Repertoires</p>
    </a>
    <a href="/cosmetics"
       class="bg-purple-800 rounded-2xl p-4 hover:bg-purple-700 transition text-center">
      <p class="text-2xl mb-1">🎨</p>
      <p class="font-semibold text-sm">Customize</p>
    </a>
  </div>

  <!-- Badges + Settings row -->
  <div class="grid grid-cols-2 gap-3 mb-4">
    <a href="/badges"
       class="bg-yellow-900 rounded-2xl p-4 hover:bg-yellow-800 transition text-center">
      <p class="text-2xl mb-1">🏆</p>
      <p class="font-semibold text-sm">Trophies</p>
    </a>
    <a href="/settings"
       class="bg-slate-700 rounded-2xl p-4 hover:bg-slate-600 transition text-center">
      <p class="text-2xl mb-1">⚙️</p>
      <p class="font-semibold text-sm">Settings</p>
    </a>
  </div>

  <!-- Streak freeze display -->
  {#if profile?.streak_freeze > 0}
    <div class="bg-blue-900 rounded-xl p-3 mb-4 flex items-center gap-3">
      <p class="text-2xl">🧊</p>
      <div>
        <p class="font-semibold text-sm">Streak Freeze Active</p>
        <p class="text-xs text-blue-300">{profile.streak_freeze} use{profile.streak_freeze === 1 ? '' : 's'} remaining</p>
      </div>
    </div>
  {/if}

  <!-- Leaderboard -->
  {#if leaderboard.length > 0}
    <LeaderboardPodium entries={leaderboard} />
  {/if}

{/if}

</main>
