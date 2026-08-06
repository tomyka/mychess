import type { Variation } from './variations';
import { activeLevel, isSatisfied, levelCap, type Level } from './levels';

export type MoveProgressRow = { move_id: string; state: string };

/** Builds the Set of move ids the player has ever played correctly, from raw `move_progress` rows. */
export function correctMoveIdSet(rows: MoveProgressRow[]): Set<string> {
	return new Set(rows.filter((r) => r.state === 'correct').map((r) => r.move_id));
}

export type RepertoireProgress = {
	level: Level | 'mastered';
	satisfiedCount: number;
	totalVariations: number;
	totalLevels: number;
};

/**
 * Combines a repertoire's enumerated variations with its raw `move_progress`
 * rows into the summary both `/practice` (the picker) and
 * `/practice/[repertoire_id]` (the detail screen) need: the active level (or
 * "mastered"), how many variations are already satisfied at that level, and
 * the repertoire's total level count (for "Level X of Y" displays and the
 * level list).
 */
export function repertoireProgress(variations: Variation[], rows: MoveProgressRow[]): RepertoireProgress {
	const correctMoveIds = correctMoveIdSet(rows);
	const level = activeLevel(variations, correctMoveIds);
	const satisfiedCount =
		level === 'mastered'
			? variations.length
			: variations.filter((v) => isSatisfied(v, level, correctMoveIds)).length;
	return {
		level,
		satisfiedCount,
		totalVariations: variations.length,
		totalLevels: levelCap(variations)
	};
}
