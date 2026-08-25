// mychess/src/lib/mastery/playback.ts
//
// Board-playback helpers shared by the three training surfaces (Learn, the
// Practice pool, and mastery runs). Extracted during epic #95's refactor pass:
// all three had their own copy of the same two functions, and a fix to one copy
// silently missing the others is exactly the drift that produces
// "works in Learn, broken in Practice" bugs.

import { Chess, type Square } from 'chess.js';
import type { VariationStep } from './variations';

/**
 * The position after `plyCount` plies of `steps` have been played — 0 being the
 * start of the line. `fallbackFen` covers a not-yet-loaded or empty path.
 */
export function positionAt(steps: readonly VariationStep[], plyCount: number, fallbackFen: string): string {
	if (plyCount <= 0) return steps[0]?.fromFen ?? fallbackFen;
	return steps[plyCount - 1]?.toFen ?? fallbackFen;
}

/**
 * Plays out every consecutive opponent ply starting at `plyIdx`, returning where
 * the board and index end up.
 *
 * The player is never asked for the opponent's reply, so these advance on their
 * own — both at the start of a line (when the opponent moves first) and after
 * each player move.
 */
export function playOpponentReplies(
	steps: readonly VariationStep[],
	plyIdx: number,
	currentFen: string
): { plyIdx: number; fen: string } {
	let idx = plyIdx;
	let fen = currentFen;
	while (steps[idx] && !steps[idx].isPlayerTurn) {
		fen = steps[idx].toFen;
		idx++;
	}
	return { plyIdx: idx, fen };
}

/**
 * How many of the PLAYER's own moves are inside the first `plyCount` plies —
 * what the move-nav row counts. The player thinks in their own moves ("I'm 3
 * moves into my line"), not in plies: a ply count silently doubles every number
 * and, worse, jumps by two per tap wherever an opponent reply auto-plays.
 */
export function playerMovesIn(steps: readonly VariationStep[], plyCount: number): number {
	let count = 0;
	for (let i = 0; i < plyCount && i < steps.length; i++) {
		if (steps[i].isPlayerTurn) count++;
	}
	return count;
}

/**
 * The correct move's origin square for the ply due now — never the
 * destination, so a hint points at a piece without giving away where it
 * should go. Null whenever there's nothing to hint at: no hint requested, the
 * player is reviewing an earlier position (the ring would land on the wrong
 * piece), no current step, or the step's own SAN doesn't parse from its FEN.
 *
 * Was two independently-written copies (Learn, Practice) of the same
 * try/catch shape — extracted here once both pages had their own drill
 * classes and this was the only remaining duplication between them.
 */
export function hintSquareFor(
	steps: readonly VariationStep[],
	plyIdx: number,
	hintRequested: boolean,
	isReviewing: boolean
): Square | null {
	if (!hintRequested || isReviewing) return null;
	const step = steps[plyIdx];
	if (!step) return null;
	try {
		return new Chess(step.fromFen).move(step.san)?.from ?? null;
	} catch {
		return null;
	}
}

/**
 * The four review-navigation actions (⏮◀▶⏭), bound to a page's own
 * `manualReviewIdx` state and live ply index. `get`/`set` are closures over
 * the page's `$state` rather than a value handed in once, since the whole
 * point is to read/write the CURRENT reactive value on each call.
 *
 * `reviewIdx` is `get() ?? liveIdx()` — the caller already computes this as
 * its own derived value; passed in rather than recomputed here so there is
 * only ever one definition of what "the reviewed ply" means on a given page.
 */
export function makeReviewNav(nav: { get: () => number | null; set: (v: number | null) => void; reviewIdx: () => number; liveIdx: () => number }) {
	return {
		reviewToStart: () => nav.set(0),
		reviewBack: () => nav.set(Math.max(0, nav.reviewIdx() - 1)),
		reviewForward: () => {
			const live = nav.liveIdx();
			const next = Math.min(live, nav.reviewIdx() + 1);
			nav.set(next >= live ? null : next);
		},
		reviewToLive: () => nav.set(null)
	};
}

/**
 * Left/Right steps one ply of review at a time; Up/Down jumps to the
 * start/live-end. `isEnabled` is the one thing that genuinely differs between
 * Learn and Practice (Learn also gates on its variation picker being closed),
 * so it stays the caller's own predicate rather than a shared guard.
 */
export function makeReviewKeyHandler(nav: {
	reviewToStart: () => void;
	reviewBack: () => void;
	reviewForward: () => void;
	reviewToLive: () => void;
	isEnabled: () => boolean;
}): (e: KeyboardEvent) => void {
	return (e: KeyboardEvent) => {
		if (!nav.isEnabled()) return;
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			nav.reviewBack();
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			nav.reviewForward();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			nav.reviewToStart();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			nav.reviewToLive();
		}
	};
}
