import type { EngineScore } from '$lib/engine/uci';

// 'best' is never returned by classifyMove itself (it only sees a cp-loss
// number) — it's assigned by build-analysis.ts when a zero-loss move also
// matches the engine's own top choice exactly, not just any unflagged move.
export type MoveClassification = 'best' | 'inaccuracy' | 'mistake' | 'blunder' | null;

// Large enough that any mate score dominates the cp-loss comparison against
// a non-mate score, without needing separate mate-vs-mate/mate-vs-cp branches.
const MATE_CP_EQUIVALENT = 100_000;

function toCpEquivalent(score: EngineScore): number {
	if (score.mate !== undefined) return score.mate > 0 ? MATE_CP_EQUIVALENT : -MATE_CP_EQUIVALENT;
	return score.cp ?? 0;
}

/**
 * Centipawn loss for the side that just moved, from the raw UCI-convention
 * (side-to-move-relative) engine scores at the position before and after
 * the move. `beforeRaw` is already mover-relative — the mover was the side
 * to move in the position before their own move. `afterRaw` is relative to
 * the opponent, who is to move in the resulting position, so it's negated
 * to become mover-relative before the subtraction. Floored at 0: a move
 * that does better than the engine's own top choice isn't penalized.
 */
export function cpLoss(beforeRaw: EngineScore, afterRaw: EngineScore): number {
	const beforeMoverRelative = toCpEquivalent(beforeRaw);
	const afterMoverRelative = -toCpEquivalent(afterRaw);
	return Math.max(0, beforeMoverRelative - afterMoverRelative);
}

/**
 * An intentionally simple cp-loss cutoff — same spirit as the existing
 * `evalBarWhiteFraction`'s documented "good enough for a quick sanity
 * check, not a serious analysis tool" approach, not a win%-curve model.
 */
export function classifyMove(loss: number): MoveClassification {
	if (loss >= 200) return 'blunder';
	if (loss >= 100) return 'mistake';
	if (loss >= 25) return 'inaccuracy';
	return null;
}
