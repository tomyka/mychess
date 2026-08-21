<!-- mychess/src/lib/components/EvalBar.svelte -->
<!--
	The vertical white/black evaluation bar that runs down the board's edge.

	Orientation follows the BOARD, not the colour convention: the side you play
	is always the bottom end, the same end your own pieces sit on, so "the bar is
	filling towards me" means "I'm doing well" whichever colour you have.

	The evaluation is printed on the bar itself, inside whichever segment is the
	larger one, at that segment's outer end: its POSITION says who is ahead, so
	its sign can stay White-relative (`+` is good for White) the way every chess
	UI has it, without the number having to flip with the board.

	Always on, and normally engine-free: a precomputed evaluation for the position
	(`bookEval`, from `positions.eval_cp` — see #126) is what fills the bar while
	drilling, so no WASM is downloaded at all. The local engine is spawned only
	when a position has no stored eval, which in practice means explore mode's
	off-book positions. There is no preference to switch any of it off.
	Before the first score, and if the engine can't load at all, the bar holds an
	even 50/50 so the board never shifts sideways — with a dash instead of a
	number when there is nothing to report.

	While a search is in flight the PREVIOUS position's number stays up, dimmed,
	rather than blanking: positions change faster than a 400ms search finishes
	wherever moves play themselves, and clearing the score each time is what made
	the evaluation look switched off during the autoplay intro.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { engineState, ensureEngine, requestIfDue, retainEngine } from '$lib/engine/engine.svelte';
	import { evalBarWhiteFraction, formatEval, type EngineScore } from '$lib/engine/uci';
	import { m } from '$lib/paraglide/messages';

	let {
		fen,
		bookEval = null,
		orientation = 'white',
		height = 0
	}: {
		/** The position to evaluate — the board's own displayed FEN. */
		fen: string;
		/**
		 * The precomputed, white-relative evaluation for `fen`, when there is one.
		 * Takes precedence over spawning an engine; a live score, once the engine
		 * has produced one for the current position, takes precedence over it.
		 */
		bookEval?: EngineScore | null;
		orientation?: 'white' | 'black';
		// The board's own rendered size in px (it's square, so its width IS its
		// height) — the bar matches it exactly rather than guessing from the
		// viewport, since the board is height-constrained on desktop.
		height?: number;
	} = $props();

	onDestroy(retainEngine());

	// The engine is spawned only for a position nothing has precomputed — which
	// is what keeps the ~5.5MB download off the drilling path entirely (#126).
	// Once spawned it stays for the session, so a second off-book position is
	// instant.
	$effect(() => {
		if (!bookEval) ensureEngine();
	});

	// Fires once when `ready` flips true (evaluating the fen already on screen at
	// that point) and again on every later position — one code path for both.
	$effect(() => {
		if (!bookEval) requestIfDue(fen);
	});

	// A live score wins when the engine has actually answered for THIS position;
	// otherwise the stored one. `engineState.searching` is what distinguishes
	// "the engine's number is for the previous position" from "it's current".
	const score = $derived(engineState.score && !engineState.searching ? engineState.score : (bookEval ?? engineState.score));
	const whiteFraction = $derived(score ? evalBarWhiteFraction(score) : 0.5);
	// The share of the bar belonging to the side at the BOTTOM, as a percentage
	// rounded to a tenth: the two segments are sized from ONE number
	// (`100 - bottomPct` for the top) so float error can't leave a hairline gap
	// or a 100.0000001% total between them.
	const bottomPct = $derived(
		Math.round((orientation === 'black' ? 1 - whiteFraction : whiteFraction) * 1000) / 10
	);
	// A score already in hand wins over the failure state: an engine that dies
	// after answering leaves its last number on screen rather than replacing it
	// with "unavailable".
	const label = $derived(
		score
			? m.eval_bar_label_score({ score: formatEval(score) })
			: engineState.failed
				? m.eval_bar_label_unavailable()
				: m.eval_bar_label_loading()
	);
	// Board-white and board-black, deliberately not the theme's own surface/text
	// tokens: these two read as the pieces' colours in either theme, which is the
	// whole point of the bar.
	const bottomColor = $derived(orientation === 'black' ? 'bg-[#26262b]' : 'bg-[#f8f8f6]');
	const topColor = $derived(orientation === 'black' ? 'bg-[#f8f8f6]' : 'bg-[#26262b]');

	// The number sits inside the LARGER segment, at that segment's outer end —
	// so its position says who is ahead while its sign stays White-relative (`+`
	// good for White), the convention every chess UI shares. Ink colour is
	// whichever contrasts with the segment it lands in.
	const numberAtBottom = $derived(bottomPct >= 50);
	const numberOnWhite = $derived(numberAtBottom ? orientation !== 'black' : orientation === 'black');
	// A dash rather than an empty bar while there is nothing to say: the bar is
	// always visible now, so it has to read as "no number yet", not as broken.
	const numberText = $derived(score ? formatEval(score) : '–');
</script>

<div
	class="relative w-8 shrink-0 self-start flex flex-col rounded-lg overflow-hidden border border-(--color-border)"
	style={height ? `height: ${height}px` : 'align-self: stretch'}
	role="img"
	aria-label={label}
>
	<!-- Two stacked segments rather than a fill over a track: the bottom one
	     belongs to the side you play, so which colour is which flips with the
	     board instead of the numbers flipping. -->
	<div
		class="shrink-0 transition-[height] duration-200 {topColor}"
		style={`height: ${100 - bottomPct}%`}
	></div>
	<div class="shrink-0 transition-[height] duration-200 {bottomColor}" style={`height: ${bottomPct}%`}></div>
	<!-- Dead level, so a near-equal position reads without the number. -->
	<div class="absolute inset-x-0 top-1/2 h-px bg-(--color-accent)/60"></div>
	<span
		class="absolute inset-x-0 text-center text-[0.6rem] font-bold leading-none tabular-nums transition-opacity {engineState.searching &&
		!bookEval
			? 'opacity-60'
			: ''} {numberAtBottom
				? 'bottom-1'
				: 'top-1'} {numberOnWhite ? 'text-[#26262b]' : 'text-[#f8f8f6]'}"
		>
			{numberText}
		</span>
</div>
