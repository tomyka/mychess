//
// Learn units: the single owner of "what is this player allowed to learn
// right now, and how far into it" (GitHub issue #182).
//
// Replaces the tier-ceiling model (issues #163/#165/#168/#172/#181) and its
// three overlapping predicates — `isLockedForTier`, `isPausedAtCeiling`,
// `isCeilingReachedAnywhere` — with one idea:
//
//   Once a variation is clipped at a band cap, the thing being LEARNED is
//   not a variation. It is a distinct clipped PREFIX.
//
// Many variations collapse onto the same prefix. Deduplicate them and the
// Learn list becomes short and entirely actionable, so there is nothing left
// to lock, pause, defer or tick: a learned unit is simply absent from it.
//
// DERIVED, never stored — same convention as `repertoireStatus.ts`. A coach
// edit changes the inputs (paths, `masteredMoveIds`) and every band, medal
// and unit recomputes on the next read, with no invalidation job and no
// staleness concept. See
// docs/superpowers/specs/2026-09-04-learn-units-design.md.
//

import { ceilingPlyFor } from './teaching';
import { chapterTiers, rowsInChapterTier, UNTAGGED_CHAPTER, type Variation, type VariationStep } from './variations';

export type Band = 'bronze' | 'silver' | 'gold' | 'platinum';

const BAND_ORDER: readonly Band[] = ['bronze', 'silver', 'gold', 'platinum'];

/** Inclusive upper bound of each band's own `playerMoveCount`. */
export const BAND_MOVE_CAP: Record<Band, number> = {
	bronze: 9,
	silver: 18,
	gold: 27,
	platinum: Infinity
};

const BAND_RANK: Record<Band, number> = { bronze: 0, silver: 1, gold: 2, platinum: 3 };

/** Which band a variation's own length puts it in. */
export function bandForMoveCount(playerMoveCount: number): Band {
	for (const band of BAND_ORDER) {
		if (playerMoveCount <= BAND_MOVE_CAP[band]) return band;
	}
	return 'platinum';
}

/**
 * One thing the player can be asked to learn: a set of variations sharing
 * the same moves up to the current band's cap, addressed by that clipped
 * prefix rather than by any one variation.
 */
export type LearnUnit = {
	/** The clipped path's `>`-joined moveId chain — the same format as
	 *  `variationKey`, so a unit that reaches a variation's real end IS that
	 *  variationKey. No new key format, no schema change. */
	unitKey: string;
	band: Band;
	/** The clipped path — what Learn actually teaches and tests. */
	path: VariationStep[];
	/** Every variation collapsing onto this prefix, in first-appearance order. */
	variationKeys: string[];
	/**
	 * The member with the SHORTEST path, which is load-bearing rather than
	 * arbitrary: when a 9-move variation and a 20-move variation share their
	 * first 9 moves they are ONE bronze unit, and serving the 9-move one
	 * finishes a real variation — writing `variation_solved`, so the line
	 * enters the Practice pool — where serving the 20-move one would only
	 * bank teaching progress and leave the Practice pool empty.
	 */
	representativeVariationKey: string;
	/**
	 * Whether every move in the clipped path is already mastered — one clean,
	 * mistake-free, hint-free blind replay, possibly earned via a sibling
	 * sharing those exact moves (see `computeMasteredMoveIds`).
	 */
	learned: boolean;
};

/**
 * Where a band's cap actually falls within one path — the SINGLE definition of
 * that, shared by unit construction and by the serving cap
 * (`ceilingPlyByVariationKey`). Those two disagreeing is the whole class of bug
 * this module exists to remove.
 *
 * `ceilingPlyFor` stops just after the cap-th PLAYER move, deliberately: a
 * served path has to end on a player move or the attempt can never complete.
 * But a variation may end with a trailing OPPONENT reply (a PGN chapter whose
 * line stops on the opponent's move — `enumerateVariations` emits those,
 * gating only on `playerMoveCount > 0`). Clipping such a path at the cap would
 * leave a strict prefix with no player move withheld, so a clean pass could
 * only ever report `unitComplete` and never `solved`: `variation_solved` would
 * never be written and the line could never enter the Practice pool at ANY
 * band, since the band it belongs to is already the chapter's deepest.
 *
 * So: extend to the path's own end whenever nothing past the cap is the
 * player's own move. There is genuinely nothing left to withhold there.
 */
function bandCapPly(path: readonly VariationStep[], cap: number): number {
	const ply = ceilingPlyFor(path, cap);
	return path.slice(ply).some((step) => step.isPlayerTurn) ? ply : path.length;
}

