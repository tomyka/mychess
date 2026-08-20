// mychess/src/lib/mastery/learning.ts
//
// The graduation rule: when a clean pass turns a variation into LEARNED.
// Story #104 of epic #95; spec at
// ../../../../docs/superpowers/specs/2026-08-20-learn-practice-mvp-design.md
//
// Pure by design — the 20h rule exists here and nowhere else, and the clock is
// always passed in (matching `buildPracticeView`'s own `now` parameter), so the
// boundary is testable without waiting a day.

/**
 * How much real time must separate the two clean passes. Hours rather than
 * calendar days deliberately: no player timezone is stored anywhere, and a
 * 23:50 pass followed by one at 00:10 should not count as two days.
 */
export const LEARN_GAP_MS = 20 * 60 * 60 * 1000;

/** Clean passes needed before a variation counts as learned. */
export const CLEAN_PASSES_TO_LEARN = 2;

/**
 * The two new columns on `variation_teaching_progress`. `lastCleanPassAt` is an
 * ISO string (as PostgREST returns it) or null for a row that has never had a
 * clean pass — including every row that predates the migration.
 */
export type CleanPassState = {
	cleanPassCount: number;
	lastCleanPassAt: string | null;
};

/**
 * Applies one clean pass — an attempt over the variation's final batch played
 * with no mistake and no hint — and reports whether that graduates it.
 *
 * Returns a fresh object; never mutates the input.
 *
 * The early-pass case returns the state completely unchanged, timestamp
 * included. Refreshing the timestamp on a too-soon pass would restart the
 * 20h clock on every attempt, so a player drilling the same line hourly would
 * never graduate it however cleanly they played — the rule is meant to require
 * a day's gap, not to punish practising inside it.
 */
export function applyCleanPass(
	state: CleanPassState,
	now: Date
): { next: CleanPassState; learned: boolean } {
	const stamp = now.toISOString();

	// No previous pass to measure a gap from — either the first one ever, or a
	// count without a timestamp (a pre-migration row). Start the clock; don't
	// infer learning from data that isn't there.
	if (state.cleanPassCount <= 0 || state.lastCleanPassAt == null) {
		return {
			next: { cleanPassCount: Math.max(1, state.cleanPassCount), lastCleanPassAt: stamp },
			learned: state.cleanPassCount >= CLEAN_PASSES_TO_LEARN
		};
	}

	const elapsed = now.getTime() - new Date(state.lastCleanPassAt).getTime();
	if (elapsed < LEARN_GAP_MS) {
		return { next: state, learned: state.cleanPassCount >= CLEAN_PASSES_TO_LEARN };
	}

	const cleanPassCount = state.cleanPassCount + 1;
	return {
		next: { cleanPassCount, lastCleanPassAt: stamp },
		learned: cleanPassCount >= CLEAN_PASSES_TO_LEARN
	};
}

/**
 * True while a variation has a clean pass behind it but isn't learned yet.
 *
 * Such a variation has nothing left to teach — `masteredPlies` already covers
 * its whole path — so it must be served as a cold, full-path blind replay
 * (`arrowPlies: null`, `autoPlayThrough: 0`) rather than the auto-play a raw
 * reading of `masteredPlies` would produce, which would play the entire line
 * out and ask the player for nothing. See §2 of the design spec.
 *
 * `learned` is passed in rather than derived from the count because the
 * `variation_solved` row is the single source of truth for learned — a state
 * whose count says 2 but whose row is missing (a demotion mid-flight, a failed
 * insert) must read as not-learned.
 */
export function isPendingSecondPass(state: CleanPassState, learned: boolean): boolean {
	return !learned && state.cleanPassCount > 0;
}
