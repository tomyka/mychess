<script lang="ts">
  import type { DbTournament } from '$lib/tournaments/types';
  import { m } from '$lib/paraglide/messages';

  const { tournament } = $props<{ tournament: DbTournament }>();

  const statusLabel: Record<string, string> = {
    NOT_STARTED: m.tournaments_status_upcoming(),
    IN_PROGRESS: m.tournaments_status_live(),
    FINISHED: m.tournaments_status_finished(),
  };

  const statusClass: Record<string, string> = {
    NOT_STARTED: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-400',
    IN_PROGRESS: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-400',
    FINISHED: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  };

  const tcLabel: Record<string, string> = {
    STANDARD: m.tournaments_tc_classical(),
    RAPID: m.tournaments_tc_rapid(),
    BLITZ: m.tournaments_tc_blitz(),
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
  class="flex flex-col h-full rounded-xl border border-(--color-border) bg-(--color-surface) p-4 hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600 transition-all"
>
  <!-- Header: title + status badge -->
  <div class="flex items-start justify-between gap-2 mb-2">
    <h3 class="font-semibold text-(--color-text) text-sm leading-snug line-clamp-2">{tournament.name}</h3>
    <span class="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full {statusClass[tournament.status] ?? statusClass.FINISHED}">
      {statusLabel[tournament.status] ?? tournament.status}
    </span>
  </div>

  <!-- Body: dates + location -->
  <div class="text-xs text-(--color-muted) space-y-0.5 flex-1">
    <div class="font-medium text-(--color-text)">{dateRange}</div>
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
        <span class="inline-flex items-center gap-1 text-(--color-muted)">
          <span class="w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block"></span>
          {tcLabel[tournament.time_control] ?? tournament.time_control}
        </span>
      {/if}
      {#if tournament.player_count}
        <span class="text-(--color-muted)">{m.tournament_card_player_count({ count: tournament.player_count })}</span>
      {/if}
      {#if tournament.average_rating}
        <span class="text-(--color-muted)">{m.tournaments_avg_rating({ rating: tournament.average_rating })}</span>
      {/if}
    </div>
  </div>

  <!-- Footer: external link anchored to bottom -->
  <div class="mt-3 pt-2 border-t border-gray-100 text-xs text-(--color-accent) hover:text-indigo-800 dark:hover:text-indigo-300">
    chess-results.com ↗
  </div>
</a>
