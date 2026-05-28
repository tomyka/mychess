<script lang="ts">
  let { data, children } = $props<{ data: any; children: any }>();
  const isGuest = $derived(!!(data as any)?.isGuest);
</script>

{#if isGuest}
  <div class="sticky top-0 z-50 bg-yellow-400 text-slate-900 text-sm font-semibold text-center py-2 px-4 flex items-center justify-center gap-3">
    <span>🎯 Playing as Guest — your progress is saved in this browser only.</span>
    <a
      href="/login?signup=1"
      class="bg-slate-900 text-yellow-400 px-3 py-1 rounded-full text-xs hover:bg-slate-700 transition whitespace-nowrap">
      Save forever →
    </a>
  </div>
{/if}

{@render children()}
