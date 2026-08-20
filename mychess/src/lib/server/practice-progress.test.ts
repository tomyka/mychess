// mychess/src/lib/server/practice-progress.test.ts
import { describe, it, expect } from 'vitest';
import { applyAttemptResult, touchVariationAttempt, loadVariationUpdatedAt } from './practice-progress';
import type { Variation } from '$lib/mastery/variations';

// Graduation needs two clean passes >=20h apart (#104), so these tests pin the
// clock rather than relying on wall time.
const FIRST_PASS = new Date('2026-08-20T09:00:00.000Z');
const NEXT_DAY = new Date('2026-08-21T09:00:00.000Z');

function makeVariation(variationKey: string, plies: number): Variation {
	const path = Array.from({ length: plies }, (_, i) => ({
		moveId: `${variationKey}-p${i}`,
		san: `M${i}`,
		fromFen: `f${i}a`,
		toFen: `f${i}b`,
		isPlayerTurn: i % 2 === 0
	}));
	return { leafMoveId: path[path.length - 1].moveId, variationKey, path, playerMoveCount: Math.ceil(plies / 2), chapterNames: [] };
}

/** Two variations sharing the same leading 10 plies (5 player moves), each with its own 2-ply branch after. */
function makeSharedPrefixVariations(): { a: Variation; b: Variation } {
	const shared = Array.from({ length: 10 }, (_, i) => ({
		moveId: `shared-p${i}`,
		san: `M${i}`,
		fromFen: `f${i}a`,
		toFen: `f${i}b`,
		isPlayerTurn: i % 2 === 0
	}));
	function branch(variationKey: string): Variation {
		const path = [
			...shared,
			{ moveId: `${variationKey}-p10`, san: 'M10', fromFen: 'f10a', toFen: 'f10b', isPlayerTurn: true },
			{ moveId: `${variationKey}-p11`, san: 'M11', fromFen: 'f10b', toFen: 'f11a', isPlayerTurn: false }
		];
		return { leafMoveId: path[path.length - 1].moveId, variationKey, path, playerMoveCount: 6, chapterNames: [] };
	}
	return { a: branch('a'), b: branch('b') };
}

function fakeSupabase(opts: {
	solvedKeys?: string[];
	teachingRows?: Array<{
		variation_key: string;
		taught_plies: number;
		mastered_plies: number;
		clean_pass_count?: number;
		last_clean_pass_at?: string | null;
	}>;
} = {}) {
	const solved = new Set(opts.solvedKeys ?? []);
	const teachingRows = opts.teachingRows ?? [];
	const fromCalls: string[] = [];
	const upsertCalls: Array<{ table: string; rows: any; options: any }> = [];

	// Both reads are paginated now (see `fetchAllPages`), so a read chain ends
	// in `.order(...).range(...)`. Every fixture here is far under one page, so
	// the exact-count lookup is never reached.
	const pagedRead = (data: () => any[]) => ({
		eq: () => ({
			eq: () => ({
				order: () => ({ range: () => Promise.resolve({ data: data(), error: null }) })
			})
		})
	});

	const client = {
		from: (table: string) => {
			fromCalls.push(table);
			if (table === 'variation_solved') {
				return {
					select: () => pagedRead(() => Array.from(solved).map((variation_key) => ({ variation_key }))),
					upsert: (rows: any, options: any) => {
						upsertCalls.push({ table, rows, options });
						solved.add((Array.isArray(rows) ? rows[0] : rows).variation_key);
						return Promise.resolve({ error: null });
					}
				};
			}
			if (table === 'variation_teaching_progress') {
				return {
					select: (columns: string) => {
						if (columns === 'updated_at') {
							// Single-row lookup path used by loadVariationUpdatedAt: each
							// .eq() narrows a running filter; .maybeSingle() resolves it.
							let filters: Record<string, string> = {};
							const node: any = {
								eq: (col: string, value: string) => {
									filters = { ...filters, [col]: value };
									return node;
								},
								maybeSingle: () =>
									Promise.resolve({
										data: teachingRows.find((r: any) => r.variation_key === filters.variation_key) ?? null,
										error: null
									})
							};
							return node;
						}
						return pagedRead(() => teachingRows);
					},
					upsert: (rows: any, options: any) => {
						upsertCalls.push({ table, rows, options });
						return Promise.resolve({ error: null });
					}
				};
			}
			if (table === 'practice_active_variation') {
				return {
					upsert: (rows: any, options: any) => {
						upsertCalls.push({ table, rows, options });
						return Promise.resolve({ error: null });
					}
				};
			}
			throw new Error(`fakeSupabase: unexpected table ${table}`);
		}
	};

	return { client, fromCalls, upsertCalls };
}

