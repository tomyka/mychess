import { ceilingPlyFor } from './teaching';

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
};

export type Variation = {
	leafMoveId: string;
	variationKey: string;
	path: VariationStep[];
	playerMoveCount: number;
	// EVERY chapter this line appears in, in first-appearance order — a line
	// cross-referenced by two chapters (a shared tabiya) is ONE variation
	// carrying both names, not two variations sharing one `variationKey`.
	// Empty (never null/undefined) means the line is untagged: it belongs to
	// no chapter at all, which is both the whole-repertoire pre-0048 case and
	// the untagged remainder of a mixed repertoire.
	chapterNames: string[];
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
 * The ordered list of scopes `enumerateVariations` walks, one at a time: every
 * chapter in `moves`' own first-appearance order, then `null` (the untagged
 * scope) LAST.
 *
 * The untagged scope is included whenever any move carries no chapter tag —
 * not only when NOTHING is tagged. That distinction is the whole fix for the
 * "untagged lines silently vanish" bug: a MIXED repertoire (a chaptered import
 * appended onto pre-0048 untagged moves) used to have its untagged lines
 * walked by no scope at all, since the chaptered scopes filter them out and the
 * `null` scope was only reached when the chapter list was empty. It is also
 * pushed for a repertoire with no chapters at all, where it is the only scope
 * and reproduces the original unscoped walk exactly.
 *
 * Pure and deterministic — the resulting order is what makes
 * `enumerateVariations`' merge order stable across reloads (see its doc).
 */
