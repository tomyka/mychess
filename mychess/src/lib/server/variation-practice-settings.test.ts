import { describe, it, expect } from 'vitest';
import { setVariationsIncluded } from './variation-practice-settings';

function fakeSupabase(
	opts: { deleteErrorOnCall?: number; upsertErrorOnCall?: number; errorMessage?: string } = {}
) {
	const deleteCalls: any[] = [];
	const upsertCalls: any[] = [];
	return {
		client: {
			from: (table: string) => ({
				delete: () => ({
					eq: (col1: string, val1: string) => ({
						in: (col2: string, vals: string[]) => {
							deleteCalls.push({ table, col1, val1, col2, vals });
							const isErrorCall = opts.deleteErrorOnCall === deleteCalls.length;
							return Promise.resolve({ error: isErrorCall ? { message: opts.errorMessage ?? 'boom' } : null });
						}
					})
				}),
				upsert: (rows: any[], options: any) => {
					upsertCalls.push({ table, rows, options });
					const isErrorCall = opts.upsertErrorOnCall === upsertCalls.length;
					return Promise.resolve({ error: isErrorCall ? { message: opts.errorMessage ?? 'boom' } : null });
				}
			})
		},
		deleteCalls,
		upsertCalls
	};
}

describe('setVariationsIncluded', () => {
	it('no-ops on an empty variationKeys array without touching supabase at all', async () => {
		const { client, deleteCalls, upsertCalls } = fakeSupabase();
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', [], true);
		expect(result).toEqual({ error: null });
		expect(deleteCalls).toHaveLength(0);
		expect(upsertCalls).toHaveLength(0);
	});

	it('deletes matching exclusion rows when included is true', async () => {
		const { client, deleteCalls, upsertCalls } = fakeSupabase();
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', ['v1', 'v2'], true);
		expect(result).toEqual({ error: null });
		expect(deleteCalls).toEqual([
			{ table: 'variation_practice_exclusions', col1: 'player_id', val1: 'player-1', col2: 'variation_key', vals: ['v1', 'v2'] }
		]);
		expect(upsertCalls).toHaveLength(0);
	});

	it('upserts one row per key when included is false', async () => {
		const { client, deleteCalls, upsertCalls } = fakeSupabase();
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', ['v1', 'v2'], false);
		expect(result).toEqual({ error: null });
		expect(upsertCalls).toHaveLength(1);
		expect(upsertCalls[0].table).toBe('variation_practice_exclusions');
		expect(upsertCalls[0].rows).toEqual([
			{ player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v1' },
			{ player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v2' }
		]);
		expect(upsertCalls[0].options).toEqual({ onConflict: 'player_id,variation_key' });
		expect(deleteCalls).toHaveLength(0);
	});

	it('dedupes variationKeys before upserting, so a repeated key does not appear twice', async () => {
		const { client, upsertCalls } = fakeSupabase();
		await setVariationsIncluded(client as any, 'player-1', 'rep-1', ['v1', 'v2', 'v1'], false);
		expect(upsertCalls[0].rows).toEqual([
			{ player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v1' },
			{ player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v2' }
		]);
	});

	it('propagates a delete error message', async () => {
		const { client } = fakeSupabase({ deleteErrorOnCall: 1, errorMessage: 'boom' });
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', ['v1'], true);
		expect(result).toEqual({ error: 'boom' });
	});

	it('propagates an upsert error message', async () => {
		const { client } = fakeSupabase({ upsertErrorOnCall: 1, errorMessage: 'boom' });
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', ['v1'], false);
		expect(result).toEqual({ error: 'boom' });
	});

	it('batches a large delete (included: true) into multiple calls of at most 50 keys each', async () => {
		const { client, deleteCalls } = fakeSupabase();
		const keys = Array.from({ length: 120 }, (_, i) => `v${i}`);
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', keys, true);
		expect(result).toEqual({ error: null });
		expect(deleteCalls).toHaveLength(3); // 50 + 50 + 20
		expect(deleteCalls[0].vals).toHaveLength(50);
		expect(deleteCalls[1].vals).toHaveLength(50);
		expect(deleteCalls[2].vals).toHaveLength(20);
		// Every key is covered exactly once, in order, across the batches.
		expect(deleteCalls.flatMap((c) => c.vals)).toEqual(keys);
	});

	it('batches a large upsert (included: false) into multiple calls of at most 50 rows each', async () => {
		const { client, upsertCalls } = fakeSupabase();
		const keys = Array.from({ length: 120 }, (_, i) => `v${i}`);
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', keys, false);
		expect(result).toEqual({ error: null });
		expect(upsertCalls).toHaveLength(3);
		expect(upsertCalls[0].rows).toHaveLength(50);
		expect(upsertCalls[1].rows).toHaveLength(50);
		expect(upsertCalls[2].rows).toHaveLength(20);
		expect(upsertCalls.flatMap((c) => c.rows.map((r: any) => r.variation_key))).toEqual(keys);
	});

	it('does not batch when the key count is already within one batch', async () => {
		const { client, deleteCalls } = fakeSupabase();
		const keys = Array.from({ length: 50 }, (_, i) => `v${i}`);
		await setVariationsIncluded(client as any, 'player-1', 'rep-1', keys, true);
		expect(deleteCalls).toHaveLength(1);
		expect(deleteCalls[0].vals).toHaveLength(50);
	});

	it('stops at the first failing batch and does not attempt further batches', async () => {
		const { client, deleteCalls } = fakeSupabase({ deleteErrorOnCall: 2, errorMessage: 'batch 2 failed' });
		const keys = Array.from({ length: 150 }, (_, i) => `v${i}`); // 3 batches
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', keys, true);
		expect(result).toEqual({ error: 'batch 2 failed' });
		expect(deleteCalls).toHaveLength(2); // the 3rd batch was never attempted
	});

	it('rolls back an earlier successful delete batch when a later batch fails (included: true)', async () => {
		// Without this, a caller (RepertoirePracticeRow) that reverts its own
		// UI state to "nothing changed" on any error would silently disagree
		// with the database — batch 1's rows really were deleted (i.e. those
		// variations really are now included) even though the whole call
		// reports failure and the UI shows every row as still excluded.
		const { client, deleteCalls, upsertCalls } = fakeSupabase({ deleteErrorOnCall: 2, errorMessage: 'batch 2 failed' });
		const keys = Array.from({ length: 150 }, (_, i) => `v${i}`); // 3 batches of 50
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', keys, true);

		expect(result).toEqual({ error: 'batch 2 failed' });
		expect(deleteCalls).toHaveLength(2); // batch 1 (succeeded) + batch 2 (failed)

		// Rollback re-inserts exactly the keys the successful first delete
		// batch removed — restoring them as excluded again.
		expect(upsertCalls).toHaveLength(1);
		expect(upsertCalls[0].rows.map((r: any) => r.variation_key)).toEqual(keys.slice(0, 50));
		expect(upsertCalls[0].rows.every((r: any) => r.player_id === 'player-1' && r.repertoire_id === 'rep-1')).toBe(true);
	});

	it('rolls back an earlier successful upsert batch when a later batch fails (included: false)', async () => {
		const { client, deleteCalls, upsertCalls } = fakeSupabase({ upsertErrorOnCall: 2, errorMessage: 'batch 2 failed' });
		const keys = Array.from({ length: 150 }, (_, i) => `v${i}`); // 3 batches of 50
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', keys, false);

		expect(result).toEqual({ error: 'batch 2 failed' });
		expect(upsertCalls).toHaveLength(2); // batch 1 (succeeded) + batch 2 (failed)

		// Rollback deletes exactly the keys the successful first upsert batch inserted.
		expect(deleteCalls).toHaveLength(1);
		expect(deleteCalls[0]).toEqual({
			table: 'variation_practice_exclusions',
			col1: 'player_id',
			val1: 'player-1',
			col2: 'variation_key',
			vals: keys.slice(0, 50)
		});
	});

	it('does not attempt any rollback when the very first batch is the one that fails', async () => {
		const { client, deleteCalls, upsertCalls } = fakeSupabase({ upsertErrorOnCall: 1, errorMessage: 'boom' });
		const keys = Array.from({ length: 150 }, (_, i) => `v${i}`);
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', keys, false);

		expect(result).toEqual({ error: 'boom' });
		expect(upsertCalls).toHaveLength(1); // only the failing attempt — nothing succeeded first
		expect(deleteCalls).toHaveLength(0); // nothing to roll back
	});
});
