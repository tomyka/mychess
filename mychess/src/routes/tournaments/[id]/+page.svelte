<script lang="ts">
  import type { PageData } from './$types';

  const { tournament, players } = $props() as PageData;

  function formatDate(iso: string | null) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  const dateRange = $derived(tournament.end_date && tournament.end_date !== tournament.start_date
    ? `${formatDate(tournament.start_date)} – ${formatDate(tournament.end_date)}`
    : formatDate(tournament.start_date));

  const tcLabel: Record<string, string> = {
    STANDARD: 'Classical', RAPID: 'Rapid', BLITZ: 'Blitz', UNKNOWN: '',
  };
  const statusLabel: Record<string, string> = {
    NOT_STARTED: 'Upcoming', IN_PROGRESS: 'Live', FINISHED: 'Finished',
  };
</script>

<svelte:head>
  <title>{tournament.name} — mychess</title>
</svelte:head>

<div class="max-w-4xl mx-auto px-4 py-6">
  <a href="/tournaments" class="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-4 inline-block">
    ← All tournaments
  </a>

  <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">{tournament.name}</h1>

  <div class="flex flex-wrap gap-2 mb-6">
    <span class="text-sm px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 font-medium">
      {statusLabel[tournament.status] ?? tournament.status}
    </span>
    {#if tournament.time_control !== 'UNKNOWN'}
      <span class="text-sm px-2.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
        {tcLabel[tournament.time_control]}
      </span>
    {/if}
  </div>

  <dl class="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8 text-sm">
    <div>
      <dt class="text-gray-400 text-xs uppercase tracking-wide">Dates</dt>
      <dd class="text-gray-900 dark:text-gray-100 font-medium mt-0.5">{dateRange}</dd>
    </div>
    <div>
      <dt class="text-gray-400 text-xs uppercase tracking-wide">Location</dt>
      <dd class="text-gray-900 dark:text-gray-100 font-medium mt-0.5">
        {tournament.city ? `${tournament.city}, ` : ''}{tournament.country}
      </dd>
    </div>
    {#if tournament.player_count}
      <div>
        <dt class="text-gray-400 text-xs uppercase tracking-wide">Players</dt>
        <dd class="text-gray-900 dark:text-gray-100 font-medium mt-0.5">{tournament.player_count}</dd>
      </div>
    {/if}
    {#if tournament.average_rating}
      <div>
        <dt class="text-gray-400 text-xs uppercase tracking-wide">Avg Rating</dt>
        <dd class="text-gray-900 dark:text-gray-100 font-medium mt-0.5">{tournament.average_rating}</dd>
      </div>
    {/if}
    {#if tournament.round_count}
      <div>
        <dt class="text-gray-400 text-xs uppercase tracking-wide">Rounds</dt>
        <dd class="text-gray-900 dark:text-gray-100 font-medium mt-0.5">{tournament.round_count}</dd>
      </div>
    {/if}
    {#if tournament.chief_arbiter}
      <div>
        <dt class="text-gray-400 text-xs uppercase tracking-wide">Chief Arbiter</dt>
        <dd class="text-gray-900 dark:text-gray-100 font-medium mt-0.5">{tournament.chief_arbiter}</dd>
      </div>
    {/if}
    {#if tournament.organizer}
      <div>
        <dt class="text-gray-400 text-xs uppercase tracking-wide">Organizer</dt>
        <dd class="text-gray-900 dark:text-gray-100 font-medium mt-0.5">{tournament.organizer}</dd>
      </div>
    {/if}
  </dl>

  <div class="mb-4 flex items-center justify-between">
    <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Players</h2>
    {#if tournament.url}
      <a href={tournament.url} target="_blank" rel="noopener noreferrer"
         class="text-xs text-blue-600 dark:text-blue-400 hover:underline">
        View on chess-results.com ↗
      </a>
    {/if}
  </div>

  {#if players.length === 0}
    <p class="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">
      Player list not yet available
    </p>
  {:else}
    <div class="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <th class="px-3 py-2 text-left text-xs text-gray-500 dark:text-gray-400 font-medium w-10">#</th>
            <th class="px-3 py-2 text-left text-xs text-gray-500 dark:text-gray-400 font-medium">Name</th>
            <th class="px-3 py-2 text-left text-xs text-gray-500 dark:text-gray-400 font-medium">Title</th>
            <th class="px-3 py-2 text-left text-xs text-gray-500 dark:text-gray-400 font-medium">Fed</th>
            <th class="px-3 py-2 text-right text-xs text-gray-500 dark:text-gray-400 font-medium">Rating</th>
            <th class="px-3 py-2 text-right text-xs text-gray-500 dark:text-gray-400 font-medium">Pts</th>
          </tr>
        </thead>
        <tbody>
          {#each players as player, i}
            <tr class="border-b border-gray-100 dark:border-gray-800 {i % 2 === 0 ? '' : 'bg-gray-50/50 dark:bg-gray-800/30'}">
              <td class="px-3 py-2 text-gray-400 dark:text-gray-500">{player.rank ?? i + 1}</td>
              <td class="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">
                {#if player.fide_id}
                  <a href="https://ratings.fide.com/profile/{player.fide_id}" target="_blank" rel="noopener noreferrer"
                     class="hover:underline text-blue-700 dark:text-blue-300">{player.name}</a>
                {:else}
                  {player.name}
                {/if}
              </td>
              <td class="px-3 py-2 text-gray-500 dark:text-gray-400">{player.title ?? ''}</td>
              <td class="px-3 py-2 text-gray-500 dark:text-gray-400">{player.federation ?? ''}</td>
              <td class="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{player.rating ?? '—'}</td>
              <td class="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{player.points ?? '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
