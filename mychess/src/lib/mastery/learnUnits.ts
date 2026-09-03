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

export const BAND_ORDER: readonly Band[] = ['bronze', 'silver', 'gold', 'platinum'];

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
		const path = variation.path.slice(0, ceilingPlyFor(variation.path, cap));
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
	const rows = variations as Variation[];
	const tiers = chapterTiers(rows);
	// Bucketed once, not once per read: `rowsInChapterTier` is an O(n) filter,
	// and both the per-chapter state below and the cap loop after it need the
	// same buckets.
	const rowsByChapter: Array<{ chapter: string | null; rows: Variation[] }> =
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
			const ply = ceilingPlyFor(variation.path, cap);
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
		const own = plan.chapters.filter(
			(state) => state.chapter === null || (active.chapterNames.length > 0 ? active.chapterNames.includes(state.chapter) : state.chapter === UNTAGGED_CHAPTER)
		);
		const match = own.find((state) => !state.complete) ?? own[0];
		if (match) return match;
	}
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
 * One chapter's medal — the highest fully-learned band, clamped to the
 * chapter's own deepest content. Null for a chapter with nothing learned yet.
 *
 * `chapterVariations` should be the practiceable (filtered) set, matching
 * `deriveLearnPlan`. This is the direct opposite of the requirement the
 * function it replaces carried: excluded lines must NOT be passed, because
 * they no longer block anything.
 */
export function deriveChapterLevel(chapterVariations: readonly Variation[], masteredMoveIds: ReadonlySet<string>): Band | null {
	return chapterLearnState(null, chapterVariations, masteredMoveIds).level;
}

/** Whether a chapter has learned everything it contains, to every line's own true end. `false` for an empty chapter. */
export function isChapterComplete(chapterVariations: readonly Variation[], masteredMoveIds: ReadonlySet<string>): boolean {
	return chapterLearnState(null, chapterVariations, masteredMoveIds).complete;
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
