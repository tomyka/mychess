<script lang="ts">
  import type { PageData } from './$types';
  import type { DbTournament } from '$lib/tournaments/types';
  import TournamentCard from '$lib/components/tournaments/TournamentCard.svelte';
  import TournamentFilters from '$lib/components/tournaments/TournamentFilters.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';

  const { data } = $props<{ data: PageData }>();

  const SUPPORTED_COUNTRIES = ['Lithuania', 'Latvia'];

  // Auto-detect country from GPS on first visit (no country param in URL)
  $effect(() => {
    if ($page.url.searchParams.has('country')) return;
    if (typeof window === 'undefined' || !navigator.geolocation) return;

    const cached = sessionStorage.getItem('geo_country');
    if (cached) {
      if (SUPPORTED_COUNTRIES.includes(cached)) {
        goto(`?country=${encodeURIComponent(cached)}`, { replaceState: true });
      }
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
            { headers: { 'Accept-Language': 'en' } }
          );
          const json = await res.json();
          const country: string = json?.address?.country ?? '';
          const matched = SUPPORTED_COUNTRIES.find(c => c === country) ?? null;
          sessionStorage.setItem('geo_country', matched ?? 'all');
          if (matched) goto(`?country=${encodeURIComponent(matched)}`, { replaceState: true });
        } catch {
          sessionStorage.setItem('geo_country', 'all');
        }
      },
      () => { sessionStorage.setItem('geo_country', 'all'); },
      { timeout: 6000, maximumAge: 60_000 }
    );
  });

  function setView(mode: 'list' | 'calendar') {
    const sp = new URLSearchParams($page.url.searchParams);
    if (mode === 'calendar') sp.set('view', 'calendar');
    else sp.delete('view');
    sp.set('page', '1');
    goto(`?${sp.toString()}`, { keepFocus: true });
  }

  function buildPageUrl(targetPage: number): string {
    const sp = new URLSearchParams();
    if (data.filters.status.length < 3)           sp.set('status', data.filters.status.join(','));
    if (data.filters.timeControl.some((tc: string) => tc !== 'UNKNOWN' && data.filters.timeControl.length < 4))
      sp.set('timeControl', data.filters.timeControl.join(','));
    if (data.filters.country.length < 2)          sp.set('country', data.filters.country.join(','));
    if (data.filters.dateStart)                   sp.set('dateStart', data.filters.dateStart);
    if (data.filters.dateEnd)                     sp.set('dateEnd', data.filters.dateEnd);
    sp.set('page', String(targetPage));
    return `?${sp.toString()}`;
  }

  const byMonth = $derived(
    data.tournaments
      .filter((t: DbTournament) => t.start_date)
      .reduce((acc: Record<string, DbTournament[]>, t: DbTournament) => {
        const key = t.start_date!.slice(0, 7);
        if (!acc[key]) acc[key] = [];
        acc[key].push(t);
        return acc;
      }, {} as Record<string, DbTournament[]>)
  );
  const byMonthEntries = $derived(Object.entries(byMonth) as Array<[string, DbTournament[]]>);

  const totalPages = $derived(Math.ceil(data.total / data.filters.pageSize));
</script>

<svelte:head>
  <title>OTB Tournaments — mychess</title>
</svelte:head>

<div class="max-w-6xl mx-auto px-4 py-6">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-bold text-gray-900">Tournaments</h1>
    <div class="flex gap-1 text-sm">
      <button
        on:click={() => setView('list')}
        class="px-3 py-1.5 rounded {!data.isCalendar ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'}"
      >List</button>
      <button
        on:click={() => setView('calendar')}
         class="px-3 py-1.5 rounded {data.isCalendar ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'}"
      >Calendar</button>
    </div>
  </div>

  {#if data.isStale}
    <div class="mb-4 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
      ⚠️ Data may be outdated. Last updated: {data.lastScrapedAt ? new Date(data.lastScrapedAt).toLocaleString() : 'unknown'}
    </div>
  {/if}

  {#if data.error}
    <div class="mb-4 px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
      Error loading tournaments: {data.error}
    </div>
  {/if}

  <div class="flex flex-col md:flex-row gap-6">
    <!-- Sidebar filters — sticky so filters stay visible while scrolling -->
    <aside class="md:w-60 shrink-0">
      <div class="sticky top-[57px]">
        <TournamentFilters filters={data.filters} total={data.total} />
      </div>
    </aside>

    <!-- Tournament list/calendar -->
    <main class="flex-1 min-w-0">
      {#if !data.isCalendar}
        {#if data.tournaments.length === 0}
          <div class="text-center py-16 text-gray-400">
            <p class="text-4xl mb-3">♟</p>
            <p class="font-medium">No tournaments found</p>
            <p class="text-sm mt-1">Try adjusting your filters</p>
          </div>
        {:else}
          <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {#each data.tournaments as tournament (tournament.id)}
              <TournamentCard {tournament} />
            {/each}
          </div>

          <!-- Pagination -->
          {#if totalPages > 1}
            <div class="flex justify-center gap-2 mt-8">
              {#if data.filters.page > 1}
                <a href={buildPageUrl(data.filters.page - 1)}
                   class="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
                >← Previous</a>
              {/if}
              <span class="px-4 py-2 text-sm text-gray-500">
                Page {data.filters.page} of {totalPages}
              </span>
              {#if data.filters.page < totalPages}
                <a href={buildPageUrl(data.filters.page + 1)}
                   class="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
                >Next →</a>
              {/if}
            </div>
          {/if}
        {/if}
      {:else}
        <!-- Calendar view — grouped by month, server fetches up to 500 (no pagination) -->
        <div class="space-y-6">
          {#each byMonthEntries as [month, monthTourneys]}
            <div>
              <h2 class="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">
                {new Date(month + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
              </h2>
              <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {#each monthTourneys as tournament (tournament.id)}
                  <TournamentCard {tournament} />
                {/each}
              </div>
            </div>
          {/each}
          {#if byMonthEntries.length === 0}
            <div class="text-center py-16 text-gray-400">
              <p>No tournaments with dates in this range</p>
            </div>
          {/if}
        </div>
      {/if}
    </main>
  </div>
</div>
