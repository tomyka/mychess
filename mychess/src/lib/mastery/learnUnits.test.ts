import { describe, it, expect } from 'vitest';
import {
	activeChapterState,
	bandForMoveCount,
	chapterLearnState,
	completedChapterNames,
	deriveLearnPlan,
	deriveRepertoireLevel,
	nextServableVariationKey,
	servableRepresentativeFor,
	BAND_MOVE_CAP
} from './learnUnits';
import { ceilingPlyFor } from './teaching';
import { UNTAGGED_CHAPTER, type Variation, type VariationStep } from './variations';

/**
 * Ply SANs for a line that follows `stem` for its first `sharedPlies` plies,
 * then diverges under `tag`. Two lines built with the same `stem` and
 * `sharedPlies` therefore agree on exactly that many plies and differ from
 * there on — which is what makes prefix dedupe observable, since `moveId`
 * below is derived from the ply chain itself.
 */
function plies(stem: string, sharedPlies: number, totalPlies: number, tag: string): string[] {
	const out: string[] = [];
	for (let i = 0; i < totalPlies; i++) out.push(i < sharedPlies ? `${stem}:${i}` : `${tag}:${i}`);
	return out;
}

/**
 * A variation whose every `moveId` is its own root-to-here ply chain — the
 * same relationship real move rows have (a shared opening IS the same rows in
 * the move graph), so two variations sharing a prefix here genuinely share
 * moveIds the way `computeMasteredMoveIds` expects.
 *
 * Player moves sit on even plies (ply 0 first), matching `teaching.test.ts`.
 */
function variation(chapterNames: string[], sans: string[]): Variation {
	const path: VariationStep[] = sans.map((san, i) => ({
		moveId: sans.slice(0, i + 1).join('>'),
		san,
		fromFen: 'x',
		toFen: 'y',
		isPlayerTurn: i % 2 === 0
	}));
	return {
		leafMoveId: path[path.length - 1].moveId,
		variationKey: path.map((s) => s.moveId).join('|'),
		path,
		playerMoveCount: path.filter((s) => s.isPlayerTurn).length,
		chapterNames
	};
}

/** Plies for exactly `playerMoves` player moves, ending on a player move. */
const pliesForMoves = (playerMoves: number) => playerMoves * 2 - 1;

/** Every moveId of every named variation's clipped-to-`cap` prefix — i.e. "these units have been learned". */
function mastered(variations: Variation[], cap: number = Infinity): Set<string> {
	const ids = new Set<string>();
	for (const v of variations) {
		for (const step of v.path.slice(0, ceilingPlyFor(v.path, cap))) ids.add(step.moveId);
	}
	return ids;
}

describe('bandForMoveCount', () => {
	it('bands by the player’s own move count', () => {
		expect(bandForMoveCount(1)).toBe('bronze');
		expect(bandForMoveCount(9)).toBe('bronze');
		expect(bandForMoveCount(10)).toBe('silver');
		expect(bandForMoveCount(18)).toBe('silver');
		expect(bandForMoveCount(19)).toBe('gold');
		expect(bandForMoveCount(27)).toBe('gold');
		expect(bandForMoveCount(28)).toBe('platinum');
		expect(bandForMoveCount(120)).toBe('platinum');
	});

	it('caps match the band boundaries', () => {
		expect(BAND_MOVE_CAP).toEqual({ bronze: 9, silver: 18, gold: 27, platinum: Infinity });
	});
});

