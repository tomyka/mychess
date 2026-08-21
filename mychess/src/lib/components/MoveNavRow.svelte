<!-- mychess/src/lib/components/MoveNavRow.svelte -->
<!--
	The ⏮ ◀ n/N ▶ ⏭ row under the board, shared by Learn and Practice.

	Extracted in story #97 of epic #95 rather than copied: the two pages differ in
	how they choose what to serve, but reviewing the moves already played is the
	same interaction on both, and the `aria-label`s here are asserted by both
	pages' tests. One copy means a fix to the disabled logic or the icons can't
	land on one surface and quietly miss the other.

	Width is capped to the board's own rendered width, since on desktop the board
	is height-constrained and usually narrower than its column — a full-width row
	would otherwise be wider than the board it belongs to.
-->
<script lang="ts">
	let {
		reviewIdx,
		totalPlies,
		reviewMoves,
		totalMoves,
		isReviewing,
		boardWidth = 0,
		onstart,
		onback,
		onforward,
		onlive
	}: {
		reviewIdx: number;
		totalPlies: number;
		// The same two positions counted in the PLAYER's own moves — what the
		// counter shows. reviewIdx/totalPlies stay plies because that's what the
		// buttons' own disabled logic is expressed in.
		reviewMoves: number;
		totalMoves: number;
		isReviewing: boolean;
		boardWidth?: number;
		onstart: () => void;
		onback: () => void;
		onforward: () => void;
		onlive: () => void;
	} = $props();

	const buttonClass =
		'py-2 rounded-xl bg-(--color-surface) border border-(--color-border) text-(--color-text) disabled:opacity-30 disabled:cursor-not-allowed hover:bg-(--color-border)/40';
</script>

<div
	class="grid grid-cols-5 gap-2 mt-4 shrink-0 mx-auto w-full items-center"
	style={boardWidth ? `max-width: ${boardWidth}px` : ''}
>
	<button onclick={onstart} disabled={reviewIdx <= 0} aria-label="Jump to start" class={buttonClass}>
		<svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 mx-auto" aria-hidden="true">
			<rect x="4" y="4" width="1.6" height="12" />
			<path d="M14.5 4l-6 6 6 6V4z" />
		</svg>
	</button>
	<button onclick={onback} disabled={reviewIdx <= 0} aria-label="Move back" class={buttonClass}>
		<svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 mx-auto" aria-hidden="true">
			<path d="M12.5 4l-6 6 6 6V4z" />
		</svg>
	</button>
	<p class="text-center text-sm font-semibold text-(--color-muted) tabular-nums" aria-hidden="true">
		{reviewMoves} / {totalMoves}
	</p>
	<button onclick={onforward} disabled={!isReviewing} aria-label="Move forward" class={buttonClass}>
		<svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 mx-auto" aria-hidden="true">
			<path d="M7.5 4l6 6-6 6V4z" />
		</svg>
	</button>
	<button onclick={onlive} disabled={!isReviewing} aria-label="Jump to current position" class={buttonClass}>
		<svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 mx-auto" aria-hidden="true">
			<rect x="14.4" y="4" width="1.6" height="12" />
			<path d="M5.5 4l6 6-6 6V4z" />
		</svg>
	</button>
</div>
