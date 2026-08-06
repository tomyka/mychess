<script lang="ts">
	import { Chessground } from 'chessground';
	import type { Api } from 'chessground/api';
	import type { Color, Key } from 'chessground/types';
	import { Chess } from 'chess.js';
	import { DEFAULT_PREFS, animationDuration, type BoardPrefs } from '$lib/board/prefs';

	type MoveFeedback = { square: Key; kind: 'check' | 'cross' } | null;

	type Props = {
		fen?: string;
		orientation?: Color;
		interactable?: boolean;
		lastMove?: [Key, Key] | undefined;
		prefs?: BoardPrefs;
		// Return `true` to show a green check on the destination square, `false`
		// to show a red cross there and snap the board back to `fen` (an
		// incorrect guess). Any other return value accepts the move silently.
		onmove?: (detail: { from: Key; to: Key; san: string }) => boolean | void;
		// Highlights this square (e.g. a hint's "move this piece" square) with
		// a pulsing amber ring and a lightbulb badge — never the destination,
		// so it points at a piece without giving away where it should go.
		hintSquare?: Key | null;
	};

	let {
		fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
		orientation = 'white' as Color,
		interactable = true,
		lastMove = undefined,
		prefs = DEFAULT_PREFS,
		onmove,
		hintSquare = null
	}: Props = $props();

	let cg: Api;
	let moveFeedback = $state<MoveFeedback>(null);

	// Tracks the last `fen` we actually repositioned the board to, so
	// unrelated reactive prop changes don't stomp on a guess already
	// visually applied to the board.
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

	// The square's own center point, for a badge meant to mark the square
	// itself (unlike squareToPosition's shared-corner placement above, which
	// straddles four squares and reads as floating between them).
	function squareCenter(square: Key, boardOrientation: Color) {
		const file = square.charCodeAt(0) - 97;
		const rank = Number(square[1]);
		const col = boardOrientation === 'white' ? file : 7 - file;
		const row = boardOrientation === 'white' ? 8 - rank : rank - 1;
		return { left: `${(col + 0.5) * 12.5}%`, top: `${(row + 0.5) * 12.5}%` };
	}

	// The square's own top-left corner, for an overlay sized to the whole
	// square (unlike squareToPosition's corner-badge placement above).
	function squareRect(square: Key, boardOrientation: Color) {
		const file = square.charCodeAt(0) - 97;
		const rank = Number(square[1]);
		const col = boardOrientation === 'white' ? file : 7 - file;
		const row = boardOrientation === 'white' ? 8 - rank : rank - 1;
		return { left: `${col * 12.5}%`, top: `${row * 12.5}%` };
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
						const result = onmove({ from: orig, to: dest, san: move.san });
						if (result === false) {
							moveFeedback = { square: dest, kind: 'cross' };
							cg.set(buildConfig());
						} else if (result === true) {
							moveFeedback = { square: dest, kind: 'check' };
						} else {
							moveFeedback = null;
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

	// Chessground builds its coordinate labels only once, at construction
	// (api.set() never re-runs that). So we mount via an action and remount the
	// node with {#key prefs.coordinates} below, recreating the board whenever
	// the coordinate toggle changes. Gameplay boards keep a fixed value for the
	// session, so they mount exactly once.
	function mountBoard(node: HTMLElement) {
		cg = Chessground(node, buildConfig());
		return { destroy: () => cg?.destroy() };
	}

	$effect(() => {
		if (!cg) return;
		const config = buildConfig();
		if (fen !== lastAppliedFen) {
			lastAppliedFen = fen;
			moveFeedback = null;
		} else {
			// Same position as last time — a guess may have already moved a
			// piece visually; don't stomp on it, just apply whatever else
			// changed (movable color, dests, orientation...).
			delete (config as { fen?: string }).fen;
		}
		cg.set(config);
	});
</script>

<div
	class="relative w-[min(90vh,100%)] aspect-square mx-auto rounded-xl overflow-hidden shadow-2xl board-theme-{prefs.theme} pieces-{prefs.pieceSet}"
>
	{#key prefs.coordinates}
		<div use:mountBoard class="w-full h-full"></div>
	{/key}
	{#if hintSquare}
		{@const hint = squareRect(hintSquare, orientation)}
		<div
			class="absolute w-[12.5%] h-[12.5%] pointer-events-none rounded-md ring-4 ring-inset ring-amber-400 animate-pulse flex items-start justify-end p-0.5"
			style="left: {hint.left}; top: {hint.top};"
		>
			<span class="text-base leading-none drop-shadow" aria-label="Hint: move this piece">💡</span>
		</div>
	{/if}
	{#if moveFeedback}
		{@const pos = squareCenter(moveFeedback.square, orientation)}
		<div
			class="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center w-6 h-6 rounded-full border-2 border-white shadow-lg {moveFeedback.kind === 'check' ? 'bg-green-500' : 'bg-red-500'}"
			style="left: {pos.left}; top: {pos.top};"
		>
			{#if moveFeedback.kind === 'check'}
				<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" class="w-3.5 h-3.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
				</svg>
			{:else}
				<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" class="w-3.5 h-3.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6L6 18" />
				</svg>
			{/if}
		</div>
	{/if}
</div>
