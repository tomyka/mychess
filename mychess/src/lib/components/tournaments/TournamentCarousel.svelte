<script lang="ts">
  const { tournaments } = $props<{ tournaments: any[] }>();

  const PAGE_SIZE = 5;

  const statusLabel: Record<string, string> = {
    NOT_STARTED: 'Upcoming',
    IN_PROGRESS: 'Live',
    FINISHED: 'Finished',
  };
  const statusDot: Record<string, string> = {
    NOT_STARTED: 'bg-blue-400',
    IN_PROGRESS: 'bg-green-400',
    FINISHED: 'bg-gray-300',
  };

  function formatDate(iso: string | null) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  let track: HTMLElement;
  let currentPage = $state(0);

  const totalPages = $derived(Math.ceil(tournaments.length / PAGE_SIZE));

  function goToPage(page: number) {
    currentPage = Math.max(0, Math.min(page, totalPages - 1));
    const cardIndex = currentPage * PAGE_SIZE;
    const card = track?.children[cardIndex] as HTMLElement | undefined;
    card?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  }
</script>

<div class="relative">
  <!-- Track: shows 5 cards at a time -->
  <div
    bind:this={track}
    class="flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-1 no-scrollbar"
  >
    {#each tournaments as t}
      <a
        href="/tournaments/{t.id}"
        class="snap-start shrink-0 w-[calc(20%-10px)] min-w-[120px] flex flex-col rounded-xl border border-gray-200 bg-white p-3 hover:shadow-md hover:border-indigo-200 transition-all"
      >
        <div class="flex items-center gap-1.5 mb-1.5">
          <span class="w-1.5 h-1.5 rounded-full shrink-0 {statusDot[t.status] ?? statusDot.NOT_STARTED}"></span>
          <span class="text-xs text-gray-400 truncate">{statusLabel[t.status] ?? t.status}</span>
        </div>
        <p class="font-semibold text-gray-900 text-xs leading-snug line-clamp-2 flex-1 mb-1.5">{t.name}</p>
        <p class="text-xs text-gray-500 font-medium">{formatDate(t.start_date)}</p>
        {#if t.city}
          <p class="text-xs text-gray-400 truncate">{t.city}</p>
        {/if}
      </a>
    {/each}
  </div>

  <!-- Prev / Next + page dots -->
  {#if totalPages > 1}
    <div class="flex justify-between items-center mt-3">
      <button
        onclick={() => goToPage(currentPage - 1)}
        disabled={currentPage === 0}
        class="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm"
        aria-label="Previous"
      >←</button>

      <div class="flex gap-1.5 items-center">
        {#each { length: totalPages } as _, i}
          <button
            onclick={() => goToPage(i)}
            class="rounded-full transition-all {i === currentPage ? 'w-4 h-1.5 bg-indigo-600' : 'w-1.5 h-1.5 bg-gray-300'}"
            aria-label="Page {i + 1}"
          ></button>
        {/each}
      </div>

      <button
        onclick={() => goToPage(currentPage + 1)}
        disabled={currentPage === totalPages - 1}
        class="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm"
        aria-label="Next"
      >→</button>
    </div>
  {/if}
</div>

<style>
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
</style>
