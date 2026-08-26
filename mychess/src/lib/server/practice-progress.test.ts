// mychess/src/lib/server/practice-progress.test.ts
import { describe, it, expect } from 'vitest';
import { applyAttemptResult, touchVariationAttempt, loadVariationUpdatedAt } from './practice-progress';
import { UNTAGGED_CHAPTER, type Variation } from '$lib/mastery/variations';

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
			if (table === 'chapter_completed') {
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
				// Ends right after the player's 3rd move (ply 4, player moves
				// first in this fixture), not a flat 6-ply offset.
				rows: { player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v1', taught_plies: 5, mastered_plies: 0 },
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
				rows: { player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v1', taught_plies: 5, mastered_plies: 0 },
				options: { onConflict: 'player_id,variation_key_hash' }
			}
		]);
	});

	it('a clean pass reaching the end of the path learns the variation immediately, and advances the active variation', async () => {
		// Story #104's two-pass, 20h-gap graduation rule was removed: one clean
		// pass through the whole variation is enough. `demoteVariation` (the
		// Practice pool) is the safety net now — a later mistake or hint sends
		// a shakily-learned line straight back to Learn.
		const { client, upsertCalls } = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 25, mastered_plies: 20 }]
		});
		const v1 = makeVariation('v1', 25);
		const v2 = makeVariation('v2', 4);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1, v2]);

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
			mastered_plies: 25
		});
		expect(upsertCalls[2].rows).toEqual(expect.objectContaining({ active_variation_key: 'v2' }));
	});

	it('bypasses teaching progress entirely for an already-solved variation (re-drill)', async () => {
		const { client, upsertCalls } = fakeSupabase({ solvedKeys: ['v1'] });
		const v1 = makeVariation('v1', 25);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1]);
		expect(upsertCalls.some((c) => c.table === 'variation_teaching_progress')).toBe(false);
		expect(upsertCalls.some((c) => c.table === 'variation_solved')).toBe(true);
	});

	it('credits a fresh sibling variation for a shared prefix already solved via another variation, but still teaches its own tail first', async () => {
		const { a, b } = makeSharedPrefixVariations();
		const { client, upsertCalls } = fakeSupabase({ solvedKeys: ['a'], teachingRows: [] });
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'b', false, [a, b]);
		// b's own path is only 2 plies past the shared 10, so its whole
		// remaining content is taught in one go — and mastered_plies starts at
		// 10 (credited from a), not 0. That still leaves b's own two plies shown
		// under an arrow and never yet recalled, so this pass advances
		// taught_plies alone; b is learned by the blind retest that follows.
		expect(upsertCalls.map((c) => c.table)).toEqual(['variation_teaching_progress']);
		expect(upsertCalls[0].rows).toEqual({
			player_id: 'player-1',
			repertoire_id: 'rep-1',
			variation_key: 'b',
			taught_plies: 12,
			mastered_plies: 10
		});
	});

	it('a clean LAST teach pass advances teaching only — the variation is solved by the blind retest after it', async () => {
		// 8 plies / 4 player moves: batch 1 is plies 0-4, batch 2 (plies 5-7)
		// the rest. That last batch reaches the path's end, but its moves have
		// only ever been shown under an arrow, so nothing is mastered yet.
		const { client, upsertCalls } = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 5, mastered_plies: 5 }]
		});
		const v1 = makeVariation('v1', 8);
		const v2 = makeVariation('v2', 4);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1, v2]);

		expect(upsertCalls.map((c) => c.table)).toEqual(['variation_teaching_progress']);
		expect(upsertCalls[0].rows).toEqual({
			player_id: 'player-1',
			repertoire_id: 'rep-1',
			variation_key: 'v1',
			taught_plies: 8,
			mastered_plies: 5
		});

		// The arrow-free replay that follows is what learns it.
		const second = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 8, mastered_plies: 5 }]
		});
		await applyAttemptResult(second.client as any, 'player-1', 'rep-1', 'v1', false, [v1, v2]);
		expect(second.upsertCalls.map((c) => c.table)).toEqual([
			'variation_teaching_progress',
			'variation_solved',
			'practice_active_variation'
		]);
		expect(second.upsertCalls[0].rows).toEqual({
			player_id: 'player-1',
			repertoire_id: 'rep-1',
			variation_key: 'v1',
			taught_plies: 8,
			mastered_plies: 8
		});
	});

	it('a fresh SINGLE-batch variation still needs its blind retest before it is solved — a first teach pass never solves', async () => {
		// Nothing mastered yet, and one batch covers the whole 4-ply path: this
		// variation has never once been played without arrows, so it advances
		// taught_plies only and variation_solved stays untouched.
		const { client, upsertCalls } = fakeSupabase({ teachingRows: [] });
		const v1 = makeVariation('v1', 4);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1]);
		expect(upsertCalls).toEqual([
			{
				table: 'variation_teaching_progress',
				rows: { player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v1', taught_plies: 4, mastered_plies: 0 },
				options: { onConflict: 'player_id,variation_key_hash' }
			}
		]);
	});

	// Regression coverage for the exclusion-blocking bug: `allVariations` (the
	// 8th, UNFILTERED parameter) must include an excluded, never-solved
	// variation for the completed-chapters cache write to correctly stay
	// blocked by it — passing only the filtered `variations` here would
	// silently let the chapter sail past that variation's tier.
	it('does not cache a chapter as completed when an excluded, never-solved variation still caps its own ceiling', async () => {
		// v1 (silver tier: playerMoveCount 13) is the only PRACTICEABLE variation
		// — matching what /api/practice/attempt does before calling
		// applyAttemptResult, having already filtered `excludedVar` out of the
		// `variations` it passes as the 6th argument. `excludedVar` (gold tier:
		// playerMoveCount 20) is passed only via the 8th, UNFILTERED argument —
		// it can never appear in solvedKeys while excluded, which is exactly
		// what should keep this chapter below its own ceiling (gold) even once
		// v1 is solved.
		const { client, upsertCalls } = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 25, mastered_plies: 20 }]
		});
		const v1 = makeVariation('v1', 25);
		const excludedVar = makeVariation('excludedVar', 40);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1], false, [v1, excludedVar]);

		expect(upsertCalls.map((c) => c.table)).toEqual([
			'variation_teaching_progress',
			'variation_solved',
			'practice_active_variation'
		]);
		expect(upsertCalls.some((c) => c.table === 'chapter_completed')).toBe(false);
	});

	it('caches a chapter as completed once it reaches its own ceiling, without needing literal platinum', async () => {
		// v1 alone (silver tier), with no excluded sibling this time: once it's
		// solved, its chapter's own ceiling (silver — the highest tier it has
		// any content in) is reached, so it should be cached as completed even
		// though the chapter never reaches platinum.
		const { client, upsertCalls } = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 25, mastered_plies: 20 }]
		});
		const v1 = makeVariation('v1', 25);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1]);

		const cacheWrite = upsertCalls.find((c) => c.table === 'chapter_completed');
		expect(cacheWrite?.rows).toEqual([{ player_id: 'player-1', repertoire_id: 'rep-1', chapter_name: UNTAGGED_CHAPTER }]);
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
