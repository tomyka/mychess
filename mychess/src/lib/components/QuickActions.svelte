<script lang="ts">
  import { m } from '$lib/paraglide/messages';
</script>

<a
  href="/practice"
  class="flex flex-col items-center justify-center p-4 rounded-xl border transition-all
         bg-(--color-accent) text-white border-(--color-accent) hover:bg-(--color-accent-hover)"
>
  <span class="font-semibold text-sm">{m.quick_actions_practice_label()}</span>
  <span class="text-xs mt-0.5 text-indigo-200">{m.quick_actions_practice_description()}</span>
</a>
