import { describe, it, expect } from 'vitest';
import { loadRepertoireProgressSummaries } from './repertoire-progress';

/**
 * The whole point of the exclusion-freshness work (GitHub issue #52) is WHICH
 * queries this function does and doesn't make, so these tests assert on the
 * recorded calls as much as on the returned summaries — a correct total that
 * still costs a full move fetch per load is the bug, not the fix.
 *
 * The same is true of the lazy reconciliation bolted on beside it (issue #118),
 * for a second reason: reconciliation and the exclusion prune write to the SAME
 * rows in a specific order, so the recorded writes are the only way to tell a
 * rewritten exclusion from a deleted-and-forgotten one.
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

	// The same repertoire after the coach EXTENDED one line by a ply: 'm1>m2'
	// is no longer a variation key, 'm1>m2>m4' is. Still two variations, so a
	// count alone cannot tell the two shapes apart — only the keys can.
	const EXTENDED_MOVES = [
		...MOVES,
		{ id: 'm4', san: 'Nf3', is_player_turn: true, repertoire_id: 'r1', from_position: 'p2', to_position: 'p4', chapter_names: [] }
	];

	type ExclusionRecord = { id: string; repertoire_id: string; variation_key: string; verified_at: string };
	type TeachingRecord = { variation_key: string; taught_plies: number; mastered_plies: number; clean_pass_count: number };
	type Filter = [string, unknown];

	// The fake honours the SELECT COLUMN LIST — a column the query does not ask
	// for is not returned — which is what lets the assigned-repertoire tests
	// below catch a joined select that forgot `update_in_progress_at`.
	function project(row: Record<string, unknown>, columns: string): Record<string, unknown> {
		const inner = columns.includes('(') ? columns.slice(columns.indexOf('(') + 1, columns.lastIndexOf(')')) : columns;
		const asked = inner.split(',').map((c) => c.trim());
		return Object.fromEntries(asked.filter((c) => c in row).map((c) => [c, row[c]]));
	}

	function fakeSupabase(opts: {
		repertoire?: Record<string, unknown>;
		assigned?: Record<string, unknown>;
		exclusions?: ExclusionRecord[];
		solved?: string[];
		teaching?: TeachingRecord[];
		/** This player's current `chapter_mastery` rows for r1 (GitHub issue #105). */
		chapterMastery?: { moves_updated_at: string }[];
		moves?: typeof MOVES;
		/**
		 * This player's `repertoire_reconciliation.reconciled_at` for r1. Defaults
		 * to the repertoire's own `moves_updated_at` — i.e. already caught up —
		 * because the exclusion-freshness tests are about a student with nothing to
		 * reconcile, and leaving them behind would silently route every one of them
		 * through the reconciliation path instead. Pass null for NO stamp row,
		 * which is how a coach's reshape presents on the student's next load.
		 */
		reconciledAt?: string | null;
	}) {
		const calls = {
			/** Batched (`.in`) move fetches — the ones this loader does for itself. */
			moveFetches: [] as string[][],
			/** Single-repertoire (`.eq`) move fetches, i.e. reconciliation's own read. */
			reconcileMoveFetches: [] as string[],
			deletedIds: [] as string[],
			stamped: [] as { ids: string[]; verifiedAt: string }[],
			repertoireUpdates: [] as Record<string, unknown>[],
			reconciliationStamps: [] as Record<string, unknown>[],
			exclusionRekeys: [] as { fromKey: string; toKey: string; verifiedAt: string }[],
			solvedRekeys: [] as { fromKey: string; toKey: string }[],
			solvedDeletes: [] as string[],
			teachingRekeys: [] as { fromKey: string; toKey: string }[],
			teachingUpserts: [] as Record<string, unknown>[],
			demotions: [] as Record<string, unknown>[],
			activeCleared: 0,
			/** Badge rows granted by grantNewBadges(), i.e. whether badge sync ran at all. */
			badgesGranted: [] as string[]
		};
		const moves = opts.moves ?? MOVES;
		// MUTABLE, and deliberately so: reconciliation rewrites exclusion keys and
		// the loader then RE-READS them, so a fixture that answered every read from
		// the original array would hide exactly the bug the re-read exists for.
		const exclusions = (opts.exclusions ?? []).map((row) => ({ ...row }));
		const solvedRows = (opts.solved ?? []).map((variation_key) => ({ repertoire_id: 'r1', variation_key }));
		const teaching = (opts.teaching ?? []).map((row) => ({ ...row }));
		const chapterMastery = (opts.chapterMastery ?? []).map((row) => ({ repertoire_id: 'r1', ...row }));
		const reconciliationRows =
			opts.reconciledAt === null
				? []
				: [
						{
							repertoire_id: 'r1',
							reconciled_at: opts.reconciledAt ?? ((opts.repertoire ?? opts.assigned ?? {}).moves_updated_at as string)
						}
					];

		// fetchAllPages issues `.range(0, pageSize - 1)` and, only if that page
		// comes back full, a `head: true` count query — every fixture here is
		// far smaller than one page, so the count path is never reached. `getRows`
		// is a thunk so a read sees the CURRENT rows, not the ones that existed
		// when the query builder was created.
		const paged = (getRows: () => unknown[]): any => ({
			eq: () => paged(getRows),
			in: () => paged(getRows),
			order: () => paged(getRows),
			range: () => Promise.resolve({ data: getRows(), error: null }),
			maybeSingle: () => Promise.resolve({ data: getRows()[0] ?? null, error: null })
		});

		// Supabase query builders are chainable AND awaitable, so this fake is
		// both: `.eq`/`.in` extend the filter list and awaiting runs `terminal`.
		// One branch can then serve writes whose filter chains differ in length
		// and column (reconciliation rekeys by `variation_key`, the prune deletes
		// and stamps by row `id`) instead of guessing from chain depth.
		const filterChain = (terminal: (filters: Filter[]) => void): any => {
			const make = (filters: Filter[]): any => ({
				eq: (col: string, val: unknown) => make([...filters, [col, val]]),
				in: (col: string, val: unknown) => make([...filters, [col, val]]),
				then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
					Promise.resolve()
						.then(() => {
							terminal(filters);
							return { error: null };
						})
						.then(resolve, reject)
			});
			return make([]);
		};
		const filterValue = (filters: Filter[], col: string) => filters.find(([c]) => c === col)?.[1];

		const client = {
			from: (table: string) => {
				if (table === 'repertoires') {
					return {
						select: (columns: string) => ({
							eq: () => Promise.resolve({ data: opts.repertoire ? [project(opts.repertoire, columns)] : [], error: null })
						}),
						update: (values: Record<string, unknown>) => ({
							eq: () => {
								calls.repertoireUpdates.push(values);
								return Promise.resolve({ error: null });
							}
						})
					};
				}
				if (table === 'assigned_repertoires') {
					return {
						select: (columns: string) => ({
							eq: () =>
								Promise.resolve({
									data: opts.assigned ? [{ repertoire: project(opts.assigned, columns) }] : [],
									error: null
								})
						})
					};
				}
				if (table === 'repertoire_reconciliation') {
					return {
						select: () => paged(() => reconciliationRows),
						upsert: (values: Record<string, unknown>) => {
							calls.reconciliationStamps.push(values);
							return Promise.resolve({ error: null });
						}
					};
				}
				if (table === 'variation_practice_exclusions') {
					return {
						select: () => paged(() => exclusions),
						delete: () =>
							filterChain((filters) => {
								const ids = filterValue(filters, 'id') as string[];
								calls.deletedIds.push(...ids);
								for (const id of ids) {
									const at = exclusions.findIndex((row) => row.id === id);
									if (at >= 0) exclusions.splice(at, 1);
								}
							}),
						update: (values: Record<string, unknown>) =>
							filterChain((filters) => {
								const ids = filterValue(filters, 'id') as string[] | undefined;
								if (ids) {
									// The prune's `verified_at` stamp, batched by row id.
									calls.stamped.push({ ids, verifiedAt: values.verified_at as string });
									for (const row of exclusions) if (ids.includes(row.id)) row.verified_at = values.verified_at as string;
									return;
								}
								// Reconciliation's rekey, filtered by the OLD variation key.
								const fromKey = filterValue(filters, 'variation_key') as string;
								calls.exclusionRekeys.push({
									fromKey,
									toKey: values.variation_key as string,
									verifiedAt: values.verified_at as string
								});
								for (const row of exclusions) {
									if (row.variation_key !== fromKey) continue;
									row.variation_key = values.variation_key as string;
									row.verified_at = values.verified_at as string;
								}
							})
					};
				}
				if (table === 'variation_solved') {
					return {
						select: () => paged(() => solvedRows),
						update: (values: Record<string, unknown>) =>
							filterChain((filters) => {
								const fromKey = filterValue(filters, 'variation_key') as string;
								calls.solvedRekeys.push({ fromKey, toKey: values.variation_key as string });
								for (const row of solvedRows) {
									if (row.variation_key === fromKey) row.variation_key = values.variation_key as string;
								}
							}),
						delete: () =>
							filterChain((filters) => {
								const key = filterValue(filters, 'variation_key') as string;
								calls.solvedDeletes.push(key);
								const at = solvedRows.findIndex((row) => row.variation_key === key);
								if (at >= 0) solvedRows.splice(at, 1);
							})
					};
				}
				if (table === 'variation_teaching_progress') {
					return {
						select: () => paged(() => teaching),
						update: (values: Record<string, unknown>) =>
							filterChain((filters) => {
								const fromKey = filterValue(filters, 'variation_key') as string;
								calls.teachingRekeys.push({ fromKey, toKey: values.variation_key as string });
								for (const row of teaching) {
									if (row.variation_key === fromKey) row.variation_key = values.variation_key as string;
								}
							}),
						upsert: (rows: Record<string, unknown>[]) => {
							calls.teachingUpserts.push(...rows);
							return Promise.resolve({ error: null });
						}
					};
				}
				if (table === 'chapter_mastery') {
					return { select: () => paged(() => chapterMastery) };
				}
				if (table === 'variation_demotions') {
					return {
						insert: (rows: Record<string, unknown>[]) => {
							calls.demotions.push(...rows);
							return Promise.resolve({ error: null });
						}
					};
				}
				if (table === 'practice_active_variation') {
					return {
						select: () => paged(() => []),
						update: () =>
							filterChain(() => {
								calls.activeCleared += 1;
							})
					};
				}
				if (table === 'moves') {
					return {
						select: () => ({
							in: (_col: string, repIds: string[]) => {
								calls.moveFetches.push(repIds);
								return { is: () => paged(() => moves) };
							},
							eq: (_col: string, repId: string) => {
								calls.reconcileMoveFetches.push(repId);
								return { is: () => paged(() => moves) };
							}
						})
					};
				}
				// grantNewBadges() reads these once reconciliation actually changes
				// something (see repertoire-progress.ts) — none of the badge math
				// itself is this file's concern (that's grant.test.ts/recalc.test.ts),
				// these just need to answer so the wiring doesn't error mid-load. The
				// fixtures above give this player a repertoire, so first_repertoire/
				// uploader end up newly eligible — badges_earned needs insert(), not
				// just select(), to answer that.
				if (
					table === 'profiles' ||
					table === 'player_stats' ||
					table === 'sessions' ||
					table === 'quests' ||
					table === 'badges_earned'
				) {
					return {
						select: () => ({
							eq: () => ({
								single: () => Promise.resolve({ data: null, error: null }),
								not: () => Promise.resolve({ data: [], error: null }),
								then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
							})
						}),
						insert: (rows: Record<string, unknown>[]) => {
							if (table === 'badges_earned') calls.badgesGranted.push(...rows.map((r) => r.badge_id as string));
							return Promise.resolve({ error: null });
						},
						delete: () => ({ eq: () => ({ in: () => Promise.resolve({ error: null }) }) })
					};
				}
				throw new Error(`unexpected table ${table}`);
			}
		};

		return { client: client as any, calls, exclusions, solvedRows };
	}

	const cachedRepertoire = {
		id: 'r1',
		name: 'R1',
		color: 'white',
		total_variations: 10,
		has_chapters: false,
		chapter_count: 1,
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
			repertoire: { ...cachedRepertoire, total_variations: null, has_chapters: null, chapter_count: null }
		});

		const [summary] = await loadRepertoireProgressSummaries(client, USER);

		expect(calls.moveFetches).toEqual([['r1']]);
		expect(calls.repertoireUpdates).toEqual([{ total_variations: 2, has_chapters: false, chapter_count: 1 }]);
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

	it('does not reconcile a student already caught up with the shape', async () => {
		// The cost claim for the overwhelmingly common load: the reconciliation
		// stamp is READ (one query, alongside the two progress reads) and nothing
		// else happens — no move fetch, no writes.
		const { client, calls } = fakeSupabase({ repertoire: cachedRepertoire, reconciledAt: SHAPE_CHANGED });

		await loadRepertoireProgressSummaries(client, USER);

		expect(calls.moveFetches).toEqual([]);
		expect(calls.reconcileMoveFetches).toEqual([]);
		expect(calls.reconciliationStamps).toEqual([]);
		// No reconciliation, so no reason to re-check badges either.
		expect(calls.badgesGranted).toEqual([]);
	});

	it('rewrites an extended line\'s exclusion instead of pruning it', async () => {
		// THE trap this ordering exists for. The coach extended 'm1>m2' into
		// 'm1>m2>m4'; the student had excluded that line. Reconciliation rewrites
		// the key, and `reverifyExclusions` — which deletes by row ID any row whose
		// key is not live — must see the REWRITTEN key, not the stale in-memory one
		// it read before reconciliation ran. Reuse that stale copy and the row is
		// deleted by id, rewrite or no rewrite, and the student's "skip this line"
		// is gone for good.
		const { client, calls, exclusions } = fakeSupabase({
			repertoire: { ...cachedRepertoire, total_variations: 2 },
			moves: EXTENDED_MOVES,
			exclusions: [{ id: 'x1', repertoire_id: 'r1', variation_key: 'm1>m2', verified_at: EPOCH }],
			reconciledAt: null
		});

		const [summary] = await loadRepertoireProgressSummaries(client, USER);

		expect(calls.exclusionRekeys).toEqual([{ fromKey: 'm1>m2', toKey: 'm1>m2>m4', verifiedAt: SHAPE_CHANGED }]);
		// The row SURVIVES, carrying its new key — this is the whole assertion.
		expect(calls.deletedIds).toEqual([]);
		expect(exclusions).toEqual([
			{ id: 'x1', repertoire_id: 'r1', variation_key: 'm1>m2>m4', verified_at: SHAPE_CHANGED }
		]);
		// And it still counts as an exclusion, against the new shape: 2 live
		// variations, 1 of them excluded.
		expect(summary.excludedVariationCount).toBe(1);
		expect(summary.total).toBe(1);
		// Stamped last and only on success, so the next load skips all of this.
		expect(calls.reconciliationStamps).toEqual([
			{ player_id: USER, repertoire_id: 'r1', reconciled_at: SHAPE_CHANGED }
		]);
		// Reconciliation ran, so badges are re-checked against the new status —
		// this player's one repertoire makes first_repertoire/uploader newly
		// eligible, which is besides this test's point but is what proves the
		// wiring actually fired (see grant.test.ts/recalc.test.ts for the badge
		// math itself).
		expect(calls.badgesGranted.length).toBeGreaterThan(0);
	});

	it('reconciles a repertoire whose exclusions are already verified', async () => {
		// `unverifiedIds` is computed from EXCLUSION freshness, so a student with
		// learned lines and no exclusions is not in it at all — and used to be
		// skipped entirely. This one has to be enumerated and reconciled anyway,
		// and then to fall through the exclusion work untouched.
		const { client, calls } = fakeSupabase({
			repertoire: cachedRepertoire,
			moves: EXTENDED_MOVES,
			solved: ['m1>m2'],
			reconciledAt: null
		});

		const [summary] = await loadRepertoireProgressSummaries(client, USER);

		expect(calls.reconcileMoveFetches).toEqual(['r1']);
		// The line was extended, so the learned badge does not survive it.
		expect(calls.solvedDeletes).toEqual(['m1>m2']);
		expect(calls.demotions).toEqual([
			{ player_id: USER, repertoire_id: 'r1', variation_key: 'm1>m2>m4', cause: 'coach_update' }
		]);
		expect(calls.reconciliationStamps).toHaveLength(1);
		// No exclusions, so no prune and no stamp — and the repertoire is still
		// reported rather than dropped out of the summaries.
		expect(calls.deletedIds).toEqual([]);
		expect(calls.stamped).toEqual([]);
		expect(summary.id).toBe('r1');
		expect(summary.total).toBe(10);
		// The demoted badge is gone from the count on THIS load. `solved` is read
		// before reconciliation runs, so it is RE-READ for any repertoire that
		// actually reconciled — otherwise this reported 1 here and 0 on the next
		// load, for no reason the student could see.
		expect(summary.solved).toBe(0);
	});

	it('reports the post-reconciliation solved count on the load that reconciles', async () => {
		// Two learned lines, one of which the coach extended out from under the
		// student: 'm1>m2' is demoted, 'm1>m3' survives. The pre-reconcile read says
		// 2, the truth after reconciliation is 1 — and a count that reads 2 now and
		// 1 on the next page load is exactly the unexplained drop this whole feature
		// exists to avoid. Asserting 1 (not 0) also keeps a re-read that returned
		// nothing at all from passing this test.
		const { client, calls } = fakeSupabase({
			repertoire: cachedRepertoire,
			moves: EXTENDED_MOVES,
			solved: ['m1>m2', 'm1>m3'],
			reconciledAt: null
		});

		const [summary] = await loadRepertoireProgressSummaries(client, USER);

		expect(calls.solvedDeletes).toEqual(['m1>m2']);
		expect(summary.solved).toBe(1);
	});

	it('skips reconciliation for an assigned repertoire whose apply is still in flight', async () => {
		// The joined `repertoire:repertoire_id(...)` select must ask for
		// `update_in_progress_at` too: a column it forgets comes back undefined,
		// which reads as "no apply in flight", and reconciling against a
		// half-applied shape deletes progress that does not come back. The fake
		// honours the select list, so this test fails outright if the column is
		// dropped from the assigned select.
		const { client, calls } = fakeSupabase({
			assigned: { ...cachedRepertoire, update_in_progress_at: new Date(Date.now() - 60_000).toISOString() },
			moves: EXTENDED_MOVES,
			solved: ['m1>m2'],
			reconciledAt: null
		});

		const [summary] = await loadRepertoireProgressSummaries(client, USER);

		expect(calls.reconcileMoveFetches).toEqual([]);
		expect(calls.reconciliationStamps).toEqual([]);
		expect(calls.solvedDeletes).toEqual([]);
		// The student sees the pre-existing cached numbers, unchanged — the load is
		// a normal one, it just leaves the catching-up to a later one.
		expect(summary.total).toBe(10);
	});

	it('does not prune exclusions against a half-applied shape', async () => {
		// The prune's own half of the in-flight guard (`isApplyInFlight`), which is
		// NOT covered by the reconciliation tests above: this student is already
		// caught up (the default `reconciledAt`), so reconciliation has nothing to
		// decline — only the prune is in play. 0055's trigger bumped
		// `moves_updated_at` when the apply STARTED, so these rows read as
		// unverified, and the shape visible right now is half-applied: 'm1>gone' is
		// absent from it. Enumerate and the row is deleted by id, permanently, even
		// though the finished shape may well contain that line.
		const { client, calls, exclusions } = fakeSupabase({
			repertoire: {
				...cachedRepertoire,
				total_variations: 2,
				update_in_progress_at: new Date(Date.now() - 60_000).toISOString()
			},
			exclusions: [{ id: 'x1', repertoire_id: 'r1', variation_key: 'm1>gone', verified_at: EPOCH }]
		});

		const [summary] = await loadRepertoireProgressSummaries(client, USER);

		// Not enumerated at all, so nothing was judged stale in the first place.
		expect(calls.moveFetches).toEqual([]);
		expect(calls.deletedIds).toEqual([]);
		// And not stamped either: stamping would claim this row had been checked
		// against a shape that is still being written, and the next load would then
		// subtract it without ever checking.
		expect(calls.stamped).toEqual([]);
		expect(exclusions).toEqual([{ id: 'x1', repertoire_id: 'r1', variation_key: 'm1>gone', verified_at: EPOCH }]);
		// The load is still a normal one — the repertoire must not drop out of the
		// summaries because it was held back. Its total is the UNFILTERED count for
		// this one load (nothing enumerated it, and the rows are unverified), which
		// can only overstate what's left to practice; it resolves on the load after
		// the apply finishes.
		expect(summary.id).toBe('r1');
		expect(summary.total).toBe(2);
	});

	it('reconciles an assigned repertoire once its apply has finished', async () => {
		// The other half of the pair above: with no flag set, an ASSIGNED
		// repertoire reconciles like an owned one. This is the case issue #118 is
		// actually about, and it silently did nothing while the joined select was
		// missing `update_in_progress_at`.
		const { client, calls, exclusions } = fakeSupabase({
			assigned: { ...cachedRepertoire, total_variations: 2, update_in_progress_at: null },
			moves: EXTENDED_MOVES,
			exclusions: [{ id: 'x1', repertoire_id: 'r1', variation_key: 'm1>m2', verified_at: EPOCH }],
			reconciledAt: null
		});

		const [summary] = await loadRepertoireProgressSummaries(client, USER);

		expect(calls.reconcileMoveFetches).toEqual(['r1']);
		expect(calls.deletedIds).toEqual([]);
		expect(exclusions[0].variation_key).toBe('m1>m2>m4');
		expect(summary.excludedVariationCount).toBe(1);
	});

	describe('status (GitHub issue #105)', () => {
		it('is learning while anything is unsolved, regardless of chapter mastery', async () => {
			const { client } = fakeSupabase({
				repertoire: { ...cachedRepertoire, total_variations: 2 },
				solved: ['m1>m2'],
				chapterMastery: [{ moves_updated_at: SHAPE_CHANGED }]
			});
			const [summary] = await loadRepertoireProgressSummaries(client, USER);
			expect(summary.status).toBe('learning');
		});

		it('is learned once everything is solved but no current chapter mastery exists', async () => {
			const { client } = fakeSupabase({
				repertoire: { ...cachedRepertoire, total_variations: 2 },
				solved: ['m1>m2', 'm1>m3']
			});
			const [summary] = await loadRepertoireProgressSummaries(client, USER);
			expect(summary.status).toBe('learned');
		});

		it('is mastered once everything is solved and the cached chapter count matches current mastery', async () => {
			const { client } = fakeSupabase({
				repertoire: { ...cachedRepertoire, total_variations: 2 },
				solved: ['m1>m2', 'm1>m3'],
				chapterMastery: [{ moves_updated_at: SHAPE_CHANGED }]
			});
			const [summary] = await loadRepertoireProgressSummaries(client, USER);
			expect(summary.status).toBe('mastered');
		});

		it('drops from mastered back to learned when the mastery record is stale', async () => {
			const { client } = fakeSupabase({
				repertoire: { ...cachedRepertoire, total_variations: 2 },
				solved: ['m1>m2', 'm1>m3'],
				chapterMastery: [{ moves_updated_at: EPOCH }]
			});
			const [summary] = await loadRepertoireProgressSummaries(client, USER);
			expect(summary.status).toBe('learned');
		});
	});
});
