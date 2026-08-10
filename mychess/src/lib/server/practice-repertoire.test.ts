import { describe, it, expect } from 'vitest';
import { remainingPageRanges } from './practice-repertoire';

describe('remainingPageRanges', () => {
	it('returns nothing when the total fits in the already-fetched first page', () => {
		expect(remainingPageRanges(800, 1000)).toEqual([]);
	});

	it('returns nothing when the total is exactly one page', () => {
		expect(remainingPageRanges(1000, 1000)).toEqual([]);
	});

	it('returns one range for a total just over one page', () => {
		expect(remainingPageRanges(1500, 1000)).toEqual([[1000, 1999]]);
	});

	it('returns one range per additional page, in order, for a large total', () => {
		expect(remainingPageRanges(10154, 1000)).toEqual([
			[1000, 1999],
			[2000, 2999],
			[3000, 3999],
			[4000, 4999],
			[5000, 5999],
			[6000, 6999],
			[7000, 7999],
			[8000, 8999],
			[9000, 9999],
			[10000, 10999]
		]);
	});
});
