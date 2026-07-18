<script lang="ts">
	import { Chessground } from 'chessground';
	import type { Api } from 'chessground/api';
	import type { Color, Key } from 'chessground/types';
	import { Chess } from 'chess.js';
	import { DEFAULT_PREFS, animationDuration, type BoardPrefs } from '$lib/board/prefs';
	import { resolveDisplayMarker, shouldResnap, type Marker } from './chessboard-marker';

	type Props = {
		fen?: string;
		orientation?: Color;
		interactable?: boolean;
		lastMove?: [Key, Key] | undefined;
		prefs?: BoardPrefs;
		// Return `false` to snap the board back to `fen` (e.g. an incorrect guess).
		onmove?: (detail: { from: Key; to: Key; san: string }) => boolean | void;
		// Overrides the board's own star-on-correct-square logic. Leave
		// `undefined` (the default) for that original behavior; pass an
		// explicit marker (or `null`) to take full manual control — used by
		// Master mode's ★/pending/✓/✗ feedback.
		marker?: Marker;
		// Bump this to force the board to snap back to `fen`, even if `fen`
		// itself hasn't changed since the last time it was applied — used to
		// revert a move that was accepted on the board while its quality was
		// still being graded (Master mode's ✗ outcome, resolved async).
		forceRevert?: number;
	};

	let {
		fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
		orientation = 'white' as Color,
		interactable = true,
		lastMove = undefined,
		prefs = DEFAULT_PREFS,
		onmove,
		marker = undefined,
		forceRevert = 0
	}: Props = $props();

	let cg: Api;
	let correctSquare = $state<Key | null>(null);

	// Tracks the last `fen`/`forceRevert` we actually repositioned the board
	// to, so unrelated reactive prop changes don't stomp on a guess already
	// visually applied to the board.
	// svelte-ignore state_referenced_locally -- intentional one-time snapshot for manual tracking, not a live binding
	let lastAppliedFen = fen;
	// svelte-ignore state_referenced_locally -- intentional one-time snapshot for manual tracking, not a live binding
	let lastForceRevert = forceRevert;

	const displayMarker = $derived(resolveDisplayMarker(marker, correctSquare));

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
		if (shouldResnap(fen, lastAppliedFen, forceRevert, lastForceRevert)) {
			lastAppliedFen = fen;
			lastForceRevert = forceRevert;
			correctSquare = null;
		} else {
			// Same position/revert-signal as last time — a guess may have
			// already moved a piece visually; don't stomp on it, just apply
			// whatever else changed (movable color, dests, orientation...).
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
	{#if displayMarker}
		{@const pos = squareToPosition(displayMarker.square, orientation)}
		<div
			class="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center w-6 h-6 rounded-full border-2 border-white shadow-lg
				{displayMarker.kind === 'star' ? 'bg-green-500' : ''}
				{displayMarker.kind === 'pending' ? 'bg-gray-400 animate-pulse' : ''}
				{displayMarker.kind === 'check' ? 'bg-blue-500' : ''}
				{displayMarker.kind === 'cross' ? 'bg-red-500' : ''}"
			style="left: {pos.left}; top: {pos.top};"
		>
			{#if displayMarker.kind === 'star'}
				<svg viewBox="0 0 24 24" fill="white" class="w-3.5 h-3.5">
					<path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.27 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z" />
				</svg>
			{:else if displayMarker.kind === 'check'}
				<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" class="w-3.5 h-3.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
				</svg>
			{:else if displayMarker.kind === 'cross'}
				<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" class="w-3.5 h-3.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6L6 18" />
				</svg>
			{/if}
		</div>
	{/if}
</div>
