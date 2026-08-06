<!-- src/lib/components/LevelList.svelte -->
<script lang="ts">
  import { levelTag } from '$lib/mastery/tags';

  let {
    totalLevels,
    currentLevel,
    reviewLevel = null,
    onselect
  } = $props<{
    totalLevels: number;
    currentLevel: number | 'mastered';
    reviewLevel?: number | null;
    onselect: (level: number) => void;
  }>();

  function status(level: number): 'passed' | 'current' | 'locked' {
    if (currentLevel === 'mastered') return 'passed';
    if (level < currentLevel) return 'passed';
    if (level === currentLevel) return 'current';
    return 'locked';
  }
</script>

<div class="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
  <ul class="divide-y divide-gray-100">
    {#each Array.from({ length: totalLevels }, (_, i) => i + 1) as level}
      {@const st = status(level)}
      <li>
        <button
          type="button"
          disabled={st !== 'passed'}
          aria-current={st === 'current' ? 'true' : undefined}
          onclick={() => st === 'passed' && onselect(level)}
          class="w-full flex items-center justify-between px-4 py-3 text-left transition
                 {st === 'locked' ? 'opacity-40 cursor-not-allowed' : ''}
                 {st === 'current' ? 'cursor-default' : ''}
                 {reviewLevel === level ? 'bg-indigo-50' : st === 'current' ? 'bg-indigo-50/50' : ''}
                 {st === 'passed' ? 'hover:bg-gray-50' : ''}"
        >
          <span class="font-medium text-gray-900">
            Level {level}
            {#if st === 'current'}<span class="text-indigo-600 text-xs ml-1">· current</span>{/if}
          </span>
          <span class="text-sm text-gray-400">{levelTag(level, totalLevels)}</span>
        </button>
      </li>
    {/each}
    {#if currentLevel === 'mastered'}
      <li class="w-full flex items-center justify-between px-4 py-3 bg-amber-50">
        <span class="font-medium text-amber-700">🏆 Mastered</span>
        <span class="text-sm text-amber-500">{levelTag(totalLevels, totalLevels)}</span>
      </li>
    {/if}
  </ul>
</div>
