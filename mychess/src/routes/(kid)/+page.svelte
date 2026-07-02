<script lang="ts">
  import PlayerHeader from '$lib/components/PlayerHeader.svelte';
  import StatsRow from '$lib/components/StatsRow.svelte';
  import QuickActions from '$lib/components/QuickActions.svelte';
  import CoachNoteBanner from '$lib/components/CoachNoteBanner.svelte';
  import TournamentCarousel from '$lib/components/tournaments/TournamentCarousel.svelte';
  import LichessStatsCard from '$lib/components/LichessStatsCard.svelte';

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
      <!-- Guest landing -->
      <div class="py-12 text-center">
        <h1 class="text-3xl font-bold text-gray-900 mb-3">Your chess, all in one place</h1>
        <p class="text-gray-500 mb-8">
          FIDE rating, national standings, and local OTB tournaments — your daily dashboard.
        </p>
        <div class="flex justify-center gap-3 mb-12">
          <a href="/tournaments"
             class="px-5 py-2.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors">
            Browse tournaments
          </a>
          <a href="/login"
             class="px-5 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors">
            Sign in
          </a>
        </div>

        {#if data.upcomingTournaments?.length > 0}
          <h2 class="text-lg font-semibold text-gray-900 mb-3 text-left">Upcoming tournaments in Lithuania</h2>
          <TournamentCarousel tournaments={data.upcomingTournaments} />
          <a href="/tournaments" class="text-sm text-indigo-600 hover:underline mt-3 inline-block">
            View all tournaments →
          </a>
        {/if}
      </div>

    {:else}
      <!-- Authenticated dashboard -->

      <!-- Coach note banner -->
      {#if d.unreadNote && !noteDismissed}
        <CoachNoteBanner note={d.unreadNote} ondismiss={dismissNote} />
      {/if}

      <!-- Player identity + FIDE rating, with a compact Lichess rating badge alongside -->
      <div class="flex items-stretch gap-3">
        <div class="flex-1">
          <PlayerHeader {profile} />
        </div>
        <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-center justify-center shrink-0">
          <LichessStatsCard username={d.lichessUsername ?? null} ratings={d.lichessRatings ?? null} compact />
        </div>
      </div>

      <!-- Country/age/streak stats -->
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
