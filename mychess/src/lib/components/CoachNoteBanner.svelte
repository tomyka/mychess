<!-- MyChess/src/lib/components/CoachNoteBanner.svelte -->
<script lang="ts">
  let { note, ondismiss } = $props<{ note: { id: string; message: string }; ondismiss: () => void }>();
</script>

<div class="bg-indigo-50 border-l-4 border-indigo-400 rounded-r-xl p-4 flex items-start gap-3">
  <div class="flex-1">
    <p class="text-indigo-700 font-semibold text-sm">Coach note</p>
    <p class="text-gray-700 text-sm mt-0.5">{note.message}</p>
  </div>
  <button
    onclick={ondismiss}
    class="text-gray-400 hover:text-gray-600 text-sm mt-0.5 shrink-0"
    aria-label="Dismiss"
  >✕</button>
</div>