describe('chapterLearnState — prefix dedupe', () => {
	it('collapses variations sharing their whole bronze prefix into ONE unit', () => {
		// Three 20-move lines agreeing for their first 9 player moves. Under the
		// model this replaces these were three rows, one servable and two
		// locked/paused; they are one bronze unit.
		const shared = pliesForMoves(9);
		const rows = ['a', 'b', 'c'].map((tag) => variation(['Sicilian'], plies('stem', shared, pliesForMoves(20), tag)));

		const state = chapterLearnState('Sicilian', rows, new Set());

		expect(state.band).toBe('bronze');
		expect(state.units).toHaveLength(1);
		expect(state.units[0].variationKeys).toEqual(rows.map((r) => r.variationKey));
		expect(state.units[0].path).toHaveLength(shared);
	});

	it('keeps variations that diverge INSIDE the bronze prefix as separate units', () => {
		const rows = [
			variation(['Sicilian'], plies('stem', pliesForMoves(4), pliesForMoves(20), 'a')),
			variation(['Sicilian'], plies('stem', pliesForMoves(4), pliesForMoves(20), 'b'))
		];

		const state = chapterLearnState('Sicilian', rows, new Set());

		expect(state.units).toHaveLength(2);
	});

	it('extends a unit past the band cap when only the opponent’s reply lies beyond it', () => {
		// A real PGN shape: a chapter's line ends on the OPPONENT's move.
		// `ceilingPlyFor` deliberately stops just after the Nth PLAYER move, so
		// for a 9-player-move line with a trailing opponent ply it lands one ply
		// short of the path's end. Clipping there would make the bronze unit a
		// strict prefix, so a clean pass could only ever report `unitComplete`
		// and never `solved` — `variation_solved` would never be written and the
		// line could never enter the Practice pool, at ANY band, because the
		// chapter's own deepest band is already bronze.
		const rows = [variation(['Deep'], plies('stem', pliesForMoves(9) + 1, pliesForMoves(9) + 1, 'x'))];

		const state = chapterLearnState('Deep', rows, new Set());

		expect(state.band).toBe('bronze');
		expect(state.units).toHaveLength(1);
		expect(state.units[0].path).toHaveLength(rows[0].path.length);
	});

	it('caps such a variation at its full length, so a clean pass solves it outright', () => {
		const rows = [variation(['Deep'], plies('stem', pliesForMoves(9) + 1, pliesForMoves(9) + 1, 'x'))];

		const plan = deriveLearnPlan(rows, new Set());

		expect(plan.ceilingPlyByVariationKey.get(rows[0].variationKey)).toBe(rows[0].path.length);
	});

	it('still withholds content when a real PLAYER move lies beyond the cap', () => {
		// The guard above must not swallow the cap entirely: a 20-move line has
		// plenty of its own player moves past bronze, and those must stay held
		// back until a later band.
		const rows = [variation(['Deep'], plies('stem', pliesForMoves(20), pliesForMoves(20), 'x'))];

		const state = chapterLearnState('Deep', rows, new Set());

		expect(state.units[0].path).toHaveLength(pliesForMoves(9));
		expect(state.units[0].path.length).toBeLessThan(rows[0].path.length);
	});

	it('picks the SHORTEST member as representative, so a real variation can finish', () => {
		const shared = pliesForMoves(9);
		const long = variation(['Sicilian'], plies('stem', shared, pliesForMoves(20), 'long'));
		const short = variation(['Sicilian'], plies('stem', shared, shared, 'short'));

		// Long one listed first, so first-appearance order alone would pick it.
		const state = chapterLearnState('Sicilian', [long, short], new Set());

		expect(state.units).toHaveLength(1);
		expect(state.units[0].representativeVariationKey).toBe(short.variationKey);
	});
});