describe('applyAttemptResult', () => {
	it('makes no reads or writes at all on a mistaken attempt', async () => {
		const { client, fromCalls, upsertCalls } = fakeSupabase();
		const v1 = makeVariation('v1', 25);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', true, [v1]);
		expect(fromCalls).toHaveLength(0);
		expect(upsertCalls).toHaveLength(0);
	});

	it('a clean teach-batch pass on a fresh variation advances taught_plies to the first batch only, and does not touch variation_solved', async () => {
		const { client, upsertCalls } = fakeSupabase({ teachingRows: [] });
		const v1 = makeVariation('v1', 25);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1]);
		expect(upsertCalls).toEqual([
			{
				table: 'variation_teaching_progress',
				// Ends right after the player's 5th move (ply 8, player moves
				// first in this fixture), not a flat 10-ply offset.
				rows: { player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v1', taught_plies: 9, mastered_plies: 0 },
				options: { onConflict: 'player_id,variation_key_hash' }
			}
		]);
	});

	it('a clean non-final blind retest advances mastered_plies only, and does not touch variation_solved', async () => {
		const { client, upsertCalls } = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 20, mastered_plies: 10 }]
		});
		const v1 = makeVariation('v1', 25);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1]);
		expect(upsertCalls).toEqual([
			{
				table: 'variation_teaching_progress',
				rows: { player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v1', taught_plies: 20, mastered_plies: 20 },
				options: { onConflict: 'player_id,variation_key_hash' }
			}
		]);
	});

	it('records a resumed-after-break attempt against a zeroed floor, not the raw stored counters', async () => {
		const { client, upsertCalls } = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 20, mastered_plies: 10 }]
		});
		const v1 = makeVariation('v1', 25);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1], true);
		expect(upsertCalls).toEqual([
			{
				table: 'variation_teaching_progress',
				// Same shape as a genuinely fresh variation's first teach pass —
				// the raw 20/10 stored counters are ignored entirely because this
				// attempt was served reset to 0, so it must be recorded as if it
				// started from 0 too.
				rows: { player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v1', taught_plies: 9, mastered_plies: 0 },
				options: { onConflict: 'player_id,variation_key_hash' }
			}
		]);
	});

	it('the final batch\'s clean blind retest records a first clean pass WITHOUT learning the variation', async () => {
		const { client, upsertCalls } = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 25, mastered_plies: 20 }]
		});
		const v1 = makeVariation('v1', 25);
		const v2 = makeVariation('v2', 4);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1, v2], false, FIRST_PASS);

		// Was "solved" before #104. One clean pass is now evidence, not
		// graduation: the counters advance and the clock starts, but no
		// variation_solved row and no move to the next variation — the player
		// still owes a cold replay tomorrow.
		expect(upsertCalls).toEqual([
			{
				table: 'variation_teaching_progress',
				rows: {
					player_id: 'player-1',
					repertoire_id: 'rep-1',
					variation_key: 'v1',
					taught_plies: 25,
					mastered_plies: 25,
					clean_pass_count: 1,
					last_clean_pass_at: FIRST_PASS.toISOString()
				},
				options: { onConflict: 'player_id,variation_key_hash' }
			}
		]);
	});

	it('graduates the variation on a second clean pass a day later, then advances the active variation', async () => {
		const { client, upsertCalls } = fakeSupabase({
			teachingRows: [
				{
					variation_key: 'v1',
					taught_plies: 25,
					mastered_plies: 25,
					clean_pass_count: 1,
					last_clean_pass_at: FIRST_PASS.toISOString()
				}
			]
		});
		const v1 = makeVariation('v1', 25);
		const v2 = makeVariation('v2', 4);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1, v2], false, NEXT_DAY);

		expect(upsertCalls.map((c) => c.table)).toEqual([
			'variation_teaching_progress',
			'variation_solved',
			'practice_active_variation'
		]);
		expect(upsertCalls[0].rows).toEqual({
			player_id: 'player-1',
			repertoire_id: 'rep-1',
			variation_key: 'v1',
			taught_plies: 25,
			mastered_plies: 25,
			clean_pass_count: 2,
			last_clean_pass_at: NEXT_DAY.toISOString()
		});
		expect(upsertCalls[2].rows).toEqual(
			expect.objectContaining({ active_variation_key: 'v2' })
		);
	});

	it('does not graduate a second clean pass taken too soon, and does not slide the clock', async () => {
		const tooSoon = new Date(FIRST_PASS.getTime() + 3 * 60 * 60 * 1000);
		const { client, upsertCalls } = fakeSupabase({
			teachingRows: [
				{
					variation_key: 'v1',
					taught_plies: 25,
					mastered_plies: 25,
					clean_pass_count: 1,
					last_clean_pass_at: FIRST_PASS.toISOString()
				}
			]
		});
		const v1 = makeVariation('v1', 25);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1], false, tooSoon);

		expect(upsertCalls.map((c) => c.table)).toEqual(['variation_teaching_progress']);
		expect(upsertCalls[0].rows).toEqual(
			expect.objectContaining({ clean_pass_count: 1, last_clean_pass_at: FIRST_PASS.toISOString() })
		);
	});

	it('bypasses teaching progress entirely for an already-solved variation (re-drill)', async () => {
		const { client, upsertCalls } = fakeSupabase({ solvedKeys: ['v1'] });
		const v1 = makeVariation('v1', 25);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1]);
		expect(upsertCalls.some((c) => c.table === 'variation_teaching_progress')).toBe(false);
		expect(upsertCalls.some((c) => c.table === 'variation_solved')).toBe(true);
	});

	it('credits a fresh sibling variation for a shared prefix already solved via another variation', async () => {
		const { a, b } = makeSharedPrefixVariations();
		const { client, upsertCalls } = fakeSupabase({ solvedKeys: ['a'], teachingRows: [] });
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'b', false, [a, b], false, FIRST_PASS);
		// b's own path is only 2 plies past the shared 10, so its whole
		// remaining content is taught in one go — and mastered_plies starts at
		// 10 (credited from a), not 0, so this teach pass reaches b's full path
		// length with a mastered prefix behind it: it IS b's final pass, and a
		// clean run of it solves b outright rather than demanding an identical
		// arrow-free replay of the same two plies (issue #68).
		// The shared-prefix credit is unchanged; what changed with #104 is that
		// reaching the end cleanly is a first clean pass, not graduation.
		expect(upsertCalls.map((c) => c.table)).toEqual(['variation_teaching_progress']);
		expect(upsertCalls[0].rows).toEqual({
			player_id: 'player-1',
			repertoire_id: 'rep-1',
			variation_key: 'b',
			taught_plies: 12,
			mastered_plies: 12,
			clean_pass_count: 1,
			last_clean_pass_at: FIRST_PASS.toISOString()
		});
	});

	it('a clean teach pass reaching the path\'s end over an already-mastered prefix solves the variation outright', async () => {
		// 16 plies / 8 player moves — the issue's own repro shape: batch 1 is
		// plies 0-8, batch 2 (plies 9-15) is the rest, so this teach pass has
		// nothing left to teach afterwards and no longer owes a second,
		// identical arrow-free replay of the same tail.
		const { client, upsertCalls } = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 9, mastered_plies: 9 }]
		});
		const v1 = makeVariation('v1', 16);
		const v2 = makeVariation('v2', 4);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1, v2], false, FIRST_PASS);

		// Still one pass, not a solve (#104) — the issue-#68 behaviour being
		// pinned here is that this pass owes no second arrow-free replay of the
		// same tail, which is unchanged.
		expect(upsertCalls).toEqual([
			{
				table: 'variation_teaching_progress',
				rows: {
					player_id: 'player-1',
					repertoire_id: 'rep-1',
					variation_key: 'v1',
					taught_plies: 16,
					mastered_plies: 16,
					clean_pass_count: 1,
					last_clean_pass_at: FIRST_PASS.toISOString()
				},
				options: { onConflict: 'player_id,variation_key_hash' }
			}
		]);
	});

	it('a fresh SINGLE-batch variation still needs its blind retest before it is solved — a first teach pass never solves', async () => {
		// Nothing mastered yet, and one batch covers the whole 6-ply path: this
		// variation has never once been played without arrows, so it advances
		// taught_plies only and variation_solved stays untouched.
		const { client, upsertCalls } = fakeSupabase({ teachingRows: [] });
		const v1 = makeVariation('v1', 6);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1]);
		expect(upsertCalls).toEqual([
			{
				table: 'variation_teaching_progress',
				rows: { player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v1', taught_plies: 6, mastered_plies: 0 },
				options: { onConflict: 'player_id,variation_key_hash' }
			}
		]);
	});
});

