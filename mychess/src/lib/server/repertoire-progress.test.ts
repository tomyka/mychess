import { describe, it, expect } from 'vitest';
import { loadRepertoireProgressSummaries } from './repertoire-progress';

/**
 * The whole point of the exclusion-freshness work (GitHub issue #52) is WHICH
 * queries this function does and doesn't make, so these tests assert on the
 * recorded calls as much as on the returned summaries — a correct total that
 * still costs a full move fetch per load is the bug, not the fix.
 */
describe('loadRepertoireProgressSummaries', () => {
	const USER = 'player-1';
	const SHAPE_CHANGED = '2026-08-18T10:00:00Z';
	const EPOCH = '1970-01-01T00:00:00Z';

	// p0 -m1-> p1, then p1 branches into two leaves: two variations,
	// 'm1>m2' and 'm1>m3'. Untagged (no chapter_names), so one scoped walk.
	const MOVES = [
		{ id: 'm1', san: 'e4', is_player_turn: true, repertoire_id: 'r1', from_position: 'p0', to_position: 'p1', chapter_names: [] },
		{ id: 'm2', san: 'e5', is_player_turn: false, repertoire_id: 'r1', from_position: 'p1', to_position: 'p2', chapter_names: [] },
		{ id: 'm3', san: 'c5', is_player_turn: false, repertoire_id: 'r1', from_position: 'p1', to_position: 'p3', chapter_names: [] }
	];

	type ExclusionRecord = { id: string; repertoire_id: string; variation_key: string; verified_at: string };

	function fakeSupabase(opts: {
		repertoire: Record<string, unknown>;
		exclusions?: ExclusionRecord[];
		solved?: string[];
		moves?: typeof MOVES;
	}) {
		const calls = {
			moveFetches: [] as string[][],
			deletedIds: [] as string[],
			stamped: [] as { ids: string[]; verifiedAt: string }[],
			repertoireUpdates: [] as Record<string, unknown>[]
		};
		const moves = opts.moves ?? MOVES;

		// fetchAllPages issues `.range(0, pageSize - 1)` and, only if that page
		// comes back full, a `head: true` count query — every fixture here is
		// far smaller than one page, so the count path is never reached.
		const paged = (rows: unknown[]) => ({ order: () => ({ range: () => Promise.resolve({ data: rows, error: null }) }) });

		const client = {
			from: (table: string) => {
				if (table === 'repertoires') {
					return {
						select: () => ({ eq: () => Promise.resolve({ data: [opts.repertoire], error: null }) }),
						update: (values: Record<string, unknown>) => ({
							eq: () => {
								calls.repertoireUpdates.push(values);
								return Promise.resolve({ error: null });
							}
						})
					};
				}
				if (table === 'assigned_repertoires') {
					return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
				}
				if (table === 'variation_practice_exclusions') {
					return {
						select: () => ({ eq: () => ({ in: () => paged(opts.exclusions ?? []) }) }),
						delete: () => ({
							eq: () => ({
								in: (_col: string, ids: string[]) => {
									calls.deletedIds.push(...ids);
									return Promise.resolve({ error: null });
								}
							})
						}),
						update: (values: { verified_at: string }) => ({
							eq: () => ({
								in: (_col: string, ids: string[]) => {
									calls.stamped.push({ ids, verifiedAt: values.verified_at });
									return Promise.resolve({ error: null });
								}
							})
						})
					};
				}
				if (table === 'variation_solved') {
					const rows = (opts.solved ?? []).map((variation_key) => ({ repertoire_id: 'r1', variation_key }));
					return { select: () => ({ eq: () => ({ in: () => paged(rows) }) }) };
				}
				if (table === 'moves') {
					return {
						select: () => ({
							in: (_col: string, repIds: string[]) => {
								calls.moveFetches.push(repIds);
								return { order: () => ({ order: () => ({ range: () => Promise.resolve({ data: moves, error: null }) }) }) };
							}
						})
					};
				}
				throw new Error(`unexpected table ${table}`);
			}
		};

		return { client: client as any, calls };
	}

	const cachedRepertoire = {
		id: 'r1',
		name: 'R1',
		color: 'white',
		total_variations: 10,
		has_chapters: false,
		moves_updated_at: SHAPE_CHANGED
	};

	it('subtracts verified exclusions without fetching a single move row', async () => {
		const { client, calls } = fakeSupabase({
			repertoire: cachedRepertoire,
			exclusions: [
				{ id: 'x1', repertoire_id: 'r1', variation_key: 'k1', verified_at: SHAPE_CHANGED },
				{ id: 'x2', repertoire_id: 'r1', variation_key: 'k2', verified_at: SHAPE_CHANGED }
			],
			solved: ['k1', 'k9']
		});

		const [summary] = await loadRepertoireProgressSummaries(client, USER);

		// This assertion IS the issue: any exclusion at all used to force a full
		// move fetch plus a tree walk on every dashboard and picker load.
		expect(calls.moveFetches).toEqual([]);
		expect(summary.total).toBe(8);
		expect(summary.fullVariationCount).toBe(10);
		expect(summary.excludedVariationCount).toBe(2);
		// 'k1' is excluded so it doesn't count as solved; 'k9' does.
		expect(summary.solved).toBe(1);
	});

	it('enumerates once for unverified exclusions, then prunes the stale ones and stamps the rest', async () => {
		const { client, calls } = fakeSupabase({
			repertoire: { ...cachedRepertoire, total_variations: 2 },
			exclusions: [
				{ id: 'x-live', repertoire_id: 'r1', variation_key: 'm1>m2', verified_at: EPOCH },
				{ id: 'x-stale', repertoire_id: 'r1', variation_key: 'm1>gone', verified_at: EPOCH }
			]
		});

		const [summary] = await loadRepertoireProgressSummaries(client, USER);

		expect(calls.moveFetches).toEqual([['r1']]);
		expect(calls.deletedIds).toEqual(['x-stale']);
		// Stamped with the repertoire's own moves_updated_at, not a clock
		// reading — that exact value is what the freshness check compares
		// against, so this is what makes the next load skip the fetch.
		expect(calls.stamped).toEqual([{ ids: ['x-live'], verifiedAt: SHAPE_CHANGED }]);
		// Only the live exclusion counts: 2 variations - 1 = 1, and the stale
		// row is not reported as excluding anything either.
		expect(summary.total).toBe(1);
		expect(summary.excludedVariationCount).toBe(1);
	});

	it('never reports total + excluded past the repertoire\'s true variation count', async () => {
		// The picker's repertoire-level checkbox derives checked/indeterminate
		// from exactly these two numbers against fullVariationCount, so a stale
		// row inflating `excludedVariationCount` used to render the wrong state.
		const { client } = fakeSupabase({
			repertoire: { ...cachedRepertoire, total_variations: 2 },
			exclusions: [
				{ id: 'x-live', repertoire_id: 'r1', variation_key: 'm1>m2', verified_at: EPOCH },
				{ id: 'x-stale', repertoire_id: 'r1', variation_key: 'm1>gone', verified_at: EPOCH }
			]
		});

		const [summary] = await loadRepertoireProgressSummaries(client, USER);

		expect(summary.total + summary.excludedVariationCount).toBeLessThanOrEqual(summary.fullVariationCount);
	});

	it('still backfills and reports the enumerated total for a repertoire with no cached shape', async () => {
		// Regression guard: the freshness check must not shortcut the existing
		// lazy `total_variations` backfill. A repertoire with no cached count and
		// no exclusions has vacuously "verified" exclusions, and an earlier draft
		// of this therefore reported total 0 for every fresh import.
		const { client, calls } = fakeSupabase({
			repertoire: { ...cachedRepertoire, total_variations: null, has_chapters: null }
		});

		const [summary] = await loadRepertoireProgressSummaries(client, USER);

		expect(calls.moveFetches).toEqual([['r1']]);
		expect(calls.repertoireUpdates).toEqual([{ total_variations: 2, has_chapters: false }]);
		expect(summary.total).toBe(2);
		expect(summary.fullVariationCount).toBe(2);
	});

	it('does not touch exclusion rows when there are none to verify', async () => {
		const { client, calls } = fakeSupabase({ repertoire: cachedRepertoire, solved: ['m1>m2'] });

		const [summary] = await loadRepertoireProgressSummaries(client, USER);

		expect(calls.moveFetches).toEqual([]);
		expect(calls.deletedIds).toEqual([]);
		expect(calls.stamped).toEqual([]);
		expect(summary.total).toBe(10);
		expect(summary.solved).toBe(1);
	});
});
