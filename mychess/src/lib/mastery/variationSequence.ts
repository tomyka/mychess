import type { Variation } from './variations';

/**
 * The ONE variation currently active for a repertoire.
 *
 * `servableVariationKeys` is the ordered candidate list from
 * `deriveLearnPlan` — one representative per still-unlearned learn unit, in
 * chapter order (see `mastery/learnUnits.ts`). It is the whole gate: a
 * variation absent from it has nothing left to teach right now, so there is
 * no separate "blocked" concept to keep in sync any more.
 *
 * A stored `activeVariationKey` wins outright while it is still servable, or
 * when it points at an already-solved variation (a deliberate re-drill picked
 * from the picker). Otherwise it is treated as stale and falls through — a
 * pointer at a variation whose unit has since been learned must not keep
 * re-serving the same finished board.
 *
 * The fallbacks, in order: the first servable key in the plan's own order;
 * then, if nothing is servable at all, the first unsolved variation (so Learn
 * shows *something* rather than a dead end); then the very first variation,
 * for a fully-finished repertoire.
 */
export function pickActiveVariation(
	variations: Variation[],
	activeVariationKey: string | null,
	solvedKeys: ReadonlySet<string>,
	// Optional rather than defaulted to "every key": omitting it must mean "no
	// gating at all", which is NOT the same as "everything is servable". With a
	// default of every key, the plan-ordered walk below would return
	// `variations[0]` and quietly override the first-unsolved fallback that a
	// caller without a plan is relying on.
	servableVariationKeys?: readonly string[]
): Variation | null {
	if (variations.length === 0) return null;
	const servable = servableVariationKeys ? new Set(servableVariationKeys) : null;
	if (activeVariationKey) {
		const found = variations.find((v) => v.variationKey === activeVariationKey);
		if (found && (solvedKeys.has(found.variationKey) || servable === null || servable.has(found.variationKey))) return found;
	}
	// Ordered by the PLAN, not by `variations`: the plan walks chapter by
	// chapter, which is the order the player is actually working through.
	// Indexed rather than scanned per key — a large repertoire can have
	// hundreds of servable keys, and a `find` per key would make this
	// quadratic on the Learn page's hottest load path.
	if (servableVariationKeys) {
		const byKey = new Map(variations.map((v) => [v.variationKey, v]));
		for (const key of servableVariationKeys) {
			const found = byKey.get(key);
			if (found) return found;
		}
	}
	return variations.find((v) => !solvedKeys.has(v.variationKey)) ?? variations[0];
}

/** "M of N variations solved" — the repertoire-wide progress number, independent of which one is currently active. */
export function solvedProgress(variations: Variation[], solvedKeys: ReadonlySet<string>): { solved: number; total: number } {
	return {
		solved: variations.filter((v) => solvedKeys.has(v.variationKey)).length,
		total: variations.length
	};
}