/**
 * Every distinct clipped prefix among `rows` at one band, in first-appearance
 * order. Compared by `moveId`, not SAN text, matching exactly what the
 * shared-credit mechanic already treats as interchangeable — so a unit's
 * members are always the same set of variations that teaching one credits for
 * every other.
 *
 * A row whose clipped path is empty is skipped: `enumerateVariations` already
 * drops pathless variations, so this only guards against a degenerate input
 * rather than representing a real state.
 */
function unitsAtBand(rows: readonly Variation[], band: Band, masteredMoveIds: ReadonlySet<string>): LearnUnit[] {
	const cap = BAND_MOVE_CAP[band];
	const order: string[] = [];
	const byKey = new Map<string, { path: VariationStep[]; members: Variation[] }>();

	for (const variation of rows) {
		const path = variation.path.slice(0, bandCapPly(variation.path, cap));
		if (path.length === 0) continue;
		const unitKey = path.map((step) => step.moveId).join('>');
		let entry = byKey.get(unitKey);
		if (!entry) {
			order.push(unitKey);
			entry = { path, members: [] };
			byKey.set(unitKey, entry);
		}
		entry.members.push(variation);
	}

	return order.map((unitKey) => {
		const { path, members } = byKey.get(unitKey)!;
		// `reduce` with a strict `<` keeps first-appearance order as the
		// tie-break, so a unit's representative is stable across reads.
		const representative = members.reduce((shortest, candidate) => (candidate.path.length < shortest.path.length ? candidate : shortest));
		return {
			unitKey,
			band,
			path,
			variationKeys: members.map((m) => m.variationKey),
			representativeVariationKey: representative.variationKey,
			learned: path.every((step) => masteredMoveIds.has(step.moveId))
		};
	});
}

/** The band of the deepest variation in `rows` — the highest band this set can ever reach. Null for an empty set. */
function deepestBand(rows: readonly Variation[]): Band | null {
	let deepest: Band | null = null;
	for (const variation of rows) {
		const band = bandForMoveCount(variation.playerMoveCount);
		if (deepest === null || BAND_RANK[band] > BAND_RANK[deepest]) deepest = band;
	}
	return deepest;
}

export type ChapterLearnState = {
	/** The chapter's name, or `null` for the flat pool of a repertoire with no chapters anywhere. */
	chapter: string | null;
	/** The band currently being learned. `null` once the chapter is complete (or empty). */
	band: Band | null;
	/** The medal earned: the highest FULLY-learned band, clamped to `deepestBand`. */
	level: Band | null;
	complete: boolean;
	/** The current band's UNLEARNED units — exactly what Learn should offer. Empty for a complete chapter. */
	units: LearnUnit[];
	/** Progress within the current band, for the Learn page's bar. Both 0 for a complete chapter. */
	learnedInBand: number;
	totalInBand: number;
};

/**
 * One chapter's whole ladder position, in a single pass: its current band,
 * its medal, whether it's finished, and the units still to learn.
 *
 * The current band is the LOWEST band holding an unlearned unit. Bands are
 * nested prefixes, so if a band is fully learned then so is every band below
 * it — which makes "lowest unlearned" always well-defined, and skips a band
 * that adds no new content (one whose units are all identical to the band
 * below's, already learned) for free rather than needing its own mechanism.
 *
 * The medal is clamped by `deepestBand` because a band whose cap already lies
 * past everything in the chapter is vacuously satisfied: without the clamp, a
 * chapter topping out at 9 moves would report Platinum the moment its Bronze
 * units were learned.
 */
export function chapterLearnState(
	chapter: string | null,
	rows: readonly Variation[],
	masteredMoveIds: ReadonlySet<string>
): ChapterLearnState {
	const deepest = deepestBand(rows);
	if (deepest === null) {
		return { chapter, band: null, level: null, complete: false, units: [], learnedInBand: 0, totalInBand: 0 };
	}

	let level: Band | null = null;
	for (const band of BAND_ORDER) {
		const units = unitsAtBand(rows, band, masteredMoveIds);
		const unlearned = units.filter((unit) => !unit.learned);
		if (unlearned.length > 0) {
			return {
				chapter,
				band,
				level,
				complete: false,
				units: unlearned,
				learnedInBand: units.length - unlearned.length,
				totalInBand: units.length
			};
		}
		level = band;
		if (BAND_RANK[band] >= BAND_RANK[deepest]) break;
	}

	return { chapter, band: null, level, complete: true, units: [], learnedInBand: 0, totalInBand: 0 };
}

