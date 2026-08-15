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
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built, stringified, and discarded synchronously within this function; never read reactively
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

<div class="bg-(--color-surface) border border-(--color-border) rounded-xl p-4 space-y-5">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <span class="text-sm font-semibold text-(--color-text)">Filters</span>
    <span class="text-xs text-(--color-muted)">{total} result{total !== 1 ? 's' : ''}</span>
  </div>

  {#if activeCount > 0}
    <button on:click={clearAll} class="w-full text-xs text-center text-(--color-accent) hover:text-indigo-800 border border-indigo-200 rounded-lg py-1.5 transition-colors hover:bg-indigo-50">
      Clear all filters
    </button>
  {/if}

  <!-- Status -->
  <div>
    <p class="text-xs font-semibold uppercase tracking-wider text-(--color-muted) mb-2">Status</p>
    <div class="flex flex-wrap gap-1.5">
      {#each statusOptions as opt (opt.value)}
        <button
          on:click={() => toggleStatus(opt.value)}
          class="px-2.5 py-1 rounded-lg text-xs border transition-colors
            {filters.status.includes(opt.value as never)
              ? 'bg-(--color-accent) text-white border-(--color-accent)'
              : 'border-(--color-border) text-(--color-muted) hover:border-indigo-300 hover:text-(--color-accent-hover)'}"
        >{opt.label}</button>
      {/each}
    </div>
  </div>

  <div class="border-t border-gray-100"></div>

  <!-- Time control -->
  <div>
    <p class="text-xs font-semibold uppercase tracking-wider text-(--color-muted) mb-2">Time Control</p>
    <div class="flex flex-wrap gap-1.5">
      {#each tcOptions as opt (opt.value)}
        <button
          on:click={() => toggleTc(opt.value)}
          class="px-2.5 py-1 rounded-lg text-xs border transition-colors
            {filters.timeControl.includes(opt.value as never)
              ? 'bg-(--color-accent) text-white border-(--color-accent)'
              : 'border-(--color-border) text-(--color-muted) hover:border-indigo-300 hover:text-(--color-accent-hover)'}"
        >{opt.label}</button>
      {/each}
    </div>
  </div>

  <div class="border-t border-gray-100"></div>

  <!-- Country -->
  <div>
    <p class="text-xs font-semibold uppercase tracking-wider text-(--color-muted) mb-2">Country</p>
    <div class="flex flex-wrap gap-1.5">
      {#each countryOptions as country (country)}
        <button
          on:click={() => toggleCountry(country)}
          class="px-2.5 py-1 rounded-lg text-xs border transition-colors
            {filters.country.includes(country)
              ? 'bg-(--color-accent) text-white border-(--color-accent)'
              : 'border-(--color-border) text-(--color-muted) hover:border-indigo-300 hover:text-(--color-accent-hover)'}"
        >{country}</button>
      {/each}
    </div>
  </div>

  <div class="border-t border-gray-100"></div>

  <!-- Date range -->
  <div>
    <p class="text-xs font-semibold uppercase tracking-wider text-(--color-muted) mb-2">Date Range</p>
    <div class="space-y-1.5">
      <input
        type="date"
        bind:value={filters.dateStart}
        on:change={applyFilters}
        placeholder="From"
        class="w-full text-xs border border-(--color-border) rounded-lg px-2.5 py-1.5 bg-(--color-surface) text-(--color-text) focus:border-indigo-400 focus:outline-none"
      />
      <input
        type="date"
        bind:value={filters.dateEnd}
        on:change={applyFilters}
        placeholder="To"
        class="w-full text-xs border border-(--color-border) rounded-lg px-2.5 py-1.5 bg-(--color-surface) text-(--color-text) focus:border-indigo-400 focus:outline-none"
      />
    </div>
  </div>
</div>
