// mychess/src/lib/mastery/practice.ts
import type { Variation, VariationStep } from './variations';
import { targetDepth, levelDepth, taskKey, levelTaskVariations, type Level } from './levels';

export type QuizStep = VariationStep & { band: 'previous' | 'current' };

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

/**
 * Splits a variation's path into the auto-played `prefix` and the
 * `quizSteps` the player walks through interactively. The quiz window is
 * always the CURRENT level plus the one before it (a live review of the
 * previous level's material) — anything older auto-plays. At active level
 * *n*, moves 1 through 2(n-2) auto-play (book line, both colors); the player
 * answers from 2(n-2)+1 through the target depth. Each quiz step is tagged
 * `band: 'previous'` (review material — counts toward demotion, see
 * `levelProgress.ts`) or `'current'` (the level's own new material).
 */
export function splitAttempt(
	path: VariationStep[],
	level: Level,
	targetDepthValue: number
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
		return { ...step, band: playerMovesSeen <= previousLevelDepth ? 'previous' : 'current' };
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
	const candidates = variations.filter((v) => v.playerMoveCount > levelDepth(level - 1));
	if (candidates.length === 0) return null;

	const chosen = candidates[Math.floor(random() * candidates.length)];
	return { variation: chosen, targetDepth: targetDepth(chosen, level), taskKey: taskKey(chosen, level) };
}
