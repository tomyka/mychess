import type { MoveQuality } from '$lib/engine/classify';

/** The four things Master mode can show for a played move: the queued
 * card's book move or any of its book siblings (`star`), an off-book move
 * Stockfish still rates as fine/inaccuracy (`check`), an off-book move
 * Stockfish rates as a real mistake/blunder (`cross`), or an off-book move
 * that couldn't be graded at all because the engine was unavailable
 * (`unknown` — shown with no icon, same as today's plain wrong-move
 * handling). */
export type FeedbackOutcome = 'star' | 'check' | 'cross' | 'unknown';

/** Maps an off-book move's Stockfish swing classification to its icon:
 * `fine`/`inaccuracy` are close enough to still show a ✓, `mistake`/`blunder`
 * are real errors and show a ✗. */
export function offBookOutcome(quality: MoveQuality): 'check' | 'cross' {
	return quality === 'fine' || quality === 'inaccuracy' ? 'check' : 'cross';
}

/** Only a real mistake (✗) forces the player to retry the same card — an
 * off-book move that's still objectively fine, or one the engine couldn't
 * classify, simply moves the queue on. */
export function outcomeForcesRetry(outcome: FeedbackOutcome): boolean {
	return outcome === 'cross';
}

/** The chain counter after this outcome: a book move extends it, anything
 * else resets it to zero — any non-book move breaks the chain (matching
 * today's Drill behavior), just without ending the whole session over it. */
export function nextChain(chain: number, outcome: FeedbackOutcome): number {
	return outcome === 'star' ? chain + 1 : 0;
}
