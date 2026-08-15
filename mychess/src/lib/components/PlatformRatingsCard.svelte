<!-- MyChess/src/lib/components/PlatformRatingsCard.svelte -->
<script lang="ts">
  type PlatformRatings = { rapid?: number; blitz?: number; bullet?: number; puzzle?: number };

  let { platform, username, ratings, loading = false } = $props<{
    platform: string;
    username: string | null;
    ratings: PlatformRatings | null;
    loading?: boolean;
  }>();

  const LABELS = {
    rapid: 'Rapid',
    blitz: 'Blitz',
    bullet: 'Bullet',
    puzzle: 'Puzzles'
  } as const;

  const DISPLAY_ORDER = ['rapid', 'blitz', 'bullet', 'puzzle'] as const;

  const entries = $derived(
    ratings
      ? DISPLAY_ORDER
          .filter((variant) => typeof ratings[variant] === 'number')
          .map((variant) => ({ variant, label: LABELS[variant], rating: ratings[variant] as number }))
      : []
  );
</script>

{#if !username}
  <p class="text-sm text-(--color-muted)">
    <a href="/settings" class="text-(--color-accent) hover:underline">Connect {platform}</a> to see your ratings.
  </p>
{:else}
  <p class="text-sm font-medium text-(--color-text) mb-2">{platform}: <span class="font-mono">{username}</span></p>
  {#if loading}
    <div class="grid grid-cols-4 gap-3" aria-label="Loading {platform} ratings">
      {#each Array(4) as _}
        <div class="bg-(--color-bg) rounded-lg border border-(--color-border) p-3 h-[60px] animate-pulse"></div>
      {/each}
    </div>
  {:else if ratings === null}
    <p class="text-sm text-(--color-muted)">Couldn't load {platform} stats right now.</p>
  {:else if entries.length === 0}
    <p class="text-sm text-(--color-muted)">No rated games yet.</p>
  {:else}
    <div class="grid grid-cols-4 gap-3">
      {#each entries as entry (entry.variant)}
        <div class="bg-(--color-bg) rounded-lg border border-(--color-border) p-3 text-center">
          <p class="text-xl font-bold text-(--color-text)">{entry.rating}</p>
          <p class="text-xs text-(--color-muted) mt-0.5">{entry.label}</p>
        </div>
      {/each}
    </div>
  {/if}
{/if}
