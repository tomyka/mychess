<script lang="ts">
	import { Chessground } from 'chessground';
	import type { Api } from 'chessground/api';
	import type { Color, Key } from 'chessground/types';
	import type { DrawShape } from 'chessground/draw';
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

	// How long a wrong guess holds the piece on the attempted square (with the
	// red X over it) before snapping back — long enough to see what was
	// tried, mirroring the correct-move hold in the parent's handleMove.
	const WRONG_MOVE_HOLD_MS = 500;

	let cg: Api;
	let moveFeedback = $state<MoveFeedback>(null);
	let revertTimeout: ReturnType<typeof setTimeout> | undefined;

	// Tracks the last `fen` we actually repositioned the board to, so
	// unrelated reactive prop changes don't stomp on a guess already
	// visually applied to the board.
	// svelte-ignore state_referenced_locally -- intentional one-time snapshot for manual tracking, not a live binding
	let lastAppliedFen = fen;

	// The square's own top-left corner, for an overlay sized to the whole
	// square — used to anchor the hint ring into one of that square's own
	// corners without straddling into a neighboring square.
	function squareRect(square: Key, boardOrientation: Color) {
		const file = square.charCodeAt(0) - 97;
		const rank = Number(square[1]);
		const col = boardOrientation === 'white' ? file : 7 - file;
		const row = boardOrientation === 'white' ? 8 - rank : rank - 1;
		return { left: `${col * 12.5}%`, top: `${row * 12.5}%` };
	}

	// Draws the move-feedback badge as a chessground shape (same mechanism
	// lichess uses for its own puzzle feedback) instead of a hand-positioned
	// div — chessground owns the square's coordinate math, so this can't
	// drift into a corner shared with another square or survive a resize.
	// Coordinates are in the shape's own 0–100 square-local space.
	function feedbackSvg(kind: 'check' | 'cross'): string {
		const fill = kind === 'check' ? '#22ac38' : '#df5353';
		const glyph =
			kind === 'check'
				? 'M59 30L68 39L87 17'
				: 'M61 17L83 39M83 17L61 39';
		return `
			<defs>
				<filter id="fb-shadow" x="-60%" y="-60%" width="220%" height="220%">
					<feDropShadow dx="3" dy="4" stdDeviation="4" flood-opacity="0.45" />
				</filter>
			</defs>
			<g filter="url(#fb-shadow)">
				<circle cx="72" cy="28" r="25" fill="${fill}" stroke="white" stroke-width="5" />
			</g>
			<path d="${glyph}" fill="none" stroke="white" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />
		`;
	}

	function feedbackShapes(): DrawShape[] {
		if (!moveFeedback) return [];
		return [{ orig: moveFeedback.square, customSvg: { html: feedbackSvg(moveFeedback.kind) } }];
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
							// Keep the piece visible on the attempted square (with the X
							// over it) for a beat before snapping back — an instant
							// revert leaves the X marking a square that, by the time
							// anything paints, never visibly had a piece on it. Lock
							// input for the hold so a drag mid-revert can't fight it.
							clearTimeout(revertTimeout);
							cg.set({ movable: { color: undefined }, drawable: { autoShapes: feedbackShapes() } });
							revertTimeout = setTimeout(() => {
								// The X shouldn't linger on the now-empty square after the
								// piece has snapped back — clear it along with the position.
								moveFeedback = null;
								cg.set(buildConfig());
							}, WRONG_MOVE_HOLD_MS);
						} else if (result === true) {
							moveFeedback = { square: dest, kind: 'check' };
							cg.set({ drawable: { autoShapes: feedbackShapes() } });
						} else {
							moveFeedback = null;
							cg.set({ drawable: { autoShapes: [] } });
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
			},
			drawable: { autoShapes: feedbackShapes() }
		};
	}

	// Chessground builds its coordinate labels only once, at construction
	// (api.set() never re-runs that). So we mount via an action and remount the
	// node with {#key prefs.coordinates} below, recreating the board whenever
	// the coordinate toggle changes. Gameplay boards keep a fixed value for the
	// session, so they mount exactly once.
	function mountBoard(node: HTMLElement) {
		cg = Chessground(node, buildConfig());
		return {
			destroy: () => {
				clearTimeout(revertTimeout);
				cg?.destroy();
			}
		};
	}

	$effect(() => {
		if (!cg) return;
		const isNewPosition = fen !== lastAppliedFen;
		if (isNewPosition) {
			// Clear before building config — feedbackShapes() reads moveFeedback,
			// so this has to land before buildConfig() below, not after.
			lastAppliedFen = fen;
			moveFeedback = null;
			clearTimeout(revertTimeout);
		}
		const config = buildConfig();
		if (!isNewPosition) {
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
	<!-- moveFeedback is drawn by chessground itself via drawable.autoShapes/
	     feedbackShapes(), not a template block — see buildConfig() above. -->
</div>
