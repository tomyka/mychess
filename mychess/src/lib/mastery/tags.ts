// src/lib/mastery/tags.ts
import type { Level } from './levels';

export type LevelTag = 'Beginner' | 'Regular' | 'Advanced' | 'Expert';

// [Beginner, Regular, Advanced, Expert] level counts, for totalLevels 1..7.
// Tier sizes grow in a fixed order as totalLevels increases: Regular appears
// at 4, Regular grows at 5, Beginner grows at 6, Advanced grows at 7. Beyond
// 7, Expert absorbs every additional level (see tierSizes below).
const TIER_SIZES: Record<number, [number, number, number, number]> = {
	1: [1, 0, 0, 0],
	2: [1, 0, 1, 0],
	3: [1, 0, 1, 1],
	4: [1, 1, 1, 1],
	5: [1, 2, 1, 1],
	6: [2, 2, 1, 1],
	7: [2, 2, 2, 1]
};

function tierSizes(totalLevels: number): [number, number, number, number] {
	if (totalLevels <= 0) return [0, 0, 0, 0];
	if (totalLevels <= 7) return TIER_SIZES[totalLevels];
	const [b, r, a] = TIER_SIZES[7];
	return [b, r, a, totalLevels - (b + r + a)]; // Expert absorbs everything beyond 7
}

/** The difficulty tag for `level` within a repertoire that has `totalLevels` levels in total. */
export function levelTag(level: Level, totalLevels: number): LevelTag {
	const [b, r, a] = tierSizes(totalLevels);
	if (level <= b) return 'Beginner';
	if (level <= b + r) return 'Regular';
	if (level <= b + r + a) return 'Advanced';
	return 'Expert';
}
