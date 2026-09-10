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
	import { m } from '$lib/paraglide/messages';

	let {
		reviewIdx,
		reviewMoves,
		totalMoves,
		isReviewing,
		boardWidth = 0,
		onstart,
		onback,
		onforward,
		onlive,
		onExplore,
		exploreDisabled = false
	}: {
		reviewIdx: number;
		// The two positions counted in the PLAYER's own moves — what the counter
		// shows. `reviewIdx` stays in plies because that is what the buttons' own
		// disabled logic is expressed in.
		reviewMoves: number;
		totalMoves: number;
		isReviewing: boolean;
		boardWidth?: number;
		onstart: () => void;
		onback: () => void;
		onforward: () => void;
		onlive: () => void;
		// Adds a 6th "explore this position" button when provided. A below-row
		// trigger used to exist instead on Learn/Practice, but that separate
		// element's own mount/unmount as canExplore flipped changed the page's
		// total height out from under the board, forcing a resize every time
		// (#158). This button avoids that by existing statically: a caller that
		// offers explore mode at all passes a stable onExplore function for the
		// whole page's lifetime and toggles `exploreDisabled` instead of the
		// prop itself — swapping onExplore to undefined per-render changed the
		// row's own column count (5 vs 6), the same class of layout shift under
		// a different name.
		onExplore?: () => void;
		exploreDisabled?: boolean;
	} = $props();

	const buttonClass =
		'py-2 rounded-xl bg-(--color-surface) border border-(--color-border) text-(--color-text) disabled:opacity-30 disabled:cursor-not-allowed hover:bg-(--color-border)/40';
</script>

<div
	class="grid {onExplore ? 'grid-cols-6' : 'grid-cols-5'} gap-2 mt-4 shrink-0 mx-auto w-full items-center"
	style={boardWidth ? `max-width: ${boardWidth}px` : ''}
>
	<button onclick={onstart} disabled={reviewIdx <= 0} aria-label={m.move_nav_jump_to_start()} class={buttonClass}>
		<svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 mx-auto" aria-hidden="true">
			<rect x="4" y="4" width="1.6" height="12" />
			<path d="M14.5 4l-6 6 6 6V4z" />
		</svg>
	</button>
	<button onclick={onback} disabled={reviewIdx <= 0} aria-label={m.move_nav_move_back()} class={buttonClass}>
		<svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 mx-auto" aria-hidden="true">
			<path d="M12.5 4l-6 6 6 6V4z" />
		</svg>
	</button>
	<p class="text-center text-sm font-semibold text-(--color-muted) tabular-nums" aria-hidden="true">
		{reviewMoves} / {totalMoves}
	</p>
	<button onclick={onforward} disabled={!isReviewing} aria-label={m.move_nav_move_forward()} class={buttonClass}>
		<svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 mx-auto" aria-hidden="true">
			<path d="M7.5 4l6 6-6 6V4z" />
		</svg>
	</button>
	<button onclick={onlive} disabled={!isReviewing} aria-label={m.move_nav_jump_to_current()} class={buttonClass}>
		<svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 mx-auto" aria-hidden="true">
			<rect x="14.4" y="4" width="1.6" height="12" />
			<path d="M5.5 4l6 6-6 6V4z" />
		</svg>
	</button>
	{#if onExplore}
		<button
			onclick={onExplore}
			disabled={exploreDisabled}
			aria-label={m.learn_explore_position()}
			class={buttonClass}
		>
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="w-4 h-4 mx-auto"
				aria-hidden="true"
			>
				<circle cx="10.5" cy="10.5" r="6.5" />
				<line x1="10.5" y1="7.5" x2="10.5" y2="13.5" />
				<line x1="7.5" y1="10.5" x2="13.5" y2="10.5" />
				<line x1="15.3" y1="15.3" x2="20" y2="20" />
			</svg>
		</button>
	{/if}
</div>
