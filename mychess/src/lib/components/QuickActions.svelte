<!-- MyChess/src/lib/components/QuickActions.svelte -->
<script lang="ts">
  let { totalReviews = 0 } = $props<{ totalReviews?: number }>();

  const actions = [
    {
      href: '/learn',
      label: 'Daily Review',
      sublabel: `${totalReviews} cards done`,
      primary: true
    },
    { href: '/practice', label: 'Practice', sublabel: 'Full board', primary: false },
    { href: '/drill',    label: 'Drill',    sublabel: 'No mistakes', primary: false },
    { href: '/time-trial', label: 'Time Trial', sublabel: '60 seconds', primary: false }
  ];
</script>

<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
  {#each actions as action}
    <a
      href={action.href}
      class="flex flex-col items-center justify-center p-4 rounded-xl border transition-all
             {action.primary
               ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
               : 'bg-white text-gray-700 border-gray-200 shadow-sm hover:shadow-md hover:border-gray-300'}"
    >
      <span class="font-semibold text-sm">{action.label}</span>
      <span class="text-xs mt-0.5 {action.primary ? 'text-indigo-200' : 'text-gray-400'}">
        {action.sublabel}
      </span>
    </a>
  {/each}
</div>
