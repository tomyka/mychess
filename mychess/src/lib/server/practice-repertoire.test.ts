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
	function fakeSupabase(
		opts: {
			repertoire?: { id: string } | null;
			repertoireError?: string;
			existingMoveIds?: string[];
			movesError?: string;
		} = {}
	) {
		const movesInCalls: { repertoireId: string; ids: string[] }[] = [];
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
							select: () => ({
								eq: (_col: string, repertoireId: string) => ({
									in: (_col2: string, ids: string[]) => {
										movesInCalls.push({ repertoireId, ids });
										if (opts.movesError) {
											return Promise.resolve({ data: null, error: { message: opts.movesError } });
										}
										const found = (opts.existingMoveIds ?? []).filter((id) => ids.includes(id));
										return Promise.resolve({ data: found.map((id) => ({ id })), error: null });
									}
								})
							})
						};
					}
					throw new Error(`unexpected table ${table}`);
				}
			},
			movesInCalls
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
		const { client, movesInCalls } = fakeSupabase({ repertoire: { id: 'rep-1' } });
		const result = await validateVariationKeysOwnership(client as any, 'rep-1', []);
		expect(result).toEqual({ error: null, notFound: false });
		expect(movesInCalls).toHaveLength(0);
	});

	it('succeeds when every move id referenced by every key exists under this repertoire', async () => {
		const { client } = fakeSupabase({ repertoire: { id: 'rep-1' }, existingMoveIds: ['m1', 'm2', 'm3'] });
		const result = await validateVariationKeysOwnership(client as any, 'rep-1', ['m1>m2', 'm2>m3']);
		expect(result).toEqual({ error: null, notFound: false });
	});

	it('dedupes move ids shared across multiple keys before querying', async () => {
		const { client, movesInCalls } = fakeSupabase({
			repertoire: { id: 'rep-1' },
			existingMoveIds: ['m1', 'm2', 'm3']
		});
		await validateVariationKeysOwnership(client as any, 'rep-1', ['m1>m2', 'm1>m3']);
		expect(movesInCalls).toHaveLength(1);
		expect(movesInCalls[0].ids.slice().sort()).toEqual(['m1', 'm2', 'm3']);
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

	it('batches move-id lookups at 200 ids per call, querying every batch (concurrently, not sequentially)', async () => {
		const ids = Array.from({ length: 250 }, (_, i) => `m${i}`);
		const { client, movesInCalls } = fakeSupabase({ repertoire: { id: 'rep-1' }, existingMoveIds: ids });
		const result = await validateVariationKeysOwnership(client as any, 'rep-1', [ids.join('>')]);
		expect(result).toEqual({ error: null, notFound: false });
		expect(movesInCalls).toHaveLength(2); // 200 + 50
		expect(
			movesInCalls
				.map((c) => c.ids.length)
				.slice()
				.sort((a, b) => a - b)
		).toEqual([50, 200]);
	});
});
