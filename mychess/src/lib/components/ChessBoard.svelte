<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Chessground } from 'chessground';
	import type { Api } from 'chessground/api';
	import type { Color, Key } from 'chessground/types';
	import { Chess } from 'chess.js';
	import { DEFAULT_PREFS, animationDuration, type BoardPrefs } from '$lib/board/prefs';

	type Props = {
		fen?: string;
		orientation?: Color;
		interactable?: boolean;
		lastMove?: [Key, Key] | undefined;
		prefs?: BoardPrefs;
		// Return `false` to snap the board back to `fen` (e.g. an incorrect guess).
		onmove?: (detail: { from: Key; to: Key; san: string }) => boolean | void;
	};

	let {
		fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
		orientation = 'white' as Color,
		interactable = true,
		lastMove = undefined,
		prefs = DEFAULT_PREFS,
		onmove
	}: Props = $props();

	let el: HTMLElement;
	let cg: Api;
	let correctSquare = $state<Key | null>(null);

	// Tracks the last `fen` we actually repositioned the board to. Reactive
	// prop changes unrelated to position (e.g. `interactable` flipping once a
	// guess is answered) must NOT re-snap the board back to this same `fen` —
	// that would visually undo a move the player just correctly played.
	// svelte-ignore state_referenced_locally -- intentional one-time snapshot for manual tracking, not a live binding
	let lastAppliedFen = fen;

	// Positions the badge on the square's top-right corner (matching the
	// typical "annotation" placement chess sites use), not centered on it.
	function squareToPosition(square: Key, boardOrientation: Color) {
		const file = square.charCodeAt(0) - 97; // 'a' -> 0 .. 'h' -> 7
		const rank = Number(square[1]); // 1-8
		const col = boardOrientation === 'white' ? file : 7 - file;
		const row = boardOrientation === 'white' ? 8 - rank : rank - 1;
		return { left: `${(col + 1) * 12.5}%`, top: `${row * 12.5}%` };
	}

	function buildConfig() {
		const chess = new Chess(fen);
		const dests = new Map<Key, Key[]>();

		if (interactable) {
			for (const sq of chess.board().flat()) {
				if (!sq) continue;
				const moves = chess.moves({ square: sq.square as any, verbose: true });
				if (moves.length) {
					dests.set(sq.square as Key, moves.map((m) => m.to as Key));
				}
			}
		}

		const turnColor: Color = chess.turn() === 'w' ? 'white' : 'black';

		return {
			fen,
			orientation,
			turnColor,
			movable: {
				free: false,
				color: (interactable ? turnColor : undefined) as Color | undefined,
				dests,
				events: {
					after: (orig: Key, dest: Key) => {
						const chess2 = new Chess(fen);
						const move = chess2.move({ from: orig as any, to: dest as any, promotion: 'q' });
						if (!move || !onmove) return;
						const keepMove = onmove({ from: orig, to: dest, san: move.san });
						if (keepMove === false) {
							correctSquare = null;
							cg.set(buildConfig());
						} else {
							correctSquare = dest;
						}
					}
				}
			},
			lastMove,
			coordinates: prefs.coordinates,
			highlight: { lastMove: prefs.highlight, check: prefs.highlight },
			animation: {
				enabled: animationDuration(prefs.animation) > 0,
				duration: animationDuration(prefs.animation)
			}
		};
	}

	onMount(() => {
		cg = Chessground(el, buildConfig());
	});

	onDestroy(() => cg?.destroy());

	$effect(() => {
		if (!cg) return;
		const config = buildConfig();
		if (fen === lastAppliedFen) {
			// Same position as last time we repositioned — a guess may have
			// already moved a piece visually; don't stomp on it, just apply
			// whatever else changed (movable color, dests, orientation...).
			delete (config as { fen?: string }).fen;
		} else {
			lastAppliedFen = fen;
			correctSquare = null;
		}
		cg.set(config);
	});
</script>

<div
	class="relative w-full aspect-square rounded-xl overflow-hidden shadow-2xl board-theme-{prefs.theme} pieces-{prefs.pieceSet}"
>
	<div bind:this={el} class="w-full h-full"></div>
	{#if correctSquare}
		{@const pos = squareToPosition(correctSquare, orientation)}
		<div
			class="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center w-6 h-6 rounded-full bg-green-500 border-2 border-white shadow-lg"
			style="left: {pos.left}; top: {pos.top};"
		>
			<svg viewBox="0 0 24 24" fill="white" class="w-3.5 h-3.5">
				<path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.27 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z" />
			</svg>
		</div>
	{/if}
</div>
