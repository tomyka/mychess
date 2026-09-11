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
		exploreDisabled = false,
		onhint,
		hintDisabled = false
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
		/**
		 * Adds a "need a hint?" key (GitHub issue #217). On mobile the offer used
		 * to be a 48px card above the board — PracticeStatusStrip's hintable slot
		 * — which is a whole row of height for one button; here it costs none,
		 * because this row is already on screen.
		 *
		 * Same static contract as `onExplore` above, for the same reason: pass a
		 * stable function for the page's lifetime and toggle `hintDisabled`.
		 * Swapping this prop between a function and undefined would move the row
		 * between 6 and 7 columns on every phase change.
		 *
		 * Labelled "Show a hint" rather than reusing the strip's "Need a hint?":
		 * a caller may well have both on screen at once — Learn keeps the strip
		 * mounted as `sr-only` on mobile so it can go on announcing — and two
		 * controls answering to one name is a worse outcome for a screen reader
		 * than two names for two affordances. The strip asks; this one acts.
		 */
		onhint?: () => void;
		hintDisabled?: boolean;
	} = $props();

	// Spelled out as whole literals rather than composed, so Tailwind's scanner
	// actually sees each class.
	const columnClass = $derived(
		onExplore && onhint ? 'grid-cols-7' : onExplore || onhint ? 'grid-cols-6' : 'grid-cols-5'
	);

	const buttonClass =
		'py-2 rounded-xl bg-(--color-surface) border border-(--color-border) text-(--color-text) disabled:opacity-30 disabled:cursor-not-allowed hover:bg-(--color-border)/40';
</script>

<div
	class="grid {columnClass} gap-2 mt-4 shrink-0 mx-auto w-full items-center"
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
	{#if onhint}
		<button
			onclick={onhint}
			disabled={hintDisabled}
			aria-label={m.move_nav_show_hint()}
			class={buttonClass}
		>
			<!-- A bulb, drawn in the same stroked style as the explore key beside
			     it rather than as the 💡 the old card used: the emoji rendered at a
			     different optical weight to the five glyphs it now sits with. The
			     ring this button raises on the board still carries the emoji. -->
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
				<path d="M9 18h6" />
				<path d="M10 21h4" />
				<path d="M12 3a6 6 0 0 0-3.5 10.9c.3.2.5.6.5 1V15h6v-.1c0-.4.2-.8.5-1A6 6 0 0 0 12 3z" />
			</svg>
		</button>
	{/if}
</div>