describe('chapterLearnState — band advance', () => {
	const shared = pliesForMoves(9);
	const deep = () => variation(['Sicilian'], plies('stem', shared, pliesForMoves(20), 'deep'));

	it('starts on bronze with nothing learned', () => {
		const state = chapterLearnState('Sicilian', [deep()], new Set());
		expect(state.band).toBe('bronze');
		expect(state.level).toBeNull();
		expect(state.complete).toBe(false);
		expect(state).toMatchObject({ learnedInBand: 0, totalInBand: 1 });
	});

	it('advances to silver once every bronze unit is learned', () => {
		const rows = [deep()];
		const state = chapterLearnState('Sicilian', rows, mastered(rows, BAND_MOVE_CAP.bronze));

		expect(state.band).toBe('silver');
		expect(state.level).toBe('bronze');
		expect(state.units).toHaveLength(1);
		// The silver unit is the same line clipped deeper, not a new line.
		expect(state.units[0].path).toHaveLength(pliesForMoves(18));
	});

	it('does not advance while ANY bronze unit is unlearned', () => {
		const learned = variation(['Sicilian'], plies('one', pliesForMoves(9), pliesForMoves(20), 'x'));
		const untouched = variation(['Sicilian'], plies('two', pliesForMoves(9), pliesForMoves(20), 'y'));

		const state = chapterLearnState('Sicilian', [learned, untouched], mastered([learned], BAND_MOVE_CAP.bronze));

		expect(state.band).toBe('bronze');
		expect(state.level).toBeNull();
		expect(state.units.map((u) => u.representativeVariationKey)).toEqual([untouched.variationKey]);
		expect(state).toMatchObject({ learnedInBand: 1, totalInBand: 2 });
	});

	it('omits learned units from the list entirely — no tick, just absent', () => {
		const learned = variation(['Sicilian'], plies('one', pliesForMoves(9), pliesForMoves(20), 'x'));
		const untouched = variation(['Sicilian'], plies('two', pliesForMoves(9), pliesForMoves(20), 'y'));

		const state = chapterLearnState('Sicilian', [learned, untouched], mastered([learned], BAND_MOVE_CAP.bronze));

		expect(state.units.some((u) => u.learned)).toBe(false);
		expect(state.units).toHaveLength(1);
	});

	it('skips a band that adds no new content, completing the chapter instead', () => {
		// Nothing deeper than 9 moves: silver/gold/platinum would clip to the
		// exact same, already-learned prefixes, so the chapter is simply done.
		const rows = [variation(['Short'], plies('stem', pliesForMoves(9), pliesForMoves(9), 'x'))];

		const state = chapterLearnState('Short', rows, mastered(rows));

		expect(state.complete).toBe(true);
		expect(state.band).toBeNull();
		expect(state.units).toEqual([]);
	});

	it('clamps the medal to the chapter’s own deepest content', () => {
		const rows = [variation(['Short'], plies('stem', pliesForMoves(9), pliesForMoves(9), 'x'))];
		expect(chapterLearnState('Short', rows, mastered(rows)).level).toBe('bronze');
	});

	it('reaches platinum only for a chapter that genuinely has platinum-length content', () => {
		const rows = [variation(['Deep'], plies('stem', pliesForMoves(30), pliesForMoves(30), 'x'))];
		expect(chapterLearnState('Deep', rows, mastered(rows)).level).toBe('platinum');
	});

	it('is neither complete nor levelled for an empty chapter', () => {
		expect(chapterLearnState('Empty', [], new Set())).toMatchObject({ complete: false, level: null, band: null });
	});
});

describe('deriveLearnPlan', () => {
	const shared = pliesForMoves(9);

	it('gates each chapter independently', () => {
		const aRows = [variation(['A'], plies('a', shared, pliesForMoves(20), 'a1'))];
		const bRows = [variation(['B'], plies('b', shared, pliesForMoves(20), 'b1'))];

		const plan = deriveLearnPlan([...aRows, ...bRows], mastered(aRows, BAND_MOVE_CAP.bronze));

		expect(plan.chapters.map((c) => [c.chapter, c.band])).toEqual([
			['A', 'silver'],
			['B', 'bronze']
		]);
	});

	it('caps a variation at its DEEPEST chapter’s band, so one chapter cannot hold back another', () => {
		// A shared tabiya cross-referenced by both chapters. Chapter A has
		// finished bronze (so it is on silver); chapter B has not.
		const shared_line = variation(['A', 'B'], plies('stem', shared, pliesForMoves(20), 'shared'));
		const aOnly = variation(['A'], plies('stem', shared, pliesForMoves(20), 'aOnly'));

		const plan = deriveLearnPlan([shared_line, aOnly], mastered([shared_line], BAND_MOVE_CAP.bronze));

		const chapterA = plan.chapters.find((c) => c.chapter === 'A')!;
		expect(chapterA.band).toBe('silver');
		// Both lines share the same bronze prefix, so mastering one masters the
		// shared unit for both -> chapter A is on silver, chapter B on silver too.
		expect(plan.ceilingPlyByVariationKey.get(shared_line.variationKey)).toBe(pliesForMoves(18));
	});

	it('lists one servable representative per unlearned unit, in chapter order', () => {
		const a = variation(['A'], plies('a', shared, shared, 'a1'));
		const b = variation(['B'], plies('b', shared, shared, 'b1'));

		const plan = deriveLearnPlan([a, b], new Set());

		expect(plan.servableVariationKeys).toEqual([a.variationKey, b.variationKey]);
	});

	it('has nothing servable once every chapter is complete', () => {
		const rows = [variation(['A'], plies('a', shared, shared, 'a1'))];
		const plan = deriveLearnPlan(rows, mastered(rows));

		expect(plan.servableVariationKeys).toEqual([]);
		expect(plan.chapters.every((c) => c.complete)).toBe(true);
	});

	it('treats a chapterless repertoire as one flat pool', () => {
		const rows = [variation([], plies('a', shared, shared, 'a1'))];
		const plan = deriveLearnPlan(rows, new Set());

		expect(plan.chapters).toHaveLength(1);
		expect(plan.chapters[0].chapter).toBeNull();
	});

	it('buckets untagged lines of a MIXED repertoire under their own chapter, last', () => {
		const tagged = variation(['A'], plies('a', shared, shared, 'a1'));
		const untagged = variation([], plies('u', shared, shared, 'u1'));

		const plan = deriveLearnPlan([tagged, untagged], new Set());

		expect(plan.chapters.map((c) => c.chapter)).toEqual(['A', UNTAGGED_CHAPTER]);
	});

	it('gives an excluded (absent) variation no unit and lets it block nothing', () => {
		const kept = variation(['A'], plies('kept', shared, shared, 'k'));
		const excluded = variation(['A'], plies('dropped', shared, shared, 'd'));

		// `deriveLearnPlan` takes the FILTERED set, so the excluded line simply
		// is not there — and the chapter completes on the one that remains.
		const plan = deriveLearnPlan([kept], mastered([kept]));

		expect(plan.chapters[0].complete).toBe(true);
		expect(plan.servableVariationKeys).toEqual([]);
		// Sanity: it WOULD have blocked, had it still been in scope.
		expect(chapterLearnState('A', [kept, excluded], mastered([kept])).complete).toBe(false);
	});
});

