import type { Variation } from './variations';

/**
 * The ONE variation currently active for a repertoire. If `activeVariationKey`
 * matches a real variation, that variation wins outright — even if it's
 * already solved (a player can deliberately re-drill something they've
 * solved; see the PRD's "solved variations remain pickable" acceptance
 * criterion). Only when there's NO key, or the key no longer matches
 * anything (a repertoire edited, or a variation excluded, since it was last
 * stored — the same self-healing fallback `variation_practice_exclusions`-
 * style tables already need), does this fall back to the first UNSOLVED
 * variation in sequence — or, if everything is solved, the very first
 * variation overall (there's nothing more useful to default to).
 */
export function pickActiveVariation(
	variations: Variation[],
	activeVariationKey: string | null,
	solvedKeys: ReadonlySet<string>
): Variation | null {
	if (variations.length === 0) return null;
	if (activeVariationKey) {
		const found = variations.find((v) => v.variationKey === activeVariationKey);
		if (found) return found;
	}
	return variations.find((v) => !solvedKeys.has(v.variationKey)) ?? variations[0];
}

/** The variation immediately after `currentKey` in `variations`' own order, or null if it's the last one (or not found). */
export function nextVariation(variations: Variation[], currentKey: string): Variation | null {
	const index = variations.findIndex((v) => v.variationKey === currentKey);
	if (index === -1 || index + 1 >= variations.length) return null;
	return variations[index + 1];
}

/**
 * Called right after `activeVariationKey` has just been marked solved — the
 * next UNSOLVED variation in sequence after it, skipping over any later
 * variation that's ALSO already solved (e.g. a player solved it earlier via
 * manual re-drill, out of order). `null` means every remaining variation is
 * already solved: the whole repertoire is done.
 */
export function advanceIfSolved(
	activeVariationKey: string,
	variations: Variation[],
	solvedKeys: ReadonlySet<string>
): string | null {
	let candidate = nextVariation(variations, activeVariationKey);
	while (candidate && solvedKeys.has(candidate.variationKey)) {
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
