// mychess/src/lib/mastery/practiceQueue.ts
//
// Ordering for the Practice pool: which learned variation to serve next.
// Story #97 of epic #95; spec at
// ../../../../docs/superpowers/specs/2026-08-20-learn-practice-mvp-design.md §4
//
// Pure. Takes pre-aggregated attempt stats rather than a Supabase client, so
// the ordering is unit-testable and the IO stays in src/lib/server/.

import type { VariationStep } from './variations';

/** One move's recorded history, aggregated from `move_attempts` rows. */
export type MoveAttemptStat = {
	moveId: string;
	attempts: number;
	wrong: number;
	/** ISO timestamp of the most recent attempt, or null if never attempted. */
	lastAttemptAt: string | null;
};

export type PracticeCandidate = {
	variationKey: string;
	path: VariationStep[];
};

/**
 * Share of this variation's player-turn attempts that were wrong, or null when
 * the player has never been asked any of its moves.
 *
 * Weighted by attempts rather than averaged per move on purpose: a move failed
 * nine times out of ten and a move played once correctly are not two data
 * points of equal worth, and a per-move mean would halve the first one's
 * signal. Opponent-turn plies are excluded — the player never answers those, so
 * any rows against them (autoplay, replays) say nothing about their knowledge.
 */
export function variationErrorRate(
	path: VariationStep[],
	statsByMoveId: ReadonlyMap<string, MoveAttemptStat>
): number | null {
	let attempts = 0;
	let wrong = 0;
	for (const step of path) {
		if (!step.isPlayerTurn) continue;
		const stat = statsByMoveId.get(step.moveId);
		if (!stat) continue;
		attempts += stat.attempts;
		wrong += stat.wrong;
	}
	if (attempts === 0) return null;
	return wrong / attempts;
}

/**
 * The variation's own staleness: the most recent attempt across its
 * player-turn moves. Null means never practised.
 *
 * Most recent, not oldest — a variation half of whose moves were played
 * yesterday has been practised recently, however old the rest of its history
 * is, and treating it as stale would keep re-serving it ahead of lines the
 * player genuinely hasn't seen in months.
 */
function lastPracticedAt(
	path: VariationStep[],
	statsByMoveId: ReadonlyMap<string, MoveAttemptStat>
): number | null {
	let newest: number | null = null;
	for (const step of path) {
		if (!step.isPlayerTurn) continue;
		const at = statsByMoveId.get(step.moveId)?.lastAttemptAt;
		if (!at) continue;
		const ms = new Date(at).getTime();
		if (newest == null || ms > newest) newest = ms;
	}
	return newest;
}

/**
 * Priority tier, lower sorts first.
 *
 * A line actively being failed is a known problem. A line never tested is an
 * unknown. A line repeatedly played correctly is neither, and serving it ahead
 * of the other two is the exact "keeps drilling what I already nail" failure
 * the weakest-first ordering exists to avoid.
 */
function tier(errorRate: number | null): 0 | 1 | 2 {
	if (errorRate == null) return 1; // never practised
	return errorRate > 0 ? 0 : 2; // failing : clean
}

/**
 * Orders the learned pool weakest-first and returns the variation keys.
 *
 * Sort is stable and the input array is never mutated, so an equal-priority
 * group keeps the repertoire's own order — which is also the whole cold-start
 * behaviour: with no attempt history every variation lands in the same tier
 * with no staleness, and the queue is simply repertoire order rather than
 * something that looks arbitrary on a player's first Practice session.
 */
export function orderPracticeQueue(
	candidates: readonly PracticeCandidate[],
	statsByMoveId: ReadonlyMap<string, MoveAttemptStat>
): string[] {
	const decorated = candidates.map((candidate, index) => {
		const errorRate = variationErrorRate(candidate.path, statsByMoveId);
		return {
			variationKey: candidate.variationKey,
			index,
			tier: tier(errorRate),
			errorRate: errorRate ?? 0,
			lastPracticed: lastPracticedAt(candidate.path, statsByMoveId)
		};
	});

	decorated.sort((a, b) => {
		if (a.tier !== b.tier) return a.tier - b.tier;
		if (a.errorRate !== b.errorRate) return b.errorRate - a.errorRate;
		// Never-practised sorts ahead of anything with a timestamp; among timed
		// entries the older one goes first.
		if (a.lastPracticed !== b.lastPracticed) {
			if (a.lastPracticed == null) return -1;
			if (b.lastPracticed == null) return 1;
			return a.lastPracticed - b.lastPracticed;
		}
		return a.index - b.index;
	});

	return decorated.map((d) => d.variationKey);
}
