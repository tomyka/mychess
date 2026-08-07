// mychess/src/lib/mastery/levels.ts
/**
 * Levels are uniform 3-move chunks with no fixed ceiling: L*n* covers the
 * player's own moves 1 through 3*n*. Replaces the old {4,6,8,10,∞} scheme.
 */
export type Level = number;

type VariationLike = {
	playerMoveCount: number;
	path: { moveId: string; isPlayerTurn: boolean }[];
};

export function levelDepth(level: Level): number {
	return level * 3;
}

/** The depth this variation must reach at this level — capped by its own natural length. */
export function targetDepth(variation: { playerMoveCount: number }, level: Level): number {
	return Math.min(variation.playerMoveCount, levelDepth(level));
}

/**
 * A variation is satisfied at `level` when every one of the player's own
 * moves along its path, up to `targetDepth`, has a 'correct' entry in
 * `correctMoveIds` — the Set of move ids the player has ever played
 * correctly (built from `move_progress` by `src/lib/mastery/moveProgress.ts`).
 * Unlike the old stored-depth-number model, this can have "gaps": a move
 * later in the line can be correct while an earlier one in the same
 * variation is still 'new' (e.g. marked via a shared prefix from a
 * different variation, or via Master mode) — so every move up to the target
 * depth is checked individually, not just a single frontier number.
 */
export function isSatisfied(
	variation: VariationLike,
	level: Level,
	correctMoveIds: Set<string>
): boolean {
	const target = targetDepth(variation, level);
	let playerMovesSeen = 0;
	for (const step of variation.path) {
		if (!step.isPlayerTurn) continue;
		playerMovesSeen++;
		if (playerMovesSeen > target) break;
		if (!correctMoveIds.has(step.moveId)) return false;
	}
	return true;
}

/**
 * The move a variation's target-depth prefix ends on, at `level`. The moves
 * table is a shared tree, so two variations that reach the same move id here
 * have an identical path up to this depth — the same underlying moves, not
 * just coincidentally equal ones.
 */
function levelPrefixKey(variation: VariationLike, level: Level): string {
	const target = targetDepth(variation, level);
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
 * covers drops out), deduplicated by their shared prefix up to this level's
 * depth — two variations identical up to here are the same task, since
 * solving one solves both (see `levelPrefixKey`). This is what "N solved
 * out of M" on the practice screen should count — not the repertoire's
 * total variation count, which mixes in every other level's lines too.
 */
export function levelTaskVariations(variations: VariationLike[], level: Level): VariationLike[] {
	const relevant = variations.filter((v) => v.playerMoveCount > levelDepth(level - 1));
	const seen = new Map<string, VariationLike>();
	for (const v of relevant) {
		const key = levelPrefixKey(v, level);
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
export function levelCap(variations: VariationLike[]): number {
	return Math.ceil(maxPlayerMoveCount(variations) / 3);
}

/**
 * The highest level where every variation is satisfied, or 0 if none.
 * Target depth is non-decreasing as level increases, so once a level fails
 * to be fully satisfied, no higher level can be either — safe to stop there.
 * The search only needs to go up to the level whose depth covers the
 * longest variation in the repertoire (`cap`) — beyond that, no variation's
 * target depth changes, so no higher level could ever newly satisfy.
 */
export function currentLevel(variations: VariationLike[], correctMoveIds: Set<string>): number {
	const cap = levelCap(variations);
	let level = 0;
	for (let l = 1; l <= cap; l++) {
		if (variations.every((v) => isSatisfied(v, l, correctMoveIds))) {
			level = l;
		} else {
			break;
		}
	}
	return level;
}

/**
 * The level to practice next, or 'mastered' once every variation's full
 * length is covered (equivalently: once `currentLevel` reaches `cap`,
 * including the vacuous case of an empty variation list — nothing to master).
 */
export function activeLevel(
	variations: VariationLike[],
	correctMoveIds: Set<string>
): Level | 'mastered' {
	const cap = levelCap(variations);
	const level = currentLevel(variations, correctMoveIds);
	return level >= cap ? 'mastered' : level + 1;
}
