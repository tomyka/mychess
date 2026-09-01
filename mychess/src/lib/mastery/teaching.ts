import type { Square } from 'chess.js';
import type { Variation, VariationStep } from './variations';
import { squaresForSanMove } from '../chess-moves';

/** How many of the player's own moves make up one teaching batch. */
export const TEACHING_BATCH_MOVES = 3;

export type TeachingStep = {
	path: VariationStep[];
	arrowPlies: { from: number; to: number } | null;
	isFinalPass: boolean;
	/** True only when THIS pass reached path's end because of `ceilingPly`,
	 * not because the variation's own true path ended there. The caller —
	 * never this module — decides what "paused" means downstream (no
	 * variation_solved write, still advance past it when picking what's next). */
	pausedAtCeiling: boolean;
};

/**
 * The ply index right after the `moveCount`-th player-turn ply found at or
 * after `fromPly` — i.e. where a batch of `moveCount` player moves ends.
 * Deliberately NOT a fixed ply-count offset: whether a batch of N player
 * moves spans N*2-1, N*2, or fewer plies depends entirely on whose move
 * `fromPly` itself lands on. What matters is that the result always points
 * just past a PLAYER move (or the end of the path, if it runs out first) —
 * never an opponent reply. A served path ending on the opponent's move would
 * mean the player is never asked to move at that path's last index, so the
 * "was that the final move of this attempt" check in the practice page (only
 * ever evaluated when the player themselves moves) would never fire, and the
 * attempt would silently complete without ever reporting its outcome.
 */
function plyAfterPlayerMoves(path: VariationStep[], fromPly: number, moveCount: number): number {
	let seen = 0;
	for (let i = fromPly; i < path.length; i++) {
		if (path[i].isPlayerTurn) {
			seen++;
			if (seen >= moveCount) return i + 1;
		}
	}
	return path.length;
}

/**
 * How many leading plies of a served path may auto-play: everything up to, but
 * never including, its LAST player move. The player must always be left a move
 * to make, or the attempt can never finish — the board waits in 'playing' for a
 * move it has already played itself, and rejects everything the player tries.
 *
 * That was reachable in practice, not in theory: the shared-prefix credit in
 * `knownProgressFor` gives a variation whose every move belongs to an
 * already-solved sibling a `masteredPlies` equal to its own path length, and
 * `masteredPlies` is exactly what auto-plays. Clamping here rather than at the
 * progress layer is deliberate — the credit itself is correct (those moves ARE
 * known), it just can't be allowed to swallow the move being tested.
 *
 * 0 for a path with no player move at all, which leaves such a path playing
 * nothing automatically; it still cannot be completed, and is dropped from
 * enumeration instead (see `enumerateVariations`).
 */
export function autoPlayCeiling(path: readonly VariationStep[]): number {
	for (let i = path.length - 1; i >= 0; i--) {
		if (path[i].isPlayerTurn) return i;
	}
	return 0;
}

/** Where `ceilingMoveCount` player moves lands within `path` — the same
 * "N player moves from a starting ply" question `plyAfterPlayerMoves` already
 * answers, from ply 0. A one-line wrapper, not new logic. */
export function ceilingPlyFor(path: readonly VariationStep[], ceilingMoveCount: number): number {
	return plyAfterPlayerMoves(path as VariationStep[], 0, ceilingMoveCount);
}

/**
 * Derives what the NEXT attempt of this variation should look like, purely
 * from its two persisted counters — never from a stored "phase" — so a
 * corrupted or stale counter can't disagree with what's actually served. See
 * docs/superpowers/specs/2026-08-14-variation-teaching-arrows-design.md for
 * the full state-machine rationale, and
 * docs/superpowers/specs/2026-08-26-tier-gated-learn-design.md §3 for
 * `ceilingPly`'s rationale (GitHub issue #163).
 *
 * `ceilingPly` defaults to `path.length` — i.e. no cap, today's exact
 * behavior — so every existing caller that doesn't pass one is unaffected.
 * `TEACHING_BATCH_MOVES` (3) divides evenly into every tier boundary this
 * repo's ceilings ever use (9/18/27), so a real ceiling always lands exactly
 * on a batch boundary in the ordinary path; the `Math.min` clamps below exist
 * for the one case that can still disagree — a ceiling that REGRESSED (a
 * coach reconciliation demoting solved content) below progress already made
 * under a higher one.
 */
