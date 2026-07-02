<!-- MyChess/src/lib/components/StatsRow.svelte -->
<script lang="ts">
  let { streakDays = 0 } = $props<{ streakDays?: number }>();
</script>

<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-3 text-center">
  <p class="text-xl font-bold {streakDays > 0 ? 'text-orange-500' : 'text-gray-300'}">
    {streakDays > 0 ? `🔥 ${streakDays}` : '–'}
  </p>
  <p class="text-xs text-gray-400 mt-0.5">Day streak</p>
</div>
