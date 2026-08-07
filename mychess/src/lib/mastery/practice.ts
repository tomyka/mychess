// mychess/src/lib/mastery/practice.ts
import type { Variation, VariationStep } from './variations';
import { targetDepth, levelDepth, taskKey, levelTaskVariations, hasContentAtLevel, type Level } from './levels';

// Another move the repertoire allows at some quiz step's exact board position.
// - 'completes': lands on ANOTHER variation's own target-depth move for the
//   active level — playing it finishes that task immediately.
// - 'continue': that other variation still has content left at this level
//   (hasContentAtLevel) but hasn't reached its own target-depth move yet —
//   there's more of that specific line to walk before it resolves anything.
// - 'dead-end': that other variation has NO content left at this level (a
//   shorter sibling already fully resolved at an earlier level) — nothing to
//   continue, nothing to credit.
export type Alternative =
	| { san: string; toFen: string; kind: 'completes'; taskKey: string }
	| { san: string; toFen: string; kind: 'continue'; variationKey: string }
	| { san: string; toFen: string; kind: 'dead-end' };

export type QuizStep = VariationStep & {
	band: 'previous' | 'current';
	// The running count of player moves up to and including this step —
	// exposed so a 'continue' alternative taken here can later be resumed
	// (see continueFromBranch) without the caller needing to separately
	// recompute "how many player moves have happened so far."
	playerMoveIndex: number;
	// Other moves the repertoire allows from this exact board position
	// (matched by fromFen, so transpositions reaching it via a different
	// player-move count correctly don't match — see alternativesAt). Always
	// empty for a non-player-turn step.
	alternatives: Alternative[];
};

export type PracticeAttempt = {
	variation: Variation;
	targetDepth: number;
	taskKey: string;
};

/**
 * Picks the variation behind the first `pending` entry in the level's queue
 * — a real FIFO-with-requeue sequence, not a random pick, since a mistake
 * sends a task to the back (see `levelProgress.ts`'s `resolveAttempt`).
 * Returns null once every entry is `cleared` (the caller should have
 * promoted the level before reaching here) or the queue is empty.
 */
export function pickQueuedAttempt(
	variations: Variation[],
	level: Level,
	queue: { key: string; status: 'pending' | 'cleared' }[]
): PracticeAttempt | null {
	const nextKey = queue.find((entry) => entry.status === 'pending')?.key;
	if (nextKey === undefined) return null;

	const tasks = levelTaskVariations(variations, level) as Variation[];
	const variation = tasks.find((v) => taskKey(v, level) === nextKey);
	if (!variation) return null;

	return { variation, targetDepth: targetDepth(variation, level), taskKey: nextKey };
}

/** The `n`th (1-indexed) player-turn step in `path`, or undefined if it has fewer. */
function nthPlayerStep(path: VariationStep[], n: number): VariationStep | undefined {
	let seen = 0;
	for (const step of path) {
		if (!step.isPlayerTurn) continue;
		seen++;
		if (seen === n) return step;
	}
	return undefined;
}

/**
 * Other moves the repertoire allows at the exact board position reached
 * after `playerMoveIndex` player moves (matched by `fromFen`) — every
 * variation sharing that same board position at that same point in its own
 * sequence, excluding the canonical move itself and de-duplicated by SAN.
 * When multiple variations share one edge, the best available classification
 * wins: 'completes' beats 'continue' beats 'dead-end' (this can only ever be
 * a genuine choice between 'continue' and 'dead-end' in practice — a
 * variation can't simultaneously have content at this level, per
 * hasContentAtLevel, AND have another sibling ending exactly here with NO
 * content at this level, since both conditions pin the same playerMoveIndex
 * on opposite sides of levelDepth(level-1); the 'completes' branch is kept
 * for defensive completeness, not because it's reachable today).
 */
function alternativesAt(
	variations: Variation[],
	level: Level,
	playerMoveIndex: number,
	fromFen: string,
	canonicalSan: string
): Alternative[] {
	const found = new Map<string, Alternative>();
	for (const variation of variations) {
		const step = nthPlayerStep(variation.path, playerMoveIndex);
		if (!step || step.fromFen !== fromFen || step.san === canonicalSan) continue;
		const existing = found.get(step.san);
		if (existing?.kind === 'completes') continue; // already the best possible classification

		if (!hasContentAtLevel(variation, level)) {
			if (!existing) found.set(step.san, { san: step.san, toFen: step.toFen, kind: 'dead-end' });
			continue;
		}

		if (playerMoveIndex === targetDepth(variation, level)) {
			found.set(step.san, {
				san: step.san,
				toFen: step.toFen,
				kind: 'completes',
				taskKey: taskKey(variation, level)
			});
			continue;
		}

		if (existing?.kind !== 'continue') {
			// If another variation already claimed 'continue' for this exact
			// SAN, this one is left as the arbitrary (first-seen) pick — safe
			// because `enumerateVariations` only ever splits two variations
			// apart at their actual point of divergence, so two variations
			// sharing this edge are content-identical up to wherever they
			// really do diverge; whichever one is picked, that later
			// divergence still surfaces correctly as its own `alternatives`
			// entry once `continueFromBranch` re-derives this function for it.
			found.set(step.san, {
				san: step.san,
				toFen: step.toFen,
				kind: 'continue',
				variationKey: variation.variationKey
			});
		}
	}
	return [...found.values()];
}