describe('nextServableVariationKey', () => {
	const shared = pliesForMoves(9);
	const line = (chapter: string, tag: string) => variation([chapter], plies(tag, shared, shared, tag));

	it('stays inside the chapter the finished line belongs to', () => {
		// Chapter B is listed second, so "first servable anywhere" would bounce
		// the player back to chapter A after every single line.
		const a1 = line('A', 'a1');
		const b1 = line('B', 'b1');
		const b2 = line('B', 'b2');
		const plan = deriveLearnPlan([a1, b1, b2], mastered([b1]));

		expect(nextServableVariationKey(plan, [a1, b1, b2], b1.variationKey)).toBe(b2.variationKey);
	});

	it('falls back to another chapter once its own is finished', () => {
		const a1 = line('A', 'a1');
		const b1 = line('B', 'b1');
		const plan = deriveLearnPlan([a1, b1], mastered([b1]));

		expect(nextServableVariationKey(plan, [a1, b1], b1.variationKey)).toBe(a1.variationKey);
	});

	it('is null once nothing anywhere is servable', () => {
		const a1 = line('A', 'a1');
		const plan = deriveLearnPlan([a1], mastered([a1]));

		expect(nextServableVariationKey(plan, [a1], a1.variationKey)).toBeNull();
	});

	it('never hands back the line just finished, even if its unit somehow remains servable', () => {
		// A stale plan (derived pre-write) still lists the finished line. The
		// walk must skip it rather than pointing the player at the same board.
		const a1 = line('A', 'a1');
		const a2 = line('A', 'a2');
		const stalePlan = deriveLearnPlan([a1, a2], new Set());

		expect(nextServableVariationKey(stalePlan, [a1, a2], a1.variationKey)).toBe(a2.variationKey);
	});

	it('handles an untagged line in a MIXED repertoire, and in a chapterless one', () => {
		const tagged = line('A', 'a1');
		const untaggedA = variation([], plies('u1', shared, shared, 'u1'));
		const untaggedB = variation([], plies('u2', shared, shared, 'u2'));

		const mixed = deriveLearnPlan([tagged, untaggedA, untaggedB], mastered([untaggedA]));
		expect(nextServableVariationKey(mixed, [tagged, untaggedA, untaggedB], untaggedA.variationKey)).toBe(untaggedB.variationKey);

		const flat = deriveLearnPlan([untaggedA, untaggedB], mastered([untaggedA]));
		expect(nextServableVariationKey(flat, [untaggedA, untaggedB], untaggedA.variationKey)).toBe(untaggedB.variationKey);
	});
});

