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
  href="/tournaments/{tournament.id}"
  class="block rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md transition-shadow"
>
  <div class="flex items-start justify-between gap-2 mb-2">
    <h3 class="font-semibold text-gray-900 text-sm leading-snug">{tournament.name}</h3>
    <span class="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full {statusClass[tournament.status] ?? statusClass.FINISHED}">
      {statusLabel[tournament.status] ?? tournament.status}
    </span>
  </div>

  <div class="text-xs text-gray-500 space-y-0.5">
    <div>{dateRange}</div>
    {#if tournament.city}
      <div>{tournament.city}, {tournament.country}</div>
    {:else}
      <div>{tournament.country}</div>
    {/if}
    <div class="flex gap-3 mt-1.5">
      {#if tournament.time_control !== 'UNKNOWN'}
        <span class="font-medium text-gray-700">{tcLabel[tournament.time_control] ?? tournament.time_control}</span>
      {/if}
      {#if tournament.player_count}
        <span>{tournament.player_count} players</span>
      {/if}
      {#if tournament.average_rating}
        <span>Avg {tournament.average_rating}</span>
      {/if}
    </div>
  </div>

  <div class="mt-2 text-xs text-indigo-600 truncate hover:underline">
    chess-results.com ↗
  </div>
</a>
