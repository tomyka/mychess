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
	// `mastery/practice.test.ts`, `mastery/variationSequence.test.ts`) don't all
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
	// The step sequence shared by every item in this group, consumed since
	// wherever the caller last drilled in — spans more than one ply when
	// everything here agreed on the next move for a while before hitting a
	// real fork (or running out of moves). Empty for the "Other" catch-all
	// bucket, since its members don't share a next move by definition, and
	// for a leaf item that already ended exactly where a sibling still
	// continues.
	steps: VariationStep[];
	items: T[];
	// How many leading steps of `stepsOf(item)` this group has now fully
	// consumed (including everything already consumed before this call) —
	// pass straight back in as `depth` to drill one level deeper into this
	// group's own items.
	depth: number;
};

/**
 * How far `items` can be walked forward in lockstep from `depth`, stopping
 * the instant either (a) some item runs out of steps, or (b) they disagree
 * on the next one — i.e. the first point past `depth` where this exact pool
 * can no longer be treated as one undifferentiated group. Returns `depth`
 * itself if nothing could be walked at all (already exhausted or forked
 * right here).
 */
function extendUnanimousRun<T>(items: T[], stepsOf: (item: T) => VariationStep[], depth: number): number {
	let d = depth;
	while (true) {
		if (items.some((item) => stepsOf(item).length <= d)) return d;
		const moves = new Set(items.map((item) => stepsOf(item)[d].san));
		if (moves.size !== 1) return d;
		d++;
	}
}

/**
 * Groups `items` by where their future moves actually diverge, rather than
 * by a fixed single ply — a long run every remaining item agrees on
 * collapses into one group (label spanning however many plies were forced),
 * so a repertoire that's one deep, mostly-forced line doesn't present a
 * useless single "choice" at move one. Call again on a returned group's own
 * `items` (passing its `depth` back in) to drill one level deeper; a group
 * whose `items.length` is 1 has nothing further to reveal and should be
 * rendered as a leaf, not drilled into again.
 *
 * A call either:
 * - returns ONE group (the whole shared run from `depth` to wherever it
 *   first stops), still holding every item together, deferring the actual
 *   fork/leaf split to whoever drills into it next; or
 * - lands directly on a fork or an early-ending item and returns the
 *   already-partitioned branches, each extended as far as ITS OWN items
 *   still agree (so a branch uniquely followed by more forced moves gets
 *   them folded into its own label, instead of costing an extra empty
 *   drill-down step) — capped at the `topN` most frequent branches by item
 *   count, with everything else collapsed into a trailing "Other" group
 *   (`steps: []`) omitted entirely if nothing landed there. Ties in
 *   frequency are broken by first-appearance order (stable, deterministic).
 */
export function groupByBranchPoint<T>(
	items: T[],
	stepsOf: (item: T) => VariationStep[],
	depth: number,
	topN: number
): MoveGroup<T>[] {
	if (items.length === 0) return [];

	const extendedDepth = extendUnanimousRun(items, stepsOf, depth);
	if (extendedDepth > depth) {
		return [{ steps: stepsOf(items[0]).slice(depth, extendedDepth), items, depth: extendedDepth }];
	}

	const exhausted = items.filter((item) => stepsOf(item).length <= depth);
	const active = items.filter((item) => stepsOf(item).length > depth);

	const firstAppearanceOrder: string[] = [];
	const buckets = new Map<string, T[]>();
	for (const item of active) {
		const move = stepsOf(item)[depth].san;
		if (!buckets.has(move)) {
			firstAppearanceOrder.push(move);
			buckets.set(move, []);
		}
		buckets.get(move)!.push(item);
	}

	const topMoves = firstAppearanceOrder
		.slice()
		.sort((a, b) => buckets.get(b)!.length - buckets.get(a)!.length)
		.slice(0, topN);
	const topMoveSet = new Set(topMoves);

	const namedGroups: MoveGroup<T>[] = topMoves.map((move) => {
		const branchItems = buckets.get(move)!;
		const branchDepth = extendUnanimousRun(branchItems, stepsOf, depth + 1);
		return { steps: stepsOf(branchItems[0]).slice(depth, branchDepth), items: branchItems, depth: branchDepth };
	});

	const otherItems = firstAppearanceOrder.filter((m) => !topMoveSet.has(m)).flatMap((m) => buckets.get(m)!);
	const otherGroup: MoveGroup<T> | null = otherItems.length > 0 ? { steps: [], items: otherItems, depth } : null;

	const leafGroups: MoveGroup<T>[] = exhausted.map((item) => ({ steps: [], items: [item], depth }));

	return [...leafGroups, ...namedGroups, ...(otherGroup ? [otherGroup] : [])];
}
