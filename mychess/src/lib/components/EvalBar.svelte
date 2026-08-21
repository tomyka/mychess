<!-- mychess/src/lib/components/EvalBar.svelte -->
<!--
	The vertical white/black evaluation bar that runs down the board's edge.

	Orientation follows the BOARD, not the colour convention: the side you play
	is always the bottom end, the same end your own pieces sit on, so "the bar is
	filling towards me" means "I'm doing well" whichever colour you have. The
	number in the Engine card stays white-relative (`+` is good for White), as
	every chess UI has it.

	Renders nothing at all unless the engine preference is on — including no
	width, so a page with the engine off looks exactly as it did before this
	component existed. While the engine is on but has no score yet, the bar holds
	an even 50/50 rather than collapsing, so the board doesn't shift sideways
	between evaluations.
-->
<script lang="ts">
	import { enginePrefStore } from '$lib/enginePref.svelte';
	import { engineState } from '$lib/engine/engine.svelte';
	import { evalBarWhiteFraction, formatEval } from '$lib/engine/uci';

	let {
		orientation = 'white',
		height = 0
	}: {
		orientation?: 'white' | 'black';
		// The board's own rendered size in px (it's square, so its width IS its
		// height) — the bar matches it exactly rather than guessing from the
		// viewport, since the board is height-constrained on desktop.
		height?: number;
	} = $props();

	const shown = $derived(enginePrefStore.enabled && !engineState.failed);
	const whiteFraction = $derived(engineState.score ? evalBarWhiteFraction(engineState.score) : 0.5);
	// The share of the bar belonging to the side at the BOTTOM, as a percentage
	// rounded to a tenth: the two segments are sized from ONE number
	// (`100 - bottomPct` for the top) so float error can't leave a hairline gap
	// or a 100.0000001% total between them.
	const bottomPct = $derived(
		Math.round((orientation === 'black' ? 1 - whiteFraction : whiteFraction) * 1000) / 10
	);
	const label = $derived(engineState.score ? `Engine evaluation ${formatEval(engineState.score)}` : 'Engine evaluation');
	// Board-white and board-black, deliberately not the theme's own surface/text
	// tokens: these two read as the pieces' colours in either theme, which is the
	// whole point of the bar.
	const bottomColor = $derived(orientation === 'black' ? 'bg-[#26262b]' : 'bg-[#f8f8f6]');
	const topColor = $derived(orientation === 'black' ? 'bg-[#f8f8f6]' : 'bg-[#26262b]');
</script>

{#if shown}
	<div
		class="relative w-3.5 shrink-0 self-center flex flex-col rounded-full overflow-hidden border border-(--color-border)"
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
	</div>
{/if}
