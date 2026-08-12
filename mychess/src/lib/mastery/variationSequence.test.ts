import { describe, it, expect } from 'vitest';
import { pickActiveVariation, nextVariation, advanceVariationIfMastered, variationSequenceProgress } from './variationSequence';
import type { LevelProgressRow } from './levelProgress';
import type { Variation } from './variations';

const UNCAPPED = 100;

function variation(playerMoveCount: number, prefix: string): Variation {
	const path: Variation['path'] = [];
	for (let i = 1; i <= playerMoveCount; i++) {
		path.push({ moveId: `${prefix}p${i}`, san: `P${i}`, fromFen: `f${i}a`, toFen: `f${i}b`, isPlayerTurn: true });
		path.push({ moveId: `${prefix}o${i}`, san: `O${i}`, fromFen: `f${i}b`, toFen: `f${i + 1}a`, isPlayerTurn: false });
	}
	return {
		leafMoveId: path[path.length - 1].moveId,
		variationKey: path.map((s) => s.moveId).join('>'),
		path,
		playerMoveCount
	};
}

describe('pickActiveVariation', () => {
	it('returns null for an empty variation list', () => {
		expect(pickActiveVariation([], null)).toBeNull();
	});

	it('defaults to the first variation when no key is given', () => {
		const a = variation(2, 'a-');
		const b = variation(2, 'b-');
		expect(pickActiveVariation([a, b], null)).toBe(a);
	});

	it('returns the variation matching the given key', () => {
		const a = variation(2, 'a-');
		const b = variation(2, 'b-');
		expect(pickActiveVariation([a, b], b.variationKey)).toBe(b);
	});

	it('falls back to the first variation when the key no longer matches anything (e.g. excluded/edited repertoire)', () => {
		const a = variation(2, 'a-');
		expect(pickActiveVariation([a], 'stale-key')).toBe(a);
	});
});

describe('nextVariation', () => {
	it('returns the variation right after the given key', () => {
		const a = variation(2, 'a-');
		const b = variation(2, 'b-');
		const c = variation(2, 'c-');
		expect(nextVariation([a, b, c], a.variationKey)).toBe(b);
	});

	it('returns null when the given key is the last variation', () => {
		const a = variation(2, 'a-');
		const b = variation(2, 'b-');
		expect(nextVariation([a, b], b.variationKey)).toBeNull();
	});

	it('returns null when the given key is not found', () => {
		const a = variation(2, 'a-');
		expect(nextVariation([a], 'no-such-key')).toBeNull();
	});
});

describe('advanceVariationIfMastered', () => {
	it('leaves the row untouched (but stamps activeVariationKey) when the active variation is not yet mastered', () => {
		const a = variation(6, 'a-'); // cap = 2
		const b = variation(6, 'b-');
		const row: LevelProgressRow = { level: 1, prevLevelMistakes: 0, queue: [], activeVariationKey: a.variationKey };
		const next = advanceVariationIfMastered(row, [a, b], UNCAPPED, 3);
		expect(next.level).toBe(1);
		expect(next.activeVariationKey).toBe(a.variationKey);
	});

	it('advances to the next variation, resetting to a fresh level 1, once the active one is mastered', () => {
		const a = variation(2, 'a-'); // cap = 1
		const b = variation(6, 'b-');
		const row: LevelProgressRow = { level: 2, prevLevelMistakes: 3, queue: [], activeVariationKey: a.variationKey };
		const next = advanceVariationIfMastered(row, [a, b], UNCAPPED, 3, () => 0);
		expect(next.activeVariationKey).toBe(b.variationKey);
		expect(next.level).toBe(1);
		expect(next.prevLevelMistakes).toBe(0);
		expect(next.queue.map((e) => e.status)).toEqual(['pending']);
	});

	it('stays mastered (no next variation) once the LAST variation is mastered', () => {
		const a = variation(2, 'a-'); // cap = 1
		const row: LevelProgressRow = { level: 2, prevLevelMistakes: 0, queue: [], activeVariationKey: a.variationKey };
		const next = advanceVariationIfMastered(row, [a], UNCAPPED, 3);
		expect(next.activeVariationKey).toBe(a.variationKey);
		expect(next.level).toBe(2); // unchanged — nothing left to advance to
	});

	it('defaults to the first variation when activeVariationKey is missing (bootstrap row)', () => {
		const a = variation(6, 'a-');
		const row: LevelProgressRow = { level: 1, prevLevelMistakes: 0, queue: [] };
		const next = advanceVariationIfMastered(row, [a], UNCAPPED, 3);
		expect(next.activeVariationKey).toBe(a.variationKey);
	});

	it('is a no-op for an empty variation list', () => {
		const row: LevelProgressRow = { level: 1, prevLevelMistakes: 0, queue: [] };
		expect(advanceVariationIfMastered(row, [], UNCAPPED, 3)).toEqual(row);
	});
});

describe('variationSequenceProgress', () => {
	it('is all zero for an empty variation list', () => {
		expect(variationSequenceProgress([], null, UNCAPPED, 3)).toEqual({ variationsMastered: 0, totalVariationsInSequence: 0 });
	});

	it('is zero mastered, full total, when there is no row yet', () => {
		const a = variation(6, 'a-');
		const b = variation(6, 'b-');
		expect(variationSequenceProgress([a, b], null, UNCAPPED, 3)).toEqual({ variationsMastered: 0, totalVariationsInSequence: 2 });
	});

	it("counts every variation strictly before the active one as mastered, plus the active one itself once IT masters", () => {
		const a = variation(2, 'a-'); // cap = 1
		const b = variation(2, 'b-');
		const c = variation(2, 'c-');
		const inProgress: LevelProgressRow = { level: 1, prevLevelMistakes: 0, queue: [], activeVariationKey: b.variationKey };
		expect(variationSequenceProgress([a, b, c], inProgress, UNCAPPED, 3)).toEqual({
			variationsMastered: 1, // a is before b, b itself isn't done yet
			totalVariationsInSequence: 3
		});

		const bMastered: LevelProgressRow = { level: 2, prevLevelMistakes: 0, queue: [], activeVariationKey: b.variationKey };
		expect(variationSequenceProgress([a, b, c], bMastered, UNCAPPED, 3)).toEqual({
			variationsMastered: 2, // a and b both done
			totalVariationsInSequence: 3
		});
	});
});
