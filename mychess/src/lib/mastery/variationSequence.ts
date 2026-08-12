import type { Variation } from './variations';
import { buildQueue, effectiveLevelCap, type LevelProgressRow } from './levelProgress';

/**
 * The ONE variation level_progress.level/queue currently track. Falls back
 * to the first variation in `variations`' own order when `activeVariationKey`
 * is null (a fresh row) or no longer matches anything (a repertoire edited,
 * or a variation excluded, since the key was last stored) — the same
 * self-healing fallback `reconcileQueue` already applies to a stale queue.
 */
export function pickActiveVariation(variations: Variation[], activeVariationKey: string | null): Variation | null {
	if (variations.length === 0) return null;
	const found = activeVariationKey ? variations.find((v) => v.variationKey === activeVariationKey) : undefined;
	return found ?? variations[0];
}

/** The variation immediately after `currentKey` in `variations`' own order, or null if it's the last one (or not found). */
export function nextVariation(variations: Variation[], currentKey: string): Variation | null {
	const index = variations.findIndex((v) => v.variationKey === currentKey);
	if (index === -1 || index + 1 >= variations.length) return null;
	return variations[index + 1];
}

/**
 * Called after every mutation that might have just cleared the active
 * variation's final level (`resolveAttempt`, `syncLevelProgress`,
 * `resolvePreviousLevelMistake` — the last of which only ever demotes, so
 * this is a harmless pass-through for it, applied uniformly rather than
 * conditionally at each call site). If the active variation isn't mastered
 * yet, just stamps `activeVariationKey` onto the row (nothing else about it
 * sets that field). If it IS mastered (`row.level` past its own level cap)
 * and there's a next variation in sequence, resets to a fresh Level 1 run
 * for that one. If it was the LAST variation, the row is left as-is —
 * `row.level` staying past the (now whole-repertoire) cap IS the "fully
 * mastered" signal `variationSequenceProgress` reads.
 */
export function advanceVariationIfMastered(
	row: LevelProgressRow,
	variations: Variation[],
	maxLevel: number,
	chunkSize: number,
	random: () => number = Math.random
): LevelProgressRow {
	const active = pickActiveVariation(variations, row.activeVariationKey ?? null);
	if (!active) return row;

	const cap = effectiveLevelCap([active], maxLevel, chunkSize);
	if (row.level <= cap) return row.activeVariationKey === active.variationKey ? row : { ...row, activeVariationKey: active.variationKey };

	const next = nextVariation(variations, active.variationKey);
	if (!next) return row.activeVariationKey === active.variationKey ? row : { ...row, activeVariationKey: active.variationKey };

	return {
		level: 1,
		prevLevelMistakes: 0,
		queue: buildQueue([next], 1, chunkSize, random),
		activeVariationKey: next.variationKey
	};
}

/**
 * How far through the repertoire's own variation sequence a player has
 * gotten — "M of N variations mastered" — independent of `repertoireProgress`
 * (which, once scoped to `[activeVariation]` at the call site, describes the
 * active variation's OWN level/queue detail, not this repertoire-wide count).
 */
export function variationSequenceProgress(
	variations: Variation[],
	row: { activeVariationKey?: string | null; level: number } | null,
	maxLevel: number,
	chunkSize: number
): { variationsMastered: number; totalVariationsInSequence: number } {
	if (variations.length === 0) return { variationsMastered: 0, totalVariationsInSequence: 0 };
	if (!row) return { variationsMastered: 0, totalVariationsInSequence: variations.length };

	const active = pickActiveVariation(variations, row.activeVariationKey ?? null);
	if (!active) return { variationsMastered: 0, totalVariationsInSequence: variations.length };
	const activeIndex = variations.findIndex((v) => v.variationKey === active.variationKey);

	const cap = effectiveLevelCap([active], maxLevel, chunkSize);
	const activeMastered = row.level > cap;
	return {
		variationsMastered: activeMastered ? activeIndex + 1 : activeIndex,
		totalVariationsInSequence: variations.length
	};
}
