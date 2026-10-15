// mychess/src/lib/mastery/boardNote.ts
import type { PracticeStripState } from '$lib/components/PracticeStatusStrip.svelte';
import { m } from '$lib/paraglide/messages';

/**
 * The copy for the pill that floats on the board's top edge on mobile
 * (GitHub issue #217), or null when the board itself already says it.
 *
 * Mobile Learn drops `PracticeStatusStrip` entirely: the board already draws
 * every bit of move feedback the strip was restating — `ChessBoard` renders
 * `moveFeedback` as chessground autoShapes, a red cross on the square a
 * rejected move landed on and a check/star badge on one that stuck — so
 * 'wrong' and 'correct' were a 48px card repeating a badge already sitting on
 * the square, and 'blind' was captioning an interactive board on the player's
 * own turn.
 *
 * What survives is the three states that say something the board CANNOT, and
 * each one is load-bearing:
 *
 *   - 'exploring' — the board is off-book and quietly accepting wrong moves,
 *     which reads as broken without being told (#125).
 *   - 'retest-cue' — the pass just ended and the next one is blind; nothing on
 *     the board marks the boundary.
 *   - 'autoplay'  — the pieces are moving on their own.
 *
 * Exhaustive over the union on purpose: a new strip state has to come here and
 * be decided, rather than silently defaulting to unannounced.
 */
const NOTES: Record<PracticeStripState, () => string | null> = {
	silent: () => null,
	blind: () => null,
	wrong: () => null,
	correct: () => null,
	autoplay: () => m.practice_status_autoplay(),
	'retest-cue': () => m.practice_status_retest_cue(),
	// Practice-only, and that page keeps its strip — listed to satisfy the
	// exhaustive record, never reached from Learn.
	demoted: () => null,
	exploring: () => m.practice_status_exploring()
};

/** Called rather than read from a map of strings, so `m.*()` resolves against
 * the locale in force at render time rather than at module load. */
export function boardNoteFor(state: PracticeStripState): string | null {
	return NOTES[state]();
}
