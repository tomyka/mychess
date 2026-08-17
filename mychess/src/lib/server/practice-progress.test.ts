// mychess/src/lib/server/practice-progress.test.ts
import { describe, it, expect } from 'vitest';
import { applyAttemptResult } from './practice-progress';
import type { Variation } from '$lib/mastery/variations';

function makeVariation(variationKey: string, plies: number): Variation {
	const path = Array.from({ length: plies }, (_, i) => ({
		moveId: `${variationKey}-p${i}`,
		san: `M${i}`,
		fromFen: `f${i}a`,
		toFen: `f${i}b`,
		isPlayerTurn: i % 2 === 0
	}));
	return { leafMoveId: path[path.length - 1].moveId, variationKey, path, playerMoveCount: Math.ceil(plies / 2) };
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
		return { leafMoveId: path[path.length - 1].moveId, variationKey, path, playerMoveCount: 6 };
	}
	return { a: branch('a'), b: branch('b') };
}

function fakeSupabase(opts: {
	solvedKeys?: string[];
	teachingRows?: Array<{ variation_key: string; taught_plies: number; mastered_plies: number }>;
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
					select: () => pagedRead(() => teachingRows),
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

	it('the final batch\'s clean blind retest marks the variation solved and advances the active variation', async () => {
		const { client, upsertCalls } = fakeSupabase({
			teachingRows: [{ variation_key: 'v1', taught_plies: 25, mastered_plies: 20 }]
		});
		const v1 = makeVariation('v1', 25);
		const v2 = makeVariation('v2', 4);
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'v1', false, [v1, v2]);

		expect(upsertCalls).toEqual([
			{
				table: 'variation_teaching_progress',
				rows: { player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v1', taught_plies: 25, mastered_plies: 25 },
				options: { onConflict: 'player_id,variation_key_hash' }
			},
			{
				table: 'variation_solved',
				rows: { player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v1' },
				options: { onConflict: 'player_id,variation_key_hash', ignoreDuplicates: true }
			},
			{
				table: 'practice_active_variation',
				rows: expect.objectContaining({ player_id: 'player-1', repertoire_id: 'rep-1', active_variation_key: 'v2' }),
				options: { onConflict: 'player_id,repertoire_id' }
			}
		]);
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
		await applyAttemptResult(client as any, 'player-1', 'rep-1', 'b', false, [a, b]);
		expect(upsertCalls).toEqual([
			{
				table: 'variation_teaching_progress',
				// b's own path is only 2 plies past the shared 10, so its whole
				// remaining content is taught in one go — but mastered_plies
				// starts at 10 (credited from a), not 0.
				rows: { player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'b', taught_plies: 12, mastered_plies: 10 },
				options: { onConflict: 'player_id,variation_key_hash' }
			}
		]);
	});
});
