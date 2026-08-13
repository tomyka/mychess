// mychess/src/lib/mastery/levels.ts
/**
 * Levels are uniform chunks of a configurable size (see `repertoires.chunk_size`,
 * threaded through every function here as `chunkSize`) with no fixed ceiling:
 * L*n* covers the player's own moves 1 through *n* * chunkSize.
 */
export type Level = number;

type VariationLike = {
	playerMoveCount: number;
	path: { moveId: string; isPlayerTurn: boolean }[];
};

export function levelDepth(level: Level, chunkSize: number): number {
	return level * chunkSize;
}

/** The depth this variation must reach at this level — capped by its own natural length. */
export function targetDepth(variation: { playerMoveCount: number }, level: Level, chunkSize: number): number {
	return Math.min(variation.playerMoveCount, levelDepth(level, chunkSize));
}

/** Whether `variation` still has any content left to ask at `level` (i.e. a strictly earlier level hasn't already fully covered it). */
export function hasContentAtLevel(variation: { playerMoveCount: number }, level: Level, chunkSize: number): boolean {
	return variation.playerMoveCount > levelDepth(level - 1, chunkSize);
}

/**
 * The move a variation's target-depth prefix ends on, at `level` — the
 * stable identity of the "task" a level presents. The moves table is a
 * shared tree, so two variations that reach the same move id here have an
 * identical path up to this depth: solving one solves both.
 */
export function taskKey(variation: VariationLike, level: Level, chunkSize: number): string {
	const target = targetDepth(variation, level, chunkSize);
	let playerMovesSeen = 0;
	for (const step of variation.path) {
		if (!step.isPlayerTurn) continue;
		playerMovesSeen++;
		if (playerMovesSeen === target) return step.moveId;
	}
	return variation.path.at(-1)?.moveId ?? '';
}

/**
 * The distinct tasks that exist at `level`: variations with content
 * remaining there (a variation a strictly earlier level already fully
 * covers drops out), deduplicated by `taskKey` — two variations identical
 * up to this level's depth are the same task, since solving one solves both.
 */
export function levelTaskVariations(variations: VariationLike[], level: Level, chunkSize: number): VariationLike[] {
	const relevant = variations.filter((v) => hasContentAtLevel(v, level, chunkSize));
	const seen = new Map<string, VariationLike>();
	for (const v of relevant) {
		const key = taskKey(v, level, chunkSize);
		if (!seen.has(key)) seen.set(key, v);
	}
	return [...seen.values()];
}

function maxPlayerMoveCount(variations: VariationLike[]): number {
	return variations.reduce((max, v) => Math.max(max, v.playerMoveCount), 0);
}

/**
 * The number of levels a repertoire has: the level whose depth first covers
 * every variation's full length. 0 for an empty variation list (nothing to
 * level).
 */
export function levelCap(variations: VariationLike[], chunkSize: number): number {
	return Math.ceil(maxPlayerMoveCount(variations) / chunkSize);
}
