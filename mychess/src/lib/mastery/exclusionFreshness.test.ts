import { describe, it, expect } from 'vitest';
import { exclusionsAreVerified, exclusionShape, partitionByLiveness } from './exclusionFreshness';

const SHAPE_CHANGED = '2026-08-18T10:00:00Z';
const EPOCH = '1970-01-01T00:00:00Z';

function row(variationKey: string, verifiedAt: string) {
	return { variationKey, verifiedAt };
}

describe('exclusionsAreVerified', () => {
	it('is true when every row was verified after the last move change', () => {
		const rows = [row('a', '2026-08-18T10:00:01Z'), row('b', '2026-08-18T12:00:00Z')];
		expect(exclusionsAreVerified(rows, SHAPE_CHANGED)).toBe(true);
	});

	it('is true when a row was verified at exactly the move-change instant', () => {
		// The re-verify write stamps survivors with the repertoire's own
		// moves_updated_at value, so equality is the NORMAL verified state, not
		// an edge case — a strict > here would send every verified repertoire
		// back down the slow path forever.
		expect(exclusionsAreVerified([row('a', SHAPE_CHANGED)], SHAPE_CHANGED)).toBe(true);
	});

	it('is false when any single row predates the last move change', () => {
		const rows = [row('a', '2026-08-18T12:00:00Z'), row('b', '2026-08-18T09:59:59Z')];
		expect(exclusionsAreVerified(rows, SHAPE_CHANGED)).toBe(false);
	});

	it('is false for a never-verified row (the epoch default new rows carry)', () => {
		expect(exclusionsAreVerified([row('a', EPOCH)], SHAPE_CHANGED)).toBe(false);
	});

	it('is vacuously true with no rows at all', () => {
		expect(exclusionsAreVerified([], SHAPE_CHANGED)).toBe(true);
	});

	it('treats an unknown move-change time as unverifiable rather than fresh', () => {
		expect(exclusionsAreVerified([row('a', '2026-08-18T12:00:00Z')], null)).toBe(false);
		expect(exclusionsAreVerified([], null)).toBe(true);
	});
});

describe('exclusionShape', () => {
	it('subtracts verified exclusions from the cached full count', () => {
		expect(
			exclusionShape({
				fullVariationCount: 10,
				rows: [row('a', SHAPE_CHANGED), row('b', SHAPE_CHANGED)],
				movesUpdatedAt: SHAPE_CHANGED
			})
		).toEqual({ total: 8, excludedVariationCount: 2 });
	});

	it('returns a null total when the rows are not verified, so the caller enumerates instead', () => {
		expect(
			exclusionShape({
				fullVariationCount: 10,
				rows: [row('a', EPOCH)],
				movesUpdatedAt: SHAPE_CHANGED
			}).total
		).toBeNull();
	});

	it('never returns a negative total, even if the full count were behind the exclusion set', () => {
		expect(
			exclusionShape({
				fullVariationCount: 1,
				rows: [row('a', SHAPE_CHANGED), row('b', SHAPE_CHANGED), row('c', SHAPE_CHANGED)],
				movesUpdatedAt: SHAPE_CHANGED
			})
		).toEqual({ total: 0, excludedVariationCount: 3 });
	});

	it('reports the full count untouched when there are no exclusions', () => {
		expect(exclusionShape({ fullVariationCount: 10, rows: [], movesUpdatedAt: SHAPE_CHANGED })).toEqual({
			total: 10,
			excludedVariationCount: 0
		});
	});

	it('keeps total + excluded within the full count, which is what the picker checkbox relies on', () => {
		// The skew this closes: excludedVariationCount used to be the raw row
		// count while total was filtered, so a stale row made the two sum past
		// fullVariationCount and the repertoire checkbox rendered wrongly.
		const shape = exclusionShape({
			fullVariationCount: 10,
			rows: [row('a', SHAPE_CHANGED), row('b', SHAPE_CHANGED), row('c', SHAPE_CHANGED)],
			movesUpdatedAt: SHAPE_CHANGED
		});
		expect(shape.total! + shape.excludedVariationCount).toBe(10);
	});
});

describe('partitionByLiveness', () => {
	it('splits rows into stale (key gone) and live (key still enumerated)', () => {
		const rows = [row('a', EPOCH), row('gone', EPOCH), row('b', EPOCH)];
		const { stale, live } = partitionByLiveness(rows, new Set(['a', 'b']));
		expect(stale.map((r) => r.variationKey)).toEqual(['gone']);
		expect(live.map((r) => r.variationKey)).toEqual(['a', 'b']);
	});

	it('treats every row as stale when the repertoire enumerates nothing', () => {
		const rows = [row('a', EPOCH)];
		expect(partitionByLiveness(rows, new Set()).stale).toHaveLength(1);
	});

	it('preserves extra row fields, so callers can partition rows carrying their own ids', () => {
		const rows = [{ ...row('a', EPOCH), id: 'row-1' }];
		expect(partitionByLiveness(rows, new Set(['a'])).live[0].id).toBe('row-1');
	});
});