export function resolveTeachingStep(
	path: VariationStep[],
	taughtPlies: number,
	masteredPlies: number,
	ceilingPly: number = path.length
): TeachingStep {
	const effectiveLength = Math.min(path.length, ceilingPly);
	if (masteredPlies >= effectiveLength) {
		return {
			path: path.slice(0, effectiveLength),
			arrowPlies: null,
			isFinalPass: true,
			pausedAtCeiling: effectiveLength < path.length
		};
	}
	if (taughtPlies === masteredPlies) {
		const target = Math.min(plyAfterPlayerMoves(path, masteredPlies, TEACHING_BATCH_MOVES), effectiveLength);
		// See resolveTeachingStep's own prior doc comment (issue #68) for why a
		// pass that draws arrows is never the final pass, unchanged by the ceiling.
		return {
			path: path.slice(0, target),
			arrowPlies: { from: masteredPlies, to: target },
			isFinalPass: false,
			pausedAtCeiling: false
		};
	}
	const target = Math.min(taughtPlies, effectiveLength);
	return {
		path: path.slice(0, target),
		arrowPlies: null,
		isFinalPass: target >= effectiveLength,
		pausedAtCeiling: target >= effectiveLength && effectiveLength < path.length
	};
}

/**
 * Applies a completed attempt's outcome to the two counters. Always
 * re-derives the step that was actually served (via `resolveTeachingStep`)
 * rather than trusting anything the client reports beyond `hadMistake`.
 *
 * `solved` now means genuinely, truly finished — never true for a pass that
 * only reached a ceiling short of the variation's own real end.
 * `pausedAtCeiling` is the caller's signal to do everything a genuine solve
 * does NOT do (no `variation_solved` write, no completed-chapters cache
 * update) while STILL doing the one thing a mid-batch pass does NOT do:
 * advance past this variation when deciding what to serve next (see
 * `variationSequence.ts`'s new `blockedKeys` parameter and
 * `server/practice-progress.ts`'s new branch in `applyAttemptResult`).
 */
export function advanceTeachingProgress(
	path: VariationStep[],
	taughtPlies: number,
	masteredPlies: number,
	hadMistake: boolean,
	ceilingPly: number = path.length
): { taughtPlies: number; masteredPlies: number; solved: boolean; pausedAtCeiling: boolean } {
	const step = resolveTeachingStep(path, taughtPlies, masteredPlies, ceilingPly);

	if (hadMistake) {
		return { taughtPlies, masteredPlies, solved: false, pausedAtCeiling: false };
	}
	if (step.arrowPlies) {
		return { taughtPlies: step.arrowPlies.to, masteredPlies, solved: false, pausedAtCeiling: false };
	}
	const masteredNow = step.path.length;
	return {
		taughtPlies: Math.max(taughtPlies, masteredNow),
		masteredPlies: masteredNow,
		solved: step.isFinalPass && !step.pausedAtCeiling,
		pausedAtCeiling: step.isFinalPass && step.pausedAtCeiling
	};
}

/**
 * Whether `path` currently has nothing more Learn can teach under
 * `ceilingMoveCount` — already taught as far as the ceiling allows, but not
 * this variation's own true end. Deliberately FALSE for an untouched
 * (`masteredPlies === 0`) long variation: that one is still fully servable,
 * up to the ceiling, on its very next pass — this predicate answers "is
 * there nothing left to do here RIGHT NOW", not "is this variation long".
 */
export function isPausedAtCeiling(path: readonly VariationStep[], masteredPlies: number, ceilingMoveCount: number): boolean {
	const ceilingPly = ceilingPlyFor(path, ceilingMoveCount);
	return masteredPlies >= ceilingPly && ceilingPly < path.length;
}

/**
 * Whether `path` would merely PAUSE at the ceiling rather than genuinely
 * finish there — i.e. its own true end lies beyond `ceilingMoveCount`. Ply
 * position within `ceilingMoveCount` player moves lands at the SAME index
 * for every variation of consistent starting side-to-move regardless of
 * content (`ceilingPlyFor` counts player-turn plies, which alternate on a
 * fixed parity), so this is really "is `path` longer than the ceiling" —
 * shared by `isCeilingReachedAnywhere` and `isLockedForTier` below so both
 * agree on what counts as "would merely pause" vs. "would solve outright."
 */