export type LearnPlan = {
	/** Every chapter, in `chapterTiers` order (untagged last), or one `chapter: null` entry for a chapterless repertoire. */
	chapters: ChapterLearnState[];
	/**
	 * How many plies of each variation Learn may currently teach. The MAXIMUM
	 * across the chapters a variation belongs to, so one chapter's own band
	 * can never hold back another's: a shared tabiya sitting in a Bronze
	 * chapter and a Gold chapter is teachable to Gold's depth.
	 *
	 * A variation missing from the map has nothing teachable at all, which
	 * only happens for a variation absent from `variations` itself.
	 */
	ceilingPlyByVariationKey: ReadonlyMap<string, number>;
	/**
	 * The representative of every unlearned unit, in chapter order, deduplicated
	 * — the ordered candidate list for `pickActiveVariation`. Empty means every
	 * chapter is complete: there is nothing left to teach.
	 */
	servableVariationKeys: readonly string[];
};

/**
 * The whole Learn picture for one repertoire, derived once.
 *
 * This is the property the tier-ceiling model lacked: the Learn page, the
 * picker endpoint, `buildPracticeView`, `applyAttemptResult` and
 * `select-variation` each used to derive a ceiling of their own from the same
 * inputs, and could disagree at the edges. They now all read one value.
 *
 * `variations` should be the PRACTICEABLE (exclusion-filtered) set. Unlike the
 * model this replaces, an excluded variation deliberately produces no unit and
 * blocks nothing — "I don't want to learn this line" now means exactly that,
 * where it used to cap the line's whole chapter.
 */
export function deriveLearnPlan(variations: readonly Variation[], masteredMoveIds: ReadonlySet<string>): LearnPlan {
	const rows = variations;
	const tiers = chapterTiers(rows);
	// Bucketed once, not once per read: `rowsInChapterTier` is an O(n) filter,
	// and both the per-chapter state below and the cap loop after it need the
	// same buckets.
	const rowsByChapter: Array<{ chapter: string | null; rows: readonly Variation[] }> =
		tiers === null ? [{ chapter: null, rows }] : tiers.map((chapter) => ({ chapter, rows: rowsInChapterTier(rows, chapter) }));
	const chapters = rowsByChapter.map(({ chapter, rows: chapterRows }) => chapterLearnState(chapter, chapterRows, masteredMoveIds));

	const ceilingPlyByVariationKey = new Map<string, number>();
	const servableVariationKeys: string[] = [];
	const seen = new Set<string>();

	for (const [i, state] of chapters.entries()) {
		// A complete chapter caps nothing: everything in it is already learned
		// to its own true end, so an uncapped serve is a no-op final pass.
		const cap = state.band === null ? Infinity : BAND_MOVE_CAP[state.band];
		for (const variation of rowsByChapter[i].rows) {
			const ply = bandCapPly(variation.path, cap);
			if (ply > (ceilingPlyByVariationKey.get(variation.variationKey) ?? 0)) {
				ceilingPlyByVariationKey.set(variation.variationKey, ply);
			}
		}
		for (const unit of state.units) {
			if (seen.has(unit.representativeVariationKey)) continue;
			seen.add(unit.representativeVariationKey);
			servableVariationKeys.push(unit.representativeVariationKey);
		}
	}

	return { chapters, ceilingPlyByVariationKey, servableVariationKeys };
}

/**
 * The chapter the player is currently working in — the one holding
 * `activeVariationKey`, preferring an unfinished chapter when that line is
 * cross-referenced by several. Falls back to the first unfinished chapter (a
 * stale or absent pointer), then to `null` for a repertoire with nothing left.
 *
 * This is what the Learn page's band progress bar reports on. It is
 * deliberately per-chapter rather than repertoire-wide: bands are gated per
 * chapter, so a repertoire-wide "Bronze 4/9" would be measuring something no
 * single gate actually uses.
 */
export function activeChapterState(
	plan: LearnPlan,
	variations: readonly Variation[],
	activeVariationKey: string | null
): ChapterLearnState | null {
	const active = activeVariationKey ? variations.find((v) => v.variationKey === activeVariationKey) : undefined;
	if (active) {
		const own = plan.chapters.find(
			(state) =>
				!state.complete &&
				(state.chapter === null ||
					(active.chapterNames.length > 0 ? active.chapterNames.includes(state.chapter) : state.chapter === UNTAGGED_CHAPTER))
		);
		if (own) return own;
	}
	// Deliberately NOT "the active line's chapter even when it's finished": if
	// nothing anywhere is unfinished there is no chapter being worked in, and
	// saying otherwise would leave the Learn page's band bar stuck at full.
	return plan.chapters.find((state) => !state.complete) ?? null;
}

