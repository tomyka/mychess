export type RawMoveRow = {
	id: string;
	fromPositionId: string;
	toPositionId: string;
	fromFen: string;
	toFen: string;
	san: string;
	isPlayerTurn: boolean;
};

export type VariationStep = {
	moveId: string;
	san: string;
	fromFen: string;
	toFen: string;
	isPlayerTurn: boolean;
};

export type Variation = {
	leafMoveId: string;
	variationKey: string;
	path: VariationStep[];
	playerMoveCount: number;
};

/**
 * Walks a repertoire's move tree and returns one entry per leaf (a complete
 * root-to-leaf path). A branch — whether the opponent has multiple replies,
 * or the repertoire itself prepares two responses at one node — produces two
 * separate variations sharing the common prefix up to the branch point.
 */
export function enumerateVariations(moves: RawMoveRow[]): Variation[] {
	const byFrom = new Map<string, RawMoveRow[]>();
	const toPositionIds = new Set<string>();
	for (const m of moves) {
		const list = byFrom.get(m.fromPositionId) ?? [];
		list.push(m);
		byFrom.set(m.fromPositionId, list);
		toPositionIds.add(m.toPositionId);
	}

	const fromPositionIds = new Set(moves.map((m) => m.fromPositionId));
	const roots = Array.from(fromPositionIds).filter((id) => !toPositionIds.has(id));

	const variations: Variation[] = [];

	function walk(positionId: string, path: VariationStep[], playerMoveCount: number) {
		const outgoing = byFrom.get(positionId) ?? [];
		if (outgoing.length === 0) {
			if (path.length > 0) {
				variations.push({
					leafMoveId: path[path.length - 1].moveId,
					variationKey: path.map((s) => s.moveId).join('>'),
					path,
					playerMoveCount
				});
			}
			return;
		}
		for (const move of outgoing) {
			const step: VariationStep = {
				moveId: move.id,
				san: move.san,
				fromFen: move.fromFen,
				toFen: move.toFen,
				isPlayerTurn: move.isPlayerTurn
			};
			walk(move.toPositionId, [...path, step], playerMoveCount + (move.isPlayerTurn ? 1 : 0));
		}
	}

	for (const root of roots) {
		walk(root, [], 0);
	}

	return variations;
}