/**
 * Splits a variation's path into the auto-played `prefix` and the
 * `quizSteps` the player walks through interactively. The quiz window is
 * always the CURRENT level plus the one before it (a live review of the
 * previous level's material) — anything older auto-plays. At active level
 * *n*, moves 1 through 3(n-2) auto-play (book line, both colors); the player
 * answers from 3(n-2)+1 through the target depth. Each quiz step is tagged
 * `band: 'previous'` (review material — counts toward demotion, see
 * `levelProgress.ts`) or `'current'` (the level's own new material), its
 * running `playerMoveIndex`, and any `alternatives` the repertoire also
 * allows at that exact position (see `alternativesAt`) — `variations` is the
 * repertoire's whole variation set (unfiltered by level; `alternativesAt`
 * does its own filtering), used only to look those up, independent of which
 * one variation is being split.
 */
export function splitAttempt(
	path: VariationStep[],
	level: Level,
	targetDepthValue: number,
	variations: Variation[]
): { prefix: VariationStep[]; quizSteps: QuizStep[] } {
	const playerIndices: number[] = [];
	path.forEach((step, i) => {
		if (step.isPlayerTurn) playerIndices.push(i);
	});

	const startPoint = levelDepth(Math.max(level - 2, 0)); // moves before this auto-play
	const previousLevelDepth = levelDepth(level - 1); // review-band ceiling
	const nextPlayerIdx = playerIndices[startPoint];
	const targetPlayerIdx = playerIndices[targetDepthValue - 1];

	if (nextPlayerIdx === undefined || targetPlayerIdx === undefined || startPoint >= targetDepthValue) {
		throw new Error(
			`splitAttempt: level ${level} (auto-play boundary ${startPoint}) and targetDepthValue (${targetDepthValue}) are inconsistent with the given path (${playerIndices.length} player moves found)`
		);
	}

	let playerMovesSeen = startPoint;
	const quizSteps: QuizStep[] = path.slice(nextPlayerIdx, targetPlayerIdx + 1).map((step) => {
		if (step.isPlayerTurn) playerMovesSeen++;
		const alternatives = step.isPlayerTurn
			? alternativesAt(variations, level, playerMovesSeen, step.fromFen, step.san)
			: [];
		return {
			...step,
			band: playerMovesSeen <= previousLevelDepth ? 'previous' : 'current',
			playerMoveIndex: playerMovesSeen,
			alternatives
		};
	});

	return {
		prefix: path.slice(0, nextPlayerIdx),
		quizSteps
	};
}

/**
 * Picks a random variation with quiz content at `level`, ignoring queue
 * state — used to review a level the player has already passed. Read-only:
 * review never reports a result back, so it never touches `level_progress`.
 */
export function pickReviewAttempt(
	variations: Variation[],
	level: Level,
	random: () => number = Math.random
): PracticeAttempt | null {
	const candidates = variations.filter((v) => hasContentAtLevel(v, level));
	if (candidates.length === 0) return null;

	const chosen = candidates[Math.floor(random() * candidates.length)];
	return { variation: chosen, targetDepth: targetDepth(chosen, level), taskKey: taskKey(chosen, level) };
}

/**
 * Resumes a specific variation from right after a 'continue' branch was
 * taken during an attempt — reuses `splitAttempt` in full for that variation
 * (so any further branch along this line already has its own `alternatives`
 * computed the normal way, recursion for free) and discards everything up to
 * and including the already-played branch move. Returns `null` if
 * `variationKey` doesn't match any variation, if that variation has no
 * content left at `level` (splitAttempt would throw — a level/variation
 * mismatch is exactly as stale a request as an unrecognized key), or if
 * `afterPlayerMoveIndex` doesn't land on a real player-turn step within that
 * variation's own quiz range at `level` — all three indicate a
 * stale/inconsistent request rather than something to guess at.
 */
export function continueFromBranch(
	variations: Variation[],
	level: Level,
	variationKey: string,
	afterPlayerMoveIndex: number
): { quizSteps: QuizStep[]; taskKey: string } | null {
	const variation = variations.find((v) => v.variationKey === variationKey);
	if (!variation || !hasContentAtLevel(variation, level)) return null;

	const { quizSteps } = splitAttempt(variation.path, level, targetDepth(variation, level), variations);
	const cutIndex = quizSteps.findIndex((s) => s.isPlayerTurn && s.playerMoveIndex === afterPlayerMoveIndex);
	if (cutIndex === -1) return null;

	return { quizSteps: quizSteps.slice(cutIndex + 1), taskKey: taskKey(variation, level) };
}
