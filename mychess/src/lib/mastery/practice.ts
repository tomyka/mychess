// mychess/src/lib/mastery/practice.ts
import type { Variation, VariationStep } from './variations';
import { pickActiveVariation, solvedProgress } from './variationSequence';
import { resolveTeachingStep, computeMasteredMoveIds, sharedMasteredPrefixLength, effectiveProgress } from './teaching';

export type PracticeView = {
	attempt: {
		path: VariationStep[];
		variationKey: string;
		arrowPlies: { from: number; to: number } | null;
		isFinalPass: boolean;
		// How many of `path`'s leading plies are already mastered — via this
		// variation's own progress, OR via a SIBLING variation sharing the
		// same moves (see computeMasteredMoveIds) — and so should auto-play
		// rather than require the player to replay them by hand. 0 for an
		// already-solved variation's own re-drill: that's meant to be played
		// out in full.
		autoPlayThrough: number;
	} | null;
	solved: number;
	total: number;
	allSolved: boolean;
};

/** How long since a variation's last attempt counts as "the player took a break" from it. */
export const RESUME_GAP_MS = 10 * 60 * 1000;

/**
 * True if more than `RESUME_GAP_MS` has passed since `updatedAt`. A variation
 * with no `updatedAt` yet (never attempted) is never "resumed" — there's
 * nothing to resume from, and its progress is already zero.
 */
export function wasResumedAfterBreak(updatedAt: string | null, now: Date): boolean {
	if (updatedAt == null) return false;
	return now.getTime() - new Date(updatedAt).getTime() > RESUME_GAP_MS;
}

/**
 * Builds the full client-facing practice view: which variation to quiz next
 * (its path — the WHOLE thing once mastered, or truncated to the current
 * teaching batch otherwise, see resolveTeachingStep) plus the
 * repertoire-wide solved/total count. `activeVariationKey` is whatever is
 * currently persisted (or `null` if none yet); `solvedKeys` is this player's
 * full solved set for this repertoire; `teachingProgress` is this player's
 * per-variation `{taughtPlies, masteredPlies}` state for this repertoire.
 */
export function buildPracticeView(
	variations: Variation[],
	activeVariationKey: string | null,
	solvedKeys: ReadonlySet<string>,
	teachingProgress: ReadonlyMap<string, { taughtPlies: number; masteredPlies: number; updatedAt: string | null }>,
	forceAttempt: boolean = false,
	now: Date = new Date()
): PracticeView {
	const { solved, total } = solvedProgress(variations, solvedKeys);
	const active = pickActiveVariation(variations, activeVariationKey, solvedKeys);

	// allSolved means the REPERTOIRE is done, not just that the (possibly
	// manually re-picked) active variation happens to be solved — those are
	// different things once a player can pick an already-solved variation.
	// An empty repertoire (total === 0) counts as vacuously all-solved.
	const allSolved = solved === total;

	let attempt: PracticeView['attempt'] = null;
	// The !allSolved gate suppresses the attempt once the repertoire is done,
	// so the trophy screen shows instead of auto-serving variations[0] forever.
	// forceAttempt bypasses that gate for a deliberate manual re-pick (the
	// picker), where the player explicitly asked to re-drill a variation even
	// though everything is already solved.
	if (active && (forceAttempt || !allSolved)) {
		if (solvedKeys.has(active.variationKey)) {
			// Already solved (including a manual re-drill pick) — never
			// re-teach, regardless of what teachingProgress happens to hold,
			// and never auto-play any of it: a deliberate re-drill is meant
			// to be played out in full.
			attempt = { path: active.path, variationKey: active.variationKey, arrowPlies: null, isFinalPass: true, autoPlayThrough: 0 };
		} else {
			const progress = teachingProgress.get(active.variationKey) ?? { taughtPlies: 0, masteredPlies: 0, updatedAt: null };
			// A sibling variation sharing this one's leading moves (the same
			// moveIds — a transposition, or just the same opening) may have
			// already mastered them: credit that shared prefix here rather
			// than making the player re-earn it from scratch for every
			// variation that happens to share it.
			const masteredMoveIds = computeMasteredMoveIds(variations, teachingProgress, solvedKeys);
			const sharedFloor = sharedMasteredPrefixLength(active.path, masteredMoveIds);
			// A break of 10+ minutes since this specific variation's last
			// attempt serves this one attempt as if nothing were mastered yet —
			// the player's own memory of "mastered" moves fades too. Nothing is
			// written back; the real stored counters are untouched, so the next
			// attempt (once touchVariationAttempt in practice-progress.ts
			// refreshes updatedAt) goes back to normal. effectiveProgress zeroes
			// the whole floor, including any sharedFloor credit from a sibling
			// variation practiced moments ago — deliberately conservative (a
			// per-variation break check, not a per-move-id one): worst case a
			// few already-known moves get manually replayed once, rather than
			// risking auto-play through content THIS variation's own break
			// should have reset. Shared with `applyAttemptResult` (which MUST
			// mirror this exactly, or the server records progress against a
			// different step than the one it actually served — see its own
			// doc comment) so both sides can never drift apart again.
			const resumedAfterBreak = wasResumedAfterBreak(progress.updatedAt, now);
			const { taughtPlies: effectiveTaughtPlies, masteredPlies: effectiveMasteredPlies } = effectiveProgress({
				ownTaughtPlies: progress.taughtPlies,
				ownMasteredPlies: progress.masteredPlies,
				sharedFloor,
				resumedAfterBreak
			});
			const step = resolveTeachingStep(active.path, effectiveTaughtPlies, effectiveMasteredPlies);
			attempt = {
				path: step.path,
				variationKey: active.variationKey,
				arrowPlies: step.arrowPlies,
				isFinalPass: step.isFinalPass,
				autoPlayThrough: effectiveMasteredPlies
			};
		}
	}

	return { attempt, solved, total, allSolved };
}

/**
 * The sidebar's solved count to show the instant a clean, FINAL-PASS attempt
 * completes, before the server's own round trip confirms it. That round trip
 * re-walks the whole repertoire's move tree to advance the active variation
 * and can take a real, noticeable moment for a large repertoire — this lets
 * the count bump in step with the "correct!" feedback instead of lagging
 * behind it. Clamped to never exceed `total`; a no-op for a mistaken attempt.
 *
 * This is a best-effort estimate, not a source of truth: re-drilling an
 * already-solved variation (allowed via the picker) would over-count by one
 * here, since this has no way to know the active variation was already
 * solved. The server's authoritative response — merged in once it arrives —
 * always overwrites this a moment later, so a wrong guess self-corrects
 * rather than sticking. The caller is responsible for only invoking this when
 * `attempt.isFinalPass` was true — a clean teach or intermediate blind-retest
 * pass doesn't solve anything yet.
 */
export function optimisticSolvedAfterAttempt(current: { solved: number; total: number }, hadMistake: boolean): number {
	if (hadMistake) return current.solved;
	return Math.min(current.solved + 1, current.total);
}
