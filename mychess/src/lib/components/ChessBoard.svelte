<script lang="ts">
	import { Chessground } from 'chessground';
	import type { Api } from 'chessground/api';
	import type { Color, Key } from 'chessground/types';
	import type { DrawShape } from 'chessground/draw';
	import { Chess } from 'chess.js';
	import { DEFAULT_PREFS, animationDuration, type BoardPrefs } from '$lib/board/prefs';
	import { m } from '$lib/paraglide/messages';

	type MoveFeedback = { square: Key; kind: 'check' | 'cross' | 'star' } | null;

	type Props = {
		fen?: string;
		orientation?: Color;
		interactable?: boolean;
		lastMove?: [Key, Key] | undefined;
		prefs?: BoardPrefs;
		// Return `true` to show a green check on the destination square,
		// `'final'` to show a gold star there instead (the last move of the
		// whole attempt — the parent auto-advances to the next task rather
		// than waiting for a confirmation click), `false` to show a red cross
		// there and snap the board back to `fen` (an incorrect guess). Any
		// other return value accepts the move silently.
		onmove?: (detail: { from: Key; to: Key; san: string }) => boolean | 'final' | void;
		// Highlights this square (e.g. a hint's "move this piece" square) with
		// a pulsing amber ring and a lightbulb badge — never the destination,
		// so it points at a piece without giving away where it should go.
		hintSquare?: Key | null;
		/**
		 * A short mode note to float on the board's top edge — "exploring",
		 * "now play it from memory" and the like (GitHub issue #217).
		 *
		 * An overlay rather than a row, so it cannot move the board: mobile Learn
		 * drops `PracticeStatusStrip` because the strip mostly restated feedback
		 * this component already draws, and the states that DO need words must
		 * not cost the 48px the strip reserved to stay shift-free (#113).
		 * `lg:hidden` on the region below keeps it to mobile — desktop still has
		 * the strip, and two live regions would announce the same thing twice.
		 */
		note?: string | null;
		// The correct move to reveal during a teaching pass — a native
		// chessground arrow (both orig and dest set), distinct from
		// hintSquare's origin-only ring. Cleared the instant the move lands
		// (see feedbackShapes(), which takes over the drawable slot then).
		arrowMove?: { from: Key; to: Key } | null;
		// Default sizing (`w-[min(90vh,100%)]`) assumes nothing else on the
		// page competes for vertical space — fine for a page that's mostly
		// just the board, wrong wherever surrounding chrome (headers, nav
		// rows, sidebars) can add up to more than one viewport. Set this when
		// the caller has already given this component's parent a real,
		// flex-resolved height budget (e.g. a `flex-1 min-h-0` wrapper inside
		// a viewport-height-constrained column) — the board then fills that
		// parent's height (capped by its width) instead of guessing from the
		// raw viewport. Defaults false so every other existing caller (drill,
		// time-trial, settings preview) is unaffected.
		//
		// The immediate parent MUST also be a CSS size container (Tailwind's
		// `[container-type:size]`) for this to size correctly — the board's
		// width is driven by a `cqh` (container-query height) unit, not a
		// plain `h-full`. Mixing an explicit `height: 100%` with a
		// `max-width` clamp on the aspect-ratio'd width (the previous
		// approach) only re-derives the axis that was already `auto`: if the
		// available WIDTH ends up the tighter constraint, `max-width` clamps
		// it down but `height: 100%` stays put, producing a tall, non-square
		// board instead of a smaller square one (confirmed live on
		// mychess.lt, Aug 2026 — a narrower/taller browser window than the
		// component had been tested at). Container-query units don't have
		// this asymmetry: only `width` is ever explicitly set, so
		// `aspect-square` always derives `height` fresh from whichever width
		// actually won.
		containerFit?: boolean;
		// The board's own actual rendered width in px, once mounted — bind to
		// this when a sibling element (e.g. a row of controls below the
		// board) needs to match the board's width exactly. Needed because
		// that width isn't knowable from CSS alone when containerFit is
		// active: it comes out of an aspect-ratio-vs-available-height
		// computation, not a fixed value or simple percentage.
		boxWidth?: number;
	};

	let {
		fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
		orientation = 'white' as Color,
		interactable = true,
		lastMove = undefined,
		prefs = DEFAULT_PREFS,
		onmove,
		hintSquare = null,
		arrowMove = null,
		note = null,
		containerFit = false,
		boxWidth = $bindable(0)
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
	// Intentional one-time snapshot for manual tracking, not a live binding.
	// svelte-ignore state_referenced_locally
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
	// Coordinates are in the shape's own 0–100 square-local space, and are
	// allowed to overflow past it — like lichess's own badge (composeGlyph
	// resolves to center (91, 8) r=20), deliberately poking past the square's
	// top-right edge so it clears the piece rather than sitting on it.
	function feedbackSvg(kind: 'check' | 'cross' | 'star'): string {
		const shadowDefs = `
			<defs>
				<filter id="fb-shadow" x="-60%" y="-60%" width="220%" height="220%">
					<feDropShadow dx="2.2" dy="2.8" stdDeviation="2.8" flood-opacity="0.45" />
				</filter>
			</defs>
		`;
		if (kind === 'star') {
			return `
				${shadowDefs}
				<g filter="url(#fb-shadow)">
					<circle cx="88" cy="12" r="17.6" fill="#6FCF73" />
				</g>
				<path
					d="M88,-1.5 L91.18,7.64 L100.84,7.83 L93.13,13.67 L95.94,22.92 L88,17.4 L80.07,22.92 L82.87,13.67 L75.16,7.83 L84.82,7.64 Z"
					fill="white"
				/>
			`;
		}
		const fill = kind === 'check' ? '#6FCF73' : '#F28B82';
		const glyph =
			kind === 'check'
				? 'M78.9 13.4L85.1 19.7L98.6 4.3'
				: 'M80.3 4.3L95.7 19.7M95.7 4.3L80.3 19.7';
		return `
			${shadowDefs}
			<g filter="url(#fb-shadow)">
				<circle cx="88" cy="12" r="17.6" fill="${fill}" />
			</g>
			<path d="${glyph}" fill="none" stroke="white" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" />
		`;
	}

	// The teaching-pass arrow, drawn via chessground's own native shape
	// rendering (orig+dest, same brush the board's own right-click drawing
	// tool already uses) — not a custom SVG like feedbackShapes() below.
	function arrowShapes(): DrawShape[] {
		if (!arrowMove) return [];
		return [{ orig: arrowMove.from, dest: arrowMove.to, brush: 'yellow' }];
	}

	function feedbackShapes(): DrawShape[] {
		if (!moveFeedback) return [];
		return [{ orig: moveFeedback.square, customSvg: { html: feedbackSvg(moveFeedback.kind) } }];
	}

	function buildConfig() {
		const chess = new Chess(fen);
		// Built fresh here and handed straight to chessground's own config —
		// never read by Svelte's reactivity system, so no need for SvelteMap.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
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
						} else if (result === true || result === 'final') {
							moveFeedback = { square: dest, kind: result === 'final' ? 'star' : 'check' };
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
			drawable: { autoShapes: [...arrowShapes(), ...feedbackShapes()] }
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
	class="relative aspect-square mx-auto rounded-xl overflow-hidden shadow-2xl board-theme-{prefs.theme} pieces-{prefs.pieceSet} {containerFit
		? 'w-[min(90vh,100%)] lg:w-[min(100cqh,100%)]'
		: 'w-[min(90vh,100%)]'}"
	bind:clientWidth={boxWidth}
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
			<span class="text-base leading-none drop-shadow" aria-label={m.chessboard_hint_move_this_piece()}>💡</span>
		</div>
	{/if}
	<!-- moveFeedback is drawn by chessground itself via drawable.autoShapes/
	     feedbackShapes(), not a template block — see buildConfig() above. -->

	<!-- The region itself is permanent and only its contents change: mounting a
	     live region at the same moment its text appears is the classic way to
	     get no announcement at all. Costs nothing while empty — it is absolutely
	     positioned, so it is outside the layout either way. -->
	<div
		role="status"
		class="lg:hidden absolute inset-x-0 top-0 flex justify-center p-2 pointer-events-none"
	>
		{#if note}
			<span
				class="rounded-full border border-amber-500/80 bg-amber-100/95 px-2.5 py-1 text-xs font-semibold text-amber-800 shadow-md dark:border-amber-400/60 dark:bg-amber-950/95 dark:text-amber-200"
			>
				{note}
			</span>
		{/if}
	</div>
</div>
