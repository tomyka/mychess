// mychess/src/lib/mastery/practice.ts
import type { Variation, VariationStep } from './variations';
import { targetDepth, levelDepth, taskKey, levelTaskVariations, hasContentAtLevel, type Level } from './levels';

export type QuizStep = VariationStep & {
	band: 'previous' | 'current';
	// Other moves the repertoire allows from this exact board position
	// (matched by fromFen, so transpositions reaching it via a different
	// player-move count correctly don't match — see alternativesAt).
	// taskKey is set when playing that alternative completes a distinct
	// task at this level (it's that variation's own target-depth move);
	// null when it's a valid book move that isn't a task boundary here.
	// Always empty for a non-player-turn step.
	alternatives: { san: string; taskKey: string | null }[];
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
 * Each alternative is tagged with the `taskKey` it completes if this
 * position is that variation's own target-depth move for `level` AND that
 * variation still has content at `level` (a shorter sibling that already
 * ended at or before the previous level's depth was already resolved as a
 * task THEN — its `targetDepth` at this level is just its own natural
 * length, not a live task boundary here, even though the two happen to be
 * numerically equal), or `null` if it's a valid book move that isn't a task
 * boundary here (a branch earlier in a longer line).
 */
function alternativesAt(
	variations: Variation[],
	level: Level,
	playerMoveIndex: number,
	fromFen: string,
	canonicalSan: string
): { san: string; taskKey: string | null }[] {
	const found = new Map<string, string | null>();
	for (const variation of variations) {
		const step = nthPlayerStep(variation.path, playerMoveIndex);
		if (!step || step.fromFen !== fromFen || step.san === canonicalSan) continue;
		if (found.has(step.san)) continue;
		const isTaskBoundary =
			playerMoveIndex === targetDepth(variation, level) && hasContentAtLevel(variation, level);
		found.set(step.san, isTaskBoundary ? taskKey(variation, level) : null);
	}
	return [...found.entries()].map(([san, tk]) => ({ san, taskKey: tk }));
}

/**
 * Splits a variation's path into the auto-played `prefix` and the
 * `quizSteps` the player walks through interactively. The quiz window is
 * always the CURRENT level plus the one before it (a live review of the
 * previous level's material) — anything older auto-plays. At active level
 * *n*, moves 1 through 3(n-2) auto-play (book line, both colors); the player
 * answers from 3(n-2)+1 through the target depth. Each quiz step is tagged
 * `band: 'previous'` (review material — counts toward demotion, see
 * `levelProgress.ts`) or `'current'` (the level's own new material), plus
 * any `alternatives` the repertoire also allows at that exact position
 * (see `alternativesAt`) — `variations` is the repertoire's whole variation
 * set (unfiltered by level; `alternativesAt` does its own filtering), used
 * only to look those up, independent of which one variation is being split.
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
		return { ...step, band: playerMovesSeen <= previousLevelDepth ? 'previous' : 'current', alternatives };
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
