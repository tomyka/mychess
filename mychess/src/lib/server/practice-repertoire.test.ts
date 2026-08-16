import { describe, it, expect } from 'vitest';
import { remainingPageRanges, validateVariationKeysOwnership } from './practice-repertoire';

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

describe('validateVariationKeysOwnership', () => {
	const MOVES_PAGE_SIZE = 1000; // mirrors the private constant in practice-repertoire.ts

	function fakeSupabase(
		opts: {
			repertoire?: { id: string } | null;
			repertoireError?: string;
			existingMoveIds?: string[];
			movesError?: string;
			countError?: string;
		} = {}
	) {
		const rangeCalls: { repertoireId: string; from: number; to: number }[] = [];
		const countCalls: string[] = [];
		const allIds = opts.existingMoveIds ?? [];
		return {
			client: {
				from: (table: string) => {
					if (table === 'repertoires') {
						return {
							select: () => ({
								eq: () => ({
									maybeSingle: () =>
										Promise.resolve(
											opts.repertoireError
												? { data: null, error: { message: opts.repertoireError } }
												: { data: opts.repertoire ?? null, error: null }
										)
								})
							})
						};
					}
					if (table === 'moves') {
						return {
							select: (_cols: string, selectOpts?: { count?: string; head?: boolean }) => ({
								eq: (_col: string, repertoireId: string) => {
									if (selectOpts?.head) {
										countCalls.push(repertoireId);
										return Promise.resolve(
											opts.countError
												? { data: null, count: null, error: { message: opts.countError } }
												: { data: null, count: allIds.length, error: null }
										);
									}
									return {
										order: () => ({
											range: (from: number, to: number) => {
												rangeCalls.push({ repertoireId, from, to });
												if (opts.movesError) {
													return Promise.resolve({ data: null, error: { message: opts.movesError } });
												}
												const page = allIds.slice(from, to + 1);
												return Promise.resolve({ data: page.map((id) => ({ id })), error: null });
											}
										})
									};
								}
							})
						};
					}
					throw new Error(`unexpected table ${table}`);
				}
			},
			rangeCalls,
			countCalls
		};
	}

	it('reports notFound when the repertoire does not exist (or is not accessible to the caller)', async () => {
		const { client } = fakeSupabase({ repertoire: null });
		const result = await validateVariationKeysOwnership(client as any, 'rep-1', ['m1']);
		expect(result).toEqual({ error: 'Repertoire not found', notFound: true });
	});

	it('propagates a repertoire lookup error', async () => {
		const { client } = fakeSupabase({ repertoireError: 'boom' });
		const result = await validateVariationKeysOwnership(client as any, 'rep-1', ['m1']);
		expect(result).toEqual({ error: 'boom', notFound: false });
	});

	it('no-ops (no error, no moves query) on an empty variationKeys array', async () => {
		const { client, rangeCalls } = fakeSupabase({ repertoire: { id: 'rep-1' } });
		const result = await validateVariationKeysOwnership(client as any, 'rep-1', []);
		expect(result).toEqual({ error: null, notFound: false });
		expect(rangeCalls).toHaveLength(0);
	});

	it('succeeds when every move id referenced by every key exists under this repertoire', async () => {
		const { client } = fakeSupabase({ repertoire: { id: 'rep-1' }, existingMoveIds: ['m1', 'm2', 'm3'] });
		const result = await validateVariationKeysOwnership(client as any, 'rep-1', ['m1>m2', 'm2>m3']);
		expect(result).toEqual({ error: null, notFound: false });
	});

	it('fetches the repertoire once regardless of how many (possibly duplicate) keys reference its moves', async () => {
		const { client, rangeCalls } = fakeSupabase({
			repertoire: { id: 'rep-1' },
			existingMoveIds: ['m1', 'm2', 'm3']
		});
		await validateVariationKeysOwnership(client as any, 'rep-1', ['m1>m2', 'm1>m3']);
		expect(rangeCalls).toHaveLength(1);
	});

	it('fails when a referenced move id does not exist under this repertoire — the actual security check', async () => {
		// m2 is real but belongs to (or was never inserted under) a different
		// repertoire — exactly the cross-repertoire collision this guards against.
		const { client } = fakeSupabase({ repertoire: { id: 'rep-1' }, existingMoveIds: ['m1'] });
		const result = await validateVariationKeysOwnership(client as any, 'rep-1', ['m1>m2']);
		expect(result).toEqual({ error: 'variationKeys must belong to this repertoire', notFound: false });
	});

	it('propagates a moves lookup error', async () => {
		const { client } = fakeSupabase({ repertoire: { id: 'rep-1' }, movesError: 'boom' });
		const result = await validateVariationKeysOwnership(client as any, 'rep-1', ['m1']);
		expect(result).toEqual({ error: 'boom', notFound: false });
	});

	it('propagates a count lookup error for a repertoire spanning more than one page', async () => {
		const ids = Array.from({ length: MOVES_PAGE_SIZE + 50 }, (_, i) => `m${i}`);
		const { client } = fakeSupabase({ repertoire: { id: 'rep-1' }, existingMoveIds: ids, countError: 'boom' });
		const result = await validateVariationKeysOwnership(client as any, 'rep-1', [ids.slice(0, 5).join('>')]);
		expect(result).toEqual({ error: 'boom', notFound: false });
	});

	it('pages through every move in a repertoire spanning more than one page, fetched concurrently', async () => {
		const ids = Array.from({ length: MOVES_PAGE_SIZE + 250 }, (_, i) => `m${i}`);
		const { client, rangeCalls } = fakeSupabase({ repertoire: { id: 'rep-1' }, existingMoveIds: ids });
		// References a move id that only exists on the second page — proves the
		// full repertoire (not just its first page) is checked.
		const result = await validateVariationKeysOwnership(client as any, 'rep-1', [`m0>m${MOVES_PAGE_SIZE + 100}`]);
		expect(result).toEqual({ error: null, notFound: false });
		expect(rangeCalls).toHaveLength(2); // page 1 (0..999) + page 2 (1000..1999)
	});
});