describe('loadVariationUpdatedAt', () => {
	it('returns the row\'s updated_at, or null if no matching row exists', async () => {
		const { client } = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 5, mastered_plies: 3, updated_at: '2026-08-17T11:00:00Z' } as any]
		});
		expect(await loadVariationUpdatedAt(client as any, 'player-1', 'rep-1', 'v1')).toBe('2026-08-17T11:00:00Z');
		expect(await loadVariationUpdatedAt(client as any, 'player-1', 'rep-1', 'v2')).toBeNull();
	});
});

describe('touchVariationAttempt', () => {
	it('upserts only updated_at, leaving taught_plies/mastered_plies out of the payload', async () => {
		const { client, upsertCalls } = fakeSupabase();
		await touchVariationAttempt(client as any, 'player-1', 'rep-1', 'v1');
		expect(upsertCalls).toHaveLength(1);
		expect(upsertCalls[0].table).toBe('variation_teaching_progress');
		expect(upsertCalls[0].options).toEqual({ onConflict: 'player_id,variation_key_hash' });
		// No taught_plies/mastered_plies in the payload: PostgREST's upsert only
		// updates columns actually present in the row on conflict, so omitting
		// them here is what keeps an existing row's real progress untouched.
		expect(upsertCalls[0].rows).toEqual({
			player_id: 'player-1',
			repertoire_id: 'rep-1',
			variation_key: 'v1',
			updated_at: expect.any(String)
		});
	});
});
