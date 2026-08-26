import type { Variation } from './variations';

/**
 * The ONE variation currently active for a repertoire. If `activeVariationKey`
 * matches a real variation, that variation wins outright — even if it's
 * already solved (a player can deliberately re-drill something they've
 * solved) — UNLESS it's currently blocked (unsolved AND has nothing more to
 * teach right now under the current tier ceiling, GitHub issue #163): a
 * stale pointer to a now-paused variation must not keep re-serving the same
 * frozen board forever, so it's treated like "not found" and falls through.
 * Only when there's NO key, the key no longer matches anything, or the match
 * is blocked, does this fall back to the first UNSOLVED-and-unblocked
 * variation in sequence — or, if everything is solved or blocked, the first
 * UNSOLVED one regardless of blocked status — or, if everything is solved,
 * the very first variation overall.
 */
export function pickActiveVariation(
	variations: Variation[],
	activeVariationKey: string | null,
	solvedKeys: ReadonlySet<string>,
	blockedKeys: ReadonlySet<string> = new Set()
): Variation | null {
	if (variations.length === 0) return null;
	if (activeVariationKey) {
		const found = variations.find((v) => v.variationKey === activeVariationKey);
		if (found && (solvedKeys.has(found.variationKey) || !blockedKeys.has(found.variationKey))) return found;
	}
	return (
		variations.find((v) => !solvedKeys.has(v.variationKey) && !blockedKeys.has(v.variationKey)) ??
		variations.find((v) => !solvedKeys.has(v.variationKey)) ??
		variations[0]
	);
}

/** The variation immediately after `currentKey` in `variations`' own order, or null if it's the last one (or not found). */
export function nextVariation(variations: Variation[], currentKey: string): Variation | null {
	const index = variations.findIndex((v) => v.variationKey === currentKey);
	if (index === -1 || index + 1 >= variations.length) return null;
	return variations[index + 1];
}

/**
 * Called right after `activeVariationKey` has just been marked solved, OR
 * paused at its tier ceiling (GitHub issue #163 — see
 * server/practice-progress.ts's `applyAttemptResult`) — the next
 * UNSOLVED-and-unblocked variation in sequence after it, skipping over any
 * later variation that's ALSO already solved or ALSO currently blocked.
 * `null` means every remaining variation is solved or blocked: nothing more
 * is currently servable.
 *
 * `visited` (unchanged from before this task) is what keeps this loop from
 * hanging even in that fully-blocked case.
 *
 * Defence in depth: `nextVariation` resolves a key via `findIndex`, which
 * always lands on the FIRST entry with that key. `enumerateVariations` now
 * guarantees keys are unique, so that's exact — but if a duplicate key ever
 * reappeared upstream, two adjacent copies would make this loop hand each
 * other back forever (verified at 10,000+ iterations before the uniqueness
 * fix), spinning a serverless function until it's killed and losing the
 * attempt. `visited` makes that structurally impossible: any key reached twice
 * ends the walk instead of continuing, at worst returning `null` (treated as
 * "nothing left to advance to") rather than hanging.
 */
export function advanceIfSolved(
	activeVariationKey: string,
	variations: Variation[],
	solvedKeys: ReadonlySet<string>,
	blockedKeys: ReadonlySet<string> = new Set()
): string | null {
	const visited = new Set<string>([activeVariationKey]);
	let candidate = nextVariation(variations, activeVariationKey);
	while (candidate && (solvedKeys.has(candidate.variationKey) || blockedKeys.has(candidate.variationKey))) {
		if (visited.has(candidate.variationKey)) return null;
		visited.add(candidate.variationKey);
		candidate = nextVariation(variations, candidate.variationKey);
	}
	return candidate?.variationKey ?? null;
}

/** "M of N variations solved" — the repertoire-wide progress number, independent of which one is currently active. */
export function solvedProgress(variations: Variation[], solvedKeys: ReadonlySet<string>): { solved: number; total: number } {
	return {
		solved: variations.filter((v) => solvedKeys.has(v.variationKey)).length,
		total: variations.length
	};
}
