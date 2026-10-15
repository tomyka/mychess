<!-- mychess/src/lib/components/ExploreControls.svelte -->
<!--
	The excursion's own control row — undo, the engine switch, and the way out —
	shown under the board for as long as explore mode lasts.

	It takes MoveNavRow's place rather than sitting beside it: that row counts
	drill plies, and none of the excursion's moves are drill plies, so leaving it
	up would have it reporting a position the player is no longer looking at.

	Extracted in the pass after #132 because Learn and Practice had grown byte-
	identical copies of it, differing only in the exit's label (Practice moves on
	to the next line when the excursion started from a demoted one). Two copies
	of three buttons is two places for a class, a label, or the disabled rule to
	drift apart, and Learn's tests query these buttons by their text.

	Width is capped to the board's own rendered width for the same reason
	MoveNavRow caps it: on desktop the board is height-constrained and usually
	narrower than its column, so a full-width row would overhang it.
-->
<script lang="ts">
	import EngineToggle from './EngineToggle.svelte';
	import { m } from '$lib/paraglide/messages';

	let {
		depth,
		onundo,
		onstop,
		stopLabel = m.explore_controls_back_to_line(),
		boardWidth = 0
	}: {
		// Plies played on the scratch board. Only drives "is there anything to
		// undo?" — the excursion's position itself lives on the page.
		depth: number;
		onundo: () => void;
		onstop: () => void;
		stopLabel?: string;
		boardWidth?: number;
	} = $props();
</script>

<div
	class="grid grid-cols-3 gap-2 mt-4 shrink-0 mx-auto w-full"
	style={boardWidth ? `max-width: ${boardWidth}px` : ''}
>
	<button
		onclick={onundo}
		disabled={depth === 0}
		class="py-2 rounded-xl bg-(--color-surface) border border-(--color-border) text-xs sm:text-sm font-semibold text-(--color-text) disabled:opacity-30"
	>
		{m.explore_controls_undo()}
	</button>
	<EngineToggle />
	<button
		onclick={onstop}
		class="py-2 rounded-xl border border-amber-300 bg-amber-50 text-xs sm:text-sm font-semibold text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
	>
		{stopLabel}
	</button>
</div>