describe('activeChapterState', () => {
	const shared = pliesForMoves(9);
	const line = (chapter: string, tag: string) => variation([chapter], plies(tag, shared, shared, tag));

	it('reports the chapter holding the active line', () => {
		const a1 = line('A', 'a1');
		const b1 = line('B', 'b1');
		const plan = deriveLearnPlan([a1, b1], new Set());

		expect(activeChapterState(plan, [a1, b1], b1.variationKey)?.chapter).toBe('B');
	});

	it('prefers an UNFINISHED chapter when the active line is cross-referenced by several', () => {
		// The shared line belongs to both; A is already finished via it, B is not.
		const shared_line = variation(['A', 'B'], plies('s', shared, shared, 's'));
		const bOnly = variation(['B'], plies('b', shared, shared, 'b'));
		const plan = deriveLearnPlan([shared_line, bOnly], mastered([shared_line]));

		expect(activeChapterState(plan, [shared_line, bOnly], shared_line.variationKey)?.chapter).toBe('B');
	});

	it('falls back to the first unfinished chapter for a stale or absent pointer', () => {
		const a1 = line('A', 'a1');
		const plan = deriveLearnPlan([a1], new Set());

		expect(activeChapterState(plan, [a1], 'gone')?.chapter).toBe('A');
		expect(activeChapterState(plan, [a1], null)?.chapter).toBe('A');
	});

	it('is null once every chapter is complete, so the progress bar hides instead of showing a full one', () => {
		const a1 = line('A', 'a1');
		const plan = deriveLearnPlan([a1], mastered([a1]));

		expect(activeChapterState(plan, [a1], a1.variationKey)).toBeNull();
	});
});

describe('servableRepresentativeFor', () => {
	const shared = pliesForMoves(9);

	it('resolves ANY member of an unlearned unit to that unit’s representative', () => {
		// The long member is not in `servableVariationKeys` (only representatives
		// are), so a yes/no check against that list would reject a perfectly
		// teachable pick — and `pickActiveVariation` would then silently serve
		// something else.
		const long = variation(['A'], plies('stem', shared, pliesForMoves(20), 'long'));
		const short = variation(['A'], plies('stem', shared, shared, 'short'));
		const plan = deriveLearnPlan([long, short], new Set());

		expect(plan.servableVariationKeys).not.toContain(long.variationKey);
		expect(servableRepresentativeFor(plan, long.variationKey)).toBe(short.variationKey);
		expect(servableRepresentativeFor(plan, short.variationKey)).toBe(short.variationKey);
	});

	it('is null for a variation with nothing left to teach', () => {
		const rows = [variation(['A'], plies('a', shared, shared, 'a'))];
		const plan = deriveLearnPlan(rows, mastered(rows));

		expect(servableRepresentativeFor(plan, rows[0].variationKey)).toBeNull();
	});

	it('is null for a key that matches no variation at all', () => {
		const rows = [variation(['A'], plies('a', shared, shared, 'a'))];
		expect(servableRepresentativeFor(deriveLearnPlan(rows, new Set()), 'gone')).toBeNull();
	});
});

describe('completedChapterNames', () => {
	const shared = pliesForMoves(9);
	const line = (chapter: string, tag: string) => variation([chapter], plies(tag, shared, shared, tag));

	it('names only the complete chapters', () => {
		const a1 = line('A', 'a1');
		const b1 = line('B', 'b1');
		const plan = deriveLearnPlan([a1, b1], mastered([a1]));

		expect([...completedChapterNames(plan)]).toEqual(['A']);
	});

	it('calls a chapterless repertoire’s flat pool UNTAGGED_CHAPTER, matching masterableChapters', () => {
		// `deriveRepertoireStatus` compares this set against
		// `masterableChapters`, which names that bucket UNTAGGED_CHAPTER — a
		// `null` here would never match and a chapterless repertoire could never
		// read as Mastered.
		const rows = [variation([], plies('a', shared, shared, 'a'))];
		const plan = deriveLearnPlan(rows, mastered(rows));

		expect([...completedChapterNames(plan)]).toEqual([UNTAGGED_CHAPTER]);
	});
});

describe('deriveRepertoireLevel', () => {
	it('is the minimum band across chapters', () => {
		expect(deriveRepertoireLevel(['gold', 'bronze', 'silver'])).toBe('bronze');
		expect(deriveRepertoireLevel(['gold', 'platinum'])).toBe('gold');
	});

	it('treats an unlevelled chapter as the lowest', () => {
		expect(deriveRepertoireLevel(['gold', null])).toBeNull();
	});

	it('is null for no chapters at all', () => {
		expect(deriveRepertoireLevel([])).toBeNull();
	});
});
