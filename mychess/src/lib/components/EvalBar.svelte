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

	Shown only in explore mode, and only once the player has switched the engine
	on there (see EngineToggle.svelte): drilling in Learn and Practice has no bar
	and downloads no engine at all. While the bar is up, every position on it is
	evaluated by the local worker — there is no precomputed source any more.
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
	import { evalBarWhiteFraction, formatEval } from '$lib/engine/uci';
	import { m } from '$lib/paraglide/messages';

	let {
		fen,
		orientation = 'white',
		height = 0
	}: {
		/** The position to evaluate — the board's own displayed FEN. */
		fen: string;
		orientation?: 'white' | 'black';
		// The board's own rendered size in px (it's square, so its width IS its
		// height) — the bar matches it exactly rather than guessing from the
		// viewport, since the board is height-constrained on desktop. There is no
		// fallback for 0: the bar can only mount once explore is open, long after
		// the board's `bind:boxWidth` has measured itself, so a real caller always
		// has a number by then.
		height?: number;
	} = $props();

	onDestroy(retainEngine());

	// The component only exists while the player has the engine switched on in
	// explore mode, so there is nothing conditional left here: mount it and it
	// spawns, hand it a position and it searches. It stays an $effect rather than
	// a plain top-level call precisely so it never runs on the SSR path, where it
	// would mark the module-level (and therefore request-shared) `engineState`
	// failed on the server.
	$effect(() => {
		ensureEngine();
	});

	// Fires once when `ready` flips true (evaluating the fen already on screen at
	// that point) and again on every later position — one code path for both.
	$effect(() => {
		requestIfDue(fen);
	});

	const whiteFraction = $derived(
		engineState.score ? evalBarWhiteFraction(engineState.score) : 0.5
	);
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
		engineState.score
			? m.eval_bar_label_score({ score: formatEval(engineState.score) })
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
	// A dash rather than an empty bar while there is nothing to say: the bar holds
	// its place while the engine loads, so it has to read as "no number yet",
	// not as broken.
	const numberText = $derived(engineState.score ? formatEval(engineState.score) : '–');
</script>

<div
	class="relative w-8 shrink-0 flex flex-col rounded-lg overflow-hidden border border-(--color-border)"
	style={`height: ${height}px`}
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
		class="absolute inset-x-0 text-center text-[0.6rem] font-bold leading-none tabular-nums transition-opacity {engineState.searching
			? 'opacity-60'
			: ''} {numberAtBottom
				? 'bottom-1'
				: 'top-1'} {numberOnWhite ? 'text-[#26262b]' : 'text-[#f8f8f6]'}"
		>
			{numberText}
		</span>
</div>
