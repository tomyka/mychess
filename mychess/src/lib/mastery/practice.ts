// mychess/src/lib/mastery/practice.ts
import type { Variation, VariationStep } from './variations';
import { pickActiveVariation, solvedProgress } from './variationSequence';
import { resolveTeachingStep, knownProgressFor } from './teaching';
import { applyCleanPass, isPendingSecondPass } from './learning';

/**
 * One variation's stored progress. The clean-pass fields are optional so a
 * caller (or an older test) that knows nothing about graduation still
 * type-checks — absent reads as "no clean passes yet", the same default the
 * migration gives existing rows.
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
		/**
		 * True when this attempt is the second, cold pass that graduates the
		 * variation (#104). The client can't infer it — a re-drill of an
		 * already-learned line looks identical (no arrows, final pass, no
		 * autoplay) — and it needs to know, or the optimistic learned-count bump
		 * fires on a first clean pass that learned nothing.
		 */
		isGraduationAttempt: boolean;
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
	 * Un-learned variations that have a clean pass behind them but whose 20h gap
	 * hasn't elapsed. They are deliberately not served: there is nothing left to
	 * teach and they can't graduate yet. Surfaced so Learn can say "waiting until
	 * tomorrow" instead of looking empty or finished.
	 */
	pendingWaiting: number;
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
	teachingProgress: ReadonlyMap<string, TeachingProgressEntry>,
	forceAttempt: boolean = false,
	now: Date = new Date()
): PracticeView {
	const { solved, total } = solvedProgress(variations, solvedKeys);

	// A variation with a clean pass behind it has nothing left to teach, but it
	// can't graduate until 20h have passed — so while it waits it is served by
	// neither surface. `applyCleanPass` decides eligibility rather than a second
	// gap comparison here, so the 20h rule keeps living in exactly one place.
	const waitingKeys = new Set(
		variations
			.filter((v) => {
				if (solvedKeys.has(v.variationKey)) return false;
				const stored = teachingProgress.get(v.variationKey);
				const state = {
					cleanPassCount: stored?.cleanPassCount ?? 0,
					lastCleanPassAt: stored?.lastCleanPassAt ?? null
				};
				if (!isPendingSecondPass(state, false)) return false;
				return !applyCleanPass(state, now).learned;
			})
			.map((v) => v.variationKey)
	);

	const servable = waitingKeys.size > 0 ? variations.filter((v) => !waitingKeys.has(v.variationKey)) : variations;
	const active = pickActiveVariation(servable, activeVariationKey, solvedKeys);

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
			// A deliberate re-drill of an already-learned variation: nothing to
			// graduate, so a clean run must not bump the learned count.
			attempt = {
				path: active.path,
				variationKey: active.variationKey,
				arrowPlies: null,
				isFinalPass: true,
				autoPlayThrough: 0,
				isGraduationAttempt: false
			};
		} else {
			// A break of 10+ minutes since this specific variation's last
			// attempt serves this one attempt as if nothing were mastered yet —
			// the player's own memory of "mastered" moves fades too. Nothing is
			// written back; the real stored counters are untouched, so the next
			// attempt (once touchVariationAttempt in practice-progress.ts
			// refreshes updatedAt) goes back to normal.
			const stored = teachingProgress.get(active.variationKey);
			// Eligible (not merely present) — a waiting variation was already
			// filtered out of `servable` above, so reaching here with a clean pass
			// behind it means the gap has elapsed.
			const pendingGraduation = isPendingSecondPass(
				{ cleanPassCount: stored?.cleanPassCount ?? 0, lastCleanPassAt: stored?.lastCleanPassAt ?? null },
				false
			);
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
			// A graduation attempt bypasses the teaching machinery entirely.
			// `wasResumedAfterBreak` fires after only 10 minutes, and the 20h wait
			// guarantees that — so routing a pending variation through
			// `knownProgressFor` would zero its mastery and re-teach it WITH
			// ARROWS, which is the opposite of the cold replay the second pass is
			// supposed to be. `applyAttemptResult` bypasses it symmetrically when
			// recording, the same way `knownProgressFor` keeps serve and record in
			// step for the normal path.
			if (pendingGraduation) {
				attempt = {
					path: active.path,
					variationKey: active.variationKey,
					arrowPlies: null,
					isFinalPass: true,
					autoPlayThrough: 0,
					isGraduationAttempt: true
				};
				return { attempt, solved, total, allSolved, pendingWaiting: waitingKeys.size };
			}

			const step = resolveTeachingStep(active.path, effectiveTaughtPlies, effectiveMasteredPlies);
			attempt = {
				path: step.path,
				variationKey: active.variationKey,
				arrowPlies: step.arrowPlies,
				isFinalPass: step.isFinalPass,
				autoPlayThrough: effectiveMasteredPlies,
				isGraduationAttempt: false
			};
		}
	}

	return { attempt, solved, total, allSolved, pendingWaiting: waitingKeys.size };
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
