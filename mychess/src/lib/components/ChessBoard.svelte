<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Chessground } from 'chessground';
	import type { Api } from 'chessground/api';
	import type { Color, Key } from 'chessground/types';
	import { Chess } from 'chess.js';

	type Props = {
		fen?: string;
		orientation?: Color;
		interactable?: boolean;
		lastMove?: [Key, Key] | undefined;
		// Return `false` to snap the board back to `fen` (e.g. an incorrect guess).
		onmove?: (detail: { from: Key; to: Key; san: string }) => boolean | void;
	};

	let {
		fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
		orientation = 'white' as Color,
		interactable = true,
		lastMove = undefined,
		onmove
	}: Props = $props();

	let el: HTMLElement;
	let cg: Api;

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
						if (keepMove === false) cg.set(buildConfig());
					}
				}
			},
			lastMove,
			highlight: { lastMove: true, check: true },
			animation: { enabled: true, duration: 150 }
		};
	}

	onMount(() => {
		cg = Chessground(el, buildConfig());
	});

	onDestroy(() => cg?.destroy());

	$effect(() => {
		if (cg) {
			cg.set(buildConfig());
		}
	});
</script>

<div bind:this={el} class="w-full aspect-square rounded-xl overflow-hidden shadow-2xl"></div>
