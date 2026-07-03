<script lang="ts">
  import PlayerHeader from '$lib/components/PlayerHeader.svelte';
  import StatsRow from '$lib/components/StatsRow.svelte';
  import QuickActions from '$lib/components/QuickActions.svelte';
  import CoachNoteBanner from '$lib/components/CoachNoteBanner.svelte';
  import TournamentCarousel from '$lib/components/tournaments/TournamentCarousel.svelte';
  import PlatformRatingsCard from '$lib/components/PlatformRatingsCard.svelte';
  import FideLookupCard from '$lib/components/FideLookupCard.svelte';

  let { data } = $props<{ data: any }>();

  const d = $derived(data as any);
  const stats = $derived(d.stats ?? {});
  const profile = $derived(d.profile as any);
  const quests = $derived(d.quests ?? []);

  let noteDismissed = $state(false);

  async function dismissNote() {
    if (!d.unreadNote) return;
    noteDismissed = true;
    await fetch('/api/notes/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteId: d.unreadNote.id })
    });
  }
</script>

<svelte:head>
  <title>MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
  <div class="max-w-3xl mx-auto px-4 py-6 space-y-4">

    {#if data.isGuest}
      <!-- Public content landing (no account needed) -->
      <div class="py-8 space-y-6">
        <div class="text-center">
          <h1 class="text-3xl font-bold text-gray-900 mb-2">Your chess, all in one place</h1>
          <p class="text-gray-500">FIDE ranks, local tournaments, and daily training — no account needed to explore.</p>
        </div>

        <FideLookupCard query={data.fideQuery ?? ''} result={data.fideLookup ?? null} />

        <a href="/drill" class="block bg-indigo-600 text-white rounded-xl p-5 hover:bg-indigo-700 transition-colors">
          <p class="font-semibold">Try a drill →</p>
          <p class="text-sm text-indigo-100">No account needed — sign in later to save your progress.</p>
        </a>

        {#if data.upcomingTournaments?.length > 0}
          <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div class="flex items-center justify-between mb-4">
              <h2 class="font-semibold text-gray-900">Upcoming in Lithuania</h2>
              <a href="/tournaments" class="text-sm text-indigo-600 hover:underline">View all →</a>
            </div>
            <TournamentCarousel tournaments={data.upcomingTournaments} />
          </section>
        {/if}
      </div>

    {:else}
      <!-- Authenticated dashboard -->

      <!-- Coach note banner -->
      {#if d.unreadNote && !noteDismissed}
        <CoachNoteBanner note={d.unreadNote} ondismiss={dismissNote} />
      {/if}

      <!-- Player identity + FIDE ratings -->
      <PlayerHeader {profile} fideRatings={d.fideRatings ?? null} />

      <!-- Platform ratings -->
      <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <PlatformRatingsCard platform="Lichess" username={d.lichessUsername ?? null} ratings={d.lichessRatings ?? null} />
          <PlatformRatingsCard platform="Chess.com" username={d.chesscomUsername ?? null} ratings={d.chesscomRatings ?? null} />
        </div>
      </section>

      <!-- Streak -->
      <StatsRow streakDays={stats.streak_days ?? 0} />

      <!-- Quick study actions -->
      <QuickActions totalReviews={stats.total_reviews ?? 0} />

      <!-- Today's tasks -->
      {#if quests.length > 0}
        <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 class="font-semibold text-gray-900 mb-4">Today's tasks</h2>
          <ul class="space-y-4">
            {#each quests as quest}
              <li class="flex items-center gap-3">
                <div class="flex-1">
                  <div class="flex justify-between text-sm mb-1.5">
                    <span class="{quest.completed ? 'line-through text-gray-400' : 'text-gray-700'}">
                      {quest.description}
                    </span>
                    <span class="text-gray-400 text-xs">{quest.progress}/{quest.target}</span>
                  </div>
                  <div class="bg-gray-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      class="h-full rounded-full transition-all {quest.completed ? 'bg-green-500' : 'bg-indigo-500'}"
                      style="width: {Math.min(100, (quest.progress / quest.target) * 100)}%"
                    ></div>
                  </div>
                </div>
                {#if quest.completed}
                  <span class="text-green-500 shrink-0" aria-label="Complete">✓</span>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <!-- Upcoming tournaments widget -->
      {#if data.upcomingTournaments?.length > 0}
        <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div class="flex items-center justify-between mb-4">
            <h2 class="font-semibold text-gray-900">Upcoming in Lithuania</h2>
            <a href="/tournaments" class="text-sm text-indigo-600 hover:underline">View all →</a>
          </div>
          <TournamentCarousel tournaments={data.upcomingTournaments} />
        </section>
      {/if}

    {/if}
  </div>
</main>
