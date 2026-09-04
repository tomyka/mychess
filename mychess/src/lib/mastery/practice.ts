// mychess/src/lib/mastery/practice.ts
import type { Variation, VariationStep } from './variations';
import { pickActiveVariation, solvedProgress } from './variationSequence';
import { resolveTeachingStep, knownProgressFor, autoPlayCeiling } from './teaching';
import { activeChapterState, type Band, type LearnPlan } from './learnUnits';
import { splitQueues } from './learning';

/**
 * One variation's stored progress. `cleanPassCount`/`lastCleanPassAt` are
 * accepted (optional) for backwards compatibility with rows written before
 * story #104's two-pass graduation rule was removed, but nothing here reads
 * them any more — a variation is learned the moment one clean pass finishes
 * it (see `buildPracticeView` below and `applyAttemptResult`).
 */
export type TeachingProgressEntry = {
	taughtPlies: number;
	masteredPlies: number;
	updatedAt: string | null;
	cleanPassCount?: number;
	lastCleanPassAt?: string | null;
};

export type PracticeView = {
	attempt: {
		path: VariationStep[];
		variationKey: string;
		arrowPlies: { from: number; to: number } | null;
		isFinalPass: boolean;
		// True only when this pass's `isFinalPass` is true because it finished
		// the served LEARN UNIT (the clipped prefix), not the variation's own
		// true path — so the unit leaves the Learn list but the variation does
		// not enter the Practice pool (see `resolveTeachingStep`'s own field of
		// the same name). Callers that treat "final pass" as "the player just
		// finished this whole variation" must also check this is false.
		unitComplete: boolean;
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
	/**
	 * The chapter the player is currently working in, shaped for the Learn
	 * page's band progress bar: which band is being learned and how many of
	 * its units are done. `null` when there is no band to report on — either
	 * no `plan` was supplied, or every chapter is complete, which hides the
	 * bar rather than parking it permanently at full.
	 *
	 * Carried on the view, rather than computed by the Learn page's own
	 * `load`, because a completed attempt MERGES this response into the page's
	 * data instead of reloading it (see `nextAttempt`). A bar fed from `load`
	 * alone therefore froze at its page-load value for the whole session,
	 * disagreeing with the picker's own freshly-fetched chapter chip.
	 */
	currentLevel: { band: Band; ready: number; total: number } | null;
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
 *
 * `plan` (see `deriveLearnPlan` in `mastery/learnUnits.ts`) decides both WHICH
 * variation is servable and HOW FAR into it Learn may teach — the served learn
 * unit's own clipped length. It defaults to `null`: no gating and no cap, for
 * callers with nothing to gate on. The cap never applies to an already-solved
 * variation's re-drill (forced or picked); that's deliberately served in full.
 */
export function buildPracticeView(
	variations: Variation[],
	activeVariationKey: string | null,
	solvedKeys: ReadonlySet<string>,
	teachingProgress: ReadonlyMap<string, TeachingProgressEntry>,
	plan: LearnPlan | null = null,
	forceAttempt: boolean = false,
	now: Date = new Date()
): PracticeView {
	const { solved, total } = solvedProgress(variations, solvedKeys);

	// Learn's candidates come from the SAME `splitQueues` the Practice pool uses,
	// so the two surfaces cannot drift into serving one variation on both. This
	// used to be an independent filter here, which happened to agree — the point
	// of routing it through one function is that it still agrees after the next
	// change.
	//
	// `forceAttempt` is the exception and must stay one: a deliberate re-drill
	// picked from the variation picker targets an ALREADY-LEARNED variation, so
	// filtering learned lines out of the candidates would make the picker appear
	// to do nothing (the bug fixed in 02bb6d6).
	const { learn } = splitQueues(variations, solvedKeys);
	const candidates = forceAttempt ? variations : learn;
	const active = plan
		? pickActiveVariation(candidates, activeVariationKey, solvedKeys, plan.servableVariationKeys)
		: pickActiveVariation(candidates, activeVariationKey, solvedKeys);

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
			attempt = {
				path: active.path,
				variationKey: active.variationKey,
				arrowPlies: null,
				isFinalPass: true,
				unitComplete: false,
				autoPlayThrough: 0
			};
		} else {
			// A break of 10+ minutes since this specific variation's last
			// attempt serves this one attempt as if nothing were mastered yet —
			// the player's own memory of "mastered" moves fades too. Nothing is
			// written back; the real stored counters are untouched, so the next
			// attempt (once touchVariationAttempt in practice-progress.ts
			// refreshes updatedAt) goes back to normal.
			const stored = teachingProgress.get(active.variationKey);
			const updatedAt = stored?.updatedAt ?? null;
			const resumedAfterBreak = wasResumedAfterBreak(updatedAt, now);
			// knownProgressFor owns the whole "what's already known here"
			// computation — this variation's own counters, the shared-sibling
			// prefix credit, and the resumed-after-break reset. `applyAttemptResult`
			// calls the same function with the same inputs, which is what keeps
			// what gets served identical to what gets recorded.
			const { taughtPlies: effectiveTaughtPlies, masteredPlies: effectiveMasteredPlies } = knownProgressFor({
				variation: active,
				variations,
				teachingProgress,
				solvedKeys,
				resumedAfterBreak
			});
			// How far the plan says this variation may be taught: its served
			// learn unit's own clipped length. A variation absent from the map
			// has no unit in any of its chapters' current bands, which only
			// happens via `pickActiveVariation`'s last-resort fallback ("if
			// nothing is servable, serve the first unsolved one anyway", so
			// Learn shows something rather than a dead end) — clamping to its
			// full path there is right: there is no band withholding anything
			// from it, since no band claims it at all.
			const ceilingPly = plan?.ceilingPlyByVariationKey.get(active.variationKey) ?? active.path.length;
			const step = resolveTeachingStep(active.path, effectiveTaughtPlies, effectiveMasteredPlies, ceilingPly);
			attempt = {
				path: step.path,
				variationKey: active.variationKey,
				arrowPlies: step.arrowPlies,
				isFinalPass: step.isFinalPass,
				unitComplete: step.unitComplete,
				// Clamped, never raw: a variation fully covered by a solved
				// sibling has masteredPlies == path.length, and auto-playing
				// that far leaves the player nothing to play and the attempt
				// unfinishable. See autoPlayCeiling.
				autoPlayThrough: Math.min(effectiveMasteredPlies, autoPlayCeiling(step.path))
			};
		}
	}

	// Resolved from the SERVED attempt where there is one, so the bar reports on
	// the chapter the player is actually looking at rather than on whatever
	// pointer happened to be stored.
	const activeChapter = plan ? activeChapterState(plan, variations, attempt?.variationKey ?? activeVariationKey) : null;
	const currentLevel =
		activeChapter && activeChapter.band
			? { band: activeChapter.band, ready: activeChapter.learnedInBand, total: activeChapter.totalInBand }
			: null;

	return { attempt, solved, total, allSolved, currentLevel };
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
