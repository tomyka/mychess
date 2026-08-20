// mychess/src/lib/mastery/playback.ts
//
// Board-playback helpers shared by the three training surfaces (Learn, the
// Practice pool, and mastery runs). Extracted during epic #95's refactor pass:
// all three had their own copy of the same two functions, and a fix to one copy
// silently missing the others is exactly the drift that produces
// "works in Learn, broken in Practice" bugs.

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
