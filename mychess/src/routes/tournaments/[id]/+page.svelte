<script lang="ts">
  import type { PageData } from './$types';
  import { m } from '$lib/paraglide/messages';

  const { data } = $props<{ data: PageData }>();

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

  function formatDate(iso: string | null) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  const dateRange = $derived(data.tournament.end_date && data.tournament.end_date !== data.tournament.start_date
    ? `${formatDate(data.tournament.start_date)} – ${formatDate(data.tournament.end_date)}`
    : formatDate(data.tournament.start_date));
</script>

<svelte:head>
  <title>{data.tournament.name}</title>
</svelte:head>

<div class="max-w-4xl mx-auto px-4 py-6">
  <a href="/tournaments" class="text-sm text-(--color-accent) hover:text-indigo-800 dark:hover:text-indigo-300">
    {m.tournament_detail_back()}
  </a>

  <div class="mt-4 flex items-start justify-between gap-3">
    <h1 class="text-2xl font-bold text-(--color-text)">{data.tournament.name}</h1>
    <span class="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full {statusClass[data.tournament.status] ?? statusClass.FINISHED}">
      {statusLabel[data.tournament.status] ?? data.tournament.status}
    </span>
  </div>

  <div class="mt-2 text-sm text-(--color-muted) space-y-0.5">
    <div class="font-medium text-(--color-text)">{dateRange}</div>
    <div>
      {#if data.tournament.city}
        {data.tournament.city}, {data.tournament.country}
      {:else}
        {data.tournament.country}
      {/if}
    </div>
    {#if data.tournament.chief_arbiter}
      <div>{data.tournament.chief_arbiter}</div>
    {/if}
  </div>

  <a
    href={data.tournament.url}
    target="_blank"
    rel="noopener noreferrer"
    class="inline-block mt-3 text-sm text-(--color-accent) hover:text-indigo-800 dark:hover:text-indigo-300"
  >
    {m.tournament_detail_external_link()}
  </a>

  <h2 class="mt-8 mb-3 text-sm font-semibold text-(--color-muted) uppercase tracking-wider">
    {m.tournament_detail_players_heading()}
  </h2>

  {#if data.players.length === 0}
    <div class="text-center py-12 text-(--color-muted)">
      <p>{m.tournament_detail_no_players()}</p>
    </div>
  {:else}
    <div class="overflow-x-auto rounded-xl border border-(--color-border)">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-(--color-border) text-left text-xs text-(--color-muted) uppercase tracking-wider">
            <th class="px-3 py-2">{m.tournament_detail_th_rank()}</th>
            <th class="px-3 py-2">{m.tournament_detail_th_name()}</th>
            <th class="px-3 py-2">{m.tournament_detail_th_federation()}</th>
            <th class="px-3 py-2">{m.tournament_detail_th_title()}</th>
            <th class="px-3 py-2">{m.tournament_detail_th_rating()}</th>
            <th class="px-3 py-2">{m.tournament_detail_th_points()}</th>
          </tr>
        </thead>
        <tbody>
          {#each data.players as player (player.id)}
            <tr class="border-b border-(--color-border) last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800">
              <td class="px-3 py-2 text-(--color-muted)">{player.rank ?? '—'}</td>
              <td class="px-3 py-2 font-medium text-(--color-text)">{player.name}</td>
              <td class="px-3 py-2 text-(--color-muted)">{player.federation ?? '—'}</td>
              <td class="px-3 py-2 text-(--color-muted)">{player.title ?? '—'}</td>
              <td class="px-3 py-2 text-(--color-muted)">{player.rating ?? '—'}</td>
              <td class="px-3 py-2 text-(--color-muted)">{player.points ?? '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
