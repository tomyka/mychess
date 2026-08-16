export type RawMoveRow = {
	id: string;
	fromPositionId: string;
	toPositionId: string;
	fromFen: string;
	toFen: string;
	san: string;
	isPlayerTurn: boolean;
	// Every chapter that uses this edge — not just the one whose line ends
	// on it. A shared prefix move used by many transposing chapters carries
	// all of them. Optional (not just possibly-empty) so the many
	// pre-existing test fixtures across the codebase that hand-construct
	// these types (e.g. `mastery/practice.test.ts`,
	// `mastery/variationSequence.test.ts`) don't all need updating for a
	// field they have no reason to care about — an omitted `chapterNames` is
	// treated identically to `[]` everywhere it's read.
	chapterNames?: string[];
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
	// The chapter this variation was enumerated under — every variation from
	// one `enumerateVariationsScoped()` call carries the same chapterName,
	// stamped directly by that walk rather than derived from the leaf move.
	// Null for the un-chaptered (no chapter tier) case.
	chapterName?: string | null;
};

/**
 * Every distinct chapter name appearing in any move's `chapterNames`, in
 * first-appearance order (stable, deterministic — matters for the practice
 * picker's chapter list staying in a consistent order across reloads).
 */
function uniqueChapterNames(moves: RawMoveRow[]): string[] {
	const seen = new Set<string>();
	const names: string[] = [];
	for (const m of moves) {
		for (const name of m.chapterNames ?? []) {
			if (!seen.has(name)) {
				seen.add(name);
				names.push(name);
			}
		}
	}
	return names;
}

/**
 * The actual tree-walk, scoped to exactly one chapter's own edges (or, for
 * `chapterName: null`, every move that belongs to no chapter at all — the
 * un-chaptered case). Walking only one chapter's own edges at a time is what
 * keeps cross-chapter transposition from multiplying the enumerated path
 * count: a shared position reached by two different chapters' own openings
 * is only ever explored within ONE chapter's own scoped walk at a time, never
 * both together.
 */
function enumerateVariationsScoped(moves: RawMoveRow[], chapterName: string | null): Variation[] {
	const scoped = moves.filter((m) =>
		chapterName === null ? (m.chapterNames ?? []).length === 0 : (m.chapterNames ?? []).includes(chapterName)
	);

	const byFrom = new Map<string, RawMoveRow[]>();
	const toPositionIds = new Set<string>();
	for (const m of scoped) {
		const list = byFrom.get(m.fromPositionId) ?? [];
		list.push(m);
		byFrom.set(m.fromPositionId, list);
		toPositionIds.add(m.toPositionId);
	}

	const fromPositionIds = new Set(scoped.map((m) => m.fromPositionId));
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
					chapterName
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
				chapterName
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
 * Walks a repertoire's move tree and returns one entry per leaf (a complete
 * root-to-leaf path). A branch — whether the opponent has multiple replies,
 * or the repertoire itself prepares two responses at one node — produces two
 * separate variations sharing the common prefix up to the branch point.
 *
 * Chaptered repertoires are walked ONE CHAPTER AT A TIME (see
 * `enumerateVariationsScoped`) and concatenated, rather than as one
 * whole-repertoire walk — multiple PGN chapters imported into one repertoire
 * share position/move rows wherever they transpose into the same edge, and a
 * single walk across the merged graph re-enumerates every downstream path
 * once per way of reaching a shared position, multiplying the total count at
 * every such reconvergence instead of summing per chapter. Un-chaptered
 * repertoires (no move carries any chapter name) fall through to a single
 * scoped walk with `chapterName: null` — identical to the old unscoped
 * behavior, since there's nothing to separate.
 */
export function enumerateVariations(moves: RawMoveRow[]): Variation[] {
	const chapterNames = uniqueChapterNames(moves);
	if (chapterNames.length === 0) return enumerateVariationsScoped(moves, null);
	return chapterNames.flatMap((name) => enumerateVariationsScoped(moves, name));
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
 * The move-row ids composing `variationKey`, in root-to-leaf order — the
 * inverse of how `enumerateVariations` builds one
 * (`path.map((s) => s.moveId).join('>')`). Used to cheaply confirm a
 * submitted key's moves genuinely belong to a given repertoire without
 * needing to fetch every move and re-walk the whole tree (see
 * `validateVariationKeysOwnership` in `$lib/server/practice-repertoire`).
 */
export function moveIdsInVariationKey(variationKey: string): string[] {
	return variationKey.split('>');
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
	// The first `steps` shared by every item in this group's key (up to
	// FIRST_MOVES_GROUP_PLIES, or fewer if a member's own line is shorter).
	// Empty only for the trailing "Other" catch-all bucket, since its
	// members don't share a single key by definition.
	steps: VariationStep[];
	items: T[];
};

/** 5 full moves (White + Black each) — the fixed window `groupByFirstMoves` keys on. */
export const FIRST_MOVES_GROUP_PLIES = 10;

/**
 * Buckets `items` by their own first `plies` steps (or their whole line, if
 * shorter) as a single combined key — e.g. two lines that both start
 * "1.e4 c6 2.d4 d5 3.exd5 cxd5 4.Nf3 Nc6 5.c3" land in the same bucket even
 * though they already diverged back at move 1 from a third line that opened
 * "1.d4"; two lines that agree for the first 4 moves but diverge on the 5th
 * land in DIFFERENT buckets. This is a fixed-depth partition, not a search
 * for wherever lines happen to diverge — every bucket's key is exactly
 * `plies` steps long (or the item's full line, if that's shorter), so drilling
 * into a bucket reveals its individual items directly; there's no further
 * "where do these split" tier to navigate. Keeps only the `topN` most
 * frequent distinct keys (by item count), collapsing the rest into a
 * trailing "Other" bucket (`steps: []`) — omitted entirely if nothing landed
 * there. Ties in frequency are broken by first-appearance order (stable,
 * deterministic).
 */
export function groupByFirstMoves<T>(
	items: T[],
	stepsOf: (item: T) => VariationStep[],
	plies: number,
	topN: number
): MoveGroup<T>[] {
	if (items.length === 0) return [];

	const keyOf = (item: T) =>
		stepsOf(item)
			.slice(0, plies)
			.map((s) => s.san)
			.join('>');

	const firstAppearanceOrder: string[] = [];
	const buckets = new Map<string, T[]>();
	for (const item of items) {
		const key = keyOf(item);
		if (!buckets.has(key)) {
			firstAppearanceOrder.push(key);
			buckets.set(key, []);
		}
		buckets.get(key)!.push(item);
	}

	const topKeys = firstAppearanceOrder
		.slice()
		.sort((a, b) => buckets.get(b)!.length - buckets.get(a)!.length)
		.slice(0, topN);
	const topKeySet = new Set(topKeys);

	const namedGroups: MoveGroup<T>[] = topKeys.map((key) => {
		const groupItems = buckets.get(key)!;
		return { steps: stepsOf(groupItems[0]).slice(0, plies), items: groupItems };
	});

	const otherItems = firstAppearanceOrder.filter((k) => !topKeySet.has(k)).flatMap((k) => buckets.get(k)!);
	const otherGroup: MoveGroup<T> | null = otherItems.length > 0 ? { steps: [], items: otherItems } : null;

	return [...namedGroups, ...(otherGroup ? [otherGroup] : [])];
}
