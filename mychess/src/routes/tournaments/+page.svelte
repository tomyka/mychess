<script lang="ts">
  import type { PageData } from './$types';
  import TournamentCard from '$lib/components/tournaments/TournamentCard.svelte';
  import TournamentFilters from '$lib/components/tournaments/TournamentFilters.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';

  export let data: PageData;

  $: ({ tournaments, total, filters, isCalendar, lastScrapedAt, isStale, error } = data);

  function setView(mode: 'list' | 'calendar') {
    const sp = new URLSearchParams($page.url.searchParams);
    if (mode === 'calendar') sp.set('view', 'calendar');
    else sp.delete('view');
    sp.set('page', '1');
    goto(`?${sp.toString()}`, { keepFocus: true });
  }

  function buildPageUrl(targetPage: number): string {
    const sp = new URLSearchParams();
    if (filters.status.length < 3)           sp.set('status', filters.status.join(','));
    if (filters.timeControl.some(tc => tc !== 'UNKNOWN' && filters.timeControl.length < 4))
      sp.set('timeControl', filters.timeControl.join(','));
    if (filters.country.length < 2)          sp.set('country', filters.country.join(','));
    if (filters.dateStart)                   sp.set('dateStart', filters.dateStart);
    if (filters.dateEnd)                     sp.set('dateEnd', filters.dateEnd);
    sp.set('page', String(targetPage));
    return `?${sp.toString()}`;
  }

  // Group tournaments by month — ES-compatible reduce, no Object.groupBy
  $: byMonth = tournaments
    .filter(t => t.start_date)
    .reduce<Record<string, typeof tournaments>>((acc, t) => {
      const key = t.start_date!.slice(0, 7);
      if (!acc[key]) acc[key] = [];
      acc[key].push(t);
      return acc;
    }, {});

  $: totalPages = Math.ceil(total / filters.pageSize);
</script>

<svelte:head>
  <title>OTB Tournaments — mychess</title>
</svelte:head>

<div class="max-w-6xl mx-auto px-4 py-6">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">Tournaments</h1>
    <div class="flex gap-1 text-sm">
      <button
        on:click={() => setView('list')}
        class="px-3 py-1.5 rounded {!isCalendar ? 'bg-blue-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}"
      >List</button>
      <button
        on:click={() => setView('calendar')}
        class="px-3 py-1.5 rounded {isCalendar ? 'bg-blue-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}"
      >Calendar</button>
    </div>
  </div>

  {#if isStale}
    <div class="mb-4 px-4 py-2 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg text-sm text-amber-700 dark:text-amber-300">
      ⚠️ Data may be outdated. Last updated: {lastScrapedAt ? new Date(lastScrapedAt).toLocaleString() : 'unknown'}
    </div>
  {/if}

  {#if error}
    <div class="mb-4 px-4 py-2 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg text-sm text-red-700 dark:text-red-300">
      Error loading tournaments: {error}
    </div>
  {/if}

  <div class="flex flex-col md:flex-row gap-6">
    <!-- Sidebar filters -->
    <aside class="md:w-56 shrink-0">
      <TournamentFilters {filters} {total} />
    </aside>

    <!-- Tournament list/calendar -->
    <main class="flex-1 min-w-0">
      {#if !isCalendar}
        {#if tournaments.length === 0}
          <div class="text-center py-16 text-gray-400 dark:text-gray-500">
            <p class="text-4xl mb-3">♟</p>
            <p class="font-medium">No tournaments found</p>
            <p class="text-sm mt-1">Try adjusting your filters</p>
          </div>
        {:else}
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {#each tournaments as tournament (tournament.id)}
              <TournamentCard {tournament} />
            {/each}
          </div>

          <!-- Pagination -->
          {#if totalPages > 1}
            <div class="flex justify-center gap-2 mt-8">
              {#if filters.page > 1}
                <a href={buildPageUrl(filters.page - 1)}
                   class="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
                >← Previous</a>
              {/if}
              <span class="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
                Page {filters.page} of {totalPages}
              </span>
              {#if filters.page < totalPages}
                <a href={buildPageUrl(filters.page + 1)}
                   class="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
                >Next →</a>
              {/if}
            </div>
          {/if}
        {/if}
      {:else}
        <!-- Calendar view — grouped by month, server fetches up to 500 (no pagination) -->
        <div class="space-y-6">
          {#each Object.entries(byMonth) as [month, monthTourneys]}
            <div>
              <h2 class="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                {new Date(month + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
              </h2>
              <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {#each monthTourneys as tournament (tournament.id)}
                  <TournamentCard {tournament} />
                {/each}
              </div>
            </div>
          {/each}
          {#if Object.keys(byMonth).length === 0}
            <div class="text-center py-16 text-gray-400 dark:text-gray-500">
              <p>No tournaments with dates in this range</p>
            </div>
          {/if}
        </div>
      {/if}
    </main>
  </div>
</div>
