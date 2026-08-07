import type { Variation } from './variations';
import { activeLevel, isSatisfied, levelCap, levelTaskVariations, type Level } from './levels';

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
	// The "N solved out of M" stat shown on the practice screen: M is the
	// distinct tasks at the active level (a variation already finished by a
	// strictly earlier level doesn't count, and variations identical up to
	// this level's depth collapse into one task — see levelTaskVariations),
	// not the repertoire-wide totalVariations, which mixes in every level.
	levelTaskCount: number;
	levelSolvedCount: number;
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
	const totalLevels = levelCap(variations);
	const satisfiedCount =
		level === 'mastered'
			? variations.length
			: variations.filter((v) => isSatisfied(v, level, correctMoveIds)).length;

	// Once mastered there's no "active" level to score against — show the
	// final level's tasks as fully solved rather than mixing in every level.
	const displayLevel = level === 'mastered' ? totalLevels : level;
	const levelTasks = levelTaskVariations(variations, displayLevel);
	const levelSolvedCount = levelTasks.filter((v) => isSatisfied(v, displayLevel, correctMoveIds)).length;

	return {
		level,
		satisfiedCount,
		totalVariations: variations.length,
		totalLevels,
		levelTaskCount: levelTasks.length,
		levelSolvedCount
	};
}
