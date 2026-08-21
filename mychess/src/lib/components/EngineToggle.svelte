<!-- mychess/src/lib/components/EngineToggle.svelte -->
<!--
	Switches the local engine on for this visit. Lives in explore mode's control
	row and nowhere else: drilling is repetition, and an evaluation on screen
	there invites judging the position instead of recalling the move.

	Off by default and off again after a reload, because pressing it costs a
	~5.5MB WASM download — a thing the player should ask for, not inherit.

	The label stays "Engine" in both states and the accent treatment carries the
	on/off signal: `aria-pressed` already says "pressed", so a label that also
	said "on" had a screen reader announcing the same fact twice.
-->
<script lang="ts">
	import { engineEnabled, setEngineEnabled } from '$lib/engine/engine.svelte';
</script>

<button
	type="button"
	aria-pressed={engineEnabled.on}
	onclick={() => setEngineEnabled(!engineEnabled.on)}
	class="py-2 rounded-xl border text-xs sm:text-sm font-semibold {engineEnabled.on
		? 'border-(--color-accent) bg-(--color-accent)/10 text-(--color-text)'
		: 'border-(--color-border) bg-(--color-surface) text-(--color-muted)'}"
>
	<span aria-hidden="true">⚙</span> Engine
</button>
