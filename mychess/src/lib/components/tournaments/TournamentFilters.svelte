<script lang="ts">
  import type { TournamentFilters } from '$lib/tournaments/types';
  import type { TournamentStatus, TimeControl } from '$lib/tournaments/scraper-utils';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';

  let { filters: filtersProp, total } = $props<{ filters: TournamentFilters; total: number }>();
  let filters = $state<TournamentFilters>(filtersProp);

  const statusOptions = [
    { value: 'NOT_STARTED', label: 'Upcoming' },
    { value: 'IN_PROGRESS', label: 'Live' },
    { value: 'FINISHED', label: 'Finished' },
  ];
  const tcOptions = [
    { value: 'STANDARD', label: 'Classical' },
    { value: 'RAPID', label: 'Rapid' },
    { value: 'BLITZ', label: 'Blitz' },
  ];
  const countryOptions = ['Lithuania', 'Latvia'];

  function applyFilters() {
    const sp = new URLSearchParams($page.url.searchParams);
    sp.set('status', filters.status.join(','));
    sp.set('timeControl', filters.timeControl.filter((tc: TimeControl) => tc !== 'UNKNOWN').join(','));
    sp.set('country', filters.country.join(','));
    if (filters.dateStart) sp.set('dateStart', filters.dateStart);
    else sp.delete('dateStart');
    if (filters.dateEnd) sp.set('dateEnd', filters.dateEnd);
    else sp.delete('dateEnd');
    sp.set('page', '1');
    goto(`?${sp.toString()}`, { keepFocus: true });
  }

  function toggleStatus(val: string) {
    if (filters.status.includes(val as never)) {
      filters = { ...filters, status: filters.status.filter((s: TournamentStatus) => s !== val) };
    } else {
      filters = { ...filters, status: [...filters.status, val as TournamentStatus] };
    }
    applyFilters();
  }

  function toggleTc(val: string) {
    if (filters.timeControl.includes(val as never)) {
      filters = { ...filters, timeControl: filters.timeControl.filter((t: TimeControl) => t !== val) };
    } else {
      filters = { ...filters, timeControl: [...filters.timeControl, val as TimeControl] };
    }
    applyFilters();
  }

  function toggleCountry(val: string) {
    if (filters.country.includes(val)) {
      filters = { ...filters, country: filters.country.filter((c: string) => c !== val) };
    } else {
      filters = { ...filters, country: [...filters.country, val] };
    }
    applyFilters();
  }

  function clearAll() {
    goto('/tournaments', { keepFocus: true });
  }

  const activeCount = $derived(
    (filters.status.length < 3 ? 1 : 0) +
    (filters.timeControl.filter((t: TimeControl) => t !== 'UNKNOWN').length < 3 ? 1 : 0) +
    (filters.country.length < 2 ? 1 : 0) +
    (filters.dateStart || filters.dateEnd ? 1 : 0));
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <p class="text-sm text-gray-500 dark:text-gray-400">{total} tournament{total !== 1 ? 's' : ''}</p>
    {#if activeCount > 0}
      <button on:click={clearAll} class="text-xs text-blue-600 dark:text-blue-400 hover:underline">
        Clear filters
      </button>
    {/if}
  </div>

  <!-- Status -->
  <div>
    <p class="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Status</p>
    <div class="flex flex-wrap gap-2">
      {#each statusOptions as opt}
        <button
          on:click={() => toggleStatus(opt.value)}
          class="px-3 py-1 rounded-full text-xs border transition-colors
            {filters.status.includes(opt.value as never)
              ? 'bg-blue-600 text-white border-blue-600'
              : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-400'}"
        >{opt.label}</button>
      {/each}
    </div>
  </div>

  <!-- Time control -->
  <div>
    <p class="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Time Control</p>
    <div class="flex flex-wrap gap-2">
      {#each tcOptions as opt}
        <button
          on:click={() => toggleTc(opt.value)}
          class="px-3 py-1 rounded-full text-xs border transition-colors
            {filters.timeControl.includes(opt.value as never)
              ? 'bg-blue-600 text-white border-blue-600'
              : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-400'}"
        >{opt.label}</button>
      {/each}
    </div>
  </div>

  <!-- Country -->
  <div>
    <p class="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Country</p>
    <div class="flex flex-wrap gap-2">
      {#each countryOptions as country}
        <button
          on:click={() => toggleCountry(country)}
          class="px-3 py-1 rounded-full text-xs border transition-colors
            {filters.country.includes(country)
              ? 'bg-blue-600 text-white border-blue-600'
              : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-400'}"
        >{country}</button>
      {/each}
    </div>
  </div>

  <!-- Date range -->
  <div>
    <p class="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Date Range</p>
    <div class="flex gap-2 items-center">
      <input
        type="date"
        bind:value={filters.dateStart}
        on:change={applyFilters}
        class="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
      />
      <span class="text-gray-400 text-xs">to</span>
      <input
        type="date"
        bind:value={filters.dateEnd}
        on:change={applyFilters}
        class="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
      />
    </div>
  </div>
</div>
