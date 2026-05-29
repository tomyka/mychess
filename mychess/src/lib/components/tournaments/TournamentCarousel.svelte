<script lang="ts">
  const { tournaments } = $props<{ tournaments: any[] }>();

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

  function formatDate(iso: string | null) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  let track: HTMLElement;
  let currentIndex = $state(0);

  function scrollTo(index: number) {
    currentIndex = Math.max(0, Math.min(index, tournaments.length - 1));
    const card = track?.children[currentIndex] as HTMLElement | undefined;
    card?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  }
</script>

<div class="relative">
  <!-- Track -->
  <div
    bind:this={track}
    class="flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-2 -mx-1 px-1 no-scrollbar"
  >
    {#each tournaments as t}
      <a
        href="/tournaments/{t.id}"
        class="snap-start shrink-0 w-64 flex flex-col rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md hover:border-gray-300 transition-all"
      >
        <div class="flex items-start justify-between gap-2 mb-2">
          <p class="font-semibold text-gray-900 text-sm leading-snug line-clamp-2 flex-1">{t.name}</p>
          <span class="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full {statusClass[t.status] ?? statusClass.NOT_STARTED}">
            {statusLabel[t.status] ?? t.status}
          </span>
        </div>
        <div class="text-xs text-gray-500 space-y-0.5 flex-1">
          <div class="font-medium text-gray-700">{formatDate(t.start_date)}</div>
          <div>{t.city ? `${t.city}, ${t.country}` : t.country}</div>
        </div>
        <div class="mt-3 pt-2 border-t border-gray-100 text-xs text-indigo-600">
          View details →
        </div>
      </a>
    {/each}
  </div>

  <!-- Prev / Next buttons -->
  {#if tournaments.length > 1}
    <div class="flex justify-between mt-2">
      <button
        onclick={() => scrollTo(currentIndex - 1)}
        disabled={currentIndex === 0}
        class="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="Previous"
      >←</button>

      <!-- Dot indicators -->
      <div class="flex gap-1.5 items-center">
        {#each tournaments as _, i}
          <button
            onclick={() => scrollTo(i)}
            class="w-1.5 h-1.5 rounded-full transition-colors {i === currentIndex ? 'bg-indigo-600' : 'bg-gray-300'}"
            aria-label="Go to slide {i + 1}"
          ></button>
        {/each}
      </div>

      <button
        onclick={() => scrollTo(currentIndex + 1)}
        disabled={currentIndex === tournaments.length - 1}
        class="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="Next"
      >→</button>
    </div>
  {/if}
</div>

<style>
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
</style>
