<script lang="ts">
  import type { DbTournament } from '$lib/tournaments/types';

  const { tournament } = $props<{ tournament: DbTournament }>();

  const statusLabel: Record<string, string> = {
    NOT_STARTED: 'Upcoming',
    IN_PROGRESS: 'Live',
    FINISHED: 'Finished',
  };

  const statusClass: Record<string, string> = {
    NOT_STARTED: 'bg-blue-100 text-blue-800',
    IN_PROGRESS: 'bg-green-100 text-green-800',
    FINISHED: 'bg-gray-100 text-gray-600',
  };

  const tcLabel: Record<string, string> = {
    STANDARD: 'Classical',
    RAPID: 'Rapid',
    BLITZ: 'Blitz',
    UNKNOWN: '',
  };

  function formatDate(iso: string | null) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  const dateRange = $derived(tournament.end_date && tournament.end_date !== tournament.start_date
    ? `${formatDate(tournament.start_date)} – ${formatDate(tournament.end_date)}`
    : formatDate(tournament.start_date));
</script>

<a
  href={tournament.url}
  target="_blank"
  rel="noopener noreferrer"
  class="flex flex-col h-full rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md hover:border-gray-300 transition-all"
>
  <!-- Header: title + status badge -->
  <div class="flex items-start justify-between gap-2 mb-2">
    <h3 class="font-semibold text-gray-900 text-sm leading-snug line-clamp-2">{tournament.name}</h3>
    <span class="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full {statusClass[tournament.status] ?? statusClass.FINISHED}">
      {statusLabel[tournament.status] ?? tournament.status}
    </span>
  </div>

  <!-- Body: dates + location -->
  <div class="text-xs text-gray-500 space-y-0.5 flex-1">
    <div class="font-medium text-gray-700">{dateRange}</div>
    <div>
      {#if tournament.city}
        {tournament.city}, {tournament.country}
      {:else}
        {tournament.country}
      {/if}
    </div>

    <!-- Chips row -->
    <div class="flex flex-wrap gap-x-3 gap-y-1 mt-2">
      {#if tournament.time_control !== 'UNKNOWN'}
        <span class="inline-flex items-center gap-1 text-gray-600">
          <span class="w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block"></span>
          {tcLabel[tournament.time_control] ?? tournament.time_control}
        </span>
      {/if}
      {#if tournament.player_count}
        <span class="text-gray-500">{tournament.player_count} players</span>
      {/if}
      {#if tournament.average_rating}
        <span class="text-gray-500">Avg {tournament.average_rating}</span>
      {/if}
    </div>
  </div>

  <!-- Footer: external link anchored to bottom -->
  <div class="mt-3 pt-2 border-t border-gray-100 text-xs text-indigo-600 hover:text-indigo-800">
    chess-results.com ↗
  </div>
</a>
