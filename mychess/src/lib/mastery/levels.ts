// mychess/src/lib/mastery/levels.ts
export type Level = 1 | 2 | 3 | 4 | 5;

const LEVEL_DEPTHS: Record<Level, number> = { 1: 4, 2: 6, 3: 8, 4: 10, 5: Infinity };
const LEVELS: Level[] = [1, 2, 3, 4, 5];

export function levelDepth(level: Level): number {
	return LEVEL_DEPTHS[level];
}

/** The depth this variation must reach at this level — capped by its own natural length. */
export function targetDepth(variation: { playerMoveCount: number }, level: Level): number {
	return Math.min(variation.playerMoveCount, levelDepth(level));
}

export function isSatisfied(
	variation: { playerMoveCount: number },
	level: Level,
	deepestReached: number
): boolean {
	return deepestReached >= targetDepth(variation, level);
}

export type VariationProgress = { playerMoveCount: number; deepestReached: number };

/**
 * The highest level where every variation is satisfied, or 0 if none.
 * Target depth is non-decreasing as level increases, so once a level fails
 * to be fully satisfied, no higher level can be either — safe to stop there.
 */
export function currentLevel(variations: VariationProgress[]): 0 | Level {
	let level: 0 | Level = 0;
	for (const l of LEVELS) {
		const allSatisfied = variations.every((v) => isSatisfied(v, l, v.deepestReached));
		if (allSatisfied) {
			level = l;
		} else {
			break;
		}
	}
	return level;
}

/** The level to practice next, or 'mastered' once every variation satisfies level 5. */
export function activeLevel(variations: VariationProgress[]): Level | 'mastered' {
	const level = currentLevel(variations);
	if (level === 5) return 'mastered';
	return (level + 1) as Level;
}
