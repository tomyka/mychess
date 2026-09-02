//
// Repertoire knowledge levels: a per-chapter Bronze/Silver/Gold/Platinum
// ladder, tiered by `playerMoveCount` (from `enumerateVariations`) and gated
// on how far each variation has actually been TAUGHT (GitHub issue #181) —
// not merely on `variation_solved` membership. A tier is satisfied once
// every variation in scope has reached that tier's move cap: a short
// variation once genuinely solved, a longer one once paused there
// (`hasReachedCeiling`, `mastery/teaching.ts`). This single redefinition
// backs BOTH this module's own medal derivation AND Learn's teaching
// ceiling (`teachingCeilingMoveCount`) — one function, one meaning,
// everywhere. See docs/superpowers/specs/2026-09-02-ceiling-reached-progress-design.md.
//
// Retires the `chapter_mastery`/mastery-run mechanic — see
// docs/superpowers/specs/2026-08-26-repertoire-knowledge-levels-design.md.
//
// DERIVED, never stored — same convention as `repertoireStatus.ts`: a coach
// edit changes the inputs (`playerMoveCount`, teaching progress) and the
// level recomputes on the next read, with no invalidation job and no
// staleness concept to track.

import { hasReachedCeiling } from './teaching';
import type { VariationStep } from './variations';

export type Tier = 'bronze' | 'silver' | 'gold' | 'platinum';

const TIER_ORDER: readonly Tier[] = ['bronze', 'silver', 'gold', 'platinum'];

/** Inclusive upper bound of each tier's `playerMoveCount` bracket. */
const TIER_MAX_PLAYER_MOVES: Record<Tier, number> = {
	bronze: 9,
	silver: 18,
	gold: 27,
	platinum: Infinity
};

const TIER_RANK: Record<Tier, number> = { bronze: 0, silver: 1, gold: 2, platinum: 3 };

/** Which tier a variation belongs to, by its own move count alone. */
export function tierForMoveCount(playerMoveCount: number): Tier {
	for (const tier of TIER_ORDER) {
		if (playerMoveCount <= TIER_MAX_PLAYER_MOVES[tier]) return tier;
	}
	return 'platinum';
}

type ScopedVariation = { variationKey: string; playerMoveCount: number; path: readonly VariationStep[] };

/**
 * A chapter's level: the highest tier T such that EVERY variation in scope
 * (not just tier T's own bracket — see below) has been taught at least up to
 * T's move cap, per `hasReachedCeiling` — a short variation counts once
 * genuinely solved, a longer one once paused there. Solving only a
 * chapter's silver-tier lines while a bronze-tier line is unsolved does not
 * grant silver — it's banked progress, credited the moment bronze finishes.
 *
 * Unlike the prior, `variation_solved`-only definition, an UNTOUCHED long
 * variation now blocks even Bronze until it's been taught up to move 9 — a
 * deliberate, larger behavior change (GitHub issue #181): reaching a tier's
 * cap is real progress toward leveling up, not just something that happens
 * to happen along the way. "Vacuous bracket" (an empty tier skipped
 * outright) is retired as its own mechanism — every variation is checked
 * against every tier's cap up to the chapter's own ceiling, and the
 * terminal `if (tier === ceiling) break` below is what stops a chapter from
 * being reported as a tier it has no content anywhere near (see that line's
 * own comment).
 *
 * An excluded variation is not special-cased here: while excluded, it is
 * never itself taught (never directly served), so its own `masteredPlies`
 * never advances beyond whatever shared-prefix credit its opening moves
 * happen to inherit from other, actively-taught variations (see
 * `computeMasteredPliesMap`) — the same shared-credit mechanism already
 * governing `isLockedForTier` today. In practice this still blocks the
 * ladder past its tier for any exclusion whose own unique content isn't
 * already fully covered by a sibling, which is the common case; if it was
 * solved BEFORE being excluded, its full-credit entry (via `solvedKeys`)
 * persists and never blocks. That guarantee only holds if the excluded
 * variation is still present in `variationsInChapter` — every real caller
 * MUST pass the unfiltered variation set here (excluded variations
 * included), never a pre-filtered one, or an excluded-and-unsolved
 * variation's bracket shrinks or vanishes instead of blocking.
 */
export function deriveChapterLevel(
	variationsInChapter: readonly ScopedVariation[],
	masteredPlies: ReadonlyMap<string, number>
): Tier | null {
	const ceiling = chapterCeiling(variationsInChapter);
	if (ceiling === null) return null;
	let achieved: Tier | null = null;
	for (const tier of TIER_ORDER) {
		const cap = TIER_MAX_PLAYER_MOVES[tier];
		const allReached = variationsInChapter.every((v) => hasReachedCeiling(v.path, masteredPlies.get(v.variationKey) ?? 0, cap));
		if (!allReached) break; // A real, not-yet-reached tier blocks further advancement.
		achieved = tier;
		// Load-bearing, not an optimization: without this, a chapter whose
		// tallest content is (say) Silver-length would trivially satisfy
		// Gold's and Platinum's checks too (nothing left in the chapter for
		// those caps to meaningfully ask about — `hasReachedCeiling` is
		// vacuously true once a variation's own end already lies behind the
		// cap), over-reporting a tier the chapter has no content anywhere
		// near.
		if (tier === ceiling) break;
	}
	return achieved;
}