function wouldMerelyPauseAt(path: readonly VariationStep[], ceilingMoveCount: number): boolean {
	return ceilingPlyFor(path, ceilingMoveCount) < path.length;
}

/**
 * Whether ANY currently-unsolved variation has already been taught all the
 * way to the tier ceiling and is genuinely paused there (not just eligible
 * to pause) — GitHub issue #172. Feeds `isLockedForTier`'s deferred-sibling
 * check below; expensive to recompute per row (an O(n) scan plus a shared
 * `knownProgressFor` call per candidate), so callers compute it ONCE per
 * request and pass the result to every row, not once per row.
 */
export function isCeilingReachedAnywhere(
	variations: Variation[],
	solvedKeys: ReadonlySet<string>,
	teachingProgress: ReadonlyMap<string, { taughtPlies: number; masteredPlies: number }>,
	ceilingMoveCount: number,
	masteredMoveIds: ReadonlySet<string> = computeMasteredMoveIds(variations, teachingProgress, solvedKeys)
): boolean {
	return variations.some((variation) => {
		if (solvedKeys.has(variation.variationKey)) return false;
		if (!wouldMerelyPauseAt(variation.path, ceilingMoveCount)) return false;
		const { masteredPlies } = knownProgressFor({
			variation,
			variations,
			teachingProgress,
			solvedKeys,
			resumedAfterBreak: false,
			masteredMoveIds
		});
		return isPausedAtCeiling(variation.path, masteredPlies, ceilingMoveCount);
	});
}

/**
 * Whether `path` is locked for the CURRENT tier — either genuinely paused
 * at its own ceiling (`isPausedAtCeiling`), or (GitHub issue #172)
 * DEFERRED: some sibling sharing part of its credited prefix has already
 * been taught all the way to the ceiling and paused there (`ceilingReached`,
 * from `isCeilingReachedAnywhere`), `path` would ALSO merely pause at the
 * same ceiling rather than solve outright, and `path` already carries SOME
 * shared credit toward it (`masteredPlies > 0` — otherwise it's an
 * unrelated, untouched line Learn should still move on to freely, per the
 * original design's "Learn simply serves something else" guarantee).
 *
 * The user's own framing, from the grilling session behind this change:
 * a repertoire with several near-identical continuations sharing almost
 * their entire length used to let Learn front-load ALL of the shared
 * content via one continuation's own teaching, then separately quiz the
 * player on each OTHER continuation's own single divergent final move —
 * one quick quiz per sibling, indefinitely, since each such move is
 * technically still "that sibling's own Nth move," nominally within its
 * own per-path budget. Once the ceiling has genuinely been reached by
 * ANYONE, a pass counts as passed for every variation sharing that
 * stretch, not a fresh per-sibling allowance for its own unique tail — a
 * sibling whose OWN true end is reached in the process (it would SOLVE,
 * not merely pause) is exempt: finishing it is a genuine, permanent piece
 * of knowledge, not more of the same already-covered content.
 */
export function isLockedForTier(
	path: readonly VariationStep[],
	masteredPlies: number,
	ceilingMoveCount: number,
	ceilingReached: boolean
): boolean {
	if (isPausedAtCeiling(path, masteredPlies, ceilingMoveCount)) return true;
	if (!ceilingReached || !wouldMerelyPauseAt(path, ceilingMoveCount)) return false;
	const ceilingPly = ceilingPlyFor(path, ceilingMoveCount);
	return masteredPlies > 0 && masteredPlies < ceilingPly;
}

/**
 * How many of `path`'s LEADING plies have a moveId already in
 * `masteredMoveIds` — stops at the first ply whose moveId isn't there, even
 * if a later ply happens to be mastered too (a gap breaks the prefix). Used
 * to credit a variation with mastery it never individually earned itself,
 * when it shares moves with another variation (or the same variation's own
 * earlier progress) that already covers them.
 */
export function sharedMasteredPrefixLength(path: VariationStep[], masteredMoveIds: ReadonlySet<string>): number {
	let i = 0;
	while (i < path.length && masteredMoveIds.has(path[i].moveId)) i++;
	return i;
}

/**
 * The final zero-or-not step of `knownProgressFor`, split out only to keep
 * that function readable. Deliberately NOT exported: a caller holding just
 * this could compute a floor differently from the other call site, which is
 * the exact drift `knownProgressFor` exists to prevent. Go through
 * `knownProgressFor`.
 */