/**
 * What to serve after finishing `finishedVariationKey`, given a plan derived
 * from POST-attempt state (so the just-learned unit is already gone from it).
 *
 * Prefers a unit in a chapter the finished line also belongs to, keeping the
 * player inside the chapter they're working through instead of bouncing back
 * to the repertoire's first chapter after every line. Falls back to the first
 * unlearned unit anywhere, then to `null` — nothing left to teach, which the
 * caller persists so the trophy screen shows instead of a stale pointer.
 *
 * This replaces `advanceIfSolved`'s walk over the variation list. That walk
 * had to skip solved and "blocked" entries as it went and could revisit a
 * duplicate key forever; the plan has already excluded everything unservable,
 * so there is nothing to skip and nothing to loop on.
 */
export function nextServableVariationKey(
	plan: LearnPlan,
	variations: readonly Variation[],
	finishedVariationKey: string
): string | null {
	const finished = variations.find((v) => v.variationKey === finishedVariationKey);
	// An untagged line belongs to UNTAGGED_CHAPTER in a mixed repertoire and to
	// the `null` flat pool in a chapterless one — it can only ever be in one of
	// those, so claiming both is unambiguous and saves the caller telling us
	// which shape the repertoire has.
	const ownChapters = new Set<string | null>();
	if (finished) {
		if (finished.chapterNames.length > 0) for (const chapter of finished.chapterNames) ownChapters.add(chapter);
		else ownChapters.add(UNTAGGED_CHAPTER).add(null);
	}

	for (const state of plan.chapters) {
		if (!ownChapters.has(state.chapter)) continue;
		for (const unit of state.units) {
			if (unit.representativeVariationKey !== finishedVariationKey) return unit.representativeVariationKey;
		}
	}

	return plan.servableVariationKeys.find((key) => key !== finishedVariationKey) ?? null;
}

/**
 * The representative of the still-unlearned unit `variationKey` belongs to, or
 * `null` when it has none — nothing left to teach in it right now.
 *
 * Resolving to the REPRESENTATIVE, rather than answering yes/no about the key
 * itself, is what lets a caller accept any member of an unlearned unit while
 * still serving the member that can actually finish (see `LearnUnit`). A
 * yes/no check against `servableVariationKeys` would reject a longer member of
 * a perfectly teachable unit, since only representatives are in that list.
 */
export function servableRepresentativeFor(plan: LearnPlan, variationKey: string): string | null {
	for (const state of plan.chapters) {
		for (const unit of state.units) {
			if (unit.variationKeys.includes(variationKey)) return unit.representativeVariationKey;
		}
	}
	return null;
}

/** One learn unit as the picker's endpoint sends it: the CLIPPED prefix, plus the variation to post back. */
export type LearnUnitView = {
	unitKey: string;
	/** The clipped prefix's own label — not any member's full line. */
	label: string;
	path: VariationStep[];
	/** The unit's representative, i.e. what to post to `/api/practice/select-variation`. */
	variationKey: string;
};

/**
 * One chapter as the picker's endpoint sends it. Carries only what the picker
 * renders: a chapter with nothing left to learn arrives with an empty `units`,
 * which is the whole signal — there is no separate "complete" flag to keep in
 * step with it.
 */
export type LearnChapterView = {
	/** `null` for the flat pool of a repertoire with no chapters anywhere. */
	chapter: string | null;
	band: Band | null;
	learnedInBand: number;
	totalInBand: number;
	units: LearnUnitView[];
};

/** The `/api/repertoires/[id]/learn-units` response body. Shared so the route and the picker cannot drift. */
export type LearnUnitsResponse = { chapters: LearnChapterView[] };

/**
 * The display names of every COMPLETE chapter in `plan` — the shape both
 * `deriveRepertoireStatus`'s `completedChapters` argument and the
 * `chapter_completed` cache want.
 *
 * `null` (the flat pool of a chapterless repertoire) maps to
 * `UNTAGGED_CHAPTER`, matching `masterableChapters`'s own fallback, so the two
 * agree on what to call that bucket.
 */
export function completedChapterNames(plan: LearnPlan): Set<string> {
	const names = new Set<string>();
	for (const state of plan.chapters) {
		if (state.complete) names.add(state.chapter ?? UNTAGGED_CHAPTER);
	}
	return names;
}

/** A repertoire's level: the minimum band across its chapters (null counts as lowest). */
export function deriveRepertoireLevel(chapterLevels: Iterable<Band | null>): Band | null {
	let min: Band | null = null;
	let minRank = Infinity;
	let any = false;
	for (const level of chapterLevels) {
		any = true;
		const rank = level === null ? -1 : BAND_RANK[level];
		if (rank < minRank) {
			minRank = rank;
			min = level;
		}
	}
	return any ? min : null;
}