export function variationScopes(moves: RawMoveRow[]): Array<string | null> {
	const scopes: Array<string | null> = [...uniqueChapterNames(moves)];
	const hasUntagged = moves.some((m) => (m.chapterNames ?? []).length === 0);
	if (hasUntagged || scopes.length === 0) scopes.push(null);
	return scopes;
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
			// `playerMoveCount > 0`, not just a non-empty path: a line the player
			// never moves in (an opponent branch with no prepared reply — common
			// where a PGN chapter stops right after the opponent's move) can
			// never be drilled or solved. Served, it auto-plays its opponent
			// plies and then waits in 'playing' for a move that doesn't exist,
			// rejecting everything; counted, it makes a repertoire that is fully
			// learned read as permanently incomplete.
			if (playerMoveCount > 0) {
				variations.push({
					leafMoveId: path[path.length - 1].moveId,
					variationKey: path.map((s) => s.moveId).join('>'),
					path,
					playerMoveCount,
					// A fresh array per variation — `enumerateVariations` pushes
					// onto the surviving one while merging, so two variations
					// must never share the same array instance.
					chapterNames: chapterName === null ? [] : [chapterName]
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

/**
 * Walks a repertoire's move tree and returns one entry per leaf (a complete
 * root-to-leaf path). A branch — whether the opponent has multiple replies,
 * or the repertoire itself prepares two responses at one node — produces two
 * separate variations sharing the common prefix up to the branch point.
 *
 * Chaptered repertoires are walked ONE CHAPTER AT A TIME (see
 * `enumerateVariationsScoped`) rather than as one whole-repertoire walk —
 * multiple PGN chapters imported into one repertoire share position/move rows
 * wherever they transpose into the same edge, and a single walk across the
 * merged graph re-enumerates every downstream path once per way of reaching a
 * shared position, multiplying the total count at every such reconvergence
 * instead of summing per chapter. Un-chaptered repertoires (no move carries
 * any chapter name) fall through to a single scoped walk over the untagged
 * scope — identical to the old unscoped behavior, since there's nothing to
 * separate.
 *
 * The per-chapter results are then MERGED by `variationKey` rather than
 * concatenated: a line belonging to N chapters is walked once per chapter (that
 * is what bounds the work) but returned as ONE variation whose `chapterNames`
 * lists all N. Concatenating instead emitted the same key N times, and every
 * consumer treats one key as one entry — duplicates made `nextVariation`'s
 * `findIndex` alternate between copies forever inside `advanceIfSolved`, let
 * one progress row silently stand in for every chapter's copy, and inflated
 * `variations.length` (the source of `repertoires.total_variations`).
 *
 * Order is deterministic: chapters run in `variationScopes`' order (first
 * appearance across `moves`, untagged last), and a line lands at the position
 * of the FIRST scope that reached it.
 */
export function enumerateVariations(moves: RawMoveRow[]): Variation[] {
	const byKey = new Map<string, Variation>();
	for (const scope of variationScopes(moves)) {
		for (const v of enumerateVariationsScoped(moves, scope)) {
			const existing = byKey.get(v.variationKey);
			if (!existing) {
				byKey.set(v.variationKey, v);
			} else if (scope !== null && !existing.chapterNames.includes(scope)) {
				// Safe to push: every scoped walk stamps a freshly-built array,
				// so `existing.chapterNames` is owned by `existing` alone.
				existing.chapterNames.push(scope);
			}
		}
	}
	return [...byKey.values()];
}

/**
 * True if any variation came from a chapter-tagged PGN import (see
 * `chapterNames` above) — used to decide whether the Practice picker offers
 * chapter-selection UI at all for a repertoire, versus treating it as one
 * indivisible unit (see `repertoires.has_chapters`, migration 0043).
 */
export function hasChapterTags(variations: Variation[]): boolean {
	return variations.some((v) => v.chapterNames.length > 0);
}

/**
 * The chapter tier's label for lines belonging to no chapter at all. A mixed
 * repertoire (a chaptered PGN import appended onto older untagged moves) has
 * both kinds; without an explicit bucket its untagged lines match no chapter
 * name and would be unreachable in the practice picker — the same invisibility
 * as the enumeration bug, just moved into the UI.
 *
 * Phrased as a sentence fragment rather than a plausible opening name so it
 * can't realistically collide with a real PGN chapter heading — and if one ever
 * does collide, `isInChapterTier` degrades into a single merged bucket holding
 * both that chapter's lines and the untagged ones, rather than rendering the
 * same tier twice.
 */
export const UNTAGGED_CHAPTER = 'Lines without a chapter';

/**
 * The chapter tier to render for a set of variation rows: every chapter any row
 * belongs to, in first-appearance order, plus `UNTAGGED_CHAPTER` LAST when some
 * row belongs to none.
 *
 * `null` means NO row carries a chapter at all — the caller should skip the
 * chapter tier entirely and group the flat pool directly, rather than render a
 * single all-encompassing bucket. Note that's specifically "no chapters
 * anywhere", not "some rows are untagged": a mixed repertoire still gets a
 * chapter tier, with its untagged rows in the `UNTAGGED_CHAPTER` bucket.
 *
 * Shared by `RepertoirePracticeRow` and `VariationPicker` so the two can never
 * disagree about what counts as chaptered, or order chapters differently.
 */
export function chapterTiers(rows: Array<{ chapterNames: string[] }>): string[] | null {
	if (rows.every((r) => r.chapterNames.length === 0)) return null;
	const names: string[] = [];
	for (const r of rows) {
		for (const name of r.chapterNames) {
			if (!names.includes(name)) names.push(name);
		}
	}
	if (rows.some((r) => r.chapterNames.length === 0) && !names.includes(UNTAGGED_CHAPTER)) {
		names.push(UNTAGGED_CHAPTER);
	}
	return names;
}

/**
 * Whether one row belongs to one tier from `chapterTiers` — membership, not
 * equality, since one line can belong to several chapters (see
 * `Variation.chapterNames`) and must show, and toggle, under each of them.
 */
export function isInChapterTier(row: { chapterNames: string[] }, tier: string): boolean {
	return (tier === UNTAGGED_CHAPTER && row.chapterNames.length === 0) || row.chapterNames.includes(tier);
}

/** `rows` filtered to one tier from `chapterTiers` (see `isInChapterTier`). */
export function rowsInChapterTier<T extends { chapterNames: string[] }>(rows: T[], tier: string): T[] {
	return rows.filter((r) => isInChapterTier(r, tier));
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

/** One row of a chess.com-style move grid: a full move number plus White's and Black's SAN. */
export type MoveRow = { number: number; white: string; black: string | null };

/**
 * Structured form of `moveSequenceLabel`, for rendering a real move-number
 * grid instead of a wrapped string. Same rules: reads the true starting side
 * to move and move number from `path[0].fromFen`, so a chapter that opens on
 * Black's move produces a leading row with an empty White cell (the grid's
 * equivalent of the label's "5...Nf6" ellipsis) rather than assuming White
 * moved first. A path ending on White to move (odd ply count) leaves the
 * trailing row's Black cell `null`.
 */
export function moveSequenceRows(path: VariationStep[]): MoveRow[] {
	if (path.length === 0) return [];

	const fenFields = path[0].fromFen.split(' ');
	let moveNumber = Number(fenFields[5]) || 1;
	let whiteToMove = fenFields[1] !== 'b';

	const rows: MoveRow[] = [];
	let openRow: MoveRow | null = null;
	for (const step of path) {
		if (whiteToMove) {
			openRow = { number: moveNumber, white: step.san, black: null };
			rows.push(openRow);
		} else {
			if (openRow && openRow.number === moveNumber) {
				openRow.black = step.san;
			} else {
				rows.push({ number: moveNumber, white: '', black: step.san });
			}
			moveNumber++;
		}
		whiteToMove = !whiteToMove;
	}
	return rows;
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

/**
 * Buckets variations that currently extend past the teaching ceiling by their
 * own shared prefix, clipped to exactly where `ceilingMoveCount` lands within
 * each item's own path (`ceilingPlyFor` — never a fixed depth, since a
 * batch's ply length depends on whose move it lands on). Two items land in
 * the same group only when their clipped prefixes are the SAME underlying
 * moves, compared by `moveId` rather than SAN text — matching exactly what
 * `knownProgressFor`'s shared-credit mechanic already treats as
 * interchangeable, so a group's members are always the same set of
 * variations that teaching one of them credits for every other (GitHub issue
 * #165).
 *
 * Unlike `groupByFirstMoves`, there is no fixed window and no top-N cap:
 * every distinct clipped prefix becomes its own group, in first-appearance
 * order. Callers should only pass items whose own path extends past the
 * ceiling (`ceilingPlyFor(path, ceilingMoveCount) < path.length`) — an item
 * that's already fully within the ceiling has nothing to clip, and belongs
 * on the regular (`groupByFirstMoves`) view instead.
 */
export function groupByCeilingPrefix<T>(
	items: T[],
	stepsOf: (item: T) => VariationStep[],
	ceilingMoveCount: number
): MoveGroup<T>[] {
	if (items.length === 0) return [];

	const clippedStepsOf = (item: T) => {
		const steps = stepsOf(item);
		return steps.slice(0, ceilingPlyFor(steps, ceilingMoveCount));
	};
	const keyOf = (item: T) =>
		clippedStepsOf(item)
			.map((s) => s.moveId)
			.join('>');

	const firstAppearanceOrder: string[] = [];
	const buckets = new Map<string, T[]>();
	const stepsByKey = new Map<string, VariationStep[]>();
	for (const item of items) {
		const key = keyOf(item);
		if (!buckets.has(key)) {
			firstAppearanceOrder.push(key);
			buckets.set(key, []);
			stepsByKey.set(key, clippedStepsOf(item));
		}
		buckets.get(key)!.push(item);
	}

	return firstAppearanceOrder.map((key) => ({
		steps: stepsByKey.get(key)!,
		items: buckets.get(key)!
	}));
}
