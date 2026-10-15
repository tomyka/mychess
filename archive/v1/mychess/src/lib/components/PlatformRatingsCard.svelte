<!-- MyChess/src/lib/components/PlatformRatingsCard.svelte -->
<script lang="ts">
  import { m } from '$lib/paraglide/messages';

  type PlatformRatings = { rapid?: number; blitz?: number; bullet?: number; puzzle?: number };

  let { platform, username, ratings, loading = false } = $props<{
    platform: string;
    username: string | null;
    ratings: PlatformRatings | null;
    loading?: boolean;
  }>();

  const LABELS = $derived({
    rapid: m.platform_ratings_label_rapid(),
    blitz: m.platform_ratings_label_blitz(),
    bullet: m.platform_ratings_label_bullet(),
    puzzle: m.platform_ratings_label_puzzle()
  });

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
    <a href="/settings" class="text-(--color-accent) hover:underline">{m.platform_ratings_connect_link({ platform })}</a> {m.platform_ratings_connect_suffix()}
  </p>
{:else}
  <p class="text-sm font-medium text-(--color-text) mb-2">{platform}: <span class="font-mono">{username}</span></p>
  {#if loading}
    <div class="grid grid-cols-4 gap-3" aria-label={m.platform_ratings_loading_aria_label({ platform })}>
      {#each Array(4) as _, i (i)}
        <div class="bg-(--color-bg) rounded-lg border border-(--color-border) p-3 h-[60px] animate-pulse"></div>
      {/each}
    </div>
  {:else if ratings === null}
    <p class="text-sm text-(--color-muted)">{m.platform_ratings_load_error({ platform })}</p>
  {:else if entries.length === 0}
    <p class="text-sm text-(--color-muted)">{m.platform_ratings_none_yet()}</p>
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
