// mychess/src/lib/mastery/practice.ts
import type { Variation, VariationStep } from './variations';
import { isSatisfied, targetDepth, type Level } from './levels';

export type PracticeVariation = Variation & { deepestReached: number };

export type PracticeAttempt = {
	variation: PracticeVariation;
	startPoint: number;
	targetDepth: number;
};

/**
 * Picks a random not-yet-satisfied variation at `level`, and a random start
 * point between 0 and its target depth (exclusive) — sometimes a full replay
 * from the beginning, usually a shorter tail probe. Returns null once every
 * variation is already satisfied at this level.
 */
export function pickPracticeAttempt(
	variations: PracticeVariation[],
	level: Level,
	random: () => number = Math.random
): PracticeAttempt | null {
	const candidates = variations.filter((v) => !isSatisfied(v, level, v.deepestReached));
	if (candidates.length === 0) return null;

	const chosen = candidates[Math.floor(random() * candidates.length)];
	const target = targetDepth(chosen, level);
	const startPoint = Math.floor(random() * target);

	return { variation: chosen, startPoint, targetDepth: target };
}

/**
 * Splits a variation's path into the auto-played `prefix` (everything before
 * the player's (startPoint+1)th move) and the `quizSteps` the player walks
 * through interactively — their own moves to be checked, with the book's
 * opponent replies auto-played in between — stopping right after the
 * targetDepth-th player move (not continuing into the rest of the line).
 */
export function splitAttempt(
	path: VariationStep[],
	startPoint: number,
	targetDepthValue: number
): { prefix: VariationStep[]; quizSteps: VariationStep[] } {
	const playerIndices: number[] = [];
	path.forEach((step, i) => {
		if (step.isPlayerTurn) playerIndices.push(i);
	});

	const nextPlayerIdx = playerIndices[startPoint];
	const targetPlayerIdx = playerIndices[targetDepthValue - 1];

	if (nextPlayerIdx === undefined || targetPlayerIdx === undefined || startPoint >= targetDepthValue) {
		throw new Error(
			`splitAttempt: startPoint (${startPoint}) and targetDepthValue (${targetDepthValue}) are inconsistent with the given path (${playerIndices.length} player moves found)`
		);
	}

	return {
		prefix: path.slice(0, nextPlayerIdx),
		quizSteps: path.slice(nextPlayerIdx, targetPlayerIdx + 1)
	};
}