function effectiveProgress(args: {
	ownTaughtPlies: number;
	ownMasteredPlies: number;
	sharedFloor: number;
	resumedAfterBreak: boolean;
}): { taughtPlies: number; masteredPlies: number } {
	if (args.resumedAfterBreak) return { taughtPlies: 0, masteredPlies: 0 };
	const masteredPlies = Math.max(args.ownMasteredPlies, args.sharedFloor);
	const taughtPlies = Math.max(args.ownTaughtPlies, masteredPlies);
	return { taughtPlies, masteredPlies };
}

/**
 * Every moveId this player has already mastered, across the WHOLE
 * repertoire — not just the one variation currently being served. A fully
 * solved variation contributes every one of its moves (solved implies every
 * ply was mastered at some point); an unsolved variation contributes only
 * its own `masteredPlies`-long prefix. Two variations that share a common
 * opening (the same moveIds, since they're literally the same edges in the
 * move tree) both benefit from whichever one mastered that shared part
 * first — see `sharedMasteredPrefixLength`, which is how a served attempt
 * turns this set back into "how much of THIS variation is already known."
 */
export function computeMasteredMoveIds(
	variations: Variation[],
	teachingProgress: ReadonlyMap<string, { taughtPlies: number; masteredPlies: number }>,
	solvedKeys: ReadonlySet<string>
): Set<string> {
	const mastered = new Set<string>();
	for (const variation of variations) {
		if (solvedKeys.has(variation.variationKey)) {
			for (const step of variation.path) mastered.add(step.moveId);
			continue;
		}
		const progress = teachingProgress.get(variation.variationKey);
		if (!progress) continue;
		for (let i = 0; i < progress.masteredPlies && i < variation.path.length; i++) {
			mastered.add(variation.path[i].moveId);
		}
	}
	return mastered;
}

/**
 * How much of `variation` this player already knows, expressed as the
 * taught/mastered ply counters an attempt should actually be built from.
 *
 * This is the SINGLE owner of that question, and the only entry point either
 * side should use: `buildPracticeView` (serve time, `mastery/practice.ts`) and
 * `applyAttemptResult` (record time, `server/practice-progress.ts`) must agree
 * exactly, or the server records progress against a different step than the
 * one it served — a real bug that has happened (see the resume-after-break
 * feature's Task 4 fix). It owns the whole computation, not just its last
 * step: the variation's own stored counters, the shared-sibling floor
 * (`computeMasteredMoveIds` + `sharedMasteredPrefixLength`), and the
 * zero-if-resumed reset. Callers that computed the floor themselves and passed
 * it in could still drift apart from each other while looking correct, which
 * is why those inputs live in here now rather than at each call site.
 *
 * `resumedAfterBreak` (see `wasResumedAfterBreak` in `mastery/practice.ts`)
 * zeroes the floor WHOLESALE — including shared-prefix credit from a sibling
 * variation practiced moments ago. That is deliberate: the break check is
 * per-variation, not per-moveId, so the conservative choice is to make the
 * player replay a few already-known moves rather than auto-play through
 * content this variation's own break should have reset.
 */
export function knownProgressFor(args: {
	variation: Variation;
	variations: Variation[];
	teachingProgress: ReadonlyMap<string, { taughtPlies: number; masteredPlies: number }>;
	solvedKeys: ReadonlySet<string>;
	resumedAfterBreak: boolean;
	// Precomputed `computeMasteredMoveIds(variations, teachingProgress, solvedKeys)`,
	// for a caller (`computeBlockedKeys`) that calls this once per variation
	// in a repertoire — recomputing the whole-repertoire mastered-moveId set
	// on every one of those calls would be O(n²) in variation count for no
	// reason, since the set itself doesn't depend on which variation is being
	// asked about. Optional so every other caller (asking about exactly one
	// variation) is unaffected.
	masteredMoveIds?: ReadonlySet<string>;
}): { taughtPlies: number; masteredPlies: number } {
	const own = args.teachingProgress.get(args.variation.variationKey) ?? { taughtPlies: 0, masteredPlies: 0 };
	const masteredMoveIds = args.masteredMoveIds ?? computeMasteredMoveIds(args.variations, args.teachingProgress, args.solvedKeys);
	const sharedFloor = sharedMasteredPrefixLength(args.variation.path, masteredMoveIds);
	return effectiveProgress({
		ownTaughtPlies: own.taughtPlies,
		ownMasteredPlies: own.masteredPlies,
		sharedFloor,
		resumedAfterBreak: args.resumedAfterBreak
	});
}

