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

/** `variations` with any entry whose `variationKey` is in `excludedKeys` dropped. */
export function filterVariations(variations: Variation[], excludedKeys: ReadonlySet<string>): Variation[] {
	if (excludedKeys.size === 0) return variations;
	return variations.filter((v) => !excludedKeys.has(v.variationKey));
}

/**
 * A human-readable move-sequence preview for one variation, e.g.
 * "1.e4 e5 2.Nf3 Nc6 3.Bb5" — reads the real starting side-to-move and move
 * number from `path[0].fromFen` rather than assuming White's move 1, since a
 * repertoire chapter can start from a custom `[FEN "..."]` PGN header (see
 * `src/lib/pgn/parser.ts`) rather than the game's true beginning. A path that
 * opens on Black's move renders with an ellipsis (e.g. "5...Nf6 6.Bg5"),
 * matching standard chess notation for a mid-move-number start.
 */
export function moveSequenceLabel(path: VariationStep[]): string {
	if (path.length === 0) return '';

	const fenFields = path[0].fromFen.split(' ');
	let moveNumber = Number(fenFields[5]) || 1;
	let whiteToMove = fenFields[1] !== 'b';

	return path
		.map((step, i) => {
			const label =
				whiteToMove ? `${moveNumber}.${step.san}` : i === 0 ? `${moveNumber}...${step.san}` : step.san;
			if (!whiteToMove) moveNumber++;
			whiteToMove = !whiteToMove;
			return label;
		})
		.join(' ');
}
