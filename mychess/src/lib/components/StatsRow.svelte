<!-- MyChess/src/lib/components/StatsRow.svelte -->
<script lang="ts">
  let {
    streakDays = 0,
    countryRank = null,
    ageGroupRank = null,
    ageBracket = null,
  } = $props<{
    streakDays?: number;
    countryRank?: number | null;
    ageGroupRank?: number | null;
    ageBracket?: string | null;
  }>();

  const ageLabel = $derived(
    ageBracket && ageBracket !== 'open' ? `${ageBracket} rank` : 'Age group rank'
  );
</script>

<div class="grid grid-cols-3 gap-3">
  <!-- Country rank (FIDE standard, Lithuania) -->
  <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-3 text-center">
    <p class="text-xl font-bold {countryRank != null ? 'text-gray-900' : 'text-gray-400'}">
      {countryRank ?? '––'}
    </p>
    <p class="text-xs text-gray-400 mt-0.5">Country rank</p>
  </div>

  <!-- Age group rank -->
  <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-3 text-center">
    <p class="text-xl font-bold {ageGroupRank != null ? 'text-gray-900' : 'text-gray-400'}">
      {ageGroupRank ?? '––'}
    </p>
    <p class="text-xs text-gray-400 mt-0.5">{ageLabel}</p>
  </div>

  <!-- Streak -->
  <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-3 text-center">
    <p class="text-xl font-bold {streakDays > 0 ? 'text-orange-500' : 'text-gray-300'}">
      {streakDays > 0 ? `🔥 ${streakDays}` : '–'}
    </p>
    <p class="text-xs text-gray-400 mt-0.5">Day streak</p>
  </div>
</div>