/**
 * The highest tier this chapter has ANY variation in — its own ceiling,
 * independent of what's been taught. Null for an empty chapter.
 *
 * This is deliberately separate from `deriveChapterLevel`'s cumulative
 * ladder: a chapter capped at Silver (nothing past move 18) has a Silver
 * ceiling, and should be able to count as fully "complete" once it reaches
 * that ceiling — see `isChapterComplete` — without needing to reach Platinum,
 * which it structurally never can.
 */
export function chapterCeiling(variationsInChapter: readonly ScopedVariation[]): Tier | null {
	let ceiling: Tier | null = null;
	let ceilingRank = -1;
	for (const v of variationsInChapter) {
		const rank = TIER_RANK[tierForMoveCount(v.playerMoveCount)];
		if (rank > ceilingRank) {
			ceilingRank = rank;
			ceiling = tierForMoveCount(v.playerMoveCount);
		}
	}
	return ceiling;
}

/**
 * Whether a chapter has reached its own ceiling — the "mastered"/"completed"
 * bar. `false` for an empty chapter (a null ceiling can never be "reached").
 *
 * Because `deriveChapterLevel` only ever consults `masteredPlies`, an
 * excluded variation that was never taught blocks completion here exactly
 * the way it blocks the ladder itself — but ONLY if it is still present in
 * `variationsInChapter`. Callers MUST pass the unfiltered variation set
 * (including excluded variations) for this to hold.
 */
export function isChapterComplete(
	variationsInChapter: readonly ScopedVariation[],
	masteredPlies: ReadonlyMap<string, number>
): boolean {
	const ceiling = chapterCeiling(variationsInChapter);
	if (ceiling === null) return false;
	return deriveChapterLevel(variationsInChapter, masteredPlies) === ceiling;
}

/** A repertoire's level: the minimum tier across its chapters (null counts as lowest). */
export function deriveRepertoireLevel(chapterLevels: Iterable<Tier | null>): Tier | null {
	let min: Tier | null = null;
	let minRank = Infinity;
	let any = false;
	for (const level of chapterLevels) {
		any = true;
		const rank = level === null ? -1 : TIER_RANK[level];
		if (rank < minRank) {
			minRank = rank;
			min = level;
		}
	}
	return any ? min : null;
}

/**
 * The player-move-count Learn may currently teach up to, repertoire-wide: the
 * ceiling of the tier immediately above the pooled repertoire's own tier —
 * bronze's own ceiling (9) when nothing has reached it yet, silver's (18)
 * once every <=9-move variation REPERTOIRE-WIDE has reached it (solved if
 * short enough, paused there if longer), and so on, unlimited once every
 * <=27-move variation has.
 *
 * Deliberately reuses `deriveChapterLevel` over `allVariations` pooled
 * together — the WHOLE repertoire treated as one chapter — rather than
 * per-chapter-then-`deriveRepertoireLevel`. See
 * docs/superpowers/specs/2026-08-26-tier-gated-learn-design.md §3 for why:
 * min-ing independently-computed per-chapter LEVELS reintroduces a deadlock
 * `deriveChapterLevel`'s own ceiling clamp already solves once, at the
 * chapter level — a chapter with nothing bronze-length at all would
 * otherwise permanently cap the whole repertoire at 9. Pooling first, then
 * deriving once, is not an optimisation of the per-chapter approach; it is a
 * different, correct answer to a subtly different question. This is a
 * SEPARATE call from `deriveRepertoireLevel` (which keeps its own, different,
 * unaffected meaning — the Levels page's "worst chapter's medal" display) —
 * the two can legitimately disagree and both be right.
 *
 * `allVariations` MUST be the repertoire's UNFILTERED variation set, for the
 * same exclusion-blocking reason `deriveChapterLevel` itself documents.
 */
export function teachingCeilingMoveCount(
	allVariations: readonly ScopedVariation[],
	masteredPlies: ReadonlyMap<string, number>
): number {
	const repertoireWideLevel = deriveChapterLevel(allVariations, masteredPlies);
	if (repertoireWideLevel === null) return TIER_MAX_PLAYER_MOVES.bronze;
	const idx = TIER_ORDER.indexOf(repertoireWideLevel);
	const nextTier = TIER_ORDER[idx + 1];
	return nextTier ? TIER_MAX_PLAYER_MOVES[nextTier] : Infinity;
}

/**
 * How close the repertoire is to its NEXT teaching ceiling — same pooled-
 * repertoire convention as `teachingCeilingMoveCount` (see that function's
 * own doc comment for why pooled, not per-chapter). `ready` counts every
 * variation that has already reached the CURRENT ceiling — genuinely nothing
 * more this tier can ask of it, short-and-solved or long-and-paused alike.
 * Once `ready === total`, the next read of `teachingCeilingMoveCount`
 * reflects the raised ceiling; this is the SAME computation exposed as a
 * fraction instead of a boolean, not a second source of truth. Backs the
 * Learn page's "current level" progress bar (GitHub issue #181).
 */
export function currentLevelProgress(
	allVariations: readonly ScopedVariation[],
	masteredPlies: ReadonlyMap<string, number>
): { tier: Tier; ready: number; total: number } {
	const ceilingMoveCount = teachingCeilingMoveCount(allVariations, masteredPlies);
	const ready = allVariations.filter((v) => hasReachedCeiling(v.path, masteredPlies.get(v.variationKey) ?? 0, ceilingMoveCount)).length;
	// `tierForMoveCount` already falls back to 'platinum' for Infinity (its
	// own loop's final `return`), so no special-casing is needed here.
	return { tier: tierForMoveCount(ceilingMoveCount), ready, total: allVariations.length };
}
