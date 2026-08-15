<!-- MyChess/src/lib/components/LichessStatsCard.svelte -->
<script lang="ts">
  type LichessRatings = {
    bullet?: number;
    blitz?: number;
    rapid?: number;
    classical?: number;
  };

  let { ratings, username, compact = false } = $props<{
    ratings: LichessRatings | null;
    username: string | null;
    compact?: boolean;
  }>();

  const LABELS = {
    bullet: 'Bullet',
    blitz: 'Blitz',
    rapid: 'Rapid',
    classical: 'Classical'
  } as const;

  const DISPLAY_ORDER = ['bullet', 'blitz', 'rapid', 'classical'] as const;
  const COMPACT_PRIORITY = ['blitz', 'rapid', 'classical', 'bullet'] as const;

  const entries = $derived(
    ratings
      ? DISPLAY_ORDER
          .filter((variant) => typeof ratings[variant] === 'number')
          .map((variant) => ({ variant, label: LABELS[variant], rating: ratings[variant] as number }))
      : []
  );

  const compactEntry = $derived.by(() => {
    if (!ratings) return null;
    for (const variant of COMPACT_PRIORITY) {
      const rating = ratings[variant];
      if (typeof rating === 'number') return { variant, label: LABELS[variant], rating };
    }
    return null;
  });
</script>

{#if !username}
  <p class="text-sm text-(--color-muted)">
    <a href="/settings" class="text-(--color-accent) hover:underline">Connect Lichess</a> to see your ratings.
  </p>
{:else if ratings === null}
  <p class="text-sm text-(--color-muted)">Couldn't load Lichess stats right now.</p>
{:else if compact}
  {#if compactEntry}
    <div class="text-right shrink-0">
      <p class="text-3xl font-bold text-(--color-text)">{compactEntry.rating}</p>
      <p class="text-xs text-(--color-muted) uppercase tracking-wide">{compactEntry.label}</p>
    </div>
  {:else}
    <p class="text-sm text-(--color-muted)">No rated games yet.</p>
  {/if}
{:else if entries.length === 0}
  <p class="text-sm text-(--color-muted)">No rated games yet.</p>
{:else}
  <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
    {#each entries as entry (entry.variant)}
      <div class="bg-(--color-bg) rounded-lg border border-(--color-border) p-3 text-center">
        <p class="text-xl font-bold text-(--color-text)">{entry.rating}</p>
        <p class="text-xs text-(--color-muted) mt-0.5">{entry.label}</p>
      </div>
    {/each}
  </div>
{/if}
