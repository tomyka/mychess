export type RawMoveRow = {
	id: string;
	fromPositionId: string;
	toPositionId: string;
	fromFen: string;
	toFen: string;
	san: string;
	isPlayerTurn: boolean;
	// Optional (not just nullable) so the many pre-existing test fixtures
	// across the codebase that hand-construct these types (e.g.
	// `mastery/practice.test.ts`, `mastery/levelProgress.test.ts`) don't all
	// need updating for a field they have no reason to care about — an
	// omitted `chapterName` is treated identically to an explicit `null`
	// everywhere it's read (see `RepertoirePracticeRow.svelte`'s grouping and
	// the `/variations` endpoint's `?? null` normalization).
	chapterName?: string | null;
};

export type VariationStep = {
	moveId: string;
	san: string;
	fromFen: string;
	toFen: string;
	isPlayerTurn: boolean;
	chapterName?: string | null;
};

export type Variation = {
	leafMoveId: string;
	variationKey: string;
	path: VariationStep[];
	playerMoveCount: number;
	// The originating PGN chapter's own bare title, carried from this
	// variation's leaf move (see `MoveRow.isChapterEnd` in `$lib/pgn-import.ts`
	// for how it's tagged at import time). Undefined/null for any variation
	// whose leaf isn't a tagged chapter-end — every variation of a
	// repertoire imported before chapter tagging existed, or of a
	// single-chapter import, where grouping doesn't apply.
	chapterName?: string | null;
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
					playerMoveCount,
					chapterName: path[path.length - 1].chapterName
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
				isPlayerTurn: move.isPlayerTurn,
				chapterName: move.chapterName
			};
			walk(move.toPositionId, [...path, step], playerMoveCount + (move.isPlayerTurn ? 1 : 0));
		}
	}

	for (const root of roots) {
		walk(root, [], 0);
	}

	return variations;
}

/**
 * True if any variation came from a chapter-tagged PGN import (see
 * `chapterName` above) — used to decide whether the Practice picker offers
 * chapter-selection UI at all for a repertoire, versus treating it as one
 * indivisible unit (see `repertoires.has_chapters`, migration 0043).
 */
export function hasChapterTags(variations: Variation[]): boolean {
	return variations.some((v) => v.chapterName != null);
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

export type MoveGroup<T> = {
	// null identifies the "Other" bucket — every item whose first move didn't
	// make the top N by frequency.
	move: string | null;
	items: T[];
};

/**
 * Buckets `items` by whatever `firstMoveOf` returns for each one, keeping
 * only the `topN` most frequent distinct first moves as their own named
 * groups (in descending frequency order) and collapsing everything else into
 * one trailing "Other" group (`move: null`) — omitted entirely if nothing
 * landed there. Ties in frequency are broken by first-appearance order in
 * `items` (stable, deterministic — `Array.prototype.sort` is
 * spec-guaranteed stable), so re-running this against the same input always
 * produces the same grouping.
 */
export function groupByFirstMove<T>(
	items: T[],
	firstMoveOf: (item: T) => string | null,
	topN: number
): MoveGroup<T>[] {
	const firstAppearanceOrder: string[] = [];
	const counts = new Map<string, number>();
	for (const item of items) {
		const san = firstMoveOf(item);
		if (!san) continue;
		if (!counts.has(san)) firstAppearanceOrder.push(san);
		counts.set(san, (counts.get(san) ?? 0) + 1);
	}

	const topMoves = firstAppearanceOrder
		.slice()
		.sort((a, b) => counts.get(b)! - counts.get(a)!)
		.slice(0, topN);
	const topMoveSet = new Set(topMoves);

	const groups: MoveGroup<T>[] = topMoves.map((move) => ({ move, items: [] }));
	const groupByMove = new Map(groups.map((g) => [g.move, g]));
	const other: MoveGroup<T> = { move: null, items: [] };

	for (const item of items) {
		const san = firstMoveOf(item);
		const target = san && topMoveSet.has(san) ? groupByMove.get(san)! : other;
		target.items.push(item);
	}

	return other.items.length > 0 ? [...groups, other] : groups;
}

/** `groupByFirstMove` specialized for `Variation[]`, using each variation's own first move (`path[0].san`). */
export function groupVariationsByFirstMove(variations: Variation[], topN: number): MoveGroup<Variation>[] {
	return groupByFirstMove(variations, (v) => v.path[0]?.san ?? null, topN);
}
