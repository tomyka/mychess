// mychess/src/lib/mastery/practice.ts
import type { Variation, VariationStep } from './variations';
import { isSatisfied, targetDepth, levelDepth, type Level } from './levels';

export type PracticeAttempt = {
	variation: Variation;
	targetDepth: number;
};

/**
 * Picks a random not-yet-satisfied variation at `level` (a variation with at
 * least one 'new' move in the level's range). Returns null once every
 * variation is already satisfied at this level (the repertoire should be
 * promoted to the next level, or "mastered").
 */
export function pickPracticeAttempt(
	variations: Variation[],
	level: Level,
	correctMoveIds: Set<string>,
	random: () => number = Math.random
): PracticeAttempt | null {
	const candidates = variations.filter((v) => !isSatisfied(v, level, correctMoveIds));
	if (candidates.length === 0) return null;

	const chosen = candidates[Math.floor(random() * candidates.length)];
	return { variation: chosen, targetDepth: targetDepth(chosen, level) };
}

/**
 * Splits a variation's path into the auto-played `prefix` and the `quizSteps`
 * the player walks through interactively. The auto-play boundary is
 * DETERMINISTIC (not the old random-start-point mechanic): at active level
 * *n*, every move up through 3(n-1) is auto-played (book line, both colors),
 * and the player picks up interactively at move 3(n-1)+1 — e.g. at Level 2,
 * moves 1-3 auto-play and the player starts on move 4. `quizSteps` stops
 * right after the `targetDepthValue`-th player move.
 */
export function splitAttempt(
	path: VariationStep[],
	level: Level,
	targetDepthValue: number
): { prefix: VariationStep[]; quizSteps: VariationStep[] } {
	const playerIndices: number[] = [];
	path.forEach((step, i) => {
		if (step.isPlayerTurn) playerIndices.push(i);
	});

	const startPoint = levelDepth(level - 1); // moves 1..3(n-1) are already known/auto-played
	const nextPlayerIdx = playerIndices[startPoint];
	const targetPlayerIdx = playerIndices[targetDepthValue - 1];

	if (nextPlayerIdx === undefined || targetPlayerIdx === undefined || startPoint >= targetDepthValue) {
		throw new Error(
			`splitAttempt: level ${level} (auto-play boundary ${startPoint}) and targetDepthValue (${targetDepthValue}) are inconsistent with the given path (${playerIndices.length} player moves found)`
		);
	}

	return {
		prefix: path.slice(0, nextPlayerIdx),
		quizSteps: path.slice(nextPlayerIdx, targetPlayerIdx + 1)
	};
}
