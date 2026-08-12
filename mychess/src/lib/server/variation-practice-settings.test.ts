import { describe, it, expect } from 'vitest';
import { setVariationsIncluded } from './variation-practice-settings';

function fakeSupabase(
	opts: { deleteError?: { message: string } | null; upsertError?: { message: string } | null } = {}
) {
	const calls: { delete?: any; upsert?: any } = {};
	return {
		client: {
			from: (table: string) => ({
				delete: () => ({
					eq: (col1: string, val1: string) => ({
						in: (col2: string, vals: string[]) => {
							calls.delete = { table, col1, val1, col2, vals };
							return Promise.resolve({ error: opts.deleteError ?? null });
						}
					})
				}),
				upsert: (rows: any[], options: any) => {
					calls.upsert = { table, rows, options };
					return Promise.resolve({ error: opts.upsertError ?? null });
				}
			})
		},
		calls
	};
}

describe('setVariationsIncluded', () => {
	it('no-ops on an empty variationKeys array without touching supabase at all', async () => {
		const { client, calls } = fakeSupabase();
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', [], true);
		expect(result).toEqual({ error: null });
		expect(calls.delete).toBeUndefined();
		expect(calls.upsert).toBeUndefined();
	});

	it('deletes matching exclusion rows when included is true', async () => {
		const { client, calls } = fakeSupabase();
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', ['v1', 'v2'], true);
		expect(result).toEqual({ error: null });
		expect(calls.delete).toEqual({
			table: 'variation_practice_exclusions',
			col1: 'player_id',
			val1: 'player-1',
			col2: 'variation_key',
			vals: ['v1', 'v2']
		});
		expect(calls.upsert).toBeUndefined();
	});

	it('upserts one row per key when included is false', async () => {
		const { client, calls } = fakeSupabase();
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', ['v1', 'v2'], false);
		expect(result).toEqual({ error: null });
		expect(calls.upsert.table).toBe('variation_practice_exclusions');
		expect(calls.upsert.rows).toEqual([
			{ player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v1' },
			{ player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v2' }
		]);
		expect(calls.upsert.options).toEqual({ onConflict: 'player_id,variation_key' });
		expect(calls.delete).toBeUndefined();
	});

	it('dedupes variationKeys before upserting, so a repeated key does not appear twice', async () => {
		const { client, calls } = fakeSupabase();
		await setVariationsIncluded(client as any, 'player-1', 'rep-1', ['v1', 'v2', 'v1'], false);
		expect(calls.upsert.rows).toEqual([
			{ player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v1' },
			{ player_id: 'player-1', repertoire_id: 'rep-1', variation_key: 'v2' }
		]);
	});

	it('propagates a delete error message', async () => {
		const { client } = fakeSupabase({ deleteError: { message: 'boom' } });
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', ['v1'], true);
		expect(result).toEqual({ error: 'boom' });
	});

	it('propagates an upsert error message', async () => {
		const { client } = fakeSupabase({ upsertError: { message: 'boom' } });
		const result = await setVariationsIncluded(client as any, 'player-1', 'rep-1', ['v1'], false);
		expect(result).toEqual({ error: 'boom' });
	});
});
