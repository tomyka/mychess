<script lang="ts">
  const actions = [
    { href: '/master', label: 'Master', sublabel: 'Every move, shuffled', primary: true },
    { href: '/practice', label: 'Practice', sublabel: 'One repertoire, leveled', primary: false }
  ];
</script>

<div class="grid grid-cols-2 gap-3">
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