/**
 * Which currently-unsolved variations have nothing more Learn can teach them
 * right now under `ceilingMoveCount` (see `isPausedAtCeiling`) — used to keep
 * `pickActiveVariation`/`advanceIfSolved` from serving (or re-serving) a
 * variation that's blocked at its tier ceiling. Shared between serve time
 * (`buildPracticeView`, `mastery/practice.ts`) and record time
 * (`applyAttemptResult`, `server/practice-progress.ts`) — those two must
 * agree exactly on what's blocked, never compute it independently, which is
 * why this lives here rather than as a local helper in either caller.
 *
 * Shared-credit-aware (`knownProgressFor`), not each variation's own raw
 * progress row - matching the picker's `locked` display (GitHub issue #165)
 * and `select-variation`'s own rejection (#168): a never-visited variation
 * whose entire visible opening is already mastered via a sibling sharing
 * those moves must be treated as blocked immediately too, or it gets picked
 * as "next" and re-teaches a supposedly-new final move that's actually still
 * within the tier the ceiling already spent on its siblings.
 *
 * Also covers deferred siblings (`isLockedForTier`, GitHub issue #172): once
 * the ceiling has genuinely been reached anywhere, an unsolved variation
 * that would ALSO merely pause there (not solve outright), and already
 * carries some shared credit toward it, is blocked too — not just the one
 * that actually reached it.
 */
export function computeBlockedKeys(
	variations: Variation[],
	solvedKeys: ReadonlySet<string>,
	teachingProgress: ReadonlyMap<string, { taughtPlies: number; masteredPlies: number }>,
	ceilingMoveCount: number
): Set<string> {
	// Computed once, not once per variation: this set doesn't depend on which
	// variation is being checked, and recomputing it inside the loop below
	// would make this function quadratic in variation count.
	const masteredMoveIds = computeMasteredMoveIds(variations, teachingProgress, solvedKeys);
	const ceilingReached = isCeilingReachedAnywhere(variations, solvedKeys, teachingProgress, ceilingMoveCount, masteredMoveIds);
	const blocked = new Set<string>();
	for (const variation of variations) {
		if (solvedKeys.has(variation.variationKey)) continue;
		const { masteredPlies } = knownProgressFor({
			variation,
			variations,
			teachingProgress,
			solvedKeys,
			resumedAfterBreak: false,
			masteredMoveIds
		});
		if (isLockedForTier(variation.path, masteredPlies, ceilingMoveCount, ceilingReached)) blocked.add(variation.variationKey);
	}
	return blocked;
}

/**
 * Whether `plyIndex` is the LAST ply in `path` requiring the player's own
 * input — i.e. no player-turn ply follows it. Deliberately NOT the same
 * check as "`plyIndex` is `path`'s last index": a served path can end with a
 * trailing run of opponent-only plies when the variation's own true leaf is
 * the opponent's reply (e.g. `plyAfterPlayerMoves`'s fallback for a
 * variation shorter than one batch, or a full-depth serve of a variation
 * that simply ends on the opponent's move). The player is never asked to
 * move at one of those trailing plies, so the practice page's "was that the
 * attempt's final move" check must fire on the LAST PLAYER move, not on
 * whichever ply happens to be served last — otherwise the completion report
 * never sends and the same attempt is re-served forever.
 */
export function isLastPlayerMove(path: readonly VariationStep[], plyIndex: number): boolean {
	return !path.slice(plyIndex + 1).some((step) => step.isPlayerTurn);
}

/**
 * The current ply's arrow — the move's own origin/destination squares, or
 * null if this ply isn't inside the served arrow range, isn't the player's
 * own move (arrows never point at the opponent's reply), or the move can't
 * be parsed.
 */
export function arrowMoveForStep(
	step: VariationStep,
	plyIndex: number,
	arrowPlies: { from: number; to: number } | null
): { from: Square; to: Square } | null {
	if (!arrowPlies || plyIndex < arrowPlies.from || plyIndex >= arrowPlies.to || !step.isPlayerTurn) return null;
	return squaresForSanMove(step.fromFen, step.san);
}
