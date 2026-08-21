<!-- MyChess/src/lib/components/StatsRow.svelte -->
<script lang="ts">
  import { m } from '$lib/paraglide/messages';

  let { streakDays = 0 } = $props<{ streakDays?: number }>();
</script>

<div class="bg-(--color-surface) rounded-xl border border-(--color-border) shadow-sm p-3 text-center">
  <p class="text-xl font-bold {streakDays > 0 ? 'text-orange-500' : 'text-gray-300'}">
    {streakDays > 0 ? `🔥 ${streakDays}` : '–'}
  </p>
  <p class="text-xs text-(--color-muted) mt-0.5">{m.stats_row_day_streak()}</p>
</div>
