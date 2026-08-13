// mychess/src/lib/mastery/practice.ts
import type { Variation, VariationStep } from './variations';
import { pickActiveVariation, solvedProgress } from './variationSequence';

export type PracticeView = {
	attempt: { path: VariationStep[]; variationKey: string } | null;
	solved: number;
	total: number;
	allSolved: boolean;
};

/**
 * Builds the full client-facing practice view: which variation to quiz next
 * (its ENTIRE path, player and opponent moves alike — there is no chunking
 * or auto-play split anymore, every attempt is the complete variation) plus
 * the repertoire-wide solved/total count. `activeVariationKey` is whatever
 * is currently persisted (or `null` if none yet); `solvedKeys` is this
 * player's full solved set for this repertoire.
 */
export function buildPracticeView(
	variations: Variation[],
	activeVariationKey: string | null,
	solvedKeys: ReadonlySet<string>,
	forceAttempt: boolean = false
): PracticeView {
	const { solved, total } = solvedProgress(variations, solvedKeys);
	const active = pickActiveVariation(variations, activeVariationKey, solvedKeys);

	// allSolved means the REPERTOIRE is done, not just that the (possibly
	// manually re-picked) active variation happens to be solved — those are
	// different things once a player can pick an already-solved variation.
	// An empty repertoire (total === 0) counts as vacuously all-solved.
	const allSolved = solved === total;

	// The !allSolved gate suppresses the attempt once the repertoire is done,
	// so the trophy screen shows instead of auto-serving variations[0] forever.
	// forceAttempt bypasses that gate for a deliberate manual re-pick (the
	// picker), where the player explicitly asked to re-drill a variation even
	// though everything is already solved.
	const attempt =
		active && (forceAttempt || !allSolved) ? { path: active.path, variationKey: active.variationKey } : null;

	return { attempt, solved, total, allSolved };
}
