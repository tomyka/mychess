import { describe, it, expect } from 'vitest';
import { fetchAllPages, remainingPageRanges } from './paginate';

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

describe('fetchAllPages', () => {
	/**
	 * A stand-in for a Supabase query builder chain, in the same style as
	 * `practice-repertoire.test.ts`'s `fakeSupabase`: `.select()` with
	 * `{ head: true }` answers the exact-count lookup, and the ordinary
	 * `.select().eq().order().range()` chain serves a slice of `rows`.
	 */
	function fakeSupabase(
		opts: {
			rows?: { id: string }[];
			count?: number;
			firstPageError?: string;
			laterPageError?: string;
			countError?: string;
		} = {}
	) {
		const rangeCalls: Array<[number, number]> = [];
		const countCalls: string[] = [];
		const allRows = opts.rows ?? [];

		const client = {
			from: (table: string) => {
				if (table !== 'rows') throw new Error(`unexpected table ${table}`);
				return {
					select: (_cols: string, selectOpts?: { count?: string; head?: boolean }) => ({
						eq: (_col: string, playerId: string) => {
							if (selectOpts?.head) {
								countCalls.push(playerId);
								return Promise.resolve(
									opts.countError
										? { data: null, count: null, error: { message: opts.countError } }
										: { data: null, count: opts.count ?? allRows.length, error: null }
								);
							}
							return {
								order: () => ({
									range: (from: number, to: number) => {
										rangeCalls.push([from, to]);
										const err = from === 0 ? opts.firstPageError : opts.laterPageError;
										if (err) return Promise.resolve({ data: null, error: { message: err } });
										return Promise.resolve({ data: allRows.slice(from, to + 1), error: null });
									}
								})
							};
						}
					})
				};
			}
		};

		return {
			buildQuery: () => (client.from('rows') as any).select('id').eq('player_id', 'p1').order('id', { ascending: true }),
			buildCountQuery: () => (client.from('rows') as any).select('id', { count: 'exact', head: true }).eq('player_id', 'p1'),
			rangeCalls,
			countCalls
		};
	}

	function rows(n: number, offset = 0) {
		return Array.from({ length: n }, (_, i) => ({ id: `r${i + offset}` }));
	}

	it('returns a short first page without ever issuing the count query', async () => {
		const fake = fakeSupabase({ rows: rows(3) });
		expect(await fetchAllPages(fake.buildQuery, fake.buildCountQuery, 5)).toEqual(rows(3));
		expect(fake.rangeCalls).toEqual([[0, 4]]);
		expect(fake.countCalls).toHaveLength(0);
	});

	it('returns an empty array when there are no rows at all', async () => {
		const fake = fakeSupabase({ rows: [] });
		expect(await fetchAllPages(fake.buildQuery, fake.buildCountQuery, 5)).toEqual([]);
		expect(fake.countCalls).toHaveLength(0);
	});

	it('counts but fetches no extra page when the result set is exactly one full page', async () => {
		const fake = fakeSupabase({ rows: rows(5) });
		expect(await fetchAllPages(fake.buildQuery, fake.buildCountQuery, 5)).toEqual(rows(5));
		// The full first page is indistinguishable from a truncated one without
		// asking, so the count lookup is unavoidable — but it proves there is
		// nothing more to fetch, so no second `.range()` goes out.
		expect(fake.countCalls).toHaveLength(1);
		expect(fake.rangeCalls).toEqual([[0, 4]]);
	});

	it('concatenates every page, in order, for a multi-page result set', async () => {
		const fake = fakeSupabase({ rows: rows(12) });
		expect(await fetchAllPages(fake.buildQuery, fake.buildCountQuery, 5)).toEqual(rows(12));
		expect(fake.rangeCalls).toEqual([
			[0, 4],
			[5, 9],
			[10, 14]
		]);
	});

	it('throws on a first-page error', async () => {
		const fake = fakeSupabase({ rows: rows(12), firstPageError: 'boom' });
		await expect(fetchAllPages(fake.buildQuery, fake.buildCountQuery, 5)).rejects.toEqual({ message: 'boom' });
		expect(fake.countCalls).toHaveLength(0);
	});

	it('throws on a count error', async () => {
		const fake = fakeSupabase({ rows: rows(12), countError: 'boom' });
		await expect(fetchAllPages(fake.buildQuery, fake.buildCountQuery, 5)).rejects.toEqual({ message: 'boom' });
		expect(fake.rangeCalls).toEqual([[0, 4]]);
	});

	it('throws on a later-page error rather than silently returning a partial result set', async () => {
		const fake = fakeSupabase({ rows: rows(12), laterPageError: 'boom' });
		await expect(fetchAllPages(fake.buildQuery, fake.buildCountQuery, 5)).rejects.toEqual({ message: 'boom' });
	});

	it('requests every remaining page concurrently, not one after another', async () => {
		const started: string[] = [];
		const openPage: Array<() => void> = [];
		const buildQuery = () => ({
			range: (from: number, to: number) => {
				started.push(`${from}-${to}`);
				if (from === 0) return Promise.resolve({ data: rows(5), error: null });
				return new Promise((resolve) => {
					openPage.push(() => resolve({ data: [{ id: `page@${from}` }], error: null }));
				});
			}
		});
		const buildCountQuery = () => Promise.resolve({ count: 15, error: null });

		const pending = fetchAllPages<{ id: string }>(buildQuery, buildCountQuery, 5);
		// Flush all pending microtasks (first page + count) without resolving
		// either remaining page: both must already be in flight. Serial paging
		// would have requested only `5-9` by now, since `10-14` would be waiting
		// on it.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(started).toEqual(['0-4', '5-9', '10-14']);
		expect(openPage).toHaveLength(2);

		for (const open of openPage) open();
		expect(await pending).toEqual([...rows(5), { id: 'page@5' }, { id: 'page@10' }]);
	});
});
