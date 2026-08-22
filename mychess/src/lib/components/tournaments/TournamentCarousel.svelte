<script lang="ts">
  import { m } from '$lib/paraglide/messages';

  const { tournaments } = $props<{ tournaments: any[] }>();

  const PAGE_SIZE = 3;

  const statusLabel: Record<string, string> = {
    NOT_STARTED: m.tournaments_status_upcoming(),
    IN_PROGRESS: m.tournaments_status_live(),
    FINISHED: m.tournaments_status_finished(),
  };
  const statusDot: Record<string, string> = {
    NOT_STARTED: 'bg-blue-400',
    IN_PROGRESS: 'bg-green-400',
    FINISHED: 'bg-gray-300',
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
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}.${m}.${day}`;
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
  <!-- Track: shows 3 cards at a time -->
  <div
    bind:this={track}
    class="flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-1 no-scrollbar"
  >
    {#each tournaments as t (t.id)}
      <a
        href="/tournaments/{t.id}"
        class="snap-start shrink-0 w-[calc(33.333%-8px)] min-w-[160px] flex flex-col rounded-xl border border-(--color-border) bg-(--color-surface) p-3 hover:shadow-md hover:border-indigo-200 transition-all"
      >
        <div class="flex items-center gap-1.5 mb-2">
          <span class="w-1.5 h-1.5 rounded-full shrink-0 {statusDot[t.status] ?? statusDot.NOT_STARTED}"></span>
          <span class="text-xs text-(--color-muted) truncate">{statusLabel[t.status] ?? t.status}</span>
        </div>
        <p class="font-semibold text-(--color-text) text-xs leading-snug line-clamp-2 flex-1 mb-2">{t.name}</p>
        <div class="space-y-0.5 text-xs text-(--color-muted)">
          <p class="font-medium text-(--color-text) tabular-nums">{formatDate(t.start_date)}</p>
          {#if t.city}
            <p class="truncate">{t.city}</p>
          {/if}
          {#if t.time_control && t.time_control !== 'UNKNOWN'}
            <p class="text-indigo-500 font-medium">{tcLabel[t.time_control] ?? t.time_control}</p>
          {/if}
          {#if t.average_rating}
            <p>{m.tournaments_avg_rating({ rating: t.average_rating })}</p>
          {/if}
        </div>
      </a>
    {/each}
  </div>

  <!-- Prev / Next + page dots -->
  {#if totalPages > 1}
    <div class="flex justify-between items-center mt-3">
      <button
        onclick={() => goToPage(currentPage - 1)}
        disabled={currentPage === 0}
        class="p-1.5 rounded-lg border border-(--color-border) text-(--color-muted) hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm"
        aria-label={m.tournament_carousel_prev_label()}
      >←</button>

      <div class="flex gap-1.5 items-center">
        {#each { length: totalPages } as _, i (i)}
          <button
            onclick={() => goToPage(i)}
            class="rounded-full transition-all {i === currentPage ? 'w-4 h-1.5 bg-(--color-accent)' : 'w-1.5 h-1.5 bg-gray-300'}"
            aria-label={m.tournament_carousel_page_label({ page: i + 1 })}
          ></button>
        {/each}
      </div>

      <button
        onclick={() => goToPage(currentPage + 1)}
        disabled={currentPage === totalPages - 1}
        class="p-1.5 rounded-lg border border-(--color-border) text-(--color-muted) hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm"
        aria-label={m.tournament_carousel_next_label()}
      >→</button>
    </div>
  {/if}
</div>

<style>
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
</style>
