// mychess/src/lib/mastery/learning.ts
//
// Story #104 of epic #95 originally required two clean passes >=20h apart
// before a variation counted as learned. That gate was removed: a variation
// is learned the moment ONE clean pass gets through it, and the safety net
// against a lucky/lucky-guess pass is `demoteVariation` (src/lib/server/
// practice-pool.ts) — a later mistake or hint during Practice sends the
// variation straight back to Learn. `splitQueues` is the one piece of that
// story that's still load-bearing: it's the single place that decides
// learn-vs-practice queue membership, so both surfaces can't drift apart.

/**
 * Splits a repertoire's variations into the two queues.
 *
 * This function is the epic's central invariant made structural rather than
 * hoped for: every variation lands in exactly one of `learn` / `practice`, or
 * is dropped as excluded. Two independent filters that each decided membership
 * on their own could drift into serving one variation on both surfaces at once
 * — the thing #95 exists to prevent — so both surfaces read the split from
 * here instead.
 *
 * `learn` keeps the incoming order (the repertoire's own sequence, which the
 * teaching progression depends on). `practice` is handed to
 * `orderPracticeQueue` afterwards for weakest-first ordering.
 */
export function splitQueues<T extends { variationKey: string }>(
	variations: readonly T[],
	learnedKeys: ReadonlySet<string>,
	excludedKeys: ReadonlySet<string> = new Set()
): { learn: T[]; practice: T[] } {
	const learn: T[] = [];
	const practice: T[] = [];
	for (const variation of variations) {
		if (excludedKeys.has(variation.variationKey)) continue;
		(learnedKeys.has(variation.variationKey) ? practice : learn).push(variation);
	}
	return { learn, practice };
}
